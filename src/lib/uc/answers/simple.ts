/**
 * Tipi senza conversioni (PIANO §3.9): `testo`, `codice`, `file`, `dataset`,
 * `collegamento_sistema`, `caso_prova`.
 *
 * La scansione dei testi (sanitario, discriminatorio, nomi) non sta qui: la fa
 * `text/scan.ts` su ogni foglia del payload (vedi `prepare.ts`).
 *
 * Modulo puro.
 */
import type { Json } from "../types.ts";
import { TEST_CASE_KINDS } from "../vocab.ts";
import { issue, type Issue } from "./issues.ts";
import { cleanText, isPlainObject, nonEmptyString, sameLabel } from "./strings.ts";
import { outcome, type NormalizeContext, type Outcome, type ResponseConfig } from "./types.ts";

/** Lunghezza massima di un testo libero, se la voce non ne indica una. */
export const DEFAULT_TEXT_MAX_LENGTH = 5000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** Testo pulito: NFC, spazi uniformi, a capo conservati (al massimo uno vuoto di fila). */
export function cleanMultiline(text: string): string {
  return cleanText(text)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

/** Tipo `testo` `{text}`. */
export function normalizeTesto(raw: unknown, config: ResponseConfig): Outcome {
  const input = isPlainObject(raw) ? raw.text : raw;
  if (typeof input !== "string" || cleanText(input) === "") {
    return outcome({ value: null, errors: [issue("testo_mancante", "Scrivi la risposta.", "text")] });
  }
  const text = cleanMultiline(input);
  const errors: Issue[] = [];
  const length = [...text].length;
  const min = typeof config.min_length === "number" ? config.min_length : 1;
  const max = typeof config.max_length === "number" ? config.max_length : DEFAULT_TEXT_MAX_LENGTH;
  if (length < min) errors.push(issue("testo_troppo_corto", `Scrivi almeno ${min} caratteri.`, "text"));
  if (length > max) errors.push(issue("testo_troppo_lungo", `Il testo può avere al massimo ${max} caratteri.`, "text"));
  return outcome({ value: { text }, normalized: errors.length === 0 ? { text } : null, errors });
}

function compilePattern(pattern: unknown): RegExp | null {
  if (typeof pattern !== "string" || pattern === "") return null;
  try {
    return new RegExp(pattern, "u");
  } catch {
    return null;
  }
}

/** Tipo `codice` `{code}`: trim e maiuscolo, `config.pattern`, `allowed[]`, `ref_entity`. */
export function normalizeCodice(raw: unknown, config: ResponseConfig): Outcome {
  const input = isPlainObject(raw) ? raw.code : raw;
  if (typeof input !== "string" || cleanText(input) === "") {
    return outcome({ value: null, errors: [issue("codice_mancante", "Scrivi il codice.", "code")] });
  }
  const trimmed = cleanText(input).replace(/\s+/g, " ");
  const code = config.preserve_case === true ? trimmed : trimmed.toUpperCase();
  const errors: Issue[] = [];
  if (code.length > 120) errors.push(issue("codice_troppo_lungo", "Il codice è troppo lungo.", "code"));
  const pattern = compilePattern(config.pattern);
  if (typeof config.pattern === "string" && config.pattern !== "" && pattern === null) {
    errors.push(issue("formato_codice_non_valido", "Il formato del codice non è configurato bene: segnalalo a Lateral Space.", "code"));
  } else if (pattern && !pattern.test(code)) {
    errors.push(issue("codice_formato", "Il codice non ha il formato atteso.", "code"));
  }
  const allowed = Array.isArray(config.allowed) ? config.allowed.filter((a): a is string => typeof a === "string") : [];
  if (allowed.length > 0 && !allowed.some((a) => (config.preserve_case === true ? a === code : a.toUpperCase() === code))) {
    errors.push(issue("codice_non_ammesso", "Questo codice non è tra quelli ammessi.", "code"));
  }
  const value: Record<string, Json> = { code };
  if (typeof config.ref_entity === "string" && config.ref_entity !== "") value.ref_entity = config.ref_entity;
  return outcome({ value, normalized: errors.length === 0 ? { code } : null, errors });
}

/** Tipo `file` `{file_ids[]}`: solo file utilizzabili dello stesso caso e della stessa voce. */
export function normalizeFile(raw: unknown, config: ResponseConfig, ctx: Pick<NormalizeContext, "usableFileIds">): Outcome {
  const list = isPlainObject(raw) ? raw.file_ids : raw;
  if (!Array.isArray(list) || list.length === 0) {
    return outcome({ value: null, errors: [issue("file_mancante", "Allega almeno un file.", "file_ids")] });
  }
  const ids: string[] = [];
  const errors: Issue[] = [];
  list.forEach((id, index) => {
    if (!isUuid(id)) errors.push(issue("file_non_valido", "Allegato non valido.", `file_ids[${index}]`));
    else if (!ids.includes(id.toLowerCase())) ids.push(id.toLowerCase());
  });
  const max = typeof config.max_files === "number" ? config.max_files : 20;
  if (ids.length > max) errors.push(issue("troppi_file", `Puoi allegare al massimo ${max} file.`, "file_ids"));
  if (ctx.usableFileIds) {
    const usable = new Set(ctx.usableFileIds.map((id) => id.toLowerCase()));
    ids.forEach((id, index) => {
      if (!usable.has(id)) {
        errors.push(issue("file_non_utilizzabile", "Questo file non è ancora pronto o non appartiene a questa domanda.", `file_ids[${index}]`));
      }
    });
  }
  return outcome({ value: { file_ids: ids }, normalized: errors.length === 0 ? { file_ids: ids } : null, errors });
}

/** Tipo `dataset` `{file_id, dataset_id}`. */
export function normalizeDataset(raw: unknown, ctx: Pick<NormalizeContext, "usableDatasets">): Outcome {
  if (!isPlainObject(raw) || !isUuid(raw.file_id) || !isUuid(raw.dataset_id)) {
    return outcome({ value: null, errors: [issue("dataset_mancante", "Allega il file del dataset e compila la scheda.", "file_id")] });
  }
  const value = { file_id: raw.file_id.toLowerCase(), dataset_id: raw.dataset_id.toLowerCase() };
  const errors: Issue[] = [];
  if (ctx.usableDatasets && !ctx.usableDatasets.some((d) => d.fileId.toLowerCase() === value.file_id && d.datasetId.toLowerCase() === value.dataset_id)) {
    errors.push(issue("dataset_non_utilizzabile", "Questo dataset non è ancora pronto o non appartiene a questa domanda.", "dataset_id"));
  }
  return outcome({ value, normalized: errors.length === 0 ? { ...value } : null, errors });
}

export const SYSTEM_ACCESS_MODES = ["export", "collegamento_diretto", "inserimento_manuale"] as const;
export type SystemAccessMode = (typeof SYSTEM_ACCESS_MODES)[number];

/** Tipo `collegamento_sistema`: dove sta un dato e come si legge. */
export function normalizeCollegamentoSistema(raw: unknown, config: ResponseConfig): Outcome {
  if (!isPlainObject(raw)) {
    return outcome({ value: null, errors: [issue("sistema_mancante", "Indica il sistema e l'oggetto in cui sta il dato.", "sistema")] });
  }
  const errors: Issue[] = [];
  let sistema = nonEmptyString(raw.sistema);
  const oggetto = nonEmptyString(raw.oggetto);
  const accesso = typeof raw.accesso === "string" ? cleanText(raw.accesso) : "";
  if (sistema === null) errors.push(issue("sistema_mancante", "Indica il sistema.", "sistema"));
  else if (Array.isArray(config.systems) && config.systems.length > 0) {
    const match = config.systems.find((s) => typeof s === "string" && sameLabel(s, sistema as string));
    if (match) sistema = match;
    else errors.push(issue("sistema_non_in_mappa", "Scegli un sistema dalla mappa dei vostri strumenti.", "sistema"));
  }
  if (oggetto === null) errors.push(issue("oggetto_mancante", "Indica l'oggetto o la schermata in cui sta il dato.", "oggetto"));
  if (!(SYSTEM_ACCESS_MODES as readonly string[]).includes(accesso)) {
    errors.push(issue("accesso_mancante", "Indica come si legge il dato: export, collegamento diretto o inserimento manuale.", "accesso"));
  }
  const value: Record<string, Json> = { sistema, oggetto, accesso: accesso || null };
  for (const key of ["campo", "chi_ha_accesso", "frequenza", "disponibilita"] as const) {
    const v = nonEmptyString(raw[key]);
    if (v !== null) value[key] = v;
  }
  return outcome({ value, normalized: errors.length === 0 ? { ...value } : null, errors });
}

const ITEM_KEY = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/;

/** Tipo `caso_prova`: richiesta, esito atteso, regole toccate, tipo. */
export function normalizeCasoProva(raw: unknown): Outcome {
  if (!isPlainObject(raw)) {
    return outcome({ value: null, errors: [issue("caso_mancante", "Scrivi la richiesta d'esempio e l'esito atteso.", "richiesta")] });
  }
  const errors: Issue[] = [];
  const richiesta = nonEmptyString(raw.richiesta);
  const atteso = nonEmptyString(raw.atteso);
  const tipo = typeof raw.tipo === "string" ? raw.tipo : "sintetico";
  const regole = Array.isArray(raw.regole) ? raw.regole.filter((r): r is string => typeof r === "string").map((r) => r.trim()) : [];
  if (richiesta === null) errors.push(issue("richiesta_mancante", "Scrivi la richiesta d'esempio.", "richiesta"));
  if (atteso === null) errors.push(issue("atteso_mancante", "Scrivi l'esito atteso.", "atteso"));
  if (regole.length === 0) errors.push(issue("regole_mancanti", "Indica almeno una regola toccata (ID).", "regole"));
  regole.forEach((r, i) => {
    if (!ITEM_KEY.test(r)) errors.push(issue("regola_non_valida", "ID di regola non valido.", `regole[${i}]`));
  });
  if (!(TEST_CASE_KINDS as readonly string[]).includes(tipo)) {
    errors.push(issue("tipo_caso_non_valido", "Il caso è sintetico o pseudonimizzato.", "tipo"));
  }
  const value = { richiesta, atteso, regole: [...new Set(regole)], tipo };
  return outcome({ value, normalized: errors.length === 0 ? { ...value } : null, errors });
}
