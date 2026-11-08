/**
 * «Cosa serve»: requisiti e prossimi passi degli use case (`use_case_needs`, drizzle/0022; spec di
 * Pierpaolo, 25/10/2026).
 *
 * - **Vocabolari ed etichette**: tipo (requisito, prossimo passo), di che cosa si tratta, da che
 *   parte sta chi se ne occupa, quando serve. Gli stati dei requisiti sono gli 8 stati delle voci
 *   dei dossier, con le loro etichette e i loro colori (`STATUS_LABEL`, `STATUS_COLOR`); quelli dei
 *   passi sono proposta, confermata, fatta.
 * - **Fatto**: un requisito è a posto (validato o non applicabile, il gruppo «A posto» di
 *   `STATUS_GROUP_OF`), un passo è fatto. `done_at` segue questa regola (`needs-service.ts`).
 * - **Validazione** (`validateNeedInput`, `validateNeedPatch`): uno schema solo per la pagina e,
 *   più avanti, per il MCP del team. I messaggi sono in italiano.
 * - **Viste** (`buildNeedsBoard`, `panelNeeds`, `needListsOfUseCase`): la vista «Cosa serve» (una
 *   lista sola per chi deve muoversi, con la linea del tempo dei prossimi passi, rilascio 4), il
 *   blocco del pannello e il capitolo della scheda, da un elenco già letto per i revisori. Le stesse
 *   righe, lo stesso ordine (`needsActionFirst`, `compareStepsByDate`) e le stesse cinque in vista
 *   (`NEED_ROWS_SHOWN`) nei tre posti. Gli agenti di una riga vengono dal titolo dei suoi use case
 *   (`needAgents`). Nessun conteggio e nessun filtro per persona: «Chi» è un testo della riga, mai
 *   un criterio.
 * - **Conteggi** (`NeedAskCounts`): i requisiti per gruppo di stato, come «Raccolta informazioni»
 *   della scheda: da chiedere (da chiedere, manca il dato, risposta parziale), in attesa, da
 *   verificare, fermi, a posto. Sempre di esigenze, mai di persone, mai per «Chi» o per parte.
 * - **Cinque gruppi a schermo** (`needRequestGroupView`, rilascio 3): le righe dei requisiti della
 *   scheda, del pannello e della vista «Cosa serve» dicono il gruppo («Da chiedere», «In attesa»,
 *   «Da verificare», «Ferma», «A posto») con il dettaglio quando serve («manca il dato»). Gli otto
 *   stati restano nel modulo di modifica (`needStatusChoices`), nel MCP del team e nell'export
 *   (`needStatusView`, «Bloccata»).
 *
 * Le esigenze non si cancellano: si archiviano. Le letture le portano solo ai revisori.
 * Modulo puro: import relativi `.ts` e `zod`; si usa anche nei componenti client.
 */
import { z } from "zod";
import {
  USE_CASE_NEED_AVAILABILITIES,
  USE_CASE_NEED_KINDS,
  USE_CASE_NEED_OWNER_SIDES,
  USE_CASE_NEED_REQUIREMENT_STATUSES,
  USE_CASE_NEED_STEP_STATUSES,
  USE_CASE_NEED_TYPES,
  type UseCaseNeedAvailability,
  type UseCaseNeedKind,
  type UseCaseNeedOwnerSide,
  type UseCaseNeedStatus,
  type UseCaseNeedType,
} from "../db/use-case-hub-value-ddl.ts";
import { STATUS_COLOR, STATUS_LABEL } from "../uc/semaforo.ts";
import { companyLabel } from "./referent/labels.ts";
import { STATUS_GROUP_OF } from "../uc/views/status-groups.ts";
import type { ItemStatus, SemaforoColor } from "../uc/vocab.ts";
import { agentOfTitle } from "./agents.ts";
import { FIGURE_SEPARATOR, formatDayInYear, formatEuro, formatInteger } from "./format.ts";
import { isIsoDate } from "./quarter.ts";
import type { IsoDate } from "./types.ts";
import { componentResult } from "./value-calc.ts";
import { VALUE_CONFIDENCE_LABELS, type ValueComponent, type ValueModel, type ValueParams } from "./value-model.ts";

// ─── Vocabolari ──────────────────────────────────────────────────────

export const NEED_TYPES = USE_CASE_NEED_TYPES;
export const NEED_KINDS = USE_CASE_NEED_KINDS;
export const NEED_OWNER_SIDES = USE_CASE_NEED_OWNER_SIDES;
export const NEED_AVAILABILITIES = USE_CASE_NEED_AVAILABILITIES;
export const NEED_REQUIREMENT_STATUSES = USE_CASE_NEED_REQUIREMENT_STATUSES;
export const NEED_STEP_STATUSES = USE_CASE_NEED_STEP_STATUSES;
export type NeedType = UseCaseNeedType;
export type NeedKind = UseCaseNeedKind;
export type NeedOwnerSide = UseCaseNeedOwnerSide;
export type NeedAvailability = UseCaseNeedAvailability;
export type NeedStatus = UseCaseNeedStatus;
export type NeedStepStatus = (typeof USE_CASE_NEED_STEP_STATUSES)[number];

export const NEED_TYPE_LABEL: Readonly<Record<NeedType, string>> = Object.freeze({ requisito: "Requisito", passo: "Prossimo passo" });

export const NEED_KIND_LABEL: Readonly<Record<NeedKind, string>> = Object.freeze({
  accesso: "Accesso",
  dato: "Dato",
  documento: "Documento",
  regola: "Regola",
  decisione: "Decisione",
  persona: "Persona o ruolo",
  contratto: "Contratto",
  altro: "Altro",
});

export const NEED_OWNER_SIDE_LABEL: Readonly<Record<NeedOwnerSide, string>> = Object.freeze({
  cliente: "Cliente",
  lateral_space: "Lateral Space",
  fornitore: "Fornitore",
  insieme: "Insieme",
});

export const NEED_AVAILABILITY_LABEL: Readonly<Record<NeedAvailability, string>> = Object.freeze({
  subito: "Subito",
  dopo_a8: "Dopo la scheda A.8",
});

/** Gli stati di un passo, al maschile come «passo» e come «Fatti · 3» (i valori salvati restano proposta, confermata, fatta). */
export const NEED_STEP_STATUS_LABEL: Readonly<Record<NeedStepStatus, string>> = Object.freeze({
  proposta: "Proposto",
  confermata: "Confermato",
  fatta: "Fatto",
});

