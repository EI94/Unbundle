/**
 * Contratto v2 del connettore MCP organizzativo (WP3): schemi d'ingresso dei 4 tool,
 * validazione, regole incrociate e formato degli errori.
 *
 * Due rappresentazioni dello stesso contratto:
 *  - il JSON Schema da pubblicare in `tools/list` (`buildToolInputSchemas`), con
 *    l'ordine delle chiavi del contratto;
 *  - lo schema zod `strict` equivalente (`buildToolInputZod`), che l'handler usa per
 *    validare. `contract.test.ts` li confronta: stessi campi obbligatori, limiti,
 *    pattern ed enum.
 *
 * Cosa è nel codice e cosa no. Il codice contiene solo la parte generica del
 * contratto: nomi dei campi, tipi, limiti, pattern, gli enum uguali per ogni cliente e
 * descrizioni neutre. I valori propri di un cliente (aree, società, strumenti, agenti,
 * tetto delle persone) e le descrizioni scritte per lui arrivano da un
 * `ContractProfile`, fuori da git (file `*.private.json`, vedi
 * `docs/connettore/README.md`). Così lo schema pubblicato resta quello del contratto
 * senza che i contenuti del cliente entrino nel repo.
 *
 * Enum fissi e guida. L'enum pubblicato è quello del profilo, uguale per tutti i
 * workspace (i client possono tenere in cache `tools/list`). La guida del workspace
 * può solo restringerlo: un valore che la guida non contiene dà `invalid_payload` con
 * il campo in `fieldErrors` (`GuideRestrictions`).
 *
 * Errori: per ogni tool un risultato con `isError: true` e, in `structuredContent`
 * (ripetuto come testo JSON), `{ error, message, fieldErrors?, retryAfterSeconds? }`.
 * I messaggi non ripetono mai i valori scritti dalle persone.
 *
 * Modulo puro: solo zod, nessun database, gira con `node --test`.
 */
import { z } from "zod";

export const CONNECTOR_CONTRACT_VERSION = 2;

export const CONNECTOR_TOOL_NAMES = [
  "get_intake_guide",
  "find_similar_contributions",
  "submit_contribution",
  "get_contribution_status",
] as const;
export type ConnectorToolName = (typeof CONNECTOR_TOOL_NAMES)[number];

// ─── Parte generica del contratto (uguale per ogni cliente) ─────────────────

export const CONTRIBUTION_KINDS = ["use_case_ai", "best_practice"] as const;
export const FREQUENCIES = ["giornaliera", "settimanale", "mensile", "trimestrale", "una_tantum"] as const;
export const QUALITY_GAINS = ["invariata", "lieve", "sensibile", "nettamente_superiore", "non_raggiungibile_a_mano"] as const;
export const DEVELOPMENT_STATUSES = ["idea", "prototipo", "funzionante", "diffuso"] as const;
export const URGENCIES = ["quick_win", "progetto_strutturato"] as const;
export const IMPACT_FLAG_VALUES = ["verde", "giallo", "rosso"] as const;
export const RELATION_TYPES = ["integra", "simile_ma_diversa"] as const;
export const IDENTITY_MODES = ["dichiarata", "verificata"] as const;
export type IdentityMode = (typeof IDENTITY_MODES)[number];

/** Valore di `tools` che chiede `toolsOther`; sta sempre in coda all'enum. */
export const TOOL_OTHER = "altro";
/** Valori di `relatedAgent` che non sono agenti; stanno sempre in coda all'enum. */
export const AGENT_NONE = "nessuno";
export const AGENT_UNKNOWN = "non_so";

/** Codice di una segnalazione (`use_cases.code`). */
export const CONTRACT_CODE_PATTERN = "^[A-Z]{2,4}-[0-9]{4,5}$";
export const IDEMPOTENCY_KEY_PATTERN = "^[A-Za-z0-9._:-]+$";

/** Limiti del contratto, usati sia dal JSON Schema sia da zod. */
export const CONTRACT_LIMITS = Object.freeze({
  query: { min: 3, max: 200 },
  resultLimit: { min: 1, max: 10, default: 5 },
  idempotencyKey: { min: 8, max: 128 },
  guideVersion: { min: 1, max: 20 },
  title: { min: 5, max: 120 },
  problem: { min: 20, max: 2000 },
  flowDescription: { min: 20, max: 3000 },
  tools: { min: 1, max: 10 },
  toolsOther: { max: 200 },
  beneficiaries: { min: 1 },
  timeSavedMinutesPerRun: { min: 0, max: 1440 },
  valuePerRunEur: { min: 0, max: 500000 },
  longText: { min: 8, max: 2000 },
  expectedImpact: { min: 10, max: 2000 },
  score: { min: 1, max: 5 },
  reasoning: { min: 10, max: 600 },
  promptSnippet: { max: 4000 },
  sourceConversation: { max: 200 },
  submitterName: { min: 2, max: 120 },
  submitterEmail: { max: 255 },
});

// ─── Profilo del cliente (fuori da git) ─────────────────────────────────────

