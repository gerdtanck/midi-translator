import { describe, it, expect } from 'vitest'
import { VoiceAllocator } from './voice-allocator'

const notes = (a: VoiceAllocator) => a.voices.map((v) => v.note)

describe('VoiceAllocator poly=1', () => {
  it('replaces anchor when second note arrives', () => {
    const a = new VoiceAllocator(1)
    a.noteOn(60, 100)
    a.finalize()
    expect(notes(a)).toEqual([60])
    a.noteOn(62, 100)
    a.finalize()
    expect(notes(a)).toEqual([62])
  })
})

describe('VoiceAllocator poly=3', () => {
  it('appends up to polyphony and migrates anchor on release', () => {
    const a = new VoiceAllocator(3)
    a.noteOn(60, 100)
    a.noteOn(64, 100)
    a.noteOn(67, 100)
    a.finalize()
    expect(notes(a)).toEqual([60, 64, 67])

    a.noteOff(60, false)
    a.finalize()
    expect(notes(a)).toEqual([64, 67]) // anchor migrated
  })

  it('steals oldest non-anchor when full', () => {
    const a = new VoiceAllocator(3)
    a.noteOn(60, 100) // ageTick=1, anchor
    a.noteOn(64, 100) // ageTick=2
    a.noteOn(67, 100) // ageTick=3
    a.finalize()
    a.noteOn(72, 100) // full — steal oldest satellite (64)
    a.finalize()
    expect(notes(a)).toEqual([60, 67, 72])
  })
})

describe('VoiceAllocator poly=4', () => {
  it('handles mixed release', () => {
    const a = new VoiceAllocator(4)
    a.noteOn(60, 100)
    a.noteOn(64, 100)
    a.noteOn(67, 100)
    a.noteOn(72, 100)
    a.finalize()
    expect(notes(a)).toEqual([60, 64, 67, 72])

    a.noteOff(64, false)
    a.finalize()
    expect(notes(a)).toEqual([60, 67, 72])

    a.noteOff(60, false)
    a.finalize()
    expect(notes(a)).toEqual([67, 72])
  })
})

describe('VoiceAllocator sustain', () => {
  it('defers release until pedal up', () => {
    const a = new VoiceAllocator(3)
    a.noteOn(60, 100)
    a.noteOn(64, 100)
    a.finalize()

    // release anchor with sustain down — voice stays held but keyDown=false
    a.noteOff(60, true)
    a.finalize()
    expect(notes(a)).toEqual([60, 64])
    expect(a.voices[0]!.keyDown).toBe(false)
    expect(a.voices[0]!.held).toBe(true)

    // pedal up — voice is released, anchor migrates
    a.pedalUp()
    a.finalize()
    expect(notes(a)).toEqual([64])
  })

  it('re-strike of same note while sustained creates a duplicate voice', () => {
    const a = new VoiceAllocator(3)
    a.noteOn(60, 100)
    a.noteOff(60, true)     // sustained, voice still held
    a.finalize()
    a.noteOn(60, 100)       // re-strike — duplicate
    a.finalize()
    expect(notes(a)).toEqual([60, 60])

    // release the new key while pedal still down — both 60s have keyDown=false
    a.noteOff(60, true)
    a.finalize()
    expect(notes(a)).toEqual([60, 60])

    // pedal up — both go away
    a.pedalUp()
    a.finalize()
    expect(notes(a)).toEqual([])
  })
})

describe('VoiceAllocator reset', () => {
  it('clears voices and age tick', () => {
    const a = new VoiceAllocator(3)
    a.noteOn(60, 100)
    a.noteOn(64, 100)
    a.reset()
    expect(notes(a)).toEqual([])
    a.noteOn(72, 100)
    a.finalize()
    expect(notes(a)).toEqual([72])
  })
})
