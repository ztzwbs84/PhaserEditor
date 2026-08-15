import Phaser from 'phaser'
import type { RunSnapshot } from './domain/run-model'
import { PlayerProfileStore } from './platform/player-profile'

export const GAME_EVENTS = {
  snapshot: 'run:snapshot',
  pause: 'run:pause',
  restart: 'run:restart',
  mute: 'audio:mute',
  paused: 'ui:paused'
} as const

export class AudioService {
  private context: AudioContext | null = null
  private mutedValue: boolean

  constructor(initialMuted = false) { this.mutedValue = initialMuted }

  get muted(): boolean { return this.mutedValue }

  async unlock(): Promise<void> {
    this.context ??= new AudioContext()
    if (this.context.state === 'suspended') await this.context.resume()
  }

  setMuted(muted: boolean): void { this.mutedValue = muted }
  playPickup(streak: number): void { this.playTone(260 + Math.min(streak, 8) * 35, 0.07, 'sine') }
  playImpact(): void { this.playTone(92, 0.14, 'sawtooth') }
  playDelivery(streak: number): void {
    this.playTone(420 + Math.min(streak, 9) * 28, 0.13, 'triangle')
    window.setTimeout(() => this.playTone(620 + Math.min(streak, 9) * 22, 0.12, 'sine'), 70)
  }
  playEnd(completed: boolean): void { this.playTone(completed ? 360 : 116, 0.28, completed ? 'triangle' : 'sawtooth') }

  async destroy(): Promise<void> {
    if (this.context) await this.context.close().catch(() => undefined)
    this.context = null
  }

  private playTone(frequency: number, durationSeconds: number, type: OscillatorType): void {
    if (this.mutedValue || !this.context || this.context.state !== 'running') return
    const oscillator = this.context.createOscillator()
    const gain = this.context.createGain()
    oscillator.type = type
    oscillator.frequency.value = frequency
    gain.gain.setValueAtTime(0.05, this.context.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.0001, this.context.currentTime + durationSeconds)
    oscillator.connect(gain).connect(this.context.destination)
    oscillator.start()
    oscillator.stop(this.context.currentTime + durationSeconds)
  }
}

export class GameServices {
  readonly bus = new Phaser.Events.EventEmitter()
  readonly profile: PlayerProfileStore
  readonly audio: AudioService
  constructor() {
    this.profile = new PlayerProfileStore()
    this.audio = new AudioService(this.profile.snapshot().settings.muted)
    this.publishProfile()
  }
  setMuted(muted: boolean): void {
    this.audio.setMuted(muted)
    this.profile.setMuted(muted)
    this.publishProfile()
  }
  beginRun(): void {
    this.profile.beginRun()
    this.publishProfile()
  }
  publishSnapshot(snapshot: RunSnapshot): void {
    this.profile.observeRun({ phase: snapshot.phase, terminalKind: snapshot.terminalKind, progress: snapshot.deliveries })
    this.publishProfile()
    this.bus.emit(GAME_EVENTS.snapshot, snapshot)
  }
  async destroy(): Promise<void> {
    this.bus.removeAllListeners()
    await this.audio.destroy()
  }
  private publishProfile(): void {
    document.documentElement.dataset.qualityProfileStorageKey = this.profile.storageKey
    document.documentElement.dataset.qualityProfileSchemaVersion = String(this.profile.snapshot().schemaVersion)
    document.documentElement.dataset.qualityProfileLoadStatus = this.profile.status
    document.documentElement.dataset.qualityPlayerProfile = JSON.stringify(this.profile.snapshot())
    document.documentElement.dataset.qualityAudioMuted = String(this.audio.muted)
  }
}
