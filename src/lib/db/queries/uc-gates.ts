/**
 * Gate, congelamento del catalogo e blocchi (PIANO §3.5, §3.6, §5.10).
 *
 * - `proposeGate`: ls_lead, gate pronto dal calcolo dal vivo; la proposta porta
 *   già la firma di Lateral Space sul testo canonico (`summary_text_hash`).
 * - `signGate`: ricalcola; deve coincidere solo `summary_text_hash`. Con la firma
 *   del cliente (account `owner_cliente` non Lateral Space o link dell'Owner
 *   designato) e, sui casi a contratto, la regola confermata e la prova scritta,
 *   un batch unico decide la proposta, congela il catalogo in
 *   `uc_catalog_versions`, porta il caso a pronto_sviluppo (prima volta) e la
 *   scheda di portafoglio a in_progress. Ogni CAS passa da `uc_require`: due
 *   firme concorrenti producono una sola versione.
 * - `resolveBlocker`: prove e firme (per `a8` due, sulla stessa prova); con lo
 *   scioglimento le voci senza altri blocchi tornano `da_chiedere` nello stesso
 *   batch. `reactivateBlocker` le riblocca e, per `a8`, richiude la zona personale.
 *
 * Modulo senza import dell'app: l'esecutore arriva da fuori.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { A8_BLOCKER_KEY, checkManualBlockerLink, checkReactivateBlocker, checkResolveBlocker, itemsToBlock, itemsToUnblock, isPermanentBlocker } from "../../uc/blockers.ts";
import { MVP_AVAILABLE_GATES, checkCaseTransition } from "../../uc/case-state.ts";
import { checkGateProposal, checkGateSignature } from "../../uc/gates.ts";
import { addSignature, signatureRole, signatureSideOf, type Signer } from "../../uc/permissions.ts";
import { buildCatalogSnapshot, diffSnapshots, snapshotHash, type CatalogSnapshot } from "../../uc/snapshot.ts";
import {
  parseCaseCore,
  rowDate,
  rowJson,
  rowNumber,
  rowString,
  rowToSnapshotItem,
  rowToSnapshotLink,
  snapshotReadStatements,
  caseCoreSql,
  type Row,
} from "../../uc/sql/readiness.ts";
import { cast, toStatement, ucSql, type UcStatement } from "../../uc/sql/statement.ts";
import {
  NO_ACTIVE_BLOCKER,
  blockerUpdateSql,
  caseRevisionSql,
  catalogFreezeCaseSql,
  catalogVersionInsertSql,
  closePersonalZoneSql,
  gateReviewApprovalsSql,
  gateReviewDecideSql,
  gateReviewInsertSql,
  itemBlockerLinksInsertSql,
  itemSnapshotsSql,
  planItemTransitions,
  portfolioStatusSql,
  rowToLoadedItem,
  transitionStatements,
} from "../../uc/sql/transitions.ts";
import { fail, ok, type Approval, type Json, type Result } from "../../uc/types.ts";
import type { BlockerStatus, GateDecision, GateKey, ItemStatus } from "../../uc/vocab.ts";
import { bellPrefix } from "../../uc/notify/dedupe.ts";
import { eventActorFrom, eventInsertSql } from "./uc-events.ts";
import { enqueueForLsMembersSql } from "./uc-notifications.ts";
import {
  accountSigner,
  actorRoles,
  actorUserId,
  checkLsText,
  isUuid,
  loadCaseReadiness,
  loadSignatureContext,
  runCommand,
  usableCaseFile,
  type UcCommandContext,
} from "./uc-cases.ts";
import type { UcExecutor } from "../uc-executor.ts";
import { UUID } from "../../uc/ids.ts";

export const GATE_MESSAGES: Readonly<Record<string, string>> = {
  conflitto: "Qualcuno ha appena modificato il catalogo o la proposta. Aggiorna la pagina e riprova.",
  testo_cambiato: "Le voci del gate sono cambiate dalla proposta: ricalcola e riproponi.",
  proposta_aperta: "C'è già una proposta in attesa: firmala o respingila prima.",
  a8_non_sciolto: "La zona personale resta chiusa finché la scheda A.8 non è approvata.",
};

const CASE_NOT_FOUND = "Caso non trovato.";

function messageFor(r: { code: string; message: string }): string {
  return GATE_MESSAGES[r.code] ?? r.message;
}

function failWith<T>(r: { ok: false; code: string; message: string }): Result<T> {
  return fail(r.code, messageFor(r));
}

// ── Proposta ──────────────────────────────────────────────────────────

const ProposeSchema = z.object({ gate: z.literal("G1").default("G1"), evidenceFileId: z.string().regex(UUID).nullish() });

/**
 * Proposta del gate (ls_lead). Rifiuta se il gate non è pronto o c'è già una
 * proposta aperta. Con `evidenceFileId` allega subito la prova scritta (email o
 * verbale), che sui casi a contratto serve prima dell'approvazione.
 */
