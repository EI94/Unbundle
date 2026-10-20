/**
 * Attività del caso (DESIGN §3.12, PIANO §7.2, §3.3, D40): filtri, condizioni
 * SQL, frasi della linea del tempo ed export CSV degli eventi `uc_events`.
 *
 * Ruoli del cliente (responsabile del cliente, approvatore privacy): il filtro
 * dell'art. 15.4 sta nella query, anche per l'export. Niente eventi dei
 * referenti, niente `link.aperto` né `informativa.vista`; al loro posto le
 * risposte ricevute contate per giorno, e un giorno si mostra solo con almeno
 * 5 risposte (le altre si sommano in una riga sola). Nessuna statistica su
 * aperture, «Non lo so», deleghe o tempi.
 *
 * La pagina mostra una frase per evento, raggruppata per giorno: chi ha fatto
 * cosa, con il titolo della domanda al posto della chiave. Le chiavi, gli stati
 * in codice e i conteggi restano nel CSV («Dettagli»).
 *
 * Modulo puro (condizioni SQL come frammenti con parametri).
 */
import { csvCell } from "../../learning/policy.ts";
import { CASE_STATUS_LABEL } from "../case-state.ts";
import { cast, join, raw, ucSql, type SqlFragment } from "../sql/statement.ts";
import { CASE_STATUSES, EVENT_ACTOR_TYPES, ITEM_STATUSES, isVocab, type CaseRole, type CaseStatus, type EventActorType, type ItemStatus } from "../vocab.ts";
import { periodDay } from "./activity-period.ts";
import { formatCountIt, formatDayIt } from "./format.ts";
import { ROLE_LABEL, blockerLabel } from "./labels.ts";
import { statusView, type Audience } from "./status-groups.ts";

/** Righe per pagina del vecchio Registro (lo legge ancora `loadAuditPage` di `uc-shell.ts`). */
export const AUDIT_PAGE_SIZE = 100;
/** Eventi per pagina di Attività (DESIGN §3.12). */
export const ACTIVITY_PAGE_SIZE = 50;
/** Soglia minima degli aggregati sui referenti (PIANO §3.3, `suppressSmallSplit`). */
export const AUDIT_MIN_DAILY = 5;

/** Eventi che i ruoli del cliente non vedono mai, oltre a quelli fatti dai referenti. */
export const CLIENT_HIDDEN_EVENT_TYPES: readonly string[] = ["link.aperto", "informativa.vista"];

/** Famiglie di eventi per il filtro «Tipo», con l'etichetta (§2.6: domande, via allo sviluppo, attività). */
export const AUDIT_FAMILIES: Readonly<Record<string, string>> = {
  caso: "Caso",
  membro: "Persone del caso",
  referente: "Referenti",
  firmatario: "Chi firma per il cliente",
  voce: "Domande",
  risposta: "Risposte",
  validazione: "Controlli",
  commento: "Commenti",
  chiarimento: "Chiarimenti",
  richiesta: "Richieste",
  link: "Link",
  delega: "Deleghe",
  informativa: "Informativa privacy",
  file: "File",
  dataset: "Dataset",
  blocco: "Blocchi",
  gate: "Via allo sviluppo",
  catalogo: "Catalogo",
  registro: "Download dell'attività",
  casi_prova: "Casi di prova",
  seed: "Stato di partenza",
  notifica: "Notifiche",
};

const CLIENT_HIDDEN_FAMILIES: readonly string[] = ["link", "informativa"];

export function auditFamiliesFor(clientView: boolean): { key: string; label: string }[] {
  return Object.entries(AUDIT_FAMILIES)
    .filter(([k]) => !clientView || !CLIENT_HIDDEN_FAMILIES.includes(k))
    .map(([key, label]) => ({ key, label }));
}

export const AUDIT_ACTOR_LABEL: Readonly<Record<EventActorType, string>> = {
  utente: "Persona con account",
  referente: "Referente",
  sistema: "Sistema",
  mcp: "Claude via MCP",
};

/**
 * «Chi» del filtro di Attività (parametro `chi`): Lateral Space e persone del
 * cliente si distinguono dall'email verificata (domini di Lateral Space), come
 * nel resto della sezione. I referenti solo per l'attività completa.
 */
export const AUDIT_WHO = ["ls", "cliente", "referenti", "sistema", "claude"] as const;
export type AuditWho = (typeof AUDIT_WHO)[number];

export const AUDIT_WHO_LABEL: Readonly<Record<AuditWho, string>> = {
  ls: "Lateral Space",
  cliente: "Persone del cliente",
  referenti: "Referenti",
  sistema: "In automatico",
  claude: "Claude",
};

export function auditWhoFor(clientView: boolean): { key: AuditWho; label: string }[] {
  return AUDIT_WHO.filter((w) => !clientView || w !== "referenti").map((key) => ({ key, label: AUDIT_WHO_LABEL[key] }));
}