/** Chiavi delle descrizioni che un profilo può sostituire: `tool.campo[.sottocampo]`. */
export const CONTRACT_DESCRIPTION_KEYS = [
  "find_similar_contributions.query",
  "find_similar_contributions.area",
  "find_similar_contributions.kind",
  "find_similar_contributions.limit",
  "submit_contribution.idempotencyKey",
  "submit_contribution.confirmedByUser",
  "submit_contribution.guideVersion",
  "submit_contribution.contributionKind",
  "submit_contribution.title",
  "submit_contribution.area",
  "submit_contribution.company",
  "submit_contribution.problem",
  "submit_contribution.flowDescription",
  "submit_contribution.tools",
  "submit_contribution.toolsOther",
  "submit_contribution.frequency",
  "submit_contribution.beneficiaries",
  "submit_contribution.timeSavedMinutesPerRun",
  "submit_contribution.valuePerRunEur",
  "submit_contribution.qualityGain",
  "submit_contribution.developmentStatus",
  "submit_contribution.humanInTheLoop",
  "submit_contribution.guardrails",
  "submit_contribution.expectedImpact",
  "submit_contribution.dataRequirements",
  "submit_contribution.urgency",
  "submit_contribution.sustainabilityImpact",
  "submit_contribution.proposerEstimate",
  "submit_contribution.proposerEstimate.efficiency.reasoning",
  "submit_contribution.flags.personalData",
  "submit_contribution.flags.safetyRelated",
  "submit_contribution.flags.outsideFoundation",
  "submit_contribution.relatedAgent",
  "submit_contribution.relatedCode",
  "submit_contribution.relationType",
  "submit_contribution.promptSnippet",
  "submit_contribution.sourceConversation",
  "submit_contribution.submittedBy",
  "get_contribution_status.code",
] as const;
export type ContractDescriptionKey = (typeof CONTRACT_DESCRIPTION_KEYS)[number];

/**
 * Descrizioni neutre, scritte qui e non riprese dal contratto di un cliente: dicono lo
 * scopo del campo e i suoi limiti. Le descrizioni scritte per un cliente arrivano solo
 * dal profilo (`ContractProfile.descriptions`, file `*.private.json`), che le sostituisce.
 */
export const DEFAULT_CONTRACT_DESCRIPTIONS: Readonly<Record<ContractDescriptionKey, string>> = Object.freeze({
  "find_similar_contributions.query":
    "Testo da cercare tra le segnalazioni esistenti: poche parole chiave (3-6) su attività o software, mai riferimenti a persone.",
  "find_similar_contributions.area": "Filtro per area, se indicato.",
  "find_similar_contributions.kind": "Opzionale: restringe la ricerca a un tipo di contributo.",
  "find_similar_contributions.limit": "Tetto agli elementi restituiti; in assenza, 5.",
  "submit_contribution.idempotencyKey":
    "Identificativo dell'invio generato dal client. Ripetere la chiamata con lo stesso valore non crea una seconda segnalazione; un riepilogo nuovo vuole un valore nuovo.",
  "submit_contribution.confirmedByUser": "Vale true solo dopo che la persona ha approvato il riepilogo mostrato.",
  "submit_contribution.guideVersion": "Versione della guida usata per raccogliere i dati (da get_intake_guide).",
  "submit_contribution.contributionKind":
    "Tipo di contributo: use_case_ai per un bisogno ancora da realizzare, best_practice per una pratica con l'AI già in uso.",
  "submit_contribution.title":
    "Titolo breve e descrittivo, circa 5-10 parole. Lo vede tutta l'organizzazione: niente nomi né email.",
  "submit_contribution.area": "Area dell'organizzazione che beneficia di più; un valore dell'elenco.",
  "submit_contribution.company": "Società del gruppo interessata; un valore dell'elenco.",
  "submit_contribution.problem": "La situazione attuale: come si lavora oggi, chi se ne occupa, cosa costa fatica.",
  "submit_contribution.flowDescription":
    "Il funzionamento proposto o già in uso, passo per passo, con il software coinvolto.",
  "submit_contribution.tools": "Software e servizi coinvolti; valori dell'elenco.",
  "submit_contribution.toolsOther": "Nomi del software non in elenco; da compilare quando tools include «altro».",
  "submit_contribution.frequency": "Cadenza con cui l'attività si ripete.",
  "submit_contribution.beneficiaries": "Numero di persone che ne avrebbero un vantaggio.",
  "submit_contribution.timeSavedMinutesPerRun":
    "Stima della persona: minuti guadagnati a ogni ripetizione dell'attività.",
  "submit_contribution.valuePerRunEur":
    "Euro per ripetizione, solo se la persona fornisce la cifra e da dove viene; Claude non la inventa.",
  "submit_contribution.qualityGain":
    "Effetto sulla qualità del risultato. Va indicata almeno una misura fra tempo, euro e qualità.",
  "submit_contribution.developmentStatus": "Maturità attuale della soluzione.",
  "submit_contribution.humanInTheLoop":
    "Il ruolo delle persone: chi controlla o corregge l'output, oppure chi adotta la pratica.",
  "submit_contribution.guardrails":
    "Limiti posti all'AI e casi in cui passa la mano a una persona. Richiesto per use_case_ai.",
  "submit_contribution.expectedImpact": "Vantaggio atteso descritto a parole; nessuna cifra non fornita dalla persona.",
  "submit_contribution.dataRequirements":
    "Tipologie di dati, file o permessi necessari; descriverle senza riportarne il contenuto.",
  "submit_contribution.urgency": "Opzionale: soluzione rapida oppure progetto più ampio.",
  "submit_contribution.sustainabilityImpact":
    "Effetti su ambiente e persone; richiesto quando la guida attiva l'ESG (esgEnabled).",
  "submit_contribution.proposerEstimate":
    "Autovalutazione indicativa fatta da Claude sui criteri di get_intake_guide; non sostituisce il giudizio di chi gestisce il portafoglio.",
  "submit_contribution.proposerEstimate.efficiency.reasoning":
    "Passaggi del conto (minuti × ripetizioni annue × persone) e punteggio che ne risulta.",
  "submit_contribution.flags.personalData": "True se la soluzione userebbe informazioni personali.",
  "submit_contribution.flags.safetyRelated": "True se riguarda la sicurezza o decisioni operative delicate.",
  "submit_contribution.flags.outsideFoundation": "True se tocca temi che la guida esclude.",
  "submit_contribution.relatedAgent": "Agente esistente con lo stesso scopo, se c'è; un valore dell'elenco.",
  "submit_contribution.relatedCode":
    "Se la proposta si lega a una già registrata: il suo identificativo, preso dai risultati di find_similar_contributions.",
  "submit_contribution.relationType": "Legame con relatedCode; richiesto quando relatedCode è presente.",
  "submit_contribution.promptSnippet": "Esempio del testo dato all'AI, se esiste, privo di riferimenti a individui.",
  "submit_contribution.sourceConversation": "Opzionale: nome della conversazione da cui nasce la segnalazione.",
  "submit_contribution.submittedBy":
    "Autore dichiarato (nome, email facoltativa); si usa solo quando identityMode è «dichiarata».",
  "get_contribution_status.code":
    "Identificativo restituito da submit_contribution (forma XX-0012). Si può omettere solo con l'accesso individuale: allora la risposta elenca le proposte recenti di chi chiama.",
});

