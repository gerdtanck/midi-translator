const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v

// MD TONAL tuning: quarter-tone ET, CC value 0 = C#1 (34.648 Hz).
// Derivation: standard MIDI A4 = 69 = 440 Hz, MD CC 0 is 44 semitones below A4,
// and each MD step = half a semitone, so mdCc = 2*(n - 25) = 2n - 50.
export function absCc(midiNote: number): number {
  return clamp(2 * midiNote - 50, 0, 127)
}

// PTCH2..4 are offsets from PTCH1 in quarter-tones. MD UI shows -64..+63,
// but the raw CC range is 0..127 with center 64 = unison (raw = offset + 64).
// Unused slots must send raw 64 (unison with PTCH1).
export const REL_CC_UNISON = 64
export function relCc(noteK: number, note0: number): number {
  const offset = clamp(2 * (noteK - note0), -64, 63)
  return offset + 64
}