/** Etichette degli eventi in italiano semplice (CSV, registro degli accessi della Privacy). */
export const AUDIT_EVENT_LABEL: Readonly<Record<string, string>> = {
  "caso.creato": "Dossier creato",
  "caso.importato": "Dossier importato",
  "caso.stato_cambiato": "Stato del caso cambiato",
  "caso.descrizione_modificata": "Descrizione modificata",
  "caso.ambiente_ai": "Ambiente AI registrato",
  "caso.regola_gate_confermata": "Regola del via allo sviluppo confermata",
  "membro.aggiunto": "Persona aggiunta al caso",
  "membro.rimosso": "Persona tolta dal caso",
  "membro.zona_personale": "Accesso ai dati personali",
  "referente.creato": "Referente aggiunto",
  "referente.modificato": "Referente modificato",
  "referente.anonimizzato": "Referente anonimizzato",
  "firmatario.designato": "Firmatario indicato",
  "voce.creata": "Domanda aggiunta",
  "voce.modificata": "Domanda modificata",
  "voce.classe_privacy_cambiata": "Riservatezza cambiata",
  "voce.stato_cambiato": "Stato della domanda cambiato",
  "voce.stato_importato": "Stati iniziali importati",
  "voce.assegnata": "Domanda assegnata",
  "voce.na_proposta": "Proposta «Non si applica»",
  "voce.na_firmata": "Firma su «Non si applica»",
  "voce.na_respinta": "«Non si applica» respinta",
  "voce.deroga_firmata": "Firma su «Partire senza risposta»",
  "voce.ripiego_firmato": "Firma sulla soluzione provvisoria",
  "risposta.inviata": "Risposta ricevuta",
  "risposta.letta_personale": "Dato personale letto",
  "risposta.cancellata_privacy": "Dato personale cancellato",
  "validazione.registrata": "Controllo registrato",
  "commento.creato": "Commento aggiunto",
  "chiarimento.richiesto": "Chiarimento chiesto",
  "chiarimento.risolto": "Chiarimento chiuso",
  "richiesta.creata": "Richiesta preparata",
  "richiesta.inviata": "Richiesta inviata",
  "richiesta.promemoria": "Promemoria inviato",
  "richiesta.revocata": "Richiesta revocata",
  "richiesta.scaduta": "Richiesta scaduta",
  "richiesta.prorogata": "Scadenza della richiesta spostata",
  "link.aperto": "Link aperto",
  "link.copiato": "Link copiato",
  "link.revocati_tutti": "Tutti i link revocati",
  "delega.creata": "Domande girate a un collega",
  "delega.approvata": "Delega approvata",
  "informativa.vista": "Informativa privacy letta",
  "file.caricato": "File caricato",
  "file.rifiutato": "File rifiutato",
  "file.revisionato": "File controllato",
  "file.scaricato": "File scaricato",
  "file.cancellato": "File cancellato",
  "dataset.creato": "Dataset registrato",
  "dataset.validato": "Dataset validato",
  "blocco.attivato": "Blocco attivato",
  "blocco.firmato": "Firma su un blocco",
  "blocco.sciolto": "Blocco sciolto",
  "blocco.riattivato": "Blocco riattivato",
  "gate.proposto": "Via allo sviluppo proposto",
  "gate.firmato": "Firma sul via allo sviluppo",
  "gate.approvato": "Via allo sviluppo approvato",
  "gate.respinto": "Via allo sviluppo respinto",
  "catalogo.congelato": "Catalogo congelato",
  "catalogo.esportato": "Catalogo scaricato",
  "catalogo.letto_mcp": "Catalogo letto da Claude",
  "registro.esportato": "Attività scaricata",
  "casi_prova.importati": "Casi di prova importati",
  "template.caricato": "Schema di partenza caricato",
  "seed.applicato": "Stato di partenza caricato",
  "seed.valore_omesso": "Valore già dichiarato non caricato",
  "notifica.inviata": "Notifica inviata",
  "notifica.errore": "Notifica non riuscita",
};

