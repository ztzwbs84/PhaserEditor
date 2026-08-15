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
  private readonly objective = this.requiredOutput('puzzle-objective')
  private readonly stage = this.requiredOutput('puzzle-stage')
  private readonly attempts = this.requiredOutput('puzzle-attempts')
  private readonly score = this.requiredOutput('puzzle-score')

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

  setSnapshot(snapshot: RunSnapshot): void {
    this.progress.value = String(snapshot.puzzles)
    this.auxiliary.value = String(snapshot.puzzle)
    this.pressure.value = String(snapshot.attempts)
    this.objective.value = snapshot.phase === 'game-over'
      ? snapshot.terminalKind === 'success' ? 'Archive cleared' : 'Attempts exhausted'
      : snapshot.phase === 'paused' ? 'Position paused' : snapshot.motif
    this.stage.value = `${snapshot.puzzle} / ${RUN_COMPLETION_TARGET}`
    this.attempts.value = String(snapshot.attempts)
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
