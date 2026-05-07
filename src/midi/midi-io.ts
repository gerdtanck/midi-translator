import {
  STATUS_NOTE_ON,
  STATUS_NOTE_OFF,
  STATUS_CONTROL_CHANGE,
} from './midi-constants'

export type MidiMessageHandler = (bytes: Uint8Array) => void
export type DeviceChangeHandler = () => void

export interface MidiPortInfo {
  id: string
  name: string
}

export class MidiIO {
  private access: MIDIAccess | null = null
  private currentInput: MIDIInput | null = null
  private currentOutput: MIDIOutput | null = null
  private messageHandler: MidiMessageHandler | null = null
  private outgoingHandler: MidiMessageHandler | null = null
  private deviceChangeHandlers: DeviceChangeHandler[] = []

  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator
  }

  async init(): Promise<void> {
    if (!MidiIO.isSupported()) {
      throw new Error(
        'Web MIDI is not available. Use a Chromium-based browser (Chrome or Edge).'
      )
    }
    this.access = await navigator.requestMIDIAccess({ sysex: false })
    this.access.onstatechange = () => this.notifyDeviceChange()
  }

  listInputs(): MidiPortInfo[] {
    if (!this.access) return []
    return Array.from(this.access.inputs.values()).map((p) => ({
      id: p.id,
      name: p.name ?? p.id,
    }))
  }

  listOutputs(): MidiPortInfo[] {
    if (!this.access) return []
    return Array.from(this.access.outputs.values()).map((p) => ({
      id: p.id,
      name: p.name ?? p.id,
    }))
  }

  selectInput(id: string | null): void {
    if (this.currentInput) this.currentInput.onmidimessage = null
    this.currentInput = null
    if (!this.access || !id) return
    const port = this.access.inputs.get(id) ?? null
    this.currentInput = port
    if (port && this.messageHandler) {
      port.onmidimessage = (e) => {
        if (e.data) this.messageHandler?.(e.data)
      }
    }
  }

  selectOutput(id: string | null): void {
    this.currentOutput = null
    if (!this.access || !id) return
    this.currentOutput = this.access.outputs.get(id) ?? null
  }

  getSelectedInputId(): string | null {
    return this.currentInput?.id ?? null
  }

  getSelectedOutputId(): string | null {
    return this.currentOutput?.id ?? null
  }

  onMessage(handler: MidiMessageHandler): void {
    this.messageHandler = handler
    if (this.currentInput) {
      this.currentInput.onmidimessage = (e) => {
        if (e.data) handler(e.data)
      }
    }
  }

  onOutgoing(handler: MidiMessageHandler): void {
    this.outgoingHandler = handler
  }

  onDeviceChange(handler: DeviceChangeHandler): void {
    this.deviceChangeHandlers.push(handler)
  }

  private notifyDeviceChange(): void {
    for (const h of this.deviceChangeHandlers) h()
  }

  sendNoteOn(channel1based: number, note: number, velocity: number): void {
    this.sendRaw(STATUS_NOTE_ON | (channel1based - 1), note, velocity)
  }

  sendNoteOff(channel1based: number, note: number): void {
    this.sendRaw(STATUS_NOTE_OFF | (channel1based - 1), note, 0)
  }

  sendCc(channel1based: number, cc: number, value: number): void {
    this.sendRaw(STATUS_CONTROL_CHANGE | (channel1based - 1), cc, value)
  }

  sendRealtime(byte: number): void {
    if (!this.currentOutput) return
    try {
      this.currentOutput.send([byte])
      this.outgoingHandler?.(new Uint8Array([byte]))
    } catch {
      // port may have disconnected between select and send — swallow
    }
  }

  private sendRaw(status: number, d1: number, d2: number): void {
    if (!this.currentOutput) return
    try {
      this.currentOutput.send([status, d1, d2])
      this.outgoingHandler?.(new Uint8Array([status, d1, d2]))
    } catch {
      // port may have disconnected between select and send — swallow
    }
  }
}
