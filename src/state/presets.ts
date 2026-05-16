import type { TrackConfig } from './track-config'
import { hydrateTracks } from './persistence'
import { builtInPresets } from './built-in-presets'

const PRESET_KEY = 'md-midi-translator:presets:v1'

export type PresetMap = Record<string, TrackConfig[]>

export function loadPresets(): PresetMap {
  try {
    const raw = localStorage.getItem(PRESET_KEY)
    if (!raw) return builtInPresets()
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return builtInPresets()
    const out: PresetMap = {}
    for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (name.length === 0) continue
      out[name] = hydrateTracks(value)
    }
    return out
  } catch {
    return builtInPresets()
  }
}

export function savePresets(map: PresetMap): void {
  try {
    localStorage.setItem(PRESET_KEY, JSON.stringify(map))
  } catch {
    // quota or serialization failure — non-fatal
  }
}
