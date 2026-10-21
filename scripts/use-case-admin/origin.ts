/**
 * `use-case-admin origin [--decisions origin.json]` (docs/use-case/DESIGN.md §10.7): origine e
 * «nascosta alla ricerca» dei dati esistenti. Serve la 0020 e `UC_LS_EMAIL_DOMAINS`;
 * `USE_CASE_HUB_WORKSPACES` e `USE_CASE_HUB_EXCLUDE` (facoltative, come su Vercel; `*` = ogni
 * workspace del database) tolgono dalla lista le proposte dal web che il servizio dell'hub ha già
 * deciso. Regole e piano in `src/lib/use-cases/admin/origin.ts`.
 *
 * **Autore risolto** (il solo punto dello script che legge chi ha proposto, art. 15.4):
 * `proposed_by` è un'email oppure un id utente (`lib/actions/portfolio.ts`,
 * `session.user.email ?? session.user.id`). Un'email vale com'è; un id si legge in
 * `users.email`. Il dominio si confronta, dentro il database, con `UC_LS_EMAIL_DOMAINS`
 * (`parseLsDomains`): dalla query esce solo «si», «no» o «non_risolto», mai l'email. Id di
 * Slack ed etichette («AI Readiness respondent») non si risolvono. Nessun ordinamento,
 * raggruppamento o conteggio per persona.
 */
import { parseLsDomains } from "../../src/lib/uc/lateral-space.ts";
import { DRY_RUN_NOTE, counted, done, plural, schemaMissing, scopeQuery, stopped, truncateTitle, type AdminCommand, type AdminDb, type AdminScope, type AdminStatement } from "../../src/lib/use-cases/admin/cli.ts";
import {
  APPLY_ORIGIN_SQL,
  CONFIRM_ORIGIN_SQL,
  HUB_ONLY_SOURCES,
  ORIGIN_UNDECIDED_SQL,
  describeOriginItems,
  parseOriginDecisions,
  planOrigin,
  type LsAuthor,
  type OriginRow,
} from "../../src/lib/use-cases/admin/origin.ts";
import { SCHEMA_FACTS_SQL, SCHEMA_MESSAGES, schemaFactsFrom } from "../../src/lib/use-cases/admin/schema.ts";
import type { Origin } from "../../src/lib/use-cases/types.ts";

/** Un indirizzo email ben formato (come lo legge `emailDomain`). */
const EMAIL_RE = String.raw`^[^@\s]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$`;
/** Un id utente: solo allora si legge `users`, per chiave primaria. */
const UUID_RE = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";

/** Parametri: `$1` workspace (facoltativo), poi i domini di Lateral Space e i workspace con l'area accesa. */
function candidatesSql(withWorkspace: boolean): string {
  const domains = withWorkspace ? "$2" : "$1";
  const hub = withWorkspace ? "$3" : "$2";
  return `SELECT u.id, u.workspace_id, u.code, u.title, u.source,
       coalesce(u.intake -> 'hiddenFromSearch' = 'true'::jsonb, false) AS hidden,
       CASE
         WHEN a.email IS NULL THEN 'non_risolto'
         WHEN split_part(a.email, '@', 2) = ANY(${domains}::text[]) THEN 'si'
         ELSE 'no'
       END AS author
  FROM use_cases u
  LEFT JOIN LATERAL (
    SELECT CASE WHEN r.raw ~ '${EMAIL_RE}' THEN r.raw END AS email
      FROM (SELECT CASE
                     WHEN position('@' IN coalesce(u.proposed_by, '')) > 0 THEN lower(btrim(u.proposed_by))
                     WHEN lower(btrim(u.proposed_by)) ~ '${UUID_RE}'
                       THEN (SELECT lower(btrim(usr.email)) FROM users usr WHERE usr.id = lower(btrim(u.proposed_by))::uuid)
                   END AS raw) r
  ) a ON true
 WHERE u.origin = 'adoption'
   AND coalesce(u.source, '') NOT IN (${HUB_ONLY_SOURCES.map((source) => `'${source}'`).join(", ")})
   AND NOT (u.source = 'web_proposed' AND u.workspace_id = ANY(${hub}::uuid[])
            AND EXISTS (SELECT 1 FROM use_case_events c WHERE c.use_case_id = u.id AND c.action = 'creato'))
   AND ${ORIGIN_UNDECIDED_SQL}${withWorkspace ? "\n   AND u.workspace_id = $1::uuid" : ""}
 ORDER BY u.workspace_id, coalesce(u.submitted_at, u.created_at), u.id`;
}

const AUTHORS: readonly string[] = ["si", "no", "non_risolto"];

/**
 * Le schede ancora `adoption` e senza decisione sull'origine, con l'autore già risolto: senza le
 * fonti dell'hub e, nei workspace di `hubWorkspaces`, senza le proposte dal web nate dopo la
 * 0020. La usano anche `doctor` e `codes` (schede con l'origine da decidere). Vuole la 0020.
 */
