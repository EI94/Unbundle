import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { createUcExecutor, type UcExecutor } from "../db/uc-executor.ts";
import { applyTemplateLoad } from "../db/queries/uc-templates.ts";
import { addCaseMember, commandContextFor, createCase, loadUserContext, type UcCommandContext } from "../db/queries/uc-cases.ts";
import { resolveBlocker } from "../db/queries/uc-gates.ts";
import { proposeFallback, proposeNa, rejectNa, signFallback, signNa } from "../db/queries/uc-items.ts";
import { APPROVAL_MESSAGES, decideCaseApproval, loadCaseApprovals } from "../db/queries/uc-approvals.ts";
import { planTemplateLoad } from "./template/load.ts";
import type { ApprovalStep } from "./views/approvals.ts";

// Opt-in integration suite: the text read on /firme (and on the approval link) and the
// signature are one step. The commands receive the hash of the text read
// (`expectedTextHash`) and compare it with the row they load and their write pins, so a
// proposal changed by Lateral Space between the reading and the signature is never
// signed (follow-up 5 of wave 2). The race is reproduced with an executor that changes
// the row right after the first read. On the isolated local harness only:
//   UC_TEST_DATABASE_URL=postgresql://uc_test@127.0.0.1:55449/unbundle_uc_test UC_TEST_ISOLATED=true \
//   NODE_OPTIONS=--require=./scripts/uc-test/local-neon.cjs node --no-warnings --test --test-concurrency=1 src/lib/uc/approvals-text.integration.test.ts
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
const ids = { org: randomUUID(), ws: randomUUID(), lead: randomUUID(), owner: randomUUID(), privacy: randomUUID(), file: randomUUID() };
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

function body(a: ApprovalStep): Record<string, unknown> {
  return { kind: a.kind, target_id: a.targetId, decision: "approvo", read: true, text_hash: a.textHash };
}

/** An executor that runs `change` once, right after its first batch: Lateral Space acting between the reading and the signature. */
function racing(change: () => Promise<void>): UcExecutor {
  let pending = true;
  return {
    async batch(statements) {
      const rows = await exec!.batch(statements);
      if (pending) {
        pending = false;
        await change();
      }
      return rows;
    },
  };
}

const codeOf = (r: { ok: true } | { ok: false; code: string }) => (r.ok ? null : r.code);

before(async () => {
  if (!sql) return;
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Org prova testo firmato', $2)`, [ids.org, `uc-testo-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $2::uuid, 'Prova testo firmato')`, [ids.ws, ids.org]);
  await q(
    `INSERT INTO users (id, email, email_verified, name) VALUES
       ($1::uuid, $4, now(), 'Lead di prova'), ($2::uuid, $5, now(), 'Owner di prova'), ($3::uuid, $6, now(), 'Privacy di prova')`,
    [ids.lead, ids.owner, ids.privacy, `testo-lead-${suffix}@ls.test`, `testo-owner-${suffix}@cliente.test`, `testo-privacy-${suffix}@cliente.test`],
  );
  await q(
    `INSERT INTO memberships (user_id, organization_id, role) VALUES ($1::uuid, $4::uuid, 'transformation_lead'), ($2::uuid, $4::uuid, 'contributor'), ($3::uuid, $4::uuid, 'contributor')`,
    [ids.lead, ids.owner, ids.privacy, ids.org],
  );
  const value = JSON.parse(exampleText) as Record<string, unknown>;
  value.key = `prova.testo_${suffix}`;
  const plan = planTemplateLoad(JSON.stringify(value), { restrictToWorkspaceId: ids.ws });
  assert.ok(plan.ok);
  const loaded = await applyTemplateLoad(exec!, plan.plan, { actorUserId: ids.lead, publish: true });
  assert.ok(loaded.ok, loaded.ok ? "" : loaded.message);
  const leadUser = await loadUserContext(exec!, ids.lead, LS_DOMAINS);
  const created = await createCase(exec!, { workspaceId: ids.ws, user: leadUser!, canReviewWorkspacePortfolio: true, input: { templateId: loaded.value.templateId, code: `TESTO-${suffix}`.toUpperCase(), title: "Caso del testo firmato" } });
  assert.ok(created.ok, created.ok ? "" : created.message);
  state.caseId = created.value.caseId;
  for (const r of await q(`SELECT id, key FROM uc_items WHERE case_id = $1::uuid`, [state.caseId])) state.items.set(String(r.key), String(r.id));
  const lead = await ctxFor(ids.lead);
  for (const [userId, role] of [
    [ids.owner, "owner_cliente"],
    [ids.privacy, "approvatore_privacy"],
  ] as const) {
    const r = await addCaseMember(exec!, lead, { userId, role });
    assert.ok(r.ok, r.ok ? "" : r.message);
  }
  await q(
    `INSERT INTO uc_files (id, workspace_id, case_id, file_name, mime, size_bytes, sha256, privacy_class, max_size_bytes, scan_status, content_scanned)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'scheda-privacy.pdf', 'application/pdf', 100, $4, 'riservato_azienda', 1000, 'pulito', true)`,
    [ids.file, ids.ws, state.caseId, "e".repeat(64)],
  );
});