/**
 * Valori propri di un cliente. Gli enum pubblicati sono `areas`, `companies`,
 * `tools` + «altro» e `agents` + «nessuno», «non_so», nell'ordine dato.
 */
export interface ContractProfile {
  areas: readonly string[];
  companies: readonly string[];
  /** Senza «altro», che il contratto aggiunge in coda. */
  tools: readonly string[];
  /** Senza «nessuno» e «non_so», che il contratto aggiunge in coda. */
  agents: readonly string[];
  /** Massimo di `beneficiaries` (persone dell'organizzazione). */
  beneficiariesMax: number;
  descriptions?: Readonly<Partial<Record<ContractDescriptionKey, string>>>;
}

const ENUM_VALUE = /^[a-z0-9_]{1,40}$/;

function enumValues(reserved: readonly string[]) {
  return z
    .array(z.string().regex(ENUM_VALUE, "Valore non valido: lettere minuscole, cifre e trattino basso."))
    .min(1)
    .max(60)
    .superRefine((values, ctx) => {
      if (new Set(values).size !== values.length) ctx.addIssue({ code: "custom", message: "Valori ripetuti." });
      for (const value of values) {
        if (reserved.includes(value)) ctx.addIssue({ code: "custom", message: `Valore riservato dal contratto: ${value}.` });
      }
    });
}

/** Per leggere un profilo da un file privato: valida, senza fidarsi del contenuto. */
export const contractProfileSchema = z
  .object({
    areas: enumValues([]),
    companies: enumValues([]),
    tools: enumValues([TOOL_OTHER]),
    agents: enumValues([AGENT_NONE, AGENT_UNKNOWN]),
    beneficiariesMax: z.number().int().min(1).max(100000),
    descriptions: z
      .partialRecord(z.enum(CONTRACT_DESCRIPTION_KEYS), z.string().trim().min(1).max(1000))
      .optional(),
  })
  .strict();

export type ContractProfileParseResult =
  | { ok: true; profile: ContractProfile }
  | { ok: false; fieldErrors: Record<string, string> };

export function parseContractProfile(input: unknown): ContractProfileParseResult {
  const parsed = contractProfileSchema.safeParse(input);
  if (parsed.success) return { ok: true, profile: parsed.data };
  return { ok: false, fieldErrors: fieldErrorsFromIssues(parsed.error.issues, input) };
}

function toolsEnum(profile: ContractProfile): string[] {
  return [...profile.tools, TOOL_OTHER];
}

function agentsEnum(profile: ContractProfile): string[] {
  return [...profile.agents, AGENT_NONE, AGENT_UNKNOWN];
}

// ─── JSON Schema pubblicato in tools/list ───────────────────────────────────

/** Campi obbligatori di `submit_contribution`, nell'ordine del contratto. */
export const SUBMIT_REQUIRED_FIELDS = [
  "idempotencyKey",
  "confirmedByUser",
  "guideVersion",
  "contributionKind",
  "title",
  "area",
  "company",
  "problem",
  "flowDescription",
  "tools",
  "frequency",
  "beneficiaries",
  "developmentStatus",
  "humanInTheLoop",
  "expectedImpact",
  "dataRequirements",
  "proposerEstimate",
  "flags",
] as const;

export type JsonSchema = { [key: string]: unknown };

/**
 * Gli `inputSchema` dei 4 tool, con l'ordine delle chiavi del contratto. Con il profilo
 * del cliente, descrizioni comprese, il risultato è l'`input_schema_json` del contratto.
 */
