/**
 * Filtri rapidi del catalogo delle voci (PIANO §5.1, «Voci e risposte»).
 *
 * I filtri stanno nell'URL (`searchParams`), così una vista si condivide e si
 * ricarica uguale: tipo, stato, referente, priorità, privacy, modulo, ruolo
 * titolare, ricerca e i preset «must non verdi», «bloccate», «da verificare da
 * me», «evoluzione». Un valore non valido si ignora, non dà errore.
 *
 * Vista iniziale: le domande (`DEFAULT_KIND`). Un caso grande ha migliaia di
 * voci del modello dati; quello che si chiede al cliente sono le domande. Senza
 * `tipo` nell'URL si vedono le domande; «tutti i tipi» si scrive `tipo=tutti`.
 *
 * Qui stanno anche le condizioni SQL (alias `i` = `uc_items`): ogni valore
 * diventa un parametro, mai testo. Filtri, ricerca, conteggi e paginazione si
 * applicano nel database: alla pagina arrivano al massimo 100 righe.
 *
 * Modulo puro.
 */
import { effectiveCaseStatus } from "../case-state.ts";
import { cast, join, jsonb, raw, toStatement, ucSql, type SqlFragment, type UcStatement } from "../sql/statement.ts";
import { templateKeyListSql } from "../sql/template-parts.ts";
import {
  ITEM_KINDS,
  ITEM_STATUSES,
  LS_CASE_ROLES,
  PRIORITIES,
  PRIVACY_CLASSES,
  isVocab,
  type CaseRole,
  type CaseStatus,
  type ItemKind,
  type ItemStatus,
  type Priority,
  type PrivacyClass,
} from "../vocab.ts";
import { VALIDATED_STATUSES, seesValidatedOnly } from "./page-access.ts";
import { UUID } from "../ids.ts";

export const CATALOG_PAGE_SIZE = 100;

/** Tipo della vista iniziale del catalogo. */
export const DEFAULT_KIND: ItemKind = "domanda";

/** Valore di `tipo` nell'URL per «tutti i tipi». */
export const ALL_KINDS = "tutti" as const;

export const CATALOG_PRESETS = ["must_non_verdi", "bloccate", "da_verificare", "evoluzione"] as const;
export type CatalogPreset = (typeof CATALOG_PRESETS)[number];

/** Valore speciale dei filtri «referente» e «priorità»: senza. */
export const NONE = "nessuno" as const;

export interface CatalogFilter {
  /** Tipo di voce; `null` = tutti i tipi. */
  tipo: ItemKind | null;
  stato: ItemStatus | null;
  /** Contatto assegnato (uuid) oppure `nessuno`. */
  referente: string | null;
  priorita: Priority | typeof NONE | null;
  privacy: PrivacyClass | null;
  modulo: string | null;
  ruolo: string | null;
  preset: CatalogPreset | null;
  q: string | null;
  /** Pagina, da 1. */
  pagina: number;
}

/** Nessun filtro: tutte le voci del caso (serve ai totali). */
export const EMPTY_CATALOG_FILTER: Readonly<CatalogFilter> = Object.freeze({
  tipo: null,
  stato: null,
  referente: null,
  priorita: null,
  privacy: null,
  modulo: null,
  ruolo: null,
  preset: null,
  q: null,
  pagina: 1,
});

const MODULE_KEY = /^[a-z0-9][a-z0-9_.-]{0,79}$/;
const ROLE_KEY = /^[a-z][a-z0-9_]{1,79}$/;
const MAX_Q = 100;
const MAX_PAGE = 1000;

type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

function first(sp: SearchParams, key: string): string | null {
  const v = sp[key];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s.trim() !== "" ? s.trim() : null;
}

/** Filtri dall'URL; i valori non ammessi diventano «nessun filtro» (il tipo torna alla vista iniziale). */
export function parseCatalogFilter(sp: SearchParams): CatalogFilter {
  const tipo = first(sp, "tipo");
  const stato = first(sp, "stato");
  const referente = first(sp, "referente");
  const priorita = first(sp, "priorita");
  const privacy = first(sp, "privacy");
  const modulo = first(sp, "modulo");
  const ruolo = first(sp, "ruolo");
  const preset = first(sp, "preset");
  const q = first(sp, "q");
  const page = Number.parseInt(first(sp, "pagina") ?? "1", 10);
  return {
    tipo: tipo === ALL_KINDS ? null : isVocab(ITEM_KINDS, tipo) ? tipo : DEFAULT_KIND,
    stato: isVocab(ITEM_STATUSES, stato) ? stato : null,
    referente: referente === NONE || (referente !== null && UUID.test(referente)) ? referente : null,
    priorita: priorita === NONE || isVocab(PRIORITIES, priorita) ? (priorita as Priority | typeof NONE) : null,
    privacy: isVocab(PRIVACY_CLASSES, privacy) ? privacy : null,
    modulo: modulo !== null && MODULE_KEY.test(modulo) ? modulo : null,
    ruolo: ruolo !== null && ROLE_KEY.test(ruolo) ? ruolo : null,
    preset: isVocab(CATALOG_PRESETS, preset) ? preset : null,
    q: q !== null ? q.slice(0, MAX_Q) : null,
    pagina: Number.isFinite(page) && page >= 1 ? Math.min(page, MAX_PAGE) : 1,
  };
}

