/**
 * Comandi sulle voci del catalogo (PIANO §3.2, §3.3, §3.5, §3.6, §5.3).
 *
 * `applyItemTransitions` è la sola strada per cambiare lo stato di una voce:
 * legge le voci, chiama `checkItemTransition` per ognuna, poi esegue un batch
 * con la revisione del caso, i CAS raggruppati (`uc_require`), gli eventi, lo
 * stato delle righe `uc_request_items` e le istruzioni del chiamante (`before` /
 * `after`), tutto o niente. Lo usano anche richieste (WP7a), API pubbliche
 * (WP7b) e cron (WP11).
 *
 * Gli altri comandi (validazione, chiarimenti, esiti, NA a due firme, deroghe,
 * ripieghi, riaperture, inserimenti di Lateral Space, commenti, voci nuove e
 * riclassificazione) costruiscono le loro transizioni e passano da qui.
 *
 * Modulo senza import dell'app: l'esecutore arriva da fuori.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { answerContext, normalizeAnswer } from "../../uc/answers/normalize.ts";
import { checkReclassification, isPermanentBlocker, parseBlockerScope, type BlockerDef, type ItemBlockerFacts } from "../../uc/blockers.ts";
import { checkCaseTransition } from "../../uc/case-state.ts";
import { computeStaleAt, defaultRequiresValidityPeriod, romeDateOf } from "../../uc/freshness.ts";
import { checkFallback, checkWaiver, gateScopeForItem, isItemOk, isRequired } from "../../uc/gates.ts";
import { checkItemTransition, checkNaProposal, checkNaRejection, type ItemPatch, type ItemSideEffect } from "../../uc/item-state.ts";
import { addSignature, can, naSignaturePatch, type Signer } from "../../uc/permissions.ts";
import { sha256Hex, stableStringify } from "../../uc/snapshot.ts";
import { caseBlockersSql, caseCoreSql, parseCaseCore, rowToCaseBlocker, type CaseCore } from "../../uc/sql/readiness.ts";
import { cast, join, jsonb, raw, requireRows, toStatement, ucSql, type SqlFragment, type UcStatement } from "../../uc/sql/statement.ts";
import {
  NO_ACTIVE_BLOCKER,
  NO_OPEN_CLARIFICATION,
  answerInsertSql,
  caseRevisionSql,
  caseTransitionSql,
  commentInsertSql,
  fallbackIs,
  itemBlockerLinksDeleteSql,
  itemBlockerLinksInsertSql,
  itemSetSql,
  itemSnapshotsSql,
  itemUpdateSql,
  naSignatureColumnsAre,
  planItemTransitions,
  plannedSideEffects,
  requestItemsStateSql,
  rowToLoadedItem,
  transitionStatements,
  validationInsertSql,
  waiverIs,
  type LoadedItem,
  type PlannedTransition,
  type TransitionRequest,
} from "../../uc/sql/transitions.ts";
import { checkItemKey } from "../../uc/template/ids.ts";
import { fail, ok, type Actor, type Fallback, type Json, type Result, type Waiver } from "../../uc/types.ts";
import {
  CONFIDENCE,
  ITEM_KINDS,
  ITEM_SECTIONS,
  LEVERS,
  PERIMETERS,
  PERSONAL_PRIVACY_CLASSES,
  PHASES,
  PRIORITIES,
  PRIVACY_CLASSES,
  RESPONSE_TYPES,
  SOURCE_BASIS,
  VALUE_VISIBILITY,
  HEALTH_PRIVACY_CLASS,
  type ItemStatus,
  type PrivacyClass,
} from "../../uc/vocab.ts";
import { bellPrefix, dedupeKey } from "../../uc/notify/dedupe.ts";
import { eventActorFrom, eventInsertSql } from "./uc-events.ts";
import { enqueueForLsMembersSql, enqueueSql } from "./uc-notifications.ts";
import { accountSigner, actorRoles, actorUserId, checkLsText, isUuid, loadCaseReadiness, loadSignatureContext, runCommand, type UcCommandContext } from "./uc-cases.ts";
import type { UcExecutor } from "../uc-executor.ts";
import { UUID } from "../../uc/ids.ts";
import { naApprovalHash } from "../../uc/views/approvals.ts";

const ItemIdSchema = z.string().regex(UUID, "Voce non valida.");

/** Messaggi dei codici dei batch delle voci. */
export const ITEM_MESSAGES: Readonly<Record<string, string>> = {
  conflitto: "Qualcuno ha appena modificato questa voce. Aggiorna la pagina e riprova.",
  caso_chiuso: "Il caso è chiuso: le voci non cambiano più.",
  chiave_in_uso: "Esiste già una voce con questa chiave nel caso.",
  commento_non_trovato: "Chiarimento non trovato o già risolto.",
};

const CASE_NOT_FOUND = "Caso non trovato.";
const ITEM_NOT_FOUND = "Voce non trovata in questo caso.";

// ── Lettura ───────────────────────────────────────────────────────────

/** Caso e voci indicate, con tutto quello che serve ai controlli puri. */
export async function loadItems(executor: UcExecutor, workspaceId: string, caseId: string, itemIds: readonly string[]): Promise<{ core: CaseCore; items: Map<string, LoadedItem> } | null> {
  if (!isUuid(workspaceId) || !isUuid(caseId) || itemIds.some((id) => !isUuid(id))) return null;
  const [caseRows, itemRows] = await executor.batch([caseCoreSql(workspaceId, caseId), itemSnapshotsSql(caseId, { itemIds: [...new Set(itemIds)] })]);
  const core = parseCaseCore(caseRows[0]);
  if (!core) return null;
  return { core, items: new Map(itemRows.map((r) => rowToLoadedItem(r)).map((l) => [l.snapshot.id, l])) };
}

async function loadOne(executor: UcExecutor, ctx: UcCommandContext, itemId: string): Promise<Result<{ core: CaseCore; item: LoadedItem }>> {
  if (!isUuid(itemId)) return fail("dati_non_validi", "Voce non valida.");
  const loaded = await loadItems(executor, ctx.workspaceId, ctx.caseId, [itemId]);
  if (!loaded) return fail("non_trovato", CASE_NOT_FOUND);
  const item = loaded.items.get(itemId);
  if (!item) return fail("voce_non_trovata", ITEM_NOT_FOUND);
  return ok({ core: loaded.core, item });
}

/** Definizioni dei blocchi del caso (per la riclassificazione) e il loro stato. */
async function loadBlockerDefs(executor: UcExecutor, caseId: string): Promise<{ defs: BlockerDef[]; status: Map<string, "attivo" | "sciolto" | "permanente">; ids: Map<string, string> }> {
  const [rows] = await executor.batch([caseBlockersSql(caseId)]);
  const blockers = rows.map(rowToCaseBlocker);
  return {
    defs: blockers.map((b) => ({
      key: b.key,
      label: b.label,
      scope: parseBlockerScope(b.scope),
      permanent: isPermanentBlocker({ key: b.key, permanent: b.status === "permanente" }),
      fallbackAllowed: b.fallbackAllowed,
    })),
    status: new Map(blockers.map((b) => [b.key, b.status])),
    ids: new Map(blockers.map((b) => [b.key, b.id])),
  };
}

// ── Transizioni ───────────────────────────────────────────────────────

export interface ApplyTransitionsInput {
  /** Voci da leggere. */
  itemIds: readonly string[];
  /** Transizioni, oppure una funzione che le costruisce dalle voci lette. */
  transitions: readonly TransitionRequest[] | ((loaded: ReadonlyMap<string, LoadedItem>, core: CaseCore) => Result<TransitionRequest[]>);
  /** Istruzioni prima delle transizioni (es. la risposta nuova). */
  before?: readonly UcStatement[] | ((planned: readonly PlannedTransition[], loaded: ReadonlyMap<string, LoadedItem>, core: CaseCore) => readonly UcStatement[]);
  /** Istruzioni dopo le transizioni (es. commento, verifica, notifica). */
  after?: readonly UcStatement[] | ((planned: readonly PlannedTransition[], loaded: ReadonlyMap<string, LoadedItem>, core: CaseCore) => readonly UcStatement[]);
  messages?: Readonly<Record<string, string>>;
}

export interface AppliedTransitions {
  applied: { itemId: string; key: string; from: ItemStatus; to: ItemStatus; row: string }[];
  sideEffects: ItemSideEffect[];
  /** Una voce di R(G1) ha lasciato il verde o il blu con il caso oltre G1. */
  gateReconfirm: boolean;
}

/**
 * Applica le transizioni in un solo batch (vedi l'intestazione del modulo).
 * Effetti gestiti qui: `caso_in_raccolta` (primo invio: bozza → raccolta) e
 * `campanella_dato_scaduto`. `chiarimento_al_referente` e `richiesta_conferma`
 * li scrive il chiamante in `after`/`before`.
 */