export async function proposeGate(executor: UcExecutor, ctx: UcCommandContext, input: unknown): Promise<Result<{ reviewId: string; summaryTextHash: string; ownerDesignated: boolean }>> {
  const parsed = ProposeSchema.safeParse(input ?? {});
  if (!parsed.success) return fail("dati_non_validi", "Gate non valido.");
  const now = ctx.now ?? new Date();
  const live = await loadCaseReadiness(executor, ctx.workspaceId, ctx.caseId, now);
  if (!live) return fail("non_trovato", CASE_NOT_FOUND);
  const core = live.input.core;
  const proposal = checkGateProposal({ computation: live.g1, caseStatus: core.status, actor: ctx.actor, user: ctx.user });
  if (!proposal.ok) return proposal;
  const [[open]] = await executor.batch([
    toStatement(ucSql`SELECT id FROM uc_gate_reviews WHERE case_id = ${cast(ctx.caseId, "uuid")} AND gate_key = 'G1' AND decision = 'proposto'`),
  ]);
  if (open) return fail("proposta_aperta", GATE_MESSAGES.proposta_aperta);
  if (parsed.data.evidenceFileId && !(await usableCaseFile(executor, ctx.caseId, parsed.data.evidenceFileId))) {
    return fail("prova_non_valida", "La prova scritta deve essere un file utilizzabile del caso.");
  }
  const who = accountSigner(ctx);
  if (!who.ok) return who;
  const sigCtx = await loadSignatureContext(executor, core, ctx.lsDomains);
  const signed = addSignature({
    purpose: "gate",
    approvals: [],
    signer: who.value,
    ctx: sigCtx,
    now,
    textHash: proposal.value.summaryTextHash,
    expectedTextHash: proposal.value.summaryTextHash,
  });
  if (!signed.ok) return signed;
  const reviewId = randomUUID();
  const g1 = live.g1;
  const computed: Json = {
    gate: g1.gate,
    required: g1.required,
    ok: g1.ok,
    ready: g1.ready,
    by_status: g1.byStatus,
    should: g1.should,
    waivers: { used: g1.waivers.used, cap: g1.waivers.cap, keys: g1.waivers.keys },
    conditions: g1.conditions.map((c) => ({ key: c.key, ok: c.ok, message: c.message })),
    summary_text: g1.summaryText,
    policy_scope: core.policy.scope,
  };
  const run = await runCommand(
    executor,
    [
      caseRevisionSql({ workspaceId: ctx.workspaceId, caseId: ctx.caseId, expectStatus: [core.status], expectRevision: core.catalogRevision, bump: false }),
      ...gateReviewInsertSql({
        id: reviewId,
        workspaceId: ctx.workspaceId,
        caseId: ctx.caseId,
        gate: "G1",
        computed,
        catalogRevision: core.catalogRevision,
        summaryTextHash: proposal.value.summaryTextHash,
        waivers: g1.waivers.keys,
        approvals: signed.value.approvals,
        writtenEvidenceFileId: parsed.data.evidenceFileId ?? null,
        proposedByUserId: actorUserId(ctx)!,
        required: g1.required,
        ok: g1.ok,
      }),
      toStatement(
        enqueueForLsMembersSql({
          workspaceId: ctx.workspaceId,
          caseId: ctx.caseId,
          templateKey: "gate_pronto",
          payload: { gate: "G1", case_code: core.code, review_id: reviewId },
          dedupeKeyPrefix: bellPrefix.gatePronto(ctx.caseId, core.catalogRevision),
        }),
      ),
    ],
    GATE_MESSAGES,
  );
  if (!run.ok) return run;
  return ok({ reviewId, summaryTextHash: proposal.value.summaryTextHash, ownerDesignated: core.designated.owner !== null });
}

// ── Firma e congelamento ──────────────────────────────────────────────

interface ReviewRow {
  id: string;
  gate: GateKey;
  decision: GateDecision;
  approvals: Approval[];
  summaryTextHash: string;
  writtenEvidenceFileId: string | null;
}

async function loadReview(executor: UcExecutor, caseId: string, reviewId: string): Promise<ReviewRow | null> {
  if (!isUuid(reviewId)) return null;
  const [[row]] = await executor.batch([
    toStatement(ucSql`SELECT id, gate_key, decision, approvals, summary_text_hash, written_evidence_file_id FROM uc_gate_reviews
WHERE id = ${cast(reviewId, "uuid")} AND case_id = ${cast(caseId, "uuid")}`),
  ]);
  if (!row) return null;
  const approvals = rowJson<Approval[]>(row.approvals);
  return {
    id: String(row.id),
    gate: String(row.gate_key) as GateKey,
    decision: String(row.decision) as GateDecision,
    approvals: Array.isArray(approvals) ? approvals : [],
    summaryTextHash: String(row.summary_text_hash),
    writtenEvidenceFileId: rowString(row.written_evidence_file_id),
  };
}

const SignSchema = z.object({ reviewId: z.string().regex(UUID), evidenceFileId: z.string().regex(UUID).nullish() });

export interface SignGateResult {
  reviewId: string;
  complete: boolean;
  waitingFor: "lateral_space" | "cliente" | "prova_scritta" | null;
  catalogVersion: number | null;
  decision: GateDecision;
}

/**
 * Firma della proposta (§5.10.2). `signer` serve al link di approvazione
 * dell'Owner (WP7b); senza, firma l'account del comando. Con le firme complete
 * esegue il congelamento in un batch unico.
 */
