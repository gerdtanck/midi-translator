import type { TrackConfig } from './track-config'
import { defaultTrackConfigs } from './track-config'

// Built-in starter presets seeded on first load (or whenever localStorage has no
// preset key yet). User edits replace this map — built-ins do NOT reappear after
// the user explicitly saves or deletes.

const poly8Layer2 = (): TrackConfig[] => {
  const t = defaultTrackConfigs()
  for (let i = 0; i < 16; i++) {
    t[i]!.enabled = true
    t[i]!.sustain = true
    t[i]!.polygroup = i < 8 ? 'A' : 'B'
  }
  return t
}

const poly16 = (): TrackConfig[] => {
  const t = defaultTrackConfigs()
  for (let i = 0; i < 16; i++) {
    t[i]!.enabled = true
    t[i]!.sustain = true
    t[i]!.polygroup = 'A'
  }
  return t
}

const init = (): TrackConfig[] => defaultTrackConfigs()

const para4 = (): TrackConfig[] => {
  const t = defaultTrackConfigs()
  t[0]!.enabled = true
  t[0]!.polyphony = 4
  t[0]!.latch = true
  t[0]!.sustain = true
  return t
}

export const builtInPresets = (): Record<string, TrackConfig[]> => ({
  'Poly 8 Layer 2': poly8Layer2(),
  'Poly 16': poly16(),
  Init: init(),
  'Para 4': para4(),
})
