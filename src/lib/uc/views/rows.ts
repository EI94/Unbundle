/**
 * Righe del database → dati delle pagine interne del caso (WP9). Tutto quello
 * che esce da qui va a un componente: solo testi, numeri e date già formattate,
 * mai valori che il ruolo non vede (vedi `format.ts`).
 *
 * Modulo puro.
 */
import { rowBool, rowDate, rowJson, rowNumber, rowObject, rowString, rowStringArray, rowVocab, type Row } from "../sql/readiness.ts";
import type { Json } from "../types.ts";
import {
  ANSWER_KINDS,
  ANSWER_SOURCE_KINDS,
  CASE_STATUSES,
  ITEM_KINDS,
  ITEM_STATUSES,
  PERIMETERS,
  PHASES,
  PRIORITIES,
  PRIVACY_CLASSES,
  RESPONSE_TYPES,
  VALUE_VISIBILITY,
  isVocab,
  type CaseRole,
  type CaseStatus,
  type ItemKind,
  type ItemStatus,
  type Perimeter,
  type Phase,
  type Priority,
  type PrivacyClass,
  type ResponseType,
  type SemaforoColor,
} from "../vocab.ts";
import { NONE, QUESTION_SEGMENT_LABEL, QUESTION_TABS, questionTabOf, type QuestionAudience, type QuestionSegment, type QuestionTab } from "./catalog-filter.ts";
import { readableText } from "./description.ts";
import { answerValueView, formatDateIt, formatDayIt, formatRelativeIt, provenanceText, type ValueView } from "./format.ts";
import { DOMANDE_TEXT } from "./domande-text.ts";
import { ANSWER_KIND_LABEL, blockerLabel, dayWithArticle } from "./labels.ts";
import { statusView, type StatusView } from "./status-groups.ts";

// ── Contesto del caso ─────────────────────────────────────────────────

export interface RequestModuleRef {
  key: string;
  title: string;
  roleKey: string | null;
}

export interface CaseViewContext {
  caseId: string;
  code: string;
  title: string;
  status: CaseStatus;
  catalogVersion: number;
  templateKey: string;
  templateName: string;
  templateVersion: string;
  /** Etichette dei ruoli del template (con le etichette del caso al posto di quelle del template). */
  roleLabels: Record<string, string>;
  modules: RequestModuleRef[];
}

/** Ruoli del template, con `settings.role_labels` del caso sopra. */
export function roleLabelsFrom(templateRoles: unknown, settings: Readonly<Record<string, Json>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rowJson<unknown[]>(templateRoles) ?? []) {
    if (r && typeof r === "object" && typeof (r as Record<string, unknown>).key === "string") {
      const role = r as Record<string, unknown>;
      out[String(role.key)] = typeof role.label === "string" && role.label.trim() ? role.label : String(role.key);
    }
  }
  const own = settings.role_labels;
  if (own && typeof own === "object" && !Array.isArray(own)) {
    for (const [k, v] of Object.entries(own)) if (typeof v === "string" && v.trim()) out[k] = v;
  }
  return out;
}

export function parseCaseViewContext(row: Row | undefined): CaseViewContext | null {
  if (!row) return null;
  const status = rowVocab(CASE_STATUSES, row.status);
  if (!status) return null;
  const settings = rowObject(row.settings);
  const modules = (rowJson<unknown[]>(row.modules) ?? [])
    .filter((m): m is Record<string, unknown> => !!m && typeof m === "object" && typeof (m as Record<string, unknown>).key === "string")
    .map((m) => ({ key: String(m.key), title: typeof m.title === "string" && m.title ? m.title : String(m.key), roleKey: typeof m.role_key === "string" ? m.role_key : null }));
  return {
    caseId: String(row.id),
    code: String(row.code),
    title: String(row.title),
    status,
    catalogVersion: rowNumber(row.catalog_version) ?? 0,
    templateKey: String(row.template_key),
    templateName: String(row.template_name),
    templateVersion: String(row.template_version),
    roleLabels: roleLabelsFrom(row.template_roles, settings),
    modules,
  };
}