export async function signGate(executor: UcExecutor, ctx: UcCommandContext, input: unknown, signer?: Signer): Promise<Result<SignGateResult>> {
  const parsed = SignSchema.safeParse(input);
  if (!parsed.success) return fail("dati_non_validi", "Proposta non valida.");
  const review = await loadReview(executor, ctx.caseId, parsed.data.reviewId);
  if (!review) return fail("non_trovato", "Proposta non trovata.");
  if (review.decision !== "proposto") return fail("gate_gia_deciso", "Su questa proposta c'è già una decisione.");
  if (parsed.data.evidenceFileId && !(await usableCaseFile(executor, ctx.caseId, parsed.data.evidenceFileId))) {
    return fail("prova_non_valida", "La prova scritta deve essere un file utilizzabile del caso.");
  }
  const now = ctx.now ?? new Date();
  const live = await loadCaseReadiness(executor, ctx.workspaceId, ctx.caseId, now);
  if (!live) return fail("non_trovato", CASE_NOT_FOUND);
  const core = live.input.core;
  const who = signer ? ok(signer) : accountSigner(ctx);
  if (!who.ok) return who;
  const sigCtx = await loadSignatureContext(executor, core, ctx.lsDomains);
  const role = signatureRole(who.value, "gate", sigCtx);
  if (!role.ok) return failWith(role);
  // Chi ha già firmato può solo allegare la prova scritta (casi a contratto): la firma non si ripete.
  const alreadySigned = review.approvals.some((a) => signatureSideOf(a.ruolo) === role.value.side);
  let approvals: Approval[] = review.approvals;
  let newSignature = false;
  if (alreadySigned) {
    if (!parsed.data.evidenceFileId) {
      return fail("firma_gia_presente", role.value.side === "ls" ? "Lateral Space ha già firmato." : "Il cliente ha già firmato.");
    }
  } else {
    const added = addSignature({
      purpose: "gate",
      approvals: review.approvals,
      signer: who.value,
      ctx: sigCtx,
      now,
      textHash: review.summaryTextHash,
      expectedTextHash: live.g1.summaryTextHash,
    });
    if (!added.ok) return failWith(added);
    approvals = added.value.approvals;
    newSignature = true;
  }
  const evidence = parsed.data.evidenceFileId ?? review.writtenEvidenceFileId;
  const checked = checkGateSignature({
    computation: live.g1,
    proposedSummaryHash: review.summaryTextHash,
    caseStatus: core.status,
    policy: core.policy,
    contractRefs: core.contractRefs,
    writtenEvidenceFileId: evidence,
    approvals,
    available: MVP_AVAILABLE_GATES,
  });
  if (!checked.ok) return failWith(checked);
  const actor = eventActorFrom(ctx.actor);
  const gatePayload = {
    gate: review.gate,
    required: live.g1.required,
    ok: live.g1.ok,
    summary_text_hash: review.summaryTextHash,
    waivers: live.g1.waivers.used,
    ruolo: role.value.ruolo,
  };
  const signedEvents = newSignature
    ? [toStatement(eventInsertSql({ type: "gate.firmato", workspaceId: ctx.workspaceId, caseId: ctx.caseId, actor, targetType: "gate", targetId: review.id, payload: gatePayload }))]
    : [];

  if (!checked.value.complete) {
    const run = await runCommand(
      executor,
      [
        gateReviewApprovalsSql({
          reviewId: review.id,
          caseId: ctx.caseId,
          oldApprovals: review.approvals,
          approvals,
          ...(parsed.data.evidenceFileId ? { writtenEvidenceFileId: parsed.data.evidenceFileId } : {}),
        }),
        ...signedEvents,
      ],
      GATE_MESSAGES,
    );
    if (!run.ok) return run;
    return ok({ reviewId: review.id, complete: false, waitingFor: checked.value.waitingFor, catalogVersion: null, decision: "proposto" });
  }

  // Firme complete: fotografia e congelamento in un batch unico.
  const rows = await executor.batch(snapshotReadStatements(ctx.workspaceId, ctx.caseId));
  const caseRow = rows[0]?.[0];
  if (!caseRow) return fail("non_trovato", CASE_NOT_FOUND);
  const version = core.catalogVersion + 1;
  const decision: GateDecision = live.g1.waivers.used > 0 ? "approvato_con_riserva" : "approvato";
  const built = buildCatalogSnapshot({
    case: {
      id: core.id,
      workspaceId: core.workspaceId,
      code: core.code,
      title: core.title,
      perimeterLabel: rowString(caseRow.perimeter_label),
      contractRefs: core.contractRefs,
      dataControllerLabel: rowString(caseRow.data_controller_label),
    },
    template: { key: String(caseRow.template_key), version: String(caseRow.template_version), hash: String(caseRow.template_hash) },
    version,
    frozenAt: now,
    gate: {
      key: review.gate,
      reviewId: review.id,
      decision,
      policyScope: core.policy.scope,
      required: live.g1.required,
      ok: live.g1.ok,
      summaryTextHash: review.summaryTextHash,
      waiverKeys: live.g1.waivers.keys,
    },
    items: (rows[1] ?? []).map(rowToSnapshotItem),
    links: (rows[2] ?? []).map(rowToSnapshotLink),
  });
  if (!built.ok) return built;
  const snapshot = built.value;
  const prevRaw = rows[3]?.[0] ? rowJson<CatalogSnapshot>(rows[3][0].snapshot) : null;
  const diff = diffSnapshots(prevRaw && typeof prevRaw === "object" ? prevRaw : null, snapshot);
  const hash = snapshotHash(snapshot);
  const statements: UcStatement[] = [
    gateReviewDecideSql({
      reviewId: review.id,
      caseId: ctx.caseId,
      decision,
      oldApprovals: review.approvals,
      approvals: approvals,
      catalogVersion: version,
      snapshotHash: hash,
      writtenEvidenceFileId: parsed.data.evidenceFileId ?? null,
    }),
  ];
  let toStatus: "pronto_sviluppo" | null = null;
  if (checked.value.transition) {
    const t = checkCaseTransition({
      from: core.status,
      to: "pronto_sviluppo",
      actor: { type: "sistema", job: "creazione" },
      approvedGates: new Set(["G1"]),
      enteredAt: core.statusChangedAt,
      now,
      availableGates: MVP_AVAILABLE_GATES,
      statusBeforeSuspension: core.statusBeforeSuspension,
    });
    if (!t.ok) return t;
    toStatus = "pronto_sviluppo";
  }
  statements.push(
    catalogFreezeCaseSql({ workspaceId: ctx.workspaceId, caseId: ctx.caseId, expectRevision: core.catalogRevision, version, fromStatus: core.status, toStatus }),
    catalogVersionInsertSql({
      caseId: ctx.caseId,
      version,
      reason: version === 1 ? "gate" : "correzione",
      gateReviewId: review.id,
      changeNote: version === 1 ? null : "Nuova approvazione del gate",
      diff: diff as unknown as Json,
      snapshot: snapshot as unknown as Json,
      snapshotHash: hash,
      approvedBy: approvals,
      createdByUserId: actorUserId(ctx),
    }),
    ...signedEvents,
    toStatement(
      eventInsertSql({
        type: "gate.approvato",
        workspaceId: ctx.workspaceId,
        caseId: ctx.caseId,
        actor,
        targetType: "gate",
        targetId: review.id,
        fromState: "proposto",
        toState: decision,
        payload: { ...gatePayload, catalog_version: version },
      }),
    ),
    toStatement(
      eventInsertSql({
        type: "catalogo.congelato",
        workspaceId: ctx.workspaceId,
        caseId: ctx.caseId,
        actor,
        targetType: "catalogo",
        targetId: ctx.caseId,
        payload: { version, snapshot_hash: hash, items: snapshot.counts.total, reason: version === 1 ? "gate" : "correzione" },
      }),
    ),
    toStatement(
      enqueueForLsMembersSql({
        workspaceId: ctx.workspaceId,
        caseId: ctx.caseId,
        templateKey: "gate_approvato",
        payload: { gate: review.gate, case_code: core.code, version, review_id: review.id },
        dedupeKeyPrefix: bellPrefix.gateApprovato(review.id),
      }),
    ),
  );
  if (toStatus) {
    statements.push(
      // La scheda può essere già avanti: 0 o 1 riga, senza uc_require.
      portfolioStatusSql({ workspaceId: ctx.workspaceId, caseId: ctx.caseId, from: "accepted", to: "in_progress" }),
      toStatement(
        eventInsertSql({
          type: "caso.stato_cambiato",
          workspaceId: ctx.workspaceId,
          caseId: ctx.caseId,
          actor: { type: "sistema" },
          targetType: "caso",
          targetId: ctx.caseId,
          fromState: core.status,
          toState: toStatus,
          payload: { from: core.status, to: toStatus, reason: "gate_approvato" },
        }),
      ),
    );
  }
  const run = await runCommand(executor, statements, GATE_MESSAGES);
  if (!run.ok) return run;
  return ok({ reviewId: review.id, complete: true, waitingFor: null, catalogVersion: version, decision });
}