const STEP_TONE: Readonly<Record<NeedStepStatus, SemaforoColor>> = { proposta: "grigio", confermata: "blu", fatta: "verde" };

/** Le aree dei tipi di esigenza (il modulo e il MCP del team), con i tipi che raccolgono; la vista «Cosa serve» non le divide più (rilascio 4). */
export const NEED_AREAS = Object.freeze([
  { key: "accessi", label: "Accessi", kinds: ["accesso"] },
  { key: "dati", label: "Dati e documenti", kinds: ["dato", "documento"] },
  { key: "regole", label: "Regole e decisioni", kinds: ["regola", "decisione"] },
  { key: "persone", label: "Persone e ruoli", kinds: ["persona"] },
  { key: "contratto", label: "Contratto e governance", kinds: ["contratto"] },
  { key: "altro", label: "Altro", kinds: ["altro"] },
] as const satisfies ReadonlyArray<{ key: string; label: string; kinds: readonly NeedKind[] }>);
export type NeedAreaKey = (typeof NEED_AREAS)[number]["key"];

export function needAreaOf(kind: NeedKind): NeedAreaKey {
  return NEED_AREAS.find((area) => (area.kinds as readonly NeedKind[]).includes(kind))?.key ?? "altro";
}

/** Lo stato con cui nasce un'esigenza senza stato: un requisito da chiedere, un passo proposto. */
export function defaultNeedStatus(type: NeedType): NeedStatus {
  return type === "requisito" ? "da_chiedere" : "proposta";
}

/** Gli stati ammessi per il tipo (lo stesso CHECK della 0022). */
export function needStatusesOf(type: NeedType): readonly NeedStatus[] {
  return type === "requisito" ? NEED_REQUIREMENT_STATUSES : NEED_STEP_STATUSES;
}

export function isNeedStatusOf(type: NeedType, status: unknown): status is NeedStatus {
  return typeof status === "string" && (needStatusesOf(type) as readonly string[]).includes(status);
}

/** Fatto: un requisito a posto (validato, non applicabile), un passo fatto. */
export function isNeedDone(type: NeedType, status: NeedStatus): boolean {
  if (type === "passo") return status === "fatta";
  return STATUS_GROUP_OF[status as ItemStatus] === "a_posto";
}

/** La parola e il colore del puntino dello stato. */
export function needStatusView(type: NeedType, status: NeedStatus): { label: string; tone: SemaforoColor } {
  if (type === "passo") {
    const step = (NEED_STEP_STATUSES as readonly string[]).includes(status) ? (status as NeedStepStatus) : "proposta";
    return { label: NEED_STEP_STATUS_LABEL[step], tone: STEP_TONE[step] };
  }
  const item = (NEED_REQUIREMENT_STATUSES as readonly string[]).includes(status) ? (status as ItemStatus) : "da_chiedere";
  return { label: STATUS_LABEL[item], tone: STATUS_COLOR[item] };
}

/** Le scelte dello stato, per il modulo. */
export function needStatusChoices(type: NeedType): Array<{ value: NeedStatus; label: string }> {
  return needStatusesOf(type).map((value) => ({ value, label: needStatusView(type, value).label }));
}

// ─── Validazione ─────────────────────────────────────────────────────

export const NEED_LIMITS = Object.freeze({
  title: 300,
  detail: 4000,
  ownerLabel: 120,
  dueLabel: 80,
  forLabel: 200,
  importKey: 128,
  archiveReason: 300,
  sortOrderMax: 1_000_000,
  /** Use case collegati in una creazione. */
  useCaseIds: 50,
});

export const NEED_ERRORS = Object.freeze({
  title: "Scrivi che cosa serve.",
  tooLong: (max: number) => `Al massimo ${formatInteger(max)} caratteri.`,
  status: "Questo stato non vale per questo tipo.",
  dueOn: "Data non valida.",
  archiveReason: "Scrivi perché la archivi.",
  importKeyTaken: "Questa chiave è già usata in questo workspace.",
  useCase: "Use case non trovato.",
  archived: "Questa esigenza è archiviata.",
  invalid: "Controlla questo valore.",
});

/** Testo facoltativo: spazi tolti, vuoto vale null. */
const optionalText = (max: number) =>
  z
    .union([z.string(), z.null()])
    .optional()
    .transform((value) => (typeof value === "string" ? value.trim() || null : value))
    .refine((value) => value === undefined || value === null || value.length <= max, { error: NEED_ERRORS.tooLong(max) });

const needFields = {
  kind: z.enum(USE_CASE_NEED_KINDS, { error: NEED_ERRORS.invalid }).optional(),
  detail: optionalText(NEED_LIMITS.detail),
  ownerLabel: optionalText(NEED_LIMITS.ownerLabel),
  ownerSide: z.enum(USE_CASE_NEED_OWNER_SIDES, { error: NEED_ERRORS.invalid }).nullable().optional(),
  status: z.string({ error: NEED_ERRORS.status }).optional(),
  availability: z.enum(USE_CASE_NEED_AVAILABILITIES, { error: NEED_ERRORS.invalid }).nullable().optional(),
  dueOn: z
    .union([z.string(), z.null()])
    .optional()
    .transform((value) => (typeof value === "string" ? value.trim() || null : value))
    .refine((value) => value === undefined || value === null || isIsoDate(value), { error: NEED_ERRORS.dueOn }),
  dueLabel: optionalText(NEED_LIMITS.dueLabel),
  dueIsProposal: z.boolean({ error: NEED_ERRORS.invalid }).optional(),
  forLabel: optionalText(NEED_LIMITS.forLabel),
  sortOrder: z.number({ error: NEED_ERRORS.invalid }).int({ error: NEED_ERRORS.invalid }).min(0, { error: NEED_ERRORS.invalid }).max(NEED_LIMITS.sortOrderMax, { error: NEED_ERRORS.invalid }).optional(),
  importKey: optionalText(NEED_LIMITS.importKey),
};

const titleSchema = z
  .string({ error: NEED_ERRORS.title })
  .transform((value) => value.trim())
  .refine((value) => value.length > 0, { error: NEED_ERRORS.title })
  .refine((value) => value.length <= NEED_LIMITS.title, { error: NEED_ERRORS.tooLong(NEED_LIMITS.title) });

