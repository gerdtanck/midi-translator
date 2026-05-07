import type { TrackConfig } from '../state/track-config'
import { POLYPHONY_CHOICES } from '../state/track-config'
import type { TrackEngine } from '../core/track-engine'
import type { Polyphony } from '../core/voice-allocator'
import { groupChannel, triggerNoteForTrack } from '../midi/md-tables'

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
// Scientific pitch: MIDI 60 = C4.
const midiNoteName = (n: number): string => {
  const octave = Math.floor(n / 12) - 1
  const name = NOTE_NAMES[n % 12]
  return `${name}${octave}`
}

export interface TrackRowCallbacks {
  onToggleEnabled: (trackId: number, enabled: boolean) => void
  onChangePolyphony: (trackId: number, poly: Polyphony) => void
  onToggleLatch: (trackId: number, latch: boolean) => void
}

export function createTrackRow(
  config: TrackConfig,
  callbacks: TrackRowCallbacks
): HTMLTableRowElement {
  const tr = document.createElement('tr')
  tr.dataset.trackId = String(config.trackId)

  const tdNum = document.createElement('td')
  tdNum.textContent = String(config.trackId + 1)

  const tdEnabled = document.createElement('td')
  const cb = document.createElement('input')
  cb.type = 'checkbox'
  cb.checked = config.enabled
  cb.addEventListener('change', () =>
    callbacks.onToggleEnabled(config.trackId, cb.checked)
  )
  tdEnabled.appendChild(cb)

  const tdPoly = document.createElement('td')
  const polyGroup = document.createElement('div')
  polyGroup.className = 'poly-group'
  for (const p of POLYPHONY_CHOICES) {
    const btn = document.createElement('button')
    btn.textContent = String(p)
    btn.dataset.poly = String(p)
    if (p === config.polyphony) btn.classList.add('selected')
    btn.addEventListener('click', () =>
      callbacks.onChangePolyphony(config.trackId, p)
    )
    polyGroup.appendChild(btn)
  }
  tdPoly.appendChild(polyGroup)

  const tdTrigger = document.createElement('td')
  tdTrigger.textContent = midiNoteName(triggerNoteForTrack(config.trackId))

  const tdGroup = document.createElement('td')
  tdGroup.textContent = `ch${groupChannel(config.trackId)}`

  const tdLatch = document.createElement('td')
  const latchCb = document.createElement('input')
  latchCb.type = 'checkbox'
  latchCb.className = 'latch-cb'
  latchCb.checked = config.latch
  latchCb.title = 'Keep released slots at their last pitch instead of resetting to unison'
  latchCb.addEventListener('change', () =>
    callbacks.onToggleLatch(config.trackId, latchCb.checked)
  )
  tdLatch.appendChild(latchCb)

  const tdLeds = document.createElement('td')
  const leds = document.createElement('span')
  leds.className = 'voice-leds'
  for (let i = 0; i < 4; i++) {
    const led = document.createElement('span')
    led.className = 'led'
    leds.appendChild(led)
  }
  tdLeds.appendChild(leds)

  tr.appendChild(tdNum)
  tr.appendChild(tdEnabled)
  tr.appendChild(tdPoly)
  tr.appendChild(tdTrigger)
  tr.appendChild(tdGroup)
  tr.appendChild(tdLatch)
  tr.appendChild(tdLeds)

  updateTrackRow(tr, config, undefined)
  return tr
}

export function updateTrackRow(
  tr: HTMLTableRowElement,
  config: TrackConfig,
  engine: TrackEngine | undefined
): void {
  tr.classList.toggle('disabled', !config.enabled)

  const cb = tr.querySelector<HTMLInputElement>('input[type="checkbox"]:not(.latch-cb)')!
  if (cb.checked !== config.enabled) cb.checked = config.enabled

  const latchCb = tr.querySelector<HTMLInputElement>('input.latch-cb')!
  if (latchCb.checked !== config.latch) latchCb.checked = config.latch

  const polyButtons = tr.querySelectorAll<HTMLButtonElement>('.poly-group button')
  for (const b of polyButtons) {
    b.classList.toggle('selected', Number(b.dataset.poly) === config.polyphony)
  }

  const ledNodes = tr.querySelectorAll<HTMLSpanElement>('.led')
  const voices = engine?.allocator.voices ?? []
  for (let i = 0; i < 4; i++) {
    const led = ledNodes[i]!
    // Only show LEDs for the slots this polyphony uses; hide the rest.
    if (i < config.polyphony) {
      led.classList.remove('hidden')
      led.classList.toggle('on', i < voices.length)
    } else {
      led.classList.add('hidden')
      led.classList.remove('on')
    }
  }
}
