/**
 * Gli accessi di Claude del workspace che la pagina delle Impostazioni conta (rilascio 10, ondata 6b): i token della
 * prima versione («Claude per Unbundle», `provider = 'claude_mcp'`) e quelli delle realizzazioni (scope `cases:*` e il
 * marcatore `uc:case:<id>`, PIANO §5.8), attivi se non sono revocati né scaduti. La riga «Accessi del team e delle
 * realizzazioni» di Collegamenti li somma ai token personali del team.
 *
 * Modulo puro: lo usano la pagina (sul server) e la card (nel browser).
 */
import { CASE_SCOPES, UC_CASE_SCOPE_PREFIX } from "../../lib/uc/mcp-access.ts";

export interface ClaudeTokenLike {
  provider: string;
  scopes: readonly string[];
  expiresAt: string | null;
  revokedAt: string | null;
}

/** Un token di una realizzazione: uno scope `cases:*` o il marcatore `uc:case:<id>`. */
export function isCaseToken(token: Pick<ClaudeTokenLike, "scopes">): boolean {
  return token.scopes.some((scope) => scope.startsWith(UC_CASE_SCOPE_PREFIX) || CASE_SCOPES.includes(scope));
}

/** Né revocato né scaduto, a `now`. */
export function isActiveToken(token: Pick<ClaudeTokenLike, "expiresAt" | "revokedAt">, now: number = Date.now()): boolean {
  return !token.revokedAt && (!token.expiresAt || new Date(token.expiresAt).getTime() > now);
}

/** Quanti accessi attivi della prima versione e delle realizzazioni. */
export function countClaudeAccesses(tokens: readonly ClaudeTokenLike[], now: number = Date.now()): { v1: number; realizations: number } {
  let v1 = 0;
  let realizations = 0;
  for (const token of tokens) {
    if (!isActiveToken(token, now)) continue;
    if (isCaseToken(token)) realizations += 1;
    else if (token.provider === "claude_mcp") v1 += 1;
  }
  return { v1, realizations };
}
