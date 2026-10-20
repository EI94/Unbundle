/**
 * Lessico sanitario (PIANO §3.10): un termine sanitario blocca sempre l'invio.
 *
 * Radici con confini di parola, sul testo piegato (minuscolo, senza accenti):
 * visita/e medica/he, certificato medico, idoneità medica, medic*, sanitar*,
 * malatti*, diagnos*, patolog*, terapi*, farmac*, invalidit*, disabilit*,
 * gravidanz*, allergi*, ricover*, sintom*, vaccin*, psicolog*, psichiatr*; in
 * più poche voci sicure (stato di salute, cartella clinica, idoneità
 * psicofisica, infortunio…).
 *
 * Eccezioni per i falsi positivi tipici del dominio, mai per i dati delle persone:
 * - «disabilitare», «disabilitato» (una funzione) non sono «disabilità»;
 * - «ricovero» vicino a hangar, aereo, velivolo… è il ricovero del mezzo;
 * - «diagnostica» vicino a motore, sistema, avionica… è la diagnostica tecnica.
 *
 * Modulo puro.
 */
import { anyAround, type PreparedText } from "./words.ts";

export interface HealthMatch {
  /** Voce del lessico: la stessa per «sanitario» e «sanitaria». */
  id: string;
  /** La voce e, per una frase, le radici delle sue parole («visita medica» → «medic»). */
  ids: string[];
  /** Parola o frase trovata (piegata): mai il testo intorno. */
  term: string;
  /** Indici della prima e dell'ultima parola. */
  first: number;
  last: number;
}

/** Frasi, controllate prima delle radici. Ogni parola è un'espressione regolare intera. */
const PHRASES: readonly { id: string; words: readonly RegExp[] }[] = [
  { id: "visita medica", words: [/^visit[ae]$/, /^medic(?:a|he|o|i)$/] },
  { id: "certificato medico", words: [/^certificat[oi]$/, /^medic[oi]$/] },
  { id: "idoneita medica", words: [/^idoneita$/, /^medic(?:a|he)$/] },
  { id: "idoneita psicofisica", words: [/^idoneita$/, /^psicofisic[aoeih]+$/] },
  { id: "stato di salute", words: [/^stat[oi]$/, /^di$/, /^salute$/] },
  { id: "condizioni di salute", words: [/^condizion[ei]$/, /^di$/, /^salute$/] },
  { id: "problemi di salute", words: [/^problem[ai]$/, /^di$/, /^salute$/] },
  { id: "motivi di salute", words: [/^motiv[oi]$/, /^di$/, /^salute$/] },
  { id: "cartella clinica", words: [/^cartell[ae]$/, /^clinic(?:a|he)$/] },
  { id: "gruppo sanguigno", words: [/^grupp[oi]$/, /^sanguign[oi]$/] },
];

/** Radici: la parola piegata inizia così. */
const STEMS: readonly string[] = [
  "medic",
  "sanitar",
  "malatti",
  "diagnos",
  "patolog",
  "terapi",
  "terapeut",
  "farmac",
  "invalidit",
  "gravidanz",
  "allergi",
  "ricover",
  "sintom",
  "vaccin",
  "psicolog",
  "psichiatr",
  "psicofisic",
  "infortun",
  "clinic",
  "sanguign",
];

/** Parole intere. */
const WORDS: ReadonlyMap<string, string> = new Map([
  ["malato", "malat"],
  ["malata", "malat"],
  ["malati", "malat"],
  ["malate", "malat"],
  ["disabile", "disabilit"],
  ["disabili", "disabilit"],
  ["incinta", "gravidanz"],
  ["incinte", "gravidanz"],
  ["maternita", "gravidanz"],
  ["handicap", "handicap"],
  ["handicappato", "handicap"],
  ["handicappati", "handicap"],
  ["covid", "covid"],
]);

const VEHICLE_CONTEXT = /^(?:hangar|aere[oi]|aeromobil[ei]|velivol[oi]|elicotter[oi]|veicol[oi]|mezz[oi]|aviogett[oi]|jet|flotta|parcheggi[oa]?|deposit[oi])$/;
const TECHNICAL_CONTEXT =
  /^(?:motor[ei]|sistem[ai]|avionic(?:a|he|o|i)|software|impiant[oi]|guast[oi]|manutenzion[ei]|tecnic(?:a|he|o|i)|apparat[oi]|component[ei]|strument[oi]|bordo|aere[oi]|aeromobil[ei])$/;

function stemId(t: PreparedText, i: number): string | null {
  const w = t.norms[i];
  const exact = WORDS.get(w);
  if (exact) return exact;
  // «disabilità» (nome) sì; «disabilita», «disabilitare» (verbo) no. Con l'accento
  // piegato le due forme coincidono: decide l'accento scritto o l'apostrofo.
  if (w === "disabilita") {
    const raw = t.text.slice(t.starts[i], t.ends[i]).toLowerCase();
    const next = t.text[t.ends[i]] ?? "";
    return raw.endsWith("à") || raw.endsWith("á") || next === "'" || next === "’" ? "disabilit" : null;
  }
  for (const stem of STEMS) {
    if (!w.startsWith(stem)) continue;
    if (stem === "ricover" && anyAround(t, i, 3, (j) => VEHICLE_CONTEXT.test(t.norms[j]))) return null;
    if (stem === "diagnos" && w.startsWith("diagnostic") && anyAround(t, i, 3, (j) => TECHNICAL_CONTEXT.test(t.norms[j]))) {
      return null;
    }
    return stem;
  }
  return null;
}

/** Tutti i termini sanitari del testo, nell'ordine. */
export function findHealthTerms(t: PreparedText): HealthMatch[] {
  const out: HealthMatch[] = [];
  const n = t.norms.length;
  for (let i = 0; i < n; i++) {
    let matched = false;
    for (const phrase of PHRASES) {
      const k = phrase.words.length;
      if (i + k > n) continue;
      let ok = true;
      for (let p = 0; p < k && ok; p++) ok = phrase.words[p].test(t.norms[i + p]);
      if (ok) {
        const ids = [phrase.id];
        for (let p = 0; p < k; p++) {
          const id = stemId(t, i + p);
          if (id !== null && !ids.includes(id)) ids.push(id);
        }
        out.push({ id: phrase.id, ids, term: phrase.id, first: i, last: i + k - 1 });
        i += k - 1;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    const id = stemId(t, i);
    if (id !== null) out.push({ id, ids: [id], term: t.norms[i], first: i, last: i });
  }
  return out;
}

/** Voci del lessico presenti in un testo (per le domande sulla regola sanitaria). */
export function healthIds(t: PreparedText): Set<string> {
  const ids = new Set<string>();
  for (const m of findHealthTerms(t)) for (const id of m.ids) ids.add(id);
  return ids;
}
