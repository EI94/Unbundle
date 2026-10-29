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
 * - **Viste** (`buildNeedsBoard`, `stepsHorizon`, `panelNeeds`, `needListsOfUseCase`): i blocchi
 *   della vista «Cosa serve», il blocco del pannello e il capitolo della scheda, da un elenco già
 *   letto per i revisori. Gli agenti di una riga vengono dal titolo dei suoi use case
 *   (`needAgents`). Nessun conteggio e nessun filtro per persona: «Chi» è un testo della riga, mai
 *   un criterio.
 * - **Conteggi** (`NeedAskCounts`): i requisiti per gruppo di stato, come «Raccolta informazioni»
 *   della scheda: da chiedere (da chiedere, manca il dato, risposta parziale), in attesa, da
 *   verificare, bloccati, a posto. Sempre di esigenze, mai di persone, mai per «Chi» o per parte.
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
import { STATUS_GROUP_OF } from "../uc/views/status-groups.ts";
import type { ItemStatus, SemaforoColor } from "../uc/vocab.ts";
import { agentOfTitle } from "./agents.ts";
import { FIGURE_SEPARATOR, formatDayInYear, formatEuro, formatInteger } from "./format.ts";
import { isIsoDate, quarterOfDate } from "./quarter.ts";
import type { IsoDate, Phase, QuarterCode } from "./types.ts";
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

/** Le aree delle tabelle di «Cosa serve», nell'ordine della pagina, con i tipi che raccolgono. */
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

