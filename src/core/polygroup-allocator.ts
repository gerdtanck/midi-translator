export interface PolygroupVoice {
  note: number
  vel: number
  trackId: number
  keyDown: boolean
  held: boolean
  ageTick: number
}

export interface PolygroupAllocation {
  trackId: number
  vel: number
  // Set when this allocation displaced an existing voice on the same track.
  // Caller must dispatch NoteOff(stolenNote) before the new NoteOn.
  stolenNote?: number
}

// Voice allocator where each "voice" is a member track.
// - Round-robin allocation across the members list (passed in per call so membership can change).
// - Steal-oldest when all members are held.
// - Sustain-pedal-aware releases (key release while pedal is down keeps the voice held).
export class PolygroupAllocator {
  voices: PolygroupVoice[] = []
  private ageTick = 0
  private lastAllocatedMemberIdx = -1

  noteOn(note: number, vel: number, members: readonly number[]): PolygroupAllocation | null {
    if (members.length === 0) return null

    const heldByTrack = new Map<number, PolygroupVoice>()
    for (const v of this.voices) heldByTrack.set(v.trackId, v)

    // Free-slot scan: round-robin starting after the last-allocated index.
    for (let step = 1; step <= members.length; step++) {
      const idx = (this.lastAllocatedMemberIdx + step) % members.length
      const trackId = members[idx]!
      if (!heldByTrack.has(trackId)) {
        this.voices.push({
          note,
          vel,
          trackId,
          keyDown: true,
          held: true,
          ageTick: ++this.ageTick,
        })
        this.lastAllocatedMemberIdx = idx
        return { trackId, vel }
      }
    }

    // All members held — steal the oldest voice (smallest ageTick) among current members.
    let oldestIdx = -1
    for (let i = 0; i < this.voices.length; i++) {
      const v = this.voices[i]!
      if (!members.includes(v.trackId)) continue
      if (oldestIdx === -1 || v.ageTick < this.voices[oldestIdx]!.ageTick) oldestIdx = i
    }
    if (oldestIdx === -1) return null // shouldn't happen if heldByTrack covered all members
    const target = this.voices[oldestIdx]!
    const stolenNote = target.note
    target.note = note
    target.vel = vel
    target.keyDown = true
    target.held = true
    target.ageTick = ++this.ageTick
    this.lastAllocatedMemberIdx = members.indexOf(target.trackId)
    return { trackId: target.trackId, vel, stolenNote }
  }

  noteOff(note: number, sustainDown: boolean): { trackId: number } | null {
    for (let i = 0; i < this.voices.length; i++) {
      const v = this.voices[i]!
      if (v.keyDown && v.note === note) {
        v.keyDown = false
        if (sustainDown) return null
        v.held = false
        const trackId = v.trackId
        this.voices.splice(i, 1)
        return { trackId }
      }
    }
    return null
  }

  pedalUp(): { trackId: number }[] {
    const released: { trackId: number }[] = []
    const remaining: PolygroupVoice[] = []
    for (const v of this.voices) {
      if (!v.keyDown) {
        v.held = false
        released.push({ trackId: v.trackId })
      } else {
        remaining.push(v)
      }
    }
    this.voices = remaining
    return released
  }

  // Remove any voice on this track and return it so the caller can dispatch a noteOff.
  forgetTrack(trackId: number): { trackId: number; note: number } | null {
    for (let i = 0; i < this.voices.length; i++) {
      const v = this.voices[i]!
      if (v.trackId === trackId) {
        this.voices.splice(i, 1)
        return { trackId, note: v.note }
      }
    }
    return null
  }

  reset(): void {
    this.voices = []
    this.ageTick = 0
    this.lastAllocatedMemberIdx = -1
  }
}
