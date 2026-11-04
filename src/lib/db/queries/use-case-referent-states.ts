import "server-only";
import { ensureDbSchema } from "@/lib/db/ensure-schema";
import { getAppUcExecutor } from "@/lib/db/uc-executor";
import { CLIENT_SIDE_SQL } from "@/lib/db/use-case-hub-referents-ddl";
import { referentStoreReady } from "@/lib/db/queries/use-case-referent-base";
import { logSafeError } from "@/lib/log/safe-error";
import { rowBool, rowDate, rowNumber, rowString } from "@/lib/uc/sql/readiness";
import { cast, raw, toStatement, ucSql } from "@/lib/uc/sql/statement";
import { abilitiesForUseCase, type UseCaseViewer } from "@/lib/use-cases/permissions";
import { referentAskEnabled } from "@/lib/use-cases/referent/availability";
import { openItemsCountSql } from "@/lib/use-cases/referent/sql";
import { BENEFITS_FLAG_SQL, BENEFIT_DIFFERS_SQL, BENEFIT_UNKNOWN_SQL } from "@/lib/use-cases/referent/impact";
import { eligibleForReferent, referentStateOf, type ReferentRequestFact, type ReferentReview, type ReferentStateKey } from "@/lib/use-cases/referent/use-case-state";
import type { Phase } from "@/lib/use-cases/types";

/**
 * «Referente in un tocco» (rilascio 5, SPEC §10.1): lo stato del referente di ogni use case, per le
 * card, le righe, il pannello e il filtro «Referente». Una lettura sola per tutto il workspace:
 * le richieste con la loro conferma, i requisiti del cliente da verificare, il tipo e la stima del
 * team di ogni use case. La scelta delle richieste (R*, R) e lo stato sono in TypeScript
 * (`referentStateOf`); nessun ORDER BY, GROUP BY o DISTINCT ON su una persona, e la persona
 * (`contact_id`) non esce mai di qui (art. 15.4).
 *
 * Ai contributori arrivano solo gli stati degli use case che vedono (gli id che la pagina passa),
 * mai che cosa aspetta il team; ai revisori anche quello («correzione», «stima» o «non_sa»).
 */

export interface ReferentStateEntry {
  state: ReferentStateKey;
  review: ReferentReview;
}

export interface ReferentStates {
  /** Id in minuscolo → stato; solo gli use case che ne hanno uno. */
  states: Record<string, ReferentStateKey>;
  /** Solo ai revisori: che cosa aspetta il team. */
  review: Record<string, ReferentReview> | null;
}

type Env = Record<string, string | undefined>;

