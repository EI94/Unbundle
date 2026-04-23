/**
 * Evita open redirect: solo path interni + query limitata (es. /install/slack, /api/slack/install?workspaceId=…).
 */
export function safeInternalCallbackUrl(
  raw: string | null | undefined
): string | null {
  if (raw == null || typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t.startsWith("/") || t.startsWith("//")) return null;
  if (t.length > 512) return null;
  const [path, query] = t.split("?", 2);
  if (!/^\/[a-zA-Z0-9/_-]*$/.test(path)) return null;
  if (query !== undefined) {
    if (query.length > 256) return null;
    if (!/^[a-zA-Z0-9_=&%.-]*$/.test(query)) return null;
  }
  return t;
}
