import type { Polygroup, TrackConfig } from '../state/track-config'
import { POLYPHONY_CHOICES } from '../state/track-config'
import type { TrackEngine } from '../core/track-engine'
import type { Polyphony } from '../core/voice-allocator'

const clampReleaseInput = (raw: string, fallback: number): number => {
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  const r = Math.round(n)
  if (r < 0) return 0
  if (r > 127) return 127
  return r
}

export interface TrackRowCallbacks {
  onToggleEnabled: (trackId: number, enabled: boolean) => void
  onChangePolyphony: (trackId: number, poly: Polyphony) => void
  onToggleLatch: (trackId: number, latch: boolean) => void
  onToggleRetrigger: (trackId: number, retrigger: boolean) => void
  onToggleSustain: (trackId: number, sustain: boolean) => void
  onChangeRelease: (trackId: number, release: number) => void
  onSetPolygroup: (trackId: number, value: Polygroup) => void
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

  const tdRetrigger = document.createElement('td')
  const retrigCb = document.createElement('input')
  retrigCb.type = 'checkbox'
  retrigCb.className = 'retrig-cb'
  retrigCb.checked = config.retrigger
  retrigCb.title = 'Retrigger the MD trigger note on every new key press'
  retrigCb.addEventListener('change', () =>
    callbacks.onToggleRetrigger(config.trackId, retrigCb.checked)
  )
  tdRetrigger.appendChild(retrigCb)

  const tdPgA = document.createElement('td')
  const pgACb = document.createElement('input')
  pgACb.type = 'checkbox'
  pgACb.className = 'pg-a-cb'
  pgACb.checked = config.polygroup === 'A'
  pgACb.title = 'Add this track to Polygroup A — each key press is dynamically allocated to one of A\'s tracks for true polyphony'
  pgACb.addEventListener('change', () =>
    callbacks.onSetPolygroup(config.trackId, pgACb.checked ? 'A' : null)
  )
  tdPgA.appendChild(pgACb)

  const tdPgB = document.createElement('td')
  const pgBCb = document.createElement('input')
  pgBCb.type = 'checkbox'
  pgBCb.className = 'pg-b-cb'
  pgBCb.checked = config.polygroup === 'B'
  pgBCb.title = 'Add this track to Polygroup B — each key press is dynamically allocated to one of B\'s tracks for true polyphony'
  pgBCb.addEventListener('change', () =>
    callbacks.onSetPolygroup(config.trackId, pgBCb.checked ? 'B' : null)
  )
  tdPgB.appendChild(pgBCb)

  const tdSustain = document.createElement('td')
  const sustainCb = document.createElement('input')
  sustainCb.type = 'checkbox'
  sustainCb.className = 'sustain-cb'
  sustainCb.checked = config.sustain
  sustainCb.title = 'Hold DEC at 127 while notes are held; drop to RELEASE on note-off (ADSR S+R emulation)'
  sustainCb.addEventListener('change', () =>
    callbacks.onToggleSustain(config.trackId, sustainCb.checked)
  )
  tdSustain.appendChild(sustainCb)

  const tdRelease = document.createElement('td')
  const releaseInput = document.createElement('input')
  releaseInput.type = 'number'
  releaseInput.min = '0'
  releaseInput.max = '127'
  releaseInput.step = '1'
  releaseInput.className = 'release-input'
  releaseInput.value = String(config.release)
  releaseInput.title = 'DEC value (0–127) sent when no notes are held'
  // Commit on blur/enter (via 'change') so we don't spam MIDI on every keystroke.
  releaseInput.addEventListener('change', () => {
    const v = clampReleaseInput(releaseInput.value, config.release)
    if (String(v) !== releaseInput.value) releaseInput.value = String(v)
    callbacks.onChangeRelease(config.trackId, v)
  })
  tdRelease.appendChild(releaseInput)

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
  tr.appendChild(tdLatch)
  tr.appendChild(tdRetrigger)
  tr.appendChild(tdPgA)
  tr.appendChild(tdPgB)
  tr.appendChild(tdSustain)
  tr.appendChild(tdRelease)
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

  const cb = tr.querySelector<HTMLInputElement>(
    'input[type="checkbox"]:not(.latch-cb):not(.retrig-cb):not(.sustain-cb):not(.pg-a-cb):not(.pg-b-cb)'
  )!
  if (cb.checked !== config.enabled) cb.checked = config.enabled

  const latchCb = tr.querySelector<HTMLInputElement>('input.latch-cb')!
  if (latchCb.checked !== config.latch) latchCb.checked = config.latch

  const retrigCb = tr.querySelector<HTMLInputElement>('input.retrig-cb')!
  if (retrigCb.checked !== config.retrigger) retrigCb.checked = config.retrigger

  const sustainCb = tr.querySelector<HTMLInputElement>('input.sustain-cb')!
  if (sustainCb.checked !== config.sustain) sustainCb.checked = config.sustain

  const pgACb = tr.querySelector<HTMLInputElement>('input.pg-a-cb')!
  const pgAExpected = config.polygroup === 'A'
  if (pgACb.checked !== pgAExpected) pgACb.checked = pgAExpected

  const pgBCb = tr.querySelector<HTMLInputElement>('input.pg-b-cb')!
  const pgBExpected = config.polygroup === 'B'
  if (pgBCb.checked !== pgBExpected) pgBCb.checked = pgBExpected

  const releaseInput = tr.querySelector<HTMLInputElement>('input.release-input')!
  const releaseStr = String(config.release)
  // Skip overwrite while the user is actively editing — they may be mid-keystroke.
  if (releaseInput.value !== releaseStr && document.activeElement !== releaseInput) {
    releaseInput.value = releaseStr
  }

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
