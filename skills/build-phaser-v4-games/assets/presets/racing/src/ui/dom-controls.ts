import { RUN_COMPLETION_TARGET, type RunSnapshot } from '../domain/run-model'
import { GAME_EVENTS, type GameServices } from '../services'

export class DomControls {
  private readonly pauseButton = this.requiredButton('pause-button')
  private readonly soundButton = this.requiredButton('sound-button')
  private readonly restartButton = this.requiredButton('restart-button')
  private readonly status = document.querySelector<HTMLElement>('#game-status')
  private readonly progress = this.requiredOutput('progress-value')
  private readonly auxiliary = this.requiredOutput('auxiliary-value')
  private readonly pressure = this.requiredOutput('pressure-value')
  private readonly objective = this.requiredOutput('racing-objective')
  private readonly gate = this.requiredOutput('racing-gate')
  private readonly speed = this.requiredOutput('racing-speed')
  private readonly score = this.requiredOutput('racing-score')

  private readonly onPause = () => this.services.bus.emit(GAME_EVENTS.pause)
  private readonly onRestart = () => {
    this.setPaused(false)
    this.services.bus.emit(GAME_EVENTS.restart)
  }
  private readonly onSound = () => {
    const interaction = Number(document.documentElement.dataset.qualitySettingsInteractions ?? '0') + 1
    document.documentElement.dataset.qualitySettingsInteractions = String(interaction)
    const muted = !this.services.profile.snapshot().settings.muted
    this.services.setMuted(muted)
    this.services.bus.emit(GAME_EVENTS.mute, muted)
    this.setMuted(muted)
  }
  private readonly unlockAudio = () => {
    void this.services.audio.unlock()
    window.removeEventListener('pointerdown', this.unlockAudio)
    window.removeEventListener('keydown', this.unlockAudio)
  }

  constructor(private readonly services: GameServices) {
    this.pauseButton.addEventListener('click', this.onPause)
    this.restartButton.addEventListener('click', this.onRestart)
    this.soundButton.addEventListener('click', this.onSound)
    window.addEventListener('pointerdown', this.unlockAudio, { once: true })
    window.addEventListener('keydown', this.unlockAudio, { once: true })
    this.setMuted(services.profile.snapshot().settings.muted)
    document.documentElement.dataset.qualitySettingsReady = 'true'
    document.documentElement.dataset.qualitySettingsInteractions = '0'
  }

  setPaused(paused: boolean): void {
    this.pauseButton.textContent = paused ? 'Resume' : 'Pause'
    this.pauseButton.setAttribute('aria-pressed', String(paused))
  }

  announce(message: string): void {
    if (this.status) this.status.textContent = message
  }

  setSnapshot(snapshot: RunSnapshot, speed: number): void {
    this.progress.value = String(snapshot.checkpoints)
    this.auxiliary.value = String(snapshot.lap)
    this.pressure.value = String(snapshot.chassis)
    this.objective.value = snapshot.phase === 'game-over'
      ? snapshot.terminalKind === 'success' ? 'Lap complete' : 'Chassis wrecked'
      : snapshot.phase === 'paused' ? 'Race paused' : `Accelerate to Gate ${Math.min(snapshot.checkpoints + 1, RUN_COMPLETION_TARGET)}`
    this.gate.value = `${Math.min(snapshot.checkpoints + 1, RUN_COMPLETION_TARGET)} / ${RUN_COMPLETION_TARGET}`
    this.speed.value = String(Math.round(speed))
    this.score.value = String(snapshot.score)
  }

  destroy(): void {
    delete document.documentElement.dataset.qualitySettingsReady
    this.pauseButton.removeEventListener('click', this.onPause)
    this.restartButton.removeEventListener('click', this.onRestart)
    this.soundButton.removeEventListener('click', this.onSound)
    window.removeEventListener('pointerdown', this.unlockAudio)
    window.removeEventListener('keydown', this.unlockAudio)
  }

  private setMuted(muted: boolean): void {
    this.soundButton.textContent = muted ? 'Sound off' : 'Sound on'
    this.soundButton.setAttribute('aria-pressed', String(muted))
  }

  private requiredButton(id: string): HTMLButtonElement {
    const button = document.querySelector<HTMLButtonElement>(`#${id}`)
    if (!button) throw new Error(`Missing required control #${id}`)
    return button
  }

  private requiredOutput(id: string): HTMLOutputElement {
    const output = document.querySelector<HTMLOutputElement>(`#${id}`)
    if (!output) throw new Error(`Missing required status #${id}`)
    return output
  }
}
