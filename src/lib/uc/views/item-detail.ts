/**
 * Dettaglio di una voce (PIANO §5.1, `voci/[itemId]`): spiegazione, risposta
 * corrente e versioni, file, controlli, commenti, collegamenti navigabili per
 * relazione, cronologia e azioni secondo il ruolo.
 *
 * Le azioni proposte all'interfaccia sono solo un suggerimento: ogni comando
 * ricontrolla tutto lato server (`checkItemTransition`, quattro occhi, CAS).
 * Qui si usano le stesse funzioni pure per dire subito perché un'azione non si
 * può fare (per esempio «Hai inserito tu una risposta su questa voce»).
 *
 * Ruoli del cliente (art. 15.4): niente nomi né date accanto a ciò che ha fatto
 * un referente; la cronologia arriva già filtrata dalla query.
 *
 * Modulo puro.
 */
import { waiverForbiddenReason } from "../gates.ts";
import { can, canValidate, naSignatures } from "../permissions.ts";
import { STATUS_LABEL } from "../semaforo.ts";
import { rowBool, rowDate, rowIsoDate, rowJson, rowNumber, rowObject, rowString, rowVocab, type Row } from "../sql/readiness.ts";
import type { LoadedItem } from "../sql/transitions.ts";
import type { Json, UserContext } from "../types.ts";
import {
  ANSWER_KINDS,
  ANSWER_SOURCE_KINDS,
  BLOCKER_STATUSES,
  CONFIDENCE,
  FILE_PERSONAL_DATA,
  ITEM_KINDS,
  ITEM_STATUSES,
  LINK_RELATIONS,
  SCAN_STATUSES,
  SOURCE_BASIS,
  VALIDATION_OUTCOMES,
  VALUE_VISIBILITY,
  type CaseRole,
  type AnswerKind,
  type CaseStatus,
  type ItemKind,
  type ItemStatus,
  type LinkRelation,
  type ScanStatus,
} from "../vocab.ts";
import { answerValueView, formatBytes, formatDateIt, formatDateTimeIt, formatRelativeIt, provenanceText, specText, type ValueView } from "./format.ts";
import {
  ANSWER_KIND_LABEL,
  CONFIDENCE_LABEL,
  FILE_PERSONAL_DATA_LABEL,
  RELATION_LABEL,
  SCAN_STATUS_LABEL,
  SOURCE_BASIS_LABEL,
  eventActorLabel,
  eventLabel,
  humanizeToken,
} from "./labels.ts";
import { isClientViewer, seesInternalComments } from "./page-access.ts";
import { statusView } from "./status-groups.ts";

// ── Campi del template (`spec`) ───────────────────────────────────────

const SPEC_LABEL: Readonly<Record<string, string>> = {
  tipo_dato: "Tipo di dato",
  unita: "Unità",
  unit: "Unità",
  obbligatorio: "Obbligatorio",
  qualita: "Attenzione ai dati",
  chiave: "Chiave",
  granularita: "Granularità",
  frequenza: "Aggiornamento",
  fonte_verita: "Fonte di verità",
  dominio: "Dominio",
  formula: "Formula",
  formula_tecnica: "Formula tecnica",
  direzione: "Direzione",
  dimensioni: "Dimensioni",
  baseline: "Valore di partenza",
  target: "Obiettivo",
  pnl_line: "Riga del conto economico",
  kpi_controllo: "KPI di controllo",
  tipo_regola: "Tipo di regola",
  forma_logica: "Come la legge il modello",
  parametri: "Parametri",
  eccezioni: "Eccezioni",
  stato_validazione: "Stato nel template",
  controllo: "Controllo",
  azione: "Se fallisce",
  gravita: "Gravità",
  definizione: "Definizione",
  valori: "Valori",
  periodo: "Periodo",
  formato: "Formato",
  metodo: "Metodo",
  fallback: "Ripiego previsto",
};

/** Chiavi di `spec` che non sono testi del template (si mostrano altrove o mai). */
const SPEC_HIDDEN = new Set(["defaults_applied", "blocked_by", "notes", "unresolved_refs", "health_rule_question", "forbidden_columns", "validations"]);

export interface SpecEntry {
  key: string;
  label: string;
  value: string;
}

/** Campi del template in ordine: prima quelli noti, poi gli altri. */
export function specEntries(spec: Readonly<Record<string, Json>>): SpecEntry[] {
  const known = Object.keys(SPEC_LABEL).filter((k) => k in spec);
  const others = Object.keys(spec)
    .filter((k) => !(k in SPEC_LABEL) && !SPEC_HIDDEN.has(k))
    .sort();
  const out: SpecEntry[] = [];
  for (const key of [...known, ...others]) {
    const value = specText(spec, key);
    if (value !== null) out.push({ key, label: SPEC_LABEL[key] ?? humanizeToken(key), value });
  }
  return out;
}

