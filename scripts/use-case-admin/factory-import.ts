/**
 * `use-case-admin factory-import --workspace <id> --use-case <codice> --from <cartella del caso> [--apply …]`
 * (rilascio 8.0a): porta in Unbundle l'impostazione fatta a mano nella settimana zero, dalla cartella
 * `casi/<id>/` del repository della famiglia: il progetto approvato come versione 1, le decisioni, il pacchetto
 * fatto a mano come k1. Prova a secco predefinita; con `--apply` una sola transazione. Regole in
 * `src/lib/use-cases/admin/factory-import.ts`.
 */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { AdminStop, DRY_RUN_NOTE, done, schemaMissing, type AdminCommand } from "../../src/lib/use-cases/admin/cli.ts";
import {
  FACTORY_IMPORT_OPTIONS,
  FACTORY_IMPORT_SCHEMA_MESSAGE,
  FACTORY_IMPORT_SCHEMA_SQL,
  factoryImportPlan,
  factoryImportReads,
  packageFromFiles,
  parseDecisions,
  parseProjectMarkdown,
} from "../../src/lib/use-cases/admin/factory-import.ts";

const MAX_FILE_BYTES = 400_000;

function readText(path: string): string | null {
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return null;
  }
  if (size > MAX_FILE_BYTES) throw new AdminStop("file", `File troppo grande: ${path}`);
  return readFileSync(path, "utf8");
}

export const command: AdminCommand = {
  name: "factory-import",
  options: FACTORY_IMPORT_OPTIONS,
  async run(ctx) {
    if (ctx.scope.kind !== "workspace") throw new AdminStop("opzioni", "Serve --workspace <uuid>: l'import vale per uno use case di un workspace.");
    const code = ctx.value("use-case");
    if (!code || !/^[A-Z0-9][A-Z0-9-]{1,39}$/.test(code)) throw new AdminStop("opzioni", "Serve --use-case <codice> (per esempio TJ-0049).");
    const from = ctx.value("from");
    if (!from) throw new AdminStop("opzioni", "Serve --from <cartella del caso> (per esempio ../topjet-rosa/casi/tj-0049).");
    const projectText = readText(join(from, "progetto", "PROGETTO.md"));
    if (projectText === null) throw new AdminStop("file", "Manca progetto/PROGETTO.md nella cartella del caso.");
    const project = parseProjectMarkdown(projectText);
    const decisions = parseDecisions(readText(join(from, "progetto", "decisioni.md")) ?? "");
    const files = packageFromFiles((name) => readText(join(from, "unbundle", name)));

    const ok = (await ctx.db.read(FACTORY_IMPORT_SCHEMA_SQL))[0]?.ok === true;
    if (!ok) return schemaMissing(ctx.command, "use_case_projects, use_case_packages, use_case_decisions", FACTORY_IMPORT_SCHEMA_MESSAGE);
    const reads = factoryImportReads(ctx.scope.workspaceId, code);
    const [useCase] = await ctx.db.read(reads.useCase.text, reads.useCase.params);
    if (!useCase) throw new AdminStop("use_case", "Use case non trovato in questo workspace.", { useCase: code });
    const useCaseId = String(useCase.id);
    const existing = factoryImportReads(ctx.scope.workspaceId, code).existing(useCaseId);
    const [counts] = await ctx.db.read(existing.text, existing.params);
    const plan = factoryImportPlan({ workspaceId: ctx.scope.workspaceId, useCaseId, project, decisions, files });
    const report = { useCase: code, ...plan.report };
    if (Number(counts?.projects ?? 0) > 0 || Number(counts?.packages ?? 0) > 0 || Number(counts?.decisions ?? 0) > 0) {
      return done({ status: "NOTHING_TO_DO", message: "Lo use case ha già progetto, pacchetto o decisioni in Unbundle: l'import non scrive.", ...report });
    }
    if (!ctx.apply) return done({ status: "DRY_RUN", message: DRY_RUN_NOTE, ...report });
    ctx.print({ status: "PLAN", command: ctx.command, ...report });
    await ctx.db.write(plan.statements);
    return done({ status: "APPLIED", message: "Impostazione importata: progetto v1 approvato, decisioni e pacchetto k1.", ...report });
  },
};
