/**
 * `use-case-admin ci-key-revoke --workspace <id> --repo owner/nome [--apply …]` (rilascio 8.2b, RILASCIO-8.2b-SPEC.md
 * §2.8): revoca da subito le chiavi della CI non revocate di un repository (`a_mano`, senza persona). Prova a secco
 * predefinita; con `--apply` e le conferme dell'operatore una sola transazione. Regole in
 * `src/lib/use-cases/admin/ci-keys.ts`.
 */
import { AdminStop, DRY_RUN_NOTE, done, schemaMissing, type AdminCommand } from "../../src/lib/use-cases/admin/cli.ts";
import { CI_KEY_REVOKE_NOTE, CI_KEY_REVOKE_OPTIONS, CI_KEYS_SCHEMA_MESSAGE, ciKeyAdminLine } from "../../src/lib/use-cases/admin/ci-keys.ts";
import { parseRepoOption } from "../../src/lib/use-cases/admin/repo-unregister.ts";
import { CI_KEYS_TABLE } from "../../src/lib/db/use-case-hub-ci-keys-ddl.ts";
import { CI_KEYS_TABLE_SQL, ciKeyAdminRevokeSql, ciKeyRowFrom, ciKeysAdminListSql } from "../../src/lib/db/queries/use-case-ci-keys.ts";

export const command: AdminCommand = {
  name: "ci-key-revoke",
  options: CI_KEY_REVOKE_OPTIONS,
  async run(ctx) {
    if (ctx.scope.kind !== "workspace") throw new AdminStop("opzioni", "Serve --workspace <uuid>: le chiavi sono di un workspace.");
    const workspaceId = ctx.scope.workspaceId;
    const repo = parseRepoOption(ctx.value("repo"));
    if (!repo) throw new AdminStop("opzioni", "Serve --repo owner/nome (per esempio Voltaen/esempio-rosa).");
    if ((await ctx.db.read(CI_KEYS_TABLE_SQL))[0]?.ok !== true) return schemaMissing(ctx.command, CI_KEYS_TABLE, CI_KEYS_SCHEMA_MESSAGE);
    const list = ciKeysAdminListSql(workspaceId);
    const now = new Date();
    const toRevoke = (await ctx.db.read(list.text, list.params))
      .map(ciKeyRowFrom)
      .filter((row) => row.repo.toLowerCase() === repo.toLowerCase() && row.revokedAt === null)
      .map((row) => ciKeyAdminLine(row, now));
    if (toRevoke.length === 0) return done({ status: "NOTHING_TO_DO", message: "Questo repository non ha chiavi della CI da revocare in questo workspace.", repository: repo });
    const report = { repository: repo, chiaviDaRevocare: toRevoke, nota: CI_KEY_REVOKE_NOTE };
    if (!ctx.apply) return done({ status: "DRY_RUN", message: DRY_RUN_NOTE, ...report });
    ctx.print({ status: "PLAN", command: ctx.command, ...report });
    const [revoked] = await ctx.db.write([ciKeyAdminRevokeSql(workspaceId, repo)]);
    return done({ status: "APPLIED", message: "Chiavi della CI revocate: la CI di questo repository non manda più le evals.", repository: repo, revocate: revoked.length });
  },
};