// ── Viste ─────────────────────────────────────────────────────────────

export interface AnswerVersionView {
  id: string;
  version: number;
  kindLabel: string;
  value: ValueView;
  /** Una risposta che non è un valore («Non lo so», «non si applica», delega), in parole; null per i valori. */
  summary: string | null;
  note: string | null;
  validFrom: string | null;
  validTo: string | null;
  confidence: string | null;
  provenance: string;
  basis: string | null;
  /** Chi ha risposto (nascosto ai ruoli del cliente). */
  responder: string | null;
  /** Ruolo per cui ha risposto (etichetta del template). */
  roleLabel: string | null;
  supersedes: boolean;
  files: number;
  textHash: string | null;
  /** Data (nascosta ai ruoli del cliente). */
  at: string | null;
  /** Istante della risposta in ISO (nascosto ai ruoli del cliente): per «2 giorni fa». */
  createdAt: string | null;
  current: boolean;
  validated: boolean;
}

export interface FileView {
  id: string;
  name: string;
  mime: string | null;
  size: string | null;
  zone: "standard" | "personale";
  scan: ScanStatus;
  scanLabel: string;
  personalData: string;
  /** Pulito e controllato (o revisionato): si può scaricare. */
  usable: boolean;
  at: string | null;
}

export interface ValidationView {
  id: string;
  checkKey: string;
  kind: "automatica" | "umana";
  outcome: "ok" | "avviso" | "errore";
  message: string;
  by: string | null;
  at: string | null;
  onCurrentAnswer: boolean;
}

export interface CommentView {
  id: string;
  body: string;
  internal: boolean;
  clarification: boolean;
  open: boolean;
  author: string | null;
  at: string | null;
  replyTo: string | null;
  /** Istante in millisecondi, per la linea del tempo; null se nascosto (art. 15.4) o assente. */
  ts: number | null;
}

export interface LinkedItem {
  id: string;
  key: string;
  title: string;
  kind: ItemKind;
  status: ItemStatus;
  cardinality: string | null;
  note: string | null;
}

export interface LinkGroup {
  relation: LinkRelation;
  direction: "out" | "in";
  label: string;
  items: LinkedItem[];
}

export interface EventView {
  id: string;
  /** Tipo dell'evento (`voce.stato_cambiato`, …). */
  type: string;
  label: string;
  change: string | null;
  actor: string;
  at: string | null;
  /** Istante in millisecondi, per la linea del tempo. */
  ts: number | null;
}

export function rowsToAnswers(
  rows: readonly Row[],
  i: { privacyClass: LoadedItem["snapshot"]["privacyClass"]; valueVisibility: string | null; roles: readonly CaseRole[]; currentAnswerId: string | null; validatedAnswerId: string | null; roleLabels: Readonly<Record<string, string>> },
): AnswerVersionView[] {
  const client = isClientViewer(i.roles);
  const visibility = rowVocab(VALUE_VISIBILITY, i.valueVisibility) ?? "owner_e_ls";
  return rows.flatMap((r) => {
    const kind = rowVocab(ANSWER_KINDS, r.kind);
    const sourceKind = rowVocab(ANSWER_SOURCE_KINDS, r.source_kind);
    if (!kind || !sourceKind) return [];
    const encrypted = rowBool(r.encrypted);
    const erased = rowBool(r.erased);
    const value = answerValueView({ value: rowJson(r.value), encrypted, erased, privacyClass: i.privacyClass, valueVisibility: visibility, roles: i.roles });
    const summary = nonValueAnswerText(kind, value.kind === "value" ? rowJson(r.value) : null);
    const note = answerValueView({ value: rowString(r.note), encrypted: false, erased, privacyClass: i.privacyClass, valueVisibility: visibility, roles: i.roles });
    const confidence = rowVocab(CONFIDENCE, r.confidence);
    const basis = rowVocab(SOURCE_BASIS, r.source_basis);
    const actingRole = rowString(r.acting_role_key);
    const responder = rowString(r.responder_contact_name) ?? (rowString(r.responder_user_id) ? (rowString(r.responder_user_name) ?? "Lateral Space") : null);
    return [
      {
        id: String(r.id),
        version: rowNumber(r.version) ?? 1,
        kindLabel: ANSWER_KIND_LABEL[kind],
        value,
        summary,
        note: note.kind === "value" ? note.text : null,
        validFrom: formatDateIt(rowIsoDate(r.valid_from)),
        validTo: formatDateIt(rowIsoDate(r.valid_to)),
        confidence: confidence ? CONFIDENCE_LABEL[confidence] : null,
        provenance: provenanceText(sourceKind, rowString(r.source_ref)),
        basis: basis ? SOURCE_BASIS_LABEL[basis] : null,
        responder: client ? null : responder,
        roleLabel: actingRole ? (i.roleLabels[actingRole] ?? actingRole) : null,
        supersedes: rowString(r.supersedes_answer_id) !== null,
        files: rowNumber(r.files) ?? 0,
        textHash: rowString(r.text_hash),
        at: client ? null : formatDateTimeIt(rowDate(r.created_at)),
        createdAt: client ? null : (rowDate(r.created_at)?.toISOString() ?? null),
        current: String(r.id) === i.currentAnswerId,
        validated: String(r.id) === i.validatedAnswerId,
      },
    ];
  });
}

