import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { ensureDbSchema } from "@/lib/db/ensure-schema";
import { workspaceConnectorConfigs } from "@/lib/db/schema";
import { getOrCreateWorkspaceScoringModel, normalizeScoringConfig, type ScoringModelConfig } from "@/lib/db/queries/scoring-model";
import { getWorkspaceById, updateWorkspaceAiTransformationTeamName } from "@/lib/db/queries/workspaces";
import { logSafeError } from "@/lib/log/safe-error";
import { getCollaboratorAccess, type WorkspaceAccess } from "@/lib/workspace-access";
import { canManageWorkspaceSettings } from "@/lib/workspace-permissions";
import { costLowBandFrom, resolveCostBands, validateCostBands, type CostBandInfo, type CostBandsSource } from "./cost-bands";
import { proposePrefix, slugForNewWorkspace } from "./prefix";
import { isUseCaseHubWorkspace } from "./rollout";
import { SERVICE_MESSAGES } from "./service";
import {
  HIGH_IMPACT_ERROR,
  VALUATION_SETTINGS_TEXT,
  codePrefixNotes,
  costBandsToStore,
  isUuidText,
  midImpactAboveHighError,
  parseCodePrefix,
  parseTeamName,
  parseThresholds,
  type ThresholdsValue,
} from "./settings";
import type { ServiceResult } from "./types";
import { isMonthCode, resolveValueParams, type StoredValueParams, type ValueParams } from "./value-model";
import { parseValueParamsTexts } from "./value-params-form";

/**
 * Letture e scritture di Impostazioni › Valutazione (docs/use-case/DESIGN.md §7.2 «Fasce del
 * workspace», §7.6, §10.6, §14.2, §14.3; PIANO-LAVORI H3d).
 *
 * - **Chi**: solo chi gestisce il workspace (`canManageWorkspaceSettings`: `exec_sponsor`,
 *   `transformation_lead`), e solo con l'area accesa per il workspace (§12.1,
 *   `USE_CASE_HUB_WORKSPACES`; altrimenti `area_spenta`). Il ruolo si rilegge a ogni scrittura
 *   (`getCollaboratorAccess`): le server action sono raggiungibili con una POST diretta.
 * - **Soglie e fasce** stanno nel `config` grezzo di `workspace_scoring_models`. Ogni
 *   scrittura cambia solo la sua chiave (`thresholds.highImpact` e `thresholds.costLowBand`,
 *   che toglie la soglia in euro di prima, D18; oppure `costBands`) e riscrive il `config`
 *   intero in un solo
 *   statement, senza passare da `normalizeScoringConfig`: `scoringVersion`, `costKpiId` e
 *   ogni altra chiave restano come sono. Nessuna scrittura tocca `scoringVersion` (§7.6).
 * - **Un cambio di fasce non riscrive i dati salvati** (§7.2): nessuna scrittura su
 *   `use_cases`, nessuna riga di Storia, nessuna `version` che sale.
 * - **Un cambio di «Valore alto da» non cambia mai gli `overall_*`**: le soglie non entrano
 *   nel punteggio. Si riallinea solo `category` (calcolata nel database, §7.4), in v1 e in
 *   v2, dagli `overall_*` salvati e in un solo statement: niente lettura e poi scrittura
 *   scheda per scheda, che coprirebbe una valutazione salvata nel frattempo. Il ricalcolo di
 *   oggi (`recomputePortfolioMetricsByWorkspace`) non serve: riscriverebbe gli `overall_*`, e
 *   in v2 senza leggere `ai_suggestion` cancellerebbe il punteggio delle schede valutate solo
 *   dall'AI (§7.6). `category` e `updated_at` non fanno salire `version` (0020).
 * - **Il modulo del modello qui** (`prepareSettingsModelPayload`) non ha «Valore alto da» né
 *   «Fattibilità alta da»: partono quelli salvati, riletti a ogni salvataggio, mai quelli della
 *   pagina. Delle «Soglie» salvate mentre il modello si sta salvando vince quella riletta (il
 *   caso scoperto, nel commento della funzione).
 * - **Prefisso** (§10.6): `workspace_connector_configs.code_prefix`. I codici già assegnati
 *   non cambiano; il contatore continua. Un workspace senza la riga di D6 la riceve qui,
 *   spenta (`enabled = false`), con lo slug valido e unico per costruzione.
 * - Nei log solo nome e codice dell'errore (`logSafeError`), mai nomi o valori.
 */

