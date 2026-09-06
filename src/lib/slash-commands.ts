export type SlashCommand = { name: string; description: string; inputHint?: string };

export function parseCommands(value: unknown): SlashCommand[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item) => {
    if (!item || typeof item.name !== 'string') return [];
    const name = item.name.replace(/^\//, '').trim();
    if (!name || /\s/.test(name) || seen.has(name)) return [];
    seen.add(name);
    return [{ name, description: typeof item.description === 'string' ? item.description : '',
      inputHint: typeof item.inputHint === 'string' ? item.inputHint : undefined }];
  });
}

export const isSlashQuery = (input: string) => /^\/[^\s]*$/.test(input);

export function insertCommand(input: string, name: string): string {
  // Preserve arguments/drafts; hints such as <path> are not literal command input.
  const rest = input.startsWith('/') ? input.replace(/^\/[^\s]*\s?/, '') : input;
  return `/${name} ${rest}`;
}
