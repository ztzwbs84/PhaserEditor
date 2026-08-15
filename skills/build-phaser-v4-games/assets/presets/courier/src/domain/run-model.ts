export type RunPhase = 'playing' | 'paused' | 'game-over'
export type Destination = 'north' | 'east' | 'south' | 'west'
export type RunOutcome = 'deliveries-complete' | 'time-expired' | 'extinguished' | null
export type RunTerminalKind = 'success' | 'failure' | null

export const RUN_COMPLETION_TARGET = 3

export interface CargoSnapshot {
  destination: Destination
  remainingSeconds: number
  heatRatio: number
}

export interface RunSnapshot {
  phase: RunPhase
  outcome: RunOutcome
  terminalKind: RunTerminalKind
  score: number
  integrity: number
  streak: number
  bestStreak: number
  deliveries: number
  remainingSeconds: number
  cargo: CargoSnapshot | null
}

export interface DeliveryResult {
  accepted: boolean
  points: number
}

export interface DamageResult {
  applied: boolean
  lostCargo: boolean
  ended: boolean
}

const CARGO_LIFETIME_MS = 11_000

export class RunModel {
  private elapsedMs = 0
  private invulnerableMs = 0
  private scoreValue = 0
  private integrityValue: number
  private streakValue = 0
  private bestStreakValue = 0
  private deliveriesValue = 0
  private phaseValue: RunPhase = 'playing'
  private outcomeValue: RunOutcome = null
  private terminalKindValue: RunTerminalKind = null
  private cargoDestination: Destination | null = null
  private cargoRemainingMs = 0

  constructor(
    private readonly durationMs = 75_000,
    private readonly maximumIntegrity = 3,
    private readonly completionTarget = RUN_COMPLETION_TARGET
  ) {
    this.integrityValue = maximumIntegrity
  }

  get phase(): RunPhase {
    return this.phaseValue
  }

  reset(): void {
    this.elapsedMs = 0
    this.invulnerableMs = 0
    this.scoreValue = 0
    this.integrityValue = this.maximumIntegrity
    this.streakValue = 0
    this.bestStreakValue = 0
    this.deliveriesValue = 0
    this.phaseValue = 'playing'
    this.outcomeValue = null
    this.terminalKindValue = null
    this.cargoDestination = null
    this.cargoRemainingMs = 0
  }

  update(deltaMs: number): void {
    if (this.phaseValue !== 'playing') return
    const safeDelta = Math.max(0, Math.min(deltaMs, 100))
    this.elapsedMs = Math.min(this.durationMs, this.elapsedMs + safeDelta)
    this.invulnerableMs = Math.max(0, this.invulnerableMs - safeDelta)
    if (this.cargoDestination) {
      this.cargoRemainingMs = Math.max(0, this.cargoRemainingMs - safeDelta)
      if (this.cargoRemainingMs === 0) this.applyDamage()
    }
    if (this.elapsedMs >= this.durationMs && this.phaseValue === 'playing') this.endRun('time-expired', 'failure')
  }

  pickup(destination: Destination): boolean {
    if (this.phaseValue !== 'playing' || this.cargoDestination) return false
    this.cargoDestination = destination
    this.cargoRemainingMs = CARGO_LIFETIME_MS
    return true
  }

  deliver(destination: Destination): DeliveryResult {
    if (this.phaseValue !== 'playing' || this.cargoDestination !== destination) return { accepted: false, points: 0 }
    this.streakValue = Math.min(9, this.streakValue + 1)
    this.bestStreakValue = Math.max(this.bestStreakValue, this.streakValue)
    const points = 90 + this.streakValue * 30 + Math.floor(this.cargoRemainingMs / 1_000) * 8
    this.scoreValue += points
    this.deliveriesValue += 1
    this.cargoDestination = null
    this.cargoRemainingMs = 0
    if (this.deliveriesValue >= this.completionTarget) this.endRun('deliveries-complete', 'success')
    return { accepted: true, points }
  }

  damage(): DamageResult {
    if (this.phaseValue !== 'playing' || this.invulnerableMs > 0) return { applied: false, lostCargo: false, ended: false }
    const lostCargo = this.cargoDestination !== null
    this.applyDamage()
    return { applied: true, lostCargo, ended: this.integrityValue === 0 }
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
      integrity: this.integrityValue,
      streak: this.streakValue,
      bestStreak: this.bestStreakValue,
      deliveries: this.deliveriesValue,
      remainingSeconds: Math.max(0, Math.ceil((this.durationMs - this.elapsedMs) / 1_000)),
      cargo: this.cargoDestination
        ? {
            destination: this.cargoDestination,
            remainingSeconds: Math.max(0, this.cargoRemainingMs / 1_000),
            heatRatio: this.cargoRemainingMs / CARGO_LIFETIME_MS
          }
        : null
    }
  }

  private applyDamage(): void {
    this.integrityValue = Math.max(0, this.integrityValue - 1)
    this.streakValue = 0
    this.invulnerableMs = 1_100
    this.cargoDestination = null
    this.cargoRemainingMs = 0
    if (this.integrityValue === 0) this.endRun('extinguished', 'failure')
  }

  private endRun(outcome: Exclude<RunOutcome, null>, terminalKind: Exclude<RunTerminalKind, null>): void {
    this.phaseValue = 'game-over'
    this.outcomeValue = outcome
    this.terminalKindValue = terminalKind
  }
}
