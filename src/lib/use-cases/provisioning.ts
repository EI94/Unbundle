/**
 * Prerequisiti dell'area «Use case» per un workspace, scritti dall'app (docs/use-case/DESIGN.md
 * §10.5, §12.1, §12.2): ogni workspace, anche quelli creati da qui in avanti, è pronto per
 * l'area senza che l'operatore lanci gli script per lui.
 *
 * - **Riga di `workspace_connector_configs`** se manca, con `INSERT_CONFIGS_SQL` di
 *   `admin/configs.ts`: prefisso dal nome (`proposePrefix`, come `configs`), `enabled = false`,
 *   contatore a zero. Lo slug no: è quello di `slugForNewWorkspace` (nome più i primi 8
 *   caratteri dell'id), unico per costruzione. Chiunque può creare un workspace, quindi lo slug
 *   «pulito» (`intesa-sanpaolo`, `proposeSlug`) non lo prende mai l'app: resta all'operatore
 *   (`use-case-admin configs` per i workspace senza riga, `connector-admin config` per gli
 *   altri), e il workspace del cliente vero non si ritrova con `-2`. Il connettore non si
 *   accende mai da qui; una riga che c'è già non si tocca.
 * - **Modello di valutazione in v2**, solo se il workspace **non ha un modello** e non ha use
 *   case: quello di `scoring-v2` (`scoringModelConfigFor(2)`, `impact_flag_enabled = false`).
 *   Un modello che c'è già non si tocca mai, in qualunque versione: un v1 di prima (o un
 *   `scoring-v2 --revert`) resta all'operatore, e `doctor` lo dice. Così l'app non disfa un
 *   ritorno alla v1 e non cambia versione sotto una proposta valutata in quel momento.
 * - Origine, codici e dossier-links non chiedono niente a un workspace vuoto: `doctor` li trova
 *   già a posto (nessuna scheda senza origine o senza codice, nessun dossier orfano).
 *
 * Il primo modello creato altrove (`getOrCreateWorkspaceScoringModel`) segue la stessa regola:
 * `INITIAL_MODEL_SQL`, v2 per un workspace senza use case.
 *
 * Modulo puro: solo import relativi `.ts`; le query le esegue `src/lib/db/queries/use-case-provisioning.ts`.
 */
import { DEFAULT_SCORING_MODEL_CONFIG, scoringModelConfigFor } from "../db/use-case-scoring.ts";
import { INSERT_CONFIGS_SQL } from "./admin/configs.ts";
import { scoringVersionOf } from "./admin/doctor.ts";
import { proposePrefix, slugForNewWorkspace } from "./prefix.ts";

export { INSERT_CONFIGS_SQL };

/** Cosa manca al workspace. `$1` il workspace; nessuna riga se il workspace non c'è. */
export const PROVISION_FACTS_SQL = `SELECT w.id, w.name,
       EXISTS (SELECT 1 FROM workspace_connector_configs c WHERE c.workspace_id = w.id) AS has_config,
       EXISTS (SELECT 1 FROM workspace_scoring_models m WHERE m.workspace_id = w.id) AS has_model,
       (SELECT m.config -> 'scoringVersion' FROM workspace_scoring_models m WHERE m.workspace_id = w.id
         ORDER BY m.updated_at DESC LIMIT 1) AS scoring_version,
       EXISTS (SELECT 1 FROM use_cases u WHERE u.workspace_id = w.id) AS has_use_cases
  FROM workspaces w
 WHERE w.id = $1::uuid`;

/**
 * Il modello in v2, solo per un workspace senza modello e senza use case (lo ricontrolla lo
 * statement stesso). Un modello che c'è già non si tocca. `$1` il workspace, `$2`
 * `scoringModelConfigFor(2)`. Restituisce `creato_v2` o nessuna riga.
 */