const RejectSchema = z.object({ reviewId: z.string().regex(UUID), reason: z.string().trim().min(3, "Scrivi il motivo.").max(2000) });

/** Proposta respinta da chi firma (ls_lead o Owner del cliente), con il motivo nelle note. */
export async function rejectGate(executor: UcExecutor, ctx: UcCommandContext, input: unknown): Promise<Result<{ reviewId: string }>> {
  const parsed = RejectSchema.safeParse(input);
  if (!parsed.success) return fail("dati_non_validi", parsed.error.issues[0]?.message ?? "Scrivi il motivo.");
  const roles = actorRoles(ctx);
  const ruolo = roles.includes("ls_lead") ? "ls_lead" : roles.includes("owner_cliente") ? "owner_cliente" : null;
  if (!ruolo) return fail("attore_non_ammesso", "Respingono la proposta solo il Responsabile del caso o l'Owner del cliente.");
  const text = checkLsText({ reason: parsed.data.reason });
  if (!text.ok) return text;
  const review = await loadReview(executor, ctx.caseId, parsed.data.reviewId);
  if (!review) return fail("non_trovato", "Proposta non trovata.");
  if (review.decision !== "proposto") return fail("gate_gia_deciso", "Su questa proposta c'è già una decisione.");
  const run = await runCommand(
    executor,
    [
      gateReviewDecideSql({
        reviewId: review.id,
        caseId: ctx.caseId,
        decision: "respinto",
        oldApprovals: review.approvals,
        approvals: review.approvals,
        catalogVersion: null,
        snapshotHash: null,
        notes: parsed.data.reason,
      }),
      toStatement(
        eventInsertSql({
          type: "gate.respinto",
          workspaceId: ctx.workspaceId,
          caseId: ctx.caseId,
          actor: eventActorFrom(ctx.actor),
          targetType: "gate",
          targetId: review.id,
          fromState: "proposto",
          toState: "respinto",
          payload: { gate: review.gate, summary_text_hash: review.summaryTextHash, ruolo },
        }),
      ),
    ],
    GATE_MESSAGES,
  );
  return run.ok ? ok({ reviewId: review.id }) : run;
}