export function buildToolInputSchemas(profile: ContractProfile): Readonly<Record<ConnectorToolName, JsonSchema>> {
  const L = CONTRACT_LIMITS;
  const d = (key: ContractDescriptionKey) => profile.descriptions?.[key] ?? DEFAULT_CONTRACT_DESCRIPTIONS[key];
  const text = (min: number | null, max: number, key: ContractDescriptionKey): JsonSchema =>
    min === null
      ? { type: "string", maxLength: max, description: d(key) }
      : { type: "string", minLength: min, maxLength: max, description: d(key) };
  const choice = (values: readonly string[], key: ContractDescriptionKey): JsonSchema => ({
    type: "string",
    enum: [...values],
    description: d(key),
  });
  const reasoning = (key?: ContractDescriptionKey): JsonSchema => ({
    type: "string",
    minLength: L.reasoning.min,
    maxLength: L.reasoning.max,
    ...(key ? { description: d(key) } : {}),
  });
  const score = (): JsonSchema => ({ type: "integer", minimum: L.score.min, maximum: L.score.max });
  const scored = (key?: ContractDescriptionKey): JsonSchema => ({
    type: "object",
    additionalProperties: false,
    required: ["score", "reasoning"],
    properties: { score: score(), reasoning: reasoning(key) },
  });
  const flag = (key: ContractDescriptionKey): JsonSchema => ({ type: "boolean", description: d(key) });
  const code = (key: ContractDescriptionKey): JsonSchema => ({
    type: "string",
    pattern: CONTRACT_CODE_PATTERN,
    description: d(key),
  });

  const schemas: Record<ConnectorToolName, JsonSchema> = {
    get_intake_guide: { type: "object", properties: {}, additionalProperties: false },
    find_similar_contributions: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: text(L.query.min, L.query.max, "find_similar_contributions.query"),
        area: choice(profile.areas, "find_similar_contributions.area"),
        kind: choice(CONTRIBUTION_KINDS, "find_similar_contributions.kind"),
        limit: {
          type: "integer",
          minimum: L.resultLimit.min,
          maximum: L.resultLimit.max,
          default: L.resultLimit.default,
          description: d("find_similar_contributions.limit"),
        },
      },
    },
    submit_contribution: {
      type: "object",
      additionalProperties: false,
      required: [...SUBMIT_REQUIRED_FIELDS],
      properties: {
        idempotencyKey: {
          type: "string",
          minLength: L.idempotencyKey.min,
          maxLength: L.idempotencyKey.max,
          pattern: IDEMPOTENCY_KEY_PATTERN,
          description: d("submit_contribution.idempotencyKey"),
        },
        confirmedByUser: { type: "boolean", const: true, description: d("submit_contribution.confirmedByUser") },
        guideVersion: text(L.guideVersion.min, L.guideVersion.max, "submit_contribution.guideVersion"),
        contributionKind: choice(CONTRIBUTION_KINDS, "submit_contribution.contributionKind"),
        title: text(L.title.min, L.title.max, "submit_contribution.title"),
        area: choice(profile.areas, "submit_contribution.area"),
        company: choice(profile.companies, "submit_contribution.company"),
        problem: text(L.problem.min, L.problem.max, "submit_contribution.problem"),
        flowDescription: text(L.flowDescription.min, L.flowDescription.max, "submit_contribution.flowDescription"),
        tools: {
          type: "array",
          minItems: L.tools.min,
          maxItems: L.tools.max,
          uniqueItems: true,
          items: { type: "string", enum: toolsEnum(profile) },
          description: d("submit_contribution.tools"),
        },
        toolsOther: text(null, L.toolsOther.max, "submit_contribution.toolsOther"),
        frequency: choice(FREQUENCIES, "submit_contribution.frequency"),
        beneficiaries: {
          type: "integer",
          minimum: L.beneficiaries.min,
          maximum: profile.beneficiariesMax,
          description: d("submit_contribution.beneficiaries"),
        },
        timeSavedMinutesPerRun: {
          type: "number",
          minimum: L.timeSavedMinutesPerRun.min,
          maximum: L.timeSavedMinutesPerRun.max,
          description: d("submit_contribution.timeSavedMinutesPerRun"),
        },
        valuePerRunEur: {
          type: "number",
          minimum: L.valuePerRunEur.min,
          maximum: L.valuePerRunEur.max,
          description: d("submit_contribution.valuePerRunEur"),
        },
        qualityGain: choice(QUALITY_GAINS, "submit_contribution.qualityGain"),
        developmentStatus: choice(DEVELOPMENT_STATUSES, "submit_contribution.developmentStatus"),
        humanInTheLoop: text(L.longText.min, L.longText.max, "submit_contribution.humanInTheLoop"),
        guardrails: text(L.longText.min, L.longText.max, "submit_contribution.guardrails"),
        expectedImpact: text(L.expectedImpact.min, L.expectedImpact.max, "submit_contribution.expectedImpact"),
        dataRequirements: text(L.longText.min, L.longText.max, "submit_contribution.dataRequirements"),
        urgency: choice(URGENCIES, "submit_contribution.urgency"),
        sustainabilityImpact: text(L.longText.min, L.longText.max, "submit_contribution.sustainabilityImpact"),
        proposerEstimate: {
          type: "object",
          additionalProperties: false,
          required: ["efficiency", "effort", "impactFlag"],
          description: d("submit_contribution.proposerEstimate"),
          properties: {
            efficiency: scored("submit_contribution.proposerEstimate.efficiency.reasoning"),
            effort: scored(),
            impactFlag: {
              type: "object",
              additionalProperties: false,
              required: ["value", "reasoning"],
              properties: {
                value: { type: "string", enum: [...IMPACT_FLAG_VALUES] },
                reasoning: reasoning(),
              },
            },
          },
        },
        flags: {
          type: "object",
          additionalProperties: false,
          required: ["personalData", "safetyRelated", "outsideFoundation"],
          properties: {
            personalData: flag("submit_contribution.flags.personalData"),
            safetyRelated: flag("submit_contribution.flags.safetyRelated"),
            outsideFoundation: flag("submit_contribution.flags.outsideFoundation"),
          },
        },
        relatedAgent: choice(agentsEnum(profile), "submit_contribution.relatedAgent"),
        relatedCode: code("submit_contribution.relatedCode"),
        relationType: choice(RELATION_TYPES, "submit_contribution.relationType"),
        promptSnippet: text(null, L.promptSnippet.max, "submit_contribution.promptSnippet"),
        sourceConversation: text(null, L.sourceConversation.max, "submit_contribution.sourceConversation"),
        submittedBy: {
          type: "object",
          additionalProperties: false,
          required: ["name"],
          description: d("submit_contribution.submittedBy"),
          properties: {
            name: { type: "string", minLength: L.submitterName.min, maxLength: L.submitterName.max },
            email: { type: "string", format: "email", maxLength: L.submitterEmail.max },
          },
        },
      },
    },
    get_contribution_status: {
      type: "object",
      additionalProperties: false,
      properties: { code: code("get_contribution_status.code") },
    },
  };
  return Object.freeze(schemas);
}