export const PROVISION_MODEL_V2_SQL = `INSERT INTO workspace_scoring_models (workspace_id, impact_flag_enabled, config, updated_at)
SELECT $1::uuid, false, $2::jsonb, now()
 WHERE EXISTS (SELECT 1 FROM workspaces w WHERE w.id = $1::uuid)
   AND NOT EXISTS (SELECT 1 FROM use_cases u WHERE u.workspace_id = $1::uuid)
   AND NOT EXISTS (SELECT 1 FROM workspace_scoring_models m WHERE m.workspace_id = $1::uuid)
ON CONFLICT DO NOTHING
RETURNING 'creato_v2'::text AS esito`;

/**
 * Il primo modello di un workspace (`getOrCreateWorkspaceScoringModel`): v2 se il workspace non
 * ha use case, altrimenti il predefinito di sempre, senza `scoringVersion` (v1: passa alla v2
 * solo con `scoring-v2`). Niente se c'è già. `$1` il workspace, `$2` la config v1, `$3` la v2.
 */
export const INITIAL_MODEL_SQL = `INSERT INTO workspace_scoring_models (workspace_id, impact_flag_enabled, config, updated_at)
SELECT $1::uuid, false,
       CASE WHEN EXISTS (SELECT 1 FROM use_cases u WHERE u.workspace_id = $1::uuid) THEN $2::jsonb ELSE $3::jsonb END,
       now()
 WHERE NOT EXISTS (SELECT 1 FROM workspace_scoring_models m WHERE m.workspace_id = $1::uuid)
ON CONFLICT DO NOTHING`;

/** I parametri di `INITIAL_MODEL_SQL`. */
export function initialModelParams(workspaceId: string): [string, string, string] {
  return [workspaceId, JSON.stringify(DEFAULT_SCORING_MODEL_CONFIG), JSON.stringify(scoringModelConfigFor(2))];
}

/** I parametri di `PROVISION_MODEL_V2_SQL`. */
export function modelV2Params(workspaceId: string): [string, string] {
  return [workspaceId, JSON.stringify(scoringModelConfigFor(2))];
}

export interface ProvisionFacts {
  id: string;
  name: string;
  hasConfig: boolean;
  hasModel: boolean;
  scoringVersion: number;
  hasUseCases: boolean;
}

export function provisionFactsFrom(row: Record<string, unknown> | undefined): ProvisionFacts | null {
  if (!row) return null;
  return {
    id: String(row.id),
    name: typeof row.name === "string" ? row.name : "",
    hasConfig: row.has_config === true,
    hasModel: row.has_model === true,
    scoringVersion: row.has_model === true ? scoringVersionOf(row.scoring_version) : 1,
    hasUseCases: row.has_use_cases === true,
  };
}

/** Il modello da creare? Solo in un workspace senza modello e senza use case. */
export function needsModelV2(facts: ProvisionFacts): boolean {
  return !facts.hasUseCases && !facts.hasModel;
}

/**
 * Cosa dire del modello che c'è (o che manca con use case): `presente` se è in v2, altrimenti
 * `lasciato` (il passaggio alla v2 è di `scoring-v2`, e `doctor` lo dice).
 */
export function existingModelOutcome(facts: ProvisionFacts): "presente" | "lasciato" {
  return facts.hasModel && facts.scoringVersion === 2 ? "presente" : "lasciato";
}

/**
 * Niente più da fare qui per il workspace: la riga c'è, e c'è un modello (di qualunque
 * versione) oppure ci sono use case. Serve a non rileggere a ogni richiesta.
 */
export function isSettled(facts: ProvisionFacts): boolean {
  return facts.hasConfig && !needsModelV2(facts);
}

/**
 * La riga di config da creare dall'app: prefisso dal nome (`proposePrefix`, `UC` se non ne
 * esce uno valido) e slug di `slugForNewWorkspace`, unico senza leggere gli altri.
 */
export function planWorkspaceConfig(workspace: { id: string; name: string }): { workspaceId: string; slug: string; prefix: string } {
  return { workspaceId: workspace.id, slug: slugForNewWorkspace(workspace.name, workspace.id), prefix: proposePrefix(workspace.name) };
}

/** I parametri di `INSERT_CONFIGS_SQL` per una riga. */
export function insertConfigParams(row: { workspaceId: string; slug: string; prefix: string }): [string[], string[], string[]] {
  return [[row.workspaceId], [row.slug], [row.prefix]];
}
