import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { createUcExecutor, type UcExecutor } from "../db/uc-executor.ts";
import { applyTemplateLoad } from "../db/queries/uc-templates.ts";
import { addCaseMember, commandContextFor, createCase, loadCaseReadiness, loadUserContext, proposePersonalZoneAccess, type UcCommandContext } from "../db/queries/uc-cases.ts";
import { proposeGate, resolveBlocker } from "../db/queries/uc-gates.ts";
import { proposeFallback, proposeNa } from "../db/queries/uc-items.ts";
import { decideCaseApproval, loadCaseApprovals } from "../db/queries/uc-approvals.ts";
import { loadPendingSignatures } from "../db/queries/uc-signatures.ts";
import { planTemplateLoad } from "./template/load.ts";
import { findForbiddenIn } from "./views/copy-guard.ts";
import type { ApprovalStep } from "./views/approvals.ts";
import type { CaseRole } from "./vocab.ts";

// Opt-in integration suite for the signatures of the dossier (DESIGN §3.11, §4.5,
// WP9): /firme reads the pending decisions with the texts and hashes of the
// approval link and signs them with the commands of today, from an account. On the
// isolated local harness only, with the same guard as the other uc suites:
//   UC_TEST_DATABASE_URL=postgresql://uc_test@127.0.0.1:55449/unbundle_uc_test UC_TEST_ISOLATED=true \
//   NODE_OPTIONS=--require=./scripts/uc-test/local-neon.cjs node --no-warnings --test --test-concurrency=1 src/lib/uc/approvals.integration.test.ts
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
  otherWs: randomUUID(),
  lead: randomUUID(),
  analyst: randomUUID(),
  owner: randomUUID(),
  privacy: randomUUID(),
  lsOwner: randomUUID(),
  file: randomUUID(),
};
const exampleText = readFileSync(new URL("../../../templates/uc/esempio.minimo/1.0.0.json", import.meta.url), "utf8");
const state: { caseId: string; items: Map<string, string> } = { caseId: "", items: new Map() };
const item = (key: string) => state.items.get(key)!;

async function ctxFor(userId: string): Promise<UcCommandContext> {
  const r = await commandContextFor(exec!, { workspaceId: ids.ws, caseId: state.caseId, userId, lsDomains: LS_DOMAINS });
  assert.ok(r.ok, r.ok ? "" : r.message);
  return r.value;
}

async function pendingFor(ctx: UcCommandContext): Promise<ApprovalStep[]> {
  const loaded = await loadCaseApprovals(exec!, { workspaceId: ctx.workspaceId, caseId: ctx.caseId, roles: ctx.actor.type === "utente" ? ctx.actor.roles : [] });
  assert.ok(loaded, "case found");
  return loaded.approvals;
}

/** The body the page sends: the same as the approval link (`approvalBody`). */
function body(a: ApprovalStep, decision: "approvo" | "non_approvo", extra: Record<string, unknown> = {}) {
  return { kind: a.kind, target_id: a.targetId, decision, read: true, text_hash: a.textHash, ...extra };
}

const codeOf = (r: { ok: boolean } & ({ ok: true } | { ok: false; code: string })) => (r.ok ? null : r.code);