/**
 * Una risposta che non è un valore, in parole (§2.6): «Non lo sa», «Propone
 * “non si applica”: …», «L'ha girata a un collega». Null per i valori. Il testo
 * arriva solo se chi guarda vede il valore (`value` null altrimenti).
 */
export function nonValueAnswerText(kind: AnswerKind, value: unknown): string | null {
  const obj = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const text = (k: string) => (typeof obj[k] === "string" && (obj[k] as string).trim() ? (obj[k] as string).trim() : null);
  switch (kind) {
    case "non_so": {
      const who = text("who_might_know");
      return who ? `Non lo sa: potrebbe saperlo ${who}` : "Non lo sa";
    }
    case "proposta_na": {
      const reason = text("reason");
      return reason ? `Propone “non si applica”: ${reason}` : "Propone “non si applica”";
    }
    case "delega":
      return "L'ha girata a un collega";
    default:
      return null;
  }
}

export function rowsToFiles(rows: readonly Row[], roles: readonly CaseRole[]): FileView[] {
  const client = isClientViewer(roles);
  return rows.map((r) => {
    const scan = rowVocab(SCAN_STATUSES, r.scan_status) ?? "in_quarantena";
    const personal = rowVocab(FILE_PERSONAL_DATA, r.personal_data) ?? "sconosciuto";
    return {
      id: String(r.id),
      name: rowString(r.file_name) ?? "file",
      mime: rowString(r.mime),
      size: formatBytes(rowNumber(r.size_bytes)),
      zone: rowString(r.storage_zone) === "personale" ? "personale" : "standard",
      scan,
      scanLabel: SCAN_STATUS_LABEL[scan],
      personalData: FILE_PERSONAL_DATA_LABEL[personal],
      usable: scan === "pulito" && (rowBool(r.content_scanned) || rowBool(r.reviewed)),
      at: client ? null : formatDateIt(rowDate(r.created_at)),
    };
  });
}

export function rowsToValidations(rows: readonly Row[], currentAnswerId: string | null): ValidationView[] {
  return rows.map((r) => ({
    id: String(r.id),
    checkKey: String(r.check_key),
    kind: rowString(r.kind) === "umana" ? "umana" : "automatica",
    outcome: rowVocab(VALIDATION_OUTCOMES, r.outcome) ?? "avviso",
    message: rowString(r.message) ?? "",
    by: rowString(r.by_name),
    at: formatDateTimeIt(rowDate(r.created_at)),
    onCurrentAnswer: currentAnswerId !== null && rowString(r.answer_id) === currentAnswerId,
  }));
}

export function rowsToComments(rows: readonly Row[], roles: readonly CaseRole[]): CommentView[] {
  const client = isClientViewer(roles);
  const internalAllowed = seesInternalComments(roles);
  return rows
    .filter((r) => internalAllowed || rowString(r.visibility) === "condiviso")
    .map((r) => {
      const byContact = rowString(r.author_contact_id) !== null;
      const author = byContact ? (rowString(r.author_contact_name) ?? "Referente") : rowString(r.author_user_id) ? (rowString(r.author_user_name) ?? "Lateral Space") : null;
      const hide = client && byContact;
      return {
        id: String(r.id),
        body: rowString(r.body) ?? "",
        internal: rowString(r.visibility) !== "condiviso",
        clarification: rowString(r.kind) === "chiarimento_richiesto",
        open: rowString(r.kind) === "chiarimento_richiesto" && rowDate(r.resolved_at) === null,
        author: hide ? "Referente" : author,
        at: hide ? null : formatDateTimeIt(rowDate(r.created_at)),
        replyTo: rowString(r.parent_comment_id),
        ts: hide ? null : (rowDate(r.created_at)?.getTime() ?? null),
      };
    });
}

