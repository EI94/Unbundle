import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { createUcExecutor, type UcExecutor } from "../db/uc-executor.ts";
import { applyTemplateLoad } from "../db/queries/uc-templates.ts";
import {
  addCaseMember,
  commandContextFor,
  confirmGatePolicy,
  createCase,
  getCaseOverview,
  listCases,
  loadUserContext,
  refreshReadinessCache,
  removeUserFromWorkspaceCases,
  transitionCase,
  type UcCommandContext,
} from "../db/queries/uc-cases.ts";
import {
  applyItemTransitions,
  proposeNa,
  recordLsAnswer,
  requestClarification,
  signNa,
  transitionItems,
  updateItemMeta,
  validateItem,
} from "../db/queries/uc-items.ts";
import { addManualBlocker, listCatalogVersions, proposeGate, reactivateBlocker, rejectGate, resolveBlocker, signGate } from "../db/queries/uc-gates.ts";
import { answerInsertSql } from "./sql/transitions.ts";
import { planTemplateLoad } from "./template/load.ts";

// Opt-in integration suite for the internal commands (PIANO §3.12, §5.3, §5.10),
// on the isolated local harness only. Same guard as database.integration.test.ts:
//   UC_TEST_DATABASE_URL=postgresql://uc_test@127.0.0.1:55449/unbundle_uc_test UC_TEST_ISOLATED=true \
//   NODE_OPTIONS=--require=./scripts/uc-test/local-neon.cjs node --no-warnings --test src/lib/uc/commands.integration.test.ts
// Never in parallel with database.integration.test.ts (use --test-concurrency=1): that file
// narrows and heals a vocabulary CHECK on purpose, which would fail these commands mid-run.
const url = process.env.UC_TEST_DATABASE_URL;
const enabled = Boolean(url);
if (url) {
  const parsed = new URL(url);
  if (process.env.UC_TEST_ISOLATED !== "true" || !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)) {
    throw new Error("uc DB tests require an explicitly isolated loopback database (UC_TEST_ISOLATED=true)");
  }
  if (process.env.DATABASE_URL && process.env.DATABASE_URL !== url) {
    throw new Error("DATABASE_URL must be unset or equal to UC_TEST_DATABASE_URL for the uc DB tests");
  }
  if ((globalThis.fetch as { name?: string }).name !== "localNeonFetch") {
    throw new Error("Preload scripts/uc-test/local-neon.cjs (NODE_OPTIONS=--require=…) to reach the local harness");
  }
}
const opts = { skip: !enabled };

const sql = url ? neon(url) : null;
const exec: UcExecutor | null = sql ? createUcExecutor(sql) : null;
const q = (text: string, params: unknown[] = []) => sql!.query(text, params) as Promise<Record<string, unknown>[]>;
const one = async (text: string, params: unknown[] = []) => (await q(text, params))[0];

const LS_DOMAINS = ["ls.test"];
const suffix = randomBytes(3).toString("hex");
const ids = {
  org: randomUUID(),
  ws: randomUUID(),
  lead: randomUUID(),
  analyst: randomUUID(),
  owner: randomUUID(),
  privacy: randomUUID(),
  useCase: randomUUID(),
  contact: randomUUID(),
  request: randomUUID(),
  request2: randomUUID(),
  file: randomUUID(),
};
const exampleText = readFileSync(new URL("../../../templates/uc/esempio.minimo/1.0.0.json", import.meta.url), "utf8");
const state: { templateId: string; caseId: string; items: Map<string, string> } = { templateId: "", caseId: "", items: new Map() };

async function ctxFor(userId: string): Promise<UcCommandContext> {
  const r = await commandContextFor(exec!, { workspaceId: ids.ws, caseId: state.caseId, userId, lsDomains: LS_DOMAINS });
  assert.ok(r.ok, r.ok ? "" : r.message);
  return r.value;
}

const item = (key: string) => {
  const id = state.items.get(key);
  assert.ok(id, `item ${key}`);
  return id;
};
const statusOf = async (key: string) => String((await one(`SELECT status FROM uc_items WHERE id = $1::uuid`, [item(key)])).status);