export interface GateReviewSummary {
  id: string;
  gate: GateKey;
  decision: GateDecision;
  proposedAt: string | null;
  decidedAt: string | null;
  catalogVersion: number | null;
  /** Solo ruoli, date e metodo: nessun nome. */
  signatures: { ruolo: string; at: string; metodo: string }[];
  writtenEvidence: boolean;
}

/** Storico delle proposte e delle decisioni sul gate (Avanzamento, MCP). */
export async function listGateReviews(executor: UcExecutor, caseId: string): Promise<GateReviewSummary[]> {
  if (!isUuid(caseId)) return [];
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT id, gate_key, decision, proposed_at, decided_at, catalog_version, approvals, written_evidence_file_id IS NOT NULL AS evidence
FROM uc_gate_reviews WHERE case_id = ${cast(caseId, "uuid")} ORDER BY created_at DESC`),
  ]);
  return rows.map((r) => ({
    id: String(r.id),
    gate: String(r.gate_key) as GateKey,
    decision: String(r.decision) as GateDecision,
    proposedAt: rowDate(r.proposed_at)?.toISOString() ?? null,
    decidedAt: rowDate(r.decided_at)?.toISOString() ?? null,
    catalogVersion: rowNumber(r.catalog_version),
    signatures: (rowJson<Approval[]>(r.approvals) ?? []).map((a) => ({ ruolo: String(a.ruolo), at: String(a.at), metodo: String(a.metodo) })),
    writtenEvidence: r.evidence === true,
  }));
}

export interface CatalogVersionSummary {
  version: number;
  reason: string;
  createdAt: string | null;
  snapshotHash: string;
  changeNote: string | null;
  diff: { added: number; removed: number; changed: number };
}

/** Versioni congelate del catalogo, senza la fotografia. */
export async function listCatalogVersions(executor: UcExecutor, caseId: string): Promise<CatalogVersionSummary[]> {
  if (!isUuid(caseId)) return [];
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT version, reason, created_at, snapshot_hash, change_note,
  jsonb_array_length(coalesce(diff -> 'added', '[]'::jsonb)) AS added, jsonb_array_length(coalesce(diff -> 'removed', '[]'::jsonb)) AS removed,
  jsonb_array_length(coalesce(diff -> 'changed', '[]'::jsonb)) AS changed
FROM uc_catalog_versions WHERE case_id = ${cast(caseId, "uuid")} ORDER BY version DESC`),
  ]);
  return rows.map((r) => ({
    version: rowNumber(r.version) ?? 0,
    reason: String(r.reason),
    createdAt: rowDate(r.created_at)?.toISOString() ?? null,
    snapshotHash: String(r.snapshot_hash),
    changeNote: rowString(r.change_note),
    diff: { added: rowNumber(r.added) ?? 0, removed: rowNumber(r.removed) ?? 0, changed: rowNumber(r.changed) ?? 0 },
  }));
}

// ── Blocchi ───────────────────────────────────────────────────────────

interface BlockerRow {
  id: string;
  key: string;
  status: BlockerStatus;
  evidence: Record<string, Json> | null;
  approvals: Approval[];
}

async function loadBlocker(executor: UcExecutor, caseId: string, blockerId: string): Promise<BlockerRow | null> {
  if (!isUuid(blockerId)) return null;
  const [[row]] = await executor.batch([
    toStatement(ucSql`SELECT id, key, status, evidence, approvals FROM uc_blockers WHERE id = ${cast(blockerId, "uuid")} AND case_id = ${cast(caseId, "uuid")}`),
  ]);
  if (!row) return null;
  const evidence = rowJson(row.evidence);
  const approvals = rowJson<Approval[]>(row.approvals);
  return {
    id: String(row.id),
    key: String(row.key),
    status: String(row.status) as BlockerStatus,
    evidence: evidence && typeof evidence === "object" && !Array.isArray(evidence) ? (evidence as Record<string, Json>) : null,
    approvals: Array.isArray(approvals) ? approvals : [],
  };
}

/** Righe `uc_item_blockers` delle voci collegate al blocco, con lo stato delle voci e dei blocchi del caso. */
async function blockerGraph(executor: UcExecutor, caseId: string, blockerId: string): Promise<{ links: { itemId: string; blockerId: string }[]; itemStatus: Map<string, ItemStatus>; blockerStatus: Map<string, BlockerStatus>; blockerKeys: Map<string, string> }> {
  const c = cast(caseId, "uuid");
  const [linkRows, blockerRows] = await executor.batch([
    toStatement(ucSql`SELECT ib.item_id, ib.blocker_id, i.status FROM uc_item_blockers ib JOIN uc_items i ON i.id = ib.item_id
WHERE i.case_id = ${c} AND i.deleted_at IS NULL
  AND ib.item_id IN (SELECT x.item_id FROM uc_item_blockers x WHERE x.blocker_id = ${cast(blockerId, "uuid")})`),
    toStatement(ucSql`SELECT id, key, status FROM uc_blockers WHERE case_id = ${c}`),
  ]);
  return {
    links: linkRows.map((r: Row) => ({ itemId: String(r.item_id), blockerId: String(r.blocker_id) })),
    itemStatus: new Map(linkRows.map((r: Row) => [String(r.item_id), String(r.status) as ItemStatus])),
    blockerStatus: new Map(blockerRows.map((r: Row) => [String(r.id), String(r.status) as BlockerStatus])),
    blockerKeys: new Map(blockerRows.map((r: Row) => [String(r.id), String(r.key)])),
  };
}