export function roleLabel(ctx: Pick<CaseViewContext, "roleLabels">, key: string | null | undefined): string | null {
  if (!key) return null;
  return ctx.roleLabels[key] ?? key;
}

// ── Referenti ─────────────────────────────────────────────────────────

export interface ContactOption {
  id: string;
  name: string;
  roleLabel: string | null;
  templateRoleKey: string | null;
  /** Attivo e non anonimizzato: si può assegnare. */
  assignable: boolean;
}

export function rowToContact(row: Row): ContactOption {
  return {
    id: String(row.id),
    name: rowString(row.display_name) ?? "Referente",
    roleLabel: rowString(row.role_label),
    templateRoleKey: rowString(row.template_role_key),
    assignable: rowBool(row.is_active) && !rowBool(row.anonymized),
  };
}

// ── Catalogo ──────────────────────────────────────────────────────────

export interface AnswerSummary {
  version: number;
  kindLabel: string;
  provenance: string;
  /** Valore dichiarato nelle call, da confermare: si mostra in grigio. */
  declared: boolean;
  value: ValueView;
}

export interface CatalogRow {
  id: string;
  key: string;
  kind: ItemKind;
  title: string;
  status: ItemStatus;
  statusReason: string | null;
  priority: Priority | null;
  servesFor: Phase[];
  privacyClass: PrivacyClass;
  availability: string[];
  perimeter: Perimeter | null;
  ownerRoleLabel: string | null;
  assigneeName: string | null;
  due: string | null;
  dueIsProposal: boolean;
  responseType: ResponseType | null;
  answer: AnswerSummary | null;
}

export interface CatalogRowContext {
  roles: readonly CaseRole[];
  contacts: ReadonlyMap<string, ContactOption>;
  roleLabels: Readonly<Record<string, string>>;
}

function vocabList<const T extends readonly string[]>(vocab: T, v: unknown): T[number][] {
  return rowStringArray(rowJson(v)).filter((x): x is T[number] => isVocab(vocab, x));
}

/** Lunghezza massima del valore nel catalogo: la riga ne mostra tre righe, il valore intero sta nel dettaglio. */
export const CATALOG_VALUE_MAX = 240;

function clipValue(v: ValueView): ValueView {
  if (v.kind !== "value" || v.text.length <= CATALOG_VALUE_MAX) return v;
  return { kind: "value", text: `${v.text.slice(0, CATALOG_VALUE_MAX - 1).trimEnd()}…` };
}

export function rowToCatalogRow(row: Row, ctx: CatalogRowContext): CatalogRow {
  const privacyClass = rowVocab(PRIVACY_CLASSES, row.privacy_class) ?? "riservato_azienda";
  const assigneeId = rowString(row.assignee_contact_id);
  const ownerRoleKey = rowString(row.owner_role_key);
  const answerKind = rowVocab(ANSWER_KINDS, row.a_kind);
  const sourceKind = rowVocab(ANSWER_SOURCE_KINDS, row.a_source_kind);
  const answer: AnswerSummary | null =
    answerKind && sourceKind
      ? {
          version: rowNumber(row.a_version) ?? 1,
          kindLabel: ANSWER_KIND_LABEL[answerKind],
          provenance: provenanceText(sourceKind, rowString(row.a_source_ref)),
          declared: sourceKind === "dichiarato_in_call",
          value: clipValue(
            answerValueView({
              value: rowJson(row.a_value),
              encrypted: rowBool(row.a_encrypted),
              erased: rowBool(row.a_erased),
              privacyClass,
              valueVisibility: rowVocab(VALUE_VISIBILITY, row.value_visibility) ?? "owner_e_ls",
              roles: ctx.roles,
            }),
          ),
        }
      : null;
  return {
    id: String(row.id),
    key: String(row.key),
    kind: rowVocab(ITEM_KINDS, row.kind) ?? "domanda",
    title: String(row.title ?? ""),
    status: rowVocab(ITEM_STATUSES, row.status) ?? "da_chiedere",
    statusReason: rowString(row.status_reason),
    priority: rowVocab(PRIORITIES, row.priority),
    servesFor: vocabList(PHASES, row.serves_for),
    privacyClass,
    availability: rowStringArray(rowJson(row.availability)),
    perimeter: rowVocab(PERIMETERS, row.perimeter),
    ownerRoleLabel: ownerRoleKey ? (ctx.roleLabels[ownerRoleKey] ?? ownerRoleKey) : null,
    assigneeName: assigneeId ? (ctx.contacts.get(assigneeId)?.name ?? "Referente") : null,
    due: formatDateIt(rowDate(row.due_at)),
    dueIsProposal: rowBool(row.due_is_proposal),
    responseType: rowVocab(RESPONSE_TYPES, row.response_type),
    answer,
  };
}

