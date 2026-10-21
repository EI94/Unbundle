/**
 * `use-case-admin dossier-links` (docs/use-case/DESIGN.md §10.9): una scheda madre per ogni
 * dossier completo senza scheda. Serve la 0020 (la scheda usa `origin`); senza tabelle uc non
 * c'è niente da fare. Regole e piano in `src/lib/use-cases/admin/dossier-links.ts`.
 *
 * Ogni dossier in una sola transazione: la scheda (senza proponente: `proposed_by` NULL) e il
 * collegamento in uno statement, poi il codice. Il dossier tiene il suo codice. Un dossier
 * collegato nel frattempo non riceve una seconda scheda: lo statement ricontrolla che sia ancora
 * completo e senza scheda.
 */
import { randomUUID } from "node:crypto";
import { ASSIGN_USE_CASE_CODE_SQL } from "../../src/lib/portfolio/use-case-code.ts";
import { DRY_RUN_NOTE, counted, done, plural, schemaMissing, scopeQuery, truncateTitle, type AdminCommand } from "../../src/lib/use-cases/admin/cli.ts";
import { MOTHER_CARD, orphanDossiersSql, orphanFrom, planDossierLinks } from "../../src/lib/use-cases/admin/dossier-links.ts";
import { SCHEMA_FACTS_SQL, SCHEMA_MESSAGES, schemaFactsFrom } from "../../src/lib/use-cases/admin/schema.ts";
import { ORIGIN_LABEL } from "../../src/lib/use-cases/labels.ts";

/** La scheda madre e il collegamento del dossier. `$1` dossier, `$2` nuova scheda, `$3` titolo, `$4` descrizione. */
const CREATE_AND_LINK_SQL = `WITH c AS (
  SELECT id, workspace_id FROM uc_cases
   WHERE id = $1::uuid AND setup_completed_at IS NOT NULL AND portfolio_use_case_id IS NULL
   FOR UPDATE
), card AS (
  INSERT INTO use_cases (id, workspace_id, title, description, portfolio_kind, status, origin, source, intake, proposed_by)
  SELECT $2::uuid, c.workspace_id, $3, $4, '${MOTHER_CARD.portfolioKind}', '${MOTHER_CARD.status}', '${MOTHER_CARD.origin}', '${MOTHER_CARD.source}',
         '${JSON.stringify(MOTHER_CARD.intake)}'::jsonb, NULL
    FROM c
  RETURNING id
)
UPDATE uc_cases u
   SET portfolio_use_case_id = card.id, updated_at = now()
  FROM card
 WHERE u.id = $1::uuid
RETURNING u.id AS case_id, u.workspace_id, card.id AS use_case_id`;

export const command: AdminCommand = {
  name: "dossier-links",
  async run(ctx) {
    const facts = schemaFactsFrom((await ctx.db.read(SCHEMA_FACTS_SQL))[0]);
    if (!facts.m0020) return schemaMissing(ctx.command, "0020", SCHEMA_MESSAGES.m0020);
    if (!facts.uc) return done({ status: "NOTHING_TO_DO", message: SCHEMA_MESSAGES.uc });

    const scope = scopeQuery(ctx.scope);
    const orphans = (await ctx.db.read(orphanDossiersSql(scope.withWorkspace), scope.params)).map(orphanFrom);
    const cards = planDossierLinks(orphans, randomUUID);
    const report = {
      dossier: cards.map((card) => ({ id: card.caseId, workspace: card.workspaceId, codiceDossier: card.caseCode, titolo: truncateTitle(card.title) })),
      ...(facts.dossierUniqueIndex ? {} : { attenzione: "Manca l'indice unico tra dossier e scheda: dossierLinksReady resta falso finché non c'è." }),
    };
    if (cards.length === 0) return done({ status: "NOTHING_TO_DO", message: "Ogni dossier completo ha la sua scheda.", ...report });
    if (!ctx.apply) {
      return done({
        status: "DRY_RUN",
        message: `${DRY_RUN_NOTE} Ogni dossier riceve una scheda «${ORIGIN_LABEL[MOTHER_CARD.origin].long}», approvata e nascosta alla ricerca, con il suo codice.`,
        ...report,
      });
    }
    ctx.print({ status: "PLAN", command: ctx.command, ...report });
    const linked: Array<{ dossier: string; scheda: string; codice: string | null }> = [];
    const skipped: string[] = [];
    for (const card of cards) {
      const [link = [], code = []] = await ctx.db.write([
        { text: CREATE_AND_LINK_SQL, params: [card.caseId, card.useCaseId, card.title, card.description] },
        { text: ASSIGN_USE_CASE_CODE_SQL, params: [card.workspaceId, card.useCaseId] },
      ]);
      if (link.length === 0) {
        skipped.push(card.caseId);
        continue;
      }
      linked.push({ dossier: card.caseId, scheda: card.useCaseId, codice: typeof code[0]?.code === "string" ? code[0].code : null });
    }
    const withoutCode = linked.filter((row) => row.codice === null).length;
    return done({
      status: "APPLIED",
      message: `${plural(linked.length, "Creata", "Create")} ${counted(linked.length, "scheda madre", "schede madri")}${
        skipped.length ? `, ${skipped.length} dossier ${plural(skipped.length, "saltato (collegato", "saltati (collegati")} nel frattempo)` : ""
      }${withoutCode ? `; ${withoutCode} senza codice: esegui configs e poi codes` : ""}.`,
      collegati: linked,
      saltati: skipped,
    });
  },
};
