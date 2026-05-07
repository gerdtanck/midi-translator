import { MidiIO, type MidiPortInfo } from '../midi/midi-io'
import {
  CC_ALL_NOTES_OFF,
  MD_TRIGGER_CHANNEL,
  RT_CLOCK,
  isRealtimeByte,
} from '../midi/midi-constants'
import { TRIGGER_NOTES } from '../midi/md-tables'
import { TrackEngine } from '../core/track-engine'
import { Router } from '../core/router'
import type { Polyphony } from '../core/voice-allocator'
import {
  type PersistedSettings,
  loadSettings,
  saveSettings,
} from '../state/persistence'
import { createTrackRow, updateTrackRow } from './track-row'
import { MidiLogView } from './midi-log'

export function mountUi(root: HTMLElement): void {
  root.innerHTML = `
    <h1>Machinedrum MIDI Translator</h1>
    <div id="boot">
      <button id="enable">Enable MIDI</button>
      <div id="bootError"></div>
    </div>
    <div id="panel" hidden>
      <div class="bar">
        <label>Input
          <select id="input"></select>
        </label>
        <label>Output
          <select id="output"></select>
        </label>
        <span><span class="sustain-dot" id="sustainDot"></span>Sustain</span>
        <span><span class="sustain-dot" id="clockDot"></span>Clock</span>
        <button id="panic" class="panic">Panic</button>
      </div>
      <div id="deviceWarn"></div>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>On</th>
            <th>Poly</th>
            <th>Trigger</th>
            <th>Group</th>
            <th title="Keep released slots at their last pitch instead of resetting to unison">Latch</th>
            <th>Voices</th>
          </tr>
        </thead>
        <tbody id="tbody"></tbody>
      </table>
      <div class="status-line" id="log"></div>
      <div class="midi-log-bar">
        <span class="midi-log-title">MIDI Monitor</span>
        <button id="logClear" class="log-clear">Clear</button>
      </div>
      <div class="midi-log-container">
        <div class="midi-log-panel">
          <div class="midi-log-header">Incoming (from input)</div>
          <pre class="midi-log" id="logIn"></pre>
        </div>
        <div class="midi-log-panel">
          <div class="midi-log-header">Outgoing (to Machinedrum)</div>
          <pre class="midi-log" id="logOut"></pre>
        </div>
      </div>
    </div>
  `

  const enableBtn = root.querySelector<HTMLButtonElement>('#enable')!
  const bootError = root.querySelector<HTMLDivElement>('#bootError')!
  const panel = root.querySelector<HTMLDivElement>('#panel')!
  const inputSel = root.querySelector<HTMLSelectElement>('#input')!
  const outputSel = root.querySelector<HTMLSelectElement>('#output')!
  const tbody = root.querySelector<HTMLTableSectionElement>('#tbody')!
  const sustainDot = root.querySelector<HTMLSpanElement>('#sustainDot')!
  const clockDot = root.querySelector<HTMLSpanElement>('#clockDot')!
  const panicBtn = root.querySelector<HTMLButtonElement>('#panic')!
  const deviceWarn = root.querySelector<HTMLDivElement>('#deviceWarn')!
  const log = root.querySelector<HTMLDivElement>('#log')!
  const logInEl = root.querySelector<HTMLPreElement>('#logIn')!
  const logOutEl = root.querySelector<HTMLPreElement>('#logOut')!
  const logClearBtn = root.querySelector<HTMLButtonElement>('#logClear')!
  const logIn = new MidiLogView(logInEl)
  const logOut = new MidiLogView(logOutEl)
  logClearBtn.addEventListener('click', () => {
    logIn.clear()
    logOut.clear()
  })

  if (!MidiIO.isSupported()) {
    enableBtn.disabled = true
    bootError.innerHTML = `<div class="error">Web MIDI is not available in this browser. Use Chrome or Edge.</div>`
    return
  }

  const settings: PersistedSettings = loadSettings()
  const io = new MidiIO()
  const engines = new Map<number, TrackEngine>()
  const rows = new Map<number, HTMLTableRowElement>()

  const persist = (): void => saveSettings(settings)

  // Engines are the single source of truth for voice state.
  // The router reads the current set each message.
  const router = new Router(() =>
    settings.tracks
      .filter((t) => t.enabled)
      .map((t) => engines.get(t.trackId)!)
      .filter(Boolean)
  )

  const ensureEngine = (trackId: number, poly: Polyphony): TrackEngine => {
    const cfg = settings.tracks[trackId]!
    const existing = engines.get(trackId)
    if (existing && existing.allocator.polyphony === poly) {
      existing.latch = cfg.latch
      return existing
    }
    existing?.forceRelease()
    const e = new TrackEngine(trackId, poly, io)
    e.latch = cfg.latch
    engines.set(trackId, e)
    return e
  }

  const removeEngine = (trackId: number): void => {
    const e = engines.get(trackId)
    if (e) {
      e.forceRelease()
      engines.delete(trackId)
    }
  }

  const renderRow = (trackId: number): void => {
    const cfg = settings.tracks[trackId]!
    const tr = rows.get(trackId)
    if (!tr) return
    updateTrackRow(tr, cfg, engines.get(trackId))
  }

  const renderAllRows = (): void => {
    for (const t of settings.tracks) renderRow(t.trackId)
  }

  const renderDeviceSelect = (
    el: HTMLSelectElement,
    ports: MidiPortInfo[],
    selectedId: string | null
  ): void => {
    el.innerHTML = ''
    const placeholder = document.createElement('option')
    placeholder.value = ''
    placeholder.textContent = '— select —'
    el.appendChild(placeholder)
    for (const p of ports) {
      const o = document.createElement('option')
      o.value = p.id
      o.textContent = p.name
      if (p.id === selectedId) o.selected = true
      el.appendChild(o)
    }
  }

  const refreshDevices = (): void => {
    renderDeviceSelect(inputSel, io.listInputs(), io.getSelectedInputId())
    renderDeviceSelect(outputSel, io.listOutputs(), io.getSelectedOutputId())
    updateDeviceWarning()
  }

  const updateDeviceWarning = (): void => {
    const inId = io.getSelectedInputId()
    const outId = io.getSelectedOutputId()
    if (inId && outId && inId === outId) {
      deviceWarn.innerHTML = `<div class="error">Input and output are the same device — this creates a feedback loop on loopback ports. OK for testing only.</div>`
    } else {
      deviceWarn.innerHTML = ''
    }
  }

  const panic = (): void => {
    // MD CC 123 (All Notes Off) on ch1..ch4 + NoteOff for every trigger note on ch1.
    for (let ch = 1; ch <= 4; ch++) io.sendCc(ch, CC_ALL_NOTES_OFF, 0)
    for (const n of TRIGGER_NOTES) io.sendNoteOff(MD_TRIGGER_CHANNEL, n)
    for (const e of engines.values()) e.forceRelease()
    renderAllRows()
    log.textContent = 'Panic sent.'
  }

  enableBtn.addEventListener('click', async () => {
    try {
      await io.init()
    } catch (err) {
      bootError.innerHTML = `<div class="error">${String(err)}</div>`
      return
    }
    let clockTimeout: number | null = null
    const pulseClock = (): void => {
      clockDot.classList.add('on')
      if (clockTimeout !== null) clearTimeout(clockTimeout)
      clockTimeout = window.setTimeout(() => clockDot.classList.remove('on'), 250)
    }

    io.onMessage((bytes) => {
      logIn.push(bytes)
      // Pass realtime (clock/start/continue/stop) straight through to the MD.
      if (bytes.length >= 1 && isRealtimeByte(bytes[0]!)) {
        io.sendRealtime(bytes[0]!)
        if (bytes[0] === RT_CLOCK) pulseClock()
        return
      }
      router.onMidiMessage(bytes)
      sustainDot.classList.toggle('on', router.getSustain())
      renderAllRows()
    })
    io.onOutgoing((bytes) => logOut.push(bytes))
    io.onDeviceChange(refreshDevices)
    refreshDevices()

    // Re-apply persisted device selections where possible.
    if (settings.inputId && io.listInputs().some((p) => p.id === settings.inputId)) {
      io.selectInput(settings.inputId)
      inputSel.value = settings.inputId
    }
    if (settings.outputId && io.listOutputs().some((p) => p.id === settings.outputId)) {
      io.selectOutput(settings.outputId)
      outputSel.value = settings.outputId
    }
    updateDeviceWarning()

    // Build rows from persisted config and spin up engines for enabled tracks.
    for (const cfg of settings.tracks) {
      const tr = createTrackRow(cfg, {
        onToggleEnabled: (trackId, enabled) => {
          const c = settings.tracks[trackId]!
          c.enabled = enabled
          if (enabled) {
            ensureEngine(trackId, c.polyphony)
          } else {
            removeEngine(trackId)
          }
          persist()
          renderRow(trackId)
        },
        onChangePolyphony: (trackId, poly) => {
          const c = settings.tracks[trackId]!
          if (c.polyphony === poly) return
          c.polyphony = poly
          if (c.enabled) ensureEngine(trackId, poly)
          persist()
          renderRow(trackId)
        },
        onToggleLatch: (trackId, latch) => {
          const c = settings.tracks[trackId]!
          c.latch = latch
          const e = engines.get(trackId)
          if (e) e.latch = latch
          persist()
          renderRow(trackId)
        },
      })
      rows.set(cfg.trackId, tr)
      tbody.appendChild(tr)
      if (cfg.enabled) ensureEngine(cfg.trackId, cfg.polyphony)
    }
    renderAllRows()

    panel.hidden = false
    enableBtn.hidden = true
  })

  inputSel.addEventListener('change', () => {
    const id = inputSel.value || null
    io.selectInput(id)
    settings.inputId = id
    persist()
    updateDeviceWarning()
  })
  outputSel.addEventListener('change', () => {
    const id = outputSel.value || null
    // Panic on the previous output before switching, to leave nothing stuck.
    panic()
    io.selectOutput(id)
    settings.outputId = id
    persist()
    updateDeviceWarning()
  })
  panicBtn.addEventListener('click', panic)
}
