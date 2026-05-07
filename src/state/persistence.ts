import type { TrackConfig } from './track-config'
import { POLYPHONY_CHOICES, defaultTrackConfigs } from './track-config'
import type { Polyphony } from '../core/voice-allocator'

const STORAGE_KEY = 'md-midi-translator:settings:v1'

export interface PersistedSettings {
  inputId: string | null
  outputId: string | null
  tracks: TrackConfig[]
}

export const defaultSettings = (): PersistedSettings => ({
  inputId: null,
  outputId: null,
  tracks: defaultTrackConfigs(),
})

export function loadSettings(): PersistedSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultSettings()
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return defaultSettings()
    const s = parsed as Partial<PersistedSettings>
    const base = defaultSettings()
    const tracks = Array.isArray(s.tracks)
      ? base.tracks.map((t, i) => {
          const p = s.tracks?.[i]
          if (!p) return t
          const poly = (POLYPHONY_CHOICES as readonly number[]).includes(p.polyphony)
            ? (p.polyphony as Polyphony)
            : t.polyphony
          return {
            trackId: i,
            enabled: Boolean(p.enabled),
            polyphony: poly,
            latch: Boolean(p.latch),
          }
        })
      : base.tracks
    return {
      inputId: typeof s.inputId === 'string' ? s.inputId : null,
      outputId: typeof s.outputId === 'string' ? s.outputId : null,
      tracks,
    }
  } catch {
    return defaultSettings()
  }
}

export function saveSettings(s: PersistedSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  } catch {
    // quota or serialization failure — non-fatal
  }
}