/**
 * `expectedTextHash`: l'impronta delle prove lette da chi firma la scheda
 * privacy (`/firme` e il link). Si confronta con le prove caricate qui, che la
 * scrittura tiene ferme (`oldApprovals`): prove nuove tra la lettura e la firma
 * danno «testo_cambiato».
 */
const ResolveSchema = z.object({
  blockerId: z.string().regex(UUID),
  evidence: z.record(z.string(), z.unknown()).nullish(),
  expectedTextHash: z.string().regex(/^[0-9a-f]{64}$/).nullish(),
});

const FILE_KEYS = ["file_id"];

export interface ResolveBlockerResult {
  blockerId: string;
  key: string;
  complete: boolean;
  waitingFor: "lateral_space" | "cliente" | null;
  message: string | null;
  unblockedItems: number;
}

/**
 * Scioglimento di un blocco (§3.5). Prove obbligatorie per chiave; per `a8` due
 * firme (ls_lead e approvatore privacy) sulla stessa prova: con una sola il
 * blocco resta attivo («In attesa della conferma del cliente»). Con lo
 * scioglimento, nello stesso batch: le voci senza altri blocchi attivi passano a
 * `da_chiedere` (riga 27), un evento per voce, la campanella LS. Senza
 * `evidence` vale la prova già registrata (seconda firma). `signer` serve al
 * link del firmatario privacy (WP7b).
 */
export async function resolveBlocker(executor: UcExecutor, ctx: UcCommandContext, input: unknown, signer?: Signer): Promise<Result<ResolveBlockerResult>> {
  const parsed = ResolveSchema.safeParse(input);
  if (!parsed.success) return fail("dati_non_validi", "Blocco non valido.");
  const now = ctx.now ?? new Date();
  const [caseRows] = await executor.batch([caseCoreSql(ctx.workspaceId, ctx.caseId)]);
  const core = parseCaseCore(caseRows[0]);
  if (!core) return fail("non_trovato", CASE_NOT_FOUND);
  if (core.status === "chiuso") return fail("caso_chiuso", "Il caso è chiuso: i blocchi non cambiano più.");
  const blocker = await loadBlocker(executor, ctx.caseId, parsed.data.blockerId);
  if (!blocker) return fail("non_trovato", "Blocco non trovato.");
  const evidence = (parsed.data.evidence as Record<string, Json> | null | undefined) ?? blocker.evidence;
  for (const k of FILE_KEYS) {
    const fileId = evidence?.[k];
    if (typeof fileId === "string" && !(await usableCaseFile(executor, ctx.caseId, fileId))) {
      return fail("prova_non_valida", "Il file di prova deve essere un file utilizzabile del caso.");
    }
  }
  if (evidence) {
    const text = checkLsText(evidence);
    if (!text.ok) return text;
  }
  const def = { key: blocker.key, permanent: isPermanentBlocker({ key: blocker.key, permanent: blocker.status === "permanente" }) };
  // Dal link del firmatario privacy (WP7b) l'attore del contesto è `owner_link` con designazione `privacy`.
  const first = checkResolveBlocker({ def, status: blocker.status, evidence, approvals: [], actor: ctx.actor, user: ctx.user });
  if (!first.ok) return first;
  const evidenceHash = first.value.evidenceHash;
  const onSameEvidence = blocker.approvals.filter((a) => a.text_hash === evidenceHash);
  let approvals: Approval[];
  let ruolo: string;
  if (blocker.key === A8_BLOCKER_KEY) {
    const who = signer ? ok(signer) : accountSigner(ctx);
    if (!who.ok) return who;
    const sigCtx = await loadSignatureContext(executor, core, ctx.lsDomains);
    const added = addSignature({ purpose: "a8", approvals: onSameEvidence, signer: who.value, ctx: sigCtx, now, textHash: evidenceHash, expectedTextHash: parsed.data.expectedTextHash ?? evidenceHash });
    if (!added.ok) return added;
    approvals = added.value.approvals;
    ruolo = added.value.approval.ruolo;
  } else {
    const userId = actorUserId(ctx);
    if (!userId) return fail("attore_non_ammesso", "Solo il Responsabile del caso scioglie questo blocco.");
    approvals = [{ ruolo: "ls_lead", user_id: userId, contact_id: null, at: now.toISOString(), text_hash: evidenceHash, metodo: "account" }];
    ruolo = "ls_lead";
  }
  const result = checkResolveBlocker({ def, status: blocker.status, evidence, approvals, actor: ctx.actor, user: ctx.user });
  if (!result.ok) return result;
  const actor = eventActorFrom(ctx.actor);
  const resolvedBy = actorUserId(ctx);

  if (!result.value.complete) {
    const run = await runCommand(
      executor,
      [
        caseRevisionSql({ workspaceId: ctx.workspaceId, caseId: ctx.caseId, expectStatus: [core.status], bump: false }),
        blockerUpdateSql({ blockerId: blocker.id, caseId: ctx.caseId, fromStatus: "attivo", oldApprovals: blocker.approvals, status: "attivo", evidence, approvals, resolved: null }),
        toStatement(
          eventInsertSql({ type: "blocco.firmato", workspaceId: ctx.workspaceId, caseId: ctx.caseId, actor, targetType: "blocco", targetId: blocker.id, payload: { blocker_key: blocker.key, ruolo, complete: false } }),
        ),
      ],
      GATE_MESSAGES,
    );
    if (!run.ok) return run;
    return ok({ blockerId: blocker.id, key: blocker.key, complete: false, waitingFor: result.value.waitingFor, message: result.value.message, unblockedItems: 0 });
  }

  const graph = await blockerGraph(executor, ctx.caseId, blocker.id);
  const blockerStatus = new Map(graph.blockerStatus);
  blockerStatus.set(blocker.id, "sciolto");
  const toUnblock = itemsToUnblock({ resolvedBlockerId: blocker.id, links: graph.links, blockerStatus, itemStatus: graph.itemStatus });
  const statements: UcStatement[] = [
    caseRevisionSql({ workspaceId: ctx.workspaceId, caseId: ctx.caseId, expectStatus: [core.status] }),
    blockerUpdateSql({ blockerId: blocker.id, caseId: ctx.caseId, fromStatus: "attivo", oldApprovals: blocker.approvals, status: "sciolto", evidence, approvals, resolvedByUserId: resolvedBy, resolved: true }),
  ];
  if (toUnblock.length > 0) {
    const [itemRows] = await executor.batch([itemSnapshotsSql(ctx.caseId, { itemIds: toUnblock })]);
    const items = new Map(itemRows.map((r) => rowToLoadedItem(r)).map((l) => [l.snapshot.id, l.snapshot]));
    const planned = planItemTransitions({
      items,
      requests: toUnblock.map((itemId) => ({ itemId, to: "da_chiedere" as const, trigger: "blocco_sciolto" as const, blockerKeys: [], guards: [NO_ACTIVE_BLOCKER], guardGroup: "sblocco" })),
      actor: { type: "sistema", job: "blocchi" },
      now,
      case: { status: core.status, statusBeforeSuspension: core.statusBeforeSuspension },
    });
    if (!planned.ok) return planned;
    statements.push(...transitionStatements({ workspaceId: ctx.workspaceId, caseId: ctx.caseId, actor: { type: "sistema", job: "blocchi" }, planned: planned.value }));
  }
  statements.push(
    toStatement(
      eventInsertSql({
        type: "blocco.sciolto",
        workspaceId: ctx.workspaceId,
        caseId: ctx.caseId,
        actor,
        targetType: "blocco",
        targetId: blocker.id,
        fromState: "attivo",
        toState: "sciolto",
        payload: { blocker_key: blocker.key, items: toUnblock.length, ruolo, complete: true },
      }),
    ),
    toStatement(
      enqueueForLsMembersSql({
        workspaceId: ctx.workspaceId,
        caseId: ctx.caseId,
        templateKey: "blocco_sciolto",
        payload: { blocker_key: blocker.key, blocker_id: blocker.id, items: toUnblock.length, case_code: core.code },
        dedupeKeyPrefix: bellPrefix.bloccoSciolto(blocker.id),
      }),
    ),
  );
  const run = await runCommand(executor, statements, GATE_MESSAGES);
  if (!run.ok) return run;
  return ok({ blockerId: blocker.id, key: blocker.key, complete: true, waitingFor: null, message: null, unblockedItems: toUnblock.length });
}

