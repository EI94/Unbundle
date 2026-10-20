/**
 * I dati del prossimo passo (DESIGN §2.7): `NextStepInput` per il motore puro
 * `views/next-step.ts`, letto dalla prontezza in cache (`uc_cases.readiness`)
 * e da conteggi indicizzati, mai ricalcolando il catalogo dal vivo.
 *
 * - `loadNextStepInput`: un dossier, in un solo giro (un batch).
 * - `loadNextStepInputs`: più dossier (colonna «In realizzazione» della pagina
 *   Use case), sempre in un solo giro.
 * - `nextStepStatements` e `parseNextStepRows` servono alla testata
 *   (`uc-header.ts`), che li mette nel suo stesso batch.
 *
 * Le indispensabili sono le voci richieste dal via allo sviluppo (G1):
 * `in_gate_scope`, `must`, nel contratto e utili al modello, come `isRequired`
 * di `gates.ts`. Le risposte «da verificare da me» applicano i quattro occhi
 * come la coda di verifica: niente voci a cui chi guarda ha risposto o di cui
 * ha copiato il link.
 *
 * Modulo senza import dell'app, come `uc-cases.ts`.
 */
import { MVP_AVAILABLE_GATES, checkCaseTransition, nextCaseStatuses } from "../../uc/case-state.ts";
import { GATE_PHASE } from "../../uc/gates.ts";
import { signatureSideOf } from "../../uc/permissions.ts";
import type { Readiness } from "../../uc/semaforo.ts";
import { rowDate, rowJson, rowNumber, rowObject, rowString, rowVocab, type Row } from "../../uc/sql/readiness.ts";
import { cast, jsonb, toStatement, ucSql, type SqlFragment, type UcStatement } from "../../uc/sql/statement.ts";
import type { Approval } from "../../uc/types.ts";
import type { NextStepInput } from "../../uc/views/next-step.ts";
import type { StatusGroup } from "../../uc/views/status-groups.ts";
import { CASE_STATUSES, type CaseRole, type CaseStatus } from "../../uc/vocab.ts";
import type { UcExecutor } from "../uc-executor.ts";
import { PENDING_SIGNATURE_STATEMENTS, parsePendingSignatures, pendingSignatureStatements, toPendingSignatures, type CaseSignature } from "./uc-signatures.ts";
import { UUID } from "../../uc/ids.ts";

/** Gli uuid come li scrive Postgres: in minuscolo. Le chiavi delle mappe si confrontano così. */
export function lowerId(id: string): string {
  return id.toLowerCase();
}

/** Voce richiesta da G1 (alias `i`): stessa regola di `isRequired` in `gates.ts`. */
function requiredForVia(): SqlFragment {
  return ucSql`(i.in_gate_scope AND i.priority = 'must' AND i.perimeter = 'in_contratto' AND i.serves_for @> ${jsonb([GATE_PHASE.G1])})`;
}

/** Quattro occhi (alias `i`): chi guarda non ha risposto alla voce e non ha copiato il link della risposta. */
function notMine(userId: string): SqlFragment {
  const me = cast(userId, "uuid");
  return ucSql`(NOT EXISTS (SELECT 1 FROM uc_answers x WHERE x.item_id = i.id AND x.responder_user_id = ${me})
    AND NOT EXISTS (SELECT 1 FROM uc_answers ca JOIN uc_request_tokens t ON t.request_id = ca.request_id
      WHERE ca.id = i.current_answer_id AND t.issued_by_user_id = ${me}))`;
}

/** Fatti dei dossier: stato, cache, catalogo, prossima tappa, proposta del via, referenti, chi firma la privacy. */
function casesSql(workspaceId: string, caseIds: readonly string[]): UcStatement {
  return toStatement(ucSql`SELECT c.id, c.status, c.status_before_suspension, c.status_changed_at, c.readiness, c.catalog_revision, c.catalog_version, c.signers_designation,
  (SELECT cv.created_at FROM uc_catalog_versions cv WHERE cv.case_id = c.id AND cv.version = c.catalog_version) AS catalog_frozen_at,
  (SELECT jsonb_build_object('title', ms.title, 'date', ms.planned_date::text) FROM uc_milestones ms
    WHERE ms.case_id = c.id AND ms.done_at IS NULL ORDER BY ms.sort_order, ms.planned_date NULLS LAST, ms.key LIMIT 1) AS next_milestone,
  (SELECT g.approvals FROM uc_gate_reviews g WHERE g.case_id = c.id AND g.decision = 'proposto' ORDER BY g.created_at DESC LIMIT 1) AS pending_review,
  (SELECT count(*) FROM (
     SELECT i.assignee_contact_id AS contact_id FROM uc_items i WHERE i.case_id = c.id AND i.deleted_at IS NULL AND i.assignee_contact_id IS NOT NULL
     UNION SELECT r.contact_id FROM uc_requests r WHERE r.case_id = c.id AND r.purpose = 'raccolta') x)::int AS referents,
  EXISTS (SELECT 1 FROM uc_case_members m WHERE m.case_id = c.id AND m.role = 'approvatore_privacy') AS privacy_member,
  EXISTS (SELECT 1 FROM uc_blockers b WHERE b.case_id = c.id AND b.key = 'a8' AND b.status = 'attivo') AS a8_active
FROM uc_cases c
WHERE c.id = ANY(${cast([...caseIds], "uuid[]")}) AND c.workspace_id = ${cast(workspaceId, "uuid")} AND c.setup_completed_at IS NOT NULL`);
}

