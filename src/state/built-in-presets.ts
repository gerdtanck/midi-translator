import type { TrackConfig } from './track-config'
import { defaultTrackConfigs } from './track-config'

// Built-in starter presets seeded on first load (or whenever localStorage has no
// preset key yet). User edits replace this map — built-ins do NOT reappear after
// the user explicitly saves or deletes.

const init = (): TrackConfig[] => {
  const t = defaultTrackConfigs()
  t[0]!.retrigger = true
  return t
}

// N enabled mono tracks, sustain on, no polygroup — independent voices on consecutive tracks.
const mono = (count: number): TrackConfig[] => {
  const t = defaultTrackConfigs()
  for (let i = 0; i < count; i++) {
    t[i]!.enabled = true
    t[i]!.sustain = true
  }
  return t
}

// N enabled tracks in a single polygroup A — true polyphony with one voice per track.
const polySingleLayer = (count: number): TrackConfig[] => {
  const t = defaultTrackConfigs()
  for (let i = 0; i < count; i++) {
    t[i]!.enabled = true
    t[i]!.sustain = true
    t[i]!.polygroup = 'A'
  }
  return t
}

// All 16 tracks enabled, split into two polygroups (8 in A, 8 in B) — two layers of 8 voices.
const polyTwoLayers = (): TrackConfig[] => {
  const t = defaultTrackConfigs()
  for (let i = 0; i < 16; i++) {
    t[i]!.enabled = true
    t[i]!.sustain = true
    t[i]!.polygroup = i < 8 ? 'A' : 'B'
  }
  return t
}

// N enabled paraphonic tracks (polyphony 3 or 4) in polygroup A, latch + sustain on, release=80.
const para = (count: number, polyphony: 3 | 4): TrackConfig[] => {
  const t = defaultTrackConfigs()
  for (let i = 0; i < count; i++) {
    t[i]!.enabled = true
    t[i]!.polyphony = polyphony
    t[i]!.latch = true
    t[i]!.sustain = true
    t[i]!.release = 80
    t[i]!.polygroup = 'A'
  }
  return t
}

export const builtInPresets = (): Record<string, TrackConfig[]> => ({
  Init: init(),
  'Mono 1': mono(1),
  'Mono 4': mono(4),
  'Poly 4 x 1': polySingleLayer(4),
  'Poly 8 x 1': polySingleLayer(8),
  'Poly 16 x 1': polySingleLayer(16),
  'Poly 8 x 2': polyTwoLayers(),
  'Para 3 x 4': para(4, 3),
  'Para 4 x 4': para(4, 4),
  'Para 4 x 16': para(16, 4),
})