before(async () => {
  if (!sql) return;
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Org prova firme', $2)`, [ids.org, `uc-firme-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $3::uuid, 'Prova firme'), ($2::uuid, $3::uuid, 'Altro firme')`, [ids.ws, ids.otherWs, ids.org]);
  await q(
    `INSERT INTO users (id, email, email_verified, name) VALUES
       ($1::uuid, $6, now(), 'Lead di prova'), ($2::uuid, $7, now(), 'Analista di prova'), ($3::uuid, $8, now(), 'Owner di prova'),
       ($4::uuid, $9, now(), 'Privacy di prova'), ($5::uuid, $10, now(), 'Lateral Space come cliente')`,
    [
      ids.lead,
      ids.analyst,
      ids.owner,
      ids.privacy,
      ids.lsOwner,
      `firme-lead-${suffix}@ls.test`,
      `firme-analista-${suffix}@ls.test`,
      `firme-owner-${suffix}@cliente.test`,
      `firme-privacy-${suffix}@cliente.test`,
      `firme-ls-owner-${suffix}@ls.test`,
    ],
  );
  await q(
    `INSERT INTO memberships (user_id, organization_id, role) VALUES ($1::uuid, $6::uuid, 'transformation_lead'), ($2::uuid, $6::uuid, 'analyst'),
       ($3::uuid, $6::uuid, 'contributor'), ($4::uuid, $6::uuid, 'contributor'), ($5::uuid, $6::uuid, 'contributor')`,
    [ids.lead, ids.analyst, ids.owner, ids.privacy, ids.lsOwner, ids.org],
  );
  const value = JSON.parse(exampleText) as Record<string, unknown>;
  value.key = `prova.firme_${suffix}`;
  const plan = planTemplateLoad(JSON.stringify(value), { restrictToWorkspaceId: ids.ws });
  assert.ok(plan.ok);
  const loaded = await applyTemplateLoad(exec!, plan.plan, { actorUserId: ids.lead, publish: true });
  assert.ok(loaded.ok, loaded.ok ? "" : loaded.message);
  const leadUser = await loadUserContext(exec!, ids.lead, LS_DOMAINS);
  const created = await createCase(exec!, { workspaceId: ids.ws, user: leadUser!, canReviewWorkspacePortfolio: true, input: { templateId: loaded.value.templateId, code: `FIRME-${suffix}`.toUpperCase(), title: "Caso delle firme" } });
  assert.ok(created.ok, created.ok ? "" : created.message);
  state.caseId = created.value.caseId;
  for (const r of await q(`SELECT id, key FROM uc_items WHERE case_id = $1::uuid`, [state.caseId])) state.items.set(String(r.key), String(r.id));
  const lead = await ctxFor(ids.lead);
  for (const [userId, role] of [
    [ids.analyst, "ls_analista"],
    [ids.owner, "owner_cliente"],
    [ids.privacy, "approvatore_privacy"],
  ] as const) {
    const r = await addCaseMember(exec!, lead, { userId, role });
    assert.ok(r.ok, r.ok ? "" : r.message);
  }
  // A Lateral Space address with the client's role: the command refuses to add it, so it is written directly.
  await q(`INSERT INTO uc_case_members (case_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'owner_cliente')`, [state.caseId, ids.lsOwner]);
  await q(
    `INSERT INTO uc_files (id, workspace_id, case_id, file_name, mime, size_bytes, sha256, privacy_class, max_size_bytes, scan_status, content_scanned)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'scheda-privacy.pdf', 'application/pdf', 100, $4, 'riservato_azienda', 1000, 'pulito', true)`,
    [ids.file, ids.ws, state.caseId, "d".repeat(64)],
  );
});

