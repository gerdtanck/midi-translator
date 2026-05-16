import { describe, it, expect, beforeEach } from 'vitest'
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

// Helper that walks the allocator the same way the Router does.
const press = (e: TrackEngine, note: number, vel = 100): void => {
  e.allocator.noteOn(note, vel)
  e.allocator.finalize()
  e.update(true)
}
const releaseKey = (e: TrackEngine, note: number): void => {
  e.allocator.noteOff(note, false)
  e.allocator.finalize()
  e.update(false)
}

const ccs = (sink: TestSink) => sink.messages.filter((m) => m.kind === 'cc') as Extract<Message, { kind: 'cc' }>[]
const decCcs = (sink: TestSink, decCc: number) => ccs(sink).filter((m) => m.cc === decCc)

// Track 0 (machine slot 0) → DEC CC = 17, group ch = 1.
const TRACK = 0
const DEC_CC = 17
const GROUP_CH = 1

describe('TrackEngine sustain', () => {
  let sink: TestSink
  let engine: TrackEngine

  beforeEach(() => {
    sink = new TestSink()
    engine = new TrackEngine(TRACK, 1, sink)
  })

  it('does not touch DEC when sustain is off', () => {
    press(engine, 60)
    releaseKey(engine, 60)
    expect(decCcs(sink, DEC_CC)).toEqual([])
  })

  it('emits DEC=127 on first note-on and DEC=release on last note-off when sustain is on', () => {
    engine.sustain = true
    engine.release = 50

    press(engine, 60)
    // DEC=127 must precede the trigger note-on so the device has the parameter set when the note fires.
    const idxDecOn = sink.messages.findIndex((m) => m.kind === 'cc' && m.cc === DEC_CC && m.value === 127)
    const idxNoteOn = sink.messages.findIndex((m) => m.kind === 'noteOn')
    expect(idxDecOn).toBeGreaterThanOrEqual(0)
    expect(idxNoteOn).toBeGreaterThan(idxDecOn)

    sink.reset()
    releaseKey(engine, 60)
    expect(decCcs(sink, DEC_CC)).toEqual([{ kind: 'cc', ch: GROUP_CH, cc: DEC_CC, value: 50 }])
  })

  it('emits DEC only on first-held / last-released, not intermediate presses', () => {
    engine = new TrackEngine(TRACK, 3, sink)
    engine.sustain = true
    engine.release = 60

    press(engine, 60)
    press(engine, 64)
    press(engine, 67)
    sink.reset()

    releaseKey(engine, 64)
    expect(decCcs(sink, DEC_CC)).toEqual([])
    releaseKey(engine, 60)
    expect(decCcs(sink, DEC_CC)).toEqual([])

    releaseKey(engine, 67) // last voice released
    expect(decCcs(sink, DEC_CC)).toEqual([{ kind: 'cc', ch: GROUP_CH, cc: DEC_CC, value: 60 }])
  })

  it('setSustain(true) while idle emits DEC=release', () => {
    engine.release = 40
    engine.setSustain(true)
    expect(decCcs(sink, DEC_CC)).toEqual([{ kind: 'cc', ch: GROUP_CH, cc: DEC_CC, value: 40 }])
  })

  it('setSustain(true) while held emits DEC=127 immediately', () => {
    press(engine, 60)
    sink.reset()

    engine.setSustain(true)
    expect(decCcs(sink, DEC_CC)).toEqual([{ kind: 'cc', ch: GROUP_CH, cc: DEC_CC, value: 127 }])
  })

  it('setSustain(false) restores DEC=release', () => {
    engine.sustain = true
    engine.release = 30
    press(engine, 60)
    sink.reset()

    engine.setSustain(false)
    expect(decCcs(sink, DEC_CC)).toEqual([{ kind: 'cc', ch: GROUP_CH, cc: DEC_CC, value: 30 }])

    // Subsequent release should not emit DEC since sustain is now off.
    sink.reset()
    releaseKey(engine, 60)
    expect(decCcs(sink, DEC_CC)).toEqual([])
  })

  it('setRelease while sustain on and idle pushes DEC immediately', () => {
    engine.setSustain(true) // emits DEC=63 (default)
    sink.reset()

    engine.setRelease(100)
    expect(decCcs(sink, DEC_CC)).toEqual([{ kind: 'cc', ch: GROUP_CH, cc: DEC_CC, value: 100 }])
  })

  it('setRelease while held does not touch DEC; new value applies on next release', () => {
    engine.sustain = true
    press(engine, 60)
    sink.reset()

    engine.setRelease(20)
    expect(decCcs(sink, DEC_CC)).toEqual([])

    releaseKey(engine, 60)
    expect(decCcs(sink, DEC_CC)).toEqual([{ kind: 'cc', ch: GROUP_CH, cc: DEC_CC, value: 20 }])
  })

  it('setRelease clamps out-of-range and non-finite values', () => {
    engine.setSustain(true)
    sink.reset()

    engine.setRelease(999)
    expect(engine.release).toBe(127)
    engine.setRelease(-5)
    expect(engine.release).toBe(0)
    engine.setRelease(Number.NaN)
    expect(engine.release).toBe(0)
  })

  it('forceRelease restores DEC=release if sustain raised it to 127', () => {
    engine.sustain = true
    engine.release = 45
    press(engine, 60)
    sink.reset()

    engine.forceRelease()
    expect(decCcs(sink, DEC_CC)).toEqual([{ kind: 'cc', ch: GROUP_CH, cc: DEC_CC, value: 45 }])
    // Trigger note-off should also have fired.
    expect(sink.messages.some((m) => m.kind === 'noteOff')).toBe(true)
  })

  it('forceRelease emits no DEC if sustain never raised it', () => {
    // Sustain off path
    press(engine, 60)
    sink.reset()
    engine.forceRelease()
    expect(decCcs(sink, DEC_CC)).toEqual([])
  })

  it('routes DEC to the correct CC and channel for a track in group 2 / machine slot 1', () => {
    // Track 5 → trackId 4 → group ch=2, machine slot 0 → DEC=17.
    // Track 6 → trackId 5 → group ch=2, machine slot 1 → DEC=41.
    sink.reset()
    const e2 = new TrackEngine(5, 1, sink)
    e2.sustain = true
    e2.release = 70
    press(e2, 60)
    const decFrames = ccs(sink).filter((m) => m.cc === 41)
    expect(decFrames).toEqual([{ kind: 'cc', ch: 2, cc: 41, value: 127 }])
    sink.reset()
    releaseKey(e2, 60)
    expect(ccs(sink).filter((m) => m.cc === 41)).toEqual([{ kind: 'cc', ch: 2, cc: 41, value: 70 }])
  })

  it('replaying same DEC value is suppressed by the diff cache', () => {
    engine.release = 50
    engine.setSustain(true) // sends DEC=50
    sink.reset()

    engine.setRelease(50) // same value → no MIDI
    expect(decCcs(sink, DEC_CC)).toEqual([])
  })
})
