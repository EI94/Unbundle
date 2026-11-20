/**
 * `use-case-admin ci-keys --workspace <id>` (rilascio 8.2b, RILASCIO-8.2b-SPEC.md §2.8): le chiavi della CI del workspace,
 * con repository, prefisso, date e stato. Sola lettura. Mai la chiave, mai chi l'ha creata o revocata. Regole in
 * `src/lib/use-cases/admin/ci-keys.ts`.
 */
import { AdminStop, done, schemaMissing, type AdminCommand } from "../../src/lib/use-cases/admin/cli.ts";
import { CI_KEYS_SCHEMA_MESSAGE, ciKeyAdminLine } from "../../src/lib/use-cases/admin/ci-keys.ts";
import { CI_KEYS_TABLE } from "../../src/lib/db/use-case-hub-ci-keys-ddl.ts";
import { CI_KEYS_TABLE_SQL, ciKeyRowFrom, ciKeysAdminListSql } from "../../src/lib/db/queries/use-case-ci-keys.ts";

export const command: AdminCommand = {
  name: "ci-keys",
  readOnly: true,
  async run(ctx) {
    if (ctx.scope.kind !== "workspace") throw new AdminStop("opzioni", "Serve --workspace <uuid>: le chiavi sono di un workspace.");
    if ((await ctx.db.read(CI_KEYS_TABLE_SQL))[0]?.ok !== true) return schemaMissing(ctx.command, CI_KEYS_TABLE, CI_KEYS_SCHEMA_MESSAGE);
    const list = ciKeysAdminListSql(ctx.scope.workspaceId);
    const now = new Date();
    const keys = (await ctx.db.read(list.text, list.params)).map((row) => ciKeyAdminLine(ciKeyRowFrom(row), now));
    const live = keys.filter((k) => k.stato === "viva").length;
    return done({
      status: "REPORT",
      message: keys.length === 0 ? "Nessuna chiave della CI in questo workspace." : `${keys.length} ${keys.length === 1 ? "chiave" : "chiavi"} della CI, ${live} ${live === 1 ? "viva" : "vive"}.`,
      chiavi: keys,
    });
  },
};
