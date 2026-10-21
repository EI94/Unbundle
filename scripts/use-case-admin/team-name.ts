/**
 * `use-case-admin team-name` (docs/use-case/DESIGN.md §10.5 e §14.2): elenca i workspace con il
 * nome del team «AI Transformation», che collide con l'etichetta d'origine. Non scrive mai:
 * Pierpaolo decide se cambiarli da Impostazioni.
 */
import { done, schemaMissing, scopeQuery, type AdminCommand } from "../../src/lib/use-cases/admin/cli.ts";
import { SCHEMA_FACTS_SQL, SCHEMA_MESSAGES, schemaFactsFrom } from "../../src/lib/use-cases/admin/schema.ts";
import { LEGACY_TEAM_NAME, isLegacyTeamName, teamNamesSql } from "../../src/lib/use-cases/admin/team-name.ts";

export const command: AdminCommand = {
  name: "team-name",
  readOnly: true,
  async run(ctx) {
    const facts = schemaFactsFrom((await ctx.db.read(SCHEMA_FACTS_SQL))[0]);
    if (!facts.teamName) return schemaMissing(ctx.command, "workspaces.ai_transformation_team_name", SCHEMA_MESSAGES.teamName);
    const scope = scopeQuery(ctx.scope);
    const rows = await ctx.db.read(teamNamesSql(scope.withWorkspace), scope.params);
    const colliding = rows.filter((row) => isLegacyTeamName(row.team_name)).map((row) => ({ workspace: String(row.id), nome: String(row.name) }));
    return done({
      status: "REPORT",
      message: colliding.length
        ? `${colliding.length} workspace con il nome del team «${LEGACY_TEAM_NAME}»: decidi se cambiarlo da Impostazioni. Il comando non scrive.`
        : `Nessun workspace con il nome del team «${LEGACY_TEAM_NAME}».`,
      workspaces: colliding,
    });
  },
};
