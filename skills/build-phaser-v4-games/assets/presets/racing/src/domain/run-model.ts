export type RunPhase = 'playing' | 'paused' | 'game-over'
export type RunOutcome = 'lap-complete' | 'chassis-wrecked' | null
export type RunTerminalKind = 'success' | 'failure' | null

export const RUN_COMPLETION_TARGET = 4

export interface RunSnapshot {
  phase: RunPhase
  outcome: RunOutcome
  terminalKind: RunTerminalKind
  checkpoints: number
  chassis: number
  score: number
  streak: number
  lap: number
}

export class RunModel {
  private checkpointsValue = 0
  private chassisValue: number
  private scoreValue = 0
  private streakValue = 1
  private phaseValue: RunPhase = 'playing'
  private outcomeValue: RunOutcome = null
  private terminalKindValue: RunTerminalKind = null

  constructor(
    private readonly maximumChassis = 3,
    private readonly completionTarget = RUN_COMPLETION_TARGET
  ) {
    this.chassisValue = maximumChassis
  }

  get phase(): RunPhase { return this.phaseValue }

  reset(): void {
    this.checkpointsValue = 0
    this.chassisValue = this.maximumChassis
    this.scoreValue = 0
    this.streakValue = 1
    this.phaseValue = 'playing'
    this.outcomeValue = null
    this.terminalKindValue = null
  }

  clearCheckpoint(): number {
    if (this.phaseValue !== 'playing') return 0
    const points = 150 * this.streakValue
    this.checkpointsValue += 1
    this.scoreValue += points
    this.streakValue = Math.min(8, this.streakValue + 1)
    if (this.checkpointsValue >= this.completionTarget) this.endRun('lap-complete', 'success')
    return points
  }

  crash(): boolean {
    if (this.phaseValue !== 'playing') return false
    this.chassisValue = Math.max(0, this.chassisValue - 1)
    this.streakValue = 1
    if (this.chassisValue === 0) this.endRun('chassis-wrecked', 'failure')
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
      checkpoints: this.checkpointsValue,
      chassis: this.chassisValue,
      score: this.scoreValue,
      streak: this.streakValue,
      lap: Math.max(1, Math.ceil(this.checkpointsValue / this.completionTarget))
    }
  }

  private endRun(outcome: Exclude<RunOutcome, null>, terminalKind: Exclude<RunTerminalKind, null>): void {
    this.phaseValue = 'game-over'
    this.outcomeValue = outcome
    this.terminalKindValue = terminalKind
  }
}