/** Conteggi per valore (`v`, `n`) di una faccetta. */
export function rowsToFacet(rows: readonly Row[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const v = rowString(r.v);
    if (v) out[v] = rowNumber(r.n) ?? 0;
  }
  return out;
}

export function rowCount(rows: readonly Row[]): number {
  return rowNumber(rows[0]?.n) ?? 0;
}

// ── Assegnazione per ruolo ────────────────────────────────────────────

export interface RoleGroup {
  roleKey: string;
  roleLabel: string;
  /** Voci aperte del ruolo (anche già assegnate). */
  itemCount: number;
  /** Voci aperte del ruolo senza referente. */
  unassignedCount: number;
  /** Referenti con lo stesso ruolo del template, da proporre per primi. */
  suggestedContactIds: string[];
}

/** Gruppi per ruolo titolare: solo conteggi; gli id si chiedono al momento di assegnare. */
export function rowsToRoleGroups(rows: readonly Row[], roleLabels: Readonly<Record<string, string>>, contacts: readonly ContactOption[]): RoleGroup[] {
  return rows
    .map((r) => {
      const roleKey = String(r.role_key);
      return {
        roleKey,
        roleLabel: roleLabels[roleKey] ?? roleKey,
        itemCount: rowNumber(r.items) ?? 0,
        unassignedCount: rowNumber(r.unassigned) ?? 0,
        suggestedContactIds: contacts.filter((c) => c.assignable && c.templateRoleKey === roleKey).map((c) => c.id),
      };
    })
    .filter((g) => g.itemCount > 0)
    .sort((a, b) => a.roleLabel.localeCompare(b.roleLabel, "it"));
}

// ── Domande (DESIGN §3.6.2, §3.6.7, §3.6.8; rilascio 10, §3.5) ────────

/** I conteggi di un argomento con i filtri di base, uno per segmento. */
export interface ModuleCounts {
  total: number;
  ok: number;
  daFare: number;
  /** Con i quattro occhi per Lateral Space, come il segmento. */
  daVerificare: number;
  bloccate: number;
}

/** Conteggi di Domande con i filtri di base: segmenti, argomenti, righe discrete. */
export interface QuestionCounts {
  segments: Record<QuestionSegment, number>;
  /** Risposte da verificare date da chi guarda (le verifica un'altra persona): solo Lateral Space. */
  mine: number;
  /** Domande senza referente che aspettano qualcuno a cui chiederle. */
  unassigned: number;
  /** Domande «Fuori contratto»: senza, il filtro «Contratto» non serve. */
  outOfContract: number;
  /** Per argomento (chiave; `""` = senza argomento). */
  byModule: Record<string, ModuleCounts>;
}

/** Righe di `questionCountsSql` → conteggi. */
export function rowsToQuestionCounts(rows: readonly Row[]): QuestionCounts {
  const segments: Record<QuestionSegment, number> = { "da-fare": 0, "da-verificare": 0, bloccate: 0, "a-posto": 0, tutte: 0 };
  let inReview = 0;
  let unassigned = 0;
  let outOfContract = 0;
  const byModule: Record<string, ModuleCounts> = {};
  for (const r of rows) {
    const n = rowNumber(r.n) ?? 0;
    const ok = rowNumber(r.a_posto) ?? 0;
    const daFare = rowNumber(r.da_fare) ?? 0;
    const daVerificare = rowNumber(r.da_verificare) ?? 0;
    const bloccate = rowNumber(r.bloccate) ?? 0;
    segments.tutte += n;
    segments["a-posto"] += ok;
    segments["da-fare"] += daFare;
    segments["da-verificare"] += daVerificare;
    segments.bloccate += bloccate;
    inReview += rowNumber(r.in_verifica) ?? 0;
    unassigned += rowNumber(r.senza_referente) ?? 0;
    outOfContract += rowNumber(r.fuori) ?? 0;
    const key = rowString(r.m) ?? "";
    const m = (byModule[key] ??= { total: 0, ok: 0, daFare: 0, daVerificare: 0, bloccate: 0 });
    m.total += n;
    m.ok += ok;
    m.daFare += daFare;
    m.daVerificare += daVerificare;
    m.bloccate += bloccate;
  }
  return { segments, mine: Math.max(0, inReview - segments["da-verificare"]), unassigned, outOfContract, byModule };
}

