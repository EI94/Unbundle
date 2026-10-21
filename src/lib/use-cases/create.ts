/**
 * Nuovo use case e Activity mapping: le regole pure (docs/use-case/DESIGN.md §5, §8.1, §8.5,
 * §14.3; PIANO-LAVORI H3c).
 *
 * - **Pannello rapido** (§5.2, solo Lateral Space con ruolo da revisore): tre campi, origine
 *   predefinita «AI Transformation», tipo «Da costruire». Si salva con `source = manual`,
 *   senza proponente, senza valutazione dell'AI e senza notifiche (§1.2 punti 6 e 13).
 * - **Modulo completo** (§5.3): il modulo di oggi con le etichette di §6.2 per tipo. Origine e
 *   «Valutazione iniziale» solo per i revisori; il costo arriva dal campo di §5.4 (importo,
 *   oppure una fascia del workspace). La stessa lettura (`parseUseCaseForm`) vale nel browser,
 *   prima di inviare, e nell'action: i messaggi coincidono.
 * - **Activity mapping** (§8.5): le proposte del generatore diventano bozze «AI
 *   Transformation», nascoste ai colleghi, in «Da decidere». Mai approvate da sole.
 *
 * Le scritture le fa `service.ts`; qui solo testi, letture dei campi e regole. Nessun dato
 * su chi propone: lo aggiunge l'action del modulo completo, fuori dall'area (art. 15.4).
 *
 * Modulo puro: import relativi `.ts` (e `zod` attraverso `inputs.ts`), nessun `@/`, nessun
 * `server-only`. Lo importano anche i componenti client.
 */
import { readCostFormValue } from "../../components/use-cases/cost-input-state.ts";
import {
  QUICK_CREATE_LIMITS,
  TEXT_LIMITS,
  TITLE_MIN_LENGTH,
  VALUE_AMOUNT_ERROR,
  VALUE_EUR_YEAR_MAX,
  parseEuroAmount,
  tooLongMessage,
  validateQuickCreate,
  type FieldErrors,
  type QuickCreateInput,
} from "./inputs.ts";
import { KIND_LABEL, ORIGIN_LABEL, WHAT_FIELD_LABEL } from "./labels.ts";
import type { NewUseCaseItem } from "./service.ts";
import { KINDS, ORIGINS, type NewUseCaseInput, type Origin, type UseCaseKind } from "./types.ts";

// ─── Testi (§5.2, §5.3, §8.5, §14.3) ─────────────────────────────────

/** Pannello rapido (§5.2). */
export const QUICK_CREATE_TEXT = Object.freeze({
  heading: "Nuovo use case",
  titleLabel: "Titolo",
  problemLabel: "Problema in una riga",
  aiLabLabel: "AI Lab",
  aiLabPlaceholder: "es. AI Lab Finanza · 12 ott",
  originLabel: "Origine",
  kindLabel: "Tipo",
  /** Accanto al chip: «Cambia» per lo screen reader. */
  change: "Cambia",
  hint: "I dettagli si completano dopo.",
  save: "Salva",
  saveAndAdd: "Salva e aggiungi un altro",
  fullForm: "Usa il modulo completo",
  close: "Chiudi",
  /** Errore di salvataggio: i campi restano compilati. */
  error: "Non riusciamo a salvare. Riprova.",
});

/** Toast dopo un salvataggio del pannello rapido: «XX-0031 salvato.». */
export function savedToast(code: string | null | undefined): string {
  return code ? `${code} salvato.` : "Use case salvato.";
}

