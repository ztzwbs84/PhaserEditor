export type RunPhase = 'playing' | 'paused' | 'game-over'
export type RunOutcome = 'target-reached' | 'shield-depleted' | 'time-expired' | null
export type RunTerminalKind = 'success' | 'failure' | null

export const RUN_COMPLETION_TARGET = 150

export interface RunSnapshot {
  phase: RunPhase
  outcome: RunOutcome
  terminalKind: RunTerminalKind
  score: number
  shield: number
  level: number
  combo: number
  remainingSeconds: number
}

export class RunModel {
  private elapsedMs = 0
  private invulnerableMs = 0
  private scoreValue = 0
  private shieldValue = 3
  private comboValue = 1
  private phaseValue: RunPhase = 'playing'
  private outcomeValue: RunOutcome = null
  private terminalKindValue: RunTerminalKind = null

  constructor(
    private readonly durationMs = 60_000,
    private readonly maximumShield = 3,
    private readonly completionTarget = RUN_COMPLETION_TARGET
  ) {
    this.shieldValue = maximumShield
  }

  get phase(): RunPhase {
    return this.phaseValue
  }

  reset(): void {
    this.elapsedMs = 0
    this.invulnerableMs = 0
    this.scoreValue = 0
    this.shieldValue = this.maximumShield
    this.comboValue = 1
    this.phaseValue = 'playing'
    this.outcomeValue = null
    this.terminalKindValue = null
  }

  update(deltaMs: number): void {
    if (this.phaseValue !== 'playing') return
    const safeDelta = Math.max(0, Math.min(deltaMs, 100))
    this.elapsedMs = Math.min(this.durationMs, this.elapsedMs + safeDelta)
    this.invulnerableMs = Math.max(0, this.invulnerableMs - safeDelta)
    if (this.elapsedMs >= this.durationMs) this.endRun('time-expired', 'failure')
  }

  collect(): number {
    if (this.phaseValue !== 'playing') return 0
    const points = 10 * this.comboValue
    this.scoreValue += points
    this.comboValue = Math.min(8, this.comboValue + 1)
    if (this.scoreValue >= this.completionTarget) this.endRun('target-reached', 'success')
    return points
  }

  damage(): boolean {
    if (this.phaseValue !== 'playing' || this.invulnerableMs > 0) return false
    this.shieldValue = Math.max(0, this.shieldValue - 1)
    this.comboValue = 1
    this.invulnerableMs = 1_000
    if (this.shieldValue === 0) this.endRun('shield-depleted', 'failure')
    return true
  }

  togglePause(): RunPhase {
    if (this.phaseValue === 'game-over') return this.phaseValue
    this.phaseValue = this.phaseValue === 'paused' ? 'playing' : 'paused'
    return this.phaseValue
  }

  snapshot(): RunSnapshot {
    return {
      phase: this.phaseValue,
      outcome: this.outcomeValue,
      terminalKind: this.terminalKindValue,
      score: this.scoreValue,
      shield: this.shieldValue,
      level: 1 + Math.floor(this.scoreValue / 150),
      combo: this.comboValue,
      remainingSeconds: Math.max(0, Math.ceil((this.durationMs - this.elapsedMs) / 1_000))
    }
  }

  private endRun(outcome: Exclude<RunOutcome, null>, terminalKind: Exclude<RunTerminalKind, null>): void {
    this.phaseValue = 'game-over'
    this.outcomeValue = outcome
    this.terminalKindValue = terminalKind
  }
}