const LOG_SCOPE = "use-case-settings";

export interface ValuationSettingsData {
  /** Il nome salvato dal workspace, vuoto se vale quello predefinito. */
  teamName: string;
  codes: {
    /** Il prefisso salvato, oppure quello proposto dal nome se la riga di D6 manca. */
    prefix: string;
    /** Vero se il workspace ha la riga di `workspace_connector_configs`. */
    saved: boolean;
    connectorEnabled: boolean;
  };
  thresholds: ThresholdsValue & { midImpact: number };
  /** Le 5 fasce del workspace (`resolveCostBands`): le sue, o le predefinite. */
  costBands: readonly CostBandInfo[];
  /** Vero se il workspace ha fasce sue in `config.costBands`. */
  customCostBands: boolean;
  /** Il modello per il modulo «Modello di valutazione» (normalizzato, come oggi). */
  scoringConfig: ScoringModelConfig;
  esgEnabled: boolean;
  /** «Ipotesi di calcolo» (`config.valueParams`), con i predefiniti dove mancano. */
  valueParams: ValueParams;
  /** Il primo mese della curva salvato; null se il workspace segue il mese corrente. */
  storedOriginMonth: string | null;
}

function rawObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Tutto ciò che la sezione mostra. Null se il workspace non esiste. */
export async function loadValuationSettings(workspaceId: string): Promise<ValuationSettingsData | null> {
  if (!isUuidText(workspaceId)) return null;
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) return null;
  await ensureDbSchema();
  const [model, [config]] = await Promise.all([
    getOrCreateWorkspaceScoringModel(workspaceId),
    db
      .select({ prefix: workspaceConnectorConfigs.codePrefix, enabled: workspaceConnectorConfigs.enabled })
      .from(workspaceConnectorConfigs)
      .where(eq(workspaceConnectorConfigs.workspaceId, workspaceId))
      .limit(1),
  ]);
  const rawConfig = model.config as CostBandsSource | null;
  return {
    teamName: workspace.aiTransformationTeamName?.trim() ?? "",
    codes: {
      prefix: config?.prefix ?? proposePrefix(workspace.name),
      saved: Boolean(config),
      connectorEnabled: config?.enabled === true,
    },
    thresholds: {
      highImpact: model.resolvedConfig.thresholds.highImpact,
      midImpact: model.resolvedConfig.thresholds.midImpact,
      // D18: la fascia salvata, oppure quella che contiene la soglia in euro di prima.
      costLowBand: costLowBandFrom(rawObject(rawConfig).thresholds, resolveCostBands(rawConfig)),
    },
    costBands: resolveCostBands(rawConfig),
    customCostBands: rawObject(rawConfig).costBands !== undefined && rawObject(rawConfig).costBands !== null,
    scoringConfig: model.resolvedConfig,
    esgEnabled: workspace.esgEnabled === true,
    valueParams: resolveValueParams(model.config),
    storedOriginMonth: storedOriginMonth(model.config),
  };
}

/** Il primo mese della curva salvato in `config.valueParams.originMonth`, se è un mese. */
function storedOriginMonth(config: unknown): string | null {
  const month = rawObject(rawObject(config).valueParams).originMonth;
  return isMonthCode(month) ? month : null;
}

// ─── Scritture ───────────────────────────────────────────────────────

type Denied = Extract<ServiceResult<never>, { ok: false }>;

function denied(): Denied {
  return { ok: false, error: "permesso_mancante", message: VALUATION_SETTINGS_TEXT.denied };
}

function invalid(fieldErrors: Record<string, string>): Denied {
  return { ok: false, error: "dati_non_validi", message: VALUATION_SETTINGS_TEXT.invalid, fieldErrors };
}

function retry(): Denied {
  return { ok: false, error: "riprova", message: VALUATION_SETTINGS_TEXT.failed };
}

function areaOff(): Denied {
  return { ok: false, error: "area_spenta", message: SERVICE_MESSAGES.area_spenta };
}

