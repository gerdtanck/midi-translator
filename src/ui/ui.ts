import { MidiIO, type MidiPortInfo } from '../midi/midi-io'
import {
  CC_ALL_NOTES_OFF,
  MD_TRIGGER_CHANNEL,
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
import { type PresetMap, loadPresets, savePresets } from '../state/presets'
import type { TrackConfig } from '../state/track-config'
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
        <label>Preset
          <select id="preset"></select>
        </label>
        <button id="presetSave" title="Overwrite the selected preset with the current configuration">Save</button>
        <button id="presetSaveAs" title="Save the current configuration as a new preset">Save As…</button>
        <button id="presetDelete" title="Delete the selected preset">Delete</button>
        <button id="panic" class="panic">Panic</button>
      </div>
      <div id="deviceWarn"></div>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>On</th>
            <th>Paraphony</th>
            <th title="Keep released slots at their last pitch instead of resetting to unison">Latch</th>
            <th title="Retrigger the MD trigger note on every new key press">Retrig</th>
            <th title="Add this track to Polygroup A (true polyphony voice pool)">Poly-A</th>
            <th title="Add this track to Polygroup B (true polyphony voice pool)">Poly-B</th>
            <th title="Hold DEC at 127 while notes are held; drop to RELEASE on note-off (ADSR S+R emulation)">Sustain</th>
            <th title="DEC value (0–127) sent when no notes are held">Release</th>
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
  const panicBtn = root.querySelector<HTMLButtonElement>('#panic')!
  const presetSel = root.querySelector<HTMLSelectElement>('#preset')!
  const presetSaveBtn = root.querySelector<HTMLButtonElement>('#presetSave')!
  const presetSaveAsBtn = root.querySelector<HTMLButtonElement>('#presetSaveAs')!
  const presetDeleteBtn = root.querySelector<HTMLButtonElement>('#presetDelete')!
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
  const presets: PresetMap = loadPresets()
  const io = new MidiIO()
  const engines = new Map<number, TrackEngine>()
  const rows = new Map<number, HTMLTableRowElement>()

  const persist = (): void => saveSettings(settings)

  // Engines are the single source of truth for voice state.
  // The router reads the current routing snapshot each message.
  const router = new Router(() => {
    const enabled = settings.tracks.filter((t) => t.enabled)
    const engineByTrackId = new Map<number, TrackEngine>()
    for (const t of enabled) {
      const e = engines.get(t.trackId)
      if (e) engineByTrackId.set(t.trackId, e)
    }
    return {
      engineByTrackId,
      polygroupAMembers: enabled.filter((t) => t.polygroup === 'A').map((t) => t.trackId),
      polygroupBMembers: enabled.filter((t) => t.polygroup === 'B').map((t) => t.trackId),
      nonMembers: enabled
        .filter((t) => t.polygroup === null)
        .map((t) => engineByTrackId.get(t.trackId))
        .filter((e): e is TrackEngine => e !== undefined),
    }
  })

  const ensureEngine = (trackId: number, poly: Polyphony): TrackEngine => {
    const cfg = settings.tracks[trackId]!
    const existing = engines.get(trackId)
    if (existing && existing.allocator.polyphony === poly) {
      existing.latch = cfg.latch
      existing.retrigger = cfg.retrigger
      existing.sustain = cfg.sustain
      existing.release = cfg.release
      return existing
    }
    existing?.forceRelease()
    const e = new TrackEngine(trackId, poly, io)
    e.latch = cfg.latch
    e.retrigger = cfg.retrigger
    // Assign sustain fields directly (not via setSustain) so engine creation does not emit MIDI.
    e.sustain = cfg.sustain
    e.release = cfg.release
    engines.set(trackId, e)
    return e
  }

  const removeEngine = (trackId: number): void => {
    const e = engines.get(trackId)
    if (e) {
      router.forgetTrack(trackId)
      e.forceRelease()
      engines.delete(trackId)
    }
  }

  const renderPresetSelect = (): void => {
    presetSel.innerHTML = ''
    const placeholder = document.createElement('option')
    placeholder.value = ''
    placeholder.textContent = '— preset —'
    presetSel.appendChild(placeholder)
    for (const name of Object.keys(presets)) {
      const o = document.createElement('option')
      o.value = name
      o.textContent = name
      if (name === settings.lastPreset) o.selected = true
      presetSel.appendChild(o)
    }
    const hasTarget = !!settings.lastPreset && settings.lastPreset in presets
    presetSaveBtn.disabled = !hasTarget
    presetDeleteBtn.disabled = !hasTarget
  }

  const cloneTracks = (tracks: TrackConfig[]): TrackConfig[] =>
    tracks.map((t) => ({ ...t }))

  const applyPreset = (tracks: TrackConfig[]): void => {
    // Tear down all engines so any held voices and polygroup state clear cleanly.
    for (const trackId of Array.from(engines.keys())) removeEngine(trackId)
    router.reset()
    for (let i = 0; i < settings.tracks.length; i++) {
      settings.tracks[i] = { ...tracks[i]!, trackId: i }
    }
    for (const cfg of settings.tracks) {
      if (cfg.enabled) ensureEngine(cfg.trackId, cfg.polyphony)
    }
    renderAllRows()
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
    router.reset()
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
    io.onMessage((bytes) => {
      logIn.push(bytes)
      // Pass realtime (clock/start/continue/stop) straight through to the MD.
      if (bytes.length >= 1 && isRealtimeByte(bytes[0]!)) {
        io.sendRealtime(bytes[0]!)
        return
      }
      router.onMidiMessage(bytes)
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
        onToggleRetrigger: (trackId, retrigger) => {
          const c = settings.tracks[trackId]!
          c.retrigger = retrigger
          const e = engines.get(trackId)
          if (e) e.retrigger = retrigger
          persist()
          renderRow(trackId)
        },
        onToggleSustain: (trackId, sustain) => {
          const c = settings.tracks[trackId]!
          c.sustain = sustain
          // setSustain emits DEC (=127 if held, else release; on toggle-off: release).
          engines.get(trackId)?.setSustain(sustain)
          persist()
          renderRow(trackId)
        },
        onChangeRelease: (trackId, release) => {
          const c = settings.tracks[trackId]!
          c.release = release
          // setRelease emits DEC immediately if sustain on and idle; otherwise stores for next release.
          engines.get(trackId)?.setRelease(release)
          persist()
          renderRow(trackId)
        },
        onSetPolygroup: (trackId, value) => {
          const c = settings.tracks[trackId]!
          if (c.polygroup === value) return
          // Dispatch any dangling polygroup voice on this track before changing membership,
          // so we don't leak a stuck trigger note on the device.
          router.forgetTrack(trackId)
          c.polygroup = value
          persist()
          renderRow(trackId)
        },
      })
      rows.set(cfg.trackId, tr)
      tbody.appendChild(tr)
      if (cfg.enabled) ensureEngine(cfg.trackId, cfg.polyphony)
    }
    renderAllRows()
    renderPresetSelect()

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

  presetSel.addEventListener('change', () => {
    const name = presetSel.value
    if (!name) {
      settings.lastPreset = null
      persist()
      renderPresetSelect()
      return
    }
    const preset = presets[name]
    if (!preset) {
      renderPresetSelect()
      return
    }
    settings.lastPreset = name
    applyPreset(preset)
    persist()
    renderPresetSelect()
    log.textContent = `Loaded preset "${name}".`
  })

  presetSaveBtn.addEventListener('click', () => {
    const name = settings.lastPreset
    if (!name) return
    presets[name] = cloneTracks(settings.tracks)
    savePresets(presets)
    log.textContent = `Saved preset "${name}".`
  })

  presetSaveAsBtn.addEventListener('click', () => {
    const raw = window.prompt('Preset name:', settings.lastPreset ?? '')
    if (raw === null) return
    const name = raw.trim()
    if (!name) return
    if (name in presets && !window.confirm(`Overwrite existing preset "${name}"?`)) return
    presets[name] = cloneTracks(settings.tracks)
    savePresets(presets)
    settings.lastPreset = name
    persist()
    renderPresetSelect()
    log.textContent = `Saved preset "${name}".`
  })

  presetDeleteBtn.addEventListener('click', () => {
    const name = settings.lastPreset
    if (!name || !(name in presets)) return
    if (!window.confirm(`Delete preset "${name}"?`)) return
    delete presets[name]
    savePresets(presets)
    settings.lastPreset = null
    persist()
    renderPresetSelect()
    log.textContent = `Deleted preset "${name}".`
  })
}
