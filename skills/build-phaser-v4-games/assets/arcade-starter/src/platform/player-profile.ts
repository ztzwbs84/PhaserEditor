export const PLAYER_PROFILE_SCHEMA_VERSION = 2
export const PLAYER_PROFILE_STORAGE_KEY = '__PACKAGE_NAME__:player-profile'

export type ProfileLoadStatus =
  | 'new'
  | 'current'
  | 'migrated'
  | 'recovered-backup'
  | 'reset-corrupt'
  | 'reset-unsupported-version'
  | 'unavailable'

export interface PlayerProfile {
  schemaVersion: 2
  settings: {
    muted: boolean
  }
  stats: {
    runsStarted: number
    runsCompleted: number
    wins: number
    losses: number
    bestProgress: number
  }
}

export interface ProfileStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

type RunObservation = {
  phase: 'playing' | 'paused' | 'game-over'
  terminalKind: 'success' | 'failure' | null
  progress: number
}

type LegacyProfileV1 = {
  schemaVersion: 1
  muted: boolean
  bestProgress: number
}

const emptyProfile = (): PlayerProfile => ({
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  settings: { muted: false },
  stats: { runsStarted: 0, runsCompleted: 0, wins: 0, losses: 0, bestProgress: 0 }
})

const isNonNegativeInteger = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0
const isNonNegativeNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

function isCurrentProfile(value: unknown): value is PlayerProfile {
  if (!value || typeof value !== 'object') return false
  const profile = value as Partial<PlayerProfile>
  const settings = profile.settings as PlayerProfile['settings'] | undefined
  const stats = profile.stats as PlayerProfile['stats'] | undefined
  return profile.schemaVersion === PLAYER_PROFILE_SCHEMA_VERSION
    && typeof settings?.muted === 'boolean'
    && isNonNegativeInteger(stats?.runsStarted)
    && isNonNegativeInteger(stats?.runsCompleted)
    && isNonNegativeInteger(stats?.wins)
    && isNonNegativeInteger(stats?.losses)
    && isNonNegativeNumber(stats?.bestProgress)
    && stats.runsCompleted === stats.wins + stats.losses
    && stats.runsCompleted <= stats.runsStarted
}

function isLegacyProfileV1(value: unknown): value is LegacyProfileV1 {
  if (!value || typeof value !== 'object') return false
  const profile = value as Partial<LegacyProfileV1>
  return profile.schemaVersion === 1
    && typeof profile.muted === 'boolean'
    && isNonNegativeNumber(profile.bestProgress)
}

function browserStorage(): ProfileStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export class PlayerProfileStore {
  private profile = emptyProfile()
  private runActive = false
  private statusValue: ProfileLoadStatus = 'new'
  private writable = true

  constructor(
    private readonly storage: ProfileStorage | null = browserStorage(),
    readonly storageKey = PLAYER_PROFILE_STORAGE_KEY
  ) {
    this.load()
  }

  get status(): ProfileLoadStatus {
    return this.statusValue
  }

  snapshot(): PlayerProfile {
    return structuredClone(this.profile)
  }

  setMuted(muted: boolean): void {
    if (this.profile.settings.muted === muted) return
    this.profile.settings.muted = muted
    this.persist()
  }

  beginRun(): void {
    this.runActive = true
    this.profile.stats.runsStarted += 1
    this.persist()
  }

  observeRun(observation: RunObservation): void {
    if (observation.phase !== 'game-over') return
    if (!this.runActive || !observation.terminalKind) return
    this.runActive = false
    this.profile.stats.runsCompleted += 1
    this.profile.stats[observation.terminalKind === 'success' ? 'wins' : 'losses'] += 1
    this.profile.stats.bestProgress = Math.max(this.profile.stats.bestProgress, Math.max(0, observation.progress))
    this.persist()
  }

  private load(): void {
    if (!this.storage) {
      this.statusValue = 'unavailable'
      return
    }
    let raw: string | null
    try {
      raw = this.storage.getItem(this.storageKey)
    } catch {
      this.statusValue = 'unavailable'
      return
    }
    if (raw === null) return

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      if (!this.recoverBackup(raw)) this.reject(raw, 'reset-corrupt')
      return
    }
    if (isCurrentProfile(parsed)) {
      this.profile = structuredClone(parsed)
      this.statusValue = 'current'
      return
    }
    if (isLegacyProfileV1(parsed)) {
      this.profile.settings.muted = parsed.muted
      this.profile.stats.bestProgress = parsed.bestProgress
      this.statusValue = 'migrated'
      this.persist()
      return
    }
    const version = parsed && typeof parsed === 'object' ? (parsed as { schemaVersion?: unknown }).schemaVersion : undefined
    if (typeof version === 'number' && version > PLAYER_PROFILE_SCHEMA_VERSION) {
      this.writable = false
      this.reject(raw, 'reset-unsupported-version', true)
    } else if (!this.recoverBackup(raw)) {
      this.reject(raw, 'reset-corrupt')
    }
  }

  private recoverBackup(rejectedRaw: string): boolean {
    try {
      const backupRaw = this.storage?.getItem(`${this.storageKey}:backup`)
      if (!backupRaw) return false
      const backup = JSON.parse(backupRaw) as unknown
      if (!isCurrentProfile(backup)) return false
      this.profile = structuredClone(backup)
      this.statusValue = 'recovered-backup'
      this.storage?.setItem(`${this.storageKey}:rejected`, JSON.stringify({ status: 'reset-corrupt', raw: rejectedRaw.slice(0, 4096) }))
      this.storage?.setItem(this.storageKey, JSON.stringify(this.profile))
      return true
    } catch {
      return false
    }
  }

  private reject(raw: string, status: Extract<ProfileLoadStatus, `reset-${string}`>, preserveCurrent = false): void {
    this.profile = emptyProfile()
    this.statusValue = status
    try {
      this.storage?.setItem(`${this.storageKey}:rejected`, JSON.stringify({ status, raw: raw.slice(0, 4096) }))
      if (!preserveCurrent) this.storage?.setItem(this.storageKey, JSON.stringify(this.profile))
    } catch {
      this.statusValue = 'unavailable'
    }
  }

  private persist(): void {
    if (!this.storage || !this.writable) return
    try {
      const previous = this.storage.getItem(this.storageKey)
      if (previous) {
        try {
          if (isCurrentProfile(JSON.parse(previous))) this.storage.setItem(`${this.storageKey}:backup`, previous)
        } catch {
          // Never promote malformed data into the recovery slot.
        }
      }
      this.storage.setItem(this.storageKey, JSON.stringify(this.profile))
    } catch {
      this.statusValue = 'unavailable'
    }
  }
}
