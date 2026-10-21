/**
 * Lo schema che serve a ogni comando di `use-case-admin` (docs/use-case/DESIGN.md §10.5):
 * se manca, il comando si ferma e lo dice. Una sola lettura per tutti i fatti.
 *
 * - «0018»: le tabelle dei Casi d'uso (`uc_cases`).
 * - «0019» e «0020»: le stesse sonde del self-heal (`CONNECTOR_PROBE_SQL`,
 *   `USE_CASE_HUB_PROBE_SQL`), vere solo se c'è tutto il DDL della migrazione.
 *
 * Modulo puro: solo import relativi `.ts`.
 */
import { CONNECTOR_PROBE_SQL } from "../../db/connector-ddl.ts";
import { USE_CASE_HUB_PROBE_SQL } from "../../db/use-case-hub-ddl.ts";
import type { AdminRow } from "./cli.ts";

/** L'indice unico tra dossier e scheda (0020 e, con C11b, DDL uc; DESIGN §10.4). */
export const DOSSIER_UNIQUE_INDEX = "uc_cases_portfolio_use_case_unique_idx";

export interface SchemaFacts {
  /** Tabelle dei Casi d'uso (0018). */
  uc: boolean;
  /** Migrazione del connettore (0019). */
  m0019: boolean;
  /** Migrazione dell'hub (0020). */
  m0020: boolean;
  /** Indice unico tra dossier e scheda. */
  dossierUniqueIndex: boolean;
  /** `workspaces.ai_transformation_team_name`. */
  teamName: boolean;
  /** `slack_use_case_drafts`. */
  slackDrafts: boolean;
  /** `workspace_scoring_models`. */
  scoringModels: boolean;
}

const column = (table: string, name: string) => `EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = '${table}' AND column_name = '${name}'
  )`;

export const SCHEMA_FACTS_SQL = `SELECT
  to_regclass('public.uc_cases') IS NOT NULL AS uc,
  ${CONNECTOR_PROBE_SQL} AS m0019,
  ${USE_CASE_HUB_PROBE_SQL} AS m0020,
  to_regclass('public.${DOSSIER_UNIQUE_INDEX}') IS NOT NULL AS dossier_unique_index,
  ${column("workspaces", "ai_transformation_team_name")} AS team_name,
  to_regclass('public.slack_use_case_drafts') IS NOT NULL AS slack_drafts,
  to_regclass('public.workspace_scoring_models') IS NOT NULL AS scoring_models`;

export function schemaFactsFrom(row: AdminRow | undefined): SchemaFacts {
  const yes = (key: string) => row?.[key] === true;
  return {
    uc: yes("uc"),
    m0019: yes("m0019"),
    m0020: yes("m0020"),
    dossierUniqueIndex: yes("dossier_unique_index"),
    teamName: yes("team_name"),
    slackDrafts: yes("slack_drafts"),
    scoringModels: yes("scoring_models"),
  };
}

/** I messaggi quando manca lo schema. */
export const SCHEMA_MESSAGES = {
  m0019: "Manca la 0019 (drizzle/0019_connettore_mcp.sql): il comando si ferma.",
  m0020: "Manca la 0020 (drizzle/0020_use_case_hub.sql): il comando si ferma.",
  teamName: "Manca la colonna workspaces.ai_transformation_team_name: il comando si ferma.",
  slackDrafts: "Manca la tabella slack_use_case_drafts: il comando si ferma.",
  uc: "Tabelle dei Casi d'uso assenti: nessun dossier, niente da fare.",
} as const;