export async function applyItemTransitions(executor: UcExecutor, ctx: UcCommandContext, input: ApplyTransitionsInput): Promise<Result<AppliedTransitions>> {
  if (input.itemIds.length === 0) return fail("dati_non_validi", "Nessuna voce indicata.");
  if (input.itemIds.length > 5000) return fail("dati_non_validi", "Troppe voci in una volta.");
  const loaded = await loadItems(executor, ctx.workspaceId, ctx.caseId, input.itemIds);
  if (!loaded) return fail("non_trovato", CASE_NOT_FOUND);
  for (const id of input.itemIds) if (!loaded.items.get(id)) return fail("voce_non_trovata", ITEM_NOT_FOUND);
  const requests = typeof input.transitions === "function" ? input.transitions(loaded.items, loaded.core) : ok([...input.transitions]);
  if (!requests.ok) return requests;
  const now = ctx.now ?? new Date();
  const core = loaded.core;
  const planned = planItemTransitions({
    items: new Map([...loaded.items].map(([id, l]) => [id, l.snapshot])),
    requests: requests.value,
    actor: ctx.actor,
    user: ctx.user,
    now,
    case: { status: core.status, statusBeforeSuspension: core.statusBeforeSuspension },
    designatedOwnerContactId: core.designated.owner,
  });
  if (!planned.ok) return planned;
  const sideEffects = plannedSideEffects(planned.value);
  const resolve = (part: ApplyTransitionsInput["before"]) => (typeof part === "function" ? part(planned.value, loaded.items, core) : (part ?? []));
  const statements: UcStatement[] = [
    caseRevisionSql({ workspaceId: ctx.workspaceId, caseId: ctx.caseId, expectStatus: [core.status] }),
    ...resolve(input.before),
    ...transitionStatements({ workspaceId: ctx.workspaceId, caseId: ctx.caseId, actor: ctx.actor, planned: planned.value }),
  ];
  if (sideEffects.includes("caso_in_raccolta") && core.status === "bozza") {
    const toRaccolta = checkCaseTransition({
      from: "bozza",
      to: "raccolta",
      actor: { type: "sistema", job: "creazione" },
      approvedGates: new Set(),
      enteredAt: core.statusChangedAt,
      now,
      availableGates: [],
      statusBeforeSuspension: null,
    });
    if (!toRaccolta.ok) return toRaccolta;
    statements.push(
      caseTransitionSql({
        workspaceId: ctx.workspaceId,
        caseId: ctx.caseId,
        from: "bozza",
        statusBeforeSuspension: null,
        patch: toRaccolta.value.patch,
        actor: { type: "sistema" },
        reasonCode: "primo_invio",
      }),
    );
  }
  for (const p of planned.value) {
    if (!p.plan.sideEffects.includes("campanella_dato_scaduto")) continue;
    statements.push(
      toStatement(
        enqueueForLsMembersSql({
          workspaceId: ctx.workspaceId,
          caseId: ctx.caseId,
          templateKey: "dato_scaduto",
          payload: { item_id: p.item.id, item_keys: [p.item.key], case_code: core.code },
          dedupeKeyPrefix: bellPrefix.datoScaduto(p.item.id, now),
        }),
      ),
    );
  }
  statements.push(...resolve(input.after));
  const run = await runCommand(executor, statements, { ...ITEM_MESSAGES, ...input.messages });
  if (!run.ok) return run;
  return ok({
    applied: planned.value.map((p) => ({ itemId: p.item.id, key: p.item.key, from: p.from, to: p.plan.patch.status, row: p.plan.row })),
    sideEffects,
    gateReconfirm: planned.value.some((p) => p.plan.gateReconfirm),
  });
}

/** Esiti di Lateral Space applicabili in blocco dal catalogo. */
const BULK_TRIGGERS = ["esito_mancante", "esito_parziale", "riapri"] as const;

const TransitionItemsSchema = z.object({
  itemIds: z.array(ItemIdSchema).min(1).max(500),
  trigger: z.enum(BULK_TRIGGERS),
  reason: z.string().trim().min(3, "Scrivi il motivo: resta visibile sulla voce.").max(500),
});

/**
 * Esiti in blocco (`transitionItems`): mancante, parziale o riapertura. La
 * destinazione dipende dal motivo; una riapertura con un blocco attivo torna
 * sotto il lucchetto.
 */
export async function transitionItems(executor: UcExecutor, ctx: UcCommandContext, input: unknown): Promise<Result<AppliedTransitions>> {
  const parsed = TransitionItemsSchema.safeParse(input);
  if (!parsed.success) return fail("dati_non_validi", parsed.error.issues[0]?.message ?? "Controlla le voci e il motivo.");
  const { itemIds, trigger, reason } = parsed.data;
  const text = checkLsText({ reason });
  if (!text.ok) return text;
  return applyItemTransitions(executor, ctx, {
    itemIds,
    transitions: (items) =>
      ok(
        itemIds.map((itemId) => {
          const item = items.get(itemId)!.snapshot;
          const to: ItemStatus = trigger === "esito_parziale" ? "parziale" : trigger === "esito_mancante" ? "mancante" : item.activeBlockerKeys.length > 0 ? "bloccata" : "da_chiedere";
          return { itemId, to, trigger, reason };
        }),
      ),
  });
}

const ReasonSchema = z.object({ itemId: ItemIdSchema, reason: z.string().trim().min(3, "Scrivi il motivo: resta visibile sulla voce.").max(500) });

/** Esito «parziale» (riga 20). */
export async function markPartial(executor: UcExecutor, ctx: UcCommandContext, input: unknown): Promise<Result<AppliedTransitions>> {
  const parsed = ReasonSchema.safeParse(input);
  if (!parsed.success) return fail("dati_non_validi", parsed.error.issues[0]?.message ?? "Scrivi il motivo.");
  return transitionItems(executor, ctx, { itemIds: [parsed.data.itemId], trigger: "esito_parziale", reason: parsed.data.reason });
}

/** Esito «mancante» (righe 7c, 17, 21). */
export async function markMissing(executor: UcExecutor, ctx: UcCommandContext, input: unknown): Promise<Result<AppliedTransitions>> {
  const parsed = ReasonSchema.safeParse(input);
  if (!parsed.success) return fail("dati_non_validi", parsed.error.issues[0]?.message ?? "Scrivi il motivo.");
  return transitionItems(executor, ctx, { itemIds: [parsed.data.itemId], trigger: "esito_mancante", reason: parsed.data.reason });
}

/** Riapre una voce non applicabile (righe 26 e 26b): le firme NA si azzerano, restano negli eventi. */
export async function reopenItem(executor: UcExecutor, ctx: UcCommandContext, input: unknown): Promise<Result<AppliedTransitions>> {
  const parsed = ReasonSchema.safeParse(input);
  if (!parsed.success) return fail("dati_non_validi", parsed.error.issues[0]?.message ?? "Scrivi il motivo.");
  return transitionItems(executor, ctx, { itemIds: [parsed.data.itemId], trigger: "riapri", reason: parsed.data.reason });
}

// ── Validazione e chiarimenti ─────────────────────────────────────────

const ItemOnlySchema = z.object({ itemId: ItemIdSchema });

/**
 * Firma di una voce. `expectedTextHash` è l'impronta del testo letto da chi
 * firma (`/firme` e il link, `views/approvals.ts`): si confronta con la riga
 * caricata qui, che le guardie della scrittura tengono ferma. Così il testo
 * letto e la firma sono un passo solo: se Lateral Space ripropone tra la
 * lettura e la firma, la firma non va sul testo nuovo («testo_cambiato»).
 */
const SignItemSchema = z.object({ itemId: ItemIdSchema, expectedTextHash: z.string().regex(/^[0-9a-f]{64}$/).nullish() });

const TEXT_CHANGED = "Il testo da firmare è cambiato: rileggi e firma di nuovo.";

const RejectNaSchema = ReasonSchema.extend({ expectedTextHash: z.string().regex(/^[0-9a-f]{64}$/).nullish() });

/** La proposta «non si applica» caricata è quella del testo letto (`naApprovalHash` di `/firme` e del link). */
function naProposalIs(s: { id: string; na: { reason: string | null; proposedAt: Date | null } }, expectedTextHash: string): boolean {
  const { reason, proposedAt } = s.na;
  return Boolean(reason && proposedAt) && naApprovalHash({ itemId: s.id, reason: reason!, proposedAt: proposedAt! }) === expectedTextHash;
}

/**
 * Validazione (righe 16 e 18) con tutte le guardie dei quattro occhi
 * (`canValidate`). Nel batch: CAS sulla risposta letta, nessun chiarimento
 * aperto, la verifica umana in `uc_validations` e il suo evento.
 */