export function auditEventLabel(type: string): string {
  const known = AUDIT_EVENT_LABEL[type];
  if (known) return known;
  const t = type.replace(/[._]/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : type;
}

// ── Filtri ────────────────────────────────────────────────────────────

export interface AuditFilter {
  famiglia: string | null;
  /** Vecchio filtro per tipo di attore (`attore`): resta per i link del Registro. */
  attore: EventActorType | null;
  /** «Chi» di Attività (`chi`): vince su `attore`. */
  chi: AuditWho | null;
  /** `YYYY-MM-DD`, giorno di Roma, compreso. */
  dal: string | null;
  al: string | null;
  pagina: number;
}

export const EMPTY_AUDIT_FILTER: Readonly<AuditFilter> = Object.freeze({ famiglia: null, attore: null, chi: null, dal: null, al: null, pagina: 1 });

type SearchParams = Readonly<Record<string, string | string[] | undefined>> | URLSearchParams;

function first(sp: SearchParams, key: string): string | null {
  const v = sp instanceof URLSearchParams ? sp.get(key) : sp[key];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s.trim() !== "" ? s.trim() : null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Filtri dall'URL; i valori non ammessi diventano «nessun filtro». Per il
 * cliente niente famiglie nascoste né referenti. Con `chi` il vecchio `attore`
 * non conta.
 */
export function parseAuditFilter(sp: SearchParams, clientView: boolean): AuditFilter {
  const famiglia = first(sp, "tipo");
  const attore = first(sp, "attore");
  const chi = first(sp, "chi");
  const pagina = Number(first(sp, "pagina") ?? "1");
  const allowedFamily = famiglia && famiglia in AUDIT_FAMILIES && !(clientView && CLIENT_HIDDEN_FAMILIES.includes(famiglia));
  const allowedWho = isVocab(AUDIT_WHO, chi) && !(clientView && chi === "referenti");
  const allowedActor = !allowedWho && isVocab(EVENT_ACTOR_TYPES, attore) && !(clientView && attore === "referente");
  return {
    famiglia: allowedFamily ? famiglia : null,
    attore: allowedActor ? (attore as EventActorType) : null,
    chi: allowedWho ? (chi as AuditWho) : null,
    dal: periodDay(first(sp, "dal")),
    al: periodDay(first(sp, "al")),
    pagina: Number.isInteger(pagina) && pagina >= 1 && pagina <= 10_000 ? pagina : 1,
  };
}

/** Query string dei filtri (senza la pagina 1). */
export function auditQuery(f: AuditFilter, patch: Partial<AuditFilter> = {}): string {
  const next = { ...f, ...patch };
  const p = new URLSearchParams();
  if (next.famiglia) p.set("tipo", next.famiglia);
  if (next.chi) p.set("chi", next.chi);
  else if (next.attore) p.set("attore", next.attore);
  if (next.dal) p.set("dal", next.dal);
  if (next.al) p.set("al", next.al);
  if (next.pagina > 1) p.set("pagina", String(next.pagina));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Quanti filtri sono attivi (il periodo conta una volta sola). */
export function activeAuditFilters(f: AuditFilter): number {
  return (f.famiglia ? 1 : 0) + (f.chi || f.attore ? 1 : 0) + (f.dal || f.al ? 1 : 0);
}

/**
 * L'utente che ha agito è di Lateral Space: email verificata con il dominio
 * esattamente nell'elenco (come `isLateralSpaceEmail`: il dominio è ciò che
 * segue l'ultima chiocciola, in minuscolo). Alias `e` = `uc_events`.
 */
export function eventActorIsLsSql(lsDomains: readonly string[]): SqlFragment {
  return ucSql`EXISTS (SELECT 1 FROM users lu WHERE lu.id = e.actor_user_id AND lu.email_verified IS NOT NULL
  AND lower(regexp_replace(btrim(lu.email), '^.*@', '')) = ANY(${cast([...lsDomains], "text[]")}))`;
}

function whoSql(who: AuditWho, lsDomains: readonly string[]): SqlFragment {
  switch (who) {
    case "ls":
      return ucSql`(e.actor_type = 'utente' AND ${eventActorIsLsSql(lsDomains)})`;
    case "cliente":
      return ucSql`(e.actor_type = 'utente' AND NOT ${eventActorIsLsSql(lsDomains)})`;
    case "referenti":
      return raw(`e.actor_type = 'referente'`);
    case "sistema":
      return raw(`e.actor_type = 'sistema'`);
    case "claude":
      return raw(`e.actor_type = 'mcp'`);
  }
}

/**
 * Condizioni sugli eventi del caso (alias `e` = `uc_events`). Il caso è sempre
 * anche del workspace; per i ruoli del cliente il filtro dell'art. 15.4.
 * `lsDomains` serve al filtro «Chi» (Lateral Space o cliente): senza, nessuno
 * conta come Lateral Space.
 */
export function auditWhereSql(i: { workspaceId: string; caseId: string; filter: AuditFilter; clientView: boolean; lsDomains?: readonly string[] }): SqlFragment {
  const parts: SqlFragment[] = [ucSql`e.case_id = ${cast(i.caseId, "uuid")}`, ucSql`e.workspace_id = ${cast(i.workspaceId, "uuid")}`];
  if (i.clientView) {
    parts.push(raw(`e.actor_type <> 'referente'`));
    parts.push(ucSql`NOT (e.event_type = ANY(${cast([...CLIENT_HIDDEN_EVENT_TYPES], "text[]")}))`);
  }
  if (i.filter.famiglia) parts.push(ucSql`e.event_type LIKE ${cast(`${i.filter.famiglia}.%`, "text")}`);
  if (i.filter.chi) parts.push(whoSql(i.filter.chi, i.lsDomains ?? []));
  else if (i.filter.attore) parts.push(ucSql`e.actor_type = ${cast(i.filter.attore, "text")}`);
  if (i.filter.dal) parts.push(ucSql`(e.created_at AT TIME ZONE 'Europe/Rome')::date >= ${cast(i.filter.dal, "date")}`);
  if (i.filter.al) parts.push(ucSql`(e.created_at AT TIME ZONE 'Europe/Rome')::date <= ${cast(i.filter.al, "date")}`);
  return join(parts, " AND ");
}

/**
 * Condizioni delle risposte dei referenti contate per giorno (solo per i ruoli
 * del cliente): stesse date del filtro; con un filtro di famiglia o di attore
 * che le esclude, nessuna riga.
 */
export function referentAnswersWhereSql(i: { workspaceId: string; caseId: string; filter: AuditFilter }): SqlFragment | null {
  if (i.filter.famiglia && i.filter.famiglia !== "risposta") return null;
  if (i.filter.attore || i.filter.chi) return null;
  const parts: SqlFragment[] = [
    ucSql`e.case_id = ${cast(i.caseId, "uuid")}`,
    ucSql`e.workspace_id = ${cast(i.workspaceId, "uuid")}`,
    raw(`e.actor_type = 'referente'`),
    raw(`e.event_type = 'risposta.inviata'`),
  ];
  if (i.filter.dal) parts.push(ucSql`(e.created_at AT TIME ZONE 'Europe/Rome')::date >= ${cast(i.filter.dal, "date")}`);
  if (i.filter.al) parts.push(ucSql`(e.created_at AT TIME ZONE 'Europe/Rome')::date <= ${cast(i.filter.al, "date")}`);
  return join(parts, " AND ");
}

/**
 * Giorni con almeno `min` risposte; gli altri sommati in una riga sola, senza
 * date, e solo se anche la somma arriva a `min` (con un filtro su un giorno
 * solo la somma direbbe quante risposte ha dato una persona quel giorno).
 *
 * Con un periodo (`dal`/`al`, `period: true`) la somma non c'è: chi sceglie
 * le date toglierebbe la somma di un periodo da quella di un altro e avrebbe
 * il numero esatto di un giorno sotto la soglia. Escono solo i giorni da
 * `min` in su.
 */
export function dailyCountsAboveThreshold(
  rows: readonly { day: string; count: number }[],
  o: { min?: number; period?: boolean } = {},
): { days: { day: string; count: number }[]; below: number } {
  const min = o.min ?? AUDIT_MIN_DAILY;
  const days = rows.filter((r) => r.count >= min).sort((a, b) => b.day.localeCompare(a.day));
  if (o.period) return { days, below: 0 };
  const below = rows.filter((r) => r.count < min).reduce((n, r) => n + r.count, 0);
  return { days, below: below >= min ? below : 0 };
}

/** Il filtro ha un periodo (`dal` o `al`): le risposte sotto la soglia non si sommano. */
export function auditHasPeriod(f: Pick<AuditFilter, "dal" | "al">): boolean {
  return f.dal !== null || f.al !== null;
}

// ── Righe ─────────────────────────────────────────────────────────────

export interface AuditRow {
  id: string;
  at: string;
  type: string;
  actorType: EventActorType;
  /** Nome di chi ha agito (utenti; referenti solo per il registro completo). */
  actorName: string | null;
  targetType: string | null;
  fromState: string | null;
  toState: string | null;
  payload: Readonly<Record<string, unknown>>;
}

const DETAIL_KEYS: readonly [string, string][] = [
  ["item_key", "voce"],
  ["code", "caso"],
  ["blocker_key", "blocco"],
  ["gate", "gate"],
  ["designation", "firmatario"],
  ["role", "ruolo"],
  ["role_key", "ruolo"],
  ["ruolo", "firma come"],
  ["version", "versione"],
  ["catalog_version", "versione del catalogo"],
  ["format", "formato"],
  ["tool", "strumento"],
  ["kind", "tipo"],
  ["trigger", "causa"],
  ["reason", "motivo"],
  ["motivo", "motivo"],
  ["categoria", "categoria"],
  ["zona", "zona"],
  ["action", "azione"],
  ["scope", "regola"],
  ["outcome", "esito"],
  ["channel", "canale"],
  ["purpose", "scopo"],
  ["items", "voci"],
  ["count", "quante"],
  ["requests", "richieste"],
  ["required", "richieste dal gate"],
  ["ok", "a posto"],
  ["fields", "campi"],
  ["blocks", "blocchi"],
];

function detailValue(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "boolean") return v ? "sì" : "no";
  if (Array.isArray(v)) {
    const s = v.filter((x) => typeof x === "string" || typeof x === "number").join(", ");
    return s || null;
  }
  return null;
}

/** Dettagli tecnici di un evento per il CSV: stati, chiavi e conteggi. Mai valori (il payload non ne contiene). */
export function auditDetail(row: Pick<AuditRow, "fromState" | "toState" | "payload">): string {
  const parts: string[] = [];
  if (row.fromState || row.toState) parts.push(`${row.fromState ?? "—"} → ${row.toState ?? "—"}`);
  const seen = new Set<string>();
  for (const [key, label] of DETAIL_KEYS) {
    const v = detailValue(row.payload[key]);
    if (!v || seen.has(`${label}:${v}`)) continue;
    seen.add(`${label}:${v}`);
    parts.push(`${label}: ${v}`);
  }
  if (typeof row.payload.complete === "boolean") parts.push(row.payload.complete ? "firme complete" : "firme in attesa");
  return parts.join(" · ");
}

export function auditActorText(row: Pick<AuditRow, "actorType" | "actorName">): string {
  const base = AUDIT_ACTOR_LABEL[row.actorType] ?? row.actorType;
  return row.actorName ? `${row.actorName} (${base.toLowerCase()})` : base;
}

/** Data e ora di Roma, «12/10/2026 09:30». */
export function romeDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d).replace(", ", " ");
}

