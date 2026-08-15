import { describe, expect, it } from 'vitest'
import { PLAYER_PROFILE_SCHEMA_VERSION, PlayerProfileStore, type ProfileStorage } from './player-profile'

class MemoryStorage implements ProfileStorage {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

describe('PlayerProfileStore', () => {
  it('persists settings and records each run outcome once', () => {
    const storage = new MemoryStorage()
    const store = new PlayerProfileStore(storage, 'profile')
    store.setMuted(true)
    store.beginRun()
    store.observeRun({ phase: 'playing', terminalKind: null, progress: 0 })
    store.observeRun({ phase: 'paused', terminalKind: null, progress: 20 })
    store.observeRun({ phase: 'game-over', terminalKind: 'success', progress: 150 })
    store.observeRun({ phase: 'game-over', terminalKind: 'success', progress: 150 })

    expect(store.snapshot()).toEqual({
      schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
      settings: { muted: true },
      stats: { runsStarted: 1, runsCompleted: 1, wins: 1, losses: 0, bestProgress: 150 }
    })
    expect(new PlayerProfileStore(storage, 'profile').snapshot()).toEqual(store.snapshot())
  })

  it('starts another run after a terminal observation', () => {
    const store = new PlayerProfileStore(new MemoryStorage(), 'profile')
    store.beginRun()
    store.observeRun({ phase: 'playing', terminalKind: null, progress: 0 })
    store.observeRun({ phase: 'game-over', terminalKind: 'failure', progress: 30 })
    store.beginRun()
    store.observeRun({ phase: 'playing', terminalKind: null, progress: 0 })
    expect(store.snapshot().stats).toEqual({ runsStarted: 2, runsCompleted: 1, wins: 0, losses: 1, bestProgress: 30 })
  })

  it('migrates the trusted version 1 shape', () => {
    const storage = new MemoryStorage()
    storage.setItem('profile', JSON.stringify({ schemaVersion: 1, muted: true, bestProgress: 42 }))
    const store = new PlayerProfileStore(storage, 'profile')
    expect(store.status).toBe('migrated')
    expect(store.snapshot()).toEqual({
      schemaVersion: 2,
      settings: { muted: true },
      stats: { runsStarted: 0, runsCompleted: 0, wins: 0, losses: 0, bestProgress: 42 }
    })
  })

  it.each([
    ['malformed JSON', '{'],
    ['invalid counters', JSON.stringify({ schemaVersion: 2, settings: { muted: false }, stats: { runsStarted: 0, runsCompleted: 1, wins: 1, losses: 0, bestProgress: 1 } })]
  ])('quarantines %s and resets safely', (_label, raw) => {
    const storage = new MemoryStorage()
    storage.setItem('profile', raw)
    const store = new PlayerProfileStore(storage, 'profile')
    expect(store.status).toBe('reset-corrupt')
    expect(store.snapshot().stats.runsStarted).toBe(0)
    expect(JSON.parse(storage.getItem('profile:rejected') ?? '{}')).toMatchObject({ status: 'reset-corrupt', raw })
  })

  it('does not interpret an unknown future schema', () => {
    const storage = new MemoryStorage()
    const future = JSON.stringify({ schemaVersion: 99, settings: { muted: true }, entitlements: ['paid'] })
    storage.setItem('profile', future)
    const store = new PlayerProfileStore(storage, 'profile')
    expect(store.status).toBe('reset-unsupported-version')
    expect(store.snapshot().settings.muted).toBe(false)
    store.observeRun({ phase: 'playing', terminalKind: null, progress: 0 })
    store.setMuted(true)
    expect(storage.getItem('profile')).toBe(future)
  })

  it('recovers a previous valid profile when the current write is corrupt', () => {
    const storage = new MemoryStorage()
    const first = new PlayerProfileStore(storage, 'profile')
    first.setMuted(true)
    first.beginRun()
    first.observeRun({ phase: 'playing', terminalKind: null, progress: 0 })
    storage.setItem('profile', '{broken')
    const recovered = new PlayerProfileStore(storage, 'profile')
    expect(recovered.status).toBe('recovered-backup')
    expect(recovered.snapshot().settings.muted).toBe(true)
  })

  it('keeps an in-memory profile when storage is unavailable', () => {
    const store = new PlayerProfileStore(null, 'profile')
    store.setMuted(true)
    store.beginRun()
    store.observeRun({ phase: 'playing', terminalKind: null, progress: 0 })
    expect(store.status).toBe('unavailable')
    expect(store.snapshot()).toMatchObject({ settings: { muted: true }, stats: { runsStarted: 1 } })
  })

  it('counts an explicit restart without completing the abandoned run', () => {
    const store = new PlayerProfileStore(new MemoryStorage(), 'profile')
    store.beginRun()
    store.beginRun()
    store.observeRun({ phase: 'game-over', terminalKind: 'success', progress: 12 })
    expect(store.snapshot().stats).toEqual({ runsStarted: 2, runsCompleted: 1, wins: 1, losses: 0, bestProgress: 12 })
  })
})
