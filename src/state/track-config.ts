import type { Polyphony } from '../core/voice-allocator'

export interface TrackConfig {
  trackId: number
  enabled: boolean
  polyphony: Polyphony
  // When true, released voice slots keep their last CC value instead of resetting to unison.
  latch: boolean
  // When true, every new key press retriggers the MD trigger note (NoteOff + NoteOn).
  retrigger: boolean
  // When true, DEC is held at 127 while any voice is held and dropped to `release` when all voices are released.
  sustain: boolean
  // DEC value (0..127) sent when sustain is on and no voices are held.
  release: number
}

export const DEFAULT_RELEASE = 63

export const defaultTrackConfigs = (): TrackConfig[] =>
  Array.from({ length: 16 }, (_, i) => ({
    trackId: i,
    enabled: false,
    polyphony: 1,
    latch: false,
    retrigger: false,
    sustain: false,
    release: DEFAULT_RELEASE,
  }))

export const POLYPHONY_CHOICES: readonly Polyphony[] = [1, 3, 4]