export const needInputSchema = z.strictObject({
  type: z.enum(USE_CASE_NEED_TYPES, { error: NEED_ERRORS.invalid }),
  title: titleSchema,
  ...needFields,
});

export const needPatchSchema = z.strictObject({
  type: z.enum(USE_CASE_NEED_TYPES, { error: NEED_ERRORS.invalid }).optional(),
  title: titleSchema.optional(),
  ...needFields,
});

export type NeedInputRaw = z.input<typeof needInputSchema>;
export type NeedPatchRaw = z.input<typeof needPatchSchema>;

/** Un'esigenza nuova, già validata: ogni campo ha il suo valore (null dove manca). */
export interface NeedInput {
  type: NeedType;
  kind: NeedKind;
  title: string;
  detail: string | null;
  ownerLabel: string | null;
  ownerSide: NeedOwnerSide | null;
  status: NeedStatus;
  availability: NeedAvailability | null;
  dueOn: IsoDate | null;
  dueLabel: string | null;
  dueIsProposal: boolean;
  forLabel: string | null;
  sortOrder: number;
  importKey: string | null;
}

/** Le colonne che una modifica cambia: solo quelle presenti. */
export type NeedPatch = Partial<NeedInput>;

export type FieldErrors = Record<string, string>;

function fieldErrorsOf(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) out[[...issue.path, key].join(".")] ??= NEED_ERRORS.invalid;
      continue;
    }
    const key = issue.path.join(".") || "payload";
    // I messaggi di zod sono in inglese: solo i nostri passano.
    const own = (Object.values(NEED_ERRORS) as unknown[]).includes(issue.message) || /^Al massimo /.test(issue.message);
    out[key] ??= own ? issue.message : NEED_ERRORS.invalid;
  }
  return out;
}

/** Un'esigenza nuova dalla pagina o dal MCP: stato predefinito per tipo, tipo «altro» se manca. */
export function validateNeedInput(raw: unknown): { ok: true; value: NeedInput } | { ok: false; fieldErrors: FieldErrors } {
  const parsed = needInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };
  const v = parsed.data;
  const status = v.status ?? defaultNeedStatus(v.type);
  if (!isNeedStatusOf(v.type, status)) return { ok: false, fieldErrors: { status: NEED_ERRORS.status } };
  return {
    ok: true,
    value: {
      type: v.type,
      kind: v.kind ?? "altro",
      title: v.title,
      detail: v.detail ?? null,
      ownerLabel: v.ownerLabel ?? null,
      ownerSide: v.ownerSide ?? null,
      status,
      availability: v.availability ?? null,
      dueOn: (v.dueOn ?? null) as IsoDate | null,
      dueLabel: v.dueLabel ?? null,
      dueIsProposal: v.dueIsProposal ?? false,
      forLabel: v.forLabel ?? null,
      sortOrder: v.sortOrder ?? 0,
      importKey: v.importKey ?? null,
    },
  };
}

/**
 * Una modifica, sull'esigenza com'è adesso: lo stato deve valere per il tipo di dopo. Cambiando
 * tipo senza stato, lo stato torna quello di partenza del tipo nuovo.
 */
export function validateNeedPatch(
  raw: unknown,
  current: { type: NeedType; status: NeedStatus },
): { ok: true; value: NeedPatch } | { ok: false; fieldErrors: FieldErrors } {
  const parsed = needPatchSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };
  const v = parsed.data;
  const patch: NeedPatch = {};
  for (const key of Object.keys(v) as Array<keyof typeof v>) {
    const value = v[key];
    if (value !== undefined) (patch as Record<string, unknown>)[key] = value;
  }
  const type = patch.type ?? current.type;
  if (patch.status !== undefined) {
    if (!isNeedStatusOf(type, patch.status)) return { ok: false, fieldErrors: { status: NEED_ERRORS.status } };
  } else if (type !== current.type && !isNeedStatusOf(type, current.status)) {
    patch.status = defaultNeedStatus(type);
  }
  return { ok: true, value: patch };
}

/** «Archivia»: il motivo, obbligatorio. */
export function validateArchiveReason(raw: unknown): { ok: true; value: string } | { ok: false; fieldErrors: FieldErrors } {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return { ok: false, fieldErrors: { archiveReason: NEED_ERRORS.archiveReason } };
  if (text.length > NEED_LIMITS.archiveReason) return { ok: false, fieldErrors: { archiveReason: NEED_ERRORS.tooLong(NEED_LIMITS.archiveReason) } };
  return { ok: true, value: text };
}

// ─── Lettura ─────────────────────────────────────────────────────────

/** Un'esigenza come la leggono i revisori (`listWorkspaceNeeds`), con gli use case collegati. */
export interface NeedView {
  id: string;
  type: NeedType;
  kind: NeedKind;
  title: string;
  detail: string | null;
  ownerLabel: string | null;
  ownerSide: NeedOwnerSide | null;
  status: NeedStatus;
  availability: NeedAvailability | null;
  dueOn: IsoDate | null;
  dueLabel: string | null;
  dueIsProposal: boolean;
  forLabel: string | null;
  sortOrder: number;
  version: number;
  importKey: string | null;
  /** ISO. */
  createdAt: string;
  updatedAt: string;
  doneAt: string | null;
  archivedAt: string | null;
  archiveReason: string | null;
  /** Id degli use case collegati, in minuscolo, dello stesso workspace. */
  useCaseIds: string[];
}

/** Uno use case come lo nominano le righe: id, codice e titolo. */
export interface NeedUseCaseRef {
  id: string;
  code: string | null;
  title: string;
}

/** Una riga di «Cosa serve», già scritta per lo schermo. */
export interface NeedRow {
  id: string;
  type: NeedType;
  kind: NeedKind;
  title: string;
  detail: string | null;
  /** «Giulia, ufficio acquisti · Cliente»; null senza nessuno. */
  owner: string | null;
  /**
   * Lo stato a schermo: per un requisito il suo gruppo dei cinque («Da chiedere», «In attesa», «Da
   * verificare», «Ferma», «A posto», `needRequestGroupView`), per un passo il suo stato («Proposto»).
   */
  status: { label: string; tone: SemaforoColor };
  /** Il dettaglio dello stato di un requisito nel suo gruppo: «manca il dato», «risposta parziale», «non si applica»; null senza o per un passo. */
  statusNote: string | null;
  done: boolean;
  /** «15 nov», «entro fine mese»; con «(proposta)» se la data non è ancora confermata, tranne su un passo «Proposto». */
  due: string | null;
  availability: NeedAvailability | null;
  /** Gli use case collegati, per codice. */
  useCases: NeedUseCaseRef[];
  /** Per chi è, a parole, quando non è collegata a uno use case. */
  forLabel: string | null;
}

