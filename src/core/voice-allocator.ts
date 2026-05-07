export type Polyphony = 1 | 3 | 4

export interface Voice {
  note: number
  vel: number
  keyDown: boolean
  held: boolean
  ageTick: number
}

export class VoiceAllocator {
  readonly polyphony: Polyphony
  voices: Voice[] = []
  private ageTick = 0

  constructor(polyphony: Polyphony) {
    this.polyphony = polyphony
  }

  reset(): void {
    this.voices = []
    this.ageTick = 0
  }

  noteOn(note: number, vel: number): void {
    const v: Voice = {
      note,
      vel,
      keyDown: true,
      held: true,
      ageTick: ++this.ageTick,
    }

    if (this.voices.length < this.polyphony) {
      this.voices.push(v)
      return
    }

    // Full — steal.
    if (this.polyphony === 1) {
      this.voices[0] = v
      return
    }

    // Poly 3/4 — steal oldest non-anchor (slots 1..N-1).
    let oldestIdx = 1
    for (let i = 2; i < this.voices.length; i++) {
      if (this.voices[i]!.ageTick < this.voices[oldestIdx]!.ageTick) oldestIdx = i
    }
    this.voices.splice(oldestIdx, 1)
    this.voices.push(v)
  }

  noteOff(note: number, sustainDown: boolean): void {
    for (const v of this.voices) {
      if (v.keyDown && v.note === note) {
        v.keyDown = false
        if (!sustainDown) v.held = false
      }
    }
  }

  pedalUp(): void {
    for (const v of this.voices) {
      if (v.held && !v.keyDown) v.held = false
    }
  }

  // Remove released voices; keeps insertion order so list[0] remains the anchor
  // (or, if the anchor released, the next-oldest survivor becomes the new anchor).
  finalize(): void {
    this.voices = this.voices.filter((v) => v.held)
  }
}