const ManualBlockerSchema = z.object({ blockerId: z.string().regex(UUID), itemId: z.string().regex(UUID) });

/**
 * Blocco manuale su una voce (es. `costi_art_8_4`, che non ha scope): solo
 * ls_lead. La riga ha `origin = 'manuale'`; se il blocco è attivo la voce passa
 * subito a `bloccata` (righe 3, 9, 13, 25, 30), salvo se è non applicabile.
 */
export async function addManualBlocker(executor: UcExecutor, ctx: UcCommandContext, input: unknown): Promise<Result<{ itemId: string; blocked: boolean }>> {
  const parsed = ManualBlockerSchema.safeParse(input);
  if (!parsed.success) return fail("dati_non_validi", "Scegli il blocco e la voce.");
  const [caseRows, itemRows] = await executor.batch([caseCoreSql(ctx.workspaceId, ctx.caseId), itemSnapshotsSql(ctx.caseId, { itemIds: [parsed.data.itemId] })]);
  const core = parseCaseCore(caseRows[0]);
  if (!core) return fail("non_trovato", CASE_NOT_FOUND);
  if (core.status === "chiuso") return fail("caso_chiuso", "Il caso è chiuso: i blocchi non cambiano più.");
  const loaded = itemRows[0] ? rowToLoadedItem(itemRows[0]) : null;
  if (!loaded) return fail("voce_non_trovata", "Voce non trovata in questo caso.");
  const blocker = await loadBlocker(executor, ctx.caseId, parsed.data.blockerId);
  if (!blocker) return fail("non_trovato", "Blocco non trovato.");
  const checked = checkManualBlockerLink({
    blockerStatus: blocker.status,
    itemStatus: loaded.snapshot.status,
    alreadyLinked: loaded.extra.blockerLinks.some((l) => l.blockerId === blocker.id),
    actor: ctx.actor,
    user: ctx.user,
  });
  if (!checked.ok) return checked;
  const now = ctx.now ?? new Date();
  const statements: UcStatement[] = [
    caseRevisionSql({ workspaceId: ctx.workspaceId, caseId: ctx.caseId, expectStatus: [core.status] }),
    itemBlockerLinksInsertSql([{ itemId: loaded.snapshot.id, blockerId: blocker.id, origin: "manuale" }]),
  ];
  if (checked.value.blockNow) {
    const keys = [...new Set([...loaded.snapshot.activeBlockerKeys, blocker.key])];
    const planned = planItemTransitions({
      items: new Map([[loaded.snapshot.id, loaded.snapshot]]),
      requests: [{ itemId: loaded.snapshot.id, to: "bloccata", trigger: "blocco_attivato", blockerKeys: keys }],
      actor: { type: "sistema", job: "blocchi" },
      now,
      case: { status: core.status, statusBeforeSuspension: core.statusBeforeSuspension },
    });
    if (!planned.ok) return planned;
    statements.push(...transitionStatements({ workspaceId: ctx.workspaceId, caseId: ctx.caseId, actor: { type: "sistema", job: "blocchi" }, planned: planned.value }));
  }
  statements.push(
    toStatement(
      eventInsertSql({
        type: "blocco.attivato",
        workspaceId: ctx.workspaceId,
        caseId: ctx.caseId,
        actor: eventActorFrom(ctx.actor),
        targetType: "voce",
        targetId: loaded.snapshot.id,
        payload: { blocker_key: blocker.key, items: 1, ruolo: "ls_lead", complete: checked.value.blockNow },
      }),
    ),
  );
  const run = await runCommand(executor, statements, GATE_MESSAGES);
  return run.ok ? ok({ itemId: loaded.snapshot.id, blocked: checked.value.blockNow }) : run;
}

