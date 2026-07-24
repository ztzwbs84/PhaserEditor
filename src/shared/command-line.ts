export function parseCommandLine(value: string): string[] {
  const result: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let tokenStarted = false
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!
    if (quote) {
      if (character === quote) {
        quote = null
        tokenStarted = true
      } else if (character === '\\' && (value[index + 1] === quote || value[index + 1] === '\\')) {
        current += value[++index]
      } else {
        current += character
      }
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      tokenStarted = true
    } else if (/\s/.test(character)) {
      if (tokenStarted || current) {
        result.push(current)
        current = ''
        tokenStarted = false
      }
    } else if (character === '\\' && /[\s"'\\]/.test(value[index + 1] ?? '')) {
      current += value[++index]
      tokenStarted = true
    } else {
      current += character
      tokenStarted = true
    }
  }
  if (tokenStarted || current) result.push(current)
  return result
}

export function formatCommandLine(args: string[]): string {
  return args.map((argument) => argument === '' || /[\s"']/.test(argument) ? JSON.stringify(argument) : argument).join(' ')
}