/**
 * Chi scrive, se l'area è accesa per il workspace e chi chiama lo gestisce (ruolo riletto
 * ora); altrimenti il rifiuto. Un id che non è un UUID non arriva al database.
 */
async function managerAccess(userId: string, workspaceId: string): Promise<{ ok: true; access: WorkspaceAccess } | Denied> {
  if (!isUuidText(userId) || !isUuidText(workspaceId)) return denied();
  if (!isUseCaseHubWorkspace(workspaceId)) return areaOff();
  const access = await getCollaboratorAccess(userId, workspaceId);
  return access && canManageWorkspaceSettings(access.role) ? { ok: true, access } : denied();
}

/** «Nome del team che valuta» (D2). Vuoto salva `NULL`: vale il nome predefinito. */
export async function saveReviewTeamName(userId: string, workspaceId: string, raw: unknown): Promise<ServiceResult<{ teamName: string | null }>> {
  const guard = await managerAccess(userId, workspaceId);
  if (!guard.ok) return guard;
  const parsed = parseTeamName(raw);
  if (!parsed.ok) return invalid({ teamName: parsed.error });
  try {
    await updateWorkspaceAiTransformationTeamName(workspaceId, parsed.value);
    return { ok: true, value: { teamName: parsed.value } };
  } catch (error) {
    logSafeError(LOG_SCOPE, "team_name_failed", error);
    return retry();
  }
}

export interface CodePrefixSaved {
  prefix: string;
  connectorEnabled: boolean;
  /** Gli avvisi da mostrare (§10.6): con il connettore acceso, anche quello dei due prefissi. */
  notes: string[];
}

/**
 * «Codici degli use case › Prefisso» (D6, §10.6). Cambia solo `code_prefix`: i codici già
 * assegnati e il contatore restano. Senza la riga di D6 (di solito c'è già: la scrivono
 * `createWorkspace` e il layout, `src/lib/use-cases/provisioning.ts`) la crea spenta, con lo
 * slug di `slugForNewWorkspace` (dal nome più gli 8 caratteri dell'id), lo stesso dei
 * prerequisiti: unico per costruzione, quindi l'upsert di un solo statement non urta mai un
 * altro slug.
 */
export async function saveCodePrefix(userId: string, workspaceId: string, raw: unknown): Promise<ServiceResult<CodePrefixSaved>> {
  const guard = await managerAccess(userId, workspaceId);
  if (!guard.ok) return guard;
  const parsed = parseCodePrefix(raw);
  if (!parsed.ok) return invalid({ prefix: parsed.error });
  try {
    await ensureDbSchema();
    const { rows } = await db.execute(sql`INSERT INTO workspace_connector_configs (workspace_id, slug, code_prefix, enabled, next_code_seq, updated_by)
      VALUES (${workspaceId}::uuid, ${slugForNewWorkspace(guard.access.workspace.name, workspaceId)}, ${parsed.value}, false, 0, ${userId}::uuid)
      ON CONFLICT (workspace_id) DO UPDATE
        SET code_prefix = EXCLUDED.code_prefix, updated_at = now(), updated_by = EXCLUDED.updated_by
      RETURNING code_prefix, enabled`);
    const row = rows[0] as { code_prefix?: unknown; enabled?: unknown } | undefined;
    if (!row) return retry();
    const connectorEnabled = row.enabled === true;
    return { ok: true, value: { prefix: String(row.code_prefix), connectorEnabled, notes: codePrefixNotes(connectorEnabled) } };
  } catch (error) {
    logSafeError(LOG_SCOPE, "code_prefix_failed", error);
    return retry();
  }
}

/** Il `config` di partenza di ogni scrittura: quello della riga se è un oggetto, altrimenti `{}`. */
const BASE_CONFIG = sql`CASE WHEN jsonb_typeof(config) = 'object' THEN config ELSE '{}'::jsonb END`;

/** Tentativi del salvataggio delle soglie quando un altro salvataggio cambia il `config` nel frattempo. */
const THRESHOLDS_ATTEMPTS = 3;