export async function readOriginCandidates(
  db: AdminDb,
  scope: AdminScope,
  lsDomains: readonly string[],
  hubWorkspaces: Iterable<string> = [],
): Promise<OriginRow[]> {
  const query = scopeQuery(scope);
  const rows = await db.read(candidatesSql(query.withWorkspace), [...query.params, [...lsDomains], [...hubWorkspaces]]);
  return rows.map((row) => ({
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    code: typeof row.code === "string" ? row.code : null,
    title: truncateTitle(row.title),
    source: typeof row.source === "string" ? row.source : null,
    hidden: row.hidden === true,
    author: (AUTHORS.includes(String(row.author)) ? String(row.author) : "non_risolto") as LsAuthor,
  }));
}

const CHUNK = 100;

export const command: AdminCommand = {
  name: "origin",
  options: { values: ["decisions"] },
  async run(ctx) {
    const facts = schemaFactsFrom((await ctx.db.read(SCHEMA_FACTS_SQL))[0]);
    if (!facts.m0020) return schemaMissing(ctx.command, "0020", SCHEMA_MESSAGES.m0020);
    const lsDomains = parseLsDomains(ctx.lsEmailDomains);
    if (lsDomains.length === 0) {
      return stopped({
        status: "ERROR",
        code: "uc_ls_email_domains",
        message: "Imposta UC_LS_EMAIL_DOMAINS nella shell: senza, nessun autore risulta di Lateral Space.",
      });
    }
    const file = ctx.value("decisions");
    let decisions = new Map<string, Origin>();
    if (file !== null) {
      const parsed = parseOriginDecisions(ctx.readJsonFile(file));
      if (!parsed.ok) return stopped({ status: "ERROR", code: "decisions", message: parsed.message });
      decisions = parsed.decisions;
    }
    const rows = await readOriginCandidates(ctx.db, ctx.scope, lsDomains, ctx.hubWorkspaces);
    const planned = planOrigin(rows, decisions);
    if (!planned.ok) return stopped({ status: "ERROR", code: "decisions", message: planned.message });
    const plan = planned.plan;
    const report = {
      riepilogo: {
        cambiano: plan.counts.cambia,
        confermeRegistrate: plan.counts.registra,
        daConfermare: plan.counts.attende_conferma,
        invariate: plan.counts.invariata,
      },
      schede: describeOriginItems(plan),
    };
    const writes = plan.items.flatMap((item) => (item.write ? [{ item, write: item.write }] : []));
    if (writes.length === 0 && plan.counts.attende_conferma === 0) {
      return done({ status: "NOTHING_TO_DO", message: "Nessuna scheda con l'origine da decidere.", ...report });
    }
    if (!ctx.apply) {
      return done({
        status: "DRY_RUN",
        message: `${DRY_RUN_NOTE} Le righe con conferma «serve» cambiano solo con --decisions origin.json ({ "<id>": "adoption" | "transformation" }).`,
        ...report,
      });
    }
    if (writes.length === 0) {
      return done({
        status: "NOTHING_TO_DO",
        message: `Niente da scrivere: ${counted(plan.counts.attende_conferma, "scheda", "schede")} ${plural(plan.counts.attende_conferma, "aspetta", "aspettano")} la conferma con --decisions origin.json.`,
        ...report,
      });
    }
    ctx.print({ status: "PLAN", command: ctx.command, ...report });
    let changed = 0;
    let recorded = 0;
    for (let i = 0; i < writes.length; i += CHUNK) {
      const chunk = writes.slice(i, i + CHUNK);
      const statements: AdminStatement[] = chunk.map(({ item, write }) =>
        item.action === "registra"
          ? { text: CONFIRM_ORIGIN_SQL, params: [item.id, item.workspaceId] }
          : { text: APPLY_ORIGIN_SQL, params: [item.id, item.workspaceId, write.origin, write.hide, write.fields] },
      );
      const results = await ctx.db.write(statements);
      chunk.forEach(({ item }, index) => {
        if ((results[index] ?? []).length === 0) return;
        if (item.action === "registra") recorded++;
        else changed++;
      });
    }
    const skipped = writes.length - changed - recorded;
    const waiting = plan.counts.attende_conferma;
    return done({
      status: "APPLIED",
      message: `Origine scritta su ${counted(changed, "scheda", "schede")}, ${counted(recorded, "conferma registrata", "conferme registrate")}${
        skipped ? `, ${skipped} ${plural(skipped, "saltata (cambiata", "saltate (cambiate")} nel frattempo)` : ""
      }. ${waiting} ${plural(waiting, "resta", "restano")} da confermare.`,
      cambiate: changed,
      confermeRegistrate: recorded,
      saltate: skipped,
      daConfermare: plan.counts.attende_conferma,
    });
  },
};
