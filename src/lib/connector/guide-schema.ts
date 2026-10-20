/**
 * Schema della guida del workspace (prompt WP8, pacchetto K8): ciò che
 * `get_intake_guide` restituisce a Claude, salvato in `workspace_connector_configs.guide`.
 * La scrive solo lo script operatore (`scripts/connector-admin.ts guide`), che la valida
 * qui prima di salvarla; la rotta legge la guida salvata così com'è (lettura tollerante in
 * `tools.ts`), quindi una guida entra nel database solo se passa da questo schema.
 *
 * Campi (dal campo `output` di `get_intake_guide` nel contratto e dalla rubrica della skill di
 * partenza, con il tetto delle persone del cliente):
 *  - `guideVersion`; `workspace` { nome, società, esgEnabled };
 *  - `areas`, `tools` [{ id, label, descrizione? }]; `contributionKinds` [{ id, label,
 *    spiegazione, esempi }];
 *  - `fields` [{ name, required, min?, max?, values?, help }], coerenti con lo schema di
 *    `submit_contribution`;
 *  - `frequencies` con le esecuzioni l'anno fisse (220, 50, 12, 4, 1); `beneficiaryCap`;
 *  - `rubric` { calibrazione, efficiency, effort, impactFlag };
 *  - `privacyRules`, `perimeterRules`;
 *  - `agentCatalog` [{ id, nome, sistema, cosaFa, keywords }] (le parole chiave servono a
 *    `matchingAgents` della ricerca e non escono mai dalla ricerca);
 *  - `statusLegend` [{ code, label, significato }] con i 12 stati del contratto;
 *  - `dialogProtocol`, `summaryTemplate`.
 * `identityMode` non sta nella guida: lo aggiunge la rotta dalla configurazione.
 *
 * Due controlli:
 *  - `parseConnectorGuide`: forma, limiti, valori fissi del contratto (tipi di contributo,
 *    frequenze con le esecuzioni l'anno, livelli della rubrica, codici ed etichette degli
 *    stati) e dimensione: la risposta di `get_intake_guide` resta sotto 20.000 caratteri;
 *  - `guideProfileMismatches`: aree, società, strumenti e agenti della guida sono un
 *    sottoinsieme degli enum del profilo del cliente (il contratto), il tetto delle persone
 *    è il `maximum` di `beneficiaries` e ogni voce di `fields` corrisponde allo schema
 *    pubblicato di `submit_contribution` (obbligatorietà, limiti, valori).
 * I messaggi dicono il campo e il problema; possono citare id della guida (lo script li
 * mostra solo all'operatore), mai testi liberi.
 *
 * Modulo puro (solo zod e moduli puri del connettore): lo usano lo script operatore e i test.
 */
import { z } from "zod";
import {
  AGENT_NONE,
  AGENT_UNKNOWN,
  buildToolInputSchemas,
  CONTRIBUTION_KINDS,
  FREQUENCIES,
  IMPACT_FLAG_VALUES,
  QUALITY_GAINS,
  SUBMIT_REQUIRED_FIELDS,
  TOOL_OTHER,
  type ContractProfile,
  type JsonSchema,
} from "./contract.ts";
import { CONNECTOR_STATUS_LABEL, CONNECTOR_STATUS_PRECEDENCE, type ConnectorStatusCode } from "./status.ts";

/** Tetto della risposta di `get_intake_guide` (prompt WP5). */
export const GUIDE_MAX_CHARS = 20_000;

/** Esecuzioni l'anno per frequenza (skill di partenza e contratto: 220, 50, 12, 4, 1). */
export const GUIDE_RUNS_PER_YEAR: Readonly<Record<(typeof FREQUENCIES)[number], number>> = Object.freeze({
  giornaliera: 220,
  settimanale: 50,
  mensile: 12,
  trimestrale: 4,
  una_tantum: 1,
});

/** Qualità di ogni livello della rubrica di efficienza, dal punteggio 1 al 5. */
const QUALITY_BY_SCORE = QUALITY_GAINS;
const FLAG_ORDER = IMPACT_FLAG_VALUES;

const ID = /^[a-z0-9_]{1,40}$/;
const FIELD_NAME = /^[A-Za-z][A-Za-z0-9]{0,40}(\.[A-Za-z][A-Za-z0-9]{0,40}){0,2}$/;

