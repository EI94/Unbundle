/**
 * Impronta canonica di una definizione di template (PIANO §4.3, passo 2):
 * `definition_hash = sha256(stableStringify(definizione canonica))`.
 *
 * `stableStringify` ordina le chiavi degli oggetti a ogni livello, come
 * `stable()` di `mcp/unbundle-portfolio-server.mjs`, ma con l'ordine dei code
 * unit (non `localeCompare`): l'impronta non dipende dalla lingua del sistema.
 * Le proprietà `undefined` si tolgono, come fa `JSON.stringify`.
 *
 * Modulo puro.
 */
import { createHash } from "node:crypto";

function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Copia del valore con le chiavi ordinate a ogni livello. */
export function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => (v === undefined ? null : stableValue(v)));
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort(compareKeys)) {
    const v = (value as Record<string, unknown>)[key];
    if (v !== undefined) out[key] = stableValue(v);
  }
  return out;
}

/** JSON con le chiavi ordinate: due oggetti uguali danno sempre lo stesso testo. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** `definition_hash` di `uc_templates`: 64 cifre esadecimali. */
export function definitionHash(definition: unknown): string {
  return sha256Hex(stableStringify(definition));
}
