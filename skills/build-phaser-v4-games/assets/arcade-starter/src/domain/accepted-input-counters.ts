export class AcceptedInputCounters<Mode extends string> {
  private readonly counts: Record<Mode, number>

  constructor(modes: readonly Mode[]) {
    if (modes.length === 0 || new Set(modes).size !== modes.length) {
      throw new Error('Accepted input modes must be unique and non-empty.')
    }
    this.counts = Object.fromEntries(modes.map((mode) => [mode, 0])) as Record<Mode, number>
  }

  accept(mode: Mode): void {
    this.counts[mode] += 1
  }

  reset(): void {
    for (const mode of Object.keys(this.counts) as Mode[]) this.counts[mode] = 0
  }

  snapshot(): Record<Mode, number> {
    return { ...this.counts }
  }
}
