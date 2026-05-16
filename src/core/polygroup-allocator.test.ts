import { describe, it, expect } from 'vitest'
import { PolygroupAllocator, type PolygroupMember } from './polygroup-allocator'

const m1 = (...trackIds: number[]): PolygroupMember[] =>
  trackIds.map((trackId) => ({ trackId, capacity: 1 }))

const mCap = (...pairs: [number, number][]): PolygroupMember[] =>
  pairs.map(([trackId, capacity]) => ({ trackId, capacity }))

describe('PolygroupAllocator', () => {
  it('returns null with no members', () => {
    const a = new PolygroupAllocator()
    expect(a.noteOn(60, 100, [])).toBeNull()
    expect(a.voices).toEqual([])
  })

  it('single capacity-1 member: first press lands; second press steals', () => {
    const a = new PolygroupAllocator()
    expect(a.noteOn(60, 100, m1(0))).toEqual({ trackId: 0, vel: 100 })
    expect(a.noteOn(64, 110, m1(0))).toEqual({ trackId: 0, vel: 110, stolenNote: 60 })
    expect(a.voices).toHaveLength(1)
    expect(a.voices[0]!.note).toBe(64)
  })

  it('round-robin across 3 capacity-1 members in order', () => {
    const a = new PolygroupAllocator()
    const m = m1(0, 1, 2)
    expect(a.noteOn(60, 100, m)).toEqual({ trackId: 0, vel: 100 })
    expect(a.noteOn(64, 100, m)).toEqual({ trackId: 1, vel: 100 })
    expect(a.noteOn(67, 100, m)).toEqual({ trackId: 2, vel: 100 })
  })

  it('full pool of capacity-1 members: 4th press steals the oldest', () => {
    const a = new PolygroupAllocator()
    const m = m1(0, 1, 2)
    a.noteOn(60, 100, m)
    a.noteOn(64, 100, m)
    a.noteOn(67, 100, m)
    const r = a.noteOn(72, 120, m)
    expect(r).toEqual({ trackId: 0, vel: 120, stolenNote: 60 })
  })

  it('skips full members in round-robin order', () => {
    const a = new PolygroupAllocator()
    const m = m1(0, 1, 2)
    a.noteOn(60, 100, m) // → t0
    a.noteOn(64, 100, m) // → t1
    a.noteOff(64, false) // release t1
    // currentTrackId is t1; sticky start there. t1 is now free → lands on t1.
    expect(a.noteOn(67, 100, m)).toEqual({ trackId: 1, vel: 100 })
    // currentTrackId now t1. Next press: t1 full, advance to t2 (free).
    expect(a.noteOn(70, 100, m)).toEqual({ trackId: 2, vel: 100 })
  })

  it('released slot becomes reusable on next press', () => {
    const a = new PolygroupAllocator()
    const m = m1(0, 1, 2)
    a.noteOn(60, 100, m)
    a.noteOn(64, 100, m)
    a.noteOn(67, 100, m)
    a.noteOff(64, false) // release t1
    // currentTrackId is t2 from the third allocation, full. Step forward → t0 full → t1 free.
    expect(a.noteOn(70, 100, m)).toEqual({ trackId: 1, vel: 100 })
  })

  it('sustain pedal: noteOff with sustainDown keeps voice held', () => {
    const a = new PolygroupAllocator()
    const m = m1(0, 1)
    a.noteOn(60, 100, m)
    a.noteOn(64, 100, m)
    expect(a.noteOff(60, true)).toBeNull()
    expect(a.noteOff(64, true)).toBeNull()
    expect(a.voices).toHaveLength(2)
    expect(a.voices.every((v) => !v.keyDown && v.held)).toBe(true)
  })

  it('pedalUp releases all keyUp voices and returns trackId+note for each', () => {
    const a = new PolygroupAllocator()
    const m = m1(0, 1, 2)
    a.noteOn(60, 100, m) // → t0
    a.noteOn(64, 100, m) // → t1
    a.noteOn(67, 100, m) // → t2
    a.noteOff(60, true)  // sustained
    a.noteOff(64, true)  // sustained
    // t2 still keyDown
    const released = a.pedalUp()
    expect(released).toEqual([
      { trackId: 0, note: 60 },
      { trackId: 1, note: 64 },
    ])
    expect(a.voices).toHaveLength(1)
    expect(a.voices[0]!.trackId).toBe(2)
  })

  it('forgetTrack returns every voice on that track and removes them', () => {
    const a = new PolygroupAllocator()
    const m = mCap([0, 4], [1, 1])
    a.noteOn(60, 100, m) // → t0 (1/4)
    a.noteOn(62, 100, m) // → t0 (2/4)
    a.noteOn(64, 100, m) // → t0 (3/4)
    a.noteOn(67, 100, m) // → t0 (4/4)
    a.noteOn(72, 100, m) // → t1 (1/1)
    expect(a.forgetTrack(0)).toEqual([
      { trackId: 0, note: 60 },
      { trackId: 0, note: 62 },
      { trackId: 0, note: 64 },
      { trackId: 0, note: 67 },
    ])
    expect(a.voices).toHaveLength(1)
    expect(a.voices[0]!.trackId).toBe(1)
    expect(a.forgetTrack(99)).toEqual([])
  })

  it('forgetTrack: future allocations re-include the track if it is back in members', () => {
    const a = new PolygroupAllocator()
    a.noteOn(60, 100, m1(0, 1))
    a.forgetTrack(0)
    const r = a.noteOn(64, 100, m1(0, 1))
    expect(r?.trackId === 0 || r?.trackId === 1).toBe(true)
  })

  it('reset clears state and round-robin pointer', () => {
    const a = new PolygroupAllocator()
    const m = m1(0, 1, 2)
    a.noteOn(60, 100, m)
    a.noteOn(64, 100, m)
    a.reset()
    expect(a.voices).toEqual([])
    expect(a.noteOn(67, 100, m)).toEqual({ trackId: 0, vel: 100 })
  })

  it('steal-oldest ignores tracks not in current members list', () => {
    const a = new PolygroupAllocator()
    a.noteOn(60, 100, m1(0, 1))
    a.noteOn(64, 100, m1(0, 1))
    // Now press while only t1 is in members → steal must target t1, not t0
    const r = a.noteOn(67, 110, m1(1))
    expect(r).toEqual({ trackId: 1, vel: 110, stolenNote: 64 })
  })

  // -------------------------------------------------------------------------
  // Capacity-aware allocation
  // -------------------------------------------------------------------------

  it('capacity 4 single member: 4 presses fill, 5th steals oldest', () => {
    const a = new PolygroupAllocator()
    const m = mCap([0, 4])
    expect(a.noteOn(60, 100, m)).toEqual({ trackId: 0, vel: 100 })
    expect(a.noteOn(62, 100, m)).toEqual({ trackId: 0, vel: 100 })
    expect(a.noteOn(64, 100, m)).toEqual({ trackId: 0, vel: 100 })
    expect(a.noteOn(67, 100, m)).toEqual({ trackId: 0, vel: 100 })
    expect(a.voices).toHaveLength(4)
    expect(a.noteOn(72, 120, m)).toEqual({ trackId: 0, vel: 120, stolenNote: 60 })
    expect(a.voices).toHaveLength(4)
  })

  it('sticky-then-advance: [t0(P=4), t1(P=4)] fills t0 before moving to t1', () => {
    const a = new PolygroupAllocator()
    const m = mCap([0, 4], [1, 4])
    for (let i = 0; i < 4; i++) {
      const r = a.noteOn(60 + i, 100, m)
      expect(r?.trackId).toBe(0)
    }
    for (let i = 0; i < 4; i++) {
      const r = a.noteOn(70 + i, 100, m)
      expect(r?.trackId).toBe(1)
    }
    // Now both full — 9th press steals oldest (note 60 on t0).
    expect(a.noteOn(80, 120, m)).toEqual({ trackId: 0, vel: 120, stolenNote: 60 })
  })

  it('mixed capacities: [t0(P=4), t1(P=1)] fills t0(4) then t1(1) then steals globally oldest', () => {
    const a = new PolygroupAllocator()
    const m = mCap([0, 4], [1, 1])
    for (let i = 0; i < 4; i++) expect(a.noteOn(60 + i, 100, m)?.trackId).toBe(0)
    expect(a.noteOn(70, 100, m)?.trackId).toBe(1)
    // All full. Globally oldest is note 60 on t0.
    expect(a.noteOn(80, 120, m)).toEqual({ trackId: 0, vel: 120, stolenNote: 60 })
  })

  it('after a partial release on the sticky track, next press refills the sticky track first', () => {
    const a = new PolygroupAllocator()
    const m = mCap([0, 4], [1, 4])
    for (let i = 0; i < 4; i++) a.noteOn(60 + i, 100, m) // t0 fills
    for (let i = 0; i < 4; i++) a.noteOn(70 + i, 100, m) // t1 fills, currentTrackId=t1
    a.noteOff(70, false) // release one on t1 → t1 has 3/4
    // Sticky on t1 (which has free capacity) → next press lands on t1, not t0.
    expect(a.noteOn(80, 100, m)?.trackId).toBe(1)
  })

  it('sticky pointer survives a member dropping out of the list', () => {
    const a = new PolygroupAllocator()
    const m = mCap([0, 2], [1, 2], [2, 2])
    a.noteOn(60, 100, m) // → t0 (1/2)
    a.noteOn(62, 100, m) // → t0 (2/2)
    a.noteOn(64, 100, m) // → t1 (1/2), currentTrackId=t1
    // Track 1 is removed from membership; t1's voice is implicitly orphaned (router would have
    // called forgetTrack — here we just simulate the pointer surviving). Next call uses members
    // without t1. currentTrackId=t1 not in members → start at idx 0 (t0). t0 is full, advance to t2.
    const m2 = mCap([0, 2], [2, 2])
    expect(a.noteOn(67, 100, m2)?.trackId).toBe(2)
  })

  it('successive steals walk through the globally oldest voices in age order', () => {
    const a = new PolygroupAllocator()
    const m = mCap([0, 2], [1, 2])
    a.noteOn(60, 100, m) // → t0, age 1
    a.noteOn(62, 100, m) // → t0, age 2
    a.noteOn(64, 100, m) // → t1, age 3
    a.noteOn(66, 100, m) // → t1, age 4
    // All full. Each steal takes the globally oldest voice — naturally spreads churn across tracks.
    expect(a.noteOn(80, 100, m)).toEqual({ trackId: 0, vel: 100, stolenNote: 60 })
    expect(a.noteOn(82, 100, m)).toEqual({ trackId: 0, vel: 100, stolenNote: 62 })
    expect(a.noteOn(84, 100, m)).toEqual({ trackId: 1, vel: 100, stolenNote: 64 })
    expect(a.noteOn(86, 100, m)).toEqual({ trackId: 1, vel: 100, stolenNote: 66 })
  })
})
