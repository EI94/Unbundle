import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { createUcExecutor, type UcExecutor } from "../db/uc-executor.ts";
import { applyTemplateLoad } from "../db/queries/uc-templates.ts";
import { addCaseMember, commandContextFor, confirmGatePolicy, createCase, loadCaseReadiness, loadUserContext, type UcCommandContext } from "../db/queries/uc-cases.ts";
import { proposeGate, rejectGate, signGate } from "../db/queries/uc-gates.ts";
import { loadOverview, loadVia } from "../db/queries/uc-overview.ts";
import { isRequired } from "./gates.ts";
import { planTemplateLoad } from "./template/load.ts";
import { latestApproval, moduleProgress, overviewBlockers, reviewHistoryRow, viaAction, viaConditions, viaProgress, viaShownSignatures, viaState, type ViaAction } from "./views/progress.ts";

// Opt-in integration suite for the overview and the via page (WP2, DESIGN §3.4,
// §3.5), on the isolated local harness only. Same guard as the other uc suites:
//   UC_TEST_DATABASE_URL=postgresql://uc_test@127.0.0.1:55449/unbundle_uc_test UC_TEST_ISOLATED=true \
//   NODE_OPTIONS=--require=./scripts/uc-test/local-neon.cjs node --no-warnings --test --test-concurrency=1 src/lib/uc/overview.integration.test.ts
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

/** Conta i giri verso il database (una chiamata a `batch` = una richiesta). */
function counting(): { executor: UcExecutor; trips: () => number } {
  let n = 0;
  return {
    executor: {
      batch(statements) {
        n++;
        return exec!.batch(statements);
      },
    },
    trips: () => n,
  };
}

const LS_DOMAINS = ["ls.test"];
const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), ws: randomUUID(), otherWs: randomUUID(), lead: randomUUID(), owner: randomUUID(), file: randomUUID(), contractFile: randomUUID() };
const exampleText = readFileSync(new URL("../../../templates/uc/esempio.minimo/1.0.0.json", import.meta.url), "utf8");
const state: { caseId: string; items: Map<string, string>; blockers: Map<string, string> } = { caseId: "", items: new Map(), blockers: new Map() };
/** Un secondo caso dello stesso workspace (a contratto, per la prova scritta) e uno di un altro workspace: i blocchi non passano da un caso all'altro. */
const other: { contractCaseId: string; contractItems: Map<string, string>; contractBlockers: Map<string, string>; otherWsCaseId: string; otherWsBlocker: string } = {
  contractCaseId: "",
  contractItems: new Map(),
  contractBlockers: new Map(),
  otherWsCaseId: "",
  otherWsBlocker: "",
};
const REQUIRED_KEYS = ["q.servizio.01", "q.servizio.02", "q.servizio.03", "q.servizio.04", "q.costi.01", "q.costi.02", "q.sistemi.01"];
const NOW = new Date("2026-10-14T10:00:00Z");

/** «Non si applica» con le due firme (Lateral Space e responsabile del cliente), come dopo il comando. */
async function signedNa(itemIds: readonly string[]) {
  await q(
    `UPDATE uc_items SET status = 'non_applicabile', na_approved_at = now(), na_approved_by_user_id = $2::uuid, na_client_approved_by_user_id = $3::uuid WHERE id = ANY($1::uuid[])`,
    [itemIds, ids.lead, ids.owner],
  );
}

async function ctxFor(userId: string, caseId = state.caseId, workspaceId = ids.ws): Promise<UcCommandContext> {
  const r = await commandContextFor(exec!, { workspaceId, caseId, userId, lsDomains: LS_DOMAINS });
  assert.ok(r.ok, r.ok ? "" : r.message);
  return r.value;
}