/** Modulo completo (§5.3). */
export const FORM_TEXT = Object.freeze({
  heading: "Nuovo use case",
  back: "Use case",
  kindQuestion: "Che cosa proponi?",
  kindOptions: Object.freeze({
    da_costruire: "Un'idea da costruire con l'AI",
    da_diffondere: "Una cosa che fai già con l'AI e che altri possono copiare",
  } satisfies Record<UseCaseKind, string>),
  originBlock: "Origine",
  valuationBlock: "Valutazione iniziale (facoltativa)",
  valueLabel: "Valore all'anno",
  valuePlaceholder: "es. 60000",
  submit: "Invia lo use case",
  submitting: "Invio…",
  required: "Campo richiesto.",
  /** Accanto all'etichetta di un campo che si può lasciare vuoto (H4p). */
  optional: "facoltativo",
  /** Sopra i campi: quali sono obbligatori (H4p). */
  requiredNote: "I campi sono obbligatori, tranne quelli segnati «facoltativo».",
  tooShort: `Scrivi almeno ${TITLE_MIN_LENGTH} caratteri.`,
  titleTooShort: `Il titolo deve avere almeno ${TITLE_MIN_LENGTH} caratteri.`,
  chooseKind: "Scegli che cosa proponi.",
  chooseOrigin: "Scegli AI Adoption o AI Transformation.",
  fixFields: "Completa i campi evidenziati prima di inviare.",
  /** Errore di salvataggio: i campi restano compilati. */
  error: "Non riusciamo a salvare. Riprova.",
});

/** Sottotitolo del modulo, il testo esatto di §5.3: il nome del team da solo, senza articolo e senza «team» (§14.2). */
export function formSubtitle(teamName: string): string {
  return `Racconta l'idea in modo semplice. La valuta ${teamName}: qui vedi come va.`;
}

/** Activity mapping (§8.5, §14.3). */
export const ACTIVITY_MAPPING_TEXT = Object.freeze({
  menuItem: "Proponi da Activity mapping",
  classifyFirst: "Prima classifica le attività in Activity mapping.",
  dialogTitle: "Proporre use case dalle attività mappate?",
  dialogBody:
    "Claude legge le attività classificate e propone nuovi use case. Arrivano in «Da decidere», nascosti ai colleghi. Nessuno viene approvato da solo.",
  confirm: "Proponi",
  cancel: "Annulla",
  nothingProposed: "Claude non ha proposto nuovi use case.",
  error: "Non riusciamo a proporre use case ora. Riprova.",
});

/** Toast dopo la proposta: «Proposti 6 use case: li trovi in «Da decidere».». */
export function proposedToast(count: number): string {
  if (count <= 0) return ACTIVITY_MAPPING_TEXT.nothingProposed;
  return count === 1
    ? "Proposto 1 use case: lo trovi in «Da decidere»."
    : `Proposti ${count} use case: li trovi in «Da decidere».`;
}

/** Dove si classificano le attività (link del messaggio «Prima classifica…»). */
export function activityMappingPath(workspaceId: string): string {
  return `/dashboard/${workspaceId}/mapping`;
}

/** Dove porta il modulo completo dopo l'invio (§2.5, §5.5): la ricevuta in cima alla pagina. */
export function receiptPath(workspaceId: string, useCaseId: string): string {
  return `/dashboard/${workspaceId}/use-cases?vista=roadmap&thanks=1&created=${encodeURIComponent(useCaseId)}`;
}

/** Il modulo completo. */
export function fullFormPath(workspaceId: string): string {
  return `/dashboard/${workspaceId}/use-cases/nuovo`;
}

// ─── Origine predefinita per ruolo (§5.2, §5.3, §8) ──────────────────

/** Da dove si crea: il pannello rapido (Lateral Space) o il modulo completo (tutti gli altri). */
export type CreateEntry = "pannello_rapido" | "modulo_completo";

/**
 * L'origine che il campo propone. Pannello rapido: «AI Transformation». Modulo completo: «AI
 * Transformation» per una persona di Lateral Space con ruolo da revisore, «AI Adoption» per
 * tutti gli altri (AI Builder del cliente, contributori, Lateral Space senza ruolo da
 * revisore). È la stessa regola di `defaultOrigin` del servizio, per `manual` e
 * `web_proposed`: la prova d'integrazione le confronta.
 */
export function defaultOriginFor(entry: CreateEntry, viewer: { isLateralSpace: boolean; isReviewer: boolean }): Origin {
  if (entry === "pannello_rapido") return "transformation";
  return viewer.isLateralSpace && viewer.isReviewer ? "transformation" : "adoption";
}

