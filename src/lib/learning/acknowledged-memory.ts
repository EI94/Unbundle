type AcknowledgedRecord = { id: string; revision: number; savedAt: string };

/** Successful server replies in this tab only, separate from unsaved edits.
 * Scope includes workspace/program/user/resource and, for attempts, version.
 * These copies restore content only. Authorization always comes from server props.
 */
export function createAcknowledgedMemory<T extends AcknowledgedRecord>() {
  const scopes = new Map<string, Map<string, T>>();
  return {
    remember(scope: string, record: T) {
      const records = scopes.get(scope) ?? new Map<string, T>();
      const previous = records.get(record.id);
      if (!previous || record.revision > previous.revision) records.set(record.id, structuredClone(record));
      scopes.set(scope, records);
    },
    restore(scope: string, server: T | null): T | null {
      const records = scopes.get(scope);
      if (!records) return server;
      // An explicit attempt URL must never resolve to a different recovery attempt.
      const saved = server ? records.get(server.id) : [...records.values()].sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt))[0];
      return saved && (!server || saved.revision > server.revision) ? saved : server;
    },
  };
}