/** Collegamenti raggruppati: prima quelli in uscita, poi quelli in entrata, nell'ordine delle relazioni. */
export function rowsToLinkGroups(rows: readonly Row[]): LinkGroup[] {
  const groups = new Map<string, LinkGroup>();
  for (const r of rows) {
    const relation = rowVocab(LINK_RELATIONS, r.relation);
    if (!relation) continue;
    const direction = rowString(r.dir) === "in" ? "in" : "out";
    const id = `${direction}:${relation}`;
    const group = groups.get(id) ?? { relation, direction, label: RELATION_LABEL[relation][direction], items: [] };
    group.items.push({
      id: String(r.id),
      key: String(r.key),
      title: String(r.title ?? ""),
      kind: rowVocab(ITEM_KINDS, r.kind) ?? "domanda",
      status: rowVocab(ITEM_STATUSES, r.status) ?? "da_chiedere",
      cardinality: rowString(r.cardinality),
      note: rowString(r.note),
    });
    groups.set(id, group);
  }
  const order = (g: LinkGroup) => (g.direction === "out" ? 0 : 100) + LINK_RELATIONS.indexOf(g.relation);
  return [...groups.values()].sort((a, b) => order(a) - order(b));
}

/** Stato in una riga della storia: le parole di Lateral Space, oppure quelle del cliente (§2.6). */
function stateLabel(v: unknown, client: boolean): string | null {
  const s = rowVocab(ITEM_STATUSES, v);
  if (!s) return rowString(v);
  return client ? statusView(s, "cliente").label : STATUS_LABEL[s];
}

export function rowsToEvents(rows: readonly Row[], roles: readonly CaseRole[]): EventView[] {
  const client = isClientViewer(roles);
  return rows.map((r) => {
    const from = stateLabel(r.from_state, client);
    const to = stateLabel(r.to_state, client);
    const actorType = rowString(r.actor_type) ?? "sistema";
    const name = actorType === "utente" && !client ? rowString(r.actor_name) : null;
    return {
      id: String(r.id),
      type: String(r.event_type),
      label: eventLabel(String(r.event_type)),
      change: from && to ? `${from} → ${to}` : to ? `→ ${to}` : null,
      actor: name ?? eventActorLabel(actorType),
      at: formatDateTimeIt(rowDate(r.created_at)),
      ts: rowDate(r.created_at)?.getTime() ?? null,
    };
  });
}

// ── Blocchi della voce ────────────────────────────────────────────────

export interface ItemBlockerView {
  key: string;
  label: string;
  active: boolean;
  permanent: boolean;
  origin: string;
}

export function itemBlockers(loaded: LoadedItem, labels: ReadonlyMap<string, string>): ItemBlockerView[] {
  return loaded.extra.blockerLinks.map((b) => {
    const status = rowVocab(BLOCKER_STATUSES, b.status) ?? "attivo";
    return {
      key: b.key,
      label: labels.get(b.key) ?? b.key,
      active: status !== "sciolto",
      permanent: status === "permanente",
      origin: b.origin === "template" ? "dal template" : b.origin === "scope" ? "per classe o disponibilità" : "aggiunto a mano",
    };
  });
}

// ── Azioni secondo il ruolo ───────────────────────────────────────────

/** Esito di un controllo per un'azione: si può fare, oppure il motivo. */
export type ActionCheck = { ok: true } | { ok: false; message: string };

const OK: ActionCheck = { ok: true };
const no = (message: string): ActionCheck => ({ ok: false, message });

export interface ItemActions {
  validate: ActionCheck | null;
  clarify: boolean;
  markPartial: boolean;
  markMissing: boolean;
  proposeNa: boolean;
  signNa: ActionCheck | null;
  rejectNa: boolean;
  reopen: boolean;
  proposeWaiver: ActionCheck | null;
  signWaiver: boolean;
  proposeFallback: boolean;
  signFallback: boolean;
  recordValue: ActionCheck | null;
  comment: boolean;
  /** Visibilità che chi scrive può scegliere. */
  commentVisibilities: ("interno_ls" | "condiviso")[];
  resolveClarification: boolean;
}

const NO_ACTIONS: ItemActions = {
  validate: null,
  clarify: false,
  markPartial: false,
  markMissing: false,
  proposeNa: false,
  signNa: null,
  rejectNa: false,
  reopen: false,
  proposeWaiver: null,
  signWaiver: false,
  proposeFallback: false,
  signFallback: false,
  recordValue: null,
  comment: false,
  commentVisibilities: [],
  resolveClarification: false,
};

const NA_PROPOSAL_STATUSES: readonly ItemStatus[] = ["da_chiedere", "chiesta", "mancante", "bloccata", "in_verifica"];
const RECORD_STATUSES: readonly ItemStatus[] = ["da_chiedere", "chiesta", "mancante", "parziale", "validata"];
const NO_PLAINTEXT = ["personale", "personale_equipaggio", "escluso_sanitario"];

/**
 * Azioni da mostrare. `readOnly` (osservatori, domini di Lateral Space non
 * configurati) e caso chiuso spengono tutto.
 */