/** Le due scelte dell'origine, con l'etichetta lunga (§3.2). */
export const ORIGIN_OPTIONS: readonly { value: Origin; label: string; chip: string }[] = Object.freeze(
  ORIGINS.map((value) => ({ value, label: ORIGIN_LABEL[value].long, chip: ORIGIN_LABEL[value].chip })),
);

/** Le due scelte del tipo (§3.3). */
export const KIND_OPTIONS: readonly { value: UseCaseKind; label: string }[] = Object.freeze(
  KINDS.map((value) => ({ value, label: KIND_LABEL[value].label })),
);

// ─── Pannello rapido (§5.2) ──────────────────────────────────────────

/** Una scheda del pannello rapido, come la riceve il servizio. Il proponente resta vuoto. */
export type QuickCreateItem = Pick<NewUseCaseInput, "source" | "kind" | "origin" | "title" | "description" | "aiLab">;

/** I tre campi e i due chip diventano una scheda `manual`: «Problema in una riga» va in `description`. */
export function quickCreateItem(input: QuickCreateInput): QuickCreateItem {
  return {
    source: "manual",
    kind: input.kind,
    origin: input.origin,
    title: input.title,
    description: input.problem,
    aiLab: input.aiLab ?? null,
  };
}

/** I campi del pannello: il servizio chiama `description` il «Problema in una riga». */
const QUICK_FIELD_OF: Readonly<Record<string, string>> = { description: "problem" };

/**
 * Gli errori per campo del pannello, con i nomi dei suoi campi (`title`, `problem`, `aiLab`),
 * sia dalla validazione (`validateQuickCreate`) sia dal servizio.
 */
export function quickFieldErrors(fieldErrors: FieldErrors | null | undefined): FieldErrors {
  const out: FieldErrors = {};
  for (const [key, message] of Object.entries(fieldErrors ?? {})) out[QUICK_FIELD_OF[key] ?? key] ??= message;
  return out;
}

/** La validazione del pannello, con i nomi dei suoi campi. */
export function readQuickCreate(input: unknown): { ok: true; value: QuickCreateInput } | { ok: false; fieldErrors: FieldErrors } {
  const checked = validateQuickCreate(input);
  return checked.ok ? checked : { ok: false, fieldErrors: quickFieldErrors(checked.fieldErrors) };
}

/** I limiti dei tre campi, per gli attributi `maxLength` del pannello. */
export const QUICK_CREATE_MAX = Object.freeze({
  title: TEXT_LIMITS.title,
  problem: QUICK_CREATE_LIMITS.problem.max,
  aiLab: QUICK_CREATE_LIMITS.aiLab.max,
});

// ─── Modulo completo (§5.3, §6.2) ────────────────────────────────────

/** I testi del modulo, nell'ordine di oggi (`submit-form.tsx`), con «Urgenza» in fondo. */
export const FORM_TEXT_FIELDS = [
  "title",
  "description",
  "flowDescription",
  "businessCase",
  "humanInTheLoop",
  "guardrails",
  "dataRequirements",
  "sustainabilityImpact",
  "timeline",
] as const;
export type FormTextField = (typeof FORM_TEXT_FIELDS)[number];

/**
 * «Urgenza» (colonna `timeline`): il campo di oggi per le idee da costruire, facoltativo, una
 * riga. Nella scheda sta in «Dettagli» (§6.2), non in «Cosa è»: per questo non è in
 * `WHAT_FIELD_LABEL`.
 */
export const URGENCY_LABEL = "Urgenza";
/** La colonna `timeline` è un varchar(255). */
const TIMELINE_MAX = 255;

/** I testi su una riga sola; gli altri vanno a capo. */
const SINGLE_LINE: ReadonlySet<FormTextField> = new Set(["title", "timeline"]);

/** Obbligatori come oggi; «Limiti» e «Urgenza» restano facoltativi, «Impatto ambientale e sociale» solo con ESG. */
const REQUIRED_TEXT: ReadonlySet<FormTextField> = new Set([
  "title",
  "description",
  "flowDescription",
  "businessCase",
  "humanInTheLoop",
  "dataRequirements",
  "sustainabilityImpact",
]);

