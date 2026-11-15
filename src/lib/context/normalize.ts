/**
 * Testi a confronto in «Contesto» (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §2.2, §4.2): la stessa frase
 * scritta con maiuscole, accenti o spazi diversi è la stessa frase; lo stesso appunto incollato due volte è lo stesso
 * appunto. Modulo puro (solo `node:crypto`).
 */
import { createHash } from "node:crypto";

/** Virgolette e apostrofi tipografici, uguali a quelli semplici. */
const QUOTES: ReadonlyArray<[RegExp, string]> = [
  [/[‘’‚‛′´`]/g, "'"],
  [/[“”„‟″«»]/g, '"'],
];

/**
 * Un testo per cercarne un pezzo dentro un altro (la citazione dentro l'appunto): minuscole, spazi ridotti a uno,
 * virgolette e apostrofi tipografici come quelli semplici, trattini lunghi come quello corto. Gli accenti restano.
 */
export function foldText(text: string): string {
  let out = String(text ?? "").normalize("NFC");
  for (const [pattern, plain] of QUOTES) out = out.replace(pattern, plain);
  return out
    .replace(/[‐-―−]/g, "-")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Senza accenti: «è» come «e». */
function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/\p{M}+/gu, "");
}

/**
 * La chiave di una frase, per dire «è la stessa»: minuscole, senza accenti, senza segni, spazi ridotti a uno.
 * «Il gestionale è SAP Business One.» e «il  gestionale e sap business one» hanno la stessa chiave.
 */
export function normalizeStatement(text: string): string {
  return stripAccents(foldText(text))
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * `context_entities.name_key` per ruoli, processi, sistemi, dati e fornitori: il nome in minuscolo, senza accenti, con
 * gli spazi ridotti a uno. Al massimo 120 caratteri, come la colonna.
 */
export function entityKey(name: string): string {
  return stripAccents(String(name ?? "").normalize("NFC")).toLowerCase().replace(/\s+/g, " ").trim().slice(0, 120);
}

/** Il nome di un'entità com'è salvato: spazi ridotti, al massimo 120 caratteri. */
export function entityName(name: string): string {
  return String(name ?? "").normalize("NFC").replace(/\s+/g, " ").trim().slice(0, 120);
}

/** Il testo di un appunto com'è salvato: a capo di un tipo solo, niente spazi in fondo alle righe, niente righe vuote in testa e in coda. */
export function cleanBody(text: string): string {
  return String(text ?? "")
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\u0000/g, "")
    .trim();
}

/** L'impronta di un appunto (`context_sources.body_hash`): sha256 del testo pulito, in esadecimale. Lo stesso testo dà sempre la stessa. */
export function bodyHash(text: string): string {
  return createHash("sha256").update(cleanBody(text), "utf8").digest("hex");
}

/** Spazi ridotti a uno, senza a capo: una frase su una riga. */
export function oneLine(text: string): string {
  return String(text ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
}

/** Taglia a `max` caratteri senza spezzare una coppia surrogata. */
export function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const sliced = text.slice(0, max);
  const last = sliced.charCodeAt(sliced.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? sliced.slice(0, -1) : sliced;
}
