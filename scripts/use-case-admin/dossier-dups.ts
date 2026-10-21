/**
 * `use-case-admin dossier-dups [--detach <caseId>[,<caseId>…]]` (docs/use-case/DESIGN.md §10.4
 * punto 1). Gira prima della 0020: legge e scrive solo `uc_cases`. Senza tabelle uc non fa
 * nulla. Regole e piano in `src/lib/use-cases/admin/dossier-dups.ts`.
 */
import { DRY_RUN_NOTE, counted, done, plural, scopeQuery, stopped, type AdminCommand, type AdminContext } from "../../src/lib/use-cases/admin/cli.ts";
import {
  DELETE_STALE_INCOMPLETE_SQL,
  DETACH_COMPLETE_SQL,
  describeGroups,
  dossierRowFrom,
  duplicateRowsSql,
  groupDuplicates,
  parseDetachList,
  planDossierDups,
} from "../../src/lib/use-cases/admin/dossier-dups.ts";
import { SCHEMA_FACTS_SQL, SCHEMA_MESSAGES, schemaFactsFrom } from "../../src/lib/use-cases/admin/schema.ts";

/** «Resta 1 scheda con più dossier», «Restano 2 schede con più dossier». */
const remaining = (n: number) => `${plural(n, "Resta", "Restano")} ${counted(n, "scheda", "schede")} con più dossier`;

async function readGroups(ctx: AdminContext) {
  const scope = scopeQuery(ctx.scope);
  const rows = await ctx.db.read(duplicateRowsSql(scope.withWorkspace), scope.params);
  return groupDuplicates(rows.map(dossierRowFrom));
}

export const command: AdminCommand = {
  name: "dossier-dups",
  options: { values: ["detach"] },
  async run(ctx) {
    const detach = parseDetachList(ctx.value("detach"));
    if (!detach.ok) return stopped({ status: "ERROR", code: "opzioni", message: detach.message });
    const facts = schemaFactsFrom((await ctx.db.read(SCHEMA_FACTS_SQL))[0]);
    if (!facts.uc) return done({ status: "NOTHING_TO_DO", message: SCHEMA_MESSAGES.uc });

    const groups = await readGroups(ctx);
    const planned = planDossierDups(groups, detach.ids);
    if (!planned.ok) return stopped({ status: "ERROR", code: "detach", message: planned.message });
    const plan = planned.plan;
    const summary = {
      gruppi: plan.groups.length,
      daCancellare: plan.deletions.length,
      daStaccare: plan.detaches.length,
      gruppiCheRestano: plan.unresolved,
    };
    const report = { riepilogo: summary, gruppi: describeGroups(plan) };
    if (plan.groups.length === 0) {
      return done({ status: "NOTHING_TO_DO", message: "Nessun doppione: la 0020 può creare l'indice unico.", ...report });
    }
    if (!ctx.apply) {
      return done({
        status: "DRY_RUN",
        message: `${DRY_RUN_NOTE} I dossier staccati ricevono la scheda madre con dossier-links, dopo la 0020.`,
        ...report,
      });
    }
    if (plan.deletions.length === 0 && plan.detaches.length === 0) {
      return done({
        status: "NOTHING_TO_DO",
        message: `Niente da cancellare o staccare. ${remaining(plan.unresolved)}: scegli con --detach quale staccare, o aspetta le creazioni in corso.`,
        ...report,
      });
    }
    ctx.print({ status: "PLAN", command: ctx.command, ...report });
    const [detached = [], deleted = []] = await ctx.db.write([
      // Prima si stacca, finché la scheda ha ancora il doppione; poi si cancellano le incomplete.
      { text: DETACH_COMPLETE_SQL, params: [plan.detaches] },
      { text: DELETE_STALE_INCOMPLETE_SQL, params: [plan.deletions] },
    ]);
    const after = await readGroups(ctx);
    return done({
      status: "APPLIED",
      message:
        after.length === 0
          ? "Nessun doppione rimasto: la 0020 può creare l'indice unico."
          : `${remaining(after.length)}: scegli con --detach quale staccare, o aspetta le creazioni in corso.`,
      staccati: detached.map((row) => String(row.id)),
      cancellati: deleted.map((row) => String(row.id)),
      gruppiRimasti: after.length,
    });
  },
};