/**
 * Conteggi delle voci per dossier: gruppi delle indispensabili, invii, verifiche, attese.
 * Da verificare è solo `in_verifica`: una risposta `parziale` è «Da fare» (DESIGN §2.6),
 * va completata dal referente. La coda di verifica e la vista «Da verificare» di
 * Domande (WP3) contano allo stesso modo.
 */
function itemCountsSql(caseIds: readonly string[], userId: string): UcStatement {
  const req = requiredForVia();
  const mine = notMine(userId);
  return toStatement(ucSql`SELECT i.case_id,
  count(*) FILTER (WHERE ${req} AND i.status IN ('da_chiedere', 'chiesta', 'mancante', 'parziale'))::int AS g_da_fare,
  count(*) FILTER (WHERE ${req} AND i.status = 'in_verifica')::int AS g_da_verificare,
  count(*) FILTER (WHERE ${req} AND i.status = 'bloccata')::int AS g_bloccate,
  count(*) FILTER (WHERE ${req} AND i.status IN ('validata', 'non_applicabile'))::int AS g_a_posto,
  count(*) FILTER (WHERE ${req} AND i.status = 'da_chiedere' AND i.assignee_contact_id IS NULL)::int AS unassigned_must,
  count(*) FILTER (WHERE ${req} AND i.status = 'da_chiedere')::int AS unsent_must,
  count(*) FILTER (WHERE i.status = 'in_verifica')::int AS to_verify_total,
  count(*) FILTER (WHERE i.status = 'in_verifica' AND ${mine})::int AS to_verify_for_me,
  count(*) FILTER (WHERE ${req} AND i.status = 'in_verifica' AND ${mine})::int AS to_verify_must,
  min(a.created_at) FILTER (WHERE i.status = 'in_verifica' AND ${mine}) AS oldest_to_verify_at,
  count(*) FILTER (WHERE i.request_module_key IS NOT NULL AND i.status = 'chiesta')::int AS waiting_on_referents
FROM uc_items i
LEFT JOIN uc_answers a ON a.id = i.current_answer_id
WHERE i.case_id = ANY(${cast([...caseIds], "uuid[]")}) AND i.deleted_at IS NULL
GROUP BY i.case_id`);
}

/** Blocchi attivi con le indispensabili che fermano, per chiave. */
function blockersSql(caseIds: readonly string[]): UcStatement {
  return toStatement(ucSql`SELECT b.case_id, b.key, count(DISTINCT i.id)::int AS must_items
FROM uc_blockers b
JOIN uc_item_blockers ib ON ib.blocker_id = b.id
JOIN uc_items i ON i.id = ib.item_id AND i.deleted_at IS NULL
WHERE b.case_id = ANY(${cast([...caseIds], "uuid[]")}) AND b.status = 'attivo' AND ${requiredForVia()}
GROUP BY b.case_id, b.key`);
}

/** Istruzioni del prossimo passo per uno o più dossier: tutte in un batch, quindi un solo giro. */
export function nextStepStatements(i: { workspaceId: string; caseIds: readonly string[]; userId: string }): UcStatement[] {
  return [casesSql(i.workspaceId, i.caseIds), itemCountsSql(i.caseIds, i.userId), blockersSql(i.caseIds), ...i.caseIds.flatMap((id) => pendingSignatureStatements(id))];
}

/** Il responsabile Lateral Space di prova per il passo avanti: si guarda solo se il cambio è ammesso adesso. */
const LEAD_ACTOR = { type: "utente" as const, userId: "00000000-0000-4000-8000-000000000000", roles: ["ls_lead"] as CaseRole[] };

