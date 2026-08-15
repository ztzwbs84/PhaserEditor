export type RunPhase = 'playing' | 'paused' | 'game-over'
export type RunOutcome = 'relics-complete' | 'time-expired' | 'hearts-depleted' | null
export type RunTerminalKind = 'success' | 'failure' | null

export const RUN_COMPLETION_TARGET = 3

export interface RunSnapshot {
  phase: RunPhase
  outcome: RunOutcome
  terminalKind: RunTerminalKind
  relics: number
  score: number
  hearts: number
  chain: number
  bestChain: number
  remainingSeconds: number
}

export interface DamageResult {
  applied: boolean
  ended: boolean
}

export class RunModel {
  private elapsedMs = 0
  private invulnerableMs = 0
  private relicsValue = 0
  private scoreValue = 0
  private heartsValue: number
  private chainValue = 1
  private bestChainValue = 1
  private phaseValue: RunPhase = 'playing'
  private outcomeValue: RunOutcome = null
  private terminalKindValue: RunTerminalKind = null

  constructor(
    private readonly durationMs = 75_000,
    private readonly maximumHearts = 3,
    private readonly completionTarget = RUN_COMPLETION_TARGET
  ) {
    this.heartsValue = maximumHearts
  }

  get phase(): RunPhase {
    return this.phaseValue
  }

  reset(): void {
    this.elapsedMs = 0
    this.invulnerableMs = 0
    this.relicsValue = 0
    this.scoreValue = 0
    this.heartsValue = this.maximumHearts
    this.chainValue = 1
    this.bestChainValue = 1
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

  collect(heightBonus: number): number {
    if (this.phaseValue !== 'playing') return 0
    const points = 80 * this.chainValue + Math.max(0, Math.round(heightBonus))
    this.relicsValue += 1
    this.scoreValue += points
    this.chainValue = Math.min(8, this.chainValue + 1)
    this.bestChainValue = Math.max(this.bestChainValue, this.chainValue)
    if (this.relicsValue >= this.completionTarget) this.endRun('relics-complete', 'success')
    return points
  }

  damage(): DamageResult {
    if (this.phaseValue !== 'playing' || this.invulnerableMs > 0) return { applied: false, ended: false }
    this.heartsValue = Math.max(0, this.heartsValue - 1)
    this.chainValue = 1
    this.invulnerableMs = 1_100
    const ended = this.heartsValue === 0
    if (ended) this.endRun('hearts-depleted', 'failure')
    return { applied: true, ended }
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
      relics: this.relicsValue,
      score: this.scoreValue,
      hearts: this.heartsValue,
      chain: this.chainValue,
      bestChain: this.bestChainValue,
      remainingSeconds: Math.max(0, Math.ceil((this.durationMs - this.elapsedMs) / 1_000))
    }
  }

  private endRun(outcome: Exclude<RunOutcome, null>, terminalKind: Exclude<RunTerminalKind, null>): void {
    this.phaseValue = 'game-over'
    this.outcomeValue = outcome
    this.terminalKindValue = terminalKind
  }
}
