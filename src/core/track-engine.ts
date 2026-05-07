import { absCc, relCc, REL_CC_UNISON } from './tonal-mapper'
import { VoiceAllocator, type Polyphony } from './voice-allocator'
import {
  groupChannel,
  machineIndex,
  ptchCcForTrack,
  triggerNoteForTrack,
} from '../midi/md-tables'
import { MD_TRIGGER_CHANNEL } from '../midi/midi-constants'

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
  private triggerHeld = false
  private lastSentCc = new Map<number, number>()
  private readonly sink: MidiSink
  private readonly groupCh: number
  private readonly ptchCcs: readonly number[]
  private readonly triggerNote: number

  constructor(trackId: number, polyphony: Polyphony, sink: MidiSink) {
    this.trackId = trackId
    this.allocator = new VoiceAllocator(polyphony)
    this.sink = sink
    this.groupCh = groupChannel(trackId)
    this.ptchCcs = ptchCcForTrack(trackId)
    this.triggerNote = triggerNoteForTrack(trackId)
    void machineIndex // imported for clarity; lookup already applied above
  }

  // Force-release everything and send trigger note-off if held.
  // Used when disabling the track or on panic.
  forceRelease(): void {
    if (this.triggerHeld) {
      this.sink.sendNoteOff(MD_TRIGGER_CHANNEL, this.triggerNote)
      this.triggerHeld = false
    }
    this.allocator.reset()
    this.lastSentCc.clear()
  }

  // Called after the allocator has been mutated and finalize()d.
  // isNoteOn=true for note-on events; false for note-off and pedal-up (release events).
  update(isNoteOn: boolean): void {
    const wasHeld = this.triggerHeld
    const nowHeld = this.allocator.voices.length > 0

    if (!wasHeld && nowHeld) {
      // First voice — set CCs BEFORE the trigger note-on so pitch is correct from the first sample.
      this.emitCcs()
      const vel = this.allocator.voices[0]!.vel
      this.sink.sendNoteOn(MD_TRIGGER_CHANNEL, this.triggerNote, vel)
      this.triggerHeld = true
    } else if (wasHeld && !nowHeld) {
      this.sink.sendNoteOff(MD_TRIGGER_CHANNEL, this.triggerNote)
      this.triggerHeld = false
      this.lastSentCc.clear()
    } else if (wasHeld && nowHeld) {
      // Anchor may have migrated or a satellite changed — diff the CCs.
      // With latch on, freeze pitches at the last note-on snapshot: skip emit on release events.
      if (!this.latch || isNoteOn) this.emitCcs()
    }
  }

  private emitCcs(): void {
    const voices = this.allocator.voices
    const polyphony = this.allocator.polyphony

    // Only emit CCs for slots the configured polyphony actually uses.
    // For each used slot k: PTCH1 absolute, PTCH2..N relative; unused slots (past voices.length) → raw 0 (unison).
    const anchorNote = voices[0]?.note
    if (anchorNote === undefined) return // no voices; nothing to emit (handled in update())

    for (let k = 0; k < polyphony; k++) {
      const cc = this.ptchCcs[k]!
      let value: number
      if (k === 0) {
        value = absCc(anchorNote)
      } else if (k < voices.length) {
        value = relCc(voices[k]!.note, anchorNote)
      } else if (this.latch) {
        continue // keep last-sent value for released slots
      } else {
        value = REL_CC_UNISON // unison with PTCH1
      }
      if (this.lastSentCc.get(cc) !== value) {
        this.sink.sendCc(this.groupCh, cc, value)
        this.lastSentCc.set(cc, value)
      }
    }
  }
}