/**
 * Il passo avanti dopo lo sviluppo che il responsabile Lateral Space può fare
 * adesso (DESIGN §2.7 regola 14). Nell'MVP solo G1: il rodaggio va in uso dopo
 * 14 giorni, l'uso passa alla misura del valore.
 */
export function forwardTransitionFor(status: CaseStatus, enteredAt: Date | null, now: Date): CaseStatus | null {
  if (["bozza", "raccolta", "pronto_sviluppo", "sospeso", "chiuso"].includes(status)) return null;
  for (const to of nextCaseStatuses(status, null)) {
    if (to === "sospeso" || to === "chiuso" || to === "in_sviluppo") continue;
    const r = checkCaseTransition({
      from: status,
      to,
      actor: LEAD_ACTOR,
      user: null,
      approvedGates: new Set(),
      enteredAt,
      now,
      availableGates: MVP_AVAILABLE_GATES,
      statusBeforeSuspension: null,
    });
    if (r.ok) return to;
  }
  return null;
}

function approvalsOf(raw: unknown): Approval[] {
  const list = rowJson<unknown[]>(raw);
  return Array.isArray(list) ? (list.filter((a) => a && typeof a === "object" && typeof (a as Approval).ruolo === "string") as Approval[]) : [];
}

function cachedReadiness(raw: unknown): Readiness | null {
  const r = rowJson<Readiness>(raw);
  return r && typeof r === "object" && r.G1 && typeof r.G1.required === "number" ? r : null;
}

export interface NextStepRead {
  input: NextStepInput;
  signatures: CaseSignature[];
  /** La prontezza usata: quella dal vivo se passata (`liveReadiness`), altrimenti la cache (null se non c'è). */
  readiness: Readiness | null;
  /**
   * La cache è indietro rispetto al catalogo: manca, oppure la sua
   * `catalog_revision` non è più quella del caso. Succede subito dopo un
   * comando, perché la cache si ricalcola in `after()`, dopo la risposta.
   */
  stale: boolean;
}

/**
 * Dalle righe di `nextStepStatements` all'input del motore, per ogni dossier
 * trovato nel workspace. `rolesByCase`: i ruoli di adesso di chi guarda.
 * `liveReadiness`: la prontezza calcolata dal vivo, al posto di una cache
 * indietro (la testata, `uc-header.ts`).
 */