// ─── Schemi zod (validazione nell'handler) ──────────────────────────────────

export interface ScoredEstimate {
  score: number;
  reasoning: string;
}

export interface SubmitContributionInput {
  idempotencyKey: string;
  confirmedByUser: true;
  guideVersion: string;
  contributionKind: (typeof CONTRIBUTION_KINDS)[number];
  title: string;
  area: string;
  company: string;
  problem: string;
  flowDescription: string;
  tools: string[];
  toolsOther?: string;
  frequency: (typeof FREQUENCIES)[number];
  beneficiaries: number;
  timeSavedMinutesPerRun?: number;
  valuePerRunEur?: number;
  qualityGain?: (typeof QUALITY_GAINS)[number];
  developmentStatus: (typeof DEVELOPMENT_STATUSES)[number];
  humanInTheLoop: string;
  guardrails?: string;
  expectedImpact: string;
  dataRequirements: string;
  urgency?: (typeof URGENCIES)[number];
  sustainabilityImpact?: string;
  proposerEstimate: {
    efficiency: ScoredEstimate;
    effort: ScoredEstimate;
    impactFlag: { value: (typeof IMPACT_FLAG_VALUES)[number]; reasoning: string };
  };
  flags: { personalData: boolean; safetyRelated: boolean; outsideFoundation: boolean };
  relatedAgent?: string;
  relatedCode?: string;
  relationType?: (typeof RELATION_TYPES)[number];
  promptSnippet?: string;
  sourceConversation?: string;
  submittedBy?: { name: string; email?: string };
}

export interface FindSimilarInput {
  query: string;
  area?: string;
  kind?: (typeof CONTRIBUTION_KINDS)[number];
  limit: number;
}

export interface GetContributionStatusInput {
  code?: string;
}

type NonEmpty = [string, ...string[]];
const nonEmpty = (values: readonly string[]) => [...values] as NonEmpty;

function uniqueItems<T>(values: T[], ctx: z.RefinementCtx) {
  if (new Set(values).size !== values.length) ctx.addIssue({ code: "custom", message: "Valori ripetuti." });
}

const codeSchema = () => z.string().regex(new RegExp(CONTRACT_CODE_PATTERN));

function buildSubmitZod(profile: ContractProfile) {
  const L = CONTRACT_LIMITS;
  const text = (min: number, max: number) => z.string().trim().min(min).max(max);
  const optionalText = (max: number) => z.string().trim().max(max).optional();
  const scored = z
    .object({
      score: z.number().int().min(L.score.min).max(L.score.max),
      reasoning: text(L.reasoning.min, L.reasoning.max),
    })
    .strict();
  return z
    .object({
      idempotencyKey: z
        .string()
        .min(L.idempotencyKey.min)
        .max(L.idempotencyKey.max)
        .regex(new RegExp(IDEMPOTENCY_KEY_PATTERN)),
      confirmedByUser: z.literal(true),
      guideVersion: text(L.guideVersion.min, L.guideVersion.max),
      contributionKind: z.enum(CONTRIBUTION_KINDS),
      title: text(L.title.min, L.title.max),
      area: z.enum(nonEmpty(profile.areas)),
      company: z.enum(nonEmpty(profile.companies)),
      problem: text(L.problem.min, L.problem.max),
      flowDescription: text(L.flowDescription.min, L.flowDescription.max),
      tools: z
        .array(z.enum(nonEmpty(toolsEnum(profile))))
        .min(L.tools.min)
        .max(L.tools.max)
        .superRefine(uniqueItems),
      toolsOther: optionalText(L.toolsOther.max),
      frequency: z.enum(FREQUENCIES),
      beneficiaries: z.number().int().min(L.beneficiaries.min).max(profile.beneficiariesMax),
      timeSavedMinutesPerRun: z.number().min(L.timeSavedMinutesPerRun.min).max(L.timeSavedMinutesPerRun.max).optional(),
      valuePerRunEur: z.number().min(L.valuePerRunEur.min).max(L.valuePerRunEur.max).optional(),
      qualityGain: z.enum(QUALITY_GAINS).optional(),
      developmentStatus: z.enum(DEVELOPMENT_STATUSES),
      humanInTheLoop: text(L.longText.min, L.longText.max),
      guardrails: text(L.longText.min, L.longText.max).optional(),
      expectedImpact: text(L.expectedImpact.min, L.expectedImpact.max),
      dataRequirements: text(L.longText.min, L.longText.max),
      urgency: z.enum(URGENCIES).optional(),
      sustainabilityImpact: text(L.longText.min, L.longText.max).optional(),
      proposerEstimate: z
        .object({
          efficiency: scored,
          effort: scored,
          impactFlag: z
            .object({ value: z.enum(IMPACT_FLAG_VALUES), reasoning: text(L.reasoning.min, L.reasoning.max) })
            .strict(),
        })
        .strict(),
      flags: z
        .object({ personalData: z.boolean(), safetyRelated: z.boolean(), outsideFoundation: z.boolean() })
        .strict(),
      relatedAgent: z.enum(nonEmpty(agentsEnum(profile))).optional(),
      relatedCode: codeSchema().optional(),
      relationType: z.enum(RELATION_TYPES).optional(),
      promptSnippet: optionalText(L.promptSnippet.max),
      sourceConversation: optionalText(L.sourceConversation.max),
      submittedBy: z
        .object({
          name: text(L.submitterName.min, L.submitterName.max),
          email: z.email().max(L.submitterEmail.max).optional(),
        })
        .strict()
        .optional(),
    })
    .strict();
}

