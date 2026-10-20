/**
 * Redazione delle menzioni personali (PIANO §3.10, §8.1 punto 9): email,
 * telefoni, codici fiscali e i nomi del file privato diventano «[referente]».
 *
 * - I nomi si cercano come parole intere, senza badare a maiuscole e accenti
 *   («NICOLÒ», «Nicolo» e «nicolò» sono lo stesso nome); i più lunghi prima.
 * - Più menzioni separate solo da spazi diventano una sola («Mario Rossi» con
 *   «Mario» e «Rossi» nell'elenco → «[referente]»).
 * - Il testo restituito è in NFC.
 *
 * Modulo puro.
 */
import { findEmails, findPhones, findTaxCodes, mergeSpans, type Span } from "./personal-data.ts";
import { foldSameLength } from "./words.ts";

export const REDACTION_PLACEHOLDER = "[referente]";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Espressione per un nome piegato: parole separate da spazi, apostrofi, punti o trattini. */
function namePattern(name: string): RegExp | null {
  const tokens = foldSameLength(name.normalize("NFC")).match(/[\p{L}\p{N}]+/gu) ?? [];
  if (tokens.length === 0 || tokens.join("").length < 2) return null;
  const body = tokens.map(escapeRegExp).join("[\\s'’.\\-]+");
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "gu");
}

/** Intervalli dei nomi dell'elenco nel testo (in NFC). */
export function findNames(text: string, names: readonly string[]): Span[] {
  const folded = foldSameLength(text.normalize("NFC"));
  const patterns = [...new Set(names.filter((n): n is string => typeof n === "string" && n.trim() !== ""))]
    .sort((a, b) => b.length - a.length)
    .map(namePattern)
    .filter((p): p is RegExp => p !== null);
  const out: Span[] = [];
  for (const p of patterns) {
    for (const m of folded.matchAll(p)) out.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  }
  return out;
}

/** Oscura email, telefoni, codici fiscali e nomi dell'elenco. */
export function redactPersonalMentions(input: string, names: readonly string[]): { text: string; count: number } {
  if (typeof input !== "string" || input === "") return { text: typeof input === "string" ? input : "", count: 0 };
  const text = input.normalize("NFC");
  const merged = mergeSpans([...findEmails(text), ...findPhones(text), ...findTaxCodes(text), ...findNames(text, names)]);
  if (merged.length === 0) return { text, count: 0 };
  // Menzioni separate solo da spazi diventano una.
  const joined: Span[] = [];
  for (const s of merged) {
    const last = joined[joined.length - 1];
    if (last && /^[ \t]*$/.test(text.slice(last.end, s.start))) last.end = s.end;
    else joined.push({ ...s });
  }
  let out = "";
  let cursor = 0;
  for (const s of joined) {
    out += text.slice(cursor, s.start) + REDACTION_PLACEHOLDER;
    cursor = s.end;
  }
  out += text.slice(cursor);
  return { text: out, count: joined.length };
}