/** Parametri dei filtri (senza `pagina`) diversi dalla vista iniziale. */
const FILTER_KEYS = ["preset", "stato", "referente", "priorita", "privacy", "modulo", "ruolo", "q"] as const;

/**
 * Query string dei filtri (con `?`, vuota per la vista iniziale). Cambiare un
 * filtro riporta alla prima pagina, salvo che si cambi proprio la pagina. Il
 * tipo della vista iniziale non si scrive; «tutti i tipi» diventa `tipo=tutti`.
 */
export function catalogQuery(filter: CatalogFilter, patch: Partial<CatalogFilter> = {}): string {
  const next: CatalogFilter = { ...filter, ...patch };
  if (!("pagina" in patch)) next.pagina = 1;
  const params = new URLSearchParams();
  if (next.tipo === null) params.set("tipo", ALL_KINDS);
  else if (next.tipo !== DEFAULT_KIND) params.set("tipo", next.tipo);
  for (const k of FILTER_KEYS) {
    const v = next[k];
    if (v !== null && v !== undefined && v !== "") params.set(k, String(v));
  }
  if (next.pagina > 1) params.set("pagina", String(next.pagina));
  const s = params.toString();
  return s ? `?${s}` : "";
}

/** Vero se è attivo almeno un filtro oltre al tipo (la pagina non conta): «Togli i filtri» li toglie e tiene il tipo. */
export function hasActiveFilter(filter: CatalogFilter): boolean {
  return FILTER_KEYS.some((k) => filter[k] !== null);
}

/** La vista iniziale così com'è: domande, nessun altro filtro. */
export function isDefaultView(filter: CatalogFilter): boolean {
  return filter.tipo === DEFAULT_KIND && !hasActiveFilter(filter);
}

export interface CatalogWhereContext {
  /** Utente che guarda: serve al preset «da verificare da me». */
  userId: string;
  /** Solo voci verdi o blu (sviluppatore). */
  validatedOnly: boolean;
}

/** Filtri con un conteggio per opzione; il conteggio di un filtro si fa senza quel filtro. */
export const CATALOG_FACETS = ["tipo", "stato", "referente", "priorita", "privacy", "modulo", "ruolo", "preset"] as const;
export type CatalogFacet = (typeof CATALOG_FACETS)[number];

/**
 * Condizione di un preset su `uc_items i`. Con `withoutStatus` il preset non
 * aggiunge la sua condizione sullo stato (per contare le opzioni dello stato).
 */
export function presetConditionSql(preset: CatalogPreset, ctx: CatalogWhereContext, withoutStatus = false): SqlFragment | null {
  switch (preset) {
    case "must_non_verdi":
      return raw("i.priority = 'must' AND i.status NOT IN ('validata', 'non_applicabile')");
    case "bloccate":
      return withoutStatus ? null : raw("i.status = 'bloccata'");
    case "evoluzione":
      return raw("i.perimeter = 'evoluzione'");
    case "da_verificare": {
      const me = cast(ctx.userId, "uuid");
      const parts: SqlFragment[] = [];
      if (!withoutStatus) parts.push(raw("i.status IN ('in_verifica', 'parziale')"));
      // Chi ha risposto (in una qualsiasi versione) o ha copiato il link della risposta non la verifica.
      parts.push(ucSql`NOT EXISTS (SELECT 1 FROM uc_answers x WHERE x.item_id = i.id AND x.responder_user_id = ${me})`);
      parts.push(ucSql`NOT EXISTS (SELECT 1 FROM uc_answers ca JOIN uc_request_tokens t ON t.request_id = ca.request_id
  WHERE ca.id = i.current_answer_id AND t.issued_by_user_id = ${me})`);
      return join(parts, " AND ");
    }
    default:
      return null;
  }
}

/**
 * Condizioni del catalogo su `uc_items i`, già con il caso e senza le voci
 * cancellate. `without` toglie un filtro, per contare le opzioni di quel filtro.
 */