export const NEED_TEXT = Object.freeze({
  proposal: "(proposta)",
});

/** «Giulia · Cliente», «Cliente», oppure null. La parte che ripete il nome non si ripete: «Lateral Space». */
export function needOwnerText(need: Pick<NeedView, "ownerLabel" | "ownerSide">): string | null {
  const side = need.ownerSide ? NEED_OWNER_SIDE_LABEL[need.ownerSide] : null;
  if (need.ownerLabel && side && need.ownerLabel.trim().toLowerCase() === side.toLowerCase()) return need.ownerLabel;
  if (need.ownerLabel && side) return `${need.ownerLabel}${FIGURE_SEPARATOR}${side}`;
  return need.ownerLabel ?? side;
}

/** «15 nov», «15 nov 2027», il testo libero, con «(proposta)»; null senza scadenza. */
export function needDueText(need: Pick<NeedView, "dueOn" | "dueLabel" | "dueIsProposal">, today: string): string | null {
  const base = need.dueOn ? formatDayInYear(need.dueOn, today) : need.dueLabel;
  if (!base) return null;
  return need.dueIsProposal ? `${base} ${NEED_TEXT.proposal}` : base;
}

function byCode(a: NeedUseCaseRef, b: NeedUseCaseRef): number {
  if (a.code && b.code) return a.code.localeCompare(b.code, "it-IT", { numeric: true });
  if (a.code || b.code) return a.code ? -1 : 1;
  return a.title.localeCompare(b.title, "it-IT") || a.id.localeCompare(b.id);
}

/** L'ordine delle righe: quello scelto, poi la scadenza (le senza data in fondo), poi il titolo. */
export function compareNeeds(a: Pick<NeedView, "sortOrder" | "dueOn" | "title" | "id">, b: Pick<NeedView, "sortOrder" | "dueOn" | "title" | "id">): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  if (a.dueOn !== b.dueOn) {
    if (!a.dueOn) return 1;
    if (!b.dueOn) return -1;
    return a.dueOn.localeCompare(b.dueOn);
  }
  return a.title.localeCompare(b.title, "it-IT") || a.id.localeCompare(b.id);
}

/**
 * L'ordine dei prossimi passi (rilascio 4): dalla scadenza più vicina, quelli senza data in fondo,
 * poi l'ordine del team (`compareNeeds`). Lo stesso nel capitolo della scheda, nel pannello laterale
 * e nella linea del tempo di «Cosa serve».
 */
export function compareStepsByDate(a: Pick<NeedView, "sortOrder" | "dueOn" | "title" | "id">, b: Pick<NeedView, "sortOrder" | "dueOn" | "title" | "id">): number {
  if (a.dueOn !== b.dueOn) {
    if (!a.dueOn) return 1;
    if (!b.dueOn) return -1;
    return a.dueOn.localeCompare(b.dueOn);
  }
  return compareNeeds(a, b);
}

/**
 * Le righe dei requisiti aperti che si vedono subito, le altre sotto «Mostra le altre N»: le stesse
 * cinque nel capitolo della scheda e in ogni gruppo di «Cosa serve» (rilascio 4).
 */
export const NEED_ROWS_SHOWN = 5;

/**
 * Prima quello che chiede di agire: i requisiti «Da verificare» (è arrivata una risposta o un
 * documento da guardare), poi l'ordine scelto dal team (`compareNeeds`).
 */
export function needsActionFirst(
  a: Pick<NeedView, "type" | "status" | "sortOrder" | "dueOn" | "title" | "id">,
  b: Pick<NeedView, "type" | "status" | "sortOrder" | "dueOn" | "title" | "id">,
): number {
  const verifyA = a.type === "requisito" && a.status === "in_verifica";
  const verifyB = b.type === "requisito" && b.status === "in_verifica";
  if (verifyA !== verifyB) return verifyA ? -1 : 1;
  return compareNeeds(a, b);
}

/**
 * La riga di un'esigenza, con gli use case che chi guarda conosce. Un requisito dice il suo gruppo
 * dei cinque e il dettaglio (`needRequestGroupView`); un passo il suo stato.
 */
export function needRow(need: NeedView, useCases: ReadonlyMap<string, NeedUseCaseRef>, today: string): NeedRow {
  const linked = need.useCaseIds.flatMap((id) => {
    const ref = useCases.get(id.toLowerCase());
    return ref ? [ref] : [];
  });
  const group = need.type === "requisito" ? needRequestGroupView(need.status) : null;
  return {
    id: need.id,
    type: need.type,
    kind: need.kind,
    title: need.title,
    detail: need.detail,
    owner: needOwnerText(need),
    status: group ? { label: group.label, tone: group.tone } : needStatusView(need.type, need.status),
    statusNote: group?.note ?? null,
    done: isNeedDone(need.type, need.status),
    // Un passo «Proposto» è da confermare tutto, data compresa: a schermo «(proposta)» ripeterebbe lo
    // stato accanto («Proposto · 3 dic (proposta)»). Il MCP del team tiene `needDueText` com'è.
    due: needDueText(need.type === "passo" && need.status === "proposta" ? { ...need, dueIsProposal: false } : need, today),
    availability: need.availability,
    useCases: linked.sort(byCode),
    forLabel: need.forLabel,
  };
}

function refsOf(items: readonly NeedUseCaseRef[]): Map<string, NeedUseCaseRef> {
  return new Map(items.map((item) => [item.id.toLowerCase(), { id: item.id, code: item.code, title: item.title }]));
}

// ─── La vista «Cosa serve» ───────────────────────────────────────────

/** Una riga del ritorno da confermare: «6.600 all'anno × 1,5 min × 70% ≈ 116 h · 4.043 €». */
export interface ReturnToConfirm {
  key: string;
  label: string;
  text: string;
  /** «Ipotesi», «Da misurare». */
  confidence: string;
}

// ─── Chi deve muoversi (rilascio 4) ──────────────────────────────────

/**
 * I gruppi di «Cosa serve», nell'ordine della pagina: chi deve muoversi, per organizzazione e mai per
 * persona. Il cliente (anche le cose da fare «Insieme», che lo dicono nel loro «Chi»), i fornitori,
 * Lateral Space, e in fondo i requisiti senza parte.
 */