before(async () => {
  if (!sql) return;
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Org prova comandi', $2)`, [ids.org, `uc-cmd-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $2::uuid, 'Prova comandi')`, [ids.ws, ids.org]);
  await q(
    `INSERT INTO users (id, email, email_verified) VALUES
       ($1::uuid, $5, now()), ($2::uuid, $6, now()), ($3::uuid, $7, now()), ($4::uuid, $8, now())`,
    [ids.lead, ids.analyst, ids.owner, ids.privacy, `cmd-lead-${suffix}@ls.test`, `cmd-analista-${suffix}@ls.test`, `cmd-owner-${suffix}@cliente.test`, `cmd-privacy-${suffix}@cliente.test`],
  );
  await q(
    `INSERT INTO memberships (user_id, organization_id, role) VALUES ($1::uuid, $5::uuid, 'transformation_lead'), ($2::uuid, $5::uuid, 'analyst'),
       ($3::uuid, $5::uuid, 'contributor'), ($4::uuid, $5::uuid, 'contributor')`,
    [ids.lead, ids.analyst, ids.owner, ids.privacy, ids.org],
  );
  await q(`INSERT INTO use_cases (id, workspace_id, title, status) VALUES ($1::uuid, $2::uuid, 'Scheda di prova', 'accepted')`, [ids.useCase, ids.ws]);
  const value = JSON.parse(exampleText) as Record<string, unknown>;
  value.key = `prova.comandi_${suffix}`;
  const plan = planTemplateLoad(JSON.stringify(value), { restrictToWorkspaceId: ids.ws });
  assert.ok(plan.ok);
  const loaded = await applyTemplateLoad(exec!, plan.plan, { actorUserId: ids.lead, publish: true });
  assert.ok(loaded.ok, loaded.ok ? "" : loaded.message);
  state.templateId = loaded.value.templateId;
});