export function itemActions(i: {
  loaded: LoadedItem;
  roles: readonly CaseRole[];
  user: UserContext;
  readOnly: boolean;
  caseStatus: CaseStatus;
  designatedOwnerContactId: string | null;
}): ItemActions {
  if (i.readOnly || i.caseStatus === "chiuso") return NO_ACTIONS;
  const s = i.loaded.snapshot;
  const x = i.loaded.extra;
  const ls = can(i.roles, "esiti_verifica");
  const lead = i.roles.includes("ls_lead");
  const owner = i.roles.includes("owner_cliente");
  const na = naSignatures(s, i.designatedOwnerContactId);
  const naPending = s.na.proposedAt !== null && s.status !== "non_applicabile";
  const waiverPending = s.waiver !== null && x.waiverApprovedAt === null;
  const fallbackPending = s.fallback !== null && x.fallbackApprovedAt === null;
  const validatable = s.status === "in_verifica" || s.status === "parziale";
  const validation = validatable && ls ? canValidate(s, i.user.userId, i.roles, i.user) : null;
  const waiverBlock = waiverForbiddenReason({
    key: s.key,
    kind: s.kind,
    privacyClass: s.privacyClass,
    activeBlockerKeys: s.activeBlockerKeys,
    healthRuleQuestion: x.healthRuleQuestion,
    status: s.status,
  });
  const isLsWriter = can(i.roles, "proporre_voci");
  // Chi non legge i commenti interni (sviluppatore, ruoli del cliente) non li scrive; l'Owner scrive solo commenti condivisi.
  const commentVisibilities: ItemActions["commentVisibilities"] = can(i.roles, "vedere_commenti_interni") ? ["interno_ls", "condiviso"] : owner ? ["condiviso"] : [];
  return {
    validate: validation ? (validation.ok ? OK : no(validation.message)) : null,
    clarify: ls && s.status === "in_verifica",
    markPartial: ls && s.status === "in_verifica",
    markMissing: ls && (s.status === "chiesta" || s.status === "parziale" || s.status === "in_verifica"),
    proposeNa: isLsWriter && NA_PROPOSAL_STATUSES.includes(s.status) && s.na.proposedAt === null,
    signNa: naPending && ((lead && !na.ls) || (owner && !na.client)) ? OK : naPending && (lead || owner) ? no("Hai già firmato: manca l'altra firma.") : null,
    rejectNa: naPending && (lead || owner),
    reopen: lead && s.status === "non_applicabile",
    proposeWaiver:
      isLsWriter && s.priority === "must" && s.status !== "validata" && s.status !== "non_applicabile" && !waiverPending && !(s.waiver && x.waiverApprovedAt)
        ? waiverBlock
          ? no(waiverBlock)
          : OK
        : null,
    signWaiver: waiverPending && (lead || owner),
    proposeFallback: isLsWriter && s.status === "bloccata" && !fallbackPending && !(s.fallback && x.fallbackApprovedAt) && !s.activeBlockerKeys.includes("sanitario"),
    signFallback: fallbackPending && (lead || owner),
    recordValue: isLsWriter && RECORD_STATUSES.includes(s.status)
      ? NO_PLAINTEXT.includes(s.privacyClass)
        ? no("I valori personali si inseriscono solo dalla zona personale, dopo la scheda privacy.")
        : s.responseType === "file" || s.responseType === "dataset"
          ? no("I file si caricano da «Documenti».")
          : OK
      : null,
    comment: commentVisibilities.length > 0,
    commentVisibilities,
    resolveClarification: ls && s.openClarification,
  };
}

// ── Testata del dettaglio ─────────────────────────────────────────────

export interface ItemDetailHeader {
  templateItemKey: string | null;
  sourceRefs: string[];
  statusChangedAt: string | null;
  validatedAt: string | null;
  validatedBy: string | null;
  parent: { id: string; key: string; title: string; status: ItemStatus } | null;
}

export function parseItemDetailRow(row: Row | undefined, roles: readonly CaseRole[]): ItemDetailHeader | null {
  if (!row) return null;
  const client = isClientViewer(roles);
  const parentId = rowString(row.parent_id);
  const refs = rowJson<unknown[]>(row.source_refs);
  return {
    templateItemKey: rowString(row.template_item_key),
    sourceRefs: Array.isArray(refs) ? refs.filter((x): x is string => typeof x === "string") : [],
    statusChangedAt: formatDateTimeIt(rowDate(row.status_changed_at)),
    validatedAt: formatDateIt(rowDate(row.validated_at)),
    validatedBy: client ? null : rowString(row.validated_by_name),
    parent: parentId
      ? { id: parentId, key: String(row.parent_key), title: String(row.parent_title ?? ""), status: rowVocab(ITEM_STATUSES, row.parent_status) ?? "da_chiedere" }
      : null,
  };
}