export const NEED_GROUP_KEYS = Object.freeze(["cliente", "fornitore", "lateral_space", "nessuno"] as const);
export type NeedGroupKey = (typeof NEED_GROUP_KEYS)[number];

/** I titoli dei gruppi; quello del cliente è il suo nome (`clientGroupLabel`). */
export const NEED_GROUP_TEXT = Object.freeze({
  fornitore: "Fornitori",
  lateral_space: "Lateral Space",
  nessuno: "Da assegnare",
}) satisfies Readonly<Record<Exclude<NeedGroupKey, "cliente">, string>>;

/** Il gruppo di un requisito dalla sua parte: «Insieme» sta con il cliente, senza parte «Da assegnare». */
export function needGroupOf(side: NeedOwnerSide | null): NeedGroupKey {
  if (side === "cliente" || side === "insieme") return "cliente";
  if (side === "fornitore" || side === "lateral_space") return side;
  return "nessuno";
}

/**
 * Il nome del cliente sopra il suo gruppo: il nome che il connettore dà al workspace («TopJet e
 * Aliserio»), altrimenti il nome del workspace come lo dicono i testi del referente (`companyLabel`).
 */
export function clientGroupLabel(displayName: string | null | undefined, workspaceName: string | null | undefined): string {
  const clean = typeof displayName === "string" ? displayName.replace(/\s+/g, " ").trim() : "";
  return clean || companyLabel(workspaceName);
}

/** Il titolo di un gruppo: il nome del cliente, «Fornitori», «Lateral Space», «Da assegnare». */
export function needGroupLabel(key: NeedGroupKey, clientLabel: string): string {
  return key === "cliente" ? clientLabel : NEED_GROUP_TEXT[key];
}

/** Un gruppo di «Cosa serve»: i suoi requisiti aperti, prima quelli da verificare (`needsActionFirst`). */
export interface NeedGroup {
  key: NeedGroupKey;
  open: NeedRow[];
}

/** I testi della linea del tempo dei prossimi passi. */
export const NEED_TIMELINE_TEXT = Object.freeze({
  before: "Prima di oggi",
});

/** Un passo della linea del tempo: la riga, con la sua data per `<time dateTime>`. */
export interface NeedTimelineItem extends NeedRow {
  dueOn: IsoDate | null;
}

export interface NeedTimelineSection {
  /** `prima`, `AAAA-MM` o `senza_data`. */
  key: string;
  /** «Prima di oggi», «Novembre 2026», «Senza data». */
  label: string;
  items: NeedTimelineItem[];
}

export interface NeedTimeline {
  /** «Prima di oggi» (i passi scaduti), un mese per volta da quello di oggi, «Senza data»; solo quelle con passi. */
  sections: NeedTimelineSection[];
  /** I passi fatti, per data: chiusi di default. */
  done: NeedTimelineItem[];
}

const BEFORE_KEY = "prima";

/** «Mostra l'altro», «Mostra gli altri 36»: i passi della linea del tempo oltre i primi. */
export function moreStepsText(count: number): string {
  return count === 1 ? "Mostra l'altro" : `Mostra gli altri ${formatInteger(count)}`;
}

/**
 * La linea del tempo divisa dove si chiude: i primi `shown` passi in vista, gli altri sotto «Mostra gli
 * altri N». Una sezione spezzata ripete il suo titolo dentro la parte chiusa.
 */
export function splitTimeline(sections: readonly NeedTimelineSection[], shown: number = NEED_ROWS_SHOWN): { visible: NeedTimelineSection[]; hidden: NeedTimelineSection[]; hiddenCount: number } {
  const visible: NeedTimelineSection[] = [];
  const hidden: NeedTimelineSection[] = [];
  let left = Math.max(0, shown);
  for (const section of sections) {
    const head = section.items.slice(0, left);
    const rest = section.items.slice(left);
    left -= head.length;
    if (head.length) visible.push({ ...section, items: head });
    if (rest.length) hidden.push({ ...section, items: rest });
  }
  return { visible, hidden, hiddenCount: hidden.reduce((sum, section) => sum + section.items.length, 0) };
}

export interface NeedsBoard {
  /** I gruppi con almeno un requisito aperto, nell'ordine di `NEED_GROUP_KEYS`: ogni requisito aperto una volta. */
  groups: NeedGroup[];
  /** I requisiti a posto, nell'ordine dei gruppi: chiusi di default. */
  done: NeedRow[];
  /** I prossimi passi per data (`compareStepsByDate`) e quelli fatti. */
  timeline: NeedTimeline;
  /** Tutti i requisiti della vista, con i filtri, per gruppo di stato: la riga dei conteggi in cima. */
  counts: NeedAskCounts;
}

const MONTH_LONG = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", month: "long", year: "numeric" });
const NO_DATE_KEY = "senza_data";
export const NO_DATE_LABEL = "Senza data";

/** «Novembre 2026». */
export function monthHeading(month: string): string {
  const [year, m] = month.split("-").map(Number);
  const text = MONTH_LONG.format(new Date(Date.UTC(year, m - 1, 15, 12)));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const DECIMAL = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 });

/** «6.600 fatture all'anno × 1,5 min × 70% ≈ 116 h · 4.043 €», «535 € all'anno», «qualitativo». */
export function componentFormulaText(component: ValueComponent, params: Pick<ValueParams, "hourlyCostEur" | "includeUnmeasured">): string {
  if (component.kind === "qualitativo") return "qualitativo";
  if (component.kind === "euro") return `${formatEuro(component.eurYear)} all'anno`;
  const result = componentResult(component, params);
  const volume = `${formatInteger(component.volumeYear)}${component.unit ? ` ${component.unit}` : ""} all'anno`;
  return `${volume} × ${DECIMAL.format(component.minutesPerUnit)} min × ${DECIMAL.format(component.automatablePct)}% ≈ ${formatInteger(result.hours)} h${FIGURE_SEPARATOR}${formatEuro(result.eur)}`;
}

/** Le voci da confermare di un modello: quelle a ipotesi e quelle da misurare. */
export function returnsToConfirm(model: ValueModel | null, params: Pick<ValueParams, "hourlyCostEur" | "includeUnmeasured">): ReturnToConfirm[] {
  if (!model) return [];
  return model.components
    .filter((component) => component.confidence === "ipotesi" || component.confidence === "da_misurare")
    .map((component, index) => ({
      key: `${component.key}-${index}`,
      label: component.label,
      text: componentFormulaText(component, params),
      confidence: VALUE_CONFIDENCE_LABELS[component.confidence],
    }));
}