after(async () => {
  if (!sql) return;
  await q(`DELETE FROM workspaces WHERE id IN ($1::uuid, $2::uuid)`, [ids.ws, ids.otherWs]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id IN ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid)`, [ids.lead, ids.analyst, ids.owner, ids.privacy, ids.lsOwner]);
});

test("«non si applica»: the client signs on /firme only the text read, then Lateral Space completes it; the header counts the same list", opts, async () => {
  const lead = await ctxFor(ids.lead);
  const owner = await ctxFor(ids.owner);
  const proposed = await proposeNa(exec!, lead, { itemId: item("q.servizio.03"), reason: "Il servizio non usa questo dato" });
  assert.ok(proposed.ok, proposed.ok ? "" : proposed.message);

  const forOwner = await pendingFor(owner);
  const na = forOwner.find((a) => a.kind === "na" && a.targetId === item("q.servizio.03"));
  assert.ok(na, "pending for the client");
  assert.equal(na.title, "Una domanda che non vale per voi");
  assert.equal(na.side, "cliente");
  assert.deepEqual(findForbiddenIn([na.title, na.summary, ...na.lines, ...na.details], "cliente"), [], "titles, never keys");
  // The header and the menu count exactly the /firme list.
  assert.equal((await loadPendingSignatures(exec!, { workspaceId: ids.ws, caseId: state.caseId, roles: owner.actor.type === "utente" ? owner.actor.roles : [] })).length, forOwner.length);

  const unread = await decideCaseApproval(exec!, owner, { kind: "na", target_id: na.targetId, decision: "approvo", text_hash: na.textHash });
  assert.equal(codeOf(unread), "non_letto");
  const changed = await decideCaseApproval(exec!, owner, body({ ...na, textHash: "0".repeat(64) }, "approvo"));
  assert.equal(codeOf(changed), "testo_cambiato");
  const extra = await decideCaseApproval(exec!, owner, body(na, "approvo", { extra: 1 }));
  assert.equal(codeOf(extra), "dati_non_validi", "the same strict body as the link");
  const signed = await decideCaseApproval(exec!, owner, body(na, "approvo"));
  assert.ok(signed.ok, signed.ok ? "" : signed.message);
  assert.deepEqual([signed.value.side, signed.value.complete], ["cliente", false]);
  assert.equal(String((await one(`SELECT na_client_approved_by_user_id FROM uc_items WHERE id = $1::uuid`, [item("q.servizio.03")])).na_client_approved_by_user_id), ids.owner);
  const again = await decideCaseApproval(exec!, owner, body(na, "approvo"));
  assert.equal(codeOf(again), "approvazione_non_trovata", "no longer waiting for the client");

  const forLead = (await pendingFor(lead)).find((a) => a.kind === "na" && a.targetId === item("q.servizio.03"));
  assert.ok(forLead);
  assert.deepEqual([forLead.side, forLead.otherSideSigned, forLead.title], ["ls", true, "Una domanda che non si applica"]);
  assert.equal(forLead.textHash, na.textHash, "same text, same hash for both sides");
  const done = await decideCaseApproval(exec!, lead, body(forLead, "approvo"));
  assert.ok(done.ok && done.value.complete, done.ok ? "" : done.message);
  assert.equal((await one(`SELECT status FROM uc_items WHERE id = $1::uuid`, [item("q.servizio.03")])).status, "non_applicabile");
});

test("«Non approvo» with a reason where a command rejects (NA); a provisional solution is not rejected, only signed", opts, async () => {
  const lead = await ctxFor(ids.lead);
  const owner = await ctxFor(ids.owner);
  assert.ok((await proposeNa(exec!, lead, { itemId: item("q.servizio.04"), reason: "Per ora non serve questa informazione" })).ok);
  const na = (await pendingFor(owner)).find((a) => a.kind === "na" && a.targetId === item("q.servizio.04"));
  assert.ok(na && na.canReject);
  assert.equal(codeOf(await decideCaseApproval(exec!, owner, body(na, "non_approvo", { reason: "No" }))), "motivo_mancante");
  const rejected = await decideCaseApproval(exec!, owner, body(na, "non_approvo", { reason: "Per noi questo dato serve" }));
  assert.ok(rejected.ok && rejected.value.complete, rejected.ok ? "" : rejected.message);
  assert.equal((await one(`SELECT na_proposed_at FROM uc_items WHERE id = $1::uuid`, [item("q.servizio.04")])).na_proposed_at, null, "the proposal is gone");

  const fallback = await proposeFallback(exec!, lead, { itemId: item("src.crm.api_richieste"), descrizione: "Export CSV autorizzato dal cliente", daSostituireEntro: "2027-06-30" });
  assert.ok(fallback.ok, fallback.ok ? "" : fallback.message);
  const rip = (await pendingFor(owner)).find((a) => a.kind === "ripiego");
  assert.ok(rip && !rip.canReject);
  assert.equal(rip.title, "Una soluzione provvisoria");
  assert.equal(codeOf(await decideCaseApproval(exec!, owner, body(rip, "non_approvo", { reason: "Non ci piace" }))), "rifiuto_non_disponibile");
  const signed = await decideCaseApproval(exec!, owner, body(rip, "approvo"));
  assert.ok(signed.ok, signed.ok ? "" : signed.message);
  const approvals = (await one(`SELECT fallback FROM uc_items WHERE id = $1::uuid`, [item("src.crm.api_richieste")])).fallback as { approvazioni: { ruolo: string; metodo: string; user_id?: string }[] };
  assert.ok(approvals.approvazioni.some((a) => a.ruolo === "owner_cliente" && a.metodo === "account" && a.user_id === ids.owner), "account signature of the client");
});

test("privacy approver: the privacy sheet and a personal-data access, only for that role", opts, async () => {
  const lead = await ctxFor(ids.lead);
  const privacy = await ctxFor(ids.privacy);
  const owner = await ctxFor(ids.owner);
  const a8 = await one(`SELECT id FROM uc_blockers WHERE case_id = $1::uuid AND key = 'a8'`, [state.caseId]);
  const evidence = {
    documento: "Scheda privacy di prova",
    versione: "1.0",
    data: "2026-10-01",
    approvatori_per_ruolo: ["approvatore_privacy"],
    file_id: ids.file,
    titolo_art_15_2: true,
    regione_dati_verificata: true,
    accesso_zona_personale: [ids.lead, ids.analyst],
  };
  const first = await resolveBlocker(exec!, lead, { blockerId: String(a8.id), evidence });
  assert.ok(first.ok && !first.value.complete, first.ok ? "" : first.message);
  assert.ok(!(await pendingFor(owner)).some((a) => a.kind === "a8"), "the client owner does not sign privacy");

  const sheet = (await pendingFor(privacy)).find((a) => a.kind === "a8");
  assert.ok(sheet);
  assert.equal(sheet.title, "Scheda privacy del caso");
  assert.deepEqual(findForbiddenIn([sheet.title, ...sheet.lines], "cliente"), [], "no «A.8», no articles");
  assert.ok(sheet.lines.some((l) => l.startsWith("Potranno vederli: ") && l.includes("Lead di prova")));
  assert.equal(codeOf(await decideCaseApproval(exec!, privacy, body(sheet, "non_approvo", { reason: "Non ancora" }))), "rifiuto_non_disponibile");
  const signed = await decideCaseApproval(exec!, privacy, body(sheet, "approvo"));
  assert.ok(signed.ok && signed.value.complete, signed.ok ? "" : signed.message);
  assert.equal((await one(`SELECT status FROM uc_blockers WHERE id = $1::uuid`, [a8.id])).status, "sciolto");

  const proposed = await proposePersonalZoneAccess(exec!, lead, { userId: ids.analyst });
  assert.ok(proposed.ok, proposed.ok ? "" : proposed.message);
  const grant = (await pendingFor(privacy)).find((a) => a.kind === "zona_personale");
  assert.ok(grant);
  assert.ok(grant.lines[0].startsWith("Analista di prova di Lateral Space potrà vedere"));
  assert.equal(codeOf(await decideCaseApproval(exec!, lead, body(grant, "approvo"))), "ruolo_non_ammesso", "Lateral Space does not sign its own access");
  const zone = await decideCaseApproval(exec!, privacy, body(grant, "approvo"));
  assert.ok(zone.ok && zone.value.complete, zone.ok ? "" : zone.message);
  assert.equal((await one(`SELECT bool_or(personal_zone_access) AS a FROM uc_case_members WHERE case_id = $1::uuid AND user_id = $2::uuid`, [state.caseId, ids.analyst])).a, true);
});

test("a paused case signs nothing; another workspace sees nothing", opts, async () => {
  const lead = await ctxFor(ids.lead);
  const owner = await ctxFor(ids.owner);
  assert.ok((await proposeNa(exec!, lead, { itemId: item("q.costi.01"), reason: "Il costo non si misura per richiesta" })).ok);
  const na = (await pendingFor(owner)).find((a) => a.kind === "na" && a.targetId === item("q.costi.01"));
  assert.ok(na);
  const status = String((await one(`SELECT status FROM uc_cases WHERE id = $1::uuid`, [state.caseId])).status);
  await q(`UPDATE uc_cases SET status = 'sospeso', status_before_suspension = $2 WHERE id = $1::uuid`, [state.caseId, status]);
  try {
    assert.equal(codeOf(await decideCaseApproval(exec!, owner, body(na, "approvo"))), "caso_in_pausa");
  } finally {
    await q(`UPDATE uc_cases SET status = $2, status_before_suspension = NULL WHERE id = $1::uuid`, [state.caseId, status]);
  }
  const elsewhere = { ...owner, workspaceId: ids.otherWs };
  assert.equal(await loadCaseApprovals(exec!, { workspaceId: ids.otherWs, caseId: state.caseId, roles: ["owner_cliente"] }), null);
  assert.equal(codeOf(await decideCaseApproval(exec!, elsewhere, body(na, "approvo"))), "non_trovato");
  // The proposal stays for the next test of the via: it is signed and completed here.
  assert.ok((await decideCaseApproval(exec!, owner, body(na, "approvo"))).ok);
  const forLead = (await pendingFor(lead)).find((a) => a.kind === "na" && a.targetId === item("q.costi.01"));
  assert.ok(forLead && (await decideCaseApproval(exec!, lead, body(forLead, "approvo"))).ok);
});

test("via allo sviluppo signed by the client owner on /firme: catalog v1; a Lateral Space address never signs as the client", opts, async () => {
  const lead = await ctxFor(ids.lead);
  const owner = await ctxFor(ids.owner);
  // From «not ready» to ready through the commands, as in the product: Lateral Space proposes «non si applica»
  // for every indispensable question still missing, the lead signs for Lateral Space and the client's owner signs
  // with the /firme command. The validation of answers (four eyes) is acceptance step 5, not this test.
  const before = await loadCaseReadiness(exec!, ids.ws, state.caseId);
  assert.ok(before);
  assert.equal(before.g1.ready, false);
  assert.ok(before.g1.missing.length > 0);
  const analyst = await ctxFor(ids.analyst);
  for (const { itemId } of before.g1.missing) {
    const proposedNa = await proposeNa(exec!, analyst, { itemId, reason: "Non serve per avviare questo sviluppo" });
    assert.ok(proposedNa.ok, proposedNa.ok ? "" : proposedNa.message);
    const forLead = (await pendingFor(lead)).find((a) => a.kind === "na" && a.targetId === itemId);
    assert.ok(forLead, "pending for Lateral Space");
    const lsSigned = await decideCaseApproval(exec!, lead, body(forLead, "approvo"));
    assert.ok(lsSigned.ok && !lsSigned.value.complete, lsSigned.ok ? "" : lsSigned.message);
    const forOwner = (await pendingFor(owner)).find((a) => a.kind === "na" && a.targetId === itemId);
    assert.ok(forOwner, "pending for the client");
    const clientSigned = await decideCaseApproval(exec!, owner, body(forOwner, "approvo"));
    assert.ok(clientSigned.ok && clientSigned.value.complete, clientSigned.ok ? "" : clientSigned.message);
  }
  const notApplicable = await q(`SELECT count(*)::int AS n FROM uc_items WHERE id = ANY($1::uuid[]) AND status = 'non_applicabile'`, [before.g1.missing.map((m) => m.itemId)]);
  assert.equal(notApplicable[0].n, before.g1.missing.length);
  const ready = await loadCaseReadiness(exec!, ids.ws, state.caseId);
  assert.equal(ready?.g1.ready, true, JSON.stringify(ready?.g1.conditions.filter((c) => !c.ok)));
  // The via is proposed while the questions are being collected: the first send moves the case there, here it is written directly.
  await q(`UPDATE uc_cases SET status = 'raccolta', status_changed_at = now() WHERE id = $1::uuid AND status = 'bozza'`, [state.caseId]);

  const proposed = await proposeGate(exec!, lead, {});
  assert.ok(proposed.ok, proposed.ok ? "" : proposed.message);
  assert.ok(!(await pendingFor(lead)).some((a) => a.kind === "gate"), "the proposal carries Lateral Space's signature");
  const gate = (await pendingFor(owner)).find((a) => a.kind === "gate");
  assert.ok(gate);
  assert.equal(gate.textHash, proposed.value.summaryTextHash, "the client signs the canonical summary of the proposal");
  assert.deepEqual([gate.title, gate.otherSideSigned], ["Via allo sviluppo", true]);
  assert.match(gate.lines[0], /^\d+ domand[ae] indispensabil[ei] su \d+ (?:è|sono) a posto\.$/);
  assert.deepEqual(findForbiddenIn([gate.title, gate.summary, gate.intro ?? "", ...gate.lines, ...gate.details], "cliente"), [], "no G1, no hash, no rule name");

  // @ls.test does not sign as the client: its role does not count, and the command refuses it even when forced.
  const lsOwner = await ctxFor(ids.lsOwner);
  assert.equal(codeOf(await decideCaseApproval(exec!, lsOwner, body(gate, "approvo"))), "ruolo_non_ammesso");
  const forced: UcCommandContext = { ...lsOwner, actor: { type: "utente", userId: ids.lsOwner, roles: ["owner_cliente"] as CaseRole[] } };
  const refused = await decideCaseApproval(exec!, forced, body(gate, "approvo"));
  assert.equal(codeOf(refused), "ruolo_solo_cliente", "an address of Lateral Space never signs for the client");
  assert.equal((await one(`SELECT decision FROM uc_gate_reviews WHERE id = $1::uuid`, [proposed.value.reviewId])).decision, "proposto");

  const signed = await decideCaseApproval(exec!, owner, body(gate, "approvo"));
  assert.ok(signed.ok, signed.ok ? "" : signed.message);
  assert.deepEqual([signed.value.complete, signed.value.waitingForEvidence], [true, false]);
  const review = await one(`SELECT decision, catalog_version FROM uc_gate_reviews WHERE id = $1::uuid`, [proposed.value.reviewId]);
  assert.equal(review.decision, "approvato");
  assert.equal(review.catalog_version, 1);
  const caseRow = await one(`SELECT status, catalog_version FROM uc_cases WHERE id = $1::uuid`, [state.caseId]);
  assert.deepEqual([caseRow.status, caseRow.catalog_version], ["pronto_sviluppo", 1]);
  assert.ok(!(await pendingFor(owner)).some((a) => a.kind === "gate"));
});