const text = (max: number) => z.string().trim().min(1).max(max);
const id = () => z.string().regex(ID, "Id non valido: lettere minuscole, cifre e trattino basso.");

function unique<T>(key: (item: T) => string, label: string) {
  return (items: T[], ctx: z.RefinementCtx) => {
    const seen = new Set<string>();
    items.forEach((item, index) => {
      const k = key(item);
      if (seen.has(k)) ctx.addIssue({ code: "custom", path: [index], message: `${label} ripetuto.` });
      seen.add(k);
    });
  };
}

const labelled = z
  .object({ id: id(), label: text(80), descrizione: text(300).optional() })
  .strict();

const scoreLevel = <T extends z.ZodRawShape>(shape: T) => z.object({ score: z.number().int().min(1).max(5), label: text(40), ...shape }).strict();

function levelsInOrder(levels: Array<{ score: number }>, ctx: z.RefinementCtx) {
  levels.forEach((level, index) => {
    if (level.score !== index + 1) ctx.addIssue({ code: "custom", path: [index, "score"], message: "I livelli vanno da 1 a 5, in ordine." });
  });
}

export const guideSchema = z
  .object({
    guideVersion: z.string().trim().min(1).max(20),
    workspace: z
      .object({
        nome: text(120),
        società: z.array(id()).min(1).max(60).superRefine(unique((value: string) => value, "Valore")),
        esgEnabled: z.boolean(),
      })
      .strict(),
    areas: z.array(labelled).min(1).max(60).superRefine(unique((a: { id: string }) => a.id, "Id")),
    tools: z.array(labelled).min(1).max(60).superRefine(unique((a: { id: string }) => a.id, "Id")),
    contributionKinds: z
      .array(z.object({ id: z.enum(CONTRIBUTION_KINDS), label: text(80), spiegazione: text(500), esempi: z.array(text(200)).max(5) }).strict())
      .min(1)
      .max(CONTRIBUTION_KINDS.length)
      .superRefine(unique((k: { id: string }) => k.id, "Tipo")),
    fields: z
      .array(
        z
          .object({
            name: z.string().regex(FIELD_NAME, "Nome di campo non valido."),
            required: z.boolean(),
            min: z.number().finite().optional(),
            max: z.number().finite().optional(),
            values: z.array(z.string().min(1).max(60)).min(1).max(60).optional(),
            help: text(400),
          })
          .strict()
      )
      .min(1)
      .max(60)
      .superRefine(unique((f: { name: string }) => f.name, "Campo")),
    frequencies: z
      .array(z.object({ id: z.enum(FREQUENCIES), label: text(40), esecuzioniAnno: z.number().int() }).strict())
      .length(FREQUENCIES.length)
      .superRefine((list, ctx) => {
        list.forEach((f, index) => {
          if (f.id !== FREQUENCIES[index]) ctx.addIssue({ code: "custom", path: [index, "id"], message: `Le frequenze sono ${FREQUENCIES.join(", ")}, in ordine.` });
          else if (f.esecuzioniAnno !== GUIDE_RUNS_PER_YEAR[f.id]) {
            ctx.addIssue({ code: "custom", path: [index, "esecuzioniAnno"], message: `Per ${f.id} le esecuzioni l'anno sono ${GUIDE_RUNS_PER_YEAR[f.id]}.` });
          }
        });
      }),
    beneficiaryCap: z.number().int().min(1).max(100_000),
    rubric: z
      .object({
        calibrazione: text(300),
        efficiency: z
          .object({
            formula: text(300),
            regola: text(300),
            livelli: z
              .array(scoreLevel({ oreAnnue: text(60), euroAnnui: text(60), qualita: z.enum(QUALITY_GAINS) }))
              .length(5)
              .superRefine((levels, ctx) => {
                levelsInOrder(levels, ctx);
                levels.forEach((level, index) => {
                  if (level.qualita !== QUALITY_BY_SCORE[index]) {
                    ctx.addIssue({ code: "custom", path: [index, "qualita"], message: `Al livello ${index + 1} la qualità è ${QUALITY_BY_SCORE[index]}.` });
                  }
                });
              }),
            note: z.array(text(400)).max(10),
          })
          .strict(),
        effort: z
          .object({
            livelli: z
              .array(scoreLevel({ tempo: text(60), cosaServe: text(200) }))
              .length(5)
              .superRefine(levelsInOrder),
            note: z.array(text(400)).max(10),
          })
          .strict(),
        impactFlag: z
          .object({
            checklist: z.array(z.object({ ambito: text(60), voci: z.array(text(300)).min(1).max(10) }).strict()).min(1).max(10),
            logica: z
              .array(z.object({ value: z.enum(IMPACT_FLAG_VALUES), quando: text(300) }).strict())
              .length(FLAG_ORDER.length)
              .superRefine((list, ctx) => {
                list.forEach((entry, index) => {
                  if (entry.value !== FLAG_ORDER[index]) ctx.addIssue({ code: "custom", path: [index, "value"], message: `Il semaforo va in ordine: ${FLAG_ORDER.join(", ")}.` });
                });
              }),
          })
          .strict(),
      })
      .strict(),
    privacyRules: z.array(text(400)).min(1).max(20),
    perimeterRules: z.array(text(400)).min(1).max(20),
    agentCatalog: z
      .array(
        z
          .object({
            id: id(),
            nome: text(60),
            sistema: text(80),
            cosaFa: text(300),
            keywords: z.array(z.string().trim().min(2).max(80)).min(1).max(50),
          })
          .strict()
      )
      .max(60)
      .superRefine(unique((a: { id: string }) => a.id, "Agente"))
      .superRefine((agents, ctx) => {
        agents.forEach((agent, index) => {
          if (agent.id === AGENT_NONE || agent.id === AGENT_UNKNOWN) {
            ctx.addIssue({ code: "custom", path: [index, "id"], message: `«${agent.id}» è riservato dal contratto.` });
          }
        });
      }),
    statusLegend: z
      .array(z.object({ code: z.enum(CONNECTOR_STATUS_PRECEDENCE as readonly ConnectorStatusCode[] as [ConnectorStatusCode, ...ConnectorStatusCode[]]), label: text(120), significato: text(300) }).strict())
      .length(CONNECTOR_STATUS_PRECEDENCE.length)
      .superRefine(unique((s: { code: string }) => s.code, "Stato"))
      .superRefine((legend, ctx) => {
        legend.forEach((entry, index) => {
          if (statusLabelMatches(entry.code, entry.label)) return;
          ctx.addIssue({ code: "custom", path: [index, "label"], message: `L'etichetta di ${entry.code} è quella che il connettore restituisce.` });
        });
      }),
    dialogProtocol: text(6000),
    summaryTemplate: text(3000),
  })
  .strict();