/** Le colonne di uno use case che servono a «Questo trimestre». */
export interface NeedBoardItem extends NeedUseCaseRef {
  phase: Phase;
  targetQuarter: QuarterCode | null;
  valueModel: ValueModel | null;
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
  status: { label: string; tone: SemaforoColor };
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

/** La riga di un'esigenza, con gli use case che chi guarda conosce. */
export function needRow(need: NeedView, useCases: ReadonlyMap<string, NeedUseCaseRef>, today: string): NeedRow {
  const linked = need.useCaseIds.flatMap((id) => {
    const ref = useCases.get(id.toLowerCase());
    return ref ? [ref] : [];
  });
  return {
    id: need.id,
    type: need.type,
    kind: need.kind,
    title: need.title,
    detail: need.detail,
    owner: needOwnerText(need),
    status: needStatusView(need.type, need.status),
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

export interface NeedAreaTable {
  key: NeedAreaKey;
  label: string;
  /** Da fare, nell'ordine di `compareNeeds`. */
  open: NeedRow[];
  /** Già a posto: chiuse di default. */
  done: NeedRow[];
  /** I requisiti dell'area per gruppo di stato, per la sua riga chiusa. */
  counts: NeedAskCounts;
}

export interface NeedStepMonth {
  /** `AAAA-MM`, oppure `senza_data`. */
  key: string;
  label: string;
  rows: NeedRow[];
}

/** Una riga del ritorno da confermare: «6.600 all'anno × 1,5 min × 70% ≈ 116 h · 4.043 €». */
export interface ReturnToConfirm {
  key: string;
  label: string;
  text: string;
  /** «Ipotesi», «Da misurare». */
  confidence: string;
}

/** «Cosa vi chiediamo questo trimestre»: una scheda per use case approvato per il trimestre, anche se già partito. */
export interface QuarterAsk extends NeedUseCaseRef {
  /** Chi conferma i numeri (`value_model.confirmBy`). */
  confirmBy: string | null;
  returns: ReturnToConfirm[];
  /** Requisiti aperti che servono subito (o senza «quando»). */
  now: NeedRow[];
  /** Requisiti aperti che servono dopo la scheda A.8. */
  afterA8: NeedRow[];
  /** Decisioni aperte. */
  toDecide: NeedRow[];
}

export interface NeedsBoard {
  /** Le aree con almeno una riga, nell'ordine di `NEED_AREAS`. */
  areas: NeedAreaTable[];
  /** I prossimi passi da fare, per mese di scadenza; quelli senza data in fondo. */
  steps: NeedStepMonth[];
  /** I passi fatti: chiusi di default. */
  stepsDone: NeedRow[];
  quarter: QuarterAsk[];
  /** Tutti i requisiti della vista, con i filtri, per gruppo di stato: la riga sotto «Requisiti». */
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

/** I mesi di «Prossimi passi»: aperti quelli a portata, poi «Più avanti» e «Senza data», chiusi. */
export interface StepsHorizon {
  soon: NeedStepMonth[];
  later: NeedStepMonth[];
  undated: NeedStepMonth | null;
}

/**
 * I «Prossimi passi» a portata: aperti i mesi fino a quello di oggi (gli scaduti compresi); gli
 * altri, dal mese prossimo, sotto «Più avanti» e quelli senza data sotto «Senza data», chiusi. Senza
 * passi fino a questo mese resta aperto il primo mese che c'è; con soli passi senza data si leggono
 * aperti quelli. `steps` nell'ordine di `buildNeedsBoard`: dal mese più vicino, quelli senza data in
 * fondo.
 */
export function stepsHorizon(steps: readonly NeedStepMonth[], today: string): StepsHorizon {
  const dated = steps.filter((month) => month.key !== NO_DATE_KEY);
  const undated = steps.find((month) => month.key === NO_DATE_KEY) ?? null;
  if (!dated.length) return { soon: undated ? [undated] : [], later: [], undated: null };
  // Il mese di oggi, `AAAA-MM`: «2026-10-29» → «2026-10».
  const limit = today.slice(0, 7);
  const near = dated.filter((month) => month.key <= limit);
  const soon = near.length ? near : [dated[0]];
  return { soon, later: dated.filter((month) => !soon.includes(month)), undated };
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
 * I tre blocchi della vista «Cosa serve»:
 * 1. i requisiti, una tabella per area, con quelli già a posto da parte, con i conteggi per gruppo
 *    di stato (`counts`, di tutta la vista e di ogni area; i passi e le archiviate non contano);
 * 2. i prossimi passi per mese di scadenza, con quelli fatti da parte;
 * 3. una scheda per ogni use case approvato per questo trimestre (anche se è già in realizzazione):
 *    chi conferma, il ritorno da
 *    confermare (le voci a ipotesi e da misurare), i requisiti aperti divisi in «Ci serve subito»,
 *    «Dopo la scheda A.8» e «Da decidere» (le decisioni, qualunque sia il «quando»).
 * Gli use case in realizzazione stanno nella Panoramica, sezione «In realizzazione».
 * `items` sono gli use case dei revisori del workspace: danno codici e titoli alle righe. `only`
 * restringe le esigenze a quelle degli use case che passano i filtri della pagina
 * (`NeedsBoardFilter`), conteggi compresi: con `trimestre` sono quelli di «Prossimo passo» della
 * Panoramica. Le righe nominano comunque tutti gli use case collegati.
 */
export function buildNeedsBoard(
  needs: readonly NeedView[],
  items: readonly NeedBoardItem[],
  opts: { today: string; params: Pick<ValueParams, "hourlyCostEur" | "includeUnmeasured">; only?: NeedsBoardFilter | null },
): NeedsBoard {
  const refs = refsOf(items);
  const live = needs.filter((need) => !need.archivedAt && passesBoardFilter(need, opts.only ?? null)).slice().sort(compareNeeds);
  const rows = live.map((need) => ({ need, row: needRow(need, refs, opts.today) }));

  const areas: NeedAreaTable[] = NEED_AREAS.map((area) => ({ key: area.key, label: area.label, open: [], done: [], counts: emptyNeedAskCounts() }));
  const areaOf = new Map(areas.map((area) => [area.key, area]));
  const counts = emptyNeedAskCounts();
  const months = new Map<string, NeedRow[]>();
  const stepsDone: NeedRow[] = [];
  for (const { need, row } of rows) {
    if (need.type === "requisito") {
      const table = areaOf.get(needAreaOf(need.kind))!;
      (row.done ? table.done : table.open).push(row);
      countRequirement(table.counts, need.status);
      countRequirement(counts, need.status);
      continue;
    }
    if (row.done) {
      stepsDone.push(row);
      continue;
    }
    const key = need.dueOn ? need.dueOn.slice(0, 7) : NO_DATE_KEY;
    months.set(key, [...(months.get(key) ?? []), row]);
  }
  const steps = [...months.entries()]
    .sort(([a], [b]) => (a === NO_DATE_KEY ? 1 : b === NO_DATE_KEY ? -1 : a.localeCompare(b)))
    .map(([key, monthRows]) => ({ key, label: key === NO_DATE_KEY ? NO_DATE_LABEL : monthHeading(key), rows: monthRows }));

  const current = quarterOfDate(opts.today);
  // Approvato per questo trimestre, anche se nel frattempo è già partito (in realizzazione con il
  // trimestre di oggi): il ritorno da confermare e le richieste aperte servono ancora.
  const quarter = items
    .filter((item) => (item.phase === "approvato" || item.phase === "in_realizzazione") && item.targetQuarter === current)
    .filter((item) => !opts.only || opts.only.useCaseIds.has(item.id.toLowerCase()))
    .slice()
    .sort(byCode)
    .map((item): QuarterAsk => {
      const id = item.id.toLowerCase();
      const open = rows.filter(({ need, row }) => need.type === "requisito" && !row.done && need.useCaseIds.some((linked) => linked.toLowerCase() === id));
      const toDecide = open.filter(({ need }) => need.kind === "decisione").map(({ row }) => row);
      const afterA8 = open.filter(({ need }) => need.kind !== "decisione" && need.availability === "dopo_a8").map(({ row }) => row);
      const now = open.filter(({ need }) => need.kind !== "decisione" && need.availability !== "dopo_a8").map(({ row }) => row);
      return {
        id: item.id,
        code: item.code,
        title: item.title,
        confirmBy: item.valueModel?.confirmBy ?? null,
        returns: returnsToConfirm(item.valueModel, opts.params),
        now,
        afterA8,
        toDecide,
      };
    });

  return { areas: areas.filter((area) => area.open.length || area.done.length), steps, stepsDone, quarter, counts };
}

/** «Già a posto · 3», «Fatti · 2»: il titolo delle righe chiuse di default. */
export function needDoneSummaryText(type: NeedType, count: number): string {
  return `${type === "requisito" ? "Già a posto" : count === 1 ? "Fatto" : "Fatti"} · ${count}`;
}

/** «Cosa vi chiediamo questo trimestre · 17 use case»: il titolo, chiuso di default, delle schede del trimestre. */
export function quarterAskSummaryText(count: number): string {
  return `Cosa vi chiediamo questo trimestre · ${formatInteger(count)} use case`;
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
 * «4 da verificare», «1 bloccato» o «10 bloccati», «31 a posto». La riga chiusa di un'area.
 */
export function needAskPieces(counts: NeedAskCounts): string[] {
  const pieces: string[] = [];
  if (counts.toAsk) pieces.push(`${formatInteger(counts.toAsk)} da chiedere`);
  if (counts.waiting) pieces.push(`${formatInteger(counts.waiting)} in attesa`);
  if (counts.toVerify) pieces.push(`${formatInteger(counts.toVerify)} da verificare`);
  if (counts.blocked) pieces.push(counts.blocked === 1 ? "1 bloccato" : `${formatInteger(counts.blocked)} bloccati`);
  if (counts.done) pieces.push(`${formatInteger(counts.done)} a posto`);
  return pieces;
}

/** La riga sotto «Requisiti»: «86 aperti», «1 aperto» o «Nessuno aperto», poi i gruppi di `needAskPieces`. */
export function needsSummaryPieces(counts: NeedAskCounts): string[] {
  const open = counts.open === 0 ? "Nessuno aperto" : counts.open === 1 ? "1 aperto" : `${formatInteger(counts.open)} aperti`;
  return [open, ...needAskPieces(counts)];
}

/** «1 passo», «6 passi». */
function stepsCountText(count: number): string {
  return count === 1 ? "1 passo" : `${formatInteger(count)} passi`;
}

/** «Più avanti · 6 passi»: il titolo, chiuso, dei mesi dopo il prossimo. */
export function needStepsLaterText(count: number): string {
  return `Più avanti${FIGURE_SEPARATOR}${stepsCountText(count)}`;
}

/** «Senza data · 4 passi»: il titolo, chiuso, dei passi senza scadenza. */
export function needStepsUndatedText(count: number): string {
  return `${NO_DATE_LABEL}${FIGURE_SEPARATOR}${stepsCountText(count)}`;
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

export function isBoardEmpty(board: NeedsBoard): boolean {
  return !board.areas.length && !board.steps.length && !board.stepsDone.length && !board.quarter.length;
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
const ASK_GROUP_OF: Readonly<Record<ItemStatus, Exclude<keyof NeedAskCounts, "open">>> = {
  da_chiedere: "toAsk",
  mancante: "toAsk",
  parziale: "toAsk",
  chiesta: "waiting",
  in_verifica: "toVerify",
  bloccata: "blocked",
  validata: "done",
  non_applicabile: "done",
};

export function emptyNeedAskCounts(): NeedAskCounts {
  return { open: 0, toAsk: 0, waiting: 0, toVerify: 0, blocked: 0, done: 0 };
}

/** Un requisito nel suo gruppo. Uno stato sconosciuto vale «da chiedere», come in `needStatusView`. */
function countRequirement(counts: NeedAskCounts, status: NeedStatus): void {
  const group = (NEED_REQUIREMENT_STATUSES as readonly string[]).includes(status) ? ASK_GROUP_OF[status as ItemStatus] : "toAsk";
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
}

function linkedTo(need: Pick<NeedView, "useCaseIds">, useCaseId: string): boolean {
  const id = useCaseId.toLowerCase();
  return need.useCaseIds.some((linked) => linked.toLowerCase() === id);
}

/** Le aperte, prima quelle con la scadenza più vicina. */
function compareOpen(a: NeedView, b: NeedView): number {
  if (a.dueOn !== b.dueOn) {
    if (!a.dueOn) return 1;
    if (!b.dueOn) return -1;
    return a.dueOn.localeCompare(b.dueOn);
  }
  return compareNeeds(a, b);
}

/** Il blocco «Cosa serve» del pannello: le esigenze aperte dello use case, al massimo tre. null senza. */
export function panelNeeds(needs: readonly NeedView[], item: NeedUseCaseRef, today: string): PanelNeeds | null {
  const open = needs.filter((need) => !need.archivedAt && linkedTo(need, item.id) && !isNeedDone(need.type, need.status)).sort(compareOpen);
  if (!open.length) return null;
  const refs = refsOf([item]);
  return { rows: open.slice(0, PANEL_NEEDS_MAX).map((need) => needRow(need, refs, today)), more: Math.max(0, open.length - PANEL_NEEDS_MAX) };
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