export async function validateItem(executor: UcExecutor, ctx: UcCommandContext, input: unknown): Promise<Result<AppliedTransitions>> {
  const parsed = ItemOnlySchema.safeParse(input);
  if (!parsed.success) return fail("dati_non_validi", "Voce non valida.");
  const { itemId } = parsed.data;
  return applyItemTransitions(executor, ctx, {
    itemIds: [itemId],
    transitions: [{ itemId, to: "validata", trigger: "valida", guards: [NO_OPEN_CLARIFICATION] }],
    after: (_planned, items) => {
      const item = items.get(itemId)!.snapshot;
      return validationInsertSql({
        workspaceId: ctx.workspaceId,
        caseId: ctx.caseId,
        itemId,
        itemKey: item.key,
        answerId: item.currentAnswer?.id ?? null,
        checkKey: "validazione_umana",
        kind: "umana",
        outcome: "ok",
        message: "Validata da Lateral Space",
        byUserId: actorUserId(ctx),
      });
    },
  });
}

const ClarificationSchema = z.object({ itemId: ItemIdSchema, message: z.string().trim().min(5, "Scrivi la domanda per il referente.").max(4000) });

/**
 * Chiarimento al referente (riga 19): la voce torna `chiesta`, nasce il
 * commento condiviso `chiarimento_richiesto` e l'email al referente va in coda.
 */
export async function requestClarification(executor: UcExecutor, ctx: UcCommandContext, input: unknown): Promise<Result<AppliedTransitions & { commentId: string }>> {
  const parsed = ClarificationSchema.safeParse(input);
  if (!parsed.success) return fail("dati_non_validi", parsed.error.issues[0]?.message ?? "Scrivi la domanda.");
  const { itemId, message } = parsed.data;
  const text = checkLsText({ message }, "commento");
  if (!text.ok) return text;
  const author = actorUserId(ctx);
  if (!author) return fail("attore_non_ammesso", "Serve un account.");
  const commentId = randomUUID();
  const r = await applyItemTransitions(executor, ctx, {
    itemIds: [itemId],
    transitions: [{ itemId, to: "chiesta", trigger: "chiarimento" }],
    after: (_planned, items) => {
      const item = items.get(itemId)!.snapshot;
      const recipient = item.currentAnswer?.responderContactId ?? item.assigneeContactId;
      return [
        ...commentInsertSql({ id: commentId, workspaceId: ctx.workspaceId, caseId: ctx.caseId, itemId, itemKey: item.key, authorUserId: author, body: message, visibility: "condiviso", kind: "chiarimento_richiesto" }),
        toStatement(
          eventInsertSql({
            type: "chiarimento.richiesto",
            workspaceId: ctx.workspaceId,
            caseId: ctx.caseId,
            actor: eventActorFrom(ctx.actor),
            targetType: "voce",
            targetId: itemId,
            payload: { item_key: item.key },
          }),
        ),
        ...(recipient
          ? [
              toStatement(
                enqueueSql({
                  workspaceId: ctx.workspaceId,
                  caseId: ctx.caseId,
                  requestId: item.currentAnswer?.requestId ?? null,
                  recipient: { contactId: recipient },
                  channel: "email",
                  templateKey: "chiarimento",
                  payload: { item_id: itemId, item_keys: [item.key], comment_id: commentId },
                  dedupeKey: dedupeKey.chiarimento(commentId),
                }),
              ),
            ]
          : []),
      ];
    },
  });
  return r.ok ? ok({ ...r.value, commentId }) : r;
}

// ── Non applicabile a due firme ───────────────────────────────────────

const NaReasonSchema = z.object({ itemId: ItemIdSchema, reason: z.string().trim().min(10, "Spiega in almeno 10 caratteri perché la voce non si applica.").max(2000) });

/** Proposta NA di Lateral Space: lo stato resta, le firme ripartono da zero. */
export async function proposeNa(executor: UcExecutor, ctx: UcCommandContext, input: unknown): Promise<Result<{ itemId: string }>> {
  const parsed = NaReasonSchema.safeParse(input);
  if (!parsed.success) return fail("dati_non_validi", parsed.error.issues[0]?.message ?? "Scrivi il motivo.");
  const text = checkLsText({ reason: parsed.data.reason });
  if (!text.ok) return text;
  const one = await loadOne(executor, ctx, parsed.data.itemId);
  if (!one.ok) return one;
  const { core, item } = one.value;
  const now = ctx.now ?? new Date();
  const checked = checkNaProposal({ item: item.snapshot, actor: ctx.actor, user: ctx.user, reason: parsed.data.reason, now, case: { status: core.status } });
  if (!checked.ok) return checked;
  const run = await runCommand(
    executor,
    [
      caseRevisionSql({ workspaceId: ctx.workspaceId, caseId: ctx.caseId, expectStatus: [core.status] }),
      itemUpdateSql({
        workspaceId: ctx.workspaceId,
        caseId: ctx.caseId,
        targets: [{ id: item.snapshot.id, currentAnswerId: item.snapshot.currentAnswer?.id ?? null, naProposedAt: null }],
        from: item.snapshot.status,
        set: itemSetSql(checked.value.patch),
        events: [{ type: "voce.na_proposta", actor: eventActorFrom(ctx.actor), payload: { ruolo: actorRoles(ctx).includes("ls_lead") ? "ls_lead" : "ls_analista", complete: false } }],
      }),
    ],
    ITEM_MESSAGES,
  );
  return run.ok ? ok({ itemId: item.snapshot.id }) : run;
}

/**
 * Firma di una proposta NA: Lateral Space (ls_lead) o cliente (account
 * `owner_cliente` non Lateral Space, oppure `signer` del link dell'Owner
 * designato). Con la seconda firma la voce passa a `non_applicabile` nello
 * stesso batch (righe 4, 12, 22, 29, 32).
 */
export async function signNa(executor: UcExecutor, ctx: UcCommandContext, input: unknown, signer?: Signer): Promise<Result<{ itemId: string; complete: boolean }>> {
  const parsed = SignItemSchema.safeParse(input);
  if (!parsed.success) return fail("dati_non_validi", "Voce non valida.");
  const one = await loadOne(executor, ctx, parsed.data.itemId);
  if (!one.ok) return one;
  const { core, item } = one.value;
  // La proposta letta è quella caricata qui: la scrittura la tiene ferma con `naProposedAt`.
  if (parsed.data.expectedTextHash && !naProposalIs(item.snapshot, parsed.data.expectedTextHash)) return fail("testo_cambiato", TEXT_CHANGED);
  const who = signer ? ok(signer) : accountSigner(ctx);
  if (!who.ok) return who;
  const sigCtx = await loadSignatureContext(executor, core, ctx.lsDomains);
  const signed = naSignaturePatch({ item: item.snapshot, signer: who.value, ctx: sigCtx });
  if (!signed.ok) return signed;
  const s = item.snapshot;
  const oldSignatures = naSignatureColumnsAre({ ls: s.na.lsUserId, clientUser: s.na.clientUserId, clientContact: s.na.clientContactId });
  const event = { type: "voce.na_firmata" as const, actor: eventActorFrom(ctx.actor), payload: { ruolo: signed.value.side === "ls" ? "ls_lead" : "owner_cliente", complete: signed.value.complete } };
  if (!signed.value.complete) {
    const run = await runCommand(
      executor,
      [
        caseRevisionSql({ workspaceId: ctx.workspaceId, caseId: ctx.caseId, expectStatus: [core.status] }),
        itemUpdateSql({
          workspaceId: ctx.workspaceId,
          caseId: ctx.caseId,
          targets: [{ id: s.id, currentAnswerId: s.currentAnswer?.id ?? null, naProposedAt: s.na.proposedAt }],
          from: s.status,
          set: itemSetSql(signed.value.patch as Partial<ItemPatch>),
          guards: [oldSignatures],
          events: [event],
        }),
      ],
      ITEM_MESSAGES,
    );
    return run.ok ? ok({ itemId: s.id, complete: false }) : run;
  }
  const p = signed.value.patch;
  const na = {
    ...s.na,
    lsUserId: p.naApprovedByUserId ?? s.na.lsUserId,
    clientUserId: p.naClientApprovedByUserId ?? s.na.clientUserId,
    clientContactId: p.naApprovedByContactId !== undefined ? p.naApprovedByContactId : s.na.clientContactId,
  };
  const r = await applyItemTransitions(executor, ctx, {
    itemIds: [s.id],
    transitions: [
      {
        itemId: s.id,
        to: "non_applicabile",
        trigger: "na_approvata",
        overrides: { na },
        extraPatch: p as Partial<ItemPatch>,
        guards: [oldSignatures],
        checkNaProposal: true,
      },
    ],
    after: [
      toStatement(
        eventInsertSql({ type: "voce.na_firmata", workspaceId: ctx.workspaceId, caseId: ctx.caseId, actor: event.actor, targetType: "voce", targetId: s.id, payload: { item_key: s.key, ...event.payload } }),
      ),
    ],
  });
  return r.ok ? ok({ itemId: s.id, complete: true }) : r;
}

/**
 * NA respinta (`rejectNa`): dalla proposta del referente la voce torna `chiesta`
 * con il motivo (riga «19-na»); dalla proposta di Lateral Space lo stato resta e
 * la proposta si azzera.
 */
