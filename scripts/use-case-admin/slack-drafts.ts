/**
 * `use-case-admin slack-drafts` (docs/use-case/DESIGN.md §6.8 e §10.5): porta a `NULL` i testi
 * delle bozze di Slack già inviate, così «Oscura testo» non lascia copie. Non tocca le bozze in
 * corso. Regole in `src/lib/use-cases/admin/slack-drafts.ts`.
 */
import { DRY_RUN_NOTE, counted, done, schemaMissing, scopeQuery, type AdminCommand } from "../../src/lib/use-cases/admin/cli.ts";
import { SCHEMA_FACTS_SQL, SCHEMA_MESSAGES, schemaFactsFrom } from "../../src/lib/use-cases/admin/schema.ts";
import { CLEAR_SENT_DRAFTS_SQL, SLACK_DRAFT_TEXT_COLUMNS, countByWorkspace, sentDraftsSql } from "../../src/lib/use-cases/admin/slack-drafts.ts";

const CHUNK = 500;

export const command: AdminCommand = {
  name: "slack-drafts",
  async run(ctx) {
    const facts = schemaFactsFrom((await ctx.db.read(SCHEMA_FACTS_SQL))[0]);
    if (!facts.slackDrafts) return schemaMissing(ctx.command, "slack_use_case_drafts", SCHEMA_MESSAGES.slackDrafts);
    const scope = scopeQuery(ctx.scope);
    const drafts = (await ctx.db.read(sentDraftsSql(scope.withWorkspace), scope.params)).map((row) => ({
      id: String(row.id),
      workspaceId: String(row.workspace_id),
    }));
    const report = { bozze: drafts.length, perWorkspace: countByWorkspace(drafts), colonne: [...SLACK_DRAFT_TEXT_COLUMNS] };
    if (drafts.length === 0) return done({ status: "NOTHING_TO_DO", message: "Nessuna bozza inviata con dei testi.", ...report });
    if (!ctx.apply) return done({ status: "DRY_RUN", message: DRY_RUN_NOTE, ...report });
    ctx.print({ status: "PLAN", command: ctx.command, ...report });
    let cleared = 0;
    for (let i = 0; i < drafts.length; i += CHUNK) {
      const [rows = []] = await ctx.db.write([{ text: CLEAR_SENT_DRAFTS_SQL, params: [drafts.slice(i, i + CHUNK).map((d) => d.id)] }]);
      cleared += rows.length;
    }
    return done({ status: "APPLIED", message: `Testi tolti da ${counted(cleared, "bozza inviata", "bozze inviate")}.`, bozze: cleared });
  },
};