/**
 * Il filtro della vista «Cosa serve»: gli use case che passano i filtri della pagina (id in
 * minuscolo) e la ricerca. Un'esigenza resta se è collegata ad almeno uno di loro, oppure se la
 * ricerca è nel suo titolo. Mai «Chi», la parte o il dettaglio (art. 15.4).
 */
export interface NeedsBoardFilter {
  useCaseIds: ReadonlySet<string>;
  q: string | null;
}

function foldText(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("it-IT");
}

function passesBoardFilter(need: Pick<NeedView, "useCaseIds" | "title">, only: NeedsBoardFilter | null): boolean {
  if (!only) return true;
  if (need.useCaseIds.some((id) => only.useCaseIds.has(id.toLowerCase()))) return true;
  const q = only.q?.trim();
  return Boolean(q) && foldText(need.title).includes(foldText(q as string));
}

/**
 * La vista «Cosa serve» come una lista sola (rilascio 4): ogni requisito una volta, sotto chi deve
 * muoversi, e la linea del tempo dei prossimi passi.
 * 1. `groups`: i requisiti aperti per organizzazione, mai per persona (`needGroupOf`): il cliente
 *    (con le cose da fare «Insieme»), i fornitori, Lateral Space, quelli senza parte; in ogni gruppo
 *    prima quelli da verificare, poi l'ordine del team (`needsActionFirst`, come nella scheda e nel
 *    pannello); solo i gruppi con righe. `done`: quelli a posto, nell'ordine dei gruppi.
 * 2. `timeline`: i passi da fare per data (`compareStepsByDate`), in sezioni: «Prima di oggi» (gli
 *    scaduti, anche di questo mese), un mese per volta da quello di oggi, «Senza data»; i fatti da parte.
 * 3. `counts`: i requisiti della vista per gruppo di stato (i passi e le archiviate non contano).
 * Gli use case in realizzazione stanno nella Panoramica, sezione «In realizzazione».
 * `items` sono gli use case dei revisori del workspace: danno codici e titoli alle righe. `only`
 * restringe le esigenze a quelle degli use case che passano i filtri della pagina
 * (`NeedsBoardFilter`), conteggi compresi: con `trimestre` sono quelli di «Prossimo passo» della
 * Panoramica. Le righe nominano comunque tutti gli use case collegati. `params` (le ipotesi di
 * calcolo) non serve più alla vista: le schede del trimestre, con il ritorno da confermare, sono
 * uscite nel rilascio 4 (il ritorno resta nella scheda di ogni use case).
 */
export function buildNeedsBoard(
  needs: readonly NeedView[],
  items: readonly NeedUseCaseRef[],
  opts: { today: string; params?: Pick<ValueParams, "hourlyCostEur" | "includeUnmeasured">; only?: NeedsBoardFilter | null },
): NeedsBoard {
  const refs = refsOf(items);
  const live = needs.filter((need) => !need.archivedAt && passesBoardFilter(need, opts.only ?? null)).slice().sort(compareNeeds);
  const rowOf = new Map(live.map((need) => [need.id, needRow(need, refs, opts.today)]));
  const counts = emptyNeedAskCounts();
  const byGroup = new Map(NEED_GROUP_KEYS.map((key) => [key, { open: [] as NeedView[], done: [] as NeedView[] }]));
  const openSteps: NeedView[] = [];
  const doneSteps: NeedView[] = [];
  for (const need of live) {
    const done = rowOf.get(need.id)!.done;
    if (need.type === "requisito") {
      const group = byGroup.get(needGroupOf(need.ownerSide))!;
      (done ? group.done : group.open).push(need);
      countRequirement(counts, need.status);
    } else (done ? doneSteps : openSteps).push(need);
  }
  const groups = NEED_GROUP_KEYS.flatMap((key): NeedGroup[] => {
    const open = byGroup.get(key)!.open.sort(needsActionFirst);
    return open.length ? [{ key, open: open.map((need) => rowOf.get(need.id)!) }] : [];
  });
  const done = NEED_GROUP_KEYS.flatMap((key) => byGroup.get(key)!.done.sort(needsActionFirst).map((need) => rowOf.get(need.id)!));
  const sections: NeedTimelineSection[] = [];
  for (const need of openSteps.sort(compareStepsByDate)) {
    const key = !need.dueOn ? NO_DATE_KEY : need.dueOn < opts.today ? BEFORE_KEY : need.dueOn.slice(0, 7);
    let section = sections.at(-1);
    if (section?.key !== key) {
      section = { key, label: key === BEFORE_KEY ? NEED_TIMELINE_TEXT.before : key === NO_DATE_KEY ? NO_DATE_LABEL : monthHeading(key), items: [] };
      sections.push(section);
    }
    section.items.push({ ...rowOf.get(need.id)!, dueOn: need.dueOn });
  }
  const stepsDone = doneSteps.sort(compareStepsByDate).map((need) => ({ ...rowOf.get(need.id)!, dueOn: need.dueOn }));
  return { groups, done, timeline: { sections, done: stepsDone }, counts };
}

/** «Già a posto · 3», «Fatti · 2»: il titolo delle righe chiuse di default. */
export function needDoneSummaryText(type: NeedType, count: number): string {
  return `${type === "requisito" ? "Già a posto" : count === 1 ? "Fatto" : "Fatti"} · ${count}`;
}

/** «Per 3 use case»: nella vista «Cosa serve», gli use case di un'esigenza quando sono più di uno. */
export function needForText(count: number): string {
  return `Per ${formatInteger(count)} use case`;
}

/** «Serve anche a un altro use case», «Serve anche ad altri 22 use case»: nella scheda, gli altri use case dell'esigenza. */
export function needAlsoForText(count: number): string {
  return count === 1 ? "Serve anche a un altro use case" : `Serve anche ad altri ${formatInteger(count)} use case`;
}

/**
 * I gruppi di stato a parole, in quest'ordine e senza gli zeri: «60 da chiedere», «12 in attesa»,
 * «4 da verificare», «1 fermo» o «10 fermi» (requisiti, al maschile come «aperti»), «31 a posto».
 * La riga chiusa di un'area.
 */
