export function toPackageName(projectName: string): string {
  return projectName
    .toLocaleLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '') || 'phaser-game'
}
