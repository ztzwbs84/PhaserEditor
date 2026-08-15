export type RunPhase = 'playing' | 'paused' | 'game-over'
export type RunOutcome = 'wall-cleared' | 'balls-depleted' | null
export type RunTerminalKind = 'success' | 'failure' | null

export const RUN_COMPLETION_TARGET = 4

export interface RunSnapshot {
  phase: RunPhase
  outcome: RunOutcome
  terminalKind: RunTerminalKind
  bricks: number
  balls: number
  score: number
  chain: number
  round: number
}

export class RunModel {
  private bricksValue = 0
  private ballsValue: number
  private scoreValue = 0
  private chainValue = 1
  private phaseValue: RunPhase = 'playing'
  private outcomeValue: RunOutcome = null
  private terminalKindValue: RunTerminalKind = null

  constructor(
    private readonly maximumBalls = 3,
    private readonly completionTarget = RUN_COMPLETION_TARGET
  ) {
    this.ballsValue = maximumBalls
  }

  get phase(): RunPhase { return this.phaseValue }

  reset(): void {
    this.bricksValue = 0
    this.ballsValue = this.maximumBalls
    this.scoreValue = 0
    this.chainValue = 1
    this.phaseValue = 'playing'
    this.outcomeValue = null
    this.terminalKindValue = null
  }

  breakBrick(): number {
    if (this.phaseValue !== 'playing') return 0
    const points = 100 * this.chainValue
    this.bricksValue += 1
    this.scoreValue += points
    this.chainValue = Math.min(8, this.chainValue + 1)
    if (this.bricksValue >= this.completionTarget) this.endRun('wall-cleared', 'success')
    return points
  }

  dropBall(): boolean {
    if (this.phaseValue !== 'playing') return false
    this.ballsValue = Math.max(0, this.ballsValue - 1)
    this.chainValue = 1
    if (this.ballsValue === 0) this.endRun('balls-depleted', 'failure')
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
      bricks: this.bricksValue,
      balls: this.ballsValue,
      score: this.scoreValue,
      chain: this.chainValue,
      round: 1 + Math.floor(this.bricksValue / 2)
    }
  }

  private endRun(outcome: Exclude<RunOutcome, null>, terminalKind: Exclude<RunTerminalKind, null>): void {
    this.phaseValue = 'game-over'
    this.outcomeValue = outcome
    this.terminalKindValue = terminalKind
  }
}
