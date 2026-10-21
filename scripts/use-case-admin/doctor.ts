/**
 * `use-case-admin doctor` (docs/use-case/DESIGN.md §10.5 e §12.2): i controlli prima di
 * accendere l'area. Sola lettura: niente `--apply`, e ogni lettura in una transazione di sola
 * lettura. Verde (uscita 0) solo se passano tutti; altrimenti rosso (uscita 1), con il comando
 * che sistema ogni controllo. I doppioni contano con la stessa condizione della 0020. Controlli
 * in `src/lib/use-cases/admin/doctor.ts`.
 */
import { parseLsDomains } from "../../src/lib/uc/lateral-space.ts";
import { done, scopeQuery, stopped, type AdminCommand } from "../../src/lib/use-cases/admin/cli.ts";
import { evaluateDoctor, scoringVersionOf, type DoctorWorkspace } from "../../src/lib/use-cases/admin/doctor.ts";
import { DUPLICATE_CARDS_SQL } from "../../src/lib/use-cases/admin/dossier-dups.ts";
import { pendingOriginCount } from "../../src/lib/use-cases/admin/origin.ts";
import { SCHEMA_FACTS_SQL, schemaFactsFrom } from "../../src/lib/use-cases/admin/schema.ts";
import { readOriginCandidates } from "./origin.ts";

const filter = (withWorkspace: boolean, column: string) => (withWorkspace ? ` AND ${column} = $1::uuid` : "");

export const command: AdminCommand = {
  name: "doctor",
  readOnly: true,
  async run(ctx) {
    const facts = schemaFactsFrom((await ctx.db.read(SCHEMA_FACTS_SQL))[0]);
    const scope = scopeQuery(ctx.scope);
    const w = scope.withWorkspace;
    const workspaces = await ctx.db.read(`SELECT id, name FROM workspaces WHERE true${filter(w, "id")} ORDER BY created_at, id`, scope.params);

    let duplicateCards = 0;
    const orphanWorkspaces = new Set<string>();
    if (facts.uc) {
      const [dups] = await ctx.db.read(
        `SELECT count(DISTINCT c.portfolio_use_case_id)::int AS n FROM uc_cases c WHERE c.portfolio_use_case_id IN (${DUPLICATE_CARDS_SQL})${filter(w, "c.workspace_id")}`,
        scope.params,
      );
      duplicateCards = Number(dups?.n ?? 0);
      const orphans = await ctx.db.read(
        `SELECT DISTINCT c.workspace_id FROM uc_cases c WHERE c.setup_completed_at IS NOT NULL AND c.portfolio_use_case_id IS NULL${filter(w, "c.workspace_id")}`,
        scope.params,
      );
      for (const row of orphans) orphanWorkspaces.add(String(row.workspace_id));
    }

    const configured = new Set<string>();
    const missingCodes = new Map<string, number>();
    if (facts.m0019) {
      for (const row of await ctx.db.read(`SELECT workspace_id FROM workspace_connector_configs WHERE true${filter(w, "workspace_id")}`, scope.params)) {
        configured.add(String(row.workspace_id));
      }
      const counts = await ctx.db.read(
        `SELECT workspace_id, count(*)::int AS n FROM use_cases WHERE code IS NULL${filter(w, "workspace_id")} GROUP BY workspace_id`,
        scope.params,
      );
      for (const row of counts) missingCodes.set(String(row.workspace_id), Number(row.n));
    }

    const originPending = new Map<string, number>();
    if (facts.m0020) {
      const candidates = await readOriginCandidates(ctx.db, ctx.scope, parseLsDomains(ctx.lsEmailDomains), ctx.hubWorkspaces);
      const byWorkspace = new Map<string, typeof candidates>();
      for (const row of candidates) byWorkspace.set(row.workspaceId, [...(byWorkspace.get(row.workspaceId) ?? []), row]);
      for (const [workspaceId, rows] of byWorkspace) originPending.set(workspaceId, pendingOriginCount(rows));
    }

    const versions = new Map<string, number>();
    if (facts.scoringModels) {
      for (const row of await ctx.db.read(
        `SELECT workspace_id, config -> 'scoringVersion' AS version FROM workspace_scoring_models WHERE true${filter(w, "workspace_id")}`,
        scope.params,
      )) {
        versions.set(String(row.workspace_id), scoringVersionOf(row.version));
      }
    }

    const perWorkspace: DoctorWorkspace[] = workspaces.map((row) => {
      const id = String(row.id);
      return {
        id,
        name: String(row.name),
        config: facts.m0019 ? configured.has(id) : null,
        missingCodes: facts.m0019 ? (missingCodes.get(id) ?? 0) : null,
        originPending: facts.m0020 ? (originPending.get(id) ?? 0) : null,
        dossierLinksReady: facts.uc ? facts.dossierUniqueIndex && !orphanWorkspaces.has(id) : null,
        scoringVersion: versions.get(id) ?? 1,
      };
    });
    const result = evaluateDoctor({
      m0019: facts.m0019,
      m0020: facts.m0020,
      uc: facts.uc,
      duplicateCards,
      lsDomainsSet: parseLsDomains(ctx.lsEmailDomains).length > 0,
      workspaces: perWorkspace,
    });
    const output = {
      status: result.green ? ("GREEN" as const) : ("RED" as const),
      message: result.green ? "Tutti i controlli passano." : "Alcuni controlli non passano: vedi «controlli».",
      controlli: result.checks,
      workspaces: perWorkspace.map((ws) => ({
        workspace: ws.id,
        nome: ws.name,
        rigaConfig: ws.config,
        senzaCodice: ws.missingCodes,
        origineDaDecidere: ws.originPending,
        dossierLinksReady: ws.dossierLinksReady,
        scoringVersion: ws.scoringVersion,
      })),
    };
    return result.green ? done(output) : stopped(output);
  },
};