/** Note del template su privacy, disponibilità e perimetro (testi originali). */
export function itemNotes(spec: Readonly<Record<string, Json>>): { label: string; text: string }[] {
  const notes = rowObject(spec.notes);
  const out: { label: string; text: string }[] = [];
  for (const [k, label] of [
    ["privacy", "Privacy"],
    ["availability", "Disponibilità"],
    ["perimeter", "Perimetro"],
  ] as const) {
    const v = notes[k];
    if (typeof v === "string" && v.trim()) out.push({ label, text: v.trim() });
  }
  return out;
}

// ── Pannello e pagina della domanda (DESIGN §3.6.5, §3.6.8) ───────────

/**
 * Le azioni della domanda, con le parole di §2.6. Le firme non ci sono: si
 * firma (e si respinge) solo da `/firme`, con lo stesso testo e la stessa
 * impronta del link di approvazione (§1.1, §3.11); qui resta l'avviso in linea
 * con [Firma] (`pendingSignatureNotice`).
 */
export const QUESTION_ACTIONS = ["validate", "clarify", "askAgain", "record", "reopen", "partial", "missing", "proposeNa", "proposeWaiver", "proposeFallback", "reassign"] as const;
export type QuestionActionKey = (typeof QUESTION_ACTIONS)[number];

export const QUESTION_ACTION_LABEL: Readonly<Record<QuestionActionKey, string>> = {
  validate: "Valida",
  clarify: "Chiedi un chiarimento",
  askAgain: "Chiedi di nuovo",
  record: "Inserisci un valore da una fonte",
  reopen: "Riapri",
  partial: "Risposta parziale",
  missing: "Manca il dato",
  proposeNa: "Proponi “non si applica”",
  proposeWaiver: "Proponi di partire senza risposta",
  proposeFallback: "Proponi una soluzione provvisoria",
  reassign: "Affida a un altro collega",
};

/** «Chiedi di nuovo»: la domanda torna al referente (`sendRequests`), da questi stati e solo con un referente. */
const ASK_AGAIN_STATUSES: readonly ItemStatus[] = ["da_chiedere", "mancante", "parziale"];

export function canAskAgain(i: { status: ItemStatus; hasAssignee: boolean; roles: readonly CaseRole[]; writable: boolean }): boolean {
  return i.writable && i.hasAssignee && can(i.roles, "inviare_richieste") && ASK_AGAIN_STATUSES.includes(i.status);
}

/** «Chiedi al referente» la prima volta, «Chiedi di nuovo» dopo. */
export function askAgainLabel(status: ItemStatus): string {
  return status === "da_chiedere" ? "Chiedi al referente" : QUESTION_ACTION_LABEL.askAgain;
}

export interface QuestionActionPlan {
  /** Al massimo 2, scelte dallo stato (§3.6.5). */
  primary: QuestionActionKey[];
  /** Tutte le altre, nel menu «⋯» (in «Verifica una alla volta», «Altro»). */
  more: QuestionActionKey[];
}

/** Azione presente (anche se oggi non si può fare: allora resta, con il motivo). */
function offered(actions: ItemActions, key: QuestionActionKey, extra: { askAgain: boolean; reassign: boolean }): boolean {
  switch (key) {
    case "validate":
      return actions.validate !== null;
    case "clarify":
      return actions.clarify;
    case "askAgain":
      return extra.askAgain;
    case "record":
      return actions.recordValue !== null;
    case "reopen":
      return actions.reopen;
    case "partial":
      return actions.markPartial;
    case "missing":
      return actions.markMissing;
    case "proposeNa":
      return actions.proposeNa;
    case "proposeWaiver":
      return actions.proposeWaiver !== null;
    case "proposeFallback":
      return actions.proposeFallback;
    case "reassign":
      return extra.reassign;
  }
}

/**
 * Le primarie per stato (§3.6.5): da verificare, da fare, «non si applica»; le
 * bloccate nessuna. Una domanda a posto non ha un comando «Riapri» (in
 * `item-state.ts` non c'è il passaggio validata → riaperta, solo da «non si
 * applica»): la si corregge con un valore nuovo, che torna da verificare.
 */
const PRIMARY_BY_STATUS: Readonly<Record<ItemStatus, readonly QuestionActionKey[]>> = {
  in_verifica: ["validate", "clarify"],
  da_chiedere: ["askAgain", "record"],
  chiesta: ["askAgain", "record"],
  mancante: ["askAgain", "record"],
  parziale: ["askAgain", "record"],
  non_applicabile: ["reopen"],
  validata: ["record"],
  bloccata: [],
};

/**
 * Primarie e menu della domanda. Il cliente (§3.6.8) ha una sola azione:
 * «Affida a un altro collega». Le firme non stanno qui: l'avviso in linea
 * porta a `/firme`. Le azioni che il ruolo non ha non compaiono.
 */