export function needAskPieces(counts: NeedAskCounts): string[] {
  const pieces: string[] = [];
  if (counts.toAsk) pieces.push(`${formatInteger(counts.toAsk)} da chiedere`);
  if (counts.waiting) pieces.push(`${formatInteger(counts.waiting)} in attesa`);
  if (counts.toVerify) pieces.push(`${formatInteger(counts.toVerify)} da verificare`);
  if (counts.blocked) pieces.push(counts.blocked === 1 ? "1 fermo" : `${formatInteger(counts.blocked)} fermi`);
  if (counts.done) pieces.push(`${formatInteger(counts.done)} a posto`);
  return pieces;
}

/** La riga dei conteggi in cima a «Cosa serve»: «86 aperti», «1 aperto» o «Nessuno aperto», poi i gruppi di `needAskPieces`. */
export function needsSummaryPieces(counts: NeedAskCounts): string[] {
  const open = counts.open === 0 ? "Nessuno aperto" : counts.open === 1 ? "1 aperto" : `${formatInteger(counts.open)} aperti`;
  return [open, ...needAskPieces(counts)];
}

/**
 * Gli agenti che un'esigenza serve, dal titolo dei suoi use case («LIBRA L1 · …» → «LIBRA»): uno
 * per agente, in ordine alfabetico; nessuno senza prefisso. Un nome in testa al titolo, mai una persona.
 */
export function needAgents(useCases: readonly Pick<NeedUseCaseRef, "title">[]): string[] {
  const agents = new Set<string>();
  for (const useCase of useCases) {
    const agent = agentOfTitle(useCase.title);
    if (agent) agents.add(agent);
  }
  return [...agents].sort((a, b) => a.localeCompare(b, "it-IT"));
}

/** Niente da mostrare: nessun requisito (aperto o a posto) e nessun passo. */
export function isBoardEmpty(board: NeedsBoard): boolean {
  return !board.groups.length && !board.done.length && !board.timeline.sections.length && !board.timeline.done.length;
}

// ─── Conteggi dei requisiti ──────────────────────────────────────────

/** I requisiti per gruppo di stato; `open` tutti tranne quelli a posto. Conteggi di esigenze, mai di persone. */
export interface NeedAskCounts {
  open: number;
  toAsk: number;
  waiting: number;
  toVerify: number;
  blocked: number;
  done: number;
}

/** Il gruppo di ogni stato di un requisito; «a posto» è `isNeedDone`. */
const ASK_GROUP_OF: Readonly<Record<ItemStatus, NeedRequestGroup>> = {
  da_chiedere: "toAsk",
  mancante: "toAsk",
  parziale: "toAsk",
  chiesta: "waiting",
  in_verifica: "toVerify",
  bloccata: "blocked",
  validata: "done",
  non_applicabile: "done",
};

/**
 * Il gruppo di stato di un requisito: da chiedere (da chiedere, manca il dato, risposta parziale),
 * in attesa, da verificare, fermo, a posto. Uno stato sconosciuto vale «da chiedere», come in
 * `needStatusView`. Lo usano i conteggi e i cinque gruppi a schermo (`needRequestGroupView`).
 */
export function askGroupOf(status: NeedStatus): NeedRequestGroup {
  return (NEED_REQUIREMENT_STATUSES as readonly string[]).includes(status) ? ASK_GROUP_OF[status as ItemStatus] : "toAsk";
}

// ─── I cinque gruppi a schermo ───────────────────────────────────────

/** Uno dei cinque gruppi di stato dei requisiti, con la chiave dei conteggi. */
export type NeedRequestGroup = Exclude<keyof NeedAskCounts, "open">;

/**
 * I testi dei cinque gruppi e il dettaglio dello stato dentro il suo gruppo (rilascio 3). «Ferma»
 * per un requisito «bloccata»: lo decide chi legge la pagina (decisione 1 del rilascio 3); il
 * modulo di modifica, il MCP del team e l'export tengono «Bloccata».
 */
export const NEED_REQUEST_GROUP_TEXT = Object.freeze({
  groups: Object.freeze({
    toAsk: "Da chiedere",
    waiting: "In attesa",
    toVerify: "Da verificare",
    blocked: "Ferma",
    done: "A posto",
  }) satisfies Readonly<Record<NeedRequestGroup, string>>,
  notes: Object.freeze({
    mancante: "manca il dato",
    parziale: "risposta parziale",
    non_applicabile: "non si applica",
  }),
});

const REQUEST_GROUP_TONE: Readonly<Record<NeedRequestGroup, SemaforoColor>> = Object.freeze({
  toAsk: "grigio",
  waiting: "blu",
  toVerify: "giallo",
  blocked: "lucchetto",
  done: "verde",
});

export interface NeedRequestGroupView {
  group: NeedRequestGroup;
  /** «Da chiedere», «In attesa», «Da verificare», «Ferma», «A posto». */
  label: string;
  tone: SemaforoColor;
  /** Il dettaglio dello stato dentro il gruppo: «manca il dato», «risposta parziale», «non si applica»; null senza. */
  note: string | null;
}

/**
 * Lo stato di un requisito nei cinque gruppi che si leggono a schermo (gli otto stati restano nel
 * modulo di modifica, nel MCP del team e nell'export): da chiedere (anche «manca il dato» e
 * «risposta parziale»), in attesa, da verificare, ferma, a posto (anche «non si applica»). Uno
 * stato sconosciuto vale «da chiedere», come in `needStatusView`.
 */
export function needRequestGroupView(status: NeedStatus): NeedRequestGroupView {
  const group = askGroupOf(status);
  const notes: Readonly<Record<string, string>> = NEED_REQUEST_GROUP_TEXT.notes;
  return {
    group,
    label: NEED_REQUEST_GROUP_TEXT.groups[group],
    tone: REQUEST_GROUP_TONE[group],
    note: Object.prototype.hasOwnProperty.call(notes, status) ? notes[status] : null,
  };
}

export function emptyNeedAskCounts(): NeedAskCounts {
  return { open: 0, toAsk: 0, waiting: 0, toVerify: 0, blocked: 0, done: 0 };
}

/** Un requisito nel suo gruppo. Uno stato sconosciuto vale «da chiedere», come in `needStatusView`. */
function countRequirement(counts: NeedAskCounts, status: NeedStatus): void {
  const group = askGroupOf(status);
  counts[group] += 1;
  if (group !== "done") counts.open += 1;
}