/** Un caso nuovo dallo schema d'esempio (pubblicato e riservato al workspace), con le sue domande e i suoi blocchi per chiave. */
async function exampleCase(workspaceId: string, keySuffix: string, code: string, title: string): Promise<{ caseId: string; items: Map<string, string>; blockers: Map<string, string> }> {
  const value = JSON.parse(exampleText) as Record<string, unknown>;
  value.key = `prova.panoramica_${keySuffix}`;
  const plan = planTemplateLoad(JSON.stringify(value), { restrictToWorkspaceId: workspaceId });
  assert.ok(plan.ok);
  const loaded = await applyTemplateLoad(exec!, plan.plan, { actorUserId: ids.lead, publish: true });
  assert.ok(loaded.ok, loaded.ok ? "" : loaded.message);
  const leadUser = await loadUserContext(exec!, ids.lead, LS_DOMAINS);
  const created = await createCase(exec!, { workspaceId, user: leadUser!, canReviewWorkspacePortfolio: true, input: { templateId: loaded.value.templateId, code, title } });
  assert.ok(created.ok, created.ok ? "" : created.message);
  const caseId = created.value.caseId;
  const items = new Map<string, string>();
  const blockers = new Map<string, string>();
  for (const r of await q(`SELECT id, key FROM uc_items WHERE case_id = $1::uuid`, [caseId])) items.set(String(r.key), String(r.id));
  for (const r of await q(`SELECT id, key FROM uc_blockers WHERE case_id = $1::uuid`, [caseId])) blockers.set(String(r.key), String(r.id));
  return { caseId, items, blockers };
}