const PLACEHOLDER: Readonly<Record<FormTextField, Readonly<Record<UseCaseKind, string>>>> = {
  title: { da_costruire: "Dai un nome chiaro allo use case", da_diffondere: "Dai un nome chiaro alla best practice" },
  description: {
    da_costruire: "Contesto, difficoltà, perché è importante.",
    da_diffondere: "Come funzionava prima, e cosa non andava.",
  },
  flowDescription: {
    da_costruire: "Passi principali, strumenti, dati, risultato.",
    da_diffondere: "Come funziona adesso con l'AI: passi, strumenti, risultato.",
  },
  businessCase: {
    da_costruire: "Tempo risparmiato, qualità, rischio, esperienza di chi lo usa. Evita stime in euro se non hai numeri verificabili.",
    da_diffondere: "Il beneficio che hai visto: tempo, qualità, rischio.",
  },
  humanInTheLoop: {
    da_costruire: "Chi fa cosa? Chi controlla? Chi approva?",
    da_diffondere: "Chi la usa e chi controlla il risultato?",
  },
  guardrails: {
    da_costruire: "Vincoli, privacy, tono di voce, quando passare a una persona.",
    da_diffondere: "",
  },
  dataRequirements: {
    da_costruire: "Che dati servono? Dove stanno? Sono disponibili?",
    da_diffondere: "Cosa serve a un collega per rifarla: strumenti, dati, accessi.",
  },
  sustainabilityImpact: {
    da_costruire: "Racconta l'impatto ambientale e sociale del nuovo processo.",
    da_diffondere: "Racconta l'impatto ambientale e sociale del nuovo processo.",
  },
  timeline: { da_costruire: "es. entro 3 mesi, 6-12 mesi", da_diffondere: "" },
};

/** L'etichetta di un campo per tipo; `null`: il campo non c'è per quel tipo. */
function fieldLabel(name: FormTextField, kind: UseCaseKind): string | null {
  if (name === "timeline") return kind === "da_costruire" ? URGENCY_LABEL : null;
  return WHAT_FIELD_LABEL[name][kind];
}

function fieldMax(name: FormTextField): number {
  return name === "timeline" ? TIMELINE_MAX : TEXT_LIMITS[name];
}

export interface FormFieldSpec {
  name: FormTextField;
  label: string;
  required: boolean;
  /** Titolo e «Urgenza» sono una riga sola; gli altri testi vanno a capo. */
  multiline: boolean;
  max: number;
  placeholder: string;
}

/**
 * I campi di testo del modulo per un tipo, con le etichette di §6.2: «Limiti» e «Urgenza» solo
 * per «Da costruire», «Impatto ambientale e sociale» solo con ESG attivo.
 */
export function formFields(kind: UseCaseKind, opts: { esgEnabled: boolean }): FormFieldSpec[] {
  const out: FormFieldSpec[] = [];
  for (const name of FORM_TEXT_FIELDS) {
    if (name === "sustainabilityImpact" && !opts.esgEnabled) continue;
    const label = fieldLabel(name, kind);
    if (label === null) continue;
    out.push({
      name,
      label,
      required: REQUIRED_TEXT.has(name),
      multiline: !SINGLE_LINE.has(name),
      max: fieldMax(name),
      placeholder: PLACEHOLDER[name][kind],
    });
  }
  return out;
}

/** I nomi dei campi del modulo che non sono testi. */
export const FORM_FIELD_NAMES = Object.freeze({
  kind: "kind",
  origin: "origin",
  valueEurYear: "valueEurYear",
  cost: "cost",
});

/** Una scheda del modulo completo, come la riceve il servizio (il proponente lo aggiunge l'action). */
export type FormUseCaseItem = Pick<
  NewUseCaseInput,
  | "source"
  | "kind"
  | "origin"
  | "title"
  | "description"
  | "flowDescription"
  | "humanInTheLoop"
  | "guardrails"
  | "businessCase"
  | "dataRequirements"
  | "sustainabilityImpact"
  | "timeline"
  | "valueEurYear"
  | "cost"
