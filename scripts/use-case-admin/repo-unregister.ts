/**
 * `use-case-admin repo-unregister --workspace <id> --repo owner/nome [--use-case <codice>] [--apply …]` (rilascio 8.0c):
 * toglie la registrazione di un repository dai casi di un workspace, con le proposte da decidere che ne sono arrivate.
 * Solo l'operatore di Lateral Space (`USE_CASE_ADMIN_DATABASE_URL`). Prova a secco predefinita; con `--apply` una sola
 * transazione. Regole in `src/lib/use-cases/admin/repo-unregister.ts`.
 */
import { AdminStop, DRY_RUN_NOTE, done, schemaMissing, type AdminCommand } from "../../src/lib/use-cases/admin/cli.ts";
import {
  parseRepoOption,
  parseUseCaseCode,
  pendingProposalsSql,
  remainingRegistrationsSql,
  REPO_UNREGISTER_OPTIONS,
  REPO_UNREGISTER_SCHEMA_MESSAGE,
  REPO_UNREGISTER_SCHEMA_SQL,
  repoUnregisterPlan,
  repoUnregisterReads,
} from "../../src/lib/use-cases/admin/repo-unregister.ts";

export const command: AdminCommand = {
  name: "repo-unregister",
  options: REPO_UNREGISTER_OPTIONS,
  async run(ctx) {
    if (ctx.scope.kind !== "workspace") throw new AdminStop("opzioni", "Serve --workspace <uuid>: la registrazione si toglie dai casi di un workspace.");
    const workspaceId = ctx.scope.workspaceId;
    const repo = parseRepoOption(ctx.value("repo"));
    if (!repo) throw new AdminStop("opzioni", "Serve --repo owner/nome (per esempio Voltaen/nardi-esploso).");
    const rawCode = ctx.value("use-case");
    const code = rawCode === null ? null : parseUseCaseCode(rawCode);
    if (rawCode !== null && code === null) throw new AdminStop("opzioni", "--use-case vuole il codice di uno use case, per esempio NM-0009.");
    const schema = (await ctx.db.read(REPO_UNREGISTER_SCHEMA_SQL))[0];
    if (schema?.ok !== true) return schemaMissing(ctx.command, "use_case_repos", REPO_UNREGISTER_SCHEMA_MESSAGE);
    const reads = repoUnregisterReads(workspaceId, repo, code);
    const registrations = (await ctx.db.read(reads.registrations.text, reads.registrations.params)).map((row) => ({
      id: String(row.id),
      useCaseId: String(row.use_case_id),
      code: String(row.code ?? ""),
      folder: String(row.folder ?? ""),
    }));
    if (registrations.length === 0) {
      return done({ status: "NOTHING_TO_DO", message: `Questo repository non è registrato per i casi del workspace${code ? ` nello use case ${code}` : ""}.`, repository: repo });
    }
    const tables = { proposals: schema.proposals === true, factoryRepos: schema.factory_repos === true };
    const pending = tables.proposals ? pendingProposalsSql(workspaceId, repo, registrations.map((r) => r.useCaseId)) : null;
    const pendingProposals = pending ? Number((await ctx.db.read(pending.text, pending.params))[0]?.n ?? 0) : 0;
    const left = remainingRegistrationsSql(workspaceId, repo, registrations.map((r) => r.id));
    const remaining = Number((await ctx.db.read(left.text, left.params))[0]?.n ?? 0);
    const plan = repoUnregisterPlan({ workspaceId, repo, registrations, tables, pendingProposals, remaining });
    if (!ctx.apply) return done({ status: "DRY_RUN", message: DRY_RUN_NOTE, ...plan.report });
    ctx.print({ status: "PLAN", command: ctx.command, ...plan.report });
    await ctx.db.write(plan.statements);
    return done({ status: "APPLIED", message: "Registrazione tolta: gli eventi di GitHub di questo repository non arrivano più a questi casi.", ...plan.report });
  },
};
