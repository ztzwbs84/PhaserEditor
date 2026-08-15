export type RunPhase = 'playing' | 'paused' | 'game-over'
export type RunOutcome = 'sector-cleared' | 'shield-depleted' | null
export type RunTerminalKind = 'success' | 'failure' | null

export const RUN_COMPLETION_TARGET = 4

export interface RunSnapshot {
  phase: RunPhase
  outcome: RunOutcome
  terminalKind: RunTerminalKind
  kills: number
  score: number
  shield: number
  chain: number
  wave: number
}

export class RunModel {
  private invulnerableMs = 0
  private killsValue = 0
  private scoreValue = 0
  private shieldValue: number
  private chainValue = 1
  private phaseValue: RunPhase = 'playing'
  private outcomeValue: RunOutcome = null
  private terminalKindValue: RunTerminalKind = null

  constructor(
    private readonly maximumShield = 3,
    private readonly completionTarget = RUN_COMPLETION_TARGET
  ) {
    this.shieldValue = maximumShield
  }

  get phase(): RunPhase { return this.phaseValue }

  reset(): void {
    this.invulnerableMs = 0
    this.killsValue = 0
    this.scoreValue = 0
    this.shieldValue = this.maximumShield
    this.chainValue = 1
    this.phaseValue = 'playing'
    this.outcomeValue = null
    this.terminalKindValue = null
  }

  update(deltaMs: number): void {
    if (this.phaseValue !== 'playing') return
    this.invulnerableMs = Math.max(0, this.invulnerableMs - Math.max(0, Math.min(deltaMs, 100)))
  }

  destroyRaider(): number {
    if (this.phaseValue !== 'playing') return 0
    const points = 100 * this.chainValue
    this.killsValue += 1
    this.scoreValue += points
    this.chainValue = Math.min(8, this.chainValue + 1)
    if (this.killsValue >= this.completionTarget) this.endRun('sector-cleared', 'success')
    return points
  }

  damage(): boolean {
    if (this.phaseValue !== 'playing' || this.invulnerableMs > 0) return false
    this.shieldValue = Math.max(0, this.shieldValue - 1)
    this.chainValue = 1
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
      kills: this.killsValue,
      score: this.scoreValue,
      shield: this.shieldValue,
      chain: this.chainValue,
      wave: 1 + Math.floor(this.killsValue / 2)
    }
  }

  private endRun(outcome: Exclude<RunOutcome, null>, terminalKind: Exclude<RunTerminalKind, null>): void {
    this.phaseValue = 'game-over'
    this.outcomeValue = outcome
    this.terminalKindValue = terminalKind
  }
}