/** La riga ha ancora il `config` letto: la condizione dell'UPDATE che lo sostituisce. */
function sameConfig(config: unknown) {
  return config === null || config === undefined ? sql`config IS NULL` : sql`config = ${JSON.stringify(config)}::jsonb`;
}

/**
 * «Valore alto da» e «Costo basso fino alla fascia» (§14.3, D18). Cambia solo le due chiavi di
 * `config.thresholds` e toglie la soglia in euro di prima (`costLowMaxEur`): la fascia la
 * sostituisce. Le altre soglie (`midImpact`, `highFeasibility`) e ogni altra chiave del
 * `config` restano.
 *
 * Il controllo («Valore alto da» non sotto il valore medio) e il confronto con il valore di
 * prima valgono per il `config` che l'UPDATE sostituisce: l'UPDATE passa solo se la riga ha
 * ancora il `config` letto; altrimenti (un altro salvataggio nel frattempo) si rilegge e si
 * controlla di nuovo. Se «Valore alto da» cambia, `refreshCategories`.
 */
export async function saveThresholds(userId: string, workspaceId: string, input: unknown): Promise<ServiceResult<ThresholdsValue>> {
  const guard = await managerAccess(userId, workspaceId);
  if (!guard.ok) return guard;
  for (let attempt = 0; attempt < THRESHOLDS_ATTEMPTS; attempt++) {
    let model;
    try {
      model = await getOrCreateWorkspaceScoringModel(workspaceId);
    } catch (error) {
      logSafeError(LOG_SCOPE, "thresholds_read_failed", error);
      return retry();
    }
    const previous = model.resolvedConfig.thresholds;
    const parsed = parseThresholds(input, { midImpact: previous.midImpact });
    if (!parsed.ok) return invalid(parsed.fieldErrors);
    const patch = JSON.stringify(parsed.value);
    let written: unknown;
    try {
      const { rows } = await db.execute(sql`UPDATE workspace_scoring_models
           SET config = jsonb_set(
                 ${BASE_CONFIG},
                 '{thresholds}',
                 (CASE WHEN jsonb_typeof(config -> 'thresholds') = 'object' THEN config -> 'thresholds' ELSE '{}'::jsonb END - 'costLowMaxEur') || ${patch}::jsonb,
                 true),
               updated_by_user_id = ${userId}::uuid,
               updated_at = now()
         WHERE workspace_id = ${workspaceId}::uuid AND ${sameConfig(model.config)}
         RETURNING config`);
      if (!rows.length) continue;
      written = (rows[0] as { config?: unknown }).config;
    } catch (error) {
      logSafeError(LOG_SCOPE, "thresholds_failed", error);
      return retry();
    }
    if (parsed.value.highImpact !== previous.highImpact) {
      try {
        await refreshCategories(workspaceId, written);
      } catch (error) {
        // Le soglie sono salvate: `category` si riallinea al prossimo ricalcolo.
        logSafeError(LOG_SCOPE, "thresholds_recompute_failed", error);
      }
    }
    return { ok: true, value: parsed.value };
  }
  return retry();
}

