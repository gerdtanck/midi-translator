import {
  STATUS_NOTE_ON,
  STATUS_NOTE_OFF,
  STATUS_CONTROL_CHANGE,
  RT_CLOCK,
  RT_START,
  RT_CONTINUE,
  RT_STOP,
} from '../midi/midi-constants'

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

const noteName = (n: number): string => {
  // Scientific pitch: MIDI 60 = C4 (matches md-tables convention).
  const name = NOTE_NAMES[n % 12]
  const octave = Math.floor(n / 12) - 1
  return `${name}${octave}`
}

export const formatMidi = (bytes: Uint8Array): string => {
  if (bytes.length < 1) return '(empty)'
  const b0 = bytes[0]!
  if (b0 >= 0xf8) {
    switch (b0) {
      case RT_CLOCK:
        return '       Clock'
      case RT_START:
        return '       Start'
      case RT_CONTINUE:
        return '       Continue'
      case RT_STOP:
        return '       Stop'
      default:
        return `       RT 0x${b0.toString(16)}`
    }
  }
  const status = b0 & 0xf0
  const channel = (b0 & 0x0f) + 1
  const d1 = bytes[1] ?? 0
  const d2 = bytes[2] ?? 0
  const ch = `ch${String(channel).padStart(2, ' ')}`
  switch (status) {
    case STATUS_NOTE_ON:
      return d2 === 0
        ? `${ch}  NoteOff ${noteName(d1).padEnd(4)} (${d1})`
        : `${ch}  NoteOn  ${noteName(d1).padEnd(4)} (${d1}) v${d2}`
    case STATUS_NOTE_OFF:
      return `${ch}  NoteOff ${noteName(d1).padEnd(4)} (${d1})`
    case STATUS_CONTROL_CHANGE:
      return `${ch}  CC      #${String(d1).padStart(3, ' ')}      = ${d2}`
    default: {
      const hex = Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(' ')
      return `${ch}  raw     ${hex}`
    }
  }
}

const MAX_LINES = 200

export class MidiLogView {
  private lines: string[] = []
  private dirty = false

  constructor(private readonly el: HTMLElement) {}

  push(bytes: Uint8Array): void {
    // Clock ticks at 24 PPQ would flood the log — suppress.
    if (bytes.length === 1 && bytes[0] === RT_CLOCK) return
    const ts = new Date()
    const time =
      String(ts.getMinutes()).padStart(2, '0') +
      ':' +
      String(ts.getSeconds()).padStart(2, '0') +
      '.' +
      String(ts.getMilliseconds()).padStart(3, '0')
    this.lines.push(`${time}  ${formatMidi(bytes)}`)
    if (this.lines.length > MAX_LINES) {
      this.lines.splice(0, this.lines.length - MAX_LINES)
    }
    if (!this.dirty) {
      this.dirty = true
      requestAnimationFrame(() => this.flush())
    }
  }

  clear(): void {
    this.lines = []
    this.el.textContent = ''
  }

  private flush(): void {
    this.dirty = false
    this.el.textContent = this.lines.join('\n')
    this.el.scrollTop = this.el.scrollHeight
  }
}
