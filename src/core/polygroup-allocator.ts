export interface PolygroupVoice {
  note: number
  vel: number
  trackId: number
  keyDown: boolean
  held: boolean
  ageTick: number
}

export interface PolygroupMember {
  trackId: number
  // Maximum simultaneous voices on this track inside the polygroup.
  // = TrackConfig.polyphony for that track.
  capacity: number
}

export interface PolygroupAllocation {
  trackId: number
  vel: number
  // Set when this allocation displaced an existing voice. Caller must dispatch
  // NoteOff(stolenNote) on the engine before the new NoteOn.
  stolenNote?: number
}

// Voice allocator where each member track holds up to `capacity` voices.
// - Sticky round-robin: keep allocating to the current track until full, then advance.
// - Steal-oldest across the whole polygroup when every member is at capacity.
// - Sticky pointer is trackId-based so it survives membership churn.
export class PolygroupAllocator {
  voices: PolygroupVoice[] = []
  private ageTick = 0
  private currentTrackId: number | null = null

  noteOn(
    note: number,
    vel: number,
    members: readonly PolygroupMember[],
  ): PolygroupAllocation | null {
    if (members.length === 0) return null

    // Tally current voices per track.
    const counts = new Map<number, number>()
    for (const v of this.voices) counts.set(v.trackId, (counts.get(v.trackId) ?? 0) + 1)

    // Sticky start: stay on currentTrackId if it's still a member; else start at index 0.
    const startIdx =
      this.currentTrackId !== null
        ? Math.max(0, members.findIndex((m) => m.trackId === this.currentTrackId))
        : 0

    // Scan for the first track with free capacity.
    for (let step = 0; step < members.length; step++) {
      const m = members[(startIdx + step) % members.length]!
      if ((counts.get(m.trackId) ?? 0) < m.capacity) {
        this.voices.push({
          note,
          vel,
          trackId: m.trackId,
          keyDown: true,
          held: true,
          ageTick: ++this.ageTick,
        })
        this.currentTrackId = m.trackId
        return { trackId: m.trackId, vel }
      }
    }

    // All members at capacity — steal oldest voice across the polygroup, scoped to current members.
    let oldest: PolygroupVoice | null = null
    for (const v of this.voices) {
      if (!members.some((m) => m.trackId === v.trackId)) continue
      if (oldest === null || v.ageTick < oldest.ageTick) oldest = v
    }
    if (!oldest) return null
    const stolenNote = oldest.note
    oldest.note = note
    oldest.vel = vel
    oldest.keyDown = true
    oldest.held = true
    oldest.ageTick = ++this.ageTick
    this.currentTrackId = oldest.trackId
    return { trackId: oldest.trackId, vel, stolenNote }
  }

  noteOff(note: number, sustainDown: boolean): { trackId: number; note: number } | null {
    for (let i = 0; i < this.voices.length; i++) {
      const v = this.voices[i]!
      if (v.keyDown && v.note === note) {
        v.keyDown = false
        if (sustainDown) return null
        v.held = false
        const trackId = v.trackId
        this.voices.splice(i, 1)
        return { trackId, note }
      }
    }
    return null
  }

  pedalUp(): { trackId: number; note: number }[] {
    const released: { trackId: number; note: number }[] = []
    const remaining: PolygroupVoice[] = []
    for (const v of this.voices) {
      if (!v.keyDown) {
        v.held = false
        released.push({ trackId: v.trackId, note: v.note })
      } else {
        remaining.push(v)
      }
    }
    this.voices = remaining
    return released
  }

  // Remove every voice on this track and return them so the caller can dispatch noteOffs.
  forgetTrack(trackId: number): { trackId: number; note: number }[] {
    const removed: { trackId: number; note: number }[] = []
    const remaining: PolygroupVoice[] = []
    for (const v of this.voices) {
      if (v.trackId === trackId) removed.push({ trackId, note: v.note })
      else remaining.push(v)
    }
    this.voices = remaining
    return removed
  }

  reset(): void {
    this.voices = []
    this.ageTick = 0
    this.currentTrackId = null
  }
}