/** Una voce del controllo segmentato di Domande. */
export interface QuestionSegmentItem {
  key: QuestionTab;
  label: string;
  count: number;
}

/**
 * I segmenti in vista (rilascio 10, §3.5): Lateral Space «Da fare · Da
 * verificare · Tutte», il cliente «Da rispondere · In verifica · Tutte».
 * «Da fare» conta anche il gruppo «In attesa», che sta in cima. Un segmento a
 * 0 si nasconde, tranne quello predefinito, quello acceso e «Tutte». Lo
 * sviluppatore non ha segmenti: un solo elenco.
 */
export function questionSegmentItems(i: { audience: QuestionAudience; counts: QuestionCounts["segments"]; active: QuestionSegment; defaultSegment: QuestionSegment }): QuestionSegmentItem[] {
  if (i.audience === "sviluppatore") return [];
  const words = QUESTION_SEGMENT_LABEL[i.audience === "ls" ? "ls" : "cliente"];
  const active = questionTabOf(i.active);
  const preset = questionTabOf(i.defaultSegment);
  const count = (key: QuestionTab) => (key === "da-fare" ? i.counts["da-fare"] + i.counts.bloccate : i.counts[key]);
  return QUESTION_TABS.filter((key) => count(key) > 0 || key === active || key === preset || key === "tutte").map((key) => ({ key, label: words[key], count: count(key) }));
}

/** Le domande di un argomento nella vista aperta. */
export function topicCount(c: ModuleCounts | undefined, vista: QuestionSegment): number {
  if (!c) return 0;
  switch (vista) {
    case "da-fare":
      return c.daFare;
    case "da-verificare":
      return c.daVerificare;
    case "bloccate":
      return c.bloccate;
    case "a-posto":
      return c.ok;
    case "tutte":
      return c.total;
  }
}

/** Un argomento chiuso (rilascio 10, §3.5): il titolo, il ruolo che risponde in grigio, il solo conteggio. */
export interface QuestionTopicGroup {
  /** Il valore di `?argomento=` che lo apre: la chiave, oppure `nessuno` per le voci senza argomento. */
  key: string;
  title: string;
  /** Il ruolo che risponde all'argomento: sta solo nel gruppo, mai nelle righe. */
  role: string | null;
  count: number;
}

/**
 * Gli argomenti chiusi di una vista, nell'ordine dello schema, solo quelli con
 * domande: per ognuno il titolo, il ruolo e il conteggio. In fondo gli
 * argomenti che lo schema non elenca e le voci senza argomento. `plain`
 * toglie codici e articoli ai testi dello schema per il cliente.
 */
export function questionTopicGroups(i: {
  counts: QuestionCounts["byModule"];
  modules: readonly RequestModuleRef[];
  roleLabels: Readonly<Record<string, string>>;
  vista: QuestionSegment;
  plain: (text: string) => string;
}): QuestionTopicGroup[] {
  const out: QuestionTopicGroup[] = [];
  const listed = new Set(i.modules.map((m) => m.key));
  for (const m of i.modules) {
    const count = topicCount(i.counts[m.key], i.vista);
    if (count <= 0) continue;
    const role = m.roleKey ? (i.roleLabels[m.roleKey] ?? null) : null;
    out.push({ key: m.key, title: i.plain(m.title) || DOMANDE_TEXT.otherTopic, role: role ? i.plain(role) || null : null, count });
  }
  for (const [key, c] of Object.entries(i.counts)) {
    if (key === "" || listed.has(key)) continue;
    const count = topicCount(c, i.vista);
    if (count > 0) out.push({ key, title: DOMANDE_TEXT.otherTopic, role: null, count });
  }
  const none = topicCount(i.counts[""], i.vista);
  if (none > 0) out.push({ key: NONE, title: DOMANDE_TEXT.noTopic, role: null, count: none });
  return out;
}