export function catalogWhereSql(caseId: string, filter: CatalogFilter, ctx: CatalogWhereContext, without?: CatalogFacet): SqlFragment {
  const parts: SqlFragment[] = [ucSql`i.case_id = ${cast(caseId, "uuid")}`, raw("i.deleted_at IS NULL")];
  if (ctx.validatedOnly) parts.push(ucSql`i.status = ANY(${cast([...VALIDATED_STATUSES], "text[]")})`);
  if (filter.tipo && without !== "tipo") parts.push(ucSql`i.kind = ${cast(filter.tipo, "text")}`);
  if (filter.stato && without !== "stato") parts.push(ucSql`i.status = ${cast(filter.stato, "text")}`);
  if (without !== "referente") {
    if (filter.referente === NONE) parts.push(raw("i.assignee_contact_id IS NULL"));
    else if (filter.referente) parts.push(ucSql`i.assignee_contact_id = ${cast(filter.referente, "uuid")}`);
  }
  if (without !== "priorita") {
    if (filter.priorita === NONE) parts.push(raw("i.priority IS NULL"));
    else if (filter.priorita) parts.push(ucSql`i.priority = ${cast(filter.priorita, "text")}`);
  }
  if (filter.privacy && without !== "privacy") parts.push(ucSql`i.privacy_class = ${cast(filter.privacy, "text")}`);
  if (filter.modulo && without !== "modulo") parts.push(ucSql`i.request_module_key = ${cast(filter.modulo, "text")}`);
  if (filter.ruolo && without !== "ruolo") parts.push(ucSql`i.owner_role_key = ${cast(filter.ruolo, "text")}`);
  if (filter.q) {
    const q = cast(filter.q.toLowerCase(), "text");
    parts.push(ucSql`(strpos(lower(i.key), ${q}) > 0 OR strpos(lower(i.title), ${q}) > 0)`);
  }
  if (filter.preset && without !== "preset") {
    const cond = presetConditionSql(filter.preset, ctx, without === "stato");
    if (cond) parts.push(cond);
  }
  return join(parts, " AND ");
}

/** Query string dell'URL → filtri (per la selezione «tutti i risultati», che arriva da un'azione). */
export function parseCatalogQuery(query: string): CatalogFilter {
  return parseCatalogFilter(searchParamsOf(query));
}

function searchParamsOf(query: string): Record<string, string> {
  const params = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
  const sp: Record<string, string> = {};
  for (const [k, v] of params) if (!(k in sp)) sp[k] = v;
  return sp;
}

// ── Domande (DESIGN §3.6, WP3) ────────────────────────────────────────
//
// Il catalogo di sopra resta per i lettori di oggi fino a WP13. Domande ha i
// suoi parametri (§2.5): `vista` (segmento), `indispensabili`, `mostra`,
// `tipo`, `argomento`, `referente`, `ruolo`, `stato`, `riservatezza`,
// `perimetro`, `q`, `pagina`. Tre pubblici:
// - Lateral Space: segmenti «Da fare · Da verificare · Bloccate · Documenti ·
//   Tutte», tutti i filtri, anche «Tutto il catalogo»;
// - sviluppatore: solo le domande a posto, con la ricerca;
// - responsabile del cliente: «Da rispondere · In verifica · A posto · Tutte»,
//   senza stato dettagliato, riservatezza né catalogo (§3.6.8); del referente
//   solo «Senza referente», mai una persona (art. 15.4).
// Filtri, conteggi, ordine e pagine stanno nel database: alla pagina arrivano
// 50 righe.

export const QUESTIONS_PAGE_SIZE = 50;

/** I segmenti di Domande, come valori di `?vista=`. */
export const QUESTION_SEGMENTS = ["da-fare", "da-verificare", "bloccate", "a-posto", "tutte"] as const;
export type QuestionSegment = (typeof QUESTION_SEGMENTS)[number];

/** Chi guarda Domande. */
export type QuestionAudience = "ls" | "sviluppatore" | "cliente";

/** Segmenti che ogni pubblico può aprire. Lateral Space vede «A posto» solo se lo chiede l'indirizzo. */
export const QUESTION_SEGMENTS_FOR: Readonly<Record<QuestionAudience, readonly QuestionSegment[]>> = {
  ls: ["da-fare", "da-verificare", "bloccate", "a-posto", "tutte"],
  cliente: ["da-fare", "da-verificare", "a-posto", "tutte"],
  sviluppatore: ["a-posto"],
};

/** Etichette dei segmenti: il cliente legge le sue parole (§2.6). */
export const QUESTION_SEGMENT_LABEL: Readonly<Record<"ls" | "cliente", Readonly<Record<QuestionSegment, string>>>> = {
  ls: { "da-fare": "Da fare", "da-verificare": "Da verificare", bloccate: "Bloccate", "a-posto": "A posto", tutte: "Tutte" },
  cliente: { "da-fare": "Da rispondere", "da-verificare": "In verifica", bloccate: "In attesa", "a-posto": "A posto", tutte: "Tutte" },
};

