import { describe, it, expect } from 'vitest'
import { PolygroupAllocator } from './polygroup-allocator'

describe('PolygroupAllocator', () => {
  it('returns null with no members', () => {
    const a = new PolygroupAllocator()
    expect(a.noteOn(60, 100, [])).toBeNull()
    expect(a.voices).toEqual([])
  })

  it('single member: first press lands; second press steals', () => {
    const a = new PolygroupAllocator()
    expect(a.noteOn(60, 100, [0])).toEqual({ trackId: 0, vel: 100 })
    expect(a.noteOn(64, 110, [0])).toEqual({ trackId: 0, vel: 110, stolenNote: 60 })
    expect(a.voices).toHaveLength(1)
    expect(a.voices[0]!.note).toBe(64)
  })

  it('round-robin across 3 members in order', () => {
    const a = new PolygroupAllocator()
    const m = [0, 1, 2]
    expect(a.noteOn(60, 100, m)).toEqual({ trackId: 0, vel: 100 })
    expect(a.noteOn(64, 100, m)).toEqual({ trackId: 1, vel: 100 })
    expect(a.noteOn(67, 100, m)).toEqual({ trackId: 2, vel: 100 })
  })

  it('full pool: 4th press steals the oldest', () => {
    const a = new PolygroupAllocator()
    const m = [0, 1, 2]
    a.noteOn(60, 100, m)
    a.noteOn(64, 100, m)
    a.noteOn(67, 100, m)
    const r = a.noteOn(72, 120, m)
    expect(r).toEqual({ trackId: 0, vel: 120, stolenNote: 60 })
  })

  it('skips held members in round-robin order', () => {
    const a = new PolygroupAllocator()
    const m = [0, 1, 2]
    a.noteOn(60, 100, m) // → t0
    a.noteOn(64, 100, m) // → t1
    a.noteOff(64, false) // release t1
    // pointer is at idx 1, next step lands on idx 2 (free), not idx 1 (just freed)
    expect(a.noteOn(67, 100, m)).toEqual({ trackId: 2, vel: 100 })
    // now t1 is the only free one; pointer is at idx 2, wraps to idx 0 (held), skips to idx 1 (free)
    expect(a.noteOn(70, 100, m)).toEqual({ trackId: 1, vel: 100 })
  })

  it('released slot becomes reusable on next press', () => {
    const a = new PolygroupAllocator()
    const m = [0, 1, 2]
    a.noteOn(60, 100, m)
    a.noteOn(64, 100, m)
    a.noteOn(67, 100, m)
    a.noteOff(64, false) // release t1 only
    // round-robin from idx 2: wraps to 0 (held), to 1 (free)
    expect(a.noteOn(70, 100, m)).toEqual({ trackId: 1, vel: 100 })
  })

  it('sustain pedal: noteOff with sustainDown keeps voice held', () => {
    const a = new PolygroupAllocator()
    const m = [0, 1]
    a.noteOn(60, 100, m)
    a.noteOn(64, 100, m)
    expect(a.noteOff(60, true)).toBeNull()
    expect(a.noteOff(64, true)).toBeNull()
    expect(a.voices).toHaveLength(2)
    expect(a.voices.every((v) => !v.keyDown && v.held)).toBe(true)
  })

  it('pedalUp releases all keyUp voices and returns their trackIds', () => {
    const a = new PolygroupAllocator()
    const m = [0, 1, 2]
    a.noteOn(60, 100, m) // → t0
    a.noteOn(64, 100, m) // → t1
    a.noteOn(67, 100, m) // → t2
    a.noteOff(60, true)  // sustained
    a.noteOff(64, true)  // sustained
    // t2 still keyDown
    const released = a.pedalUp()
    expect(released).toEqual([{ trackId: 0 }, { trackId: 1 }])
    expect(a.voices).toHaveLength(1)
    expect(a.voices[0]!.trackId).toBe(2)
  })

  it('forgetTrack removes the voice on that track and returns it', () => {
    const a = new PolygroupAllocator()
    const m = [0, 1, 2]
    a.noteOn(60, 100, m)
    a.noteOn(64, 100, m)
    expect(a.forgetTrack(1)).toEqual({ trackId: 1, note: 64 })
    expect(a.voices).toHaveLength(1)
    expect(a.voices[0]!.trackId).toBe(0)
    expect(a.forgetTrack(99)).toBeNull()
  })

  it('forgetTrack: future allocations re-include the track if it is back in members', () => {
    const a = new PolygroupAllocator()
    a.noteOn(60, 100, [0, 1])
    a.forgetTrack(0)
    // Members still includes t0 → next press should land on a free track
    const r = a.noteOn(64, 100, [0, 1])
    expect(r?.trackId === 0 || r?.trackId === 1).toBe(true)
  })

  it('reset clears state and round-robin pointer', () => {
    const a = new PolygroupAllocator()
    const m = [0, 1, 2]
    a.noteOn(60, 100, m)
    a.noteOn(64, 100, m)
    a.reset()
    expect(a.voices).toEqual([])
    expect(a.noteOn(67, 100, m)).toEqual({ trackId: 0, vel: 100 })
  })

  it('steal-oldest ignores tracks not in current members list', () => {
    const a = new PolygroupAllocator()
    // First fill t0 and t1
    a.noteOn(60, 100, [0, 1])
    a.noteOn(64, 100, [0, 1])
    // Now press while only t1 is in members → steal must target t1, not t0
    const r = a.noteOn(67, 110, [1])
    expect(r).toEqual({ trackId: 1, vel: 110, stolenNote: 64 })
  })
})