/**
 * Un testo dello schema per chi non è di Lateral Space: niente codici dei fatti,
 * articoli, chiavi delle voci né chiavi dei KPI. È `readableText` della pagina
 * di lettura (`description.ts`): una regola sola per Domande, Soluzione e
 * Panoramica.
 */
export function clientPlainText(text: string): string {
  return readableText(text, "cliente");
}

/**
 * Lo stato di una sola domanda: come il gruppo, ma al singolare («Bloccata»,
 * non «Bloccate», che era il nome del segmento).
 */
export function oneQuestionStateLabel(view: Pick<StatusView, "label" | "group">, audience: "ls" | "cliente"): string {
  return audience === "ls" && view.group === "bloccate" ? "Bloccata" : view.label;
}

export interface QuestionRowView {
  id: string;
  status: ItemStatus;
  title: string;
  tone: SemaforoColor;
  /** Lo stato per chi guarda (il puntino lo dice ai lettori di schermo). */
  label: string;
  /**
   * (Rilascio 10, §3.5) La riga grigia, una cosa sola: chi risponde (o «Senza
   * referente»); per le risposte da verificare chi ha risposto e quando; per le
   * bloccate il blocco; per quelle a posto lo stato.
   */
  line: string;
  /** La riga grigia dice che manca il referente. */
  missing: boolean;
  /** La scadenza solo quando è passata, e solo per Lateral Space: «scaduta il 20 ott». */
  overdue: string | null;
  /** Lucchetto: dato personale. */
  personal: boolean;
  moduleKey: string | null;
  /** Sviluppatore: il valore validato in linea, al posto della riga grigia. */
  value: ValueView | null;
}

export interface QuestionRowContext {
  audience: QuestionAudience;
  roles: readonly CaseRole[];
  contacts: ReadonlyMap<string, ContactOption>;
  now: Date;
}

const DAY_MS = 86_400_000;
const OPEN_STATUSES: readonly ItemStatus[] = ["da_chiedere", "chiesta", "mancante", "parziale"];

/** «scade il 23 ott» entro 7 giorni, «scaduta il 20 ott» se passata; null altrimenti. */
export function dueView(dueAt: Date | null, status: ItemStatus, now: Date): { text: string; overdue: boolean } | null {
  if (!dueAt || !OPEN_STATUSES.includes(status)) return null;
  const day = formatDayIt(dueAt, { now });
  if (!day) return null;
  if (dueAt.getTime() < now.getTime()) return { text: DOMANDE_TEXT.row.overdue(dayWithArticle("il", day)), overdue: true };
  if (dueAt.getTime() - now.getTime() <= 7 * DAY_MS) return { text: `scade ${dayWithArticle("il", day)}`, overdue: false };
  return null;
}