/** Il pubblico dai ruoli di caso che valgono adesso. */
export function questionAudience(roles: readonly CaseRole[]): QuestionAudience {
  if (seesValidatedOnly(roles)) return "sviluppatore";
  return roles.some((r) => (LS_CASE_ROLES as readonly CaseRole[]).includes(r)) ? "ls" : "cliente";
}

export interface QuestionDefaults {
  vista: QuestionSegment;
  /** «Solo indispensabili» acceso. */
  soloIndispensabili: boolean;
}

/**
 * Impostazioni predefinite (§3.6.1): «Da fare» e solo indispensabili finché il
 * caso è in bozza o in preparazione (anche in pausa da lì); dopo, «Tutte» e
 * l'interruttore spento. Lo sviluppatore vede sempre e solo «A posto».
 */
export function questionDefaults(status: CaseStatus, statusBeforeSuspension: CaseStatus | null, audience: QuestionAudience): QuestionDefaults {
  if (audience === "sviluppatore") return { vista: "a-posto", soloIndispensabili: false };
  const effective = effectiveCaseStatus(status, statusBeforeSuspension);
  const preparing = effective === "bozza" || effective === "raccolta" || (status === "sospeso" && !statusBeforeSuspension);
  return { vista: preparing ? "da-fare" : "tutte", soloIndispensabili: preparing };
}

export const PERIMETER_FILTERS = ["nel", "fuori"] as const;
export type PerimeterFilter = (typeof PERIMETER_FILTERS)[number];

export interface QuestionFilter {
  vista: QuestionSegment;
  soloIndispensabili: boolean;
  /** «Mostra: Tutto il catalogo» (solo Lateral Space): ogni tipo di voce, non solo le domande. */
  catalogo: boolean;
  /** Tipo di voce, solo con il catalogo intero. */
  tipo: ItemKind | null;
  argomento: string | null;
  referente: string | null;
  ruolo: string | null;
  /** Stato di dettaglio (solo Lateral Space). */
  stato: ItemStatus | null;
  /** Classe di riservatezza (solo Lateral Space). */
  riservatezza: PrivacyClass | null;
  perimetro: PerimeterFilter | null;
  q: string | null;
  pagina: number;
}

/**
 * Filtri dall'URL per chi guarda: i valori non ammessi, o non per il suo
 * pubblico, valgono «nessun filtro»; senza `vista` e `indispensabili` valgono
 * i predefiniti. Il vecchio catalogo usava altri nomi: i 308 di §2.5 li
 * traducono prima di arrivare qui.
 */
export function parseQuestionFilter(sp: SearchParams, audience: QuestionAudience, defaults: QuestionDefaults): QuestionFilter {
  const ls = audience === "ls";
  const dev = audience === "sviluppatore";
  const vista = first(sp, "vista");
  const indispensabili = first(sp, "indispensabili");
  const catalogo = ls && first(sp, "mostra") === "catalogo";
  const tipo = first(sp, "tipo");
  const argomento = first(sp, "argomento");
  const referente = first(sp, "referente");
  const ruolo = first(sp, "ruolo");
  const stato = first(sp, "stato");
  const riservatezza = first(sp, "riservatezza");
  const perimetro = first(sp, "perimetro");
  const q = first(sp, "q");
  const page = Number.parseInt(first(sp, "pagina") ?? "1", 10);
  return {
    vista: isVocab(QUESTION_SEGMENTS_FOR[audience], vista) ? vista : defaults.vista,
    soloIndispensabili: dev ? false : indispensabili === "no" ? false : indispensabili === "si" ? true : defaults.soloIndispensabili,
    catalogo,
    tipo: catalogo && isVocab(ITEM_KINDS, tipo) ? tipo : null,
    argomento: argomento !== null && MODULE_KEY.test(argomento) ? argomento : null,
    // Il cliente filtra solo «Senza referente», per assegnarle: mai un collega, che darebbe nei conteggi i suoi progressi (art. 15.4, §3.9.3).
    referente: referente === NONE ? (dev ? null : NONE) : ls && referente !== null && UUID.test(referente) ? referente : null,
    ruolo: !dev && ruolo !== null && ROLE_KEY.test(ruolo) ? ruolo : null,
    stato: ls && isVocab(ITEM_STATUSES, stato) ? stato : null,
    riservatezza: ls && isVocab(PRIVACY_CLASSES, riservatezza) ? riservatezza : null,
    perimetro: !dev && isVocab(PERIMETER_FILTERS, perimetro) ? perimetro : null,
    q: q !== null ? q.slice(0, MAX_Q) : null,
    pagina: Number.isFinite(page) && page >= 1 ? Math.min(page, MAX_PAGE) : 1,
  };
}