after(async () => {
  if (!sql) return;
  await q(`DELETE FROM workspaces WHERE id = $1::uuid`, [ids.ws]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id IN ($1::uuid, $2::uuid, $3::uuid)`, [ids.lead, ids.owner, ids.privacy]);
});

test("«non si applica»: a proposal rewritten after the reading is not signed; the text read still is", opts, async () => {
  const lead = await ctxFor(ids.lead);
  const owner = await ctxFor(ids.owner);
  const itemId = item("q.servizio.03");
  assert.ok((await proposeNa(exec!, lead, { itemId, reason: "Il servizio non usa questo dato" })).ok);
  const read = (await pendingFor(owner)).find((a) => a.kind === "na" && a.targetId === itemId);
  assert.ok(read);

  // Lateral Space rewrites the proposal between the check of /firme and the command.
  const rewrite = () => q(`UPDATE uc_items SET na_reason = 'Un altro motivo, scritto dopo', na_proposed_at = now() + interval '1 second' WHERE id = $1::uuid`, [itemId]).then(() => {});
  const raced = await decideCaseApproval(racing(rewrite), owner, body(read));
  assert.equal(codeOf(raced), "testo_cambiato");
  assert.equal(raced.ok ? "" : raced.message, APPROVAL_MESSAGES.testo_cambiato, "the /firme wording");
  assert.equal((await one(`SELECT na_client_approved_by_user_id FROM uc_items WHERE id = $1::uuid`, [itemId])).na_client_approved_by_user_id, null, "no signature on the new text");

  // The command alone refuses the stale hash too (the link path passes it the same way).
  assert.equal(codeOf(await signNa(exec!, owner, { itemId, expectedTextHash: read.textHash })), "testo_cambiato");
  const reread = (await pendingFor(owner)).find((a) => a.kind === "na" && a.targetId === itemId);
  assert.ok(reread && reread.textHash !== read.textHash);
  const signed = await decideCaseApproval(exec!, owner, body(reread));
  assert.ok(signed.ok && !signed.value.complete, signed.ok ? "" : signed.message);
  assert.equal(String((await one(`SELECT na_client_approved_by_user_id FROM uc_items WHERE id = $1::uuid`, [itemId])).na_client_approved_by_user_id), ids.owner);
});

test("«Non approvo» on a «non si applica» rewritten after the reading does not reject the new text", opts, async () => {
  const lead = await ctxFor(ids.lead);
  const owner = await ctxFor(ids.owner);
  const itemId = item("q.servizio.04");
  assert.ok((await proposeNa(exec!, lead, { itemId, reason: "Per ora non serve questa informazione" })).ok);
  const read = (await pendingFor(owner)).find((a) => a.kind === "na" && a.targetId === itemId);
  assert.ok(read && read.canReject);
  const rewrite = () => q(`UPDATE uc_items SET na_reason = 'Un motivo diverso, scritto dopo', na_proposed_at = now() + interval '1 second' WHERE id = $1::uuid`, [itemId]).then(() => {});
  const raced = await decideCaseApproval(racing(rewrite), owner, { ...body(read), decision: "non_approvo", reason: "Per noi questo dato serve" });
  assert.equal(codeOf(raced), "testo_cambiato");
  assert.equal((await one(`SELECT na_reason FROM uc_items WHERE id = $1::uuid`, [itemId])).na_reason, "Un motivo diverso, scritto dopo", "the new proposal stays");
  assert.equal(codeOf(await rejectNa(exec!, owner, { itemId, reason: "Per noi questo dato serve", expectedTextHash: read.textHash })), "testo_cambiato");
});

test("provisional solution: a description proposed again after the reading is not signed", opts, async () => {
  const lead = await ctxFor(ids.lead);
  const owner = await ctxFor(ids.owner);
  const itemId = item("src.crm.api_richieste");
  assert.ok((await proposeFallback(exec!, lead, { itemId, descrizione: "Export CSV autorizzato dal cliente", daSostituireEntro: "2027-06-30" })).ok);
  const read = (await pendingFor(owner)).find((a) => a.kind === "ripiego" && a.targetId === itemId);
  assert.ok(read);

  const again = async () => {
    const r = await proposeFallback(exec!, lead, { itemId, descrizione: "Export CSV settimanale, senza autorizzazione", daSostituireEntro: "2027-09-30" });
    assert.ok(r.ok, r.ok ? "" : r.message);
  };
  assert.equal(codeOf(await decideCaseApproval(racing(again), owner, body(read))), "testo_cambiato");
  const row = (await one(`SELECT fallback FROM uc_items WHERE id = $1::uuid`, [itemId])).fallback as { descrizione: string; approvazioni: unknown[] };
  assert.deepEqual([row.descrizione, row.approvazioni.length], ["Export CSV settimanale, senza autorizzazione", 0], "the new text, unsigned");
  assert.equal(codeOf(await signFallback(exec!, owner, { itemId, expectedTextHash: read.textHash })), "testo_cambiato");

  const reread = (await pendingFor(owner)).find((a) => a.kind === "ripiego" && a.targetId === itemId);
  assert.ok(reread && reread.textHash !== read.textHash);
  assert.ok((await decideCaseApproval(exec!, owner, body(reread))).ok);
});

test("privacy sheet: new evidence registered after the reading is not signed by the privacy approver", opts, async () => {
  const lead = await ctxFor(ids.lead);
  const privacy = await ctxFor(ids.privacy);
  const a8 = String((await one(`SELECT id FROM uc_blockers WHERE case_id = $1::uuid AND key = 'a8'`, [state.caseId])).id);
  const evidence = (version: string) => ({
    documento: "Scheda privacy di prova",
    versione: version,
    data: "2026-10-01",
    approvatori_per_ruolo: ["approvatore_privacy"],
    file_id: ids.file,
    titolo_art_15_2: true,
    regione_dati_verificata: true,
    accesso_zona_personale: [ids.lead],
  });
  const first = await resolveBlocker(exec!, lead, { blockerId: a8, evidence: evidence("1.0") });
  assert.ok(first.ok && !first.value.complete, first.ok ? "" : first.message);
  const read = (await pendingFor(privacy)).find((a) => a.kind === "a8");
  assert.ok(read);

  const newEvidence = async () => {
    const r = await resolveBlocker(exec!, lead, { blockerId: a8, evidence: evidence("2.0") });
    assert.ok(r.ok, r.ok ? "" : r.message);
  };
  assert.equal(codeOf(await decideCaseApproval(racing(newEvidence), privacy, body(read))), "testo_cambiato");
  assert.equal((await one(`SELECT status FROM uc_blockers WHERE id = $1::uuid`, [a8])).status, "attivo", "not resolved on evidence nobody on the client side read");
  assert.equal(codeOf(await resolveBlocker(exec!, privacy, { blockerId: a8, expectedTextHash: read.textHash })), "testo_cambiato");

  const reread = (await pendingFor(privacy)).find((a) => a.kind === "a8");
  assert.ok(reread && reread.textHash !== read.textHash);
  const signed = await decideCaseApproval(exec!, privacy, body(reread));
  assert.ok(signed.ok && signed.value.complete, signed.ok ? "" : signed.message);
  assert.equal((await one(`SELECT status FROM uc_blockers WHERE id = $1::uuid`, [a8])).status, "sciolto");
});
