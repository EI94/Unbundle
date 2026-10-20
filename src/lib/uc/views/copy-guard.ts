/**
 * Controllo automatico dei testi (DESIGN §6.2): per chi non è di Lateral Space
 * nessun testo reso contiene chiavi delle voci, articoli, codici del via,
 * priorità in inglese, codici dei fatti, la sigla della scheda privacy,
 * versioni dello schema, hash o gergo («template», «gate», «% verde»).
 *
 * Lo usano i test delle etichette (WP0), dei testi del referente, delle firme
 * e della campanella (WP8, WP9, WP10) e `scripts/uc-test/screens.mjs` sul
 * testo delle pagine rese per i ruoli del cliente. Per Lateral Space non c'è
 * controllo: i codici restano visibili in «Dettagli tecnici».
 *
 * Il codice dello use case (es. XX-0012) non è un codice interno e passa.
 *
 * Modulo puro e senza dipendenze di Node: lo importa anche uno script `.mjs`.
 */
import { KIND_PREFIX } from "../template/ids.ts";
import type { Audience } from "./status-groups.ts";

/**
 * Prefissi delle chiavi: quelli veri dello schema (`KIND_PREFIX`) più quelli
 * indicativi di §6.2. I campi (`<entità>.<campo>`) non hanno un prefisso
 * riconoscibile: li coprono i titoli al posto delle chiavi.
 */
const KEY_PREFIXES = [...new Set([...Object.values(KIND_PREFIX), "q", "kpi", "ent", "src", "hc", "var", "frm", "qc", "reg", "ds", "tc"])].sort((a, b) => b.length - a.length);

export interface ForbiddenRule {
  id: "chiave" | "articolo" | "codice_via" | "priorita" | "codice_fatto" | "scheda_a8" | "versione" | "hash" | "gergo";
  /** Perché è vietato, in italiano semplice. */
  reason: string;
  pattern: RegExp;
  /** Seconda verifica su ciò che `pattern` ha trovato: false = testo normale, non conta. */
  accept?: (match: string) => boolean;
}

/** Estensioni dei file: «doc.pdf» e «out.xlsx» sono nomi di file, non chiavi. */
const FILE_EXTENSION = /^(?:pdf|docx?|xlsx?|xlsm|csv|tsv|txt|rtf|odt|ods|odp|pptx?|png|jpe?g|gif|webp|heic|svg|zip|json|xml|md|eml|msg)$/;

/**
 * Ha la forma di una chiave dello schema (`ID_PATTERNS`), non di un testo
 * comune che ne condivide il prefisso:
 * - l'ultimo pezzo non è un'estensione di file («doc.pdf»);
 * - almeno un pezzo ha una lettera («par.2» è un paragrafo);
 * - con un prefisso di una lettera serve un secondo pezzo o un nome di almeno
 *   3 caratteri («f.to» è «firmato»; «q.servizio.12» e «f.margine» sono chiavi).
 */
function looksLikeKey(match: string): boolean {
  const [prefix, ...segments] = match.split(".");
  if (segments.length === 0) return false;
  if (FILE_EXTENSION.test(segments[segments.length - 1])) return false;
  if (!segments.some((part) => /[a-z]/.test(part))) return false;
  if (prefix.length === 1 && segments.length === 1 && segments[0].length < 3) return false;
  return true;
}

/** I modelli di §6.2, con `g` per trovarli tutti. */
export const FORBIDDEN_RULES: readonly ForbiddenRule[] = [
  {
    id: "chiave",
    reason: "chiave di una voce",
    // Non dentro un nome di file o un indirizzo («verbale.doc.pdf», «www.src.it»).
    pattern: new RegExp(String.raw`(?<![\w.\-/@])(?:${KEY_PREFIXES.join("|")})\.[a-z0-9_]+(?:\.[a-z0-9_]+)*\b`, "g"),
    accept: looksLikeKey,
  },
  { id: "articolo", reason: "articolo di contratto", pattern: /\bartt?\.\s?\d/gi },
  { id: "codice_via", reason: "codice del via allo sviluppo", pattern: /\bG[1-4]\b/g },
  { id: "priorita", reason: "priorità in inglese", pattern: /\b(?:must|should|could)\b/gi },
  { id: "codice_fatto", reason: "codice di un fatto", pattern: /\(F\d{3}|\bfonte F\d/gi },
  { id: "scheda_a8", reason: "sigla della scheda privacy", pattern: /\bA\.8\b/g },
  { id: "versione", reason: "versione dello schema", pattern: /\bv\d+\.\d+\.\d+\b/g },
  { id: "hash", reason: "impronta (hash)", pattern: /\b[0-9a-f]{16,}\b/g },
  { id: "gergo", reason: "gergo tecnico", pattern: /\btemplate\b|\bgate\b|% verde|verdi le/gi },
];

export interface ForbiddenMatch {
  rule: ForbiddenRule["id"];
  reason: string;
  /** Il testo trovato. */
  match: string;
  index: number;
}

/**
 * Le parti vietate di un testo per chi guarda. Per Lateral Space restituisce
 * sempre un elenco vuoto.
 */
export function findForbidden(text: string, audience: Audience): ForbiddenMatch[] {
  if (audience !== "cliente" || !text) return [];
  const out: ForbiddenMatch[] = [];
  for (const rule of FORBIDDEN_RULES) {
    for (const m of text.matchAll(new RegExp(rule.pattern.source, rule.pattern.flags))) {
      if (rule.accept && !rule.accept(m[0])) continue;
      out.push({ rule: rule.id, reason: rule.reason, match: m[0], index: m.index ?? 0 });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

/** Tutte le corrispondenze in un insieme di testi (etichette, righe di una pagina). */
export function findForbiddenIn(texts: Iterable<string>, audience: Audience): (ForbiddenMatch & { text: string })[] {
  const out: (ForbiddenMatch & { text: string })[] = [];
  for (const text of texts) for (const m of findForbidden(text, audience)) out.push({ ...m, text });
  return out;
}