/** Query string → filtri di Domande (la selezione «tutte le N» arriva da un'azione con la query della pagina). */
export function parseQuestionQuery(query: string, audience: QuestionAudience, defaults: QuestionDefaults): QuestionFilter {
  return parseQuestionFilter(searchParamsOf(query), audience, defaults);
}

/** I filtri del pannello «Filtri» (vista, interruttore, ricerca e pagina esclusi). */
const QUESTION_FILTER_KEYS = ["catalogo", "tipo", "argomento", "referente", "ruolo", "stato", "riservatezza", "perimetro"] as const;
export type QuestionFilterKey = (typeof QUESTION_FILTER_KEYS)[number];

/** Almeno un filtro del pannello è attivo (la ricerca no: ha la sua casella). */
export function hasActiveQuestionFilter(filter: QuestionFilter): boolean {
  return QUESTION_FILTER_KEYS.some((k) => (k === "catalogo" ? filter.catalogo : filter[k] !== null));
}

/** I filtri del pannello tolti; vista, interruttore e ricerca restano. */
export function withoutQuestionFilters(filter: QuestionFilter): QuestionFilter {
  return { ...filter, catalogo: false, tipo: null, argomento: null, referente: null, ruolo: null, stato: null, riservatezza: null, perimetro: null, pagina: 1 };
}

/** La casella della ricerca rispetto all'URL: il `q` che vede adesso e i testi che ha mandato e non sono ancora tornati. */
export interface SearchBoxSync {
  urlQ: string;
  sent: readonly string[];
}

/** Quanti testi mandati si ricordano: una navigazione persa non resta in coda per sempre. */
const SEARCH_SENT_MAX = 10;

/** Il testo che la barra ha appena mandato con una navigazione. */
export function searchSent(sync: SearchBoxSync, q: string): SearchBoxSync {
  return { urlQ: sync.urlQ, sent: [...sync.sent, q].slice(-SEARCH_SENT_MAX) };
}

/**
 * L'URL ha un `q` nuovo. Se è un testo che la barra ha mandato, è la sua eco:
 * chi sta scrivendo continua (`box` null). Altrimenti la navigazione viene da
 * fuori («Togli i filtri», indietro, un link) e la casella prende il testo
 * dell'URL, invece di rimandare il vecchio dopo 300 ms.
 */
export function followUrlSearch(sync: SearchBoxSync, urlQ: string): { sync: SearchBoxSync; box: string | null } {
  if (sync.urlQ === urlQ) return { sync, box: null };
  const at = sync.sent.indexOf(urlQ);
  if (at >= 0) return { sync: { urlQ, sent: sync.sent.slice(at + 1) }, box: null };
  return { sync: { urlQ, sent: [] }, box: urlQ };
}

/**
 * Query string di Domande (con `?`, vuota per la vista predefinita). Scrive
 * solo ciò che differisce dai predefiniti; con `explicit` scrive sempre
 * `vista` e `indispensabili` (per la selezione, che non conosce i
 * predefiniti). Cambiare un filtro riporta alla prima pagina.
 */
export function questionQuery(
  filter: QuestionFilter,
  defaults: QuestionDefaults,
  patch: Partial<QuestionFilter> = {},
  opts: { explicit?: boolean; extra?: Readonly<Record<string, string>> } = {},
): string {
  const next: QuestionFilter = { ...filter, ...patch };
  if (!("pagina" in patch)) next.pagina = 1;
  if (!next.catalogo) next.tipo = null;
  const params = new URLSearchParams();
  if (opts.explicit || next.vista !== defaults.vista) params.set("vista", next.vista);
  if (opts.explicit || next.soloIndispensabili !== defaults.soloIndispensabili) params.set("indispensabili", next.soloIndispensabili ? "si" : "no");
  if (next.catalogo) params.set("mostra", "catalogo");
  if (next.tipo) params.set("tipo", next.tipo);
  for (const k of ["argomento", "referente", "ruolo", "stato", "riservatezza", "perimetro", "q"] as const) {
    const v = next[k];
    if (v !== null && v !== "") params.set(k, v);
  }
  if (next.pagina > 1) params.set("pagina", String(next.pagina));
  for (const [k, v] of Object.entries(opts.extra ?? {})) params.set(k, v);
  const s = params.toString();
  return s ? `?${s}` : "";
}

export interface QuestionWhereContext {
  /** Chi guarda: i quattro occhi di «Da verificare». */
  userId: string;
  audience: QuestionAudience;
}

