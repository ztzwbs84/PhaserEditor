export type RunPhase = 'playing' | 'paused' | 'game-over'
export type RunOutcome = 'sector-defended' | 'core-breached' | null
export type RunTerminalKind = 'success' | 'failure' | null

export const RUN_COMPLETION_TARGET = 4

export interface RunSnapshot {
  phase: RunPhase
  outcome: RunOutcome
  terminalKind: RunTerminalKind
  intercepts: number
  core: number
  score: number
  chain: number
  wave: number
}

export class RunModel {
  private interceptsValue = 0
  private coreValue: number
  private scoreValue = 0
  private chainValue = 1
  private phaseValue: RunPhase = 'playing'
  private outcomeValue: RunOutcome = null
  private terminalKindValue: RunTerminalKind = null

  constructor(
    private readonly maximumCore = 3,
    private readonly completionTarget = RUN_COMPLETION_TARGET
  ) {
    this.coreValue = maximumCore
  }

  get phase(): RunPhase { return this.phaseValue }

  reset(): void {
    this.interceptsValue = 0
    this.coreValue = this.maximumCore
    this.scoreValue = 0
    this.chainValue = 1
    this.phaseValue = 'playing'
    this.outcomeValue = null
    this.terminalKindValue = null
  }

  intercept(): number {
    if (this.phaseValue !== 'playing') return 0
    const points = 125 * this.chainValue
    this.interceptsValue += 1
    this.scoreValue += points
    this.chainValue = Math.min(8, this.chainValue + 1)
    if (this.interceptsValue >= this.completionTarget) this.endRun('sector-defended', 'success')
    return points
  }

  breach(): boolean {
    if (this.phaseValue !== 'playing') return false
    this.coreValue = Math.max(0, this.coreValue - 1)
    this.chainValue = 1
    if (this.coreValue === 0) this.endRun('core-breached', 'failure')
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
      intercepts: this.interceptsValue,
      core: this.coreValue,
      score: this.scoreValue,
      chain: this.chainValue,
      wave: 1 + Math.floor(this.interceptsValue / 2)
    }
  }

  private endRun(outcome: Exclude<RunOutcome, null>, terminalKind: Exclude<RunTerminalKind, null>): void {
    this.phaseValue = 'game-over'
    this.outcomeValue = outcome
    this.terminalKindValue = terminalKind
  }
}