export type ConnectorGuide = z.infer<typeof guideSchema>;

/**
 * L'etichetta della legenda è quella degli strumenti: uguale per gli stati fissi; per i
 * due doppioni l'inizio comune, perché il codice dell'altra segnalazione cambia.
 */
function statusLabelMatches(code: ConnectorStatusCode, label: string): boolean {
  if (code === "POSSIBILE_DOPPIONE") return label.startsWith("In valutazione (possibile doppione");
  if (code === "DOPPIONE") return label.startsWith("Unita a");
  return label === CONNECTOR_STATUS_LABEL[code];
}

/** La guida come la vede Claude da `get_intake_guide` (con `identityMode` più lungo). */
function servedGuideLength(guide: ConnectorGuide): number {
  const { guideVersion, ...rest } = guide;
  return JSON.stringify({ guideVersion, identityMode: "verificata", ...rest }).length;
}

export type GuideParseResult =
  | { ok: true; guide: ConnectorGuide; servedChars: number }
  | { ok: false; problems: string[] };

function pathOf(path: readonly PropertyKey[]): string {
  return path.map(String).join(".") || "guida";
}

/**
 * Valida una guida (per esempio letta da un file dell'operatore). I problemi sono
 * «campo: messaggio», al massimo 50; mai i testi della guida.
 */
export function parseConnectorGuide(input: unknown): GuideParseResult {
  const parsed = guideSchema.safeParse(input);
  if (!parsed.success) {
    const problems = parsed.error.issues.slice(0, 50).map((issue) => {
      const message = issue.code === "custom" ? issue.message : genericMessage(issue);
      return `${pathOf(issue.path)}: ${message}`;
    });
    return { ok: false, problems };
  }
  const servedChars = servedGuideLength(parsed.data);
  if (servedChars > GUIDE_MAX_CHARS) {
    return { ok: false, problems: [`guida: ${servedChars} caratteri nella risposta di get_intake_guide, oltre ${GUIDE_MAX_CHARS}.`] };
  }
  return { ok: true, guide: parsed.data, servedChars };
}