/** La fase del via allo sviluppo (G1) in `serves_for`: `GATE_PHASE.G1` di `gates.ts` (il test lo controlla). */
export const VIA_PHASE = "modello";

/** Domanda indispensabile (alias `i`): richiesta dal via allo sviluppo, come `isRequired` di `gates.ts`. */
export function requiredForViaSql(): SqlFragment {
  return ucSql`(i.in_gate_scope AND i.priority = 'must' AND i.perimeter = 'in_contratto' AND i.serves_for @> ${jsonb([VIA_PHASE])})`;
}

/** Quattro occhi (alias `i`): chi guarda non ha risposto e non ha copiato il link della risposta. */
export function notMineSql(userId: string): SqlFragment {
  const me = cast(userId, "uuid");
  return ucSql`(NOT EXISTS (SELECT 1 FROM uc_answers x WHERE x.item_id = i.id AND x.responder_user_id = ${me})
    AND NOT EXISTS (SELECT 1 FROM uc_answers ca JOIN uc_request_tokens t ON t.request_id = ca.request_id
      WHERE ca.id = i.current_answer_id AND t.issued_by_user_id = ${me}))`;
}

/** Stati di ogni gruppo (§2.6). */
const SEGMENT_STATUSES: Readonly<Record<Exclude<QuestionSegment, "tutte">, readonly ItemStatus[]>> = {
  "da-fare": ["da_chiedere", "chiesta", "mancante", "parziale"],
  "da-verificare": ["in_verifica"],
  bloccate: ["bloccata"],
  "a-posto": ["validata", "non_applicabile"],
};

function statusIn(statuses: readonly ItemStatus[]): SqlFragment {
  return raw(`i.status IN (${statuses.map((s) => `'${s}'`).join(", ")})`);
}

/**
 * Condizione di un segmento; null per «Tutte». «Da verificare» per Lateral
 * Space applica i quattro occhi: le risposte date da chi guarda le verifica un
 * collega (§3.6.3).
 */
export function segmentConditionSql(segment: QuestionSegment, ctx: QuestionWhereContext): SqlFragment | null {
  if (segment === "tutte") return null;
  const cond = statusIn(SEGMENT_STATUSES[segment]);
  return segment === "da-verificare" && ctx.audience === "ls" ? ucSql`${cond} AND ${notMineSql(ctx.userId)}` : cond;
}

/**
 * Condizioni di Domande su `uc_items i` senza il segmento: caso, voci non
 * cancellate, tipo (domande, oppure il catalogo), interruttore, filtri e
 * ricerca. `without` toglie un filtro (per contare le sue opzioni).
 */
export function questionBaseWhereSql(caseId: string, filter: QuestionFilter, ctx: QuestionWhereContext, without?: "tipo"): SqlFragment {
  const parts: SqlFragment[] = [ucSql`i.case_id = ${cast(caseId, "uuid")}`, raw("i.deleted_at IS NULL")];
  if (ctx.audience === "sviluppatore") parts.push(statusIn(VALIDATED_STATUSES));
  if (!filter.catalogo) parts.push(raw(`i.kind = '${DEFAULT_KIND}'`));
  else if (filter.tipo && without !== "tipo") parts.push(ucSql`i.kind = ${cast(filter.tipo, "text")}`);
  if (filter.soloIndispensabili) parts.push(requiredForViaSql());
  if (filter.stato) parts.push(ucSql`i.status = ${cast(filter.stato, "text")}`);
  if (filter.referente === NONE) parts.push(raw("i.assignee_contact_id IS NULL"));
  else if (filter.referente) parts.push(ucSql`i.assignee_contact_id = ${cast(filter.referente, "uuid")}`);
  if (filter.argomento) parts.push(ucSql`i.request_module_key = ${cast(filter.argomento, "text")}`);
  if (filter.ruolo) parts.push(ucSql`i.owner_role_key = ${cast(filter.ruolo, "text")}`);
  if (filter.riservatezza) parts.push(ucSql`i.privacy_class = ${cast(filter.riservatezza, "text")}`);
  if (filter.perimetro === "fuori") parts.push(raw("i.perimeter = 'evoluzione'"));
  else if (filter.perimetro === "nel") parts.push(raw("i.perimeter IS DISTINCT FROM 'evoluzione'"));
  if (filter.q) {
    // Si cerca anche per chiave: incollare `q.x.12` trova la domanda (§1, principio 3).
    const q = cast(filter.q.toLowerCase(), "text");
    parts.push(ucSql`(strpos(lower(i.key), ${q}) > 0 OR strpos(lower(i.title), ${q}) > 0)`);
  }
  return join(parts, " AND ");
}