/** Una riga di `questionPageSql` → la riga di Domande per chi guarda. Il cliente non riceve mai la risposta (§3.6.8). */
export function rowToQuestionRow(row: Row, ctx: QuestionRowContext): QuestionRowView {
  const status = rowVocab(ITEM_STATUSES, row.status) ?? "da_chiedere";
  const privacyClass = rowVocab(PRIVACY_CLASSES, row.privacy_class) ?? "riservato_azienda";
  const ls = ctx.audience === "ls";
  const words = ls ? "ls" : "cliente";
  const view = statusView(status, words);
  const label = oneQuestionStateLabel(view, words);
  const assigneeId = rowString(row.assignee_contact_id);
  const assignee = assigneeId ? (ctx.contacts.get(assigneeId)?.name ?? "Referente") : null;
  const lockKey = rowString(row.lock_key);
  // Lo stato più preciso: «Non si applica», non il gruppo «A posto».
  let line = view.sublabel ?? label;
  let missing = false;
  if (view.group === "bloccate") line = lockKey ? blockerLabel(lockKey) : label;
  else if (view.group === "da_verificare") {
    // Lateral Space legge chi ha risposto e quando; il cliente lo stato (mai una data accanto a un nome, art. 15.4).
    const by = ls ? (rowString(row.a_responder) ?? assignee) : null;
    line = by ? DOMANDE_TEXT.row.answeredBy(by, formatRelativeIt(rowDate(row.a_at), ctx.now)) : label;
  } else if (view.group === "da_fare") {
    line = assignee ?? DOMANDE_TEXT.row.noReferent;
    missing = assignee === null;
  }
  // La scadenza solo per Lateral Space e solo passata: accanto a un nome sarebbe una data per persona (art. 15.4, §3.6.8).
  const due = ls ? dueView(rowDate(row.due_at), status, ctx.now) : null;
  return {
    id: String(row.id),
    status,
    // Per chi non è di Lateral Space niente codici dei fatti né articoli (§1, principio 3).
    title: ls ? String(row.title ?? "") : clientPlainText(String(row.title ?? "")),
    tone: view.tone,
    label,
    line,
    missing,
    overdue: due?.overdue ? due.text : null,
    personal: privacyClass === "personale" || privacyClass === "personale_equipaggio" || privacyClass === "escluso_sanitario",
    moduleKey: rowString(row.request_module_key),
    value:
      ctx.audience === "sviluppatore"
        ? answerValueView({
            value: rowJson(row.a_value),
            encrypted: rowBool(row.a_encrypted),
            erased: rowBool(row.a_erased),
            privacyClass,
            valueVisibility: rowVocab(VALUE_VISIBILITY, row.value_visibility) ?? "owner_e_ls",
            roles: ctx.roles,
          })
        : null,
  };
}

export interface QuestionGroupView {
  key: string;
  title: string;
  /** Il ruolo che risponde all'argomento: solo nel gruppo (rilascio 10, §3.5). */
  role: string | null;
  /** Le domande dell'argomento nella vista, con i filtri, in tutte le pagine. */
  count: number;
  rowIds: string[];
}

/**
 * Le righe della pagina raggruppate per argomento, nell'ordine in cui arrivano
 * (§3.6.2): titolo, ruolo e conteggio di tutto l'argomento con i filtri, non
 * solo della pagina. Le voci senza argomento stanno in fondo.
 */
export function questionGroups(
  rows: readonly QuestionRowView[],
  i: { counts: QuestionCounts["byModule"]; modules: readonly RequestModuleRef[]; roleLabels: Readonly<Record<string, string>>; vista: QuestionSegment; plain: (text: string) => string },
): QuestionGroupView[] {
  const groups: QuestionGroupView[] = [];
  for (const r of rows) {
    const key = r.moduleKey ?? "";
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      const ref = i.modules.find((m) => m.key === key);
      const role = ref?.roleKey ? (i.roleLabels[ref.roleKey] ?? null) : null;
      g = {
        key,
        title: key ? (ref ? i.plain(ref.title) || DOMANDE_TEXT.otherTopic : DOMANDE_TEXT.otherTopic) : DOMANDE_TEXT.noTopic,
        role: role ? i.plain(role) || null : null,
        count: topicCount(i.counts[key], i.vista),
        rowIds: [],
      };
      groups.push(g);
    }
    g.rowIds.push(r.id);
  }
  return groups;
}

/** Righe `id, status` (selezione dei risultati) → id raggruppati per stato. */
export function rowsToSelection(rows: readonly Row[], max: number): { total: number; truncated: boolean; byStatus: Partial<Record<ItemStatus, string[]>> } {
  const byStatus: Partial<Record<ItemStatus, string[]>> = {};
  const kept = rows.slice(0, max);
  for (const r of kept) {
    const status = rowVocab(ITEM_STATUSES, r.status);
    if (!status) continue;
    (byStatus[status] ??= []).push(String(r.id));
  }
  return { total: kept.length, truncated: rows.length > max, byStatus };
}
