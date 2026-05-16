import type { TrackConfig } from './track-config'
import { DEFAULT_RELEASE, POLYPHONY_CHOICES, defaultTrackConfigs } from './track-config'
import type { Polyphony } from '../core/voice-allocator'

const clampCc = (v: unknown, fallback: number): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
  const n = Math.round(v)
  if (n < 0) return 0
  if (n > 127) return 127
  return n
}

const STORAGE_KEY = 'md-midi-translator:settings:v1'

export interface PersistedSettings {
  inputId: string | null
  outputId: string | null
  tracks: TrackConfig[]
  lastPreset: string | null
}

export const defaultSettings = (): PersistedSettings => ({
  inputId: null,
  outputId: null,
  tracks: defaultTrackConfigs(),
  lastPreset: null,
})

// Validate/clamp a possibly-malformed array of per-track entries into a fully-typed
// TrackConfig[]. Used both by loadSettings and by preset loading.
export const hydrateTracks = (raw: unknown): TrackConfig[] => {
  const base = defaultTrackConfigs()
  if (!Array.isArray(raw)) return base
  return base.map((t, i) => {
    const p = raw[i] as Partial<TrackConfig> | undefined
    if (!p || typeof p !== 'object') return t
    const poly = (POLYPHONY_CHOICES as readonly number[]).includes(p.polyphony as number)
      ? (p.polyphony as Polyphony)
      : t.polyphony
    return {
      trackId: i,
      enabled: Boolean(p.enabled),
      polyphony: poly,
      latch: Boolean(p.latch),
      retrigger: Boolean(p.retrigger),
      sustain: Boolean(p.sustain),
      release: clampCc(p.release, DEFAULT_RELEASE),
      polygroup: p.polygroup === 'A' || p.polygroup === 'B' ? p.polygroup : null,
    }
  })
}

export function loadSettings(): PersistedSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultSettings()
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return defaultSettings()
    const s = parsed as Partial<PersistedSettings>
    return {
      inputId: typeof s.inputId === 'string' ? s.inputId : null,
      outputId: typeof s.outputId === 'string' ? s.outputId : null,
      tracks: hydrateTracks(s.tracks),
      lastPreset: typeof s.lastPreset === 'string' ? s.lastPreset : null,
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