function genericMessage(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case "invalid_type":
      return "campo mancante o di tipo sbagliato.";
    case "too_small":
      return `troppo corto o troppo piccolo (minimo ${String(issue.minimum)}).`;
    case "too_big":
      return `troppo lungo o troppo grande (massimo ${String(issue.maximum)}).`;
    case "invalid_value":
      return "valore non ammesso.";
    case "unrecognized_keys":
      return `campi non previsti: ${issue.keys.filter((k) => /^[A-Za-z0-9_à-ù]{1,40}$/.test(k)).join(", ") || "…"}.`;
    case "invalid_format":
      return "formato non valido.";
    default:
      return "valore non valido.";
  }
}

// ─── Coerenza con il profilo del cliente ────────────────────────────────────

function schemaAt(root: JsonSchema, path: string): { schema: JsonSchema; required: boolean } | null {
  let current = root;
  let required = false;
  for (const part of path.split(".")) {
    const properties = current.properties as Record<string, JsonSchema> | undefined;
    // Solo le proprietà dello schema: «constructor» o «toString» non sono campi del tool.
    const next = properties && Object.hasOwn(properties, part) ? properties[part] : undefined;
    if (!next) return null;
    required = Array.isArray(current.required) && (current.required as string[]).includes(part);
    current = next;
  }
  return { schema: current, required };
}

function limitsOf(schema: JsonSchema): { min?: number; max?: number } {
  const pick = (...keys: string[]) => {
    for (const key of keys) if (typeof schema[key] === "number") return schema[key] as number;
    return undefined;
  };
  return { min: pick("minLength", "minimum", "minItems"), max: pick("maxLength", "maximum", "maxItems") };
}

function enumOf(schema: JsonSchema): string[] | null {
  if (Array.isArray(schema.enum)) return schema.enum as string[];
  const items = schema.items as JsonSchema | undefined;
  if (items && Array.isArray(items.enum)) return items.enum as string[];
  return null;
}

/**
 * I punti in cui la guida non è coerente con il profilo del cliente (gli enum e i limiti
 * pubblicati in `tools/list`). Vuoto se è tutto coerente.
 */
export function guideProfileMismatches(guide: ConnectorGuide, profile: ContractProfile): string[] {
  const out: string[] = [];
  const notIn = (label: string, values: readonly string[], allowed: readonly string[]) => {
    const extra = values.filter((value) => !allowed.includes(value));
    if (extra.length) out.push(`${label}: valori fuori dal contratto (${extra.join(", ")}).`);
  };
  notIn("areas", guide.areas.map((a) => a.id), profile.areas);
  notIn("workspace.società", guide.workspace.società, profile.companies);
  notIn("tools", guide.tools.map((t) => t.id), [...profile.tools, TOOL_OTHER]);
  notIn("agentCatalog", guide.agentCatalog.map((a) => a.id), profile.agents);
  if (guide.beneficiaryCap !== profile.beneficiariesMax) {
    out.push(`beneficiaryCap: ${guide.beneficiaryCap}, ma il contratto ammette al massimo ${profile.beneficiariesMax} persone.`);
  }
  const submit = buildToolInputSchemas(profile).submit_contribution;
  for (const field of guide.fields) {
    const found = schemaAt(submit, field.name);
    if (!found) {
      out.push(`fields.${field.name}: campo che submit_contribution non ha.`);
      continue;
    }
    const required = field.name.includes(".") ? found.required : (SUBMIT_REQUIRED_FIELDS as readonly string[]).includes(field.name);
    if (field.required !== required) out.push(`fields.${field.name}: required è ${required} nel contratto.`);
    const limits = limitsOf(found.schema);
    for (const key of ["min", "max"] as const) {
      if (field[key] !== undefined && field[key] !== limits[key]) {
        out.push(`fields.${field.name}: ${key} è ${limits[key] ?? "assente"} nel contratto.`);
      }
    }
    if (field.values) {
      const allowed = enumOf(found.schema);
      if (!allowed) out.push(`fields.${field.name}: il contratto non ha un elenco di valori.`);
      else notIn(`fields.${field.name}.values`, field.values, allowed);
    }
  }
  return out;
}
