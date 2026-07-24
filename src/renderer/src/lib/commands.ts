import { ContributionRegistry, type ContributionConflict } from './contribution-registry'

export interface Command {
  id: string
  title: string
  shortcut?: string
  enabled?: () => boolean
  execute: () => void | Promise<void>
}

export class CommandRegistry {
  private readonly commands = new ContributionRegistry<Command>()

  register(command: Command): () => void {
    return this.registerContribution('core', command, Number.MAX_SAFE_INTEGER)
  }

  registerContribution(owner: string, command: Command, priority = 0): () => void {
    return this.commands.register({ owner, id: command.id, priority, value: command })
  }

  get(id: string): Command | undefined {
    return this.commands.get(id)?.value
  }

  list(): Command[] {
    return this.commands.list().map((entry) => entry.value)
  }

  conflicts(): ContributionConflict<Command>[] {
    return this.commands.conflicts()
  }

  subscribe(listener: () => void): () => void {
    return this.commands.subscribe(listener)
  }

  async execute(id: string): Promise<void> {
    const command = this.get(id)
    if (!command || command.enabled?.() === false) return
    await command.execute()
  }
}

export const commandRegistry = new CommandRegistry()

export function shortcutMatches(event: KeyboardEvent, shortcut: string): boolean {
  const tokens = shortcut.toLocaleLowerCase().split('+')
  const key = tokens.at(-1)
  const platformModifier = event.ctrlKey || event.metaKey
  return (tokens.includes('ctrl') ? platformModifier : !platformModifier)
    && (tokens.includes('shift') === event.shiftKey)
    && (tokens.includes('alt') === event.altKey)
    && event.key.toLocaleLowerCase() === key?.toLocaleLowerCase()
}