>;

export type FormReadResult =
  | { ok: true; item: FormUseCaseItem }
  | { ok: false; message: string; fieldErrors: FieldErrors };

function isKind(value: unknown): value is UseCaseKind {
  return typeof value === "string" && (KINDS as readonly string[]).includes(value);
}

function isOrigin(value: unknown): value is Origin {
  return typeof value === "string" && (ORIGINS as readonly string[]).includes(value);
}

/**
 * Legge il modulo completo (dal browser prima di inviare, e nell'action). `read` dà il valore
 * di un campo (`FormData.get`). Il tipo viene da «Che cosa proponi?»; i testi sono quelli del
 * tipo (`formFields`), con gli stessi obbligatori di oggi; spazi tolti, vuoto = nessun valore.
 * Origine, valore all'anno e costo si leggono solo per i revisori (`isReviewer`): per gli altri
 * il modulo non li ha, e se arrivano si ignorano.
 */
export function parseUseCaseForm(
  read: (name: string) => unknown,
  opts: { esgEnabled: boolean; isReviewer: boolean },
): FormReadResult {
  const fieldErrors: FieldErrors = {};
  const kindRaw = read(FORM_FIELD_NAMES.kind);
  if (!isKind(kindRaw)) {
    return { ok: false, message: FORM_TEXT.fixFields, fieldErrors: { kind: FORM_TEXT.chooseKind } };
  }
  const kind = kindRaw;
  const texts: Partial<Record<FormTextField, string | null>> = {};
  for (const field of formFields(kind, opts)) {
    const raw = read(field.name);
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text) {
      if (field.required) fieldErrors[field.name] = FORM_TEXT.required;
      texts[field.name] = null;
      continue;
    }
    if (field.required && text.length < TITLE_MIN_LENGTH) {
      fieldErrors[field.name] = field.name === "title" ? FORM_TEXT.titleTooShort : FORM_TEXT.tooShort;
    } else if (text.length > field.max) {
      fieldErrors[field.name] = tooLongMessage(field.max);
    }
    texts[field.name] = text;
  }

  const item: FormUseCaseItem = {
    source: "web_proposed",
    kind,
    title: texts.title ?? "",
    description: texts.description ?? null,
    flowDescription: texts.flowDescription ?? null,
    humanInTheLoop: texts.humanInTheLoop ?? null,
    guardrails: kind === "da_costruire" ? (texts.guardrails ?? null) : null,
    businessCase: texts.businessCase ?? null,
    dataRequirements: texts.dataRequirements ?? null,
    sustainabilityImpact: opts.esgEnabled ? (texts.sustainabilityImpact ?? null) : null,
    timeline: kind === "da_costruire" ? (texts.timeline ?? null) : null,
  };

  if (opts.isReviewer) {
    const origin = read(FORM_FIELD_NAMES.origin);
    if (origin !== null && origin !== undefined && origin !== "") {
      if (isOrigin(origin)) item.origin = origin;
      else fieldErrors.origin = FORM_TEXT.chooseOrigin;
    }
    const value = parseEuroAmount(read(FORM_FIELD_NAMES.valueEurYear), VALUE_EUR_YEAR_MAX);
    if (!value.ok) fieldErrors.valueEurYear = VALUE_AMOUNT_ERROR;
    else if (value.value !== null) item.valueEurYear = value.value;
    const cost = readCostFormValue(read(FORM_FIELD_NAMES.cost));
    if (!cost.ok) fieldErrors.cost = cost.message;
    else if (cost.value !== null) item.cost = cost.value;
  }

  if (Object.keys(fieldErrors).length) return { ok: false, message: FORM_TEXT.fixFields, fieldErrors };
  return { ok: true, item };
}

// ─── Activity mapping (§8.5) ─────────────────────────────────────────

/**
 * Si può proporre? Senza attività mappate, o con attività ancora da classificare, prima si
 * classifica in Activity mapping (§8.5); altrimenti si apre il dialogo.
 */