export async function rejectNa(executor: UcExecutor, ctx: UcCommandContext, input: unknown): Promise<Result<{ itemId: string }>> {
  const parsed = RejectNaSchema.safeParse(input);
  if (!parsed.success) return fail("dati_non_validi", parsed.error.issues[0]?.message ?? "Scrivi il motivo.");
  const text = checkLsText({ reason: parsed.data.reason });
  if (!text.ok) return text;
  const one = await loadOne(executor, ctx, parsed.data.itemId);
  if (!one.ok) return one;
  const { core, item } = one.value;
  const s = item.snapshot;
  // «Non approvo» vale per la proposta letta, come la firma (`signNa`).
  if (parsed.data.expectedTextHash && !naProposalIs(s, parsed.data.expectedTextHash)) return fail("testo_cambiato", TEXT_CHANGED);
  const now = ctx.now ?? new Date();
  const checked = checkNaRejection({ item: s, actor: ctx.actor, user: ctx.user, reason: parsed.data.reason, now, case: { status: core.status, statusBeforeSuspension: core.statusBeforeSuspension } });
  if (!checked.ok) return checked;
  const ruolo = actorRoles(ctx).includes("ls_lead") ? "ls_lead" : "owner_cliente";
  const rejected = toStatement(
    eventInsertSql({ type: "voce.na_respinta", workspaceId: ctx.workspaceId, caseId: ctx.caseId, actor: eventActorFrom(ctx.actor), targetType: "voce", targetId: s.id, payload: { item_key: s.key, ruolo, complete: false } }),
  );
  if (checked.value.kind === "transizione") {
    const r = await applyItemTransitions(executor, ctx, {
      itemIds: [s.id],
      transitions: [{ itemId: s.id, to: "chiesta", trigger: "na_respinta", reason: parsed.data.reason, checkNaProposal: true }],
      after: [rejected],
    });
    return r.ok ? ok({ itemId: s.id }) : r;
  }
  const run = await runCommand(
    executor,
    [
      caseRevisionSql({ workspaceId: ctx.workspaceId, caseId: ctx.caseId, expectStatus: [core.status] }),
      itemUpdateSql({
        workspaceId: ctx.workspaceId,
        caseId: ctx.caseId,
        targets: [{ id: s.id, currentAnswerId: s.currentAnswer?.id ?? null, naProposedAt: s.na.proposedAt }],
        from: s.status,
        set: itemSetSql(checked.value.patch),
        events: [],
      }),
      rejected,
    ],
    ITEM_MESSAGES,
  );
  return run.ok ? ok({ itemId: s.id }) : run;
}

// ── Deroghe e ripieghi ────────────────────────────────────────────────

/** Impronta del testo firmato di una deroga o di un ripiego: le due firme valgono solo sullo stesso testo. */
export function signedTextHash(value: Record<string, unknown>): string {
  return sha256Hex(stableStringify(value));
}

function waiverText(w: Pick<Waiver, "motivo" | "piano" | "scadenza">): Record<string, unknown> {
  return { motivo: w.motivo, piano: w.piano, scadenza: w.scadenza };
}

function fallbackText(f: Pick<Fallback, "descrizione" | "valido_per" | "da_sostituire_entro">): Record<string, unknown> {
  return { descrizione: f.descrizione, valido_per: [...f.valido_per], da_sostituire_entro: f.da_sostituire_entro };
}

/** Limite delle deroghe dal calcolo dal vivo: voci di R(G1) e deroghe valide sulle altre voci. */
async function waiverBudget(executor: UcExecutor, ctx: UcCommandContext, itemId: string, now: Date): Promise<{ required: number; others: number } | null> {
  const live = await loadCaseReadiness(executor, ctx.workspaceId, ctx.caseId, now);
  if (!live) return null;
  const others = live.input.items.filter((x) => x.id !== itemId && isRequired(x, "G1") && isItemOk(x, "G1", now).via === "deroga").length;
  return { required: live.g1.required, others };
}

const WaiverSchema = z.object({
  itemId: ItemIdSchema,
  motivo: z.string().trim().min(10, "Scrivi il motivo della deroga.").max(2000),
  piano: z.string().trim().min(10, "Scrivi il piano per chiudere la voce.").max(2000),
  scadenza: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Scegli una data."),
});

const LS_PROPOSERS = ["ls_lead", "ls_analista"] as const;

/** Proposta di deroga (ls_lead o ls_analista): limiti e divieti di `checkWaiver`; le firme ripartono da zero. */
export async function proposeWaiver(executor: UcExecutor, ctx: UcCommandContext, input: unknown): Promise<Result<{ itemId: string }>> {
  if (!actorRoles(ctx).some((r) => (LS_PROPOSERS as readonly string[]).includes(r))) return fail("attore_non_ammesso", "Solo Lateral Space propone una deroga.");
  const parsed = WaiverSchema.safeParse(input);
  if (!parsed.success) return fail("dati_non_validi", parsed.error.issues[0]?.message ?? "Controlla la deroga.");
  const { itemId, motivo, piano, scadenza } = parsed.data;
  const text = checkLsText({ motivo, piano });
  if (!text.ok) return text;
  const one = await loadOne(executor, ctx, itemId);
  if (!one.ok) return one;
  const { core, item } = one.value;
  if (core.status === "chiuso") return fail("caso_chiuso", ITEM_MESSAGES.caso_chiuso);
  const s = item.snapshot;
  const now = ctx.now ?? new Date();
  const budget = await waiverBudget(executor, ctx, itemId, now);
  if (!budget) return fail("non_trovato", CASE_NOT_FOUND);
  const checked = checkWaiver({
    item: { key: s.key, kind: s.kind, priority: s.priority, privacyClass: s.privacyClass, activeBlockerKeys: s.activeBlockerKeys, healthRuleQuestion: item.extra.healthRuleQuestion, status: s.status },
    waiver: { motivo, piano, scadenza },
    gateRequired: budget.required,
    existingValidWaivers: budget.others,
    today: romeDateOf(now),
  });
  if (!checked.ok) return checked;
  const waiver: Waiver = { motivo, piano, scadenza, approvazioni: [] };
  const run = await runCommand(
    executor,
    [
      caseRevisionSql({ workspaceId: ctx.workspaceId, caseId: ctx.caseId, expectStatus: [core.status] }),
      itemUpdateSql({
        workspaceId: ctx.workspaceId,
        caseId: ctx.caseId,
        targets: [{ id: s.id, currentAnswerId: s.currentAnswer?.id ?? null }],
        from: s.status,
        set: itemSetSql({}, { waiver, waiverApprovedAt: null }),
        guards: [waiverIs(s.waiver)],
        events: [{ type: "voce.modificata", actor: eventActorFrom(ctx.actor), payload: { kind: s.kind, fields: ["waiver"] } }],
      }),
    ],
    ITEM_MESSAGES,
  );
  return run.ok ? ok({ itemId }) : run;
}

/**
 * Firma di una deroga (ls_lead e Owner, sullo stesso testo). Con la seconda
 * firma i limiti si ricontrollano e la deroga vale da adesso (`waiver_approved_at`).
 */
export async function signWaiver(executor: UcExecutor, ctx: UcCommandContext, input: unknown, signer?: Signer): Promise<Result<{ itemId: string; complete: boolean }>> {
  const parsed = SignItemSchema.safeParse(input);
  if (!parsed.success) return fail("dati_non_validi", "Voce non valida.");
  const one = await loadOne(executor, ctx, parsed.data.itemId);
  if (!one.ok) return one;
  const { core, item } = one.value;
  const s = item.snapshot;
  if (!s.waiver) return fail("deroga_assente", "Non c'è una deroga da firmare.");
  if (core.status === "chiuso") return fail("caso_chiuso", ITEM_MESSAGES.caso_chiuso);
  if (item.extra.waiverApprovedAt) return fail("deroga_gia_approvata", "La deroga è già approvata.");
  const who = signer ? ok(signer) : accountSigner(ctx);
  if (!who.ok) return who;
  const now = ctx.now ?? new Date();
  const sigCtx = await loadSignatureContext(executor, core, ctx.lsDomains);
  const hash = signedTextHash(waiverText(s.waiver));
  // Il testo letto contro la deroga caricata, che la scrittura tiene ferma (`waiverIs`).
  const added = addSignature({ purpose: "deroga", approvals: s.waiver.approvazioni ?? [], signer: who.value, ctx: sigCtx, now, textHash: hash, expectedTextHash: parsed.data.expectedTextHash ?? hash });
  if (!added.ok) return added;
  if (added.value.complete) {
    const budget = await waiverBudget(executor, ctx, s.id, now);
    if (!budget) return fail("non_trovato", CASE_NOT_FOUND);
    const recheck = checkWaiver({
      item: { key: s.key, kind: s.kind, priority: s.priority, privacyClass: s.privacyClass, activeBlockerKeys: s.activeBlockerKeys, healthRuleQuestion: item.extra.healthRuleQuestion, status: s.status },
      waiver: s.waiver,
      gateRequired: budget.required,
      existingValidWaivers: budget.others,
      today: romeDateOf(now),
    });
    if (!recheck.ok) return recheck;
  }
  const waiver: Waiver = { ...s.waiver, approvazioni: added.value.approvals };
  const run = await runCommand(
    executor,
    [
      caseRevisionSql({ workspaceId: ctx.workspaceId, caseId: ctx.caseId, expectStatus: [core.status] }),
      itemUpdateSql({
        workspaceId: ctx.workspaceId,
        caseId: ctx.caseId,
        targets: [{ id: s.id, currentAnswerId: s.currentAnswer?.id ?? null }],
        from: s.status,
        set: itemSetSql({}, { waiver, waiverApprovedAt: added.value.complete ? now : null }),
        guards: [waiverIs(s.waiver), raw("i.waiver_approved_at IS NULL")],
        events: [{ type: "voce.deroga_firmata", actor: eventActorFrom(ctx.actor), payload: { ruolo: added.value.approval.ruolo, complete: added.value.complete } }],
      }),
    ],
    ITEM_MESSAGES,
  );
  return run.ok ? ok({ itemId: s.id, complete: added.value.complete }) : run;
}