function buildFindSimilarZod(profile: ContractProfile) {
  const L = CONTRACT_LIMITS;
  return z
    .object({
      query: z.string().trim().min(L.query.min).max(L.query.max),
      area: z.enum(nonEmpty(profile.areas)).optional(),
      kind: z.enum(CONTRIBUTION_KINDS).optional(),
      limit: z.number().int().min(L.resultLimit.min).max(L.resultLimit.max).default(L.resultLimit.default),
    })
    .strict();
}

const getIntakeGuideZod = z.object({}).strict();
const getContributionStatusZod = z.object({ code: codeSchema().optional() }).strict();

export type ToolInputZod = {
  get_intake_guide: typeof getIntakeGuideZod;
  find_similar_contributions: ReturnType<typeof buildFindSimilarZod>;
  submit_contribution: ReturnType<typeof buildSubmitZod>;
  get_contribution_status: typeof getContributionStatusZod;
};

const zodCache = new WeakMap<ContractProfile, ToolInputZod>();

/** Gli schemi zod `strict` dei 4 tool, equivalenti a `buildToolInputSchemas`. */
export function buildToolInputZod(profile: ContractProfile): ToolInputZod {
  const cached = zodCache.get(profile);
  if (cached) return cached;
  const built: ToolInputZod = {
    get_intake_guide: getIntakeGuideZod,
    find_similar_contributions: buildFindSimilarZod(profile),
    submit_contribution: buildSubmitZod(profile),
    get_contribution_status: getContributionStatusZod,
  };
  zodCache.set(profile, built);
  return built;
}

// ─── Errori e avvisi ────────────────────────────────────────────────────────

export const CONNECTOR_ERROR_CODES = [
  "invalid_payload",
  "missing_guardrails",
  "missing_impact_measure",
  "missing_submitter",
  "missing_esg",
  "missing_relation_type",
  "unknown_related_code",
  "sensitive_content",
  "idempotency_conflict",
  "idempotency_in_progress",
  "rate_limited",
  "connector_disabled",
  "submit_failed",
  "internal_error",
  "not_found",
  "identity_required",
] as const;
export type ConnectorErrorCode = (typeof CONNECTOR_ERROR_CODES)[number];

/** Messaggi predefiniti, in italiano, senza i valori scritti dalle persone. */
export const CONNECTOR_ERROR_MESSAGES: Readonly<Record<ConnectorErrorCode, string>> = Object.freeze({
  invalid_payload: "Alcuni campi non sono validi: correggi solo quelli indicati in fieldErrors e riprova.",
  missing_guardrails:
    "Per un caso d'uso AI servono i controlli e i limiti (guardrails): chiedili alla persona e riproponi il riepilogo.",
  missing_impact_measure:
    "Serve almeno una misura dell'impatto: minuti risparmiati per esecuzione, valore in euro per esecuzione o miglioramento della qualità.",
  missing_submitter: "Serve il nome di chi propone (l'email è facoltativa).",
  missing_esg: "In questo workspace serve l'impatto ambientale e sociale (sustainabilityImpact).",
  missing_relation_type: "Con relatedCode serve anche relationType («integra» o «simile_ma_diversa»).",
  unknown_related_code: "Il codice collegato non esiste in questo portafoglio: rifai la ricerca o togli il collegamento.",
  sensitive_content:
    "Alcuni campi contengono dati personali o identificativi: riscrivili in modo generico e riproponi il riepilogo.",
  idempotency_conflict: "Questa idempotencyKey è già stata usata con un contenuto diverso: genera una chiave nuova.",
  idempotency_in_progress: "Un invio con la stessa chiave è ancora in corso: riprova tra qualche secondo con la stessa chiave.",
  rate_limited: "Troppe richieste in poco tempo: riprova più tardi.",
  connector_disabled: "Il connettore è sospeso per questo workspace: prepara il riepilogo da inviare via email.",
  submit_failed: "Salvataggio non riuscito: riprova una volta con la stessa chiave.",
  internal_error: "Errore del server: riprova una volta.",
  not_found: "Nessuna segnalazione con questo codice in questo portafoglio.",
  identity_required: "Senza login personale serve il codice della segnalazione (es. XX-0012).",
});

export interface ConnectorError {
  error: ConnectorErrorCode;
  message: string;
  fieldErrors?: Record<string, string>;
  retryAfterSeconds?: number;
}

export function connectorError(
  code: ConnectorErrorCode,
  extra: { fieldErrors?: Record<string, string>; retryAfterSeconds?: number; message?: string } = {}
): ConnectorError {
  const out: ConnectorError = { error: code, message: extra.message ?? CONNECTOR_ERROR_MESSAGES[code] };
  if (extra.fieldErrors && Object.keys(extra.fieldErrors).length) out.fieldErrors = { ...extra.fieldErrors };
  if (extra.retryAfterSeconds !== undefined) {
    out.retryAfterSeconds = Math.max(1, Math.ceil(Number.isFinite(extra.retryAfterSeconds) ? extra.retryAfterSeconds : 1));
  }
  return out;
}

export interface ConnectorToolResult<T extends object> {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  structuredContent: T;
  isError?: true;
}

/** Risultato di un tool: `structuredContent` più la stessa cosa come testo JSON. */
export function connectorResult<T extends object>(data: T): ConnectorToolResult<T> {
  return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
}

/** Errore del contratto come risultato di un tool (`isError: true`). */
export function connectorErrorResult(error: ConnectorError): ConnectorToolResult<ConnectorError> {
  return { ...connectorResult(error), isError: true };
}

