// Trigger note (on MD ch1) per MD track, indexed 0..15 (= MD tracks 1..16).
// Scientific pitch notation: C2 = MIDI note 36.
export const TRIGGER_NOTES: readonly number[] = [
  36, 38, 40, 41, 43, 45, 47, // tracks 1-7: C2 D2 E2 F2 G2 A2 B2
  48, 50, 52, 53, 55,         // tracks 8-12: C3 D3 E3 F3 G3
  57, 59, 60, 62              // tracks 13-16: A3 B3 C4 D4
]

// PTCH CC numbers per machine-in-group × PTCH slot.
// Row = machineIdx (trackId % 4), column = ptchSlot (0..3 → PTCH1..PTCH4).
export const PTCH_CC: readonly (readonly number[])[] = [
  [16, 20, 21, 22],    // machine 0 — tracks 1, 5, 9, 13
  [40, 44, 45, 46],    // machine 1 — tracks 2, 6, 10, 14
  [72, 76, 77, 78],    // machine 2 — tracks 3, 7, 11, 15
  [96, 100, 101, 102], // machine 3 — tracks 4, 8, 12, 16
]

// MD output channel for a track's pitch CCs (1-based).
// Tracks 1-4 → ch1, 5-8 → ch2, 9-12 → ch3, 13-16 → ch4.
export const groupChannel = (trackId: number): number =>
  Math.floor(trackId / 4) + 1

// Which "machine slot" within a group a track occupies (0..3).
export const machineIndex = (trackId: number): number => trackId % 4

// CC numbers for a given track's PTCH slots (PTCH1..PTCH4).
export const ptchCcForTrack = (trackId: number): readonly number[] => {
  const row = PTCH_CC[machineIndex(trackId)]
  if (!row) throw new Error(`invalid trackId ${trackId}`)
  return row
}

// Trigger note for a given track.
export const triggerNoteForTrack = (trackId: number): number => {
  const n = TRIGGER_NOTES[trackId]
  if (n === undefined) throw new Error(`invalid trackId ${trackId}`)
  return n
}