/** CSV dell'attività (`;` come separatore, per Excel in italiano); ogni cella passa da `csvCell`. */
export function auditCsv(rows: readonly AuditRow[], daily?: { days: { day: string; count: number }[]; below: number }): string {
  const lines = [["Data e ora", "Evento", "Chi", "Dettagli"].map(csvCell).join(";")];
  for (const r of rows) lines.push([romeDateTime(r.at), auditEventLabel(r.type), auditActorText(r), auditDetail(r)].map(csvCell).join(";"));
  if (daily) {
    for (const d of daily.days) lines.push([d.day, "Risposte ricevute", "Referenti", `${d.count}`].map(csvCell).join(";"));
    if (daily.below > 0) lines.push(["", "Risposte ricevute in altri giorni", "Referenti", `${daily.below}`].map(csvCell).join(";"));
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}

// ── Linea del tempo (DESIGN §3.12) ────────────────────────────────────

/** Una riga di Attività: l'evento, più chi è e il titolo della domanda (mai la chiave). */
export interface ActivityRow extends AuditRow {
  /** Chi ha agito, per unire le righe consecutive (`utente:<id>`, `referente:<id>`, `sistema`); mai mostrato. */
  actorKey: string;
  /** L'utente che ha agito è di Lateral Space (email verificata in un dominio di Lateral Space). */
  actorIsLs: boolean;
  /** Titolo della domanda dell'evento (`payload.item_key`), se c'è ancora. */
  itemTitle: string | null;
}

/** Una frase della linea del tempo: «Luca Verdi (Lateral Space)» + «ha validato «…»». */
export interface ActivityLine {
  id: string;
  /** «10:42», ora di Roma dell'evento più recente della riga. */
  time: string;
  /** Chi ha agito; null per ciò che succede in automatico (la frase è già intera). */
  who: string | null;
  text: string;
  /** Eventi uniti nella riga (più risposte dello stesso referente, per esempio). */
  count: number;
}

export interface ActivityDay {
  /** `YYYY-MM-DD`, giorno di Roma. */
  key: string;
  /** «Oggi», «Ieri», «3 giorni fa», poi «23 ott». */
  label: string;
  lines: ActivityLine[];
}

const ROME_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" });
const ROME_TIME = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit" });

/** Giorno di calendario di Roma, `YYYY-MM-DD`; null per una data non valida. */
export function romeDayKey(v: Date | string): string | null {
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : ROME_DAY.format(d);
}

/** «10:42», ora di Roma. */
export function romeTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : ROME_TIME.format(d);
}