/** Un valore del `config` come parametro `jsonb`: `NULL` se la chiave manca. */
function jsonbParam(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

/**
 * `category` dopo un cambio di «Valore alto da», con la versione del punteggio del `config`
 * appena scritto (`scoringVersion`: v2 solo se vale 2, altrimenti v1). Solo `category`, in un
 * solo UPDATE, dagli `overall_*` della riga al momento dell'UPDATE: gli `overall_*` non
 * cambiano (le soglie non entrano nel punteggio), e una valutazione salvata mentre questo
 * riallineamento aspetta resta intera, con la `category` dei suoi punteggi.
 * - Quali schede: in v1 i contributi (`portfolio_kind` non nullo), come il ricalcolo di oggi;
 *   in v2 tutte le schede del workspace, come il ricalcolo v2.
 * - Come: il quadrante di oggi con le soglie del `config` scritto, con una dimensione senza
 *   punteggio sotto ogni soglia (§7.4, §7.6). Il confronto è sul valore salvato (`real`).
 * - Se nel frattempo un altro salvataggio ha cambiato una delle soglie che decidono `category`
 *   («Valore alto da», «Fattibilità alta da», «Valore medio da») o la versione del punteggio,
 *   non scrive niente: vale il riallineamento di quel salvataggio. «Costo basso fino alla fascia» non
 *   decide `category`: un salvataggio che cambia solo quello (e quindi non si riallinea) non
 *   ferma questo.
 */
async function refreshCategories(workspaceId: string, written: unknown): Promise<void> {
  const stored = rawObject(written);
  const v2 = stored.scoringVersion === 2;
  const { highImpact, highFeasibility, midImpact } = normalizeScoringConfig(stored).thresholds;
  const raw = rawObject(stored.thresholds);
  const impact = sql`COALESCE(overall_impact_score, 0)`;
  const feasibility = sql`COALESCE(overall_feasibility_score, 0)`;
  const category = sql`(CASE
      WHEN ${impact} >= ${highImpact}::real AND ${feasibility} >= ${highFeasibility}::real THEN 'quick_win'
      WHEN ${impact} >= ${highImpact}::real THEN 'strategic_bet'
      WHEN ${impact} >= ${midImpact}::real THEN 'capability_builder'
      ELSE 'not_yet'
    END)::use_case_category`;
  await db.execute(sql`UPDATE use_cases
       SET category = ${category}, updated_at = now()
     WHERE workspace_id = ${workspaceId}::uuid
       ${v2 ? sql.empty() : sql`AND portfolio_kind IS NOT NULL`}
       AND category IS DISTINCT FROM ${category}
       AND EXISTS (
         SELECT 1 FROM workspace_scoring_models m
          WHERE m.workspace_id = ${workspaceId}::uuid
            AND m.config -> 'scoringVersion' IS NOT DISTINCT FROM ${jsonbParam(stored.scoringVersion)}::jsonb
            AND m.config -> 'thresholds' -> 'highImpact' IS NOT DISTINCT FROM ${jsonbParam(raw.highImpact)}::jsonb
            AND m.config -> 'thresholds' -> 'highFeasibility' IS NOT DISTINCT FROM ${jsonbParam(raw.highFeasibility)}::jsonb
            AND m.config -> 'thresholds' -> 'midImpact' IS NOT DISTINCT FROM ${jsonbParam(raw.midImpact)}::jsonb
       )`);
}

/**
 * Il `payload` del modulo «Modello di valutazione» di questa sezione, pronto per
 * `updateScoringModelAction`. Il modulo manda KPI, pesi e «Valore medio da»; «Valore alto da»
 * e «Fattibilità alta da» non sono suoi campi, e partono quelli salvati, riletti ora: un'altra
 * scheda del browser, o un altro manager, con la pagina di prima non riporta indietro le
 * «Soglie» salvate prima di questa lettura (un valore mandato con una POST diretta si ignora).
 * «Valore medio da» si controlla con il «Valore alto da» salvato, con un errore in italiano
 * sotto il campo. Non scrive niente.
 *
 * Resta scoperto un caso: «Soglie» salvate tra questa lettura e l'UPDATE di
 * `upsertWorkspaceScoringModel`, pochi round trip dopo. Il `payload` porta le due soglie lette
 * qui, e `updateScoringModelAction` le riscrive: vince quella letta. Chiuderlo vuol dire non
 * mandare «Valore alto da» e «Fattibilità alta da» nel patch e rifare il controllo di «Valore
 * medio da» dentro il ciclo dell'upsert, sul `config` che si sostituisce: sono file di H3a
 * (`src/lib/actions/portfolio.ts`, `src/lib/db/queries/scoring-model.ts`).
 */
export async function prepareSettingsModelPayload(userId: string, workspaceId: string, raw: unknown): Promise<ServiceResult<{ payload: string }>> {
  const guard = await managerAccess(userId, workspaceId);
  if (!guard.ok) return guard;
  let form: unknown = null;
  try {
    form = typeof raw === "string" ? JSON.parse(raw) : null;
  } catch {
    form = null;
  }
  if (!form || typeof form !== "object" || Array.isArray(form)) {
    return { ok: false, error: "dati_non_validi", message: VALUATION_SETTINGS_TEXT.failed };
  }
  let saved: ScoringModelConfig["thresholds"];
  try {
    saved = (await getOrCreateWorkspaceScoringModel(workspaceId)).resolvedConfig.thresholds;
  } catch (error) {
    logSafeError(LOG_SCOPE, "model_read_failed", error);
    return retry();
  }
  const thresholds = rawObject((form as Record<string, unknown>).thresholds);
  const midImpact = thresholds.midImpact;
  if (typeof midImpact !== "number" || !Number.isFinite(midImpact) || midImpact < 0 || midImpact > 5) {
    return invalid({ "thresholds.midImpact": HIGH_IMPACT_ERROR });
  }
  if (midImpact > saved.highImpact) return invalid({ "thresholds.midImpact": midImpactAboveHighError(saved.highImpact) });
  const payload = { ...form, thresholds: { ...thresholds, highImpact: saved.highImpact, highFeasibility: saved.highFeasibility } };
  return { ok: true, value: { payload: JSON.stringify(payload) } };
}

/**
 * «Fasce del costo» (D15, §7.2). Valida con `validateCostBands` e cambia solo
 * `config.costBands`: le fasce uguali alle predefinite tolgono la chiave. Non scrive mai su
 * `use_cases`: importi e fasce già salvati restano, e si rileggono con le fasce nuove.
 */
export async function saveCostBands(
  userId: string,
  workspaceId: string,
  input: unknown,
): Promise<ServiceResult<{ costBands: readonly CostBandInfo[]; custom: boolean }>> {
  const guard = await managerAccess(userId, workspaceId);
  if (!guard.ok) return guard;
  const checked = validateCostBands(input);
  if (!checked.ok) return invalid(checked.fieldErrors);
  const stored = costBandsToStore(checked.value);
  try {
    await getOrCreateWorkspaceScoringModel(workspaceId);
    const config =
      stored === null ? sql`${BASE_CONFIG} - 'costBands'` : sql`jsonb_set(${BASE_CONFIG}, '{costBands}', ${JSON.stringify(stored)}::jsonb, true)`;
    const { rows } = await db.execute(sql`UPDATE workspace_scoring_models
         SET config = ${config}, updated_by_user_id = ${userId}::uuid, updated_at = now()
       WHERE workspace_id = ${workspaceId}::uuid
       RETURNING id`);
    if (!rows.length) return retry();
  } catch (error) {
    logSafeError(LOG_SCOPE, "cost_bands_failed", error);
    return retry();
  }
  return { ok: true, value: { costBands: resolveCostBands({ costBands: stored ?? undefined }), custom: stored !== null } };
}

/**
 * «Ipotesi di calcolo» (`config.valueParams`): solo chi gestisce il workspace. Valida i testi dei
 * campi con `parseValueParamsTexts` (gli stessi limiti di `valueParamsSchema`) e sostituisce
 * solo la chiave `valueParams` del `config`, in un solo statement: soglie, fasce, modello e
 * `scoringVersion` restano. Non scrive su `use_cases`: valore e costo si ricalcolano in lettura.
 */
export async function saveValueParams(
  userId: string,
  workspaceId: string,
  input: unknown,
): Promise<ServiceResult<{ valueParams: ValueParams; storedOriginMonth: string | null }>> {
  const guard = await managerAccess(userId, workspaceId);
  if (!guard.ok) return guard;
  const parsed = parseValueParamsTexts(input);
  if (!parsed.ok) return invalid(parsed.fieldErrors);
  const stored: StoredValueParams = parsed.value;
  try {
    await getOrCreateWorkspaceScoringModel(workspaceId);
    const { rows } = await db.execute(sql`UPDATE workspace_scoring_models
         SET config = jsonb_set(${BASE_CONFIG}, '{valueParams}', ${JSON.stringify(stored)}::jsonb, true),
             updated_by_user_id = ${userId}::uuid,
             updated_at = now()
       WHERE workspace_id = ${workspaceId}::uuid
       RETURNING config`);
    if (!rows.length) return retry();
    const config = (rows[0] as { config?: unknown }).config;
    return { ok: true, value: { valueParams: resolveValueParams(config), storedOriginMonth: storedOriginMonth(config) } };
  } catch (error) {
    logSafeError(LOG_SCOPE, "value_params_failed", error);
    return retry();
  }
}
