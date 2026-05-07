// MIDI status byte upper nibbles
export const STATUS_NOTE_OFF = 0x80
export const STATUS_NOTE_ON = 0x90
export const STATUS_CONTROL_CHANGE = 0xb0

export const CC_SUSTAIN = 64
export const CC_ALL_NOTES_OFF = 123

// Machinedrum input: track-trigger notes are sent on MIDI channel 1.
export const MD_TRIGGER_CHANNEL = 1

// System Real-Time messages (single-byte, channel-less, may interleave anywhere).
export const RT_CLOCK = 0xf8
export const RT_START = 0xfa
export const RT_CONTINUE = 0xfb
export const RT_STOP = 0xfc

export const isRealtimeByte = (b: number): boolean => b >= 0xf8