export type ActivityMappingState = "nessuna_attivita" | "da_classificare" | "pronto";

export function activityMappingState(counts: { total: number; classified: number }): ActivityMappingState {
  if (counts.total <= 0) return "nessuna_attivita";
  return counts.classified < counts.total ? "da_classificare" : "pronto";
}

/** Una proposta del generatore, come la riceve il servizio (`source = activity_mapping`). */
export type ActivityMappingItem = Pick<NewUseCaseItem, "source" | "kind" | "origin" | "status" | "title" | "description" | "businessCase" | "generatorScores" | "generatorDetails">;

type GeneratorScores = NonNullable<NewUseCaseItem["generatorScores"]>;
type GeneratorScoreKey = keyof GeneratorScores;

/** I punteggi del generatore (colonne legacy, fonte «AI», §8). ESG solo con ESG attivo. */
const SCORE_KEYS: readonly GeneratorScoreKey[] = [
  "impactEconomic",
  "impactTime",
  "impactQuality",
  "impactCoordination",
  "impactSocial",
  "feasibilityData",
  "feasibilityWorkflow",
  "feasibilityRisk",
  "feasibilityTech",
  "feasibilityTeam",
];
const ESG_SCORE_KEYS: readonly GeneratorScoreKey[] = ["esgEnvironmental", "esgSocial", "esgGovernance"];

/** Limiti dei dettagli del generatore, gli stessi dello schema del servizio. */
const GENERATOR_LIMITS = Object.freeze({
  listItems: 50,
  listItemLength: 1000,
  activityIds: 200,
  activityIdLength: 100,
  timeline: TIMELINE_MAX,
});

function clip(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, max).trim() : null;
}

function score(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 5 ? value : null;
}

function textList(value: unknown, maxItems: number, maxLength: number): string[] | null {
  if (!Array.isArray(value)) return null;
  const out = value.flatMap((entry) => {
    const text = clip(entry, maxLength);
    return text ? [text] : [];
  });
  return out.slice(0, maxItems);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Le proposte del generatore (`generateUseCases`) come schede nuove: bozze (`draft`) «Da
 * costruire» dall'alto, che il servizio nasconde ai colleghi (§8.6), con i punteggi e i
 * dettagli del generatore e l'ordine della proposta. I testi troppo lunghi si accorciano ai
 * limiti di §6.2; una proposta senza un titolo di almeno 3 caratteri si scarta. Nessuna è
 * approvata: lo stato lo cambia solo una persona (§8.5).
 */
export function activityMappingItems(generated: readonly unknown[], opts: { includeEsg: boolean }): ActivityMappingItem[] {
  const keys = opts.includeEsg ? [...SCORE_KEYS, ...ESG_SCORE_KEYS] : SCORE_KEYS;
  const items: ActivityMappingItem[] = [];
  for (const entry of generated) {
    if (!isRecord(entry)) continue;
    const title = clip(entry.title, TEXT_LIMITS.title);
    if (!title || title.length < TITLE_MIN_LENGTH) continue;
    const scores: GeneratorScores = {};
    for (const key of keys) scores[key] = score(entry[key]);
    items.push({
      source: "activity_mapping",
      kind: "da_costruire",
      origin: "transformation",
      status: "draft",
      title,
      description: clip(entry.description, TEXT_LIMITS.description),
      businessCase: clip(entry.businessCase, TEXT_LIMITS.businessCase),
      generatorScores: scores,
      generatorDetails: {
        requirements: textList(entry.requirements, GENERATOR_LIMITS.listItems, GENERATOR_LIMITS.listItemLength),
        dataDependencies: textList(entry.dataDependencies, GENERATOR_LIMITS.listItems, GENERATOR_LIMITS.listItemLength),
        relatedActivityIds: textList(entry.relatedActivityIds, GENERATOR_LIMITS.activityIds, GENERATOR_LIMITS.activityIdLength),
        timeline: clip(entry.timeline, GENERATOR_LIMITS.timeline),
        sequenceOrder: items.length + 1,
      },
    });
  }
  return items;
}
