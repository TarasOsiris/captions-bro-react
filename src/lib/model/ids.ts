// Stable id generation for document entities. Thin wrapper over crypto.randomUUID
// (matches the monorepo convention in screenshot-bro's id-generators).

export function uid(prefix?: string): string {
  const id = crypto.randomUUID()
  return prefix ? `${prefix}_${id}` : id
}