/** Condizioni complete: quelle di base più il segmento. */
export function questionWhereSql(caseId: string, filter: QuestionFilter, ctx: QuestionWhereContext): SqlFragment {
  const base = questionBaseWhereSql(caseId, filter, ctx);
  const segment = segmentConditionSql(filter.vista, ctx);
  return segment ? ucSql`${base} AND ${segment}` : base;
}

/** Stati in cui una domanda senza referente aspetta qualcuno a cui chiederla. */
const TO_ASSIGN = statusIn(["da_chiedere", "mancante", "parziale", "bloccata"]);

/**
 * Conteggi per argomento con i filtri di base (senza segmento): totale e a
 * posto per il sottotitolo del gruppo, i gruppi per i segmenti, le domande
 * senza referente e quelle fuori contratto. Una riga per argomento.
 */
export function questionCountsSql(caseId: string, filter: QuestionFilter, ctx: QuestionWhereContext): UcStatement {
  const verify = segmentConditionSql("da-verificare", ctx) ?? raw("false");
  return toStatement(ucSql`SELECT i.request_module_key AS m,
  count(*)::int AS n,
  count(*) FILTER (WHERE ${statusIn(SEGMENT_STATUSES["a-posto"])})::int AS a_posto,
  count(*) FILTER (WHERE ${statusIn(SEGMENT_STATUSES["da-fare"])})::int AS da_fare,
  count(*) FILTER (WHERE ${verify})::int AS da_verificare,
  count(*) FILTER (WHERE i.status = 'in_verifica')::int AS in_verifica,
  count(*) FILTER (WHERE i.status = 'bloccata')::int AS bloccate,
  count(*) FILTER (WHERE i.assignee_contact_id IS NULL AND i.response_type IS NOT NULL AND ${TO_ASSIGN})::int AS senza_referente,
  count(*) FILTER (WHERE i.perimeter = 'evoluzione')::int AS fuori
FROM uc_items i
WHERE ${questionBaseWhereSql(caseId, filter, ctx)}
GROUP BY 1`);
}

/** Classi i cui valori non escono dal database (come la fotografia del catalogo). */
const HIDDEN_VALUE_CLASSES = raw("i.privacy_class IN ('personale', 'personale_equipaggio', 'escluso_sanitario')");

/**
 * Ordine di Domande (§3.6.1): per argomento nell'ordine dello schema, dentro
 * l'argomento prima le indispensabili, poi l'ordine dello schema. «Da
 * verificare» va dalla risposta più vecchia (§3.6.3).
 */
function questionOrderSql(filter: QuestionFilter): SqlFragment {
  if (filter.vista === "da-verificare") return raw("a.created_at NULLS LAST, i.sort_order, i.key");
  return raw("mo.ord NULLS LAST, (i.priority = 'must') DESC, i.sort_order, i.key");
}

/**
 * Ordine degli argomenti nello schema del caso (letto una volta, non per riga):
 * le chiavi dei moduli arrivano dalla memoria per impronta, la definizione si
 * apre solo per un template che il processo non ha ancora visto (DESIGN §7.1
 * P0-5 b).
 */
function moduleOrderCte(caseId: string): SqlFragment {
  return ucSql`mo AS (SELECT m.elem ->> 'key' AS key, m.ord
  FROM uc_cases c JOIN uc_templates t ON t.id = c.template_id
  CROSS JOIN LATERAL jsonb_array_elements(${templateKeyListSql("request_modules")})
    WITH ORDINALITY AS m(elem, ord)
  WHERE c.id = ${cast(caseId, "uuid")})`;
}

/**
 * Una pagina di Domande (50 righe) con la risposta corrente: valore (mai per
 * le classi personali e sanitarie), chi ha risposto e quando, l'esito dei
 * controlli automatici sulla risposta, il primo blocco attivo delle bloccate.
 */