after(async () => {
  if (!sql) return;
  await q(`DELETE FROM workspaces WHERE id = $1::uuid`, [ids.ws]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id IN ($1::uuid, $2::uuid, $3::uuid, $4::uuid)`, [ids.lead, ids.analyst, ids.owner, ids.privacy]);
});

test("case creation: only Lateral Space creates, from an accepted card, and the case appears complete", opts, async () => {
  const ownerCtx = await loadUserContext(exec!, ids.owner, LS_DOMAINS);
  const refused = await createCase(exec!, { workspaceId: ids.ws, user: ownerCtx!, canReviewWorkspacePortfolio: true, input: { templateId: state.templateId, code: "CMD-X", title: "Caso" } });
  assert.equal(refused.ok ? null : refused.code, "ruolo_solo_lateral_space");
  const leadCtx = await loadUserContext(exec!, ids.lead, LS_DOMAINS);
  assert.equal(leadCtx?.isLateralSpace, true);
  const created = await createCase(exec!, {
    workspaceId: ids.ws,
    user: leadCtx!,
    canReviewWorkspacePortfolio: true,
    input: { templateId: state.templateId, code: `cmd-${suffix}`, title: "Caso dei comandi", portfolioUseCaseId: ids.useCase },
  });
  assert.ok(created.ok, created.ok ? "" : created.message);
  assert.equal(created.value.code, `CMD-${suffix.toUpperCase()}`);
  state.caseId = created.value.caseId;
  const again = await createCase(exec!, {
    workspaceId: ids.ws,
    user: leadCtx!,
    canReviewWorkspacePortfolio: true,
    input: { templateId: state.templateId, code: "CMD-ALTRO", title: "Secondo caso", portfolioUseCaseId: ids.useCase },
  });
  assert.equal(again.ok ? null : again.code, "caso_gia_avviato");
  for (const r of await q(`SELECT id, key FROM uc_items WHERE case_id = $1::uuid`, [state.caseId])) state.items.set(String(r.key), String(r.id));
  const list = await listCases(exec!, { workspaceId: ids.ws, user: leadCtx!, canManageWorkspaceSettings: false, lsDomains: LS_DOMAINS });
  assert.deepEqual(list.map((c) => [c.code, c.roles]), [[created.value.code, ["ls_lead"]]]);
  const outsider = await listCases(exec!, { workspaceId: ids.ws, user: ownerCtx!, canManageWorkspaceSettings: false, lsDomains: LS_DOMAINS });
  assert.equal(outsider.length, 0);
});

test("members: Lateral Space roles only to Lateral Space, client roles only to the client", opts, async () => {
  const lead = await ctxFor(ids.lead);
  const wrong = await addCaseMember(exec!, lead, { userId: ids.owner, role: "ls_analista" });
  assert.equal(wrong.ok ? null : wrong.code, "ruolo_solo_lateral_space");
  const wrong2 = await addCaseMember(exec!, lead, { userId: ids.analyst, role: "owner_cliente" });
  assert.equal(wrong2.ok ? null : wrong2.code, "ruolo_solo_cliente");
  for (const [userId, role] of [
    [ids.analyst, "ls_analista"],
    [ids.owner, "owner_cliente"],
    [ids.privacy, "approvatore_privacy"],
  ] as const) {
    const r = await addCaseMember(exec!, lead, { userId, role });
    assert.ok(r.ok, r.ok ? "" : r.message);
  }
  const dup = await addCaseMember(exec!, lead, { userId: ids.owner, role: "owner_cliente" });
  assert.equal(dup.ok ? null : dup.code, "gia_membro");
  const analyst = await ctxFor(ids.analyst);
  const notLead = await addCaseMember(exec!, analyst, { userId: ids.privacy, role: "osservatore" });
  assert.equal(notLead.ok ? null : notLead.code, "attore_non_ammesso");
});

test("first send moves the case to raccolta; a referent's answer is validated only by someone else", opts, async () => {
  const lead = await ctxFor(ids.lead);
  const key = "q.servizio.02";
  await q(`INSERT INTO uc_contacts (id, workspace_id, display_name, email, template_role_key) VALUES ($1::uuid, $2::uuid, 'Referente di prova', $3, 'resp_servizio')`, [
    ids.contact,
    ids.ws,
    `cmd-ref-${suffix}@cliente.test`,
  ]);
  await q(`UPDATE uc_items SET assignee_contact_id = $1::uuid WHERE id = $2::uuid`, [ids.contact, item(key)]);
  await q(
    `INSERT INTO uc_requests (id, case_id, contact_id, share_epoch, acting_role_key, status) VALUES ($1::uuid, $2::uuid, $3::uuid, 0, 'resp_servizio', 'bozza')`,
    [ids.request, state.caseId, ids.contact],
  );
  await q(`INSERT INTO uc_request_items (case_id, request_id, item_id, state) VALUES ($1::uuid, $2::uuid, $3::uuid, 'da_fare')`, [state.caseId, ids.request, item(key)]);

  const sent = await applyItemTransitions(exec!, lead, { itemIds: [item(key)], transitions: [{ itemId: item(key), to: "chiesta", trigger: "invio_richiesta" }] });
  assert.ok(sent.ok, sent.ok ? "" : sent.message);
  assert.deepEqual(sent.value.sideEffects, ["caso_in_raccolta"]);
  assert.equal((await one(`SELECT status FROM uc_cases WHERE id = $1::uuid`, [state.caseId])).status, "raccolta");
  await q(`UPDATE uc_requests SET status = 'inviata', sent_at = now(), expires_at = now() + interval '30 days' WHERE id = $1::uuid`, [ids.request]);
  await q(`UPDATE uc_request_items SET state = 'inviata' WHERE request_id = $1::uuid`, [ids.request]);

  const referent = { ...lead, actor: { type: "referente" as const, contactId: ids.contact, requestId: ids.request, roleKey: "resp_servizio" }, user: null };
  const answerId = randomUUID();
  const answered = await applyItemTransitions(exec!, referent, {
    itemIds: [item(key)],
    transitions: [
      {
        itemId: item(key),
        to: "in_verifica",
        trigger: "risposta",
        answer: { kind: "valore", sourceKind: "referente" },
        actorRequestItem: { requestId: ids.request, state: "inviata" },
        extraSet: { currentAnswerId: answerId },
      },
    ],
    before: [
      answerInsertSql({
        id: answerId,
        workspaceId: ids.ws,
        caseId: state.caseId,
        itemId: item(key),
        kind: "valore",
        value: { value: 40, unit: "richieste" },
        valueNormalized: { value_si: 40 },
        validFrom: null,
        confidence: "certo",
        note: null,
        sourceKind: "referente",
        sourceRef: null,
        sourceBasis: "sistema",
        responderUserId: null,
        responderContactId: ids.contact,
        requestId: ids.request,
        textHash: null,
        responseType: "numero",
        actor: { type: "referente", contactId: ids.contact },
      }),
    ],
  });
  assert.ok(answered.ok, answered.ok ? "" : answered.message);
  assert.equal(await statusOf(key), "in_verifica");

  // An LS-entered value: whoever entered it cannot validate, and without the owner's confirmation nobody can.
  const lsKey = "q.servizio.05";
  const recorded = await recordLsAnswer(exec!, lead, { itemId: item(lsKey), value: "90 min", sourceKind: "documento", sourceRef: "Procedura interna, pagina 2" });
  assert.ok(recorded.ok, recorded.ok ? "" : recorded.message);
  assert.equal(await statusOf(lsKey), "in_verifica");
  const self = await validateItem(exec!, lead, { itemId: item(lsKey) });
  assert.equal(self.ok ? null : self.code, "stessa_persona");
  const analyst = await ctxFor(ids.analyst);
  const unconfirmed = await validateItem(exec!, analyst, { itemId: item(lsKey) });
  assert.equal(unconfirmed.ok ? null : unconfirmed.code, "conferma_titolare_mancante");

  const owner = await ctxFor(ids.owner);
  const clientCannot = await validateItem(exec!, owner, { itemId: item(key) });
  assert.equal(clientCannot.ok ? null : clientCannot.code, "attore_non_ammesso");
  const validated = await validateItem(exec!, analyst, { itemId: item(key) });
  assert.ok(validated.ok, validated.ok ? "" : validated.message);
  assert.equal(await statusOf(key), "validata");
  const row = await one(`SELECT validated_answer_id, validated_by_user_id FROM uc_items WHERE id = $1::uuid`, [item(key)]);
  assert.equal(row.validated_answer_id, answerId);
  assert.equal(row.validated_by_user_id, ids.analyst);
  assert.equal(Number((await one(`SELECT count(*) AS n FROM uc_validations WHERE item_id = $1::uuid AND kind = 'umana'`, [item(key)])).n), 1);
  const events = await q(`SELECT event_type, payload FROM uc_events WHERE case_id = $1::uuid AND (target_id = $2::uuid OR payload ->> 'item_key' = $3) ORDER BY created_at`, [
    state.caseId,
    item(key),
    key,
  ]);
  assert.ok(events.some((e) => e.event_type === "risposta.inviata"));
  assert.ok(events.some((e) => e.event_type === "validazione.registrata"));
  assert.ok(events.every((e) => !JSON.stringify(e.payload).includes("40")), "no answer value in the audit");
});

test("two concurrent transitions on the same item: exactly one wins, the other gets conflitto", opts, async () => {
  const analyst = await ctxFor(ids.analyst);
  const lead = await ctxFor(ids.lead);
  const key = "q.servizio.05";
  const [a, b] = await Promise.all([
    transitionItems(exec!, lead, { itemIds: [item(key)], trigger: "esito_mancante", reason: "Manca il documento di riferimento" }),
    transitionItems(exec!, analyst, { itemIds: [item(key)], trigger: "esito_parziale", reason: "Risposta incompleta per i festivi" }),
  ]);
  assert.equal([a, b].filter((r) => r.ok).length, 1);
  const loser = [a, b].find((r) => !r.ok);
  assert.ok(loser && !loser.ok && ["conflitto", "transizione_non_ammessa", "motivo_non_ammesso"].includes(loser.code), loser && !loser.ok ? loser.code : "");
  assert.ok(["mancante", "parziale"].includes(await statusOf(key)));
});

test("clarification reopens the item, opens a shared comment and queues the email", opts, async () => {
  const lead = await ctxFor(ids.lead);
  const key = "q.servizio.02";
  await q(`UPDATE uc_items SET status = 'in_verifica', status_changed_at = now() WHERE id = $1::uuid`, [item(key)]);
  const r = await requestClarification(exec!, lead, { itemId: item(key), message: "Il valore vale anche nei fine settimana?" });
  assert.ok(r.ok, r.ok ? "" : r.message);
  assert.equal(await statusOf(key), "chiesta");
  const comment = await one(`SELECT kind, visibility, resolved_at FROM uc_comments WHERE id = $1::uuid`, [r.value.commentId]);
  assert.equal(comment.kind, "chiarimento_richiesto");
  assert.equal(comment.visibility, "condiviso");
  const notification = await one(`SELECT channel, template_key, status, payload FROM uc_notifications WHERE dedupe_key = $1`, [`chiarimento:${r.value.commentId}`]);
  assert.equal(notification.template_key, "chiarimento");
  assert.equal(notification.status, "in_coda");
  assert.ok(!JSON.stringify(notification.payload).includes("fine settimana"), "no free text in the queue payload");
});

test("not applicable needs one Lateral Space and one client signature, from two people", opts, async () => {
  const analyst = await ctxFor(ids.analyst);
  const lead = await ctxFor(ids.lead);
  const owner = await ctxFor(ids.owner);
  const key = "q.servizio.01";
  const proposed = await proposeNa(exec!, analyst, { itemId: item(key), reason: "La tabella non serve per questo processo" });
  assert.ok(proposed.ok, proposed.ok ? "" : proposed.message);
  const analystSign = await signNa(exec!, analyst, { itemId: item(key) });
  assert.equal(analystSign.ok ? null : analystSign.code, "firmatario_non_ammesso");
  const first = await signNa(exec!, lead, { itemId: item(key) });
  assert.ok(first.ok && !first.value.complete);
  assert.equal(await statusOf(key), "da_chiedere");
  const twice = await signNa(exec!, lead, { itemId: item(key) });
  assert.equal(twice.ok ? null : twice.code, "firma_gia_presente");
  const second = await signNa(exec!, owner, { itemId: item(key) });
  assert.ok(second.ok && second.value.complete, second.ok ? "" : second.message);
  assert.equal(await statusOf(key), "non_applicabile");
  const row = await one(`SELECT na_approved_at, na_approved_by_user_id, na_client_approved_by_user_id FROM uc_items WHERE id = $1::uuid`, [item(key)]);
  assert.ok(row.na_approved_at);
  assert.equal(row.na_approved_by_user_id, ids.lead);
  assert.equal(row.na_client_approved_by_user_id, ids.owner);
});

test("blocker a8: two signatures on the same evidence unblock the items; reactivation locks them again", opts, async () => {
  const lead = await ctxFor(ids.lead);
  const owner = await ctxFor(ids.owner);
  const privacy = await ctxFor(ids.privacy);
  const key = "q.sistemi.05";
  assert.equal(await statusOf(key), "bloccata");
  const a8 = await one(`SELECT id FROM uc_blockers WHERE case_id = $1::uuid AND key = 'a8'`, [state.caseId]);
  await q(
    `INSERT INTO uc_files (id, workspace_id, case_id, file_name, mime, size_bytes, sha256, privacy_class, max_size_bytes, scan_status, content_scanned)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'prova.pdf', 'application/pdf', 100, $4, 'riservato_azienda', 1000, 'pulito', true)`,
    [ids.file, ids.ws, state.caseId, "b".repeat(64)],
  );
  const evidence = {
    documento: "Scheda privacy",
    versione: "1.0",
    data: "2026-10-01",
    approvatori_per_ruolo: ["approvatore_privacy"],
    file_id: ids.file,
    titolo_art_15_2: true,
    regione_dati_verificata: true,
    accesso_zona_personale: [],
  };
  const byOwner = await resolveBlocker(exec!, owner, { blockerId: String(a8.id), evidence });
  assert.equal(byOwner.ok ? null : byOwner.code, "attore_non_ammesso");
  const first = await resolveBlocker(exec!, lead, { blockerId: String(a8.id), evidence });
  assert.ok(first.ok, first.ok ? "" : first.message);
  assert.equal(first.value.complete, false);
  assert.equal(first.value.message, "In attesa della conferma del cliente");
  assert.equal(await statusOf(key), "bloccata");
  const second = await resolveBlocker(exec!, privacy, { blockerId: String(a8.id) });
  assert.ok(second.ok, second.ok ? "" : second.message);
  assert.equal(second.value.complete, true);
  assert.ok(second.value.unblockedItems >= 1);
  assert.equal(await statusOf(key), "da_chiedere");
  const stillBlocked = Number(
    (
      await one(
        `SELECT count(*) AS n FROM uc_items i WHERE i.case_id = $1::uuid AND i.status = 'bloccata'
           AND NOT EXISTS (SELECT 1 FROM uc_item_blockers ib JOIN uc_blockers b ON b.id = ib.blocker_id WHERE ib.item_id = i.id AND b.status IN ('attivo', 'permanente'))`,
        [state.caseId],
      )
    ).n,
  );
  assert.equal(stillBlocked, 0, "no item stays locked without an active blocker");
  assert.equal((await one(`SELECT status FROM uc_blockers WHERE id = $1::uuid`, [a8.id])).status, "sciolto");

  const reactivated = await reactivateBlocker(exec!, lead, { blockerId: String(a8.id), reason: "Scheda ritirata" });
  assert.ok(reactivated.ok, reactivated.ok ? "" : reactivated.message);
  assert.equal(await statusOf(key), "bloccata");
  const blockerRow = await one(`SELECT status, approvals FROM uc_blockers WHERE id = $1::uuid`, [a8.id]);
  assert.equal(blockerRow.status, "attivo");
  assert.deepEqual(blockerRow.approvals, []);
});

test("reclassification: privacy only goes up, and a new active blocker locks the item in the same batch", opts, async () => {
  const lead = await ctxFor(ids.lead);
  const key = "q.sistemi.07";
  const lowered = await updateItemMeta(exec!, lead, { itemId: item("q.costi.01"), privacyClass: "nessuna" });
  assert.equal(lowered.ok ? null : lowered.code, "classe_privacy_abbassata");
  const raised = await updateItemMeta(exec!, lead, { itemId: item(key), privacyClass: "personale" });
  assert.ok(raised.ok, raised.ok ? "" : raised.message);
  assert.equal(raised.value.blocked, true);
  assert.equal(await statusOf(key), "bloccata");
  const link = await one(
    `SELECT ib.origin FROM uc_item_blockers ib JOIN uc_blockers b ON b.id = ib.blocker_id WHERE ib.item_id = $1::uuid AND b.key = 'a8'`,
    [item(key)],
  );
  assert.equal(link.origin, "scope");
});

test("manual blocker without scope locks an item; ls_lead resolves it with written evidence", opts, async () => {
  const lead = await ctxFor(ids.lead);
  const owner = await ctxFor(ids.owner);
  const key = "q.costi.03";
  const blocker = await one(`SELECT id FROM uc_blockers WHERE case_id = $1::uuid AND key = 'costi_art_8_4'`, [state.caseId]);
  const refused = await addManualBlocker(exec!, owner, { blockerId: String(blocker.id), itemId: item(key) });
  assert.equal(refused.ok ? null : refused.code, "attore_non_ammesso");
  const added = await addManualBlocker(exec!, lead, { blockerId: String(blocker.id), itemId: item(key) });
  assert.ok(added.ok && added.value.blocked, added.ok ? "" : added.message);
  assert.equal(await statusOf(key), "bloccata");
  const again = await addManualBlocker(exec!, lead, { blockerId: String(blocker.id), itemId: item(key) });
  assert.equal(again.ok ? null : again.code, "blocco_gia_presente");
  const missing = await resolveBlocker(exec!, lead, { blockerId: String(blocker.id), evidence: { data: "2026-10-02" } });
  assert.equal(missing.ok ? null : missing.code, "prove_mancanti");
  const resolved = await resolveBlocker(exec!, lead, { blockerId: String(blocker.id), evidence: { file_id: ids.file, data: "2026-10-02" } });
  assert.ok(resolved.ok && resolved.value.complete && resolved.value.unblockedItems === 1, resolved.ok ? "" : resolved.message);
  assert.equal(await statusOf(key), "da_chiedere");
});

test("gate G1: proposal, contract rule, written evidence, two signatures and catalog v1 with the card in progress", opts, async () => {
  const lead = await ctxFor(ids.lead);
  const analyst = await ctxFor(ids.analyst);
  const owner = await ctxFor(ids.owner);
  // Make every required item ok: q.servizio.02 back to validated, the others not applicable with two signatures.
  await q(`UPDATE uc_comments SET resolved_at = now() WHERE item_id = $1::uuid`, [item("q.servizio.02")]);
  await q(`UPDATE uc_items SET status = 'validata', status_changed_at = now() WHERE id = $1::uuid`, [item("q.servizio.02")]);
  for (const key of ["q.servizio.03", "q.servizio.04", "q.costi.01", "q.costi.02", "q.sistemi.01"]) {
    assert.ok((await proposeNa(exec!, analyst, { itemId: item(key), reason: "Non serve nel primo rilascio del modello" })).ok, key);
    assert.ok((await signNa(exec!, lead, { itemId: item(key) })).ok, key);
    const s = await signNa(exec!, owner, { itemId: item(key) });
    assert.ok(s.ok && s.value.complete, key);
  }
  const overview = await getCaseOverview(exec!, lead);
  assert.ok(overview);
  assert.equal(overview.g1.required, 7);
  assert.equal(overview.g1.ready, true, JSON.stringify({ conditions: overview.g1.conditions, missing: overview.g1.missing }));
  assert.equal(overview.gateLine, "Tutte le voci obbligatorie sono verdi. Il team Lateral Space può avviare lo sviluppo.");

  const notLead = await proposeGate(exec!, analyst, {});
  assert.equal(notLead.ok ? null : notLead.code, "attore_non_ammesso");
  const proposed = await proposeGate(exec!, lead, {});
  assert.ok(proposed.ok, proposed.ok ? "" : proposed.message);
  const duplicate = await proposeGate(exec!, lead, {});
  assert.equal(duplicate.ok ? null : duplicate.code, "proposta_aperta");

  await q(`UPDATE uc_cases SET contract_refs = '["art. 1"]'::jsonb WHERE id = $1::uuid`, [state.caseId]);
  const unconfirmed = await signGate(exec!, owner, { reviewId: proposed.value.reviewId });
  assert.equal(unconfirmed.ok ? null : unconfirmed.code, "regola_gate_da_confermare");
  const confirmed = await confirmGatePolicy(exec!, { caseId: state.caseId, actorUserId: ids.lead, scope: "request_modules", note: null });
  assert.ok(confirmed.ok, confirmed.ok ? "" : confirmed.message);
  assert.equal(confirmed.value.changedItems, 0);
  const analystSign = await signGate(exec!, analyst, { reviewId: proposed.value.reviewId });
  assert.equal(analystSign.ok ? null : analystSign.code, "firmatario_non_ammesso");
  const ownerSign = await signGate(exec!, owner, { reviewId: proposed.value.reviewId });
  assert.ok(ownerSign.ok, ownerSign.ok ? "" : ownerSign.message);
  assert.equal(ownerSign.value.complete, false);
  assert.equal(ownerSign.value.waitingFor, "prova_scritta");

  const withEvidence = await signGate(exec!, lead, { reviewId: proposed.value.reviewId, evidenceFileId: ids.file });
  assert.ok(withEvidence.ok, withEvidence.ok ? "" : withEvidence.message);
  assert.equal(withEvidence.value.complete, true);
  assert.equal(withEvidence.value.catalogVersion, 1);
  const caseRow = await one(`SELECT status, catalog_version FROM uc_cases WHERE id = $1::uuid`, [state.caseId]);
  assert.equal(caseRow.status, "pronto_sviluppo");
  assert.equal(caseRow.catalog_version, 1);
  assert.equal((await one(`SELECT status FROM use_cases WHERE id = $1::uuid`, [ids.useCase])).status, "in_progress");
  const review = await one(`SELECT decision, catalog_version, written_evidence_file_id FROM uc_gate_reviews WHERE id = $1::uuid`, [proposed.value.reviewId]);
  assert.equal(review.decision, "approvato");
  assert.equal(review.written_evidence_file_id, ids.file);
  const version = await one(`SELECT reason, snapshot, snapshot_hash FROM uc_catalog_versions WHERE case_id = $1::uuid AND version = 1`, [state.caseId]);
  assert.equal(version.reason, "gate");
  const snapshot = version.snapshot as { version: number; items: { key: string; status: string; answer: { value: unknown } | null; privacy_class: string }[] };
  assert.equal(snapshot.version, 1);
  const validatedItem = snapshot.items.find((i) => i.key === "q.servizio.02");
  assert.equal(validatedItem?.status, "validata");
  assert.deepEqual(validatedItem?.answer?.value, { value: 40, unit: "richieste" });
  assert.ok(snapshot.items.filter((i) => i.privacy_class === "personale").every((i) => i.answer === null || i.answer.value === null));
  const versions = await listCatalogVersions(exec!, state.caseId);
  assert.equal(versions.length, 1);
  assert.equal((await one(`SELECT count(*) AS n FROM uc_events WHERE case_id = $1::uuid AND event_type IN ('gate.approvato', 'catalogo.congelato')`, [state.caseId])).n, "2");
});

test("two concurrent signatures on a reproposal produce one catalog version and one conflitto", opts, async () => {
  const lead = await ctxFor(ids.lead);
  const owner = await ctxFor(ids.owner);
  const proposed = await proposeGate(exec!, lead, { evidenceFileId: ids.file });
  assert.ok(proposed.ok, proposed.ok ? "" : proposed.message);
  const results = await Promise.all([signGate(exec!, owner, { reviewId: proposed.value.reviewId }), signGate(exec!, owner, { reviewId: proposed.value.reviewId })]);
  assert.equal(results.filter((r) => r.ok && r.value.complete).length, 1, JSON.stringify(results));
  const loser = results.find((r) => !r.ok);
  assert.equal(loser && !loser.ok ? loser.code : null, "conflitto");
  const versions = await q(`SELECT version, reason FROM uc_catalog_versions WHERE case_id = $1::uuid ORDER BY version`, [state.caseId]);
  assert.deepEqual(
    versions.map((v) => [v.version, v.reason]),
    [
      [1, "gate"],
      [2, "correzione"],
    ],
  );
  const rejectedLater = await rejectGate(exec!, lead, { reviewId: proposed.value.reviewId, reason: "Ripensamento" });
  assert.equal(rejectedLater.ok ? null : rejectedLater.code, "gate_gia_deciso");
});

test("readiness cache follows the live computation", opts, async () => {
  const readiness = await refreshReadinessCache(exec!, ids.ws, state.caseId);
  assert.ok(readiness);
  const cached = (await one(`SELECT readiness FROM uc_cases WHERE id = $1::uuid`, [state.caseId])).readiness as { G1: { required: number; ok: number } };
  assert.equal(cached.G1.required, readiness.G1.required);
  assert.equal(cached.G1.ok, readiness.G1.ok);
});

test("closing the case revokes live requests: asked items go back to da_chiedere", opts, async () => {
  const lead = await ctxFor(ids.lead);
  const key = "q.costi.04";
  await q(`UPDATE uc_items SET assignee_contact_id = $1::uuid WHERE id = $2::uuid`, [ids.contact, item(key)]);
  await q(
    `INSERT INTO uc_requests (id, case_id, contact_id, share_epoch, status, sent_at, expires_at) VALUES ($1::uuid, $2::uuid, $3::uuid, 0, 'inviata', now(), now() + interval '30 days')`,
    [ids.request2, state.caseId, ids.contact],
  );
  await q(`INSERT INTO uc_request_items (case_id, request_id, item_id, state) VALUES ($1::uuid, $2::uuid, $3::uuid, 'da_fare')`, [state.caseId, ids.request2, item(key)]);
  const sent = await applyItemTransitions(exec!, lead, { itemIds: [item(key)], transitions: [{ itemId: item(key), to: "chiesta", trigger: "invio_richiesta" }] });
  assert.ok(sent.ok, sent.ok ? "" : sent.message);
  const noReason = await transitionCase(exec!, lead, { to: "chiuso" });
  assert.equal(noReason.ok ? null : noReason.code, "motivo_obbligatorio");
  const closed = await transitionCase(exec!, lead, { to: "chiuso", reason: "Chiuso per la prova" });
  assert.ok(closed.ok, closed.ok ? "" : closed.message);
  assert.equal(await statusOf(key), "da_chiedere");
  const requests = await q(`SELECT status, revoked_at FROM uc_requests WHERE case_id = $1::uuid`, [state.caseId]);
  assert.ok(requests.every((r) => r.status === "revocata" && r.revoked_at));
  const after = await applyItemTransitions(exec!, lead, { itemIds: [item(key)], transitions: [{ itemId: item(key), to: "mancante", trigger: "esito_mancante", reason: "Prova" }] });
  assert.equal(after.ok ? null : after.code, "transizione_non_ammessa");
});

test("removal from the workspace takes away every case role", opts, async () => {
  const removed = await removeUserFromWorkspaceCases(exec!, { workspaceId: ids.ws, userId: ids.analyst, actorUserId: ids.lead });
  assert.equal(removed.removedRoles, 1);
  assert.deepEqual(removed.casesWithoutLead, []);
  assert.equal(Number((await one(`SELECT count(*) AS n FROM uc_case_members WHERE user_id = $1::uuid`, [ids.analyst])).n), 0);
  const event = await one(`SELECT payload FROM uc_events WHERE case_id = $1::uuid AND event_type = 'membro.rimosso' AND target_id = $2::uuid`, [state.caseId, ids.analyst]);
  assert.deepEqual(event.payload, { role: "ls_analista" });
});