before(async () => {
  if (!sql) return;
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Org prova panoramica', $2)`, [ids.org, `uc-overview-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $3::uuid, 'Prova panoramica'), ($2::uuid, $3::uuid, 'Altra panoramica')`, [ids.ws, ids.otherWs, ids.org]);
  await q(`INSERT INTO users (id, email, email_verified, name) VALUES ($1::uuid, $3, now(), 'Lead di prova'), ($2::uuid, $4, now(), 'Responsabile di prova')`, [
    ids.lead,
    ids.owner,
    `overview-lead-${suffix}@ls.test`,
    `overview-owner-${suffix}@cliente.test`,
  ]);
  await q(`INSERT INTO memberships (user_id, organization_id, role) VALUES ($1::uuid, $3::uuid, 'transformation_lead'), ($2::uuid, $3::uuid, 'contributor')`, [ids.lead, ids.owner, ids.org]);
  const value = JSON.parse(exampleText) as Record<string, unknown>;
  value.key = `prova.panoramica_${suffix}`;
  const plan = planTemplateLoad(JSON.stringify(value), { restrictToWorkspaceId: ids.ws });
  assert.ok(plan.ok);
  const loaded = await applyTemplateLoad(exec!, plan.plan, { actorUserId: ids.lead, publish: true });
  assert.ok(loaded.ok, loaded.ok ? "" : loaded.message);
  const leadUser = await loadUserContext(exec!, ids.lead, LS_DOMAINS);
  const created = await createCase(exec!, {
    workspaceId: ids.ws,
    user: leadUser!,
    canReviewWorkspacePortfolio: true,
    input: { templateId: loaded.value.templateId, code: `PANO-${suffix}`.toUpperCase(), title: "Caso della panoramica" },
  });
  assert.ok(created.ok, created.ok ? "" : created.message);
  state.caseId = created.value.caseId;
  for (const r of await q(`SELECT id, key FROM uc_items WHERE case_id = $1::uuid`, [state.caseId])) state.items.set(String(r.key), String(r.id));
  for (const r of await q(`SELECT id, key FROM uc_blockers WHERE case_id = $1::uuid`, [state.caseId])) state.blockers.set(String(r.key), String(r.id));
  const r = await addCaseMember(exec!, await ctxFor(ids.lead), { userId: ids.owner, role: "owner_cliente" });
  assert.ok(r.ok, r.ok ? "" : r.message);
  await q(`UPDATE uc_cases SET status = 'raccolta', description = description || $2::jsonb WHERE id = $1::uuid`, [
    state.caseId,
    JSON.stringify({ in_breve: "Instrada ogni richiesta alla persona giusta.", fasi: [{ fase: "Preparazione", quando: "ottobre", cosa: "Raccolta dei dati" }, "Sviluppo"] }),
  ]);
  await q(
    `INSERT INTO uc_milestones (case_id, key, title, planned_date, is_proposal, to_confirm, sort_order, done_at) VALUES
       ($1::uuid, 'm1', 'Avvio', '2026-10-01', false, false, 1, now()),
       ($1::uuid, 'm2', 'Mappatura dei dati', '2026-10-23', true, false, 2, NULL),
       ($1::uuid, 'm3', 'Prova sul passato', NULL, true, true, 3, NULL)`,
    [state.caseId],
  );
  await q(
    `INSERT INTO uc_files (id, workspace_id, case_id, file_name, mime, size_bytes, sha256, privacy_class, max_size_bytes, scan_status, content_scanned)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'verbale.pdf', 'application/pdf', 100, $4, 'nessuna', 1000, 'pulito', true)`,
    [ids.file, ids.ws, state.caseId, "b".repeat(64)],
  );

  // Secondo caso, stesso workspace: a contratto (regola confermata), in preparazione, con il responsabile del cliente e un file per la prova scritta.
  const contract = await exampleCase(ids.ws, `contratto_${suffix}`, `PANC-${suffix}`.toUpperCase(), "Caso a contratto della panoramica");
  other.contractCaseId = contract.caseId;
  other.contractItems = contract.items;
  other.contractBlockers = contract.blockers;
  const member = await addCaseMember(exec!, await ctxFor(ids.lead, contract.caseId), { userId: ids.owner, role: "owner_cliente" });
  assert.ok(member.ok, member.ok ? "" : member.message);
  await q(`UPDATE uc_cases SET status = 'raccolta', contract_refs = '["art. 3"]'::jsonb WHERE id = $1::uuid`, [contract.caseId]);
  const confirmed = await confirmGatePolicy(exec!, { caseId: contract.caseId, actorUserId: ids.lead, scope: "request_modules", note: null });
  assert.ok(confirmed.ok, confirmed.ok ? "" : confirmed.message);
  await q(
    `INSERT INTO uc_files (id, workspace_id, case_id, file_name, mime, size_bytes, sha256, privacy_class, max_size_bytes, scan_status, content_scanned)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'email-di-approvazione.pdf', 'application/pdf', 100, $4, 'nessuna', 1000, 'pulito', true)`,
    [ids.contractFile, ids.ws, contract.caseId, "c".repeat(64)],
  );

  // Un caso di un altro workspace, con i suoi blocchi.
  const elsewhere = await exampleCase(ids.otherWs, `altro_${suffix}`, `PANA-${suffix}`.toUpperCase(), "Caso di un altro workspace");
  other.otherWsCaseId = elsewhere.caseId;
  other.otherWsBlocker = elsewhere.blockers.get("accesso_sistema")!;
  assert.ok(other.otherWsBlocker);
});