export function parseNextStepRows(
  rows: readonly (readonly Row[])[],
  i: { caseIds: readonly string[]; rolesByCase: ReadonlyMap<string, readonly CaseRole[]>; now: Date; liveReadiness?: ReadonlyMap<string, Readiness> },
): Map<string, NextStepRead> {
  const [cases = [], counts = [], blockers = []] = rows;
  // Postgres restituisce gli uuid in minuscolo; chi chiama può averli scritti in maiuscolo (l'URL li accetta).
  const caseIds = i.caseIds.map(lowerId);
  const rolesByCase = new Map([...i.rolesByCase].map(([k, v]) => [lowerId(k), v]));
  const liveReadiness = new Map([...(i.liveReadiness ?? [])].map(([k, v]) => [lowerId(k), v]));
  const countsBy = new Map(counts.map((r) => [lowerId(String(r.case_id)), r]));
  const out = new Map<string, NextStepRead>();
  for (const c of cases) {
    const id = lowerId(String(c.id));
    const index = caseIds.indexOf(id);
    if (index < 0) continue;
    const status = rowVocab(CASE_STATUSES, c.status);
    if (!status) continue;
    const roles = rolesByCase.get(id) ?? [];
    const sigStart = 3 + index * PENDING_SIGNATURE_STATEMENTS;
    const signatures = parsePendingSignatures(rows.slice(sigStart, sigStart + PENDING_SIGNATURE_STATEMENTS), roles);
    const n = countsBy.get(id) ?? {};
    const num = (v: unknown) => rowNumber(v) ?? 0;
    const byGroup: Partial<Record<StatusGroup, number>> = {
      da_fare: num(n.g_da_fare),
      da_verificare: num(n.g_da_verificare),
      bloccate: num(n.g_bloccate),
      a_posto: num(n.g_a_posto),
    };
    const cached = cachedReadiness(c.readiness);
    const live = liveReadiness.get(id) ?? null;
    const revision = rowNumber(c.catalog_revision);
    const stale = cached === null || (revision !== null && cached.catalog_revision !== revision);
    const readiness = live ?? cached;
    const counted = (byGroup.da_fare ?? 0) + (byGroup.da_verificare ?? 0) + (byGroup.bloccate ?? 0) + (byGroup.a_posto ?? 0);
    const g1 = readiness
      ? { required: readiness.G1.required, ok: readiness.G1.ok, ready: readiness.G1.ready, byGroup }
      : { required: counted, ok: byGroup.a_posto ?? 0, ready: false, byGroup };
    const caseBlockers = blockers.filter((b) => lowerId(String(b.case_id)) === id && num(b.must_items) > 0);
    const reviewApprovals = c.pending_review === null || c.pending_review === undefined ? null : approvalsOf(c.pending_review);
    const lsApproval = reviewApprovals?.find((a) => signatureSideOf(a.ruolo) === "ls") ?? null;
    const statusBeforeSuspension = rowVocab(CASE_STATUSES, c.status_before_suspension);
    const statusChangedAt = rowDate(c.status_changed_at);
    const milestone = rowObject(c.next_milestone);
    const catalogVersion = rowNumber(c.catalog_version) ?? 0;
    const designation = rowObject(c.signers_designation);
    const privacyDesignated = !!designation.privacy && typeof designation.privacy === "object" && typeof (designation.privacy as Record<string, unknown>).contact_id === "string";
    out.set(id, {
      readiness,
      stale: live === null && stale,
      signatures,
      input: {
        now: i.now,
        status,
        statusBeforeSuspension,
        statusChangedAt,
        gateReconfirm: readiness?.gate_reconfirm === true,
        g1,
        pendingGateReview: reviewApprovals
          ? { lsSigned: lsApproval !== null, clientSigned: reviewApprovals.some((a) => signatureSideOf(a.ruolo) === "cliente"), lsSignedAt: lsApproval?.at ?? null }
          : null,
        referents: num(c.referents),
        unassignedMust: num(n.unassigned_must),
        unsentMust: num(n.unsent_must),
        toVerifyForMe: num(n.to_verify_for_me),
        toVerifyMust: num(n.to_verify_must),
        oldestToVerifyAt: rowDate(n.oldest_to_verify_at),
        toVerifyTotal: num(n.to_verify_total),
        waitingOnReferents: num(n.waiting_on_referents),
        blockersActive: caseBlockers.length,
        blockedMust: byGroup.bloccate ?? 0,
        privacyBlockerActive: caseBlockers.some((b) => String(b.key) === "a8"),
        mySignaturesPending: toPendingSignatures(signatures),
        privacySignerMissing: c.a8_active === true && c.privacy_member !== true && !privacyDesignated,
        forwardTransition: forwardTransitionFor(status, statusChangedAt, i.now),
        nextMilestone: typeof milestone.title === "string" ? { title: milestone.title, date: rowString(milestone.date) } : null,
        catalog: catalogVersion > 0 ? { version: catalogVersion, frozenAt: rowDate(c.catalog_frozen_at) } : null,
      },
    });
  }
  return out;
}

/** Il prossimo passo di un dossier per chi guarda, in un solo giro. Null se il dossier non è del workspace. */
export async function loadNextStepInput(
  executor: UcExecutor,
  i: { workspaceId: string; caseId: string; userId: string; roles: readonly CaseRole[]; now?: Date },
): Promise<NextStepInput | null> {
  if (!UUID.test(i.workspaceId) || !UUID.test(i.caseId) || !UUID.test(i.userId)) return null;
  const now = i.now ?? new Date();
  const [workspaceId, caseId, userId] = [lowerId(i.workspaceId), lowerId(i.caseId), lowerId(i.userId)];
  const rows = await executor.batch(nextStepStatements({ workspaceId, caseIds: [caseId], userId }));
  return parseNextStepRows(rows, { caseIds: [caseId], rolesByCase: new Map([[caseId, i.roles]]), now }).get(caseId)?.input ?? null;
}

/**
 * Lo stesso per più dossier del workspace, in un solo giro. I dossier di altri
 * workspace non compaiono. Le chiavi del risultato sono gli id in minuscolo.
 */
export async function loadNextStepInputs(
  executor: UcExecutor,
  i: { workspaceId: string; caseIds: readonly string[]; userId: string; rolesByCase: ReadonlyMap<string, readonly CaseRole[]>; now?: Date },
): Promise<Map<string, NextStepInput>> {
  const ids = [...new Set(i.caseIds.filter((id) => UUID.test(id)).map(lowerId))];
  if (!UUID.test(i.workspaceId) || !UUID.test(i.userId) || ids.length === 0) return new Map();
  const now = i.now ?? new Date();
  const rows = await executor.batch(nextStepStatements({ workspaceId: lowerId(i.workspaceId), caseIds: ids, userId: lowerId(i.userId) }));
  const parsed = parseNextStepRows(rows, { caseIds: ids, rolesByCase: i.rolesByCase, now });
  return new Map([...parsed].map(([id, r]) => [id, r.input]));
}
