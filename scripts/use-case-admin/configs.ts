/**
 * `use-case-admin configs [--prefixes prefixes.json]` (docs/use-case/DESIGN.md §10.6, D6): le
 * righe mancanti di `workspace_connector_configs`. Serve la 0019. Non tocca le righe esistenti.
 * Regole e piano in `src/lib/use-cases/admin/configs.ts`.
 */
import { DRY_RUN_NOTE, counted, done, plural, schemaMissing, scopeQuery, stopped, type AdminCommand } from "../../src/lib/use-cases/admin/cli.ts";
import {
  EXISTING_CONFIGS_SQL,
  INSERT_CONFIGS_SQL,
  parsePrefixesFile,
  planConfigs,
  workspacesSql,
} from "../../src/lib/use-cases/admin/configs.ts";
import { SCHEMA_FACTS_SQL, SCHEMA_MESSAGES, schemaFactsFrom } from "../../src/lib/use-cases/admin/schema.ts";

export const command: AdminCommand = {
  name: "configs",
  options: { values: ["prefixes"] },
  async run(ctx) {
    const facts = schemaFactsFrom((await ctx.db.read(SCHEMA_FACTS_SQL))[0]);
    if (!facts.m0019) return schemaMissing(ctx.command, "0019", SCHEMA_MESSAGES.m0019);

    const file = ctx.value("prefixes");
    let prefixes = new Map<string, string>();
    if (file !== null) {
      const parsed = parsePrefixesFile(ctx.readJsonFile(file));
      if (!parsed.ok) return stopped({ status: "ERROR", code: "prefixes", message: parsed.message });
      prefixes = parsed.prefixes;
    }
    const scope = scopeQuery(ctx.scope);
    const workspaces = (await ctx.db.read(workspacesSql(scope.withWorkspace), scope.params)).map((row) => ({
      id: String(row.id),
      name: String(row.name),
    }));
    const existing = (await ctx.db.read(EXISTING_CONFIGS_SQL)).map((row) => ({
      workspaceId: String(row.workspace_id),
      slug: String(row.slug),
      codePrefix: String(row.code_prefix),
    }));
    const planned = planConfigs(workspaces, existing, prefixes);
    if (!planned.ok) return stopped({ status: "ERROR", code: "prefixes", message: planned.message });
    const plan = planned.plan;
    const report = {
      daCreare: plan.create.map((row) => ({ workspace: row.workspaceId, nome: row.name, prefisso: row.prefix, da: row.prefixFrom, slug: row.slug })),
      esistenti: plan.existing.map((row) => ({ workspace: row.workspaceId, nome: row.name, prefisso: row.codePrefix, slug: row.slug })),
    };
    if (plan.create.length === 0) {
      return done({ status: "NOTHING_TO_DO", message: "Ogni workspace dell'ambito ha già la sua riga.", ...report });
    }
    if (!ctx.apply) {
      return done({
        status: "DRY_RUN",
        message: `${DRY_RUN_NOTE} Correggi i prefissi in un file per --prefixes prima di --apply; con il connettore, prima dei codici.`,
        ...report,
      });
    }
    ctx.print({ status: "PLAN", command: ctx.command, ...report });
    const [inserted = []] = await ctx.db.write([
      {
        text: INSERT_CONFIGS_SQL,
        params: [plan.create.map((row) => row.workspaceId), plan.create.map((row) => row.slug), plan.create.map((row) => row.prefix)],
      },
    ]);
    const created = new Set(inserted.map((row) => String(row.workspace_id)));
    const skipped = plan.create.filter((row) => !created.has(row.workspaceId)).map((row) => row.workspaceId);
    const rows = `${plural(created.size, "Creata", "Create")} ${counted(created.size, "riga", "righe")}`;
    return done({
      status: "APPLIED",
      message: skipped.length
        ? `${rows}; ${skipped.length} ${plural(skipped.length, "saltata", "saltate")} (riga o slug nati nel frattempo): rilancia a secco.`
        : `${rows}, con enabled = false.`,
      create: [...created],
      saltate: skipped,
    });
  },
};
