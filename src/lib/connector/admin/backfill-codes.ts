/**
 * `connector-admin backfill-codes --workspace <id> [--limit <n>]` (prompt WP1, WP6 e WP8):
 * assegna il codice alle segnalazioni del workspace che non l'hanno (quelle nate prima
 * della riga del connettore, o un'assegnazione fallita), in ordine di invio
 * (`coalesce(submitted_at, created_at)`, poi id), con lo stesso statement dell'app
 * (`ASSIGN_USE_CASE_CODE_SQL`: contatore e codice insieme). Una riga per volta, ognuna nella
 * sua transazione: una ripresa continua da dove si era fermata.
 *
 * La prova a secco mostra il prefisso, il prossimo codice e l'elenco dei codici previsti
 * (con il titolo troncato a 60 caratteri): il prefisso si decide prima di scrivere
 * (`config`). Equivale a `use-case-admin codes` dell'hub per un solo workspace. Oltre
 * 99.999 codici per workspace si ferma e lo dice.
 */
import { ASSIGN_USE_CASE_CODE_SQL, USE_CASE_CODE_MAX_SEQ, formatUseCaseCode } from "../../portfolio/use-case-code.ts";
import { AdminStop, done, DRY_RUN_NOTE, truncateTitle, type AdminCommand } from "./cli.ts";
import { readWorkspace, requireConfigRow, requireSchema } from "./state.ts";

export const MISSING_CODES_SQL = `SELECT u.id::text AS id, u.title, u.source,
       to_char(coalesce(u.submitted_at, u.created_at), 'YYYY-MM') AS month
  FROM use_cases u
 WHERE u.workspace_id = $1::uuid AND u.code IS NULL
 ORDER BY coalesce(u.submitted_at, u.created_at), u.id`;

/** Righe mostrate al massimo nell'elenco della prova a secco. */
export const BACKFILL_LIST_MAX = 50;

export const command: AdminCommand = {
  name: "backfill-codes",
  options: { values: ["limit"] },
  async run(ctx) {
    await requireSchema(ctx.db);
    const rawLimit = ctx.value("limit");
    if (rawLimit !== null && !/^[1-9][0-9]{0,5}$/.test(rawLimit)) throw new AdminStop("limit", "--limit è un numero intero da 1 a 999999.");
    const workspace = await readWorkspace(ctx.db, ctx.workspaceId);
    const row = await requireConfigRow(ctx.db, ctx.workspaceId);
    const missing = await ctx.db.read(MISSING_CODES_SQL, [ctx.workspaceId]);
    const take = rawLimit === null ? missing.length : Math.min(missing.length, Number(rawLimit));
    const free = USE_CASE_CODE_MAX_SEQ - row.nextCodeSeq;
    const planned = missing.slice(0, take).map((r, i) => ({
      codice: row.nextCodeSeq + i + 1 <= USE_CASE_CODE_MAX_SEQ ? formatUseCaseCode(row.codePrefix, row.nextCodeSeq + i + 1) : null,
      id: String(r.id),
      titolo: truncateTitle(r.title),
      fonte: r.source === null || r.source === undefined ? null : String(r.source),
      mese: r.month === null || r.month === undefined ? null : String(r.month),
    }));
    const report = {
      workspace: { id: workspace.id, nome: workspace.name },
      prefisso: row.codePrefix,
      prossimoCodice: row.nextCodeSeq < USE_CASE_CODE_MAX_SEQ ? formatUseCaseCode(row.codePrefix, row.nextCodeSeq + 1) : null,
      senzaCodice: missing.length,
      daAssegnare: take,
      elenco: planned.slice(0, BACKFILL_LIST_MAX),
      ...(planned.length > BACKFILL_LIST_MAX ? { altre: planned.length - BACKFILL_LIST_MAX } : {}),
    };
    if (missing.length === 0) return done({ status: "NOTHING_TO_DO", message: "Ogni segnalazione del workspace ha già il codice.", ...report });
    if (take > free) {
      throw new AdminStop("oltre_99999", `Restano ${free} codici con il formato del contratto (fino a ${USE_CASE_CODE_MAX_SEQ}): ne servirebbero ${take}.`);
    }
    if (!ctx.apply) return done({ status: "DRY_RUN", message: `${DRY_RUN_NOTE} Controlla il prefisso: i codici assegnati non cambiano più.`, ...report });
    ctx.print({ status: "PLAN", command: ctx.command, ...report });
    const assigned: string[] = [];
    let skipped = 0;
    for (const item of planned) {
      // Ogni assegnazione è una transazione sua: una ripresa riparte dalle righe ancora senza codice.
      const [result = []] = await ctx.db.write([{ text: ASSIGN_USE_CASE_CODE_SQL, params: [ctx.workspaceId, item.id] }]);
      const code = result[0]?.code;
      if (typeof code === "string") assigned.push(code);
      else skipped++;
    }
    return done({
      status: "APPLIED",
      message: `${assigned.length} codici assegnati${skipped ? `, ${skipped} saltati (codice arrivato nel frattempo)` : ""}.`,
      assegnati: assigned.length,
      saltati: skipped,
      primo: assigned[0] ?? null,
      ultimo: assigned[assigned.length - 1] ?? null,
      restanoSenzaCodice: missing.length - assigned.length - skipped,
    });
  },
};