const FallbackSchema = z.object({
  itemId: ItemIdSchema,
  descrizione: z.string().trim().min(10, "Descrivi l'alternativa.").max(2000),
  daSostituireEntro: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Indica entro quando il ripiego va sostituito."),
});

/**
 * Proposta di ripiego su una voce bloccata (ls_lead o ls_analista), valido solo
 * per lo sviluppo (G1). [D] Ogni blocco attivo della voce deve ammettere un
 * ripiego (`fallback_allowed` del template): `a8` e `sanitario` non lo ammettono.
 */
export async function proposeFallback(executor: UcExecutor, ctx: UcCommandContext, input: unknown): Promise<Result<{ itemId: string }>> {
  if (!actorRoles(ctx).some((r) => (LS_PROPOSERS as readonly string[]).includes(r))) return fail("attore_non_ammesso", "Solo Lateral Space propone un ripiego.");
  const parsed = FallbackSchema.safeParse(input);
  if (!parsed.success) return fail("dati_non_validi", parsed.error.issues[0]?.message ?? "Controlla il ripiego.");
  const { itemId, descrizione, daSostituireEntro } = parsed.data;
  const text = checkLsText({ descrizione });
  if (!text.ok) return text;
  const one = await loadOne(executor, ctx, itemId);
  if (!one.ok) return one;
  const { core, item } = one.value;
  if (core.status === "chiuso") return fail("caso_chiuso", ITEM_MESSAGES.caso_chiuso);
  const s = item.snapshot;
  const now = ctx.now ?? new Date();
  const fallback: Fallback = { descrizione, valido_per: ["G1"], da_sostituire_entro: daSostituireEntro, approvazioni: [] };
  const checked = checkFallback({ item: { status: s.status, privacyClass: s.privacyClass, activeBlockerKeys: s.activeBlockerKeys }, fallback, today: romeDateOf(now) });
  if (!checked.ok) return checked;
  const blockers = await loadBlockerDefs(executor, ctx.caseId);
  const notAllowed = s.activeBlockerKeys.find((k) => !blockers.defs.find((d) => d.key === k)?.fallbackAllowed);
  if (notAllowed) return fail("ripiego_non_ammesso", `Il blocco «${notAllowed}» non ammette un ripiego.`);
  const run = await runCommand(
    executor,
    [
      caseRevisionSql({ workspaceId: ctx.workspaceId, caseId: ctx.caseId, expectStatus: [core.status] }),
      itemUpdateSql({
        workspaceId: ctx.workspaceId,
        caseId: ctx.caseId,
        targets: [{ id: s.id, currentAnswerId: s.currentAnswer?.id ?? null }],
        from: s.status,
        set: itemSetSql({}, { fallback, fallbackApprovedAt: null }),
        guards: [fallbackIs(s.fallback)],
        events: [{ type: "voce.modificata", actor: eventActorFrom(ctx.actor), payload: { kind: s.kind, fields: ["fallback"] } }],
      }),
    ],
    ITEM_MESSAGES,
  );
  return run.ok ? ok({ itemId }) : run;
}

/** Firma di un ripiego (ls_lead e Owner, sullo stesso testo); con la seconda vale da adesso. */
export async function signFallback(executor: UcExecutor, ctx: UcCommandContext, input: unknown, signer?: Signer): Promise<Result<{ itemId: string; complete: boolean }>> {
  const parsed = SignItemSchema.safeParse(input);
  if (!parsed.success) return fail("dati_non_validi", "Voce non valida.");
  const one = await loadOne(executor, ctx, parsed.data.itemId);
  if (!one.ok) return one;
  const { core, item } = one.value;
  const s = item.snapshot;
  if (!s.fallback) return fail("ripiego_assente", "Non c'è un ripiego da firmare.");
  if (core.status === "chiuso") return fail("caso_chiuso", ITEM_MESSAGES.caso_chiuso);
  if (item.extra.fallbackApprovedAt) return fail("ripiego_gia_approvato", "Il ripiego è già approvato.");
  const who = signer ? ok(signer) : accountSigner(ctx);
  if (!who.ok) return who;
  const now = ctx.now ?? new Date();
  const recheck = checkFallback({ item: { status: s.status, privacyClass: s.privacyClass, activeBlockerKeys: s.activeBlockerKeys }, fallback: s.fallback, today: romeDateOf(now) });
  if (!recheck.ok) return recheck;
  const sigCtx = await loadSignatureContext(executor, core, ctx.lsDomains);
  const hash = signedTextHash(fallbackText(s.fallback));
  // Il testo letto contro il ripiego caricato, che la scrittura tiene fermo (`fallbackIs`).
  const added = addSignature({ purpose: "ripiego", approvals: s.fallback.approvazioni ?? [], signer: who.value, ctx: sigCtx, now, textHash: hash, expectedTextHash: parsed.data.expectedTextHash ?? hash });
  if (!added.ok) return added;
  const fallback: Fallback = { ...s.fallback, approvazioni: added.value.approvals };
  const run = await runCommand(
    executor,
    [
      caseRevisionSql({ workspaceId: ctx.workspaceId, caseId: ctx.caseId, expectStatus: [core.status] }),
      itemUpdateSql({
        workspaceId: ctx.workspaceId,
        caseId: ctx.caseId,
        targets: [{ id: s.id, currentAnswerId: s.currentAnswer?.id ?? null }],
        from: s.status,
        set: itemSetSql({}, { fallback, fallbackApprovedAt: added.value.complete ? now : null }),
        guards: [fallbackIs(s.fallback), raw("i.fallback_approved_at IS NULL")],
        events: [{ type: "voce.ripiego_firmato", actor: eventActorFrom(ctx.actor), payload: { ruolo: added.value.approval.ruolo, complete: added.value.complete } }],
      }),
    ],
    ITEM_MESSAGES,
  );
  return run.ok ? ok({ itemId: s.id, complete: added.value.complete }) : run;
}

// ── Valori inseriti da Lateral Space ──────────────────────────────────

const LsAnswerSchema = z.object({
  itemId: ItemIdSchema,
  value: z.unknown(),
  sourceKind: z.enum(["lateral_space", "documento", "sistema"]),
  sourceRef: z.string().trim().min(2, "Indica il riferimento della fonte.").max(500),
  sourceBasis: z.enum(SOURCE_BASIS).nullish(),
  confidence: z.enum(CONFIDENCE).nullish(),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  note: z.string().trim().max(2000).nullish(),
});

const NO_PLAINTEXT_CLASSES: readonly PrivacyClass[] = [...PERSONAL_PRIVACY_CLASSES, HEALTH_PRIVACY_CLASS];

/**
 * Valore inserito da Lateral Space da una fonte nota (righe 2, 5, 11, 14; 23 se
 * la voce era validata): normalizzazione stretta del tipo, scansione del testo,
 * risposta nuova (a sola aggiunta) e voce `in_verifica`. Chi inserisce non potrà
 * validare. I valori personali non passano da qui: solo dalla zona personale.
 */
