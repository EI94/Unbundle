/**
 * `use-case-admin reschema --workspace <id> --case <codice>[,<codice>…] --to dal_caso|<templateId> [--actor <userId>] [--apply …]`
 * (docs/dossier/SCHEMA-DI-PARTENZA.md, R4): dossier in Bozza che passano a un altro schema di partenza, di solito
 * «Dal caso d'uso». Stessa funzione di «Cambia schema di partenza» in Impostazioni (`reschemaCase` di
 * `src/lib/db/queries/uc-reschema.ts`): stessi controlli, stesse voci che bloccano, stesso evento nello storico.
 *
 * - A secco (predefinito): per ogni dossier il piano (schema di adesso e di dopo, voci adesso e dopo) e le voci che
 *   bloccano, in transazioni di sola lettura; nessuna scrittura, nemmeno la riga dello schema «Dal caso d'uso».
 * - Con `--apply` (e le conferme dello smistatore) serve `--actor <userId>`: la persona di Lateral Space che compare
 *   nello storico. Ogni dossier è una transazione; un dossier bloccato o già con quello schema non si tocca e si dice.
 * - Mai titoli delle voci nell'uscita: solo chiavi, id e motivi (l'uscita può finire in un registro).
 */
import { AdminStop, DRY_RUN_NOTE, done, type AdminCommand, type AdminContext } from "../../src/lib/use-cases/admin/cli.ts";
import { planReschema, reschemaCase, type ReschemaPlan, type ReschemaTarget } from "../../src/lib/db/queries/uc-reschema.ts";
import { FROM_USE_CASE_ALIAS } from "../../src/lib/uc/template/from-use-case.ts";
import { schemaBlockReasons } from "../../src/lib/uc/views/case-settings.ts";
import type { UcExecutor } from "../../src/lib/db/uc-executor.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[A-Z0-9][A-Z0-9-]{1,39}$/;

/** L'esecutore dei moduli uc sopra il database dell'operatore: a secco una lettura per istruzione, con --apply un'unica transazione. */
function executorFor(ctx: AdminContext, write: boolean): UcExecutor {
  return {
    async batch(statements) {
      if (write) return (await ctx.db.write(statements)) as never;
      const out = [];
      for (const s of statements) out.push(await ctx.db.read(s.text, s.params));
      return out as never;
    },
  };
}

function report(plan: ReschemaPlan) {
  return {
    code: plan.code,
    caseId: plan.caseId,
    stato: plan.status,
    da: `${plan.from.key} ${plan.from.version}`,
    a: `${plan.to.key} ${plan.to.version}`,
    stessoSchema: plan.same,
    vociAdesso: plan.itemsNow,
    vociDopo: plan.itemsAfter,
    bloccano: plan.blockers.map((b) => ({ itemId: b.itemId, key: b.key, motivi: b.reasons, perche: schemaBlockReasons(b.reasons) })),
  };
}

export const command: AdminCommand = {
  name: "reschema",
  options: { values: ["case", "to", "actor"] },
  async run(ctx) {
    if (ctx.scope.kind !== "workspace") throw new AdminStop("opzioni", "Serve --workspace <uuid>: i dossier sono di un workspace.");
    const workspaceId = ctx.scope.workspaceId;
    const codes = (ctx.value("case") ?? "").split(",").map((c) => c.trim()).filter(Boolean);
    if (codes.length === 0 || codes.some((c) => !CODE.test(c))) throw new AdminStop("opzioni", "Serve --case <codice>[,<codice>…], per esempio XX-0001.");
    const rawTo = ctx.value("to");
    const to: ReschemaTarget | null = rawTo === FROM_USE_CASE_ALIAS ? FROM_USE_CASE_ALIAS : rawTo && UUID.test(rawTo) ? { templateId: rawTo.toLowerCase() } : null;
    if (!to) throw new AdminStop("opzioni", `Serve --to ${FROM_USE_CASE_ALIAS} oppure --to <id dello schema>.`);
    const actor = ctx.value("actor");
    if (actor !== null && !UUID.test(actor)) throw new AdminStop("opzioni", "--actor vuole l'id (uuid) di una persona.");
    if (ctx.apply && !actor) throw new AdminStop("opzioni", "Con --apply serve --actor <userId>: chi cambia lo schema compare nello storico.");
    if (ctx.apply && actor) {
      const found = await ctx.db.read(`SELECT 1 AS ok FROM users WHERE id = $1::uuid`, [actor]);
      if (found.length === 0) throw new AdminStop("opzioni", "--actor: persona non trovata.");
    }

    const rows = await ctx.db.read(`SELECT id, code FROM uc_cases WHERE workspace_id = $1::uuid AND code = ANY($2::text[])`, [workspaceId, codes]);
    const idOf = new Map(rows.map((r) => [String(r.code), String(r.id)]));
    const missing = codes.filter((c) => !idOf.has(c));
    if (missing.length) throw new AdminStop("dossier", `Dossier non trovati nel workspace: ${missing.join(", ")}.`);

    const reader = executorFor(ctx, false);
    const plans: ReturnType<typeof report>[] = [];
    const stops: { code: string; esito: string; messaggio: string }[] = [];
    for (const code of codes) {
      const planned = await planReschema(reader, { workspaceId, caseId: idOf.get(code)!, to, readOnly: true });
      if (!planned.ok) {
        stops.push({ code, esito: planned.code, messaggio: planned.message });
        continue;
      }
      plans.push(report(planned.value));
      if (planned.value.status !== "bozza") stops.push({ code, esito: "non_in_bozza", messaggio: "Non è in «Bozza»: non si cambia." });
      else if (planned.value.blockers.length > 0) stops.push({ code, esito: "bloccato", messaggio: `${planned.value.blockers.length} voci bloccano: decide il titolare.` });
    }
    if (!ctx.apply) return done({ status: "DRY_RUN", message: DRY_RUN_NOTE, piani: plans, fermi: stops });

    ctx.print({ status: "PLAN", command: ctx.command, piani: plans, fermi: stops });
    const writer = executorFor(ctx, true);
    const results: { code: string; esito: string; vociDopo?: number; messaggio?: string }[] = [];
    for (const code of codes) {
      if (stops.some((s) => s.code === code)) {
        results.push({ code, esito: "saltato" });
        continue;
      }
      const changed = await reschemaCase(writer, { workspaceId, caseId: idOf.get(code)!, actorUserId: actor!, to });
      if (!changed.ok) results.push({ code, esito: changed.code, messaggio: changed.message });
      else results.push({ code, esito: changed.value.changed ? "cambiato" : "già_così", vociDopo: changed.value.plan.itemsAfter });
    }
    const failed = results.some((r) => r.esito !== "cambiato" && r.esito !== "già_così" && r.esito !== "saltato");
    return { output: { status: failed ? "ERROR" : "APPLIED", message: "Fatto: ogni dossier è una transazione.", risultati: results, fermi: stops }, exitCode: failed ? 1 : 0 };
  },
};