export type ConnectorWarningCode = "guide_outdated" | "health_terms" | "proper_names";

export interface ConnectorWarning {
  code: ConnectorWarningCode;
  message: string;
  fields?: string[];
}

/**
 * Testo dell'avviso `guide_outdated`. Il codice non arriva al client (`warningTexts` tiene solo
 * il messaggio): la skill riconosce questo avviso dalle prime parole.
 */
export const GUIDE_OUTDATED_MESSAGE =
  "La versione della guida usata non è quella attuale: la segnalazione è salvata comunque e verrà ricontrollata.";

/** Gli avvisi come stringhe, per `warnings` della risposta di `submit_contribution`. */
export function warningTexts(warnings: readonly ConnectorWarning[]): string[] {
  return warnings.map((w) => w.message);
}

// ─── Messaggi dei campi ─────────────────────────────────────────────────────

const SAFE_KEY = /^[A-Za-z0-9_.-]{1,60}$/;
const MAX_LISTED_VALUES = 30;

function valueAt(root: unknown, path: readonly PropertyKey[]): unknown {
  let current = root;
  for (const key of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<PropertyKey, unknown>)[key];
  }
  return current;
}

function issueMessage(issue: z.core.$ZodIssue, root: unknown): string {
  switch (issue.code) {
    case "invalid_type":
      return valueAt(root, issue.path) === undefined ? "Campo obbligatorio." : `Tipo non valido: serve ${typeLabel(issue.expected)}.`;
    case "too_small":
      if (issue.origin === "string") return `Almeno ${String(issue.minimum)} caratteri.`;
      if (issue.origin === "array") return `Almeno ${String(issue.minimum)} valori.`;
      return `Il valore minimo è ${String(issue.minimum)}.`;
    case "too_big":
      if (issue.origin === "string") return `Al massimo ${String(issue.maximum)} caratteri.`;
      if (issue.origin === "array") return `Al massimo ${String(issue.maximum)} valori.`;
      return `Il valore massimo è ${String(issue.maximum)}.`;
    case "invalid_value": {
      if (issue.values.length === 1 && issue.values[0] === true) return "Deve essere true.";
      const listed = issue.values.filter((v): v is string => typeof v === "string");
      return listed.length && listed.length <= MAX_LISTED_VALUES
        ? `Valore non ammesso. Valori ammessi: ${listed.join(", ")}.`
        : "Valore non ammesso.";
    }
    case "invalid_format":
      return issue.format === "email" ? "Email non valida." : "Formato non valido.";
    case "custom":
      return typeof issue.message === "string" && issue.message.length <= 200 ? issue.message : "Valore non valido.";
    default:
      return "Valore non valido.";
  }
}

function typeLabel(expected: string): string {
  switch (expected) {
    case "string":
      return "un testo";
    case "number":
      return "un numero";
    case "int":
      return "un numero intero";
    case "boolean":
      return "true o false";
    case "array":
      return "un elenco";
    case "object":
      return "un oggetto";
    default:
      return "un altro tipo";
  }
}

/**
 * `fieldErrors` in italiano dagli errori di zod: percorso del campo (`a.b.0`) e
 * messaggio. Mai il valore ricevuto. Il primo errore di ogni campo vince.
 */
export function fieldErrorsFromIssues(issues: readonly z.core.$ZodIssue[], root: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (path: string, message: string) => {
    const key = path || "payload";
    if (!(key in out)) out[key] = message;
  };
  for (const issue of issues) {
    const path = issue.path.map(String).join(".");
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) {
        const full = path ? `${path}.${key}` : key;
        if (SAFE_KEY.test(full)) put(full, "Campo non previsto dal contratto.");
        else put(path, "Campi non previsti dal contratto.");
      }
      continue;
    }
    put(path, issueMessage(issue, root));
  }
  return out;
}

// ─── Validazione dei tool ───────────────────────────────────────────────────

/**
 * Valori ammessi dalla guida del workspace (sottoinsiemi degli enum del profilo).
 * Un elenco assente non restringe nulla. «altro», «nessuno» e «non_so» restano sempre
 * ammessi: sono parte del contratto, non della guida.
 */
export interface GuideRestrictions {
  areas?: readonly string[] | null;
  companies?: readonly string[] | null;
  tools?: readonly string[] | null;
  agents?: readonly string[] | null;
  contributionKinds?: readonly string[] | null;
}

const ALWAYS_ALLOWED = new Set<string>([TOOL_OTHER, AGENT_NONE, AGENT_UNKNOWN]);

function notInGuide(value: string | undefined, allowed: readonly string[] | null | undefined): boolean {
  return value !== undefined && !!allowed && !ALWAYS_ALLOWED.has(value) && !allowed.includes(value);
}

const NOT_IN_GUIDE = "Valore non previsto dalla guida di questo workspace: usa uno dei valori di get_intake_guide.";

export type ToolValidation<T> = { ok: true; data: T } | { ok: false; error: ConnectorError };

function invalid(fieldErrors: Record<string, string>): { ok: false; error: ConnectorError } {
  return { ok: false, error: connectorError("invalid_payload", { fieldErrors }) };
}

export function validateGetIntakeGuide(input: unknown): ToolValidation<Record<string, never>> {
  const raw = input ?? {};
  const parsed = getIntakeGuideZod.safeParse(raw);
  return parsed.success ? { ok: true, data: {} } : invalid(fieldErrorsFromIssues(parsed.error.issues, raw));
}