/**
 * I requisiti non archiviati collegati ad almeno uno degli use case di `useCaseIds` (id in
 * minuscolo), per gruppo di stato. Ognuno una volta sola, anche se serve a più use case. Contano
 * tutti, da qualunque parte stia chi se ne occupa: la parte e «Chi» non sono un criterio.
 */
export function needAskCountsOf(
  needs: readonly Pick<NeedView, "id" | "type" | "status" | "archivedAt" | "useCaseIds">[],
  useCaseIds: ReadonlySet<string>,
): NeedAskCounts {
  const counts = emptyNeedAskCounts();
  const seen = new Set<string>();
  for (const need of needs) {
    if (need.type !== "requisito" || need.archivedAt) continue;
    const id = need.id.toLowerCase();
    if (seen.has(id) || !need.useCaseIds.some((linked) => useCaseIds.has(linked.toLowerCase()))) continue;
    seen.add(id);
    countRequirement(counts, need.status);
  }
  return counts;
}

// ─── Pannello e scheda ───────────────────────────────────────────────

/** Al massimo tre esigenze aperte nel pannello laterale. */
export const PANEL_NEEDS_MAX = 3;

export interface PanelNeeds {
  rows: NeedRow[];
  /** Le altre aperte, oltre le tre. */
  more: number;
  /** (Rilascio 6, B.1.5) Il conteggio al posto delle voci: le aperte, i requisiti per gruppo e i passi aperti. */
  summary: NeedsCountSummary;
}

/** (Rilascio 6, B.1.5) «Cosa serve · 9»: quante esigenze sono aperte e come stanno, mai per persona. */
export interface NeedsCountSummary {
  /** Le esigenze aperte: requisiti non a posto più passi non fatti. */
  open: number;
  /** I requisiti per gruppo di stato (anche quelli a posto, per la barra). */
  counts: NeedAskCounts;
  /** I passi non ancora fatti. */
  steps: number;
}

/** (Rilascio 6) Le parti della riga sotto «Cosa serve · 9»: i gruppi dei requisiti aperti, poi i passi. */
export function needsCountPieces(summary: NeedsCountSummary): string[] {
  const pieces = needAskPieces({ ...summary.counts, done: 0 });
  if (summary.steps) pieces.push(summary.steps === 1 ? "1 passo" : `${formatInteger(summary.steps)} passi`);
  return pieces;
}

/** (Rilascio 6) La barra sottile di «Cosa serve»: un tratto per gruppo, nell'ordine dei conteggi, senza gli zeri. */
export function needsCountBar(summary: NeedsCountSummary): Array<{ group: NeedRequestGroup | "steps"; count: number; tone: SemaforoColor }> {
  const c = summary.counts;
  const parts: Array<{ group: NeedRequestGroup | "steps"; count: number; tone: SemaforoColor }> = [
    { group: "toVerify", count: c.toVerify, tone: REQUEST_GROUP_TONE.toVerify },
    { group: "toAsk", count: c.toAsk, tone: REQUEST_GROUP_TONE.toAsk },
    { group: "waiting", count: c.waiting, tone: REQUEST_GROUP_TONE.waiting },
    { group: "blocked", count: c.blocked, tone: REQUEST_GROUP_TONE.blocked },
    { group: "steps", count: summary.steps, tone: "grigio" },
    { group: "done", count: c.done, tone: REQUEST_GROUP_TONE.done },
  ];
  return parts.filter((part) => part.count > 0);
}

/** (Rilascio 6) Il conteggio di «Cosa serve» di uno use case: requisiti per gruppo e passi aperti; null senza esigenze. */
export function needsCountSummaryOf(needs: readonly NeedView[], useCaseId: string): NeedsCountSummary | null {
  const linked = needs.filter((need) => !need.archivedAt && linkedTo(need, useCaseId));
  if (!linked.length) return null;
  const counts = needAskCountsOf(linked, new Set([useCaseId.toLowerCase()]));
  const steps = linked.filter((need) => need.type !== "requisito" && !isNeedDone(need.type, need.status)).length;
  return { open: counts.open + steps, counts, steps };
}

function linkedTo(need: Pick<NeedView, "useCaseIds">, useCaseId: string): boolean {
  const id = useCaseId.toLowerCase();
  return need.useCaseIds.some((linked) => linked.toLowerCase() === id);
}

/**
 * Il blocco «Cosa serve» del pannello: le esigenze aperte dello use case, al massimo tre, nell'ordine
 * della scheda (rilascio 3), così le prime tre del pannello sono le prime tre righe di «Cosa serve»:
 * prima i requisiti, quelli da verificare in testa e poi l'ordine del team (`needsActionFirst`),
 * poi i prossimi passi dalla scadenza più vicina (`compareStepsByDate`, rilascio 4). null senza.
 */
export function panelNeeds(needs: readonly NeedView[], item: NeedUseCaseRef, today: string): PanelNeeds | null {
  const live = needs.filter((need) => !need.archivedAt && linkedTo(need, item.id) && !isNeedDone(need.type, need.status));
  const open = [
    ...live.filter((need) => need.type === "requisito").sort(needsActionFirst),
    ...live.filter((need) => need.type !== "requisito").sort(compareStepsByDate),
  ];
  if (!open.length) return null;
  const refs = refsOf([item]);
  return {
    rows: open.slice(0, PANEL_NEEDS_MAX).map((need) => needRow(need, refs, today)),
    more: Math.max(0, open.length - PANEL_NEEDS_MAX),
    summary: needsCountSummaryOf(needs, item.id)!,
  };
}

export interface UseCaseNeedLists {
  requirements: NeedView[];
  steps: NeedView[];
  /** Le esigenze del workspace non ancora collegate a questo use case («Collega»). */
  linkable: NeedView[];
}

/** Il capitolo «Cosa serve» della scheda: le esigenze collegate, per tipo, e quelle collegabili. */
export function needListsOfUseCase(needs: readonly NeedView[], useCaseId: string): UseCaseNeedLists {
  const live = needs.filter((need) => !need.archivedAt).slice().sort(compareNeeds);
  const mine = live.filter((need) => linkedTo(need, useCaseId));
  return {
    requirements: mine.filter((need) => need.type === "requisito"),
    steps: mine.filter((need) => need.type === "passo"),
    linkable: live.filter((need) => !linkedTo(need, useCaseId)),
  };
}
