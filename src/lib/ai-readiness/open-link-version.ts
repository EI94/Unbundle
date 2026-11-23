/**
 * La versione del link per tutti (rilascio 10, ondata 7b): un'impronta del suo hash, che cambia con «Crea un link nuovo».
 * La dashboard la passa al browser, che tiene la sua copia del link per quella versione (`open-link-cache.ts`): un link
 * ritirato non si copia più. Non è l'hash e non apre niente: chi la conosce non può rispondere al questionario.
 *
 * Modulo puro con `node:crypto`: solo sul server.
 */
import { createHash } from "node:crypto";

export function openLinkVersion(tokenHash: string | null | undefined): string | null {
  if (typeof tokenHash !== "string" || !tokenHash) return null;
  return createHash("sha256").update(`unbundle:ai-readiness:link-version:${tokenHash}`).digest("hex").slice(0, 16);
}

/** La versione del link di una rilevazione, da `scoringConfig.openLinkTokenHash`; null senza link. */
export function openLinkVersionOf(scoringConfig: unknown): string | null {
  const hash = scoringConfig && typeof scoringConfig === "object" ? (scoringConfig as Record<string, unknown>).openLinkTokenHash : null;
  return openLinkVersion(typeof hash === "string" ? hash : null);
}
