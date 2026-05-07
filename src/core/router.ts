import {
  STATUS_CONTROL_CHANGE,
  STATUS_NOTE_OFF,
  STATUS_NOTE_ON,
  CC_SUSTAIN,
} from '../midi/midi-constants'
import type { TrackEngine } from './track-engine'

export class Router {
  private sustainDown = false

  // Returns currently-enabled engines. Lets the app toggle tracks without re-constructing the router.
  constructor(private readonly getEngines: () => TrackEngine[]) {}

  getSustain(): boolean {
    return this.sustainDown
  }

  onMidiMessage(bytes: Uint8Array): void {
    if (bytes.length < 2) return
    const status = bytes[0]!
    const ch = status & 0x0f
    if (ch !== 0) return // input is MIDI ch1 only
    const type = status & 0xf0
    const d1 = bytes[1]!
    const d2 = bytes[2] ?? 0

    if (type === STATUS_NOTE_ON && d2 > 0) {
      for (const e of this.getEngines()) {
        e.allocator.noteOn(d1, d2)
        e.allocator.finalize()
        e.update(true)
      }
    } else if (type === STATUS_NOTE_OFF || (type === STATUS_NOTE_ON && d2 === 0)) {
      for (const e of this.getEngines()) {
        e.allocator.noteOff(d1, this.sustainDown)
        e.allocator.finalize()
        e.update(false)
      }
    } else if (type === STATUS_CONTROL_CHANGE && d1 === CC_SUSTAIN) {
      const wasDown = this.sustainDown
      const nowDown = d2 >= 64
      this.sustainDown = nowDown
      if (wasDown && !nowDown) {
        for (const e of this.getEngines()) {
          e.allocator.pedalUp()
          e.allocator.finalize()
          e.update(false)
        }
      }
    }
  }
}