after(async () => {
  if (!sql) return;
  await q(`DELETE FROM workspaces WHERE id IN ($1::uuid, $2::uuid)`, [ids.ws, ids.otherWs]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id IN ($1::uuid, $2::uuid)`, [ids.lead, ids.owner]);
});

test("overview: one round-trip, the indispensable questions with the same count as the via, topics, blockers, milestones and the summary", opts, async () => {
  // Una in verifica, una «non si applica» con le due firme (a posto), una ferma per un blocco; le altre da chiedere.
  await q(`UPDATE uc_items SET status = 'in_verifica' WHERE id = $1::uuid`, [state.items.get("q.servizio.01")]);
  await signedNa([state.items.get("q.servizio.02")!]);
  await q(`UPDATE uc_items SET status = 'bloccata' WHERE id = $1::uuid`, [state.items.get("q.costi.01")]);
  await q(`INSERT INTO uc_item_blockers (item_id, blocker_id, origin) VALUES ($1::uuid, $2::uuid, 'manuale') ON CONFLICT DO NOTHING`, [
    state.items.get("q.costi.01"),
    state.blockers.get("accesso_sistema"),
  ]);

  const c = counting();
  const data = await loadOverview(c.executor, { workspaceId: ids.ws, caseId: state.caseId, now: NOW });
  assert.equal(c.trips(), 1, "the overview reads in one round-trip");
  assert.ok(data);
  const live = await loadCaseReadiness(exec!, ids.ws, state.caseId, NOW);
  assert.ok(live);
  assert.equal(data.required.length, live.input.items.filter((i) => isRequired(i, "G1")).length);
  assert.equal(data.required.length, 7);
  assert.equal(data.required.filter((r) => r.ok).length, live.g1.ok, "the sum of the topics is the number of the via");
  const progress = viaProgress(data.required, "ls");
  assert.deepEqual([progress.required, progress.ok, progress.inReview], [7, 1, 1]);
  assert.deepEqual(
    progress.open.map((g) => g.text),
    ["4 da fare", "1 da verificare", "1 bloccata"],
  );
  assert.deepEqual(
    data.modules.map((m) => m.key),
    ["m.servizio.base", "m.costi.base", "m.sistemi.base"],
  );
  assert.deepEqual(
    moduleProgress(data.required, data.modules, { roleLabels: data.roleLabels }).map((r) => [r.key, r.ok, r.total, r.roleLabel]),
    [
      ["m.servizio.base", 1, 4, "Responsabile del servizio clienti"],
      ["m.costi.base", 0, 2, "Controllo di gestione"],
      ["m.sistemi.base", 0, 1, "Referente dei sistemi"],
    ],
  );

  const rows = overviewBlockers(data.blockers);
  assert.ok(rows.some((b) => b.key === "accesso_sistema" && b.items >= 1));
  assert.equal(rows[0].key, "a8", "the privacy sheet first, even without questions");
  assert.equal(rows[0].line, "Manca la firma di Lateral Space.");
  assert.equal(rows.some((b) => b.key === "sanitario"), false);

  assert.deepEqual(
    data.milestones.map((m) => [m.key, m.done]),
    [
      ["m1", true],
      ["m2", false],
      ["m3", false],
    ],
  );
  assert.equal(data.inBreve, "Instrada ogni richiesta alla persona giusta.");
  assert.deepEqual(data.phases, [{ fase: "Preparazione", quando: "ottobre", cosa: "Raccolta dei dati" }, { fase: "Sviluppo" }]);
  assert.equal(data.blocker, null);
  assert.deepEqual(data.files, []);
});

test("overview panel: a blocker with its first questions by title and the evidence files, still one round-trip; never across workspaces", opts, async () => {
  const blockerId = state.blockers.get("accesso_sistema")!;
  const c = counting();
  const data = await loadOverview(c.executor, { workspaceId: ids.ws, caseId: state.caseId, now: NOW, blockerId, blockerQuestions: 1, withFiles: true });
  assert.equal(c.trips(), 1);
  assert.ok(data?.blocker);
  assert.equal(data.blocker.key, "accesso_sistema");
  assert.equal(data.blocker.questions.length, 1, "the panel shows only the first questions");
  assert.ok(data.blocker.items >= 1);
  assert.deepEqual(
    data.files.map((f) => f.id),
    [ids.file],
  );
  // Un blocco di un altro caso (stesso workspace o un altro) o un id qualsiasi: nessun pannello, nemmeno le sue domande.
  const sameWsBlocker = other.contractBlockers.get("accesso_sistema")!;
  assert.ok(sameWsBlocker && sameWsBlocker !== blockerId);
  // Il blocco dell'altro caso ferma una sua domanda fuori dal via: il via di quel caso resta pronto.
  await q(`INSERT INTO uc_item_blockers (item_id, blocker_id, origin) VALUES ($1::uuid, $2::uuid, 'manuale') ON CONFLICT DO NOTHING`, [other.contractItems.get("q.costi.03"), sameWsBlocker]);
  for (const foreign of [sameWsBlocker, other.otherWsBlocker, randomUUID()]) {
    const view = await loadOverview(exec!, { workspaceId: ids.ws, caseId: state.caseId, now: NOW, blockerId: foreign, blockerQuestions: 10 });
    assert.ok(view);
    assert.equal(view.blocker, null, `blocker ${foreign} is not of this case`);
    assert.equal(view.blockers.some((b) => b.id === foreign), false);
  }
  // Una domanda di un altro caso legata per errore a un blocco di questo caso: né nel pannello né nel conteggio.
  const own = await loadOverview(exec!, { workspaceId: ids.ws, caseId: state.caseId, now: NOW, blockerId, blockerQuestions: 50 });
  await q(`INSERT INTO uc_item_blockers (item_id, blocker_id, origin) VALUES ($1::uuid, $2::uuid, 'manuale') ON CONFLICT DO NOTHING`, [other.contractItems.get("q.costi.03"), blockerId]);
  const crossed = await loadOverview(exec!, { workspaceId: ids.ws, caseId: state.caseId, now: NOW, blockerId, blockerQuestions: 50 });
  assert.ok(own?.blocker && crossed?.blocker);
  assert.deepEqual(
    crossed.blocker.questions.map((x) => x.id),
    own.blocker.questions.map((x) => x.id),
  );
  assert.equal(crossed.blocker.questions.some((x) => x.id === other.contractItems.get("q.costi.03")), false);
  assert.equal(crossed.blocker.items, own.blocker.items);
  assert.equal(crossed.blockers.find((b) => b.id === blockerId)?.items, own.blockers.find((b) => b.id === blockerId)?.items);
  assert.equal(await loadOverview(exec!, { workspaceId: ids.otherWs, caseId: state.caseId, now: NOW }), null);
  assert.equal(await loadVia(exec!, { workspaceId: ids.otherWs, caseId: state.caseId, now: NOW }), null);
});

test("via: one round-trip with the live computation; proposed, signed by Lateral Space, approved by the client", opts, async () => {
  const c = counting();
  const first = await loadVia(c.executor, { workspaceId: ids.ws, caseId: state.caseId, now: NOW, withFiles: true });
  assert.equal(c.trips(), 1, "the via page reads in one round-trip");
  assert.ok(first);
  const live = await loadCaseReadiness(exec!, ids.ws, state.caseId, NOW);
  assert.deepEqual([first.g1.required, first.g1.ok, first.g1.ready, first.g1.summaryTextHash], [live!.g1.required, live!.g1.ok, live!.g1.ready, live!.g1.summaryTextHash]);
  assert.equal(first.inReview, 1);
  assert.deepEqual([first.reviews, first.pending, first.versions], [[], null, []]);
  assert.deepEqual(
    first.files.map((f) => f.id),
    [ids.file],
  );
  assert.equal(viaState({ status: first.core.status, statusBeforeSuspension: null, gateReconfirm: false, ready: first.g1.ready, pending: false, approved: false }), "non_ancora");
  assert.ok(viaConditions(first.g1.conditions, { required: first.g1.required, ok: first.g1.ok, waivers: first.g1.waivers, audience: "ls" }).open.some((x) => x.key === "voci_a_posto"));

  // Tutte le indispensabili a posto: il via si propone e Lateral Space firma con la proposta.
  const required = [...state.items].filter(([k]) => REQUIRED_KEYS.includes(k)).map(([, id]) => id);
  await signedNa(required);
  const proposed = await proposeGate(exec!, await ctxFor(ids.lead), { gate: "G1" });
  assert.ok(proposed.ok, proposed.ok ? "" : proposed.message);
  const pending = await loadVia(exec!, { workspaceId: ids.ws, caseId: state.caseId, now: NOW });
  assert.ok(pending?.pending);
  assert.equal(pending.pending.signatures.length, 1);
  assert.equal(pending.pending.signatures[0].ruolo, "ls_lead");
  const asLead = viaAction({
    roles: ["ls_lead"],
    signable: true,
    status: pending.core.status,
    statusBeforeSuspension: null,
    ready: pending.g1.ready,
    required: pending.g1.required,
    ok: pending.g1.ok,
    pending: pending.pending,
    evidenceMissing: false,
    reconfirm: false,
    canSendLink: false,
    approved: null,
    now: NOW,
  });
  assert.equal(asLead.kind, "manda_link");
  assert.equal(
    viaAction({
      roles: ["owner_cliente"],
      signable: true,
      status: pending.core.status,
      statusBeforeSuspension: null,
      ready: true,
      required: 7,
      ok: 7,
      pending: pending.pending,
      evidenceMissing: false,
      reconfirm: false,
      canSendLink: false,
      approved: null,
      now: NOW,
    }).kind,
    "firma_cliente",
  );

  // Il responsabile del cliente firma: via approvato, catalogo v1, caso pronto per lo sviluppo.
  const signed = await signGate(exec!, await ctxFor(ids.owner), { reviewId: pending.pending.id });
  assert.ok(signed.ok, signed.ok ? "" : signed.message);
  const done = await loadVia(exec!, { workspaceId: ids.ws, caseId: state.caseId, now: NOW });
  assert.ok(done);
  assert.equal(done.pending, null);
  assert.equal(done.core.status, "pronto_sviluppo");
  assert.equal(done.reviews[0].decision, "approvato");
  assert.deepEqual(
    done.reviews[0].signatures.map((s) => s.ruolo).sort(),
    ["ls_lead", "owner_cliente"],
  );
  assert.deepEqual(
    done.versions.map((v) => [v.version, v.reason]),
    [[1, "gate"]],
  );
  assert.equal(latestApproval(done.reviews)?.catalogVersion, 1);
  assert.equal(viaState({ status: done.core.status, statusBeforeSuspension: null, gateReconfirm: false, ready: done.g1.ready, pending: false, approved: true }), "approvato");

  // Chiuso dopo il via: lo stato resta «Approvato», le firme sono quelle dell'approvazione.
  await q(`UPDATE uc_cases SET status = 'chiuso' WHERE id = $1::uuid`, [state.caseId]);
  const closed = await loadVia(exec!, { workspaceId: ids.ws, caseId: state.caseId, now: NOW });
  assert.ok(closed);
  assert.equal(viaState({ status: closed.core.status, statusBeforeSuspension: null, gateReconfirm: false, ready: closed.g1.ready, pending: false, approved: latestApproval(closed.reviews) !== null }), "approvato");
  assert.deepEqual(
    viaShownSignatures(closed.pending, closed.reviews).map((s) => s.ruolo).sort(),
    ["ls_lead", "owner_cliente"],
  );
  await q(`UPDATE uc_cases SET status = 'pronto_sviluppo' WHERE id = $1::uuid`, [state.caseId]);
});

test("via on a contract case: a withdrawn proposal reads as withdrawn; two signatures without the written evidence, then the evidence closes the via", opts, async () => {
  const caseId = other.contractCaseId;
  const lead = await ctxFor(ids.lead, caseId);
  const owner = await ctxFor(ids.owner, caseId);
  const required = [...other.contractItems].filter(([k]) => REQUIRED_KEYS.includes(k)).map(([, id]) => id);
  await signedNa(required);
  const actionFor = (roles: ("ls_lead" | "owner_cliente" | "ls_analista")[], v: NonNullable<Awaited<ReturnType<typeof loadVia>>>): ViaAction =>
    viaAction({
      roles,
      signable: true,
      status: v.core.status,
      statusBeforeSuspension: null,
      ready: v.g1.ready,
      required: v.g1.required,
      ok: v.g1.ok,
      pending: v.pending,
      evidenceMissing: v.core.contractRefs.length > 0 && v.pending !== null && !v.pending.writtenEvidence,
      reconfirm: false,
      canSendLink: false,
      approved: latestApproval(v.reviews),
      now: NOW,
    });

  // Lateral Space propone e ritira: nello storico si legge «ritirata», non un rifiuto del cliente.
  const first = await proposeGate(exec!, lead, { gate: "G1" });
  assert.ok(first.ok, first.ok ? "" : first.message);
  const withdrawn = await rejectGate(exec!, lead, { reviewId: first.value.reviewId, reason: "Riproponiamo con il verbale." });
  assert.ok(withdrawn.ok, withdrawn.ok ? "" : withdrawn.message);
  const afterWithdraw = await loadVia(exec!, { workspaceId: ids.ws, caseId, now: NOW });
  assert.ok(afterWithdraw);
  assert.equal(afterWithdraw.pending, null);
  assert.equal(afterWithdraw.reviews[0].rejectedBy, "ls_lead");
  assert.equal(reviewHistoryRow(afterWithdraw.reviews[0], NOW).title, "Via allo sviluppo · Proposta ritirata da Lateral Space");

  // Nuova proposta senza prova: mentre si aspetta il cliente, Lateral Space può già allegarla.
  const proposed = await proposeGate(exec!, lead, { gate: "G1" });
  assert.ok(proposed.ok, proposed.ok ? "" : proposed.message);
  const waiting = await loadVia(exec!, { workspaceId: ids.ws, caseId, now: NOW, withFiles: true });
  assert.ok(waiting?.pending);
  assert.equal(waiting.pending.writtenEvidence, false);
  assert.ok(waiting.files.some((f) => f.id === ids.contractFile));
  const leadWaiting = actionFor(["ls_lead"], waiting);
  assert.equal(leadWaiting.kind, "manda_link");
  assert.equal(leadWaiting.kind === "manda_link" && leadWaiting.attachEvidence, true);

  // Il cliente firma senza prova (come dal link): le due firme ci sono, il via aspetta la prova scritta.
  const ownerSign = await signGate(exec!, owner, { reviewId: proposed.value.reviewId });
  assert.ok(ownerSign.ok, ownerSign.ok ? "" : ownerSign.message);
  assert.equal(ownerSign.value.complete, false);
  assert.equal(ownerSign.value.waitingFor, "prova_scritta");
  const stuck = await loadVia(exec!, { workspaceId: ids.ws, caseId, now: NOW, withFiles: true });
  assert.ok(stuck?.pending);
  assert.deepEqual(stuck.pending.signatures.map((s) => s.ruolo).sort(), ["ls_lead", "owner_cliente"]);
  assert.equal(actionFor(["ls_lead"], stuck).kind, "allega_prova");
  assert.equal(actionFor(["owner_cliente"], stuck).kind, "allega_prova");
  assert.equal(actionFor(["ls_analista"], stuck).kind, "nessuna");

  // Chi ha già firmato allega solo la prova: il via si chiude, catalogo v1.
  const attached = await signGate(exec!, lead, { reviewId: proposed.value.reviewId, evidenceFileId: ids.contractFile });
  assert.ok(attached.ok, attached.ok ? "" : attached.message);
  assert.equal(attached.value.complete, true);
  const done = await loadVia(exec!, { workspaceId: ids.ws, caseId, now: NOW });
  assert.ok(done);
  assert.equal(done.pending, null);
  assert.equal(done.core.status, "pronto_sviluppo");
  assert.equal(done.reviews[0].decision, "approvato");
  assert.equal(done.reviews[0].writtenEvidence, true);
  assert.equal(done.reviews[0].rejectedBy, null);
  assert.equal(latestApproval(done.reviews)?.catalogVersion, 1);
});
