import { describe, it, expect, beforeEach } from 'vitest'
import { loadPresets, savePresets } from './presets'
import { defaultTrackConfigs } from './track-config'

const PRESET_KEY = 'md-midi-translator:presets:v1'

// Minimal in-memory localStorage shim — vitest runs in plain Node without jsdom.
class MemoryStorage {
  private store = new Map<string, string>()
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }
  removeItem(key: string): void {
    this.store.delete(key)
  }
  clear(): void {
    this.store.clear()
  }
}

beforeEach(() => {
  // Fresh storage for every test.
  ;(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage()
})

const BUILT_IN_KEYS = ['Poly 8 Layer 2', 'Poly 16', 'Init', 'Para 4']

describe('presets persistence', () => {
  it('loadPresets returns built-in presets when storage is empty', () => {
    expect(Object.keys(loadPresets())).toEqual(BUILT_IN_KEYS)
  })

  it('built-in Poly 16 has all 16 tracks in polygroup A with sustain on', () => {
    const loaded = loadPresets()
    const tracks = loaded['Poly 16']!
    expect(tracks).toHaveLength(16)
    for (const t of tracks) {
      expect(t.enabled).toBe(true)
      expect(t.sustain).toBe(true)
      expect(t.polygroup).toBe('A')
    }
  })

  it('save then load preserves names and per-track values', () => {
    const tracks = defaultTrackConfigs()
    tracks[0]!.enabled = true
    tracks[0]!.polyphony = 3
    tracks[0]!.latch = true
    tracks[0]!.polygroup = 'A'
    tracks[0]!.release = 100

    savePresets({ FunkyDrums: tracks })
    const loaded = loadPresets()

    expect(Object.keys(loaded)).toEqual(['FunkyDrums'])
    expect(loaded.FunkyDrums![0]).toMatchObject({
      trackId: 0,
      enabled: true,
      polyphony: 3,
      latch: true,
      polygroup: 'A',
      release: 100,
    })
  })

  it('falls back to built-in presets on malformed JSON', () => {
    localStorage.setItem(PRESET_KEY, 'this is not json')
    expect(Object.keys(loadPresets())).toEqual(BUILT_IN_KEYS)
  })

  it('falls back to built-in presets when stored value is an array', () => {
    localStorage.setItem(PRESET_KEY, JSON.stringify([{ name: 'A', tracks: [] }]))
    expect(Object.keys(loadPresets())).toEqual(BUILT_IN_KEYS)
  })

  it('hydrates malformed track entries with defaults', () => {
    localStorage.setItem(
      PRESET_KEY,
      JSON.stringify({
        Weird: [
          { trackId: 0, enabled: 'yes', polyphony: 99, polygroup: 'X', release: 'oops' },
        ],
      })
    )
    const loaded = loadPresets()
    const t0 = loaded.Weird![0]!
    expect(t0.enabled).toBe(true) // 'yes' is truthy
    expect(t0.polyphony).toBe(1)  // invalid value falls back to default
    expect(t0.polygroup).toBeNull()
    expect(t0.release).toBe(63)   // default for non-numeric
  })

  it('preserves insertion order across save and load', () => {
    const t = defaultTrackConfigs()
    savePresets({ Charlie: t, Alpha: t, Bravo: t })
    expect(Object.keys(loadPresets())).toEqual(['Charlie', 'Alpha', 'Bravo'])
  })

  it('skips entries with empty-string keys', () => {
    localStorage.setItem(
      PRESET_KEY,
      JSON.stringify({ '': defaultTrackConfigs(), Real: defaultTrackConfigs() })
    )
    expect(Object.keys(loadPresets())).toEqual(['Real'])
  })
})