/**
 * Intestazione di un giorno: relativa entro 7 giorni («Oggi», «Ieri», «3
 * giorni fa»), poi assoluta («23 ott», con l'anno se è un altro anno).
 */
export function activityDayLabel(dayKey: string, now: Date): string {
  const today = romeDayKey(now);
  if (!today || !ISO_DATE.test(dayKey)) return dayKey;
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dayKey}T00:00:00Z`)) / 86_400_000);
  if (days === 0) return "Oggi";
  if (days === 1) return "Ieri";
  if (days > 1 && days < 7) return `${days} giorni fa`;
  return formatDayIt(dayKey, { now }) ?? dayKey;
}

const TITLE_MAX = 80;

/** Il titolo tra virgolette, accorciato a una parola intera («Quanti preventivi si perdono…»). */
function quoted(title: string | null): string {
  if (!title?.trim()) return "una domanda";
  const t = title.trim().replace(/\s+/g, " ");
  if (t.length <= TITLE_MAX) return `«${t}»`;
  let cut = t.slice(0, TITLE_MAX - 1);
  const space = cut.lastIndexOf(" ");
  if (space > TITLE_MAX / 2) cut = cut.slice(0, space);
  return `«${cut.replace(/[\s,;:.]+$/, "")}…»`;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : `${formatCountIt(n)} ${many}`;
}

function payloadString(p: Readonly<Record<string, unknown>>, key: string): string | null {
  const v = p[key];
  return typeof v === "string" && v.trim() ? v : null;
}

function payloadCount(p: Readonly<Record<string, unknown>>, key: string): number | null {
  const v = p[key];
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
}

const FORMAT_LABEL: Readonly<Record<string, string>> = { json: "JSON", md: "Markdown", xlsx: "Excel", csv: "CSV" };
const CHECK_OUTCOME: Readonly<Record<string, string>> = { ok: "a posto", avviso: "con un avviso", errore: "con un errore" };
const ZONE_ACTION: Readonly<Record<string, string>> = {
  proposta: "ha proposto un accesso ai dati personali",
  firmata: "ha firmato un accesso ai dati personali",
  attivata: "ha attivato un accesso ai dati personali",
  revocata: "ha tolto un accesso ai dati personali",
};

/**
 * Come si dice un evento. `one` è la frase con chi ha agito come soggetto
 * («ha validato «…»»); `many` la stessa frase per n eventi uniti; `auto` la
 * frase intera quando l'evento è avvenuto in automatico. `group` distingue gli
 * eventi che si possono unire (stesso tipo e stessa variante).
 */
interface Phrase {
  one: string;
  many?: (n: number) => string;
  auto?: string;
  autoMany?: (n: number) => string;
  group?: string;
}

function caseStatusLabel(v: string | null): string | null {
  return v && isVocab(CASE_STATUSES, v) ? CASE_STATUS_LABEL[v as CaseStatus] : null;
}

function itemStateLabel(v: string | null, audience: Audience): string | null {
  return v && isVocab(ITEM_STATUSES, v) ? statusView(v as ItemStatus, audience).label : null;
}

function roleLabel(v: string | null): string | null {
  return v && v in ROLE_LABEL ? ROLE_LABEL[v as CaseRole] : null;
}

function catalogVersion(p: Readonly<Record<string, unknown>>): string {
  const v = p.version;
  if (v === "bozza") return "la bozza del catalogo";
  return typeof v === "number" && v > 0 ? `il catalogo v${v}` : "il catalogo";
}

function phraseOf(row: ActivityRow, audience: Audience): Phrase {
  const p = row.payload;
  const q = quoted(row.itemTitle);
  const label = auditEventLabel(row.type);
  switch (row.type) {
    case "caso.creato":
      return { one: "ha creato il dossier" };
    case "caso.importato":
      return { one: "ha importato il dossier" };
    case "caso.stato_cambiato": {
      const to = caseStatusLabel(row.toState ?? payloadString(p, "to"));
      return to ? { one: `ha portato il caso a «${to}»`, auto: `Il caso è passato a «${to}».` } : { one: "ha cambiato lo stato del caso" };
    }
    case "caso.descrizione_modificata":
      return { one: "ha modificato la descrizione", many: (n) => `ha modificato la descrizione ${formatCountIt(n)} volte`, group: "" };
    case "caso.ambiente_ai":
      return { one: p.approved === true ? "ha approvato l'ambiente AI" : "ha registrato l'ambiente AI" };
    case "caso.regola_gate_confermata":
      return { one: "ha confermato la regola del via allo sviluppo" };
    case "membro.aggiunto": {
      const role = roleLabel(payloadString(p, "role"));
      return { one: role ? `ha aggiunto una persona al caso come ${role}` : "ha aggiunto una persona al caso" };
    }
    case "membro.rimosso": {
      const role = roleLabel(payloadString(p, "role"));
      return { one: role ? `ha tolto una persona dal ruolo ${role}` : "ha tolto una persona dal caso" };
    }
    case "membro.zona_personale":
      return { one: ZONE_ACTION[payloadString(p, "action") ?? ""] ?? "ha cambiato un accesso ai dati personali" };
    case "referente.creato":
      return { one: "ha aggiunto un referente", many: (n) => `ha aggiunto ${formatCountIt(n)} referenti`, group: "" };
    case "referente.modificato":
      return { one: "ha modificato un referente", many: (n) => `ha modificato ${formatCountIt(n)} referenti`, group: "" };
    case "referente.anonimizzato":
      return { one: "ha anonimizzato un referente", many: (n) => `ha anonimizzato ${formatCountIt(n)} referenti`, group: "" };
    case "firmatario.designato": {
      const d = payloadString(p, "designation");
      return { one: d === "owner" ? "ha indicato il responsabile del cliente" : d === "privacy" ? "ha indicato chi firma la privacy" : "ha indicato chi firma per il cliente" };
    }
    case "voce.creata":
      return { one: `ha aggiunto ${q}`, many: (n) => `ha aggiunto ${formatCountIt(n)} domande`, group: "" };
    case "voce.modificata":
      return { one: `ha modificato ${q}`, many: (n) => `ha modificato ${formatCountIt(n)} domande`, group: "" };
    case "voce.classe_privacy_cambiata":
      return { one: `ha cambiato la riservatezza di ${q}`, many: (n) => `ha cambiato la riservatezza di ${formatCountIt(n)} domande`, group: "" };
    case "voce.stato_cambiato": {
      const to = itemStateLabel(row.toState, audience);
      if (!to) return { one: `ha cambiato lo stato di ${q}`, many: (n) => `ha cambiato lo stato di ${formatCountIt(n)} domande`, group: "" };
      if (row.toState === "validata") {
        return { one: `ha validato ${q}`, many: (n) => `ha validato ${formatCountIt(n)} domande`, auto: `${capitalize(q)} è a posto.`, autoMany: (n) => `${formatCountIt(n)} domande sono a posto.`, group: "validata" };
      }
      return {
        one: `ha portato ${q} a «${to}»`,
        many: (n) => `ha portato ${formatCountIt(n)} domande a «${to}»`,
        auto: `${capitalize(q)} è passata a «${to}».`,
        autoMany: (n) => `${formatCountIt(n)} domande sono passate a «${to}».`,
        group: row.toState ?? "",
      };
    }
    case "voce.stato_importato": {
      const n = payloadCount(p, "count");
      return { one: n !== null ? `ha importato lo stato di ${plural(n, "una domanda", "domande")}` : "ha importato lo stato delle domande" };
    }
    case "voce.assegnata": {
      const n = payloadCount(p, "count");
      if (!row.itemTitle && n !== null) return { one: `ha assegnato ${plural(n, "una domanda", "domande")}` };
      return { one: `ha assegnato ${q}`, many: (k) => `ha assegnato ${formatCountIt(k)} domande`, group: "" };
    }
    case "voce.na_proposta":
      return { one: `ha proposto «Non si applica» per ${q}` };
    case "voce.na_firmata":
      return { one: `ha firmato «Non si applica» per ${q}` };
    case "voce.na_respinta":
      return { one: `ha respinto «Non si applica» per ${q}` };
    case "voce.deroga_firmata":
      return { one: `ha firmato «Partire senza risposta» per ${q}` };
    case "voce.ripiego_firmato":
      return { one: `ha firmato la soluzione provvisoria per ${q}` };
    case "risposta.inviata":
      if (row.actorType === "utente") return { one: `ha registrato una risposta a ${q}`, many: (n) => `ha registrato ${formatCountIt(n)} risposte`, group: "" };
      return { one: `ha risposto a ${q}`, many: (n) => `ha risposto a ${formatCountIt(n)} domande`, group: "" };
    case "risposta.letta_personale":
      return { one: `ha letto un dato personale di ${q}`, many: (n) => `ha letto ${formatCountIt(n)} dati personali`, group: "" };
    case "risposta.cancellata_privacy":
      return { one: `ha cancellato un dato personale di ${q}`, auto: `Un dato personale di ${q} è stato cancellato.` };
    case "validazione.registrata": {
      const outcome = CHECK_OUTCOME[payloadString(p, "outcome") ?? ""] ?? null;
      const tail = outcome ? `: ${outcome}` : "";
      return {
        one: `ha controllato ${q}${tail}`,
        many: (n) => `ha controllato ${formatCountIt(n)} domande${tail}`,
        auto: `Controllo automatico su ${q}${tail}.`,
        autoMany: (n) => `Controllo automatico su ${formatCountIt(n)} domande${tail}.`,
        group: payloadString(p, "outcome") ?? "",
      };
    }
    case "commento.creato":
      return { one: `ha commentato ${q}`, many: (n) => `ha commentato ${formatCountIt(n)} domande`, group: "" };
    case "chiarimento.richiesto":
      return { one: `ha chiesto un chiarimento su ${q}` };
    case "chiarimento.risolto":
      return { one: `ha chiuso un chiarimento su ${q}` };
    case "richiesta.creata":
    case "richiesta.inviata": {
      const verb = row.type === "richiesta.creata" ? "ha preparato" : "ha inviato";
      if (payloadString(p, "purpose") === "approvazioni") return { one: `${verb} un link per firmare` };
      const n = payloadCount(p, "items");
      return {
        one: n !== null ? `${verb} ${plural(n, "una domanda", "domande")} a un referente` : `${verb} una richiesta a un referente`,
        many: (k) => `${verb} le domande a ${formatCountIt(k)} referenti`,
        group: "",
      };
    }
    case "richiesta.promemoria":
      return { one: "ha mandato un promemoria", many: (n) => `ha mandato ${formatCountIt(n)} promemoria`, auto: "Promemoria inviato a un referente.", autoMany: (n) => `${formatCountIt(n)} promemoria inviati ai referenti.`, group: "" };
    case "richiesta.revocata":
      return { one: "ha revocato una richiesta", many: (n) => `ha revocato ${formatCountIt(n)} richieste`, group: "" };
    case "richiesta.scaduta":
      return { one: "ha chiuso una richiesta scaduta", auto: "Una richiesta è scaduta.", autoMany: (n) => `${formatCountIt(n)} richieste sono scadute.`, group: "" };
    case "richiesta.prorogata":
      return { one: "ha spostato la scadenza di una richiesta" };
    case "link.aperto":
      return { one: "ha aperto il link", many: (n) => `ha aperto il link ${formatCountIt(n)} volte`, group: "" };
    case "link.copiato":
      return { one: "ha copiato un link" };
    case "link.revocati_tutti":
      return { one: "ha revocato tutti i link dei referenti" };
    case "delega.creata": {
      const n = payloadCount(p, "items");
      return { one: n !== null ? `ha girato ${plural(n, "una domanda", "domande")} a un collega` : "ha girato delle domande a un collega" };
    }
    case "delega.approvata":
      return { one: "ha approvato una delega a un collega" };
    case "informativa.vista":
      return { one: "ha letto l'informativa privacy" };
    case "file.caricato":
      return {
        one: payloadString(p, "zona") === "personale" ? "ha caricato un file con dati personali" : "ha caricato un file",
        many: (n) => `ha caricato ${formatCountIt(n)} file`,
        group: "",
      };
    case "file.rifiutato":
      return { one: "ha rifiutato un file", auto: "Un file non ha passato il controllo ed è stato rifiutato." };
    case "file.revisionato":
      return { one: "ha controllato un file" };
    case "file.scaricato":
      return {
        one: payloadString(p, "zona") === "personale" ? "ha scaricato un file con dati personali" : "ha scaricato un file",
        many: (n) => `ha scaricato ${formatCountIt(n)} file`,
        group: payloadString(p, "zona") ?? "",
      };
    case "file.cancellato":
      return { one: "ha cancellato un file", auto: "Un file è stato cancellato." };
    case "dataset.creato":
      return { one: "ha registrato un dataset" };
    case "dataset.validato":
      return { one: "ha validato un dataset" };
    case "blocco.attivato":
    case "blocco.firmato":
    case "blocco.sciolto":
    case "blocco.riattivato": {
      const key = payloadString(p, "blocker_key");
      const name = key ? `«${blockerLabel(key)}»` : "un blocco";
      if (row.type === "blocco.attivato") return { one: `ha attivato il blocco ${name}`, auto: `Si è attivato il blocco ${name}.` };
      if (row.type === "blocco.firmato") return { one: key === "a8" ? "ha firmato la scheda privacy" : `ha firmato per sciogliere ${name}` };
      if (row.type === "blocco.sciolto") return { one: key === "a8" ? "ha completato le firme della scheda privacy" : `ha sciolto il blocco ${name}`, auto: `Il blocco ${name} è sciolto.` };
      return { one: `ha riattivato il blocco ${name}` };
    }
    case "gate.proposto":
      return { one: "ha proposto il via allo sviluppo" };
    case "gate.firmato":
      return { one: "ha firmato il via allo sviluppo" };
    case "gate.approvato":
      return { one: "ha approvato il via allo sviluppo", auto: "Via allo sviluppo approvato." };
    case "gate.respinto":
      return { one: "ha respinto il via allo sviluppo" };
    case "catalogo.congelato": {
      const v = payloadCount(p, "version");
      return { one: v ? `ha congelato il catalogo v${v}` : "ha congelato il catalogo", auto: v ? `Catalogo v${v} congelato.` : "Catalogo congelato." };
    }
    case "catalogo.esportato": {
      const f = FORMAT_LABEL[payloadString(p, "format") ?? ""];
      return { one: `ha scaricato ${catalogVersion(p)}${f ? ` in ${f}` : ""}` };
    }
    case "catalogo.letto_mcp":
      return { one: "ha letto il catalogo", many: (n) => `ha letto il catalogo ${formatCountIt(n)} volte`, group: "" };
    case "registro.esportato":
      return { one: "ha scaricato l'attività in CSV" };
    case "casi_prova.importati": {
      const n = payloadCount(p, "count");
      return { one: n !== null ? `ha importato ${plural(n, "un caso di prova", "casi di prova")}` : "ha importato i casi di prova" };
    }
    case "template.caricato":
      return { one: "ha caricato lo schema di partenza" };
    case "seed.applicato":
      return { one: "ha caricato lo stato di partenza", auto: "Stato di partenza caricato." };
    case "seed.valore_omesso":
      return { one: "ha lasciato fuori un valore già dichiarato", auto: "Un valore già dichiarato non è stato caricato." };
    case "notifica.inviata": {
      const email = payloadString(p, "channel") === "email";
      return {
        one: email ? "ha inviato un'email" : "ha inviato una notifica",
        auto: email ? "Email inviata." : "Notifica inviata.",
        autoMany: (n) => (email ? `${formatCountIt(n)} email inviate.` : `${formatCountIt(n)} notifiche inviate.`),
        group: payloadString(p, "channel") ?? "",
      };
    }
    case "notifica.errore":
      return { one: "non è riuscito a inviare una notifica", auto: "Una notifica non è partita.", autoMany: (n) => `${formatCountIt(n)} notifiche non sono partite.`, group: "" };
    default:
      return { one: `ha fatto un'azione sul caso (${label.toLowerCase()})`, auto: `${label}.` };
  }
}

