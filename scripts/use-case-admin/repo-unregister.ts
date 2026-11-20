/**
 * `use-case-admin repo-unregister --workspace <id> --repo owner/nome [--use-case <codice>] [--apply …]` (rilascio 8.0c):
 * toglie la registrazione di un repository dai casi di un workspace, con le proposte da decidere che ne sono arrivate;
 * le sue pull request aperte si segnano chiuse e i loro compiti in revisione tornano in corso. Solo l'operatore di
 * Lateral Space (`USE_CASE_ADMIN_DATABASE_URL`). Prova a secco predefinita; con `--apply` una sola transazione. Regole
 * in `src/lib/use-cases/admin/repo-unregister.ts`.
 */
import { AdminStop, DRY_RUN_NOTE, done, schemaMissing, type AdminCommand } from "../../src/lib/use-cases/admin/cli.ts";
import { unrevokedKeysOfRepoSql } from "../../src/lib/db/queries/use-case-ci-keys.ts";
import {
  openPullRequestsSql,
  parseRepoOption,
  parseUseCaseCode,
  pendingProposalsSql,
  remainingRegistrationsSql,
  REPO_UNREGISTER_OPTIONS,
  REPO_UNREGISTER_SCHEMA_MESSAGE,
  REPO_UNREGISTER_SCHEMA_SQL,
  repoUnregisterOutcome,
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
    if (!repo) throw new AdminStop("opzioni", "Serve --repo owner/nome (per esempio Voltaen/alfa-esploso).");
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
    const tables = { proposals: schema.proposals === true, factoryRepos: schema.factory_repos === true, pullRequests: schema.pull_requests === true, ciKeys: schema.ci_keys === true };
    const useCaseIds = registrations.map((r) => r.useCaseId);
    const pending = tables.proposals ? pendingProposalsSql(workspaceId, repo, useCaseIds) : null;
    const pendingProposals = pending ? Number((await ctx.db.read(pending.text, pending.params))[0]?.n ?? 0) : 0;
    const open = tables.pullRequests ? openPullRequestsSql(workspaceId, repo, useCaseIds) : null;
    const openRow = open ? (await ctx.db.read(open.text, open.params))[0] : undefined;
    const left = remainingRegistrationsSql(workspaceId, repo, registrations.map((r) => r.id));
    const remaining = Number((await ctx.db.read(left.text, left.params))[0]?.n ?? 0);
    // (8.2b) Le chiavi della CI del repository: si revocano se non gli restano casi nel workspace.
    const keys = tables.ciKeys ? unrevokedKeysOfRepoSql(workspaceId, repo) : null;
    const unrevokedCiKeys = keys ? Number((await ctx.db.read(keys.text, keys.params))[0]?.n ?? 0) : 0;
    const plan = repoUnregisterPlan({
      workspaceId,
      repo,
      registrations,
      tables,
      pendingProposals,
      openPullRequests: Number(openRow?.n ?? 0),
      tasksInReview: Number(openRow?.tasks ?? 0),
      remaining,
      unrevokedCiKeys,
    });
    if (!ctx.apply) return done({ status: "DRY_RUN", message: DRY_RUN_NOTE, ...plan.report });
    ctx.print({ status: "PLAN", command: ctx.command, ...plan.report });
    // I conteggi veri, dalla transazione: tra il piano e la scrittura può essere arrivato un evento di GitHub.
    const outcome = repoUnregisterOutcome(plan, await ctx.db.write(plan.statements));
    return done({
      status: "APPLIED",
      message: "Registrazione tolta: gli eventi di GitHub di questo repository non arrivano più a questi casi.",
      ...plan.report,
      ...outcome,
    });
  },
};
