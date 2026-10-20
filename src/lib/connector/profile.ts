/**
 * Profilo del cliente del connettore, per workspace (decisione 1 dell'arresto B, pacchetto
 * K8): enum e descrizioni del contratto (`ContractProfile`), titolo e descrizione dei 4
 * tool, riga «fuori Foundation» per `review_notes`. Insieme al modello delle istruzioni
 * del server (`instructions.ts`) sta in `workspace_connector_configs` (colonne `profile` e
 * `instructions_template`, coda della 0019) e lo scrive solo lo script operatore
 * (`scripts/connector-admin.ts profile`), come la guida.
 *
 * Il codice non ha testi di riserva: un profilo assente, incompleto o non valido fa
 * rispondere la rotta 500 (`handler.ts`), così `tools/list` e `review_notes` sono sempre
 * quelli del contratto del cliente e mai valori d'esempio (prompt WP5, criterio 3). I
 * testi sintetici dei test sono in `contract.fixtures.ts`.
 *
 * Due forme:
 *  - il profilo salvato (colonna `profile`): `{ contract, tools, reviewNotes }`;
 *  - il file dell'operatore (`*.private.json`, fuori da git): lo stesso più
 *    `instructionsTemplate`, il modello delle istruzioni con il segnaposto
 *    `{{workspaceName}}`. Lo legge `parseConnectorProfileFile`, che separa le due parti.
 *
 * Modulo puro (solo zod): lo usano la rotta, lo script operatore e i test.
 */
import { z } from "zod";
import {
  CONNECTOR_TOOL_NAMES,
  fieldErrorsFromIssues,
  parseContractProfile,
  type ConnectorToolName,
  type ContractProfile,
} from "./contract.ts";
import { validateInstructionsTemplate } from "./instructions.ts";

export interface ConnectorToolText {
  title: string;
  description: string;
}

export interface ConnectorProfile {
  contract: ContractProfile;
  tools: Readonly<Record<ConnectorToolName, ConnectorToolText>>;
  /** Riga aggiunta a `review_notes` con `flags.outsideFoundation` (mappatura del contratto). */
  outsideFoundationNote: string;
}

const toolTextSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(2000),
  })
  .strict();

/**
 * Forma del profilo salvato, tutta obbligatoria:
 * `{ contract: ContractProfile, tools: { <ognuno dei 4 tool>: { title, description } },
 *    reviewNotes: { outsideFoundation } }`. Un tool mancante o in più, un testo vuoto o
 * la riga «fuori Foundation» assente rendono il profilo non valido.
 */
export const connectorProfileSchema = z
  .object({
    contract: z.unknown(),
    tools: z.record(z.enum(CONNECTOR_TOOL_NAMES), toolTextSchema),
    reviewNotes: z.object({ outsideFoundation: z.string().trim().min(1).max(500) }).strict(),
  })
  .strict();

export type ConnectorProfileParseResult =
  | { ok: true; profile: ConnectorProfile }
  | { ok: false; fieldErrors: Record<string, string> };

/** Valida il profilo, senza fidarsi del contenuto. Gli errori dicono i campi, mai i valori. */
export function parseConnectorProfile(input: unknown): ConnectorProfileParseResult {
  const parsed = connectorProfileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFromIssues(parsed.error.issues, input) };
  const contract = parseContractProfile(parsed.data.contract);
  if (!contract.ok) {
    const fieldErrors = Object.fromEntries(Object.entries(contract.fieldErrors).map(([key, message]) => [`contract.${key}`, message]));
    return { ok: false, fieldErrors };
  }
  const tools = Object.fromEntries(
    CONNECTOR_TOOL_NAMES.map((name) => {
      const text = parsed.data.tools[name];
      return [name, Object.freeze({ title: text.title, description: text.description })];
    })
  ) as Record<ConnectorToolName, ConnectorToolText>;
  return {
    ok: true,
    profile: Object.freeze({
      contract: contract.profile,
      tools: Object.freeze(tools),
      outsideFoundationNote: parsed.data.reviewNotes.outsideFoundation,
    }),
  };
}

/** Il profilo nella forma da salvare (colonna `profile`), dal profilo validato. */
export function storedConnectorProfile(profile: ConnectorProfile): Record<string, unknown> {
  return {
    contract: { ...profile.contract },
    tools: Object.fromEntries(CONNECTOR_TOOL_NAMES.map((name) => [name, { ...profile.tools[name] }])),
    reviewNotes: { outsideFoundation: profile.outsideFoundationNote },
  };
}

const PROFILE_CACHE_MAX = 32;
const profileCache = new Map<string, ConnectorProfileParseResult>();

/**
 * Il profilo salvato di un workspace, validato una volta per valore: lo stesso valore dà
 * lo stesso oggetto, così la rotta non ricostruisce gli schemi dei tool a ogni richiesta
 * (`connectorToolDefinitions` li tiene per profilo). Null o non valido → `ok: false`.
 */
export function connectorProfileFromStored(raw: unknown): ConnectorProfileParseResult {
  if (raw === null || raw === undefined) return { ok: false, fieldErrors: { profile: "Profilo non caricato." } };
  let key: string;
  try {
    key = JSON.stringify(raw);
  } catch {
    return { ok: false, fieldErrors: { profile: "Profilo non leggibile." } };
  }
  const cached = profileCache.get(key);
  if (cached) return cached;
  const result = parseConnectorProfile(raw);
  if (profileCache.size >= PROFILE_CACHE_MAX) profileCache.delete(profileCache.keys().next().value as string);
  profileCache.set(key, result);
  return result;
}

// ─── File dell'operatore ─────────────────────────────────────────────────────

/** Chiave del modello delle istruzioni nel file del profilo. */
export const PROFILE_FILE_TEMPLATE_KEY = "instructionsTemplate";

export type ConnectorProfileFileParseResult =
  | { ok: true; profile: ConnectorProfile; instructionsTemplate: string }
  | { ok: false; fieldErrors: Record<string, string> };

/**
 * Il file del profilo (`{ contract, tools, reviewNotes, instructionsTemplate }`): valida
 * le due parti e le separa. Errori con i nomi dei campi, mai i valori.
 */
export function parseConnectorProfileFile(input: unknown): ConnectorProfileFileParseResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, fieldErrors: { payload: "Serve un oggetto JSON." } };
  const { [PROFILE_FILE_TEMPLATE_KEY]: template, ...rest } = input as Record<string, unknown>;
  const fieldErrors: Record<string, string> = {};
  const profile = parseConnectorProfile(rest);
  if (!profile.ok) Object.assign(fieldErrors, profile.fieldErrors);
  const instructions = validateInstructionsTemplate(template);
  if (!instructions.ok) fieldErrors[PROFILE_FILE_TEMPLATE_KEY] = instructions.message;
  if (!profile.ok || !instructions.ok) return { ok: false, fieldErrors };
  return { ok: true, profile: profile.profile, instructionsTemplate: instructions.template };
}