export async function recordLsAnswer(executor: UcExecutor, ctx: UcCommandContext, input: unknown): Promise<Result<AppliedTransitions & { answerId: string }>> {
  const parsed = LsAnswerSchema.safeParse(input);
  if (!parsed.success) return fail("dati_non_validi", parsed.error.issues[0]?.message ?? "Controlla il valore e la fonte.");
  const v = parsed.data;
  const userId = actorUserId(ctx);
  if (!userId) return fail("attore_non_ammesso", "Serve un account.");
  const one = await loadOne(executor, ctx, v.itemId);
  if (!one.ok) return one;
  const { item } = one.value;
  const s = item.snapshot;
  if (NO_PLAINTEXT_CLASSES.includes(s.privacyClass)) {
    return fail("valore_personale", "I valori personali si inseriscono solo dalla zona personale, dopo la scheda A.8.");
  }
  const now = ctx.now ?? new Date();
  const type = s.responseType ?? "testo";
  const [fileRows] = await executor.batch([
    toStatement(ucSql`SELECT id FROM uc_files WHERE case_id = ${cast(ctx.caseId, "uuid")} AND item_id = ${cast(s.id, "uuid")} AND deleted_at IS NULL
  AND scan_status = 'pulito' AND (content_scanned OR reviewed_at IS NOT NULL)`),
  ]);
  const normalized = normalizeAnswer(type, v.value, item.extra.responseConfig, answerContext(now, true, { usableFileIds: fileRows.map((r) => String(r.id)), proposedText: item.extra.title }));
  if (!normalized.ok) return fail("valore_non_valido", normalized.errors[0]?.message ?? "Il valore non è nel formato richiesto.");
  const scan = checkLsText({ value: normalized.value, note: v.note ?? "" });
  if (!scan.ok) return scan;
  const answerId = randomUUID();
  const trigger = s.status === "validata" ? ("nuova_versione" as const) : ("inserimento_ls" as const);
  const r = await applyItemTransitions(executor, ctx, {
    itemIds: [s.id],
    transitions: [
      {
        itemId: s.id,
        to: "in_verifica",
        trigger,
        answer: { kind: "valore", sourceKind: v.sourceKind, sourceRef: v.sourceRef },
        extraSet: { currentAnswerId: answerId },
      },
    ],
    before: [
      answerInsertSql({
        id: answerId,
        workspaceId: ctx.workspaceId,
        caseId: ctx.caseId,
        itemId: s.id,
        kind: "valore",
        value: normalized.value,
        valueNormalized: normalized.normalized,
        validFrom: v.validFrom ?? normalized.validFrom ?? null,
        confidence: v.confidence ?? null,
        note: v.note ?? null,
        sourceKind: v.sourceKind,
        sourceRef: v.sourceRef,
        sourceBasis: v.sourceBasis ?? null,
        responderUserId: userId,
        textHash: normalized.textHash ?? null,
        responseType: type,
        actor: eventActorFrom(ctx.actor),
      }),
    ],
  });
  return r.ok ? ok({ ...r.value, answerId }) : r;
}

// ── Commenti ──────────────────────────────────────────────────────────

const CommentSchema = z.object({
  itemId: ItemIdSchema,
  body: z.string().trim().min(1, "Scrivi il commento.").max(4000),
  visibility: z.enum(["interno_ls", "condiviso"]).default("interno_ls"),
});

const LS_ALL = ["ls_lead", "ls_analista", "ls_sviluppatore"] as const;

/**
 * Commento su una voce. Lateral Space sceglie la visibilità (interno di default,
 * invisibile al cliente); l'Owner del cliente scrive solo commenti condivisi.
 * Il testo passa dalla scansione; l'evento non contiene il testo.
 */
export async function addComment(executor: UcExecutor, ctx: UcCommandContext, input: unknown): Promise<Result<{ commentId: string }>> {
  const parsed = CommentSchema.safeParse(input);
  if (!parsed.success) return fail("dati_non_validi", parsed.error.issues[0]?.message ?? "Scrivi il commento.");
  const roles = actorRoles(ctx);
  const isLs = roles.some((r) => (LS_ALL as readonly string[]).includes(r));
  if (!isLs && !roles.includes("owner_cliente")) return fail("attore_non_ammesso", "Non puoi commentare questa voce.");
  const visibility = isLs ? parsed.data.visibility : "condiviso";
  const text = checkLsText({ body: parsed.data.body }, "commento");
  if (!text.ok) return text;
  const author = actorUserId(ctx)!;
  const one = await loadOne(executor, ctx, parsed.data.itemId);
  if (!one.ok) return one;
  if (one.value.core.status === "chiuso") return fail("caso_chiuso", ITEM_MESSAGES.caso_chiuso);
  const commentId = randomUUID();
  const run = await runCommand(
    executor,
    commentInsertSql({ id: commentId, workspaceId: ctx.workspaceId, caseId: ctx.caseId, itemId: parsed.data.itemId, itemKey: one.value.item.snapshot.key, authorUserId: author, body: parsed.data.body, visibility, kind: "commento" }),
    ITEM_MESSAGES,
  );
  return run.ok ? ok({ commentId }) : run;
}

const ResolveCommentSchema = z.object({ commentId: z.string().regex(UUID) });

/** Chiarimento risolto (Lateral Space), con l'evento `chiarimento.risolto`. */
export async function resolveComment(executor: UcExecutor, ctx: UcCommandContext, input: unknown): Promise<Result<{ commentId: string }>> {
  const parsed = ResolveCommentSchema.safeParse(input);
  if (!parsed.success) return fail("dati_non_validi", "Chiarimento non valido.");
  if (!can(actorRoles(ctx), "esiti_verifica")) return fail("attore_non_ammesso", "Solo Lateral Space chiude un chiarimento.");
  const c = cast(ctx.caseId, "uuid");
  const run = await runCommand(
    executor,
    [
      caseRevisionSql({ workspaceId: ctx.workspaceId, caseId: ctx.caseId }),
      toStatement(ucSql`WITH u AS (
  UPDATE uc_comments cm SET resolved_at = now(), resolved_by_user_id = ${cast(actorUserId(ctx), "uuid")}
  WHERE cm.id = ${cast(parsed.data.commentId, "uuid")} AND cm.case_id = ${c} AND cm.kind = 'chiarimento_richiesto' AND cm.resolved_at IS NULL
  RETURNING cm.id, cm.item_id, (SELECT key FROM uc_items WHERE id = cm.item_id) AS key
), ev AS (
  INSERT INTO uc_events (workspace_id, case_id, actor_type, actor_user_id, event_type, target_type, target_id, payload)
  SELECT ${cast(ctx.workspaceId, "uuid")}, ${c}, 'utente', ${cast(actorUserId(ctx), "uuid")}, 'chiarimento.risolto', 'voce', u.item_id, jsonb_build_object('item_key', u.key) FROM u
)
SELECT uc_require(count(*) = 1, 'commento_non_trovato') AS ok FROM u`),
    ],
    ITEM_MESSAGES,
  );
  return run.ok ? ok({ commentId: parsed.data.commentId }) : run;
}

// ── Voci nuove e riclassificazione ────────────────────────────────────

const TOKEN = /^[a-z0-9_]{1,60}$/;
const longText = z.string().trim().max(4000).nullish();
const ROLE_KEY = /^[a-z][a-z0-9_]{1,79}$/;

const ItemFieldsSchema = z.object({
  title: z.string().trim().min(3).max(600),
  explanation: longText,
  why: longText,
  example: longText,
  help: longText,
  priority: z.enum(PRIORITIES).nullish(),
  servesFor: z.array(z.enum(PHASES)).max(PHASES.length),
  privacyClass: z.enum(PRIVACY_CLASSES),
  valueVisibility: z.enum(VALUE_VISIBILITY),
  availability: z.array(z.string().regex(TOKEN)).max(20),
  perimeter: z.enum(PERIMETERS).nullable(),
  levers: z.array(z.enum(LEVERS)).max(LEVERS.length),
  ownerRoleKey: z.string().regex(ROLE_KEY).nullable(),
  freshnessDays: z.number().int().min(1).max(3650).nullable(),
  requiresValidityPeriod: z.boolean(),
});

const AddItemSchema = ItemFieldsSchema.partial({
  explanation: true,
  why: true,
  example: true,
  help: true,
  priority: true,
  valueVisibility: true,
  servesFor: true,
  availability: true,
  perimeter: true,
  levers: true,
  ownerRoleKey: true,
  freshnessDays: true,
  requiresValidityPeriod: true,
}).extend({
  key: z.string().trim().min(3).max(160),
  kind: z.enum(ITEM_KINDS),
  section: z.enum(ITEM_SECTIONS),
  parentKey: z.string().trim().max(160).nullish(),
  responseType: z.enum(RESPONSE_TYPES).nullish(),
  responseConfig: z.record(z.string(), z.unknown()).optional(),
});

