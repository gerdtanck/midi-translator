import type { Polyphony } from '../core/voice-allocator'

export interface TrackConfig {
  trackId: number
  enabled: boolean
  polyphony: Polyphony
  // When true, released voice slots keep their last CC value instead of resetting to unison.
  latch: boolean
}

export const defaultTrackConfigs = (): TrackConfig[] =>
  Array.from({ length: 16 }, (_, i) => ({
    trackId: i,
    enabled: false,
    polyphony: 1,
    latch: false,
  }))

export const POLYPHONY_CHOICES: readonly Polyphony[] = [1, 3, 4]
