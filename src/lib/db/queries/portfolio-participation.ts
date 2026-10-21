import { eq, sql } from "drizzle-orm";
import { db } from "..";
import { workspaceConnectorConfigs } from "../schema";
import { ensureDbSchema } from "../ensure-schema";
import {
  PARTICIPATION_SOURCES,
  summarizeParticipation,
  type AreaCount,
  type CompanyCount,
  type Participation,
} from "@/lib/portfolio/participation";

/**
 * Proposte del workspace contate in SQL per area e per società in una sola lettura
 * (`GROUPING SETS`): la query legge solo area, società e tipo, mai chi propone.
 * Contano le proposte della raccolta (`portfolio_kind` valorizzato) arrivate da un canale
 * in cui propone una persona (`PARTICIPATION_SOURCES`); restano fuori le archiviate (anche
 * i doppioni uniti a un'altra) e quelle nascoste ai colleghi (`intake.hiddenFromSearch`).
 */
export function participationCountsSql(workspaceId: string) {
  const sources = sql.join(
    PARTICIPATION_SOURCES.map((source) => sql`${source}`),
    sql`, `
  );
  return sql`SELECT grouping(p.area) AS by_company,
       p.area,
       p.company,
       count(*)::int AS proposals,
       (count(*) FILTER (WHERE p.kind = 'best_practice'))::int AS best_practices
  FROM (SELECT nullif(btrim(u.intake ->> 'area'), '') AS area,
               nullif(btrim(u.intake ->> 'company'), '') AS company,
               u.portfolio_kind AS kind
          FROM use_cases u
         WHERE u.workspace_id = ${workspaceId}
           AND u.portfolio_kind IS NOT NULL
           AND u.source IN (${sources})
           AND u.portfolio_review_status <> 'archived'
           AND coalesce(u.intake ->> 'hiddenFromSearch', '') <> 'true') p
 GROUP BY GROUPING SETS ((p.area), (p.company))`;
}

/**
 * «Partecipazione per area» della pagina «Raccolta & ranking»: solo etichette e numeri;
 * null se la guida del connettore non ha aree (la pagina allora non mostra la scheda).
 */
export async function getPortfolioParticipation(workspaceId: string): Promise<Participation | null> {
  await ensureDbSchema();
  const [counts, config] = await Promise.all([
    db.execute(participationCountsSql(workspaceId)),
    db
      .select({ guide: workspaceConnectorConfigs.guide })
      .from(workspaceConnectorConfigs)
      .where(eq(workspaceConnectorConfigs.workspaceId, workspaceId))
      .limit(1),
  ]);
  const text = (value: unknown) => (typeof value === "string" ? value : null);
  const areas: AreaCount[] = [];
  const companies: CompanyCount[] = [];
  for (const row of counts.rows as Array<Record<string, unknown>>) {
    if (Number(row.by_company) === 1) {
      companies.push({ company: text(row.company), proposals: Number(row.proposals) });
    } else {
      areas.push({ area: text(row.area), proposals: Number(row.proposals), bestPractices: Number(row.best_practices) });
    }
  }
  return summarizeParticipation({ areas, companies, guide: config[0]?.guide ?? null });
}
