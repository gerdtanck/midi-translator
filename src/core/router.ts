import {
  STATUS_CONTROL_CHANGE,
  STATUS_NOTE_OFF,
  STATUS_NOTE_ON,
  CC_SUSTAIN,
} from '../midi/midi-constants'
import type { TrackEngine } from './track-engine'
import { PolygroupAllocator } from './polygroup-allocator'

export interface RoutingSnapshot {
  // Engines indexed by trackId, including any track that may receive a polygroup voice.
  engineByTrackId: Map<number, TrackEngine>
  // Enabled members of polygroup A, ordered by trackId.
  polygroupAMembers: number[]
  // Enabled members of polygroup B, ordered by trackId.
  polygroupBMembers: number[]
  // Enabled tracks not in any polygroup — broadcast targets (current behavior).
  nonMembers: TrackEngine[]
}

export class Router {
  private sustainDown = false
  private readonly polyA = new PolygroupAllocator()
  private readonly polyB = new PolygroupAllocator()

  constructor(private readonly getRouting: () => RoutingSnapshot) {}

  onMidiMessage(bytes: Uint8Array): void {
    if (bytes.length < 2) return
    const status = bytes[0]!
    const ch = status & 0x0f
    if (ch !== 0) return // input is MIDI ch1 only
    const type = status & 0xf0
    const d1 = bytes[1]!
    const d2 = bytes[2] ?? 0

    if (type === STATUS_NOTE_ON && d2 > 0) {
      const r = this.getRouting()
      this.dispatchPolyNoteOn(this.polyA, r.polygroupAMembers, r.engineByTrackId, d1, d2)
      this.dispatchPolyNoteOn(this.polyB, r.polygroupBMembers, r.engineByTrackId, d1, d2)
      for (const e of r.nonMembers) {
        e.allocator.noteOn(d1, d2)
        e.allocator.finalize()
        e.update(true)
      }
    } else if (type === STATUS_NOTE_OFF || (type === STATUS_NOTE_ON && d2 === 0)) {
      const r = this.getRouting()
      this.dispatchPolyNoteOff(this.polyA, r.engineByTrackId, d1)
      this.dispatchPolyNoteOff(this.polyB, r.engineByTrackId, d1)
      for (const e of r.nonMembers) {
        e.allocator.noteOff(d1, this.sustainDown)
        e.allocator.finalize()
        e.update(false)
      }
    } else if (type === STATUS_CONTROL_CHANGE && d1 === CC_SUSTAIN) {
      const wasDown = this.sustainDown
      const nowDown = d2 >= 64
      this.sustainDown = nowDown
      if (wasDown && !nowDown) {
        const r = this.getRouting()
        for (const { trackId } of this.polyA.pedalUp()) this.dispatchEngineNoteOff(r.engineByTrackId, trackId)
        for (const { trackId } of this.polyB.pedalUp()) this.dispatchEngineNoteOff(r.engineByTrackId, trackId)
        for (const e of r.nonMembers) {
          e.allocator.pedalUp()
          e.allocator.finalize()
          e.update(false)
        }
      }
    }
  }

  // Remove any polygroup voice owned by this track and dispatch the corresponding noteOff
  // to its engine. Used when a track changes membership or is disabled while still holding a voice.
  forgetTrack(trackId: number): void {
    const r = this.getRouting()
    for (const allocator of [this.polyA, this.polyB]) {
      const removed = allocator.forgetTrack(trackId)
      if (removed) this.dispatchEngineNoteOff(r.engineByTrackId, removed.trackId)
    }
  }

  // Clear all polygroup bookkeeping. Use after panic, where engines are force-released separately.
  reset(): void {
    this.polyA.reset()
    this.polyB.reset()
    this.sustainDown = false
  }

  private dispatchPolyNoteOn(
    allocator: PolygroupAllocator,
    members: number[],
    engineByTrackId: Map<number, TrackEngine>,
    note: number,
    vel: number,
  ): void {
    if (members.length === 0) return
    const alloc = allocator.noteOn(note, vel, members)
    if (!alloc) return
    const engine = engineByTrackId.get(alloc.trackId)
    if (!engine) return
    if (alloc.stolenNote !== undefined) {
      // Release the displaced voice first so the engine sends NoteOff for the trigger note,
      // then the new noteOn sends fresh CCs + NoteOn — natural retrigger on the wire.
      engine.allocator.noteOff(alloc.stolenNote, false)
      engine.allocator.finalize()
      engine.update(false)
    }
    engine.allocator.noteOn(note, alloc.vel)
    engine.allocator.finalize()
    engine.update(true)
  }

  private dispatchPolyNoteOff(
    allocator: PolygroupAllocator,
    engineByTrackId: Map<number, TrackEngine>,
    note: number,
  ): void {
    const released = allocator.noteOff(note, this.sustainDown)
    if (!released) return
    this.dispatchEngineNoteOff(engineByTrackId, released.trackId, note)
  }

  private dispatchEngineNoteOff(
    engineByTrackId: Map<number, TrackEngine>,
    trackId: number,
    note?: number,
  ): void {
    const engine = engineByTrackId.get(trackId)
    if (!engine) return
    // The engine's allocator only ever holds at most one voice for a polygrouped track,
    // so we can release whichever voice is currently there. If a specific note is given,
    // prefer it; otherwise release whatever is held.
    const currentVoice = engine.allocator.voices[0]
    if (currentVoice) {
      engine.allocator.noteOff(note ?? currentVoice.note, false)
      engine.allocator.finalize()
      engine.update(false)
    }
  }
}