export function questionActionPlan(i: { status: ItemStatus; actions: ItemActions; askAgain: boolean; reassign: boolean; client: boolean }): QuestionActionPlan {
  const extra = { askAgain: i.askAgain, reassign: i.reassign };
  if (i.client) return { primary: i.reassign ? ["reassign"] : [], more: [] };
  const all = QUESTION_ACTIONS.filter((k) => k !== "reassign" && offered(i.actions, k, extra));
  const primary = PRIMARY_BY_STATUS[i.status].filter((k) => all.includes(k)).slice(0, 2);
  return { primary, more: all.filter((k) => !primary.includes(k)) };
}

/** «Altro ▾» di «Verifica una alla volta» (§3.6.4): solo questi tre. */
const REVIEW_MORE: readonly QuestionActionKey[] = ["partial", "missing", "proposeNa"];

/** Le azioni di una scheda di «Verifica una alla volta»: le primarie del pannello, e in «Altro» solo parziale, manca il dato e «non si applica». */
export function reviewActionPlan(plan: QuestionActionPlan): QuestionActionPlan {
  return { primary: plan.primary, more: REVIEW_MORE.filter((k) => plan.more.includes(k)) };
}

/**
 * Il motivo dello stato, sotto lo stato (§3.6.5): quello scritto con «Manca il
 * dato» o «Risposta parziale», che i moduli promettono visibile sulla domanda.
 * Il cliente lo legge con le sue parole (§2.6) per le domande da completare;
 * Lateral Space anche per quelle da verificare («dato scaduto»).
 */
export function statusReasonLine(status: ItemStatus, reason: string | null, client: boolean): string | null {
  const text = reason?.trim();
  if (!text) return null;
  const head = client
    ? status === "mancante"
      ? "Ci manca ancora questo dato"
      : status === "parziale"
        ? "Da completare"
        : null
    : status === "mancante"
      ? "Manca il dato"
      : status === "parziale"
        ? "Risposta parziale"
        : status === "in_verifica"
          ? "Da verificare"
          : null;
  if (!head) return null;
  // «Il referente ha risposto…» → «il referente ha risposto…»; le sigle restano («IVA esclusa»).
  const body = /^\p{Lu}\p{Ll}/u.test(text) ? `${text.charAt(0).toLowerCase()}${text.slice(1)}` : text;
  return `${head}: ${body}`;
}

export interface PendingSignatureNotice {
  text: string;
  /** Chi guarda può firmare adesso: [Firma] porta a `/firme`. */
  canSign: boolean;
}

function sidesOf(approvals: readonly { ruolo: string }[] | null | undefined): { ls: boolean; client: boolean } {
  const list = approvals ?? [];
  return { ls: list.some((a) => a.ruolo === "ls_lead" || a.ruolo === "ls_analista"), client: list.some((a) => a.ruolo === "owner_cliente") };
}

function missingText(sides: { ls: boolean; client: boolean }, what: string): string {
  if (sides.ls && !sides.client) return `Serve la firma del cliente per ${what}.`;
  if (sides.client && !sides.ls) return `Serve la firma di Lateral Space per ${what}.`;
  return `Servono le due firme per ${what}.`;
}

/**
 * L'avviso «Firma in attesa» (§3.6.5): «non si applica», partire senza
 * risposta o soluzione provvisoria proposti e non ancora firmati da tutti e due.
 */
export function pendingSignatureNotice(loaded: LoadedItem, actions: ItemActions, designatedOwnerContactId: string | null): PendingSignatureNotice | null {
  const s = loaded.snapshot;
  const x = loaded.extra;
  if (s.na.proposedAt !== null && s.status !== "non_applicabile") {
    const na = naSignatures(s, designatedOwnerContactId);
    return { text: missingText({ ls: na.ls, client: na.client }, "“non si applica”"), canSign: actions.signNa?.ok === true };
  }
  if (s.waiver && x.waiverApprovedAt === null) return { text: missingText(sidesOf(s.waiver.approvazioni), "partire senza risposta"), canSign: actions.signWaiver };
  if (s.fallback && x.fallbackApprovedAt === null) return { text: missingText(sidesOf(s.fallback.approvazioni), "la soluzione provvisoria"), canSign: actions.signFallback };
  return null;
}

export interface QuestionAnswerView {
  value: ValueView;
  /** «Non lo sa», «Propone “non si applica”: …» al posto del valore. */
  summary: string | null;
  /** Valore dichiarato in call: in grigio, da confermare. */
  declared: boolean;
  /** «Da Mario Rossi, Commerciale · 2 giorni fa · È una stima» (solo Lateral Space). */
  byLine: string | null;
  /** Avvisi ed errori dei controlli sulla risposta corrente, subito sotto il valore. */
  checks: { outcome: "avviso" | "errore"; message: string }[];
  /** «Dettagli della risposta»: fonte, affidabilità, valida dal/fino al, nota, file. */
  details: [string, string][];
  /** Versioni precedenti, dalla più recente (solo Lateral Space). */
  previous: AnswerVersionView[];
}

