/**
 * `use-case-admin codes [--limit <n>]` (docs/use-case/DESIGN.md §10.8): un codice a ogni scheda
 * che non ce l'ha. Serve la 0019. Una scheda per volta con `ASSIGN_USE_CASE_CODE_SQL`, lo
 * stesso statement dell'app: un'interruzione (o `--limit`) lascia codici consecutivi e il giro
 * dopo riprende dalle schede ancora senza codice. Equivale a `connector-admin backfill-codes`,
 * esteso a `--all`. Con la 0020 vuole prima `origin` (§10.7): un workspace con schede senza
 * codice e con l'origine da decidere si salta (uscita 1). Per contarle serve
 * `UC_LS_EMAIL_DOMAINS`, come in `origin` e `doctor`. Regole e piano in
 * `src/lib/use-cases/admin/codes.ts`.
 */
import { ASSIGN_USE_CASE_CODE_SQL } from "../../src/lib/portfolio/use-case-code.ts";
import { parseLsDomains } from "../../src/lib/uc/lateral-space.ts";
import { DRY_RUN_NOTE, counted, done, plural, schemaMissing, scopeQuery, stopped, type AdminCommand } from "../../src/lib/use-cases/admin/cli.ts";
import { CODES_STOP_REASON, CODE_COUNTER_SQL, codesWorkspacesSql, missingCodesSql, parseCodesLimit, planCodes } from "../../src/lib/use-cases/admin/codes.ts";
import { pendingOriginCount } from "../../src/lib/use-cases/admin/origin.ts";
import { SCHEMA_FACTS_SQL, SCHEMA_MESSAGES, schemaFactsFrom } from "../../src/lib/use-cases/admin/schema.ts";
import { readOriginCandidates } from "./origin.ts";

/** Quanti codici proposti si elencano per workspace. */
const LISTED_CODES = 50;

export const command: AdminCommand = {
  name: "codes",
  options: { values: ["limit"] },
  async run(ctx) {
    const limit = parseCodesLimit(ctx.value("limit"));
    if (!limit.ok) return stopped({ status: "ERROR", code: "opzioni", message: limit.message });
    const facts = schemaFactsFrom((await ctx.db.read(SCHEMA_FACTS_SQL))[0]);
    if (!facts.m0019) return schemaMissing(ctx.command, "0019", SCHEMA_MESSAGES.m0019);

    // Con la 0020 l'origine va decisa prima: le schede che `origin` deve ancora decidere, per workspace.
    const originPending = new Map<string, number>();
    if (facts.m0020) {
      const lsDomains = parseLsDomains(ctx.lsEmailDomains);
      if (lsDomains.length === 0) {
        return stopped({
          status: "ERROR",
          code: "uc_ls_email_domains",
          message: "Imposta UC_LS_EMAIL_DOMAINS nella shell: i codici aspettano l'origine, e senza nessun autore risulta di Lateral Space.",
        });
      }
      const candidates = await readOriginCandidates(ctx.db, ctx.scope, lsDomains, ctx.hubWorkspaces);
      // Solo le schede senza codice: quelle che il comando renderebbe cercabili.
      const byWorkspace = new Map<string, typeof candidates>();
      for (const row of candidates) if (row.code === null) byWorkspace.set(row.workspaceId, [...(byWorkspace.get(row.workspaceId) ?? []), row]);
      for (const [workspaceId, rows] of byWorkspace) originPending.set(workspaceId, pendingOriginCount(rows));
    }

    const scope = scopeQuery(ctx.scope);
    const workspaces = (await ctx.db.read(codesWorkspacesSql(scope.withWorkspace), scope.params)).map((row) => ({
      workspaceId: String(row.workspace_id),
      name: String(row.name),
      prefix: typeof row.code_prefix === "string" ? row.code_prefix : null,
      nextSeq: Number(row.next_code_seq ?? 0),
    }));
    const rows = (await ctx.db.read(missingCodesSql(scope.withWorkspace), scope.params)).map((row) => ({
      id: String(row.id),
      workspaceId: String(row.workspace_id),
    }));
    const plans = planCodes(workspaces, rows, originPending);
    const report = {
      workspaces: plans.map((plan) => ({
        workspace: plan.workspaceId,
        nome: plan.name,
        prefisso: plan.prefix,
        senzaCodice: plan.missing,
        ...(facts.m0020 ? { origineDaDecidere: plan.originPending } : {}),
        stop: plan.stop,
        // I primi codici, per controllo; il resto segue in ordine.
        codici: plan.proposed.slice(0, LISTED_CODES).map((p) => ({ id: p.id, codice: p.code })),
        ...(plan.proposed.length > LISTED_CODES ? { altri: plan.proposed.length - LISTED_CODES, ultimo: plan.proposed.at(-1)?.code } : {}),
      })),
      ...(facts.m0020
        ? {}
        : { attenzione: "Manca la 0020: l'origine non si può ancora decidere. Con il connettore acceso, assegna i codici dopo la 0020 e origin." }),
    };
    if (plans.length === 0) return done({ status: "NOTHING_TO_DO", message: "Ogni scheda dell'ambito ha già il suo codice.", ...report });
    if (!ctx.apply) {
      return done({ status: "DRY_RUN", message: `${DRY_RUN_NOTE} I codici a secco sono indicativi: il contatore può muoversi nel frattempo.`, ...report });
    }
    ctx.print({ status: "PLAN", command: ctx.command, ...report });

    const assigned: Array<{ id: string; codice: string }> = [];
    const stops: Array<{ workspace: string; motivo: string }> = [];
    let budget = limit.limit ?? Number.POSITIVE_INFINITY;
    for (const plan of plans) {
      if (plan.stop === "senza_config" || plan.stop === "origine_da_decidere") {
        stops.push({ workspace: plan.workspaceId, motivo: CODES_STOP_REASON[plan.stop] });
        continue;
      }
      for (const { id } of plan.proposed) {
        if (budget <= 0) break;
        const [result = []] = await ctx.db.write([{ text: ASSIGN_USE_CASE_CODE_SQL, params: [plan.workspaceId, id] }]);
        const code = result[0]?.code;
        if (typeof code === "string") {
          assigned.push({ id, codice: code });
          budget--;
          continue;
        }
        // Nessun codice: la scheda l'ha ricevuto nel frattempo, oppure il contatore è pieno.
        const [counter] = await ctx.db.read(CODE_COUNTER_SQL, [plan.workspaceId]);
        if (counter?.full === true) {
          stops.push({ workspace: plan.workspaceId, motivo: CODES_STOP_REASON.oltre_99999 });
          break;
        }
      }
      if (plan.stop === "oltre_99999" && !stops.some((s) => s.workspace === plan.workspaceId)) {
        stops.push({ workspace: plan.workspaceId, motivo: CODES_STOP_REASON.oltre_99999 });
      }
      if (budget <= 0) break;
    }
    const remaining = (await ctx.db.read(missingCodesSql(scope.withWorkspace), scope.params)).length;
    const output = {
      status: "APPLIED" as const,
      message: `${plural(assigned.length, "Assegnato", "Assegnati")} ${counted(assigned.length, "codice", "codici")}; ${counted(remaining, "scheda", "schede")} ${plural(remaining, "resta", "restano")} senza codice${remaining ? ": rilancia il comando per riprendere" : ""}.`,
      assegnati: assigned,
      fermi: stops,
      senzaCodice: remaining,
    };
    // Un workspace fermo (senza riga di config, origine da decidere, oltre 99.999) va guardato: uscita 1.
    return stops.length > 0 ? stopped(output) : done(output);
  },
};