function capitalize(s: string): string {
  if (s.startsWith("«")) return `«${s.charAt(1).toUpperCase()}${s.slice(2)}`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Chi ha agito, come si legge nella riga: il nome (con «(Lateral Space)» per
 * chi è di Lateral Space), «Claude», oppure null per ciò che succede in
 * automatico. Al cliente non arrivano eventi dei referenti.
 */
export function activityWho(row: Pick<ActivityRow, "actorType" | "actorName" | "actorIsLs">): string | null {
  switch (row.actorType) {
    case "utente": {
      const name = row.actorName?.trim() || (row.actorIsLs ? "Una persona" : "Una persona del cliente");
      return row.actorIsLs ? `${name} (Lateral Space)` : name;
    }
    case "referente":
      return row.actorName?.trim() || "Un referente";
    case "mcp":
      return "Claude";
    case "sistema":
      return null;
  }
}

/** La frase di una riga (uno o più eventi uguali e consecutivi). */
export function activityText(row: ActivityRow, audience: Audience, count = 1): { who: string | null; text: string } {
  const phrase = phraseOf(row, audience);
  const who = activityWho(row);
  if (who === null) {
    if (count > 1 && phrase.autoMany) return { who: null, text: phrase.autoMany(count) };
    if (phrase.auto) return { who: null, text: phrase.auto };
    return { who: null, text: `${capitalize(count > 1 && phrase.many ? phrase.many(count) : phrase.one)} (in automatico).` };
  }
  return { who, text: count > 1 && phrase.many ? phrase.many(count) : phrase.one };
}

function groupKeyOf(row: ActivityRow, audience: Audience): string | null {
  const phrase = phraseOf(row, audience);
  if (phrase.group === undefined) return null;
  if (row.actorType === "sistema" ? !phrase.autoMany && !phrase.many : !phrase.many) return null;
  return `${row.actorKey}|${row.type}|${phrase.group}`;
}

/**
 * La linea del tempo: gli eventi (già dal più recente) raggruppati per giorno di
 * Roma; nello stesso giorno gli eventi uguali e consecutivi della stessa persona
 * diventano una riga sola («ha risposto a 3 domande»).
 */
export function activityDays(rows: readonly ActivityRow[], o: { now: Date; audience: Audience }): ActivityDay[] {
  const days: ActivityDay[] = [];
  let lastGroup: string | null = null;
  let current: { row: ActivityRow; count: number } | null = null;
  const flush = () => {
    if (!current) return;
    const day = days[days.length - 1];
    const { who, text } = activityText(current.row, o.audience, current.count);
    day.lines.push({ id: current.row.id, time: romeTime(current.row.at), who, text, count: current.count });
    current = null;
  };
  for (const row of rows) {
    const key = romeDayKey(row.at);
    if (!key) continue;
    if (days[days.length - 1]?.key !== key) {
      flush();
      lastGroup = null;
      days.push({ key, label: activityDayLabel(key, o.now), lines: [] });
    }
    const group = groupKeyOf(row, o.audience);
    if (current && group !== null && group === lastGroup) {
      current.count += 1;
      continue;
    }
    flush();
    current = { row, count: 1 };
    lastGroup = group;
  }
  flush();
  return days;
}

/** Barrette delle risposte per giorno (vista del cliente): stessi numeri della soglia, con la larghezza in percentuale. */
export function dailyAnswerBars(daily: { days: { day: string; count: number }[]; below: number }, now: Date): { key: string; label: string; count: number; percent: number }[] {
  const max = Math.max(1, ...daily.days.map((d) => d.count), daily.below);
  const bars = daily.days.map((d) => ({ key: d.day, label: activityDayLabel(d.day, now), count: d.count, percent: Math.max(4, Math.round((d.count / max) * 100)) }));
  if (daily.below > 0) bars.push({ key: "altri", label: "Altri giorni, insieme", count: daily.below, percent: Math.max(4, Math.round((daily.below / max) * 100)) });
  return bars;
}