export function validateFindSimilar(
  input: unknown,
  ctx: { profile: ContractProfile; guide?: GuideRestrictions | null }
): ToolValidation<FindSimilarInput> {
  const raw = input ?? {};
  const parsed = buildToolInputZod(ctx.profile).find_similar_contributions.safeParse(raw);
  if (!parsed.success) return invalid(fieldErrorsFromIssues(parsed.error.issues, raw));
  const data = parsed.data as FindSimilarInput;
  const fieldErrors: Record<string, string> = {};
  if (notInGuide(data.area, ctx.guide?.areas)) fieldErrors.area = NOT_IN_GUIDE;
  if (notInGuide(data.kind, ctx.guide?.contributionKinds)) fieldErrors.kind = NOT_IN_GUIDE;
  return Object.keys(fieldErrors).length ? invalid(fieldErrors) : { ok: true, data };
}

/** Senza `code` in identità dichiarata (fase 1) → `identity_required`. */
export function validateGetContributionStatus(
  input: unknown,
  ctx: { identityMode: IdentityMode }
): ToolValidation<GetContributionStatusInput> {
  const raw = input ?? {};
  const parsed = getContributionStatusZod.safeParse(raw);
  if (!parsed.success) return invalid(fieldErrorsFromIssues(parsed.error.issues, raw));
  if (parsed.data.code === undefined && ctx.identityMode === "dichiarata") {
    return { ok: false, error: connectorError("identity_required") };
  }
  return { ok: true, data: parsed.data };
}

export interface SubmitValidationContext {
  profile: ContractProfile;
  identityMode: IdentityMode;
  /** ESG attivo nel workspace: `sustainabilityImpact` diventa obbligatorio. */
  esgEnabled: boolean;
  guide?: GuideRestrictions | null;
  /** Versione attuale della guida; una versione diversa dà l'avviso `guide_outdated`. */
  currentGuideVersion?: string | null;
  /** Il codice esiste nel workspace del principal? Senza funzione il controllo si salta. */
  relatedCodeExists?: (code: string) => Promise<boolean>;
}

export type SubmitValidation =
  | { ok: true; data: SubmitContributionInput; warnings: ConnectorWarning[] }
  | { ok: false; error: ConnectorError };

const IMPACT_MEASURE_FIELDS = ["timeSavedMinutesPerRun", "valuePerRunEur", "qualityGain"] as const;

/**
 * Passo 1 di `submit_contribution`: zod, guida, regole incrociate. Ordine degli errori:
 * `invalid_payload` (schema, guida, «altro» senza `toolsOther`), poi
 * `missing_guardrails`, `missing_impact_measure`, `missing_submitter`, `missing_esg`,
 * `missing_relation_type`, `unknown_related_code`. Con identità «verificata»
 * `submittedBy` si ignora. I contenuti sensibili sono il passo dopo
 * (`sensitive-content.ts`).
 */
export async function validateSubmitContribution(input: unknown, ctx: SubmitValidationContext): Promise<SubmitValidation> {
  const raw = input ?? {};
  const parsed = buildToolInputZod(ctx.profile).submit_contribution.safeParse(raw);
  if (!parsed.success) return invalid(fieldErrorsFromIssues(parsed.error.issues, raw));
  const data = parsed.data as SubmitContributionInput;

  const fieldErrors: Record<string, string> = {};
  const guide = ctx.guide;
  if (notInGuide(data.contributionKind, guide?.contributionKinds)) fieldErrors.contributionKind = NOT_IN_GUIDE;
  if (notInGuide(data.area, guide?.areas)) fieldErrors.area = NOT_IN_GUIDE;
  if (notInGuide(data.company, guide?.companies)) fieldErrors.company = NOT_IN_GUIDE;
  if (data.tools.some((tool) => notInGuide(tool, guide?.tools))) fieldErrors.tools = NOT_IN_GUIDE;
  if (notInGuide(data.relatedAgent, guide?.agents)) fieldErrors.relatedAgent = NOT_IN_GUIDE;
  if (data.tools.includes(TOOL_OTHER) && !data.toolsOther) {
    fieldErrors.toolsOther = "Con «altro» in tools, scrivi quali strumenti.";
  }
  if (Object.keys(fieldErrors).length) return invalid(fieldErrors);

  const fail = (code: ConnectorErrorCode, fields: readonly string[]): SubmitValidation => ({
    ok: false,
    error: connectorError(code, {
      fieldErrors: Object.fromEntries(fields.map((f) => [f, CONNECTOR_ERROR_MESSAGES[code]])),
    }),
  });

  if (data.contributionKind === "use_case_ai" && !data.guardrails) return fail("missing_guardrails", ["guardrails"]);
  if (IMPACT_MEASURE_FIELDS.every((f) => data[f] === undefined)) {
    return fail("missing_impact_measure", IMPACT_MEASURE_FIELDS);
  }
  if (ctx.identityMode === "verificata") delete data.submittedBy;
  else if (!data.submittedBy) return fail("missing_submitter", ["submittedBy"]);
  if (ctx.esgEnabled && !data.sustainabilityImpact) return fail("missing_esg", ["sustainabilityImpact"]);
  if (data.relatedCode !== undefined && data.relationType === undefined) {
    return fail("missing_relation_type", ["relationType"]);
  }
  if (data.relatedCode !== undefined && ctx.relatedCodeExists && !(await ctx.relatedCodeExists(data.relatedCode))) {
    return fail("unknown_related_code", ["relatedCode"]);
  }

  const warnings: ConnectorWarning[] = [];
  const current = ctx.currentGuideVersion?.trim();
  if (current && data.guideVersion !== current) {
    warnings.push({
      code: "guide_outdated",
      message: GUIDE_OUTDATED_MESSAGE,
      fields: ["guideVersion"],
    });
  }
  return { ok: true, data, warnings };
}