export function questionPageSql(caseId: string, filter: QuestionFilter, ctx: QuestionWhereContext): UcStatement {
  const offset = Math.max(0, Math.floor(filter.pagina) - 1) * QUESTIONS_PAGE_SIZE;
  return toStatement(ucSql`WITH ${moduleOrderCte(caseId)}
SELECT i.id, i.key, i.kind, i.title, i.status, i.status_reason, i.priority, i.privacy_class, i.value_visibility, i.perimeter,
  i.request_module_key, i.owner_role_key, i.assignee_contact_id, i.due_at, i.response_type,
  a.created_at AS a_at, a.kind AS a_kind, a.source_kind AS a_source_kind, a.confidence AS a_confidence,
  CASE WHEN ${HIDDEN_VALUE_CLASSES} OR a.erased_at IS NOT NULL THEN NULL ELSE a.value END AS a_value,
  a.value_encrypted IS NOT NULL AS a_encrypted, a.erased_at IS NOT NULL AS a_erased,
  rc.display_name AS a_responder,
  (SELECT jsonb_build_object('avvisi', count(*) FILTER (WHERE v.outcome = 'avviso'), 'errori', count(*) FILTER (WHERE v.outcome = 'errore'),
      'primo', (array_agg(v.message ORDER BY (v.outcome = 'errore') DESC, v.created_at))[1])
    FROM uc_validations v
    WHERE v.item_id = i.id AND v.answer_id = i.current_answer_id AND v.kind = 'automatica' AND v.outcome IN ('errore', 'avviso')) AS checks,
  CASE WHEN i.status = 'bloccata' THEN (SELECT b.key FROM uc_item_blockers ib JOIN uc_blockers b ON b.id = ib.blocker_id
    WHERE ib.item_id = i.id AND b.status IN ('attivo', 'permanente') ORDER BY b.key LIMIT 1) END AS lock_key
FROM uc_items i
LEFT JOIN mo ON mo.key = i.request_module_key
LEFT JOIN uc_answers a ON a.id = i.current_answer_id
LEFT JOIN uc_contacts rc ON rc.id = a.responder_contact_id
WHERE ${questionWhereSql(caseId, filter, ctx)}
ORDER BY ${questionOrderSql(filter)}
LIMIT ${cast(QUESTIONS_PAGE_SIZE, "int")} OFFSET ${cast(offset, "int")}`);
}

/** Massimo di domande in una selezione «tutte le N». */
export const QUESTION_SELECTION_MAX = 5000;

/** Id e stato delle domande della selezione «tutte le N»: stesse condizioni della pagina (una riga in più dice che il limite è superato). */
export function questionSelectionSql(caseId: string, filter: QuestionFilter, ctx: QuestionWhereContext): UcStatement {
  return toStatement(ucSql`SELECT i.id, i.status FROM uc_items i
WHERE ${questionWhereSql(caseId, filter, ctx)}
ORDER BY i.sort_order, i.key
LIMIT ${cast(QUESTION_SELECTION_MAX + 1, "int")}`);
}

/** Voci del caso (tutti i tipi), per «Mostra: Tutto il catalogo (2.812)»; lo sviluppatore conta solo le voci a posto. */
export function catalogSizeSql(caseId: string, audience: QuestionAudience): UcStatement {
  const validated = audience === "sviluppatore" ? ucSql` AND ${statusIn(VALIDATED_STATUSES)}` : raw("");
  return toStatement(ucSql`SELECT count(*)::int AS n FROM uc_items i WHERE i.case_id = ${cast(caseId, "uuid")} AND i.deleted_at IS NULL${validated}`);
}

/** Documenti richiesti (fonti, documenti, risposte con un file o un dataset), per il segmento «Documenti». */
export function requiredDocumentsCountSql(caseId: string, audience: QuestionAudience): UcStatement {
  const validated = audience === "sviluppatore" ? ucSql` AND ${statusIn(VALIDATED_STATUSES)}` : raw("");
  return toStatement(ucSql`SELECT count(*)::int AS n FROM uc_items i
WHERE i.case_id = ${cast(caseId, "uuid")} AND i.deleted_at IS NULL
  AND (i.kind IN ('fonte', 'documento') OR i.response_type IN ('file', 'dataset'))${validated}`);
}

/** Voci per tipo, con i filtri di base tranne il tipo (le opzioni di «Tipo» con il catalogo intero). */
export function questionKindFacetSql(caseId: string, filter: QuestionFilter, ctx: QuestionWhereContext): UcStatement {
  return toStatement(ucSql`SELECT i.kind AS v, count(*)::int AS n FROM uc_items i WHERE ${questionBaseWhereSql(caseId, filter, ctx, "tipo")} GROUP BY 1`);
}

/**
 * Coda di «Verifica una alla volta» (§3.6.4): le risposte da verificare dalla
 * più vecchia, di ogni tipo di voce, come il conto del prossimo passo. `mine`
 * dice se la risposta è di chi guarda (la verifica un collega): restano fuori
 * dalla coda ma si contano.
 */
export function reviewQueueSql(caseId: string, userId: string): UcStatement {
  return toStatement(ucSql`SELECT i.id, NOT ${notMineSql(userId)} AS mine
FROM uc_items i
LEFT JOIN uc_answers a ON a.id = i.current_answer_id
WHERE i.case_id = ${cast(caseId, "uuid")} AND i.deleted_at IS NULL AND i.status = 'in_verifica'
ORDER BY a.created_at NULLS LAST, i.sort_order, i.key
LIMIT 5000`);
}