const ReactivateSchema = z.object({ blockerId: z.string().regex(UUID), reason: z.string().trim().min(3, "Scrivi il motivo.").max(2000) });

/**
 * Riattivazione di un blocco sciolto (es. scheda A.8 ritirata), solo ls_lead:
 * le voci collegate che non sono non applicabili tornano `bloccata` (righe 3, 9,
 * 13, 25, 30) e escono dalle richieste; per `a8` la zona personale si richiude
 * per tutti. Le firme raccolte si azzerano; il caso non si sospende da solo.
 */
export async function reactivateBlocker(executor: UcExecutor, ctx: UcCommandContext, input: unknown): Promise<Result<{ blockerId: string; blockedItems: number }>> {
  const parsed = ReactivateSchema.safeParse(input);
  if (!parsed.success) return fail("dati_non_validi", parsed.error.issues[0]?.message ?? "Scrivi il motivo.");
  const text = checkLsText({ reason: parsed.data.reason });
  if (!text.ok) return text;
  const now = ctx.now ?? new Date();
  const [caseRows] = await executor.batch([caseCoreSql(ctx.workspaceId, ctx.caseId)]);
  const core = parseCaseCore(caseRows[0]);
  if (!core) return fail("non_trovato", CASE_NOT_FOUND);
  if (core.status === "chiuso") return fail("caso_chiuso", "Il caso è chiuso: i blocchi non cambiano più.");
  const blocker = await loadBlocker(executor, ctx.caseId, parsed.data.blockerId);
  if (!blocker) return fail("non_trovato", "Blocco non trovato.");
  const checked = checkReactivateBlocker({ def: { key: blocker.key, permanent: false }, status: blocker.status, actor: ctx.actor, user: ctx.user, reason: parsed.data.reason });
  if (!checked.ok) return checked;
  const graph = await blockerGraph(executor, ctx.caseId, blocker.id);
  const toBlock = itemsToBlock({ reactivatedBlockerId: blocker.id, links: graph.links, itemStatus: graph.itemStatus });
  const statements: UcStatement[] = [
    caseRevisionSql({ workspaceId: ctx.workspaceId, caseId: ctx.caseId, expectStatus: [core.status] }),
    blockerUpdateSql({ blockerId: blocker.id, caseId: ctx.caseId, fromStatus: "sciolto", oldApprovals: blocker.approvals, status: "attivo", approvals: [], resolved: false }),
  ];
  if (toBlock.length > 0) {
    const [itemRows] = await executor.batch([itemSnapshotsSql(ctx.caseId, { itemIds: toBlock })]);
    const items = new Map(itemRows.map((r) => rowToLoadedItem(r)).map((l) => [l.snapshot.id, l.snapshot]));
    const planned = planItemTransitions({
      items,
      requests: toBlock.map((itemId) => {
        const keys = new Set(items.get(itemId)?.activeBlockerKeys ?? []);
        keys.add(blocker.key);
        return { itemId, to: "bloccata" as const, trigger: "blocco_attivato" as const, blockerKeys: [...keys] };
      }),
      actor: { type: "sistema", job: "blocchi" },
      now,
      case: { status: core.status, statusBeforeSuspension: core.statusBeforeSuspension },
    });
    if (!planned.ok) return planned;
    statements.push(...transitionStatements({ workspaceId: ctx.workspaceId, caseId: ctx.caseId, actor: { type: "sistema", job: "blocchi" }, planned: planned.value }));
  }
  if (blocker.key === A8_BLOCKER_KEY) statements.push(closePersonalZoneSql(ctx.caseId));
  statements.push(
    toStatement(
      eventInsertSql({
        type: "blocco.riattivato",
        workspaceId: ctx.workspaceId,
        caseId: ctx.caseId,
        actor: eventActorFrom(ctx.actor),
        targetType: "blocco",
        targetId: blocker.id,
        fromState: "sciolto",
        toState: "attivo",
        payload: { blocker_key: blocker.key, items: toBlock.length, ruolo: "ls_lead" },
      }),
    ),
  );
  const run = await runCommand(executor, statements, GATE_MESSAGES);
  if (!run.ok) return run;
  return ok({ blockerId: blocker.id, blockedItems: toBlock.length });
}
