import { describe, it, expect } from 'vitest'
import { Router, type RoutingSnapshot } from './router'
import { TrackEngine, type MidiSink } from './track-engine'
import type { PolygroupMember } from './polygroup-allocator'

const m1 = (...trackIds: number[]): PolygroupMember[] =>
  trackIds.map((trackId) => ({ trackId, capacity: 1 }))
const mCap = (...pairs: [number, number][]): PolygroupMember[] =>
  pairs.map(([trackId, capacity]) => ({ trackId, capacity }))

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

// All-non-member routing snapshot: every engine receives every press (current behavior).
const nonMemberRouting = (
  engines: TrackEngine[],
  inputChannel = 0,
  fixedVelocity = false,
): RoutingSnapshot => {
  const engineByTrackId = new Map<number, TrackEngine>()
  for (const e of engines) engineByTrackId.set(e.trackId, e)
  return {
    engineByTrackId,
    polygroupAMembers: [],
    polygroupBMembers: [],
    nonMembers: engines,
    inputChannel,
    fixedVelocity,
  }
}

describe('Router + TrackEngine integration', () => {
  it('track 1 poly=1: plays C4 → PTCH1 then NoteOn, releases → NoteOff', () => {
    const sink = new TestSink()
    const engine = new TrackEngine(0, 1, sink)
    const router = new Router(() => nonMemberRouting([engine]))

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
    const router = new Router(() => nonMemberRouting([engine]))

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
    const router = new Router(() => nonMemberRouting([engine]))

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
    const router = new Router(() => nonMemberRouting([engine]))

    router.onMidiMessage(noteOn(1, 60, 100))
    sink.reset()
    // Stealing with the same note — CC 16 stays 70 → no CC sent
    router.onMidiMessage(noteOn(1, 60, 100))
    expect(sink.messages.filter((m) => m.kind === 'cc')).toEqual([])
  })

  it('track 5 (group 2, machine 0) routes CCs to ch2', () => {
    const sink = new TestSink()
    const engine = new TrackEngine(4, 1, sink) // track 5 = trackId 4
    const router = new Router(() => nonMemberRouting([engine]))

    router.onMidiMessage(noteOn(1, 60, 100))
    const ccs = sink.messages.filter((m) => m.kind === 'cc')
    expect(ccs).toContainEqual({ kind: 'cc', ch: 2, cc: 16, value: 70 })
    // Trigger note: track 5 = G2 = MIDI 43
    const noteOns = sink.messages.filter((m) => m.kind === 'noteOn')
    expect(noteOns).toEqual([{ kind: 'noteOn', ch: 1, note: 43, vel: 100 }])
  })

  it('latch on poly=3: chord rings out through the release tail (no PTCH CCs on releases)', () => {
    const sink = new TestSink()
    const engine = new TrackEngine(0, 3, sink)
    engine.latch = true
    const router = new Router(() => nonMemberRouting([engine]))

    router.onMidiMessage(noteOn(1, 60, 100)) // C4
    router.onMidiMessage(noteOn(1, 64, 100)) // E4
    router.onMidiMessage(noteOn(1, 67, 100)) // G4
    sink.reset()

    router.onMidiMessage(noteOff(1, 64))
    router.onMidiMessage(noteOff(1, 60))
    router.onMidiMessage(noteOff(1, 67)) // last release

    // No PTCH CCs at any point during the releases — chord must remain on the device for the tail.
    expect(sink.messages.filter((m) => m.kind === 'cc')).toEqual([])
    expect(sink.messages.filter((m) => m.kind === 'noteOff')).toEqual([
      { kind: 'noteOff', ch: 1, note: 36 },
    ])
  })

  it('latch on poly=3: next first-press resets unused sub-voice slots to unison', () => {
    const sink = new TestSink()
    const engine = new TrackEngine(0, 3, sink)
    engine.latch = true
    const router = new Router(() => nonMemberRouting([engine]))

    // Play a chord and release it — sub-voices remain latched on the device through the tail.
    router.onMidiMessage(noteOn(1, 60, 100))
    router.onMidiMessage(noteOn(1, 64, 100))
    router.onMidiMessage(noteOn(1, 67, 100))
    router.onMidiMessage(noteOff(1, 64))
    router.onMidiMessage(noteOff(1, 60))
    router.onMidiMessage(noteOff(1, 67))
    sink.reset()

    // New single-note press — only slot 0 has a voice, so slots 1 and 2 must be reset to unison
    // so the new note isn't pitched by stale latched offsets.
    router.onMidiMessage(noteOn(1, 65, 100)) // F4
    const ccs = sink.messages.filter((m) => m.kind === 'cc')
    expect(ccs).toContainEqual({ kind: 'cc', ch: 1, cc: 20, value: 64 }) // PTCH2 → unison
    expect(ccs).toContainEqual({ kind: 'cc', ch: 1, cc: 21, value: 64 }) // PTCH3 → unison

    // The unison resets must precede the trigger note-on so the chord starts clean.
    const noteOnIdx = sink.messages.findIndex((m) => m.kind === 'noteOn')
    const ccPositions = sink.messages
      .map((m, i) => (m.kind === 'cc' ? i : -1))
      .filter((i) => i >= 0)
    for (const pos of ccPositions) expect(pos).toBeLessThan(noteOnIdx)
  })

  it('fixedVelocity forces incoming NoteOn velocity to 127', () => {
    const sink = new TestSink()
    const engine = new TrackEngine(0, 1, sink)
    const router = new Router(() => nonMemberRouting([engine], 0, true))

    router.onMidiMessage(noteOn(1, 60, 40)) // soft press
    const noteOns = sink.messages.filter((m) => m.kind === 'noteOn')
    expect(noteOns).toEqual([{ kind: 'noteOn', ch: 1, note: 36, vel: 127 }])
  })

  it('ignores messages on channels other than the configured inputChannel', () => {
    const sink = new TestSink()
    const engine = new TrackEngine(0, 1, sink)
    const router = new Router(() => nonMemberRouting([engine], 2)) // accept ch3 only

    router.onMidiMessage(noteOn(1, 60, 100)) // ch1 — ignored
    expect(sink.messages).toEqual([])

    router.onMidiMessage(noteOn(3, 60, 100)) // ch3 — accepted
    expect(sink.messages).toEqual([
      { kind: 'cc', ch: 1, cc: 16, value: 70 },
      { kind: 'noteOn', ch: 1, note: 36, vel: 100 },
    ])
  })

  it('sustain pedal defers voice release until pedal up', () => {
    const sink = new TestSink()
    const engine = new TrackEngine(0, 1, sink)
    const router = new Router(() => nonMemberRouting([engine]))

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

describe('Router polygroup dispatch', () => {
  // Build a routing snapshot with three engines on tracks 0,1,2 all in polygroup A.
  const setup3A = () => {
    const sink = new TestSink()
    const e0 = new TrackEngine(0, 1, sink)
    const e1 = new TrackEngine(1, 1, sink)
    const e2 = new TrackEngine(2, 1, sink)
    const engineByTrackId = new Map([
      [0, e0],
      [1, e1],
      [2, e2],
    ])
    const router = new Router(() => ({
      engineByTrackId,
      polygroupAMembers: m1(0, 1, 2),
      polygroupBMembers: [],
      nonMembers: [],
      inputChannel: 0,
      fixedVelocity: false,
    }))
    return { sink, e0, e1, e2, router }
  }

  it('round-robin: 3 presses land on tracks 0, 1, 2 in order', () => {
    const { sink, router } = setup3A()
    router.onMidiMessage(noteOn(1, 60, 100))
    router.onMidiMessage(noteOn(1, 64, 100))
    router.onMidiMessage(noteOn(1, 67, 100))

    // Track 0 (machine slot 0): trigger note 36, PTCH1 = cc16
    // Track 1 (machine slot 1): trigger note 38, PTCH1 = cc40
    // Track 2 (machine slot 2): trigger note 40, PTCH1 = cc72
    const noteOns = sink.messages.filter((m) => m.kind === 'noteOn')
    expect(noteOns).toEqual([
      { kind: 'noteOn', ch: 1, note: 36, vel: 100 },
      { kind: 'noteOn', ch: 1, note: 38, vel: 100 },
      { kind: 'noteOn', ch: 1, note: 40, vel: 100 },
    ])
    // PTCH1 absolute values: C4=70, E4=78, G4=84
    const ccs = sink.messages.filter((m) => m.kind === 'cc')
    expect(ccs).toContainEqual({ kind: 'cc', ch: 1, cc: 16, value: 70 })
    expect(ccs).toContainEqual({ kind: 'cc', ch: 1, cc: 40, value: 78 })
    expect(ccs).toContainEqual({ kind: 'cc', ch: 1, cc: 72, value: 84 })
  })

  it('steal: 4th press triggers NoteOff + NoteOn on the oldest track', () => {
    const { sink, router } = setup3A()
    router.onMidiMessage(noteOn(1, 60, 100)) // → t0 (oldest)
    router.onMidiMessage(noteOn(1, 64, 100)) // → t1
    router.onMidiMessage(noteOn(1, 67, 100)) // → t2
    sink.reset()

    router.onMidiMessage(noteOn(1, 72, 110)) // C5 → steals t0

    // Expect on t0: NoteOff(36), then PTCH1=cc16=absCc(72)=94, then NoteOn(36, 110)
    expect(sink.messages).toEqual([
      { kind: 'noteOff', ch: 1, note: 36 },
      { kind: 'cc', ch: 1, cc: 16, value: 94 },
      { kind: 'noteOn', ch: 1, note: 36, vel: 110 },
    ])
  })

  it('release: noteOff dispatches only to the holding track', () => {
    const { sink, router } = setup3A()
    router.onMidiMessage(noteOn(1, 60, 100)) // → t0 (note 36)
    router.onMidiMessage(noteOn(1, 64, 100)) // → t1 (note 38)
    router.onMidiMessage(noteOn(1, 67, 100)) // → t2 (note 40)
    sink.reset()

    router.onMidiMessage(noteOff(1, 64)) // release E4 — held by t1
    expect(sink.messages.filter((m) => m.kind === 'noteOff')).toEqual([
      { kind: 'noteOff', ch: 1, note: 38 },
    ])
  })

  it('layering: A + B + non-member each receive their own voice on a single press', () => {
    const sink = new TestSink()
    const eA = new TrackEngine(0, 1, sink) // poly A member: track 0, ch1, trigger 36
    const eB = new TrackEngine(4, 1, sink) // poly B member: track 5 (group 2), ch2, trigger 43
    const eN = new TrackEngine(8, 1, sink) // non-member: track 9 (group 3), ch3, trigger 50
    const engineByTrackId = new Map([
      [0, eA],
      [4, eB],
      [8, eN],
    ])
    const router = new Router(() => ({
      engineByTrackId,
      polygroupAMembers: m1(0),
      polygroupBMembers: m1(4),
      nonMembers: [eN],
      inputChannel: 0,
      fixedVelocity: false,
    }))

    router.onMidiMessage(noteOn(1, 60, 100))
    const noteOns = sink.messages.filter((m) => m.kind === 'noteOn')
    expect(noteOns).toEqual([
      { kind: 'noteOn', ch: 1, note: 36, vel: 100 }, // poly A member
      { kind: 'noteOn', ch: 1, note: 43, vel: 100 }, // poly B member
      { kind: 'noteOn', ch: 1, note: 50, vel: 100 }, // non-member
    ])
  })

  it('sustain pedal: polygroup voices defer release until pedal up', () => {
    const { sink, router } = setup3A()
    router.onMidiMessage(noteOn(1, 60, 100)) // → t0
    router.onMidiMessage(noteOn(1, 64, 100)) // → t1
    sink.reset()

    router.onMidiMessage(cc(1, 64, 127)) // sustain down
    router.onMidiMessage(noteOff(1, 60))
    router.onMidiMessage(noteOff(1, 64))
    expect(sink.messages.filter((m) => m.kind === 'noteOff')).toEqual([])

    router.onMidiMessage(cc(1, 64, 0)) // pedal up
    const offs = sink.messages.filter((m) => m.kind === 'noteOff')
    // Both tracks release; order is A-then-B (only A here), oldest-first within A
    expect(offs).toEqual([
      { kind: 'noteOff', ch: 1, note: 36 },
      { kind: 'noteOff', ch: 1, note: 38 },
    ])
  })

  it('forgetTrack dispatches a noteOff to a track that is leaving the polygroup', () => {
    const { sink, router } = setup3A()
    router.onMidiMessage(noteOn(1, 60, 100)) // → t0
    router.onMidiMessage(noteOn(1, 64, 100)) // → t1
    sink.reset()

    router.forgetTrack(1)
    expect(sink.messages.filter((m) => m.kind === 'noteOff')).toEqual([
      { kind: 'noteOff', ch: 1, note: 38 },
    ])
  })
})

describe('Router polygroup paraphony-aware allocation', () => {
  // Two members with paraphony=4. First four presses fill t0; next four fill t1.
  const setup2x4A = () => {
    const sink = new TestSink()
    const e0 = new TrackEngine(0, 4, sink)
    const e1 = new TrackEngine(1, 4, sink)
    const engineByTrackId = new Map([
      [0, e0],
      [1, e1],
    ])
    const router = new Router(() => ({
      engineByTrackId,
      polygroupAMembers: mCap([0, 4], [1, 4]),
      polygroupBMembers: [],
      nonMembers: [],
      inputChannel: 0,
      fixedVelocity: false,
    }))
    return { sink, e0, e1, router }
  }

  it('fills sticky track to capacity before advancing', () => {
    const { sink, router } = setup2x4A()
    router.onMidiMessage(noteOn(1, 60, 100)) // → t0 (1/4)
    router.onMidiMessage(noteOn(1, 64, 100)) // → t0 (2/4)
    router.onMidiMessage(noteOn(1, 67, 100)) // → t0 (3/4)
    router.onMidiMessage(noteOn(1, 72, 100)) // → t0 (4/4)
    // Only one MD trigger NoteOn on t0 (note 36) — subsequent within-track presses don't retrigger.
    const noteOnsAfter4 = sink.messages.filter((m) => m.kind === 'noteOn')
    expect(noteOnsAfter4).toEqual([{ kind: 'noteOn', ch: 1, note: 36, vel: 100 }])

    router.onMidiMessage(noteOn(1, 76, 100)) // → t1 (1/4)
    const noteOnsAfter5 = sink.messages.filter((m) => m.kind === 'noteOn')
    // Now we should see the second MD trigger NoteOn — on t1 (trigger note 38).
    expect(noteOnsAfter5).toEqual([
      { kind: 'noteOn', ch: 1, note: 36, vel: 100 },
      { kind: 'noteOn', ch: 1, note: 38, vel: 100 },
    ])
  })

  it('multi-voice fill emits PTCH1 absolute + PTCH2..N relative on the sticky track', () => {
    const { sink, router } = setup2x4A()
    router.onMidiMessage(noteOn(1, 60, 100)) // C4 → PTCH1 abs = 70 on cc16
    router.onMidiMessage(noteOn(1, 64, 100)) // E4 → PTCH2 rel on cc20
    router.onMidiMessage(noteOn(1, 67, 100)) // G4 → PTCH3 rel on cc21
    const ccs = sink.messages.filter((m) => m.kind === 'cc')
    // All on group ch1 (track 0 is in group 1).
    expect(ccs).toContainEqual({ kind: 'cc', ch: 1, cc: 16, value: 70 })
    expect(ccs).toContainEqual({ kind: 'cc', ch: 1, cc: 20, value: 72 })
    expect(ccs).toContainEqual({ kind: 'cc', ch: 1, cc: 21, value: 78 })
  })

  it('steal across the polygroup with paraphony>1 is a CC-only swap (no trigger NoteOff/NoteOn)', () => {
    const { sink, router } = setup2x4A()
    // Fill t0 with 4 voices, then t1 with 4 voices.
    for (const n of [60, 62, 64, 67]) router.onMidiMessage(noteOn(1, n, 100))
    for (const n of [70, 72, 74, 76]) router.onMidiMessage(noteOn(1, n, 100))
    sink.reset()

    router.onMidiMessage(noteOn(1, 80, 110)) // 9th press — steals oldest (60 on t0)

    // Engine on t0 went 4→3 (after release of stolen voice) → 4 (new voice). Voice count never
    // reached zero, so no MD trigger NoteOff or NoteOn is emitted — only CC updates on group ch1.
    expect(sink.messages.filter((m) => m.kind === 'noteOff')).toEqual([])
    expect(sink.messages.filter((m) => m.kind === 'noteOn')).toEqual([])
    // CCs landed on group ch1 (track 0's group), not ch2 (track 1's group).
    const ccs = sink.messages.filter((m) => m.kind === 'cc')
    expect(ccs.length).toBeGreaterThan(0)
    for (const c of ccs) expect(c.kind === 'cc' && c.ch).toBe(1)
  })

  it('steal across the polygroup with paraphony=1 retriggers the displaced track', () => {
    const sink = new TestSink()
    const e0 = new TrackEngine(0, 1, sink)
    const e1 = new TrackEngine(1, 1, sink)
    const engineByTrackId = new Map([
      [0, e0],
      [1, e1],
    ])
    const router = new Router(() => ({
      engineByTrackId,
      polygroupAMembers: m1(0, 1),
      polygroupBMembers: [],
      nonMembers: [],
      inputChannel: 0,
      fixedVelocity: false,
    }))

    router.onMidiMessage(noteOn(1, 60, 100)) // → t0
    router.onMidiMessage(noteOn(1, 64, 100)) // → t1
    sink.reset()
    router.onMidiMessage(noteOn(1, 67, 110)) // 3rd press — steals t0 (oldest)
    // t0 went 1→0 (release) → 1 (new). Visible: NoteOff(36), CC, NoteOn(36, vel=110).
    expect(sink.messages).toEqual([
      { kind: 'noteOff', ch: 1, note: 36 },
      { kind: 'cc', ch: 1, cc: 16, value: 84 }, // PTCH1 abs for G4=67 → 84
      { kind: 'noteOn', ch: 1, note: 36, vel: 110 },
    ])
  })

  it('forgetTrack on a polygrouped track flushes every voice it holds', () => {
    const { sink, router } = setup2x4A()
    for (const n of [60, 62, 64, 67]) router.onMidiMessage(noteOn(1, n, 100)) // 4 voices on t0
    sink.reset()

    router.forgetTrack(0)
    // Engine releases all four voices through its own allocator. The MD trigger NoteOff fires
    // exactly once when the last voice goes away.
    const noteOffs = sink.messages.filter((m) => m.kind === 'noteOff')
    expect(noteOffs).toEqual([{ kind: 'noteOff', ch: 1, note: 36 }])
  })
})