/** Gli stati del referente per gli use case `items` (quelli che chi guarda vede); null con la funzione spenta. */
export async function listReferentStates(
  workspaceId: string,
  viewer: UseCaseViewer,
  items: ReadonlyArray<{ id: string; phase: Phase }>,
  o: { now?: Date; env?: Env } = {},
): Promise<ReferentStates | null> {
  const abilities = abilitiesForUseCase(viewer);
  if (!abilities.canOpenArea || !/^[0-9a-f-]{36}$/i.test(workspaceId)) return null;
  const env = o.env ?? process.env;
  if (!referentAskEnabled(workspaceId, env)) return null;
  try {
    await ensureDbSchema();
    if (!(await referentStoreReady())) return null;
    const now = o.now ?? new Date();
    const ws = cast(workspaceId, "uuid");
    const executor = await getAppUcExecutor();
    const [requestRows, verifyRows, cardRows] = await executor.batch([
      toStatement(ucSql`SELECT r.id, r.use_case_id, r.contact_id, r.status, r.expires_at, r.created_at, r.reminder_count,
  ${openItemsCountSql("r")} AS open_task,
  (c.request_id IS NOT NULL) AS has_check, c.submitted_at, c.confirm, c.correction_done_at, c.estimate, c.estimate_outcome, c.team_component_key,
  coalesce(${raw(BENEFITS_FLAG_SQL("c"))}, false) AS benefits,
  EXISTS (SELECT 1 FROM use_case_referent_check_benefits b WHERE b.request_id = c.request_id AND c.submitted_at IS NOT NULL AND ${raw(BENEFITS_FLAG_SQL("c"))} AND ${raw(BENEFIT_DIFFERS_SQL("b"))}) AS benefit_review,
  EXISTS (SELECT 1 FROM use_case_referent_check_benefits b WHERE b.request_id = c.request_id AND c.submitted_at IS NOT NULL AND ${raw(BENEFITS_FLAG_SQL("c"))} AND ${raw(BENEFIT_UNKNOWN_SQL("b"))}) AS benefit_unknown
FROM use_case_referent_requests r LEFT JOIN use_case_referent_checks c ON c.request_id = r.id
WHERE r.workspace_id = ${ws} AND (r.status <> 'revocata' OR c.request_id IS NOT NULL)`),
      toStatement(ucSql`SELECT DISTINCT l.use_case_id
FROM use_case_needs n JOIN use_case_need_links l ON l.need_id = n.id JOIN use_cases u ON u.id = l.use_case_id AND u.workspace_id = n.workspace_id
WHERE n.workspace_id = ${ws} AND n.type = 'requisito' AND n.archived_at IS NULL AND n.status = 'in_verifica' AND ${raw(CLIENT_SIDE_SQL("n"))}`),
      toStatement(ucSql`SELECT u.id, u.portfolio_kind,
  coalesce(jsonb_path_exists(u.value_model, '$.components[*] ? (@.kind == "ore" && @.volumeYear > 0 && @.minutesPerUnit > 0)'), false) AS has_team_estimate
FROM use_cases u WHERE u.workspace_id = ${ws}`),
    ]);
    const byCard = new Map<string, ReferentRequestFact[]>();
    for (const r of requestRows) {
      const createdAt = rowDate(r.created_at);
      const expiresAt = rowDate(r.expires_at);
      if (!createdAt || !expiresAt) continue;
      const card = String(r.use_case_id).toLowerCase();
      const confirm = rowString(r.confirm);
      const estimate = rowString(r.estimate);
      const outcome = rowString(r.estimate_outcome);
      const list = byCard.get(card) ?? [];
      list.push({
        id: String(r.id).toLowerCase(),
        contactId: String(r.contact_id).toLowerCase(),
        status: (rowString(r.status) ?? "inviata") as ReferentRequestFact["status"],
        createdAt,
        expiresAt,
        reminderCount: rowNumber(r.reminder_count) ?? 0,
        openTask: rowNumber(r.open_task) ?? 0,
        check: rowBool(r.has_check)
          ? {
              submittedAt: rowDate(r.submitted_at),
              confirm: confirm === "si" || confirm === "correggi" ? confirm : null,
              correctionDoneAt: rowDate(r.correction_done_at),
              estimate: estimate === "si" || estimate === "meno" || estimate === "piu" ? estimate : null,
              estimateOutcome: outcome === "adottata" || outcome === "tenuta" ? outcome : null,
              teamComponentKey: rowString(r.team_component_key),
              benefits: rowBool(r.benefits),
              benefitReview: rowBool(r.benefit_review),
              benefitUnknown: rowBool(r.benefit_unknown),
            }
          : null,
      });
      byCard.set(card, list);
    }
    const toVerify = new Set(verifyRows.map((r) => String(r.use_case_id).toLowerCase()));
    const cards = new Map(cardRows.map((r) => [String(r.id).toLowerCase(), { kind: rowString(r.portfolio_kind), team: rowBool(r.has_team_estimate) }]));
    const reviewer = abilities.projection === "revisore" || abilities.projection === "gestore";
    const states: Record<string, ReferentStateKey> = {};
    const review: Record<string, ReferentReview> = {};
    for (const item of items) {
      const id = item.id.toLowerCase();
      const card = cards.get(id);
      if (!card) continue;
      const result = referentStateOf({
        eligible: eligibleForReferent({ portfolioKind: card.kind, phase: item.phase }),
        requests: byCard.get(id) ?? [],
        clientRequirementToVerify: toVerify.has(id),
        hasTeamEstimateNow: card.team,
        now,
      });
      if (!result) continue;
      states[id] = result.state;
      if (reviewer) review[id] = result.review;
    }
    return { states, review: reviewer ? review : null };
  } catch (error) {
    logSafeError("use-case-referent-states", "read_failed", error);
    return null;
  }
}