/** Nomi dei campi per il payload dell'evento (snake_case, solo codici). */
function eventFields(keys: readonly string[]): string[] {
  return keys
    .map((k) => k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`))
    .filter((k) => TOKEN.test(k))
    .slice(0, 100);
}

function textsOf(v: { title?: string | null; explanation?: string | null; why?: string | null; example?: string | null; help?: string | null }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ["title", "explanation", "why", "example", "help"] as const) if (typeof v[k] === "string") out[k] = v[k]!;
  return out;
}

/**
 * Voce nuova nel catalogo (ls_lead o ls_analista). Chiave secondo lo schema
 * degli ID del tipo, testi scansionati, blocchi ricalcolati (`checkReclassification`):
 * nasce `bloccata` se un blocco attivo la riguarda. `settings.client_text` torna vero.
 */
export async function addItem(executor: UcExecutor, ctx: UcCommandContext, input: unknown): Promise<Result<{ itemId: string; status: ItemStatus }>> {
  if (!can(actorRoles(ctx), "proporre_voci")) return fail("attore_non_ammesso", "Solo Lateral Space aggiunge voci al catalogo.");
  const parsed = AddItemSchema.safeParse(input);
  if (!parsed.success) return fail("dati_non_validi", parsed.error.issues[0]?.message ?? "Controlla la voce.");
  const v = parsed.data;
  const text = checkLsText({ ...textsOf(v), config: (v.responseConfig ?? {}) as Json });
  if (!text.ok) return text;
  if (JSON.stringify(v.responseConfig ?? {}).length > 20_000) return fail("dati_non_validi", "La configurazione della risposta è troppo lunga.");
  const c = cast(ctx.caseId, "uuid");
  const [caseRows, entityRows, parentRows] = await executor.batch([
    caseCoreSql(ctx.workspaceId, ctx.caseId),
    toStatement(ucSql`SELECT key FROM uc_items WHERE case_id = ${c} AND kind = 'entita' AND deleted_at IS NULL`),
    toStatement(ucSql`SELECT id, key FROM uc_items WHERE case_id = ${c} AND key = ${cast(v.parentKey ?? "", "text")} AND deleted_at IS NULL`),
  ]);
  const core = parseCaseCore(caseRows[0]);
  if (!core) return fail("non_trovato", CASE_NOT_FOUND);
  if (core.status === "chiuso") return fail("caso_chiuso", ITEM_MESSAGES.caso_chiuso);
  const keyIssue = checkItemKey({ key: v.key, kind: v.kind, parent: v.parentKey ?? null }, new Set(entityRows.map((r) => String(r.key))));
  if (keyIssue) return fail(keyIssue.code, keyIssue.message);
  const parentId = v.parentKey ? (parentRows[0] ? String(parentRows[0].id) : null) : null;
  if (v.parentKey && !parentId) return fail("parent_non_trovato", "La voce genitore non esiste nel caso.");
  const blockers = await loadBlockerDefs(executor, ctx.caseId);
  const facts: ItemBlockerFacts = { kind: v.kind, privacyClass: v.privacyClass, availability: v.availability ?? [], perimeter: v.perimeter ?? null, explicitBlockedBy: [] };
  const reclass = checkReclassification({ before: null, after: facts, itemStatus: null, existingLinks: [], defs: blockers.defs, blockerStatus: blockers.status });
  if (!reclass.ok) return reclass;
  const status: ItemStatus = reclass.value.initialStatus ?? "da_chiedere";
  const scope = gateScopeForItem({ requestModuleKey: null, servesFor: v.servesFor ?? [], perimeter: v.perimeter ?? null }, core.policy);
  const itemId = randomUUID();
  const responseType = v.responseType ?? null;
  const spec: Record<string, Json> = scope.defaultsApplied.length ? { defaults_applied: scope.defaultsApplied } : {};
  const statusReason = status === "bloccata" ? `Bloccata: ${[...reclass.value.activeKeys].sort().join(", ")}`.slice(0, 500) : null;
  const statements: UcStatement[] = [
    caseRevisionSql({ workspaceId: ctx.workspaceId, caseId: ctx.caseId, expectStatus: [core.status] }),
    toStatement(
      requireRows(
        ucSql`INSERT INTO uc_items (id, case_id, key, kind, section, parent_item_id, title, explanation, why, example, help, spec, priority, serves_for,
  privacy_class, value_visibility, availability, perimeter, levers, response_type, response_config, in_gate_scope, status, status_reason,
  status_changed_at, owner_role_key, requires_validity_period, freshness_days, sort_order, created_by_user_id)
VALUES (${cast(itemId, "uuid")}, ${c}, ${cast(v.key, "text")}, ${cast(v.kind, "text")}, ${cast(v.section, "text")}, ${cast(parentId, "uuid")},
  ${cast(v.title, "text")}, ${cast(v.explanation ?? null, "text")}, ${cast(v.why ?? null, "text")}, ${cast(v.example ?? null, "text")}, ${cast(v.help ?? null, "text")},
  ${jsonb(spec)}, ${cast(v.priority ?? null, "text")}, ${jsonb(scope.servesFor)}, ${cast(v.privacyClass, "text")}, ${cast(v.valueVisibility ?? "owner_e_ls", "text")},
  ${jsonb(v.availability ?? [])}, ${cast(scope.perimeter, "text")}, ${jsonb(v.levers ?? [])}, ${cast(responseType, "text")}, ${jsonb(v.responseConfig ?? {})},
  ${cast(scope.inGateScope, "boolean")}, ${cast(status, "text")}, ${cast(statusReason, "text")}, now(), ${cast(v.ownerRoleKey ?? null, "text")},
  ${cast(v.requiresValidityPeriod ?? defaultRequiresValidityPeriod(responseType), "boolean")}, ${cast(v.freshnessDays ?? null, "int")},
  (SELECT coalesce(max(sort_order), 0) + 1 FROM uc_items WHERE case_id = ${c}), ${cast(actorUserId(ctx), "uuid")})
ON CONFLICT (case_id, key) DO NOTHING RETURNING id`,
        1,
        "chiave_in_uso",
      ),
    ),
  ];
  const links = reclass.value.add.flatMap((l) => (blockers.ids.get(l.key) ? [{ itemId, blockerId: blockers.ids.get(l.key)!, origin: l.origin }] : []));
  if (links.length) statements.push(itemBlockerLinksInsertSql(links));
  statements.push(
    toStatement(ucSql`UPDATE uc_cases SET settings = jsonb_set(settings, '{client_text}', 'true'::jsonb) WHERE id = ${c}`),
    toStatement(
      eventInsertSql({
        type: "voce.creata",
        workspaceId: ctx.workspaceId,
        caseId: ctx.caseId,
        actor: eventActorFrom(ctx.actor),
        targetType: "voce",
        targetId: itemId,
        toState: status,
        payload: { item_key: v.key, kind: v.kind, fields: eventFields(Object.keys(v)) },
      }),
    ),
  );
  const run = await runCommand(executor, statements, ITEM_MESSAGES);
  return run.ok ? ok({ itemId, status }) : run;
}

const UpdateItemSchema = ItemFieldsSchema.partial().extend({
  itemId: ItemIdSchema,
  dueAt: z.string().datetime({ offset: true }).nullish(),
  dueIsProposal: z.boolean().optional(),
});

const META_COLUMNS: Readonly<Record<string, { column: string; kind: "text" | "json" | "int" | "bool" | "ts" }>> = {
  title: { column: "title", kind: "text" },
  explanation: { column: "explanation", kind: "text" },
  why: { column: "why", kind: "text" },
  example: { column: "example", kind: "text" },
  help: { column: "help", kind: "text" },
  priority: { column: "priority", kind: "text" },
  servesFor: { column: "serves_for", kind: "json" },
  privacyClass: { column: "privacy_class", kind: "text" },
  valueVisibility: { column: "value_visibility", kind: "text" },
  availability: { column: "availability", kind: "json" },
  perimeter: { column: "perimeter", kind: "text" },
  levers: { column: "levers", kind: "json" },
  ownerRoleKey: { column: "owner_role_key", kind: "text" },
  freshnessDays: { column: "freshness_days", kind: "int" },
  requiresValidityPeriod: { column: "requires_validity_period", kind: "bool" },
  dueAt: { column: "due_at", kind: "ts" },
  dueIsProposal: { column: "due_is_proposal", kind: "bool" },
};

const TEXT_FIELDS = ["title", "explanation", "why", "example", "help"];

function metaValue(kind: (typeof META_COLUMNS)[string]["kind"], value: unknown): SqlFragment {
  switch (kind) {
    case "json":
      return jsonb(value);
    case "int":
      return cast(value ?? null, "int");
    case "bool":
      return cast(value ?? false, "boolean");
    case "ts":
      return cast(value ?? null, "timestamptz");
    default:
      return cast(value ?? null, "text");
  }
}

/**
 * Modifica dei metadati di una voce (solo ls_lead) con il ricalcolo dei blocchi
 * nello stesso batch (D38): la classe privacy si può solo alzare, con `a8` o
 * `sanitario` attivo non si tolgono token di disponibilità né si cambia il
 * perimetro, le righe dei blocchi attivi non si toccano. Se compare un blocco
 * attivo la voce passa a `bloccata` (righe 3, 9, 13, 25, 30).
 */
export async function updateItemMeta(executor: UcExecutor, ctx: UcCommandContext, input: unknown): Promise<Result<{ itemId: string; fields: string[]; blocked: boolean }>> {
  if (!can(actorRoles(ctx), "modificare_catalogo")) return fail("attore_non_ammesso", "Solo il Responsabile del caso modifica le voci.");
  const parsed = UpdateItemSchema.safeParse(input);
  if (!parsed.success) return fail("dati_non_validi", parsed.error.issues[0]?.message ?? "Controlla la voce.");
  const { itemId, ...changes } = parsed.data;
  const fields = Object.keys(changes).filter((k) => (changes as Record<string, unknown>)[k] !== undefined);
  if (fields.length === 0) return ok({ itemId, fields: [], blocked: false });
  const text = checkLsText(textsOf(changes));
  if (!text.ok) return text;
  const one = await loadOne(executor, ctx, itemId);
  if (!one.ok) return one;
  const { core, item } = one.value;
  if (core.status === "chiuso") return fail("caso_chiuso", ITEM_MESSAGES.caso_chiuso);
  const s = item.snapshot;
  const before: ItemBlockerFacts = {
    kind: s.kind,
    privacyClass: s.privacyClass,
    availability: item.extra.availability,
    perimeter: s.perimeter,
    explicitBlockedBy: Array.isArray(item.extra.spec.blocked_by) ? (item.extra.spec.blocked_by as string[]) : [],
  };
  const after: ItemBlockerFacts = {
    ...before,
    privacyClass: changes.privacyClass ?? before.privacyClass,
    availability: changes.availability ?? before.availability,
    perimeter: changes.perimeter !== undefined ? changes.perimeter : before.perimeter,
  };
  const blockers = await loadBlockerDefs(executor, ctx.caseId);
  const reclass = checkReclassification({
    before,
    after,
    itemStatus: s.status,
    existingLinks: item.extra.blockerLinks.map((l) => ({ key: l.key, origin: l.origin })),
    defs: blockers.defs,
    blockerStatus: blockers.status,
    privacyLoweringApproved: false,
  });
  if (!reclass.ok) return reclass;
  const now = ctx.now ?? new Date();
  const sets: SqlFragment[] = [];
  for (const f of fields) {
    const meta = META_COLUMNS[f];
    if (meta) sets.push(ucSql`${raw(meta.column)} = ${metaValue(meta.kind, (changes as Record<string, unknown>)[f])}`);
  }
  // Un valore scritto da Lateral Space non è più un default della regola del gate.
  const droppedDefaults = [...(changes.servesFor !== undefined ? ["serves_for"] : []), ...(changes.perimeter !== undefined ? ["perimeter"] : [])];
  if (droppedDefaults.length) {
    sets.push(ucSql`spec = CASE WHEN jsonb_typeof(spec -> 'defaults_applied') = 'array'
  THEN jsonb_set(spec, '{defaults_applied}', coalesce((SELECT jsonb_agg(d) FROM jsonb_array_elements_text(spec -> 'defaults_applied') d WHERE d <> ALL(${cast(droppedDefaults, "text[]")})), '[]'::jsonb))
  ELSE spec END`);
  }
  if (changes.freshnessDays !== undefined && s.status === "validata" && item.extra.validatedAnswerCreatedAt) {
    const staleAt = computeStaleAt({ freshnessDays: changes.freshnessDays, validFrom: item.extra.validatedAnswerValidFrom, answeredAt: item.extra.validatedAnswerCreatedAt });
    sets.push(ucSql`stale_at = ${cast(staleAt ? staleAt.toISOString() : null, "timestamptz")}`);
  }
  let patch: Partial<ItemPatch> = {};
  let requestItemState: string | null = null;
  if (reclass.value.block) {
    const blocked = checkItemTransition({
      item: s,
      to: "bloccata",
      trigger: "blocco_attivato",
      actor: { type: "sistema", job: "blocchi" },
      now,
      case: { status: core.status, statusBeforeSuspension: core.statusBeforeSuspension },
      blockerKeys: reclass.value.activeKeys,
    });
    if (!blocked.ok) return blocked;
    patch = blocked.value.patch;
    requestItemState = blocked.value.requestItemState;
  }
  const actor = eventActorFrom(ctx.actor);
  const events = [
    { type: "voce.modificata" as const, actor, payload: { kind: s.kind, fields: eventFields(fields) } },
    ...(reclass.value.privacyChange ? [{ type: "voce.classe_privacy_cambiata" as const, actor, payload: { from: before.privacyClass, to: after.privacyClass } }] : []),
    ...(reclass.value.block ? [{ type: "voce.stato_cambiato" as const, actor: { type: "sistema" as const }, states: true, payload: { trigger: "blocco_attivato" } }] : []),
  ];
  const set = join([...sets, itemSetSql(patch)], ", ");
  const statements: UcStatement[] = [
    caseRevisionSql({ workspaceId: ctx.workspaceId, caseId: ctx.caseId, expectStatus: [core.status] }),
    itemUpdateSql({
      workspaceId: ctx.workspaceId,
      caseId: ctx.caseId,
      targets: [{ id: s.id, currentAnswerId: s.currentAnswer?.id ?? null }],
      from: s.status,
      set,
      guards: [
        ucSql`i.privacy_class = ${cast(before.privacyClass, "text")} AND i.availability = ${jsonb(before.availability)} AND i.perimeter IS NOT DISTINCT FROM ${cast(before.perimeter, "text")}`,
      ],
      events,
    }),
  ];
  if (requestItemState) statements.push(requestItemsStateSql({ caseId: ctx.caseId, itemIds: [s.id], state: requestItemState as "riassegnata" }));
  const links = reclass.value.add.flatMap((l) => (blockers.ids.get(l.key) ? [{ itemId: s.id, blockerId: blockers.ids.get(l.key)!, origin: l.origin }] : []));
  if (links.length) statements.push(itemBlockerLinksInsertSql(links));
  const removeIds = reclass.value.remove.flatMap((k) => (blockers.ids.get(k) ? [blockers.ids.get(k)!] : []));
  if (removeIds.length) statements.push(itemBlockerLinksDeleteSql(s.id, removeIds));
  if (fields.some((f) => TEXT_FIELDS.includes(f))) {
    statements.push(toStatement(ucSql`UPDATE uc_cases SET settings = jsonb_set(settings, '{client_text}', 'true'::jsonb) WHERE id = ${cast(ctx.caseId, "uuid")}`));
  }
  const run = await runCommand(executor, statements, ITEM_MESSAGES);
  return run.ok ? ok({ itemId, fields, blocked: reclass.value.block }) : run;
}

const DueSchema = z.object({
  itemIds: z.array(ItemIdSchema).min(1).max(500),
  dueAt: z.string().datetime({ offset: true }).nullable(),
  isProposal: z.boolean().default(true),
});

/** «Imposta scadenza (proposta)» in blocco (ls_lead): solo la data, nessun cambio di stato. */
export async function setItemsDue(executor: UcExecutor, ctx: UcCommandContext, input: unknown): Promise<Result<{ count: number }>> {
  if (!can(actorRoles(ctx), "assegnare")) return fail("attore_non_ammesso", "Solo il Responsabile del caso imposta le scadenze.");
  const parsed = DueSchema.safeParse(input);
  if (!parsed.success) return fail("dati_non_validi", "Controlla le voci e la data.");
  const ids = [...new Set(parsed.data.itemIds)];
  const c = cast(ctx.caseId, "uuid");
  const run = await runCommand(
    executor,
    [
      caseRevisionSql({ workspaceId: ctx.workspaceId, caseId: ctx.caseId, expectStatus: ["bozza", "raccolta", "pronto_sviluppo", "in_sviluppo", "backtest", "collaudo", "stabilizzazione", "in_esercizio", "misura_roi", "sospeso"], bump: false }),
      toStatement(ucSql`WITH u AS (
  UPDATE uc_items SET due_at = ${cast(parsed.data.dueAt, "timestamptz")}, due_is_proposal = ${cast(parsed.data.isProposal, "boolean")}, updated_at = now()
  WHERE case_id = ${c} AND id = ANY(${cast(ids, "uuid[]")}) AND deleted_at IS NULL
  RETURNING id, key
), ev AS (
  INSERT INTO uc_events (workspace_id, case_id, actor_type, actor_user_id, event_type, target_type, target_id, payload)
  SELECT ${cast(ctx.workspaceId, "uuid")}, ${c}, 'utente', ${cast(actorUserId(ctx), "uuid")}, 'voce.modificata', 'voce', u.id,
    jsonb_build_object('item_key', u.key, 'fields', jsonb_build_array('due_at')) FROM u
)
SELECT uc_require(count(*) = ${cast(ids.length, "int")}, 'conflitto') AS ok FROM u`),
    ],
    ITEM_MESSAGES,
  );
  return run.ok ? ok({ count: ids.length }) : run;
}

// Ri-esportati per i comandi che costruiscono transizioni (WP7a, WP7b, WP11).
export type { Actor, LoadedItem, PlannedTransition, TransitionRequest };
export { NO_ACTIVE_BLOCKER };
