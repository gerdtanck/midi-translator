import { describe, it, expect } from 'vitest'
import { absCc, relCc } from './tonal-mapper'

describe('absCc — MD TONAL anchor points from manual', () => {
  it('n=25 → 0 (C#1)', () => expect(absCc(25)).toBe(0))
  it('n=60 → 70 (C4 = 261.63 Hz)', () => expect(absCc(60)).toBe(70))
  it('n=81 → 112 (A5 = 880 Hz)', () => expect(absCc(81)).toBe(112))
  it('n=84 → 118 (C6 = 1046.50 Hz)', () => expect(absCc(84)).toBe(118))
  it('n=88 → 126 (E6 = 1318.51 Hz)', () => expect(absCc(88)).toBe(126))
})

describe('absCc — clamp and monotonicity', () => {
  it('clamps below range', () => expect(absCc(0)).toBe(0))
  it('clamps above range', () => expect(absCc(127)).toBe(127))
  it('is strictly increasing over [25..88]', () => {
    for (let n = 25; n < 88; n++) {
      expect(absCc(n + 1)).toBeGreaterThan(absCc(n))
    }
  })
})

describe('relCc — raw 0..127, center 64 = unison', () => {
  const n0 = 60
  it('unison (same note) → 64', () => expect(relCc(n0, n0)).toBe(64))
  it('+1 semitone → 66', () => expect(relCc(n0 + 1, n0)).toBe(66))
  it('-1 semitone → 62', () => expect(relCc(n0 - 1, n0)).toBe(62))
  it('+31 semitones → 126', () => expect(relCc(n0 + 31, n0)).toBe(126))
  it('-32 semitones → 0', () => expect(relCc(n0 - 32, n0)).toBe(0))

  it('clamps positive overflow to +63 QT → raw 127', () => {
    expect(relCc(n0 + 40, n0)).toBe(127)
  })
  it('clamps negative overflow to -64 QT → raw 0', () => {
    expect(relCc(n0 - 40, n0)).toBe(0)
  })
})
