import { describe, it, expect } from 'vitest'
import { Router } from './router'
import { TrackEngine, type MidiSink } from './track-engine'

type Message =
  | { kind: 'noteOn'; ch: number; note: number; vel: number }
  | { kind: 'noteOff'; ch: number; note: number }
  | { kind: 'cc'; ch: number; cc: number; value: number }

class TestSink implements MidiSink {
  messages: Message[] = []
  sendNoteOn(ch: number, note: number, vel: number): void {
    this.messages.push({ kind: 'noteOn', ch, note, vel })
  }
  sendNoteOff(ch: number, note: number): void {
    this.messages.push({ kind: 'noteOff', ch, note })
  }
  sendCc(ch: number, cc: number, value: number): void {
    this.messages.push({ kind: 'cc', ch, cc, value })
  }
  reset(): void {
    this.messages = []
  }
}

const noteOn = (ch: number, note: number, vel: number) =>
  new Uint8Array([0x90 | (ch - 1), note, vel])
const noteOff = (ch: number, note: number) =>
  new Uint8Array([0x80 | (ch - 1), note, 0])
const cc = (ch: number, n: number, v: number) =>
  new Uint8Array([0xb0 | (ch - 1), n, v])

describe('Router + TrackEngine integration', () => {
  it('track 1 poly=1: plays C4 → PTCH1 then NoteOn, releases → NoteOff', () => {
    const sink = new TestSink()
    const engine = new TrackEngine(0, 1, sink)
    const router = new Router(() => [engine])

    router.onMidiMessage(noteOn(1, 60, 100))
    // Expect CC first (PTCH1 absolute for C4 = 70), then NoteOn ch1 note 36
    expect(sink.messages).toEqual([
      { kind: 'cc', ch: 1, cc: 16, value: 70 },
      { kind: 'noteOn', ch: 1, note: 36, vel: 100 },
    ])

    sink.reset()
    router.onMidiMessage(noteOff(1, 60))
    expect(sink.messages).toEqual([{ kind: 'noteOff', ch: 1, note: 36 }])
  })

  it('track 1 poly=3: C-E-G chord → single NoteOn + three PTCH CCs', () => {
    const sink = new TestSink()
    const engine = new TrackEngine(0, 3, sink)
    const router = new Router(() => [engine])

    router.onMidiMessage(noteOn(1, 60, 100)) // C4 → PTCH1=70
    router.onMidiMessage(noteOn(1, 64, 100)) // E4 → PTCH2 relative (+4 semi = 8 QT, raw 72)
    router.onMidiMessage(noteOn(1, 67, 100)) // G4 → PTCH3 relative (+7 semi = 14 QT, raw 78)

    // Filter to the meaningful set (the order is deterministic per our emit())
    const noteOns = sink.messages.filter((m) => m.kind === 'noteOn')
    expect(noteOns).toEqual([{ kind: 'noteOn', ch: 1, note: 36, vel: 100 }])

    const ccs = sink.messages.filter((m) => m.kind === 'cc')
    expect(ccs).toContainEqual({ kind: 'cc', ch: 1, cc: 16, value: 70 })
    expect(ccs).toContainEqual({ kind: 'cc', ch: 1, cc: 20, value: 72 })
    expect(ccs).toContainEqual({ kind: 'cc', ch: 1, cc: 21, value: 78 })
  })

  it('track 1 poly=3: anchor migration on anchor release recomputes absolute + relative', () => {
    const sink = new TestSink()
    const engine = new TrackEngine(0, 3, sink)
    const router = new Router(() => [engine])

    router.onMidiMessage(noteOn(1, 60, 100)) // C4
    router.onMidiMessage(noteOn(1, 64, 100)) // E4
    router.onMidiMessage(noteOn(1, 67, 100)) // G4
    sink.reset()

    router.onMidiMessage(noteOff(1, 60)) // release anchor — migrate to E4

    // New anchor PTCH1 = absCc(E4=64) = 2*64 - 50 = 78
    // New PTCH2 = relCc(G4=67, E4=64) = +3 semi = 6 QT, raw 70
    // PTCH3 (slot 2) becomes unused → raw 64 (unison)
    const ccs = sink.messages.filter((m) => m.kind === 'cc')
    expect(ccs).toContainEqual({ kind: 'cc', ch: 1, cc: 16, value: 78 })
    expect(ccs).toContainEqual({ kind: 'cc', ch: 1, cc: 20, value: 70 })
    expect(ccs).toContainEqual({ kind: 'cc', ch: 1, cc: 21, value: 64 })
    // No re-trigger of the MD track note
    expect(sink.messages.find((m) => m.kind === 'noteOn' || m.kind === 'noteOff')).toBeUndefined()
  })

  it('diffs: repeated identical state emits no redundant CCs', () => {
    const sink = new TestSink()
    const engine = new TrackEngine(0, 1, sink)
    const router = new Router(() => [engine])

    router.onMidiMessage(noteOn(1, 60, 100))
    sink.reset()
    // Stealing with the same note — CC 16 stays 70 → no CC sent
    router.onMidiMessage(noteOn(1, 60, 100))
    expect(sink.messages.filter((m) => m.kind === 'cc')).toEqual([])
  })

  it('track 5 (group 2, machine 0) routes CCs to ch2', () => {
    const sink = new TestSink()
    const engine = new TrackEngine(4, 1, sink) // track 5 = trackId 4
    const router = new Router(() => [engine])

    router.onMidiMessage(noteOn(1, 60, 100))
    const ccs = sink.messages.filter((m) => m.kind === 'cc')
    expect(ccs).toContainEqual({ kind: 'cc', ch: 2, cc: 16, value: 70 })
    // Trigger note: track 5 = G2 = MIDI 43
    const noteOns = sink.messages.filter((m) => m.kind === 'noteOn')
    expect(noteOns).toEqual([{ kind: 'noteOn', ch: 1, note: 43, vel: 100 }])
  })

  it('sustain pedal defers voice release until pedal up', () => {
    const sink = new TestSink()
    const engine = new TrackEngine(0, 1, sink)
    const router = new Router(() => [engine])

    router.onMidiMessage(noteOn(1, 60, 100))
    sink.reset()

    router.onMidiMessage(cc(1, 64, 127))    // sustain down
    router.onMidiMessage(noteOff(1, 60))    // release key — should NOT send NoteOff
    expect(sink.messages.filter((m) => m.kind === 'noteOff')).toEqual([])

    router.onMidiMessage(cc(1, 64, 0))      // sustain up — NoteOff now fires
    expect(sink.messages.filter((m) => m.kind === 'noteOff')).toEqual([
      { kind: 'noteOff', ch: 1, note: 36 },
    ])
  })
})
