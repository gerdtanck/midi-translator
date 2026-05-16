import { absCc, relCc, REL_CC_UNISON } from './tonal-mapper'
import { VoiceAllocator, type Polyphony } from './voice-allocator'
import {
  decCcForTrack,
  groupChannel,
  machineIndex,
  ptchCcForTrack,
  triggerNoteForTrack,
} from '../midi/md-tables'
import { MD_TRIGGER_CHANNEL } from '../midi/midi-constants'

const DEC_INFINITE = 127

const clampCc = (v: number): number => {
  if (!Number.isFinite(v)) return 0
  const n = Math.round(v)
  if (n < 0) return 0
  if (n > 127) return 127
  return n
}

export interface MidiSink {
  sendNoteOn(channel1based: number, note: number, velocity: number): void
  sendNoteOff(channel1based: number, note: number): void
  sendCc(channel1based: number, cc: number, value: number): void
}

export class TrackEngine {
  readonly trackId: number
  readonly allocator: VoiceAllocator
  // When true, released voice slots keep their last-sent CC value instead of being reset to unison.
  latch = false
  // When true, every new key press re-fires the trigger note (NoteOff + NoteOn) so the MD voice restarts.
  retrigger = false
  // When true, unused paraphonic sub-voice slots emit raw 64 (unison with PTCH1).
  // When false, they emit raw 0 — disables the voice on the device, so per-voice gain doesn't add up.
  unisonUnused = true
  // When true, DEC is held at 127 while any voice is held and sent as `release` when all are released.
  sustain = false
  // DEC value (0..127) sent on last-released (or live edits) when sustain is on.
  release = 63
  private triggerHeld = false
  private lastSentCc = new Map<number, number>()
  private readonly sink: MidiSink
  private readonly groupCh: number
  private readonly ptchCcs: readonly number[]
  private readonly triggerNote: number
  private readonly decCc: number

  constructor(trackId: number, polyphony: Polyphony, sink: MidiSink) {
    this.trackId = trackId
    this.allocator = new VoiceAllocator(polyphony)
    this.sink = sink
    this.groupCh = groupChannel(trackId)
    this.ptchCcs = ptchCcForTrack(trackId)
    this.triggerNote = triggerNoteForTrack(trackId)
    this.decCc = decCcForTrack(trackId)
    void machineIndex // imported for clarity; lookup already applied above
  }

  // Force-release everything and send trigger note-off if held.
  // Used when disabling the track or on panic.
  forceRelease(): void {
    if (this.triggerHeld) {
      this.sink.sendNoteOff(MD_TRIGGER_CHANNEL, this.triggerNote)
      this.triggerHeld = false
    }
    // If we previously raised DEC to 127 for sustain, restore the release baseline so the device
    // doesn't get stuck at infinite decay.
    if (this.sustain && this.lastSentCc.get(this.decCc) === DEC_INFINITE) {
      this.sink.sendCc(this.groupCh, this.decCc, this.release)
    }
    this.allocator.reset()
    this.lastSentCc.clear()
  }

  // Toggle sustain. Side effects:
  //   on while idle  → DEC = release (set device to UI baseline now that we own DEC)
  //   on while held  → DEC = 127     (begin sustain phase for the currently-playing note)
  //   off            → DEC = release (restore baseline)
  setSustain(enabled: boolean): void {
    if (this.sustain === enabled) return
    this.sustain = enabled
    if (enabled) {
      this.emitDec(this.allocator.voices.length > 0 ? DEC_INFINITE : this.release)
    } else {
      this.emitDec(this.release)
    }
  }

  // Flip the unused-slot mode. While voices are held, re-emit so the change is audible immediately.
  // emitCcs(false) skips unused slots when latch is on — that's the correct behavior here too.
  setUnisonUnused(value: boolean): void {
    if (this.unisonUnused === value) return
    this.unisonUnused = value
    if (this.allocator.voices.length > 0) this.emitCcs(false)
  }

  // Update the release value. If sustain is on and no voices are held, push the new value to the
  // device immediately so the user can A/B-tune the tail. While held, DEC stays at 127 and the new
  // value applies on the next release.
  setRelease(value: number): void {
    const v = clampCc(value)
    this.release = v
    if (this.sustain && this.allocator.voices.length === 0) {
      this.emitDec(v)
    }
  }

  // Called after the allocator has been mutated and finalize()d.
  // isNoteOn=true for note-on events; false for note-off and pedal-up (release events).
  update(isNoteOn: boolean): void {
    const wasHeld = this.triggerHeld
    const nowHeld = this.allocator.voices.length > 0

    if (!wasHeld && nowHeld) {
      // First voice — set CCs BEFORE the trigger note-on so pitch is correct from the first sample.
      // Pass firstPress=true so unused slots are forced to unison even with latch on, clearing any
      // stale offsets latched from a previous chord that has now finished its release tail.
      this.emitCcs(true)
      if (this.sustain) this.emitDec(DEC_INFINITE)
      const vel = this.allocator.voices[0]!.vel
      this.sink.sendNoteOn(MD_TRIGGER_CHANNEL, this.triggerNote, vel)
      this.triggerHeld = true
    } else if (wasHeld && !nowHeld) {
      this.sink.sendNoteOff(MD_TRIGGER_CHANNEL, this.triggerNote)
      this.triggerHeld = false
      this.lastSentCc.clear()
      if (this.sustain) this.emitDec(this.release)
    } else if (wasHeld && nowHeld) {
      // Anchor may have migrated or a satellite changed — diff the CCs.
      // With latch on, freeze pitches at the last note-on snapshot: skip emit on release events.
      if (!this.latch || isNoteOn) this.emitCcs(false)
      if (isNoteOn && this.retrigger) {
        // Re-fire trigger note with the velocity of the most recent key press.
        const newest = this.allocator.voices[this.allocator.voices.length - 1]!
        this.sink.sendNoteOff(MD_TRIGGER_CHANNEL, this.triggerNote)
        this.sink.sendNoteOn(MD_TRIGGER_CHANNEL, this.triggerNote, newest.vel)
      }
    }
  }

  private emitDec(value: number): void {
    if (this.lastSentCc.get(this.decCc) === value) return
    this.sink.sendCc(this.groupCh, this.decCc, value)
    this.lastSentCc.set(this.decCc, value)
  }

  private emitCcs(firstPress: boolean): void {
    const voices = this.allocator.voices
    const polyphony = this.allocator.polyphony

    // Only emit CCs for slots the configured polyphony actually uses.
    // For each used slot k: PTCH1 absolute, PTCH2..N relative; unused slots (past voices.length) → raw 0 (unison).
    // With latch on, unused slots normally keep their last-sent value — except on a first-press,
    // where we force unison to clear any stale offsets latched from a previous chord whose release
    // tail has finished.
    const anchorNote = voices[0]?.note
    if (anchorNote === undefined) return // no voices; nothing to emit (handled in update())

    for (let k = 0; k < polyphony; k++) {
      const cc = this.ptchCcs[k]!
      let value: number
      if (k === 0) {
        value = absCc(anchorNote)
      } else if (k < voices.length) {
        value = relCc(voices[k]!.note, anchorNote)
      } else if (this.latch && !firstPress) {
        continue // mid-chord release with latch on — keep last-sent value
      } else {
        // Unison (raw 64) keeps the slot at the anchor pitch; disabled (raw 0) silences the voice.
        value = this.unisonUnused ? REL_CC_UNISON : 0
      }
      if (this.lastSentCc.get(cc) !== value) {
        this.sink.sendCc(this.groupCh, cc, value)
        this.lastSentCc.set(cc, value)
      }
    }
  }
}