/**
 * La risposta nel pannello (§3.6.5); null solo se nessuno ha ancora risposto.
 * Per il cliente (§3.6.8) solo il valore, se il suo ruolo lo vede, altrimenti
 * il motivo per cui non lo vede: niente autore, data né provenienza.
 */
export function questionAnswerView(
  answers: readonly AnswerVersionView[],
  validations: readonly ValidationView[],
  i: { client: boolean; now: Date },
): QuestionAnswerView | null {
  if (answers.length === 0) return null;
  const current = answers.find((a) => a.current) ?? answers[0];
  if (i.client) {
    // Il referente ha risposto anche quando il ruolo non vede il valore: allora c'è il motivo («Valore non visibile per il tuo ruolo»).
    return { value: current.value, summary: current.summary, declared: false, byLine: null, checks: [], details: [], previous: [] };
  }
  const by = [current.responder, current.roleLabel].filter(Boolean).join(", ");
  const when = formatRelativeIt(current.createdAt, i.now);
  const byLine = [by ? `Da ${by}` : null, when, current.confidence].filter(Boolean).join(" · ") || null;
  const details: [string, string][] = [];
  for (const [label, value] of [
    ["Fonte", current.provenance],
    ["Da dove viene", current.basis],
    ["Affidabilità", current.confidence],
    ["Valida dal", current.validFrom],
    ["Valida fino al", current.validTo],
    ["Nota", current.note],
    ["File allegati", current.files > 0 ? String(current.files) : null],
  ] as const) {
    if (value) details.push([label, value]);
  }
  return {
    value: current.value,
    summary: current.summary,
    declared: current.provenance.startsWith("Dichiarato in call"),
    byLine,
    checks: validations
      .filter((v) => v.onCurrentAnswer && v.kind === "automatica" && v.outcome !== "ok")
      .map((v) => ({ outcome: v.outcome === "errore" ? ("errore" as const) : ("avviso" as const), message: v.message })),
    details,
    previous: answers.filter((a) => a.id !== current.id),
  };
}

export interface ActivityEntry {
  id: string;
  kind: "commento" | "evento";
  title: string;
  /** Testo del commento. */
  body: string | null;
  /** «Luca Verdi · 2 giorni fa», «Sistema · ieri». */
  meta: string;
  internal: boolean;
  clarification: boolean;
  open: boolean;
  commentId: string | null;
  ts: number;
}

/** Eventi che ripetono un commento: nella linea del tempo resta il commento. */
const COMMENT_EVENTS = new Set(["commento.creato", "chiarimento.richiesto"]);

/**
 * Commenti e storia in una sola linea del tempo, dal più recente (§3.6.5,
 * «Attività»). Le voci senza data (nascoste al cliente, art. 15.4) vanno in
 * fondo.
 */
export function activityTimeline(comments: readonly CommentView[], events: readonly EventView[], now: Date): ActivityEntry[] {
  const out: ActivityEntry[] = [];
  for (const c of comments) {
    const when = c.ts !== null ? formatRelativeIt(new Date(c.ts), now) : null;
    out.push({
      id: `c:${c.id}`,
      kind: "commento",
      title: c.clarification ? (c.open ? "Chiarimento aperto" : "Chiarimento chiuso") : "Commento",
      body: c.body,
      meta: [c.author, when].filter(Boolean).join(" · "),
      internal: c.internal,
      clarification: c.clarification,
      open: c.open,
      commentId: c.id,
      ts: c.ts ?? 0,
    });
  }
  for (const e of events) {
    if (COMMENT_EVENTS.has(e.type)) continue;
    const when = e.ts !== null ? formatRelativeIt(new Date(e.ts), now) : null;
    out.push({
      id: `e:${e.id}`,
      kind: "evento",
      title: e.change ? `${e.label} · ${e.change}` : e.label,
      body: null,
      meta: [e.actor, when].filter(Boolean).join(" · "),
      internal: false,
      clarification: false,
      open: false,
      commentId: null,
      ts: e.ts ?? 0,
    });
  }
  return out.sort((a, b) => b.ts - a.ts || a.id.localeCompare(b.id));
}

/** Le domande collegate (in entrata e in uscita), una volta sola: «Collegata a N domande». */
export function linkedItems(groups: readonly LinkGroup[]): LinkedItem[] {
  const seen = new Map<string, LinkedItem>();
  for (const g of groups) for (const it of g.items) if (!seen.has(it.id)) seen.set(it.id, it);
  return [...seen.values()];
}
