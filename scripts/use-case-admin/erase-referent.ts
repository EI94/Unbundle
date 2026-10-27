/**
 * `use-case-admin erase-referent --workspace <id> --contact <id> [--apply …]` (SPEC §3.10): cancella i
 * dati di un referente raccolti con «Chiedi al referente» (richieste revocate, risposte senza testo,
 * file segnati cancellati, link revocati, email in coda annullate; la riga del referente anonimizzata
 * se la usa solo l'hub). Prova a secco predefinita; con `--apply` una sola transazione. Gli oggetti
 * dei file li cancella il cron dei referenti. Regole in `src/lib/use-cases/admin/erase-referent.ts`.
 */
import { AdminStop, DRY_RUN_NOTE, done, schemaMissing, type AdminCommand } from "../../src/lib/use-cases/admin/cli.ts";
import {
  ERASE_REFERENT_OPTIONS,
  ERASE_REFERENT_SCHEMA_MESSAGE,
  ERASE_REFERENT_SCHEMA_SQL,
  eraseReferentPlan,
  eraseReferentReads,
} from "../../src/lib/use-cases/admin/erase-referent.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const command: AdminCommand = {
  name: "erase-referent",
  options: ERASE_REFERENT_OPTIONS,
  async run(ctx) {
    if (ctx.scope.kind !== "workspace") throw new AdminStop("opzioni", "Serve --workspace <uuid>: la cancellazione vale per un referente di un workspace.");
    const workspaceId = ctx.scope.workspaceId;
    const contactId = ctx.value("contact");
    if (!contactId || !UUID.test(contactId)) throw new AdminStop("opzioni", "Serve --contact <uuid> (l'id del referente in uc_contacts).");
    const ok = (await ctx.db.read(ERASE_REFERENT_SCHEMA_SQL))[0]?.ok === true;
    if (!ok) return schemaMissing(ctx.command, "use_case_referent_requests, uc_contacts", ERASE_REFERENT_SCHEMA_MESSAGE);
    const reads = eraseReferentReads(workspaceId, contactId);
    const [contact] = await ctx.db.read(reads.contact.text, reads.contact.params);
    if (!contact) throw new AdminStop("referente", "Referente non trovato in questo workspace.", { contact: contactId });
    const hubOnly = (await ctx.db.read(reads.hubOnly.text, reads.hubOnly.params))[0]?.hub_only === true;
    const useCaseIds = (await ctx.db.read(reads.useCases.text, reads.useCases.params)).map((row) => String(row.use_case_id));
    const requests = (await ctx.db.read(reads.requests.text, reads.requests.params)).length;
    const plan = eraseReferentPlan(workspaceId, contactId, { hubOnly, anonymized: contact.anonymized === true, useCaseIds, requests });
    const report = { contact: contactId, ...plan.report };
    if (requests === 0 && !plan.anonymizeContact) return done({ status: "NOTHING_TO_DO", message: "Nessuna richiesta di questo referente negli use case.", ...report });
    if (!ctx.apply) return done({ status: "DRY_RUN", message: DRY_RUN_NOTE, ...report });
    ctx.print({ status: "PLAN", command: ctx.command, ...report });
    await ctx.db.write(plan.statements);
    return done({ status: "APPLIED", message: "Dati del referente cancellati negli use case.", ...report });
  },
};
