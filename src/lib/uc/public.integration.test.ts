import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { neon } from "@neondatabase/serverless";
import { createUcExecutor, type UcExecutor } from "../db/uc-executor.ts";
import { applyTemplateLoad } from "../db/queries/uc-templates.ts";
import { addCaseMember, commandContextFor, createCase, loadUserContext, proposePersonalZoneAccess, setCaseSigner, transitionCase, type UcCommandContext } from "../db/queries/uc-cases.ts";
import {
  approveDelegation,
  assignItems,
  copyRequestLink,
  createContact,
  issueRequestToken,
  requestApproval,
  revokeIssuedToken,
  revokeRequest,
  sendRequests,
} from "../db/queries/uc-requests.ts";
import { proposeFallback, proposeNa, signNa } from "../db/queries/uc-items.ts";
import { resolveBlocker } from "../db/queries/uc-gates.ts";
import {
  acknowledgePrivacy,
  decideApproval,
  delegateItems,
  hitRateLimits,
  loadReferentPage,
  loadReferentView,
  markLinkOpened,
  resolveRequestToken,
  saveReferentDraft,
  submitReferentAnswer,
  submitReferentAnswers,
  tableFromReferentFile,
  type PublicOptions,
  type ResolvedLink,
} from "../db/queries/uc-public.ts";
import { answerContext, normalizeAnswer } from "./answers/normalize.ts";
import { deriveWorkspaceKek, envelopeAad, openJson } from "./crypto.ts";
import { tokenRateLimitRule } from "./http.ts";
import { MAX_BATCH_ANSWERS, REFERENT_PRIVACY_NOTICE, greetingNameFrom, type ReferentItemView, type ReferentView } from "./public-view.ts";
import { planTemplateLoad } from "./template/load.ts";
import { newRequestToken } from "./tokens.ts";
import { batchEntry, chunkBatch, gridFromRows, initialForm, isReadyToSend } from "./views/referente-form.ts";

// Opt-in integration suite for the public token API (PIANO §5.4, §5.5), on the isolated local harness only:
//   UC_TEST_DATABASE_URL=postgresql://uc_test@127.0.0.1:55449/unbundle_uc_test UC_TEST_ISOLATED=true \
//   NODE_OPTIONS=--require=./scripts/uc-test/local-neon.cjs node --no-warnings --test --test-concurrency=1 src/lib/uc/public.integration.test.ts
// Never in parallel with database.integration.test.ts (it narrows a vocabulary CHECK on purpose).
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
const num = (v: unknown) => Number(v);

const LS_DOMAINS = ["ls.test"];
const IP_HASH = "a".repeat(32);
const ZONE_KEY = randomBytes(32).toString("base64");
// Files go to a temporary local folder (UC_LOCAL_STORAGE_DIR), never to a real store. Invented content only.
const storeDir = mkdtempSync(join(tmpdir(), "uc-public-it-"));
const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), ws: randomUUID(), lead: randomUUID(), analyst: randomUUID(), owner: randomUUID(), file: randomUUID() };
const exampleText = readFileSync(new URL("../../../templates/uc/esempio.minimo/1.0.0.json", import.meta.url), "utf8");
const state = {
  caseId: "",
  items: new Map<string, string>(),
  contactService: "",
  contactSystems: "",
  contactOwner: "",
  contactPrivacy: "",
  requestService: "",
  requestSystems: "",
  tokenService: "",
  tokenSystems: "",
};

function popts(over: Partial<PublicOptions> = {}): PublicOptions {
  return { lsDomains: LS_DOMAINS, ipHash: IP_HASH, userAgent: "Mozilla/5.0 (iPhone) prova", device: "mobile", emailConfigured: false, personalZoneKey: null, ...over };
}

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

async function link(token: string): Promise<ResolvedLink> {
  const l = await resolveRequestToken(exec!, token);
  assert.ok(l, "link valid");
  return l;
}

async function viewOf(token: string): Promise<ReferentView> {
  return loadReferentView(exec!, await link(token), popts());
}

function itemView(view: ReferentView, key: string): ReferentItemView {
  const found = view.modules.flatMap((m) => m.items).find((i) => i.key === key);
  assert.ok(found, `view item ${key}`);
  return found;
}

const statusOf = async (key: string) => String((await one(`SELECT status FROM uc_items WHERE id = $1::uuid`, [item(key)])).status);

function tokenFromPath(path: string): string {
  const m = /^\/r\/(ucr_[A-Za-z0-9_-]{32})$/.exec(path);
  assert.ok(m, "link path");
  return m[1];
}

before(async () => {
  if (!sql) return;
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Org prova link', $2)`, [ids.org, `uc-pub-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $2::uuid, 'Cliente di prova')`, [ids.ws, ids.org]);
  await q(`INSERT INTO users (id, email, email_verified, name) VALUES ($1::uuid, $4, now(), 'Persona LS'), ($2::uuid, $5, now(), 'Analista LS'), ($3::uuid, $6, now(), 'Owner')`, [
    ids.lead,
    ids.analyst,
    ids.owner,
    `pub-lead-${suffix}@ls.test`,
    `pub-analista-${suffix}@ls.test`,
    `pub-owner-${suffix}@cliente.test`,
  ]);
  await q(
    `INSERT INTO memberships (user_id, organization_id, role) VALUES ($1::uuid, $4::uuid, 'transformation_lead'), ($2::uuid, $4::uuid, 'analyst'), ($3::uuid, $4::uuid, 'contributor')`,
    [ids.lead, ids.analyst, ids.owner, ids.org],
  );
  const value = JSON.parse(exampleText) as Record<string, unknown>;
  value.key = `prova.link_${suffix}`;
  const plan = planTemplateLoad(JSON.stringify(value), { restrictToWorkspaceId: ids.ws });
  assert.ok(plan.ok);
  const loaded = await applyTemplateLoad(exec!, plan.plan, { actorUserId: ids.lead, publish: true });
  assert.ok(loaded.ok, loaded.ok ? "" : loaded.message);
  const lead = await loadUserContext(exec!, ids.lead, LS_DOMAINS);
  const created = await createCase(exec!, { workspaceId: ids.ws, user: lead!, canReviewWorkspacePortfolio: true, input: { templateId: loaded.value.templateId, code: `PUB-${suffix.toUpperCase()}`, title: "Caso dei link" } });
  assert.ok(created.ok, created.ok ? "" : created.message);
  state.caseId = created.value.caseId;
  for (const r of await q(`SELECT id, key FROM uc_items WHERE case_id = $1::uuid`, [state.caseId])) state.items.set(String(r.key), String(r.id));
  const leadCtx = await ctxFor(ids.lead);
  for (const [userId, role] of [
    [ids.analyst, "ls_analista"],
    [ids.owner, "owner_cliente"],
  ] as const) {
    const r = await addCaseMember(exec!, leadCtx, { userId, role });
    assert.ok(r.ok, r.ok ? "" : r.message);
  }
  const contacts: [keyof typeof state, string, string | null][] = [
    ["contactService", "resp_servizio", `servizio-${suffix}@cliente.test`],
    ["contactSystems", "referente_sistemi", `sistemi-${suffix}@cliente.test`],
    ["contactOwner", "resp_servizio", `owner-firma-${suffix}@cliente.test`],
    ["contactPrivacy", "approvatore_privacy", `privacy-${suffix}@cliente.test`],
  ];
  for (const [field, role, email] of contacts) {
    const c = await createContact(exec!, leadCtx, { displayName: `Referente ${role}`, templateRoleKey: role, email });
    assert.ok(c.ok, c.ok ? "" : c.message);
    (state as Record<string, unknown>)[field] = c.value.contactId;
  }
  for (const [role, contact] of [
    ["resp_servizio", state.contactService],
    ["referente_sistemi", state.contactSystems],
  ] as const) {
    const r = await assignItems(exec!, leadCtx, { mode: "ruolo", roleKey: role, contactId: contact });
    assert.ok(r.ok, r.ok ? "" : r.message);
  }
  // A value declared in a call before the request, as the seed writes it (PIANO §8.1).
  const declared = randomUUID();
  await q(
    `INSERT INTO uc_answers (id, case_id, item_id, version, kind, value, source_kind, source_ref) VALUES ($1::uuid, $2::uuid, $3::uuid, 1, 'valore', $4::jsonb, 'dichiarato_in_call', 'F001')`,
    [declared, state.caseId, item("q.sistemi.07"), JSON.stringify({ text: "ogni settimana" })],
  );
  await q(`UPDATE uc_items SET current_answer_id = $1::uuid WHERE id = $2::uuid`, [declared, item("q.sistemi.07")]);
  const sent = await sendRequests(exec!, leadCtx, { contactIds: [state.contactService, state.contactSystems] });
  assert.ok(sent.ok, sent.ok ? "" : sent.message);
  for (const r of sent.value.requests) {
    if (r.contactId === state.contactService) state.requestService = r.requestId;
    if (r.contactId === state.contactSystems) state.requestSystems = r.requestId;
  }
  for (const [requestId, field] of [
    [state.requestService, "tokenService"],
    [state.requestSystems, "tokenSystems"],
  ] as const) {
    const issued = await issueRequestToken(exec!, { workspaceId: ids.ws, caseId: state.caseId, requestId, issuedFor: "invio" });
    assert.ok(issued.ok, issued.ok ? "" : issued.message);
    state[field] = issued.value.token;
  }
});

after(async () => {
  if (!sql) return;
  await q(`DELETE FROM workspaces WHERE id = $1::uuid`, [ids.ws]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id IN ($1::uuid, $2::uuid, $3::uuid)`, [ids.lead, ids.analyst, ids.owner]);
  await q(`DELETE FROM uc_rate_limits WHERE bucket LIKE $1`, [`test:${suffix}%`]);
});

test("link: one SQL by hash; wrong, unknown or revoked tokens are the same «non valido»; reading writes nothing", opts, async () => {
  assert.equal(await resolveRequestToken(exec!, "not-a-token"), null);
  assert.equal(await resolveRequestToken(exec!, newRequestToken().token), null);
  assert.deepEqual(await loadReferentPage(exec!, newRequestToken().token, popts()), { access: "non_valido" });
  const page = await loadReferentPage(exec!, state.tokenService, popts());
  if (page.access === "non_valido") assert.fail("the referent's link is valid");
  assert.equal(page.access, "scrivibile");
  const view = page.view;
  assert.equal(view.mode, "raccolta");
  assert.equal(view.clientLabel, "Cliente di prova");
  assert.equal(view.privacy.acknowledged, false);
  assert.ok(view.modules.length >= 1 && view.modules[0].key === "m.servizio.base", "template module order");
  const keys = view.modules.flatMap((m) => m.items.map((i) => i.key));
  assert.ok(keys.includes("q.servizio.02") && !keys.some((k) => k.startsWith("q.sistemi")), "only the referent's own items");
  assert.equal(view.progress.done, 0);
  assert.ok(view.progress.total >= 5);
  const req = await one(`SELECT status, first_opened_at FROM uc_requests WHERE id = $1::uuid`, [state.requestService]);
  assert.deepEqual([req.status, req.first_opened_at], ["inviata", null], "GET does not open the link");
  assert.equal(num((await one(`SELECT count(*) AS n FROM uc_events WHERE case_id = $1::uuid AND event_type = 'link.aperto'`, [state.caseId])).n), 0);
});

test("opened and privacy notice: POST only, once a day, version on the request; writes wait for «Ho letto»", opts, async () => {
  const l = await link(state.tokenService);
  const early = await saveReferentDraft(exec!, l, item("q.servizio.02"), { payload: { value: "10" } }, popts());
  assert.equal(early.ok ? null : early.code, "informativa_da_leggere");
  const opened = await markLinkOpened(exec!, l, popts());
  assert.ok(opened.ok && opened.value.recorded);
  const again = await markLinkOpened(exec!, await link(state.tokenService), popts());
  assert.ok(again.ok && !again.value.recorded);
  const req = await one(`SELECT status, first_opened_at IS NOT NULL AS opened FROM uc_requests WHERE id = $1::uuid`, [state.requestService]);
  assert.deepEqual([req.status, req.opened], ["aperta", true]);
  const events = await q(`SELECT ip_hash, user_agent, payload::text AS p FROM uc_events WHERE case_id = $1::uuid AND event_type = 'link.aperto'`, [state.caseId]);
  assert.equal(events.length, 1, "link.aperto at most once a day");
  assert.equal(events[0].ip_hash, IP_HASH);
  const stale = await acknowledgePrivacy(exec!, l, { version: "vecchia" }, popts());
  assert.equal(stale.ok ? null : stale.code, "informativa_cambiata");
  assert.ok(!stale.ok && stale.message.includes(`«${REFERENT_PRIVACY_NOTICE.button}»`), "the message names the button as it is on the page");
  const ack = await acknowledgePrivacy(exec!, l, { version: REFERENT_PRIVACY_NOTICE.version }, popts());
  assert.ok(ack.ok, ack.ok ? "" : ack.message);
  const r = await one(`SELECT privacy_ack_at IS NOT NULL AS ack, privacy_notice_version FROM uc_requests WHERE id = $1::uuid`, [state.requestService]);
  assert.deepEqual([r.ack, r.privacy_notice_version], [true, REFERENT_PRIVACY_NOTICE.version]);
  const c = await one(`SELECT privacy_notice_version FROM uc_contacts WHERE id = $1::uuid`, [state.contactService]);
  assert.equal(c.privacy_notice_version, REFERENT_PRIVACY_NOTICE.version);
  const seen = await q(`SELECT payload::text AS p FROM uc_events WHERE case_id = $1::uuid AND event_type = 'informativa.vista'`, [state.caseId]);
  assert.equal(seen.length, 1);
  assert.ok(!String(seen[0].p).includes("@"));
  assert.equal((await viewOf(state.tokenService)).privacy.acknowledged, true);
});

test("drafts: saved on the request item, health and discriminatory text never reach the database", opts, async () => {
  const l = await link(state.tokenService);
  const saved = await saveReferentDraft(exec!, l, item("q.servizio.02"), { payload: { value: "1.200" }, estimate: true }, popts());
  assert.ok(saved.ok, saved.ok ? "" : saved.message);
  const ri = await one(`SELECT state, draft FROM uc_request_items WHERE request_id = $1::uuid AND item_id = $2::uuid`, [state.requestService, item("q.servizio.02")]);
  assert.equal(ri.state, "bozza");
  assert.deepEqual((ri.draft as Record<string, unknown>).payload, { value: "1.200" });
  assert.equal(String((await one(`SELECT status FROM uc_requests WHERE id = $1::uuid`, [state.requestService])).status), "in_corso");
  const health = await saveReferentDraft(exec!, l, item("q.servizio.05"), { payload: "2 ore", note: "dopo la visita medica del dipendente" }, popts());
  assert.equal(health.ok ? null : health.code, "testo_sanitario");
  const discr = await saveReferentDraft(exec!, l, item("q.servizio.05"), { payload: "2 ore", note: "il cliente preferisce solo operatori donne" }, popts());
  assert.equal(discr.ok ? null : discr.code, "testo_discriminatorio");
  const untouched = await one(`SELECT draft FROM uc_request_items WHERE request_id = $1::uuid AND item_id = $2::uuid`, [state.requestService, item("q.servizio.05")]);
  assert.equal(untouched.draft, null, "a blocked draft is not saved");
  // A value not yet in the right format is still a draft, but health text in it never is.
  const malformed = await saveReferentDraft(exec!, l, item("q.servizio.04"), { payload: "dalle nove, dopo la visita medica" }, popts());
  assert.equal(malformed.ok ? null : malformed.code, "testo_sanitario");
  assert.equal((await one(`SELECT draft FROM uc_request_items WHERE request_id = $1::uuid AND item_id = $2::uuid`, [state.requestService, item("q.servizio.04")])).draft, null);
  const unfinished = await saveReferentDraft(exec!, l, item("q.servizio.04"), { payload: "dalle nove" }, popts());
  assert.ok(unfinished.ok && unfinished.value.errors.length > 0, "format problems come back as errors, the draft is kept");
  const freeDate = await saveReferentDraft(exec!, l, item("q.servizio.04"), { payload: "9-13", valid_from: "malattia" }, popts());
  assert.equal(freeDate.ok ? null : freeDate.code, "dati_non_validi", "no free text through the date field");
  const other = await saveReferentDraft(exec!, l, item("q.sistemi.01"), { payload: "sì" }, popts());
  assert.equal(other.ok ? null : other.code, "voce_non_disponibile", "another referent's item is not reachable");
  const foreign = await saveReferentDraft(exec!, l, randomUUID(), { payload: "sì" }, popts());
  assert.equal(foreign.ok ? null : foreign.code, "voce_non_disponibile");
});

test("«Carica un Excel» on a table question: the file is checked and stays attached, its rows come back; other questions refuse it", opts, async () => {
  const l = await link(state.tokenService);
  const env = { UC_LOCAL_STORAGE_DIR: storeDir };
  const meta = { ipHash: IP_HASH, userAgent: "prova" };
  const bytes = new Uint8Array(Buffer.from("Canale;Su 100\nposta;60\nsportello;30\naltro;10\n", "utf8"));
  const noDeclaration = await tableFromReferentFile(exec!, l, { itemId: item("q.servizio.01"), fileName: "canali.csv", declaration: false, bytes }, meta, env, popts());
  assert.equal(noDeclaration.ok ? null : noDeclaration.code, "dichiarazione_mancante");
  const r = await tableFromReferentFile(exec!, l, { itemId: item("q.servizio.01"), fileName: "canali.csv", declaration: true, bytes }, meta, env, popts());
  assert.ok(r.ok, r.ok ? "" : r.message);
  assert.deepEqual([r.value.file.status, r.value.file.usable], ["pulito", true]);
  assert.deepEqual(r.value.rows, [["Canale", "Su 100"], ["posta", "60"], ["sportello", "30"], ["altro", "10"]]);
  assert.equal(r.value.rowsMessage, null);
  const table = itemView(await viewOf(state.tokenService), "q.servizio.01");
  assert.ok(table.files.some((f) => f.id === r.value.file.fileId && f.usable), "the file stays attached to the question");
  const grid = gridFromRows(r.value.rows!, table.config);
  assert.deepEqual(grid.grid?.rows, [["posta", "60"], ["sportello", "30"], ["altro", "10"]]);
  const notes = await tableFromReferentFile(exec!, l, { itemId: item("q.servizio.01"), fileName: "appunti.txt", declaration: true, bytes: new Uint8Array(Buffer.from("Appunti sul servizio di sportello.", "utf8")) }, meta, env, popts());
  assert.ok(notes.ok, notes.ok ? "" : notes.message);
  assert.deepEqual([notes.value.rows, typeof notes.value.rowsMessage], [null, "string"], "not a table: attached, no rows, a plain message");
  const notTable = await tableFromReferentFile(exec!, l, { itemId: item("q.servizio.02"), fileName: "canali.csv", declaration: true, bytes }, meta, env, popts());
  assert.equal(notTable.ok ? null : notTable.code, "voce_non_disponibile");
  const notMine = await tableFromReferentFile(exec!, l, { itemId: item("q.sistemi.03"), fileName: "canali.csv", declaration: true, bytes }, meta, env, popts());
  assert.equal(notMine.ok ? null : notMine.code, "voce_non_disponibile");
});

test("answer: typed value with «è una stima», append-only answer from the referent, item in verification, draft cleared", opts, async () => {
  const l = await link(state.tokenService);
  const blocked = await submitReferentAnswer(exec!, l, item("q.servizio.02"), { payload: { value: "1.200" }, note: "dato preso dopo la visita medica" }, popts());
  assert.equal(blocked.ok ? null : blocked.code, "testo_sanitario");
  assert.equal(num((await one(`SELECT count(*) AS n FROM uc_answers WHERE item_id = $1::uuid`, [item("q.servizio.02")])).n), 0);
  const impossible = await submitReferentAnswer(exec!, l, item("q.servizio.02"), { payload: { value: "1.200" }, valid_from: "2026-02-31" }, popts());
  assert.deepEqual(impossible.ok ? null : [impossible.code, impossible.message], ["dati_non_validi", "Scegli una data che esiste."]);
  const wrong = await submitReferentAnswer(exec!, l, item("q.servizio.02"), { payload: { value: "tanti" } }, popts());
  assert.equal(wrong.ok ? null : wrong.code, "risposta_non_valida");
  assert.ok(!wrong.ok && (wrong.issues?.length ?? 0) > 0);
  const sent = await submitReferentAnswer(exec!, l, item("q.servizio.02"), { payload: { value: "1.200" }, estimate: true, source_basis: "stima_a_memoria" }, popts());
  assert.ok(sent.ok, sent.ok ? "" : sent.message);
  assert.equal(sent.value.status, "in_verifica");
  assert.equal(await statusOf("q.servizio.02"), "in_verifica");
  const a = await one(
    `SELECT version, kind, source_kind, responder_contact_id, request_id, confidence, source_basis, ip_hash, device, value_normalized IS NOT NULL AS typed
     FROM uc_answers WHERE item_id = $1::uuid`,
    [item("q.servizio.02")],
  );
  assert.deepEqual(
    [num(a.version), a.kind, a.source_kind, a.responder_contact_id, a.request_id, a.confidence, a.source_basis, a.ip_hash, a.device, a.typed],
    [1, "valore", "referente", state.contactService, state.requestService, "stima", "stima_a_memoria", IP_HASH, "mobile", true],
  );
  const ri = await one(`SELECT state, draft FROM uc_request_items WHERE request_id = $1::uuid AND item_id = $2::uuid`, [state.requestService, item("q.servizio.02")]);
  assert.deepEqual([ri.state, ri.draft], ["inviata", null]);
  const ev = await one(`SELECT payload, ip_hash, actor_type, actor_contact_id FROM uc_events WHERE case_id = $1::uuid AND event_type = 'risposta.inviata'`, [state.caseId]);
  assert.deepEqual([ev.actor_type, ev.actor_contact_id, ev.ip_hash], ["referente", state.contactService, IP_HASH]);
  assert.ok(!JSON.stringify(ev.payload).includes("1200"), "no values in the audit");
  const bell = await q(`SELECT recipient_user_id FROM uc_notifications WHERE case_id = $1::uuid AND template_key = 'risposta_ricevuta'`, [state.caseId]);
  assert.equal(bell.length, 2, "one bell row per Lateral Space member");
  const twice = await submitReferentAnswer(exec!, l, item("q.servizio.02"), { payload: { value: "1300" } }, popts());
  assert.equal(twice.ok ? null : twice.code, "stato_non_ammesso", "an answer in verification waits for Lateral Space");
  const view = await viewOf(state.tokenService);
  const v = itemView(view, "q.servizio.02");
  assert.equal(v.label, "In verifica");
  assert.equal(v.ownAnswer?.estimate, true);
  assert.equal(view.progress.done, 1);
});

test("«Non lo so» is a valid answer; a late answer still goes to verification; partial answers need a chiesta item", opts, async () => {
  const l = await link(state.tokenService);
  const notKnown = await submitReferentAnswer(exec!, l, item("q.servizio.05"), { kind: "non_so", who_might_know: "il responsabile dei turni" }, popts());
  assert.ok(notKnown.ok, notKnown.ok ? "" : notKnown.message);
  assert.equal(await statusOf("q.servizio.05"), "mancante");
  const row = await one(`SELECT status_reason FROM uc_items WHERE id = $1::uuid`, [item("q.servizio.05")]);
  assert.ok(String(row.status_reason).includes("Non lo so"));
  assert.equal(String((await one(`SELECT state FROM uc_request_items WHERE request_id = $1::uuid AND item_id = $2::uuid`, [state.requestService, item("q.servizio.05")])).state), "non_so");
  const late = await submitReferentAnswer(exec!, l, item("q.servizio.05"), { payload: "90 min" }, popts());
  assert.ok(late.ok, late.ok ? "" : late.message);
  assert.equal(await statusOf("q.servizio.05"), "in_verifica");
  const noReason = await submitReferentAnswer(exec!, l, item("q.servizio.04"), { kind: "non_so", who_might_know: "Mario Rossi" }, popts());
  assert.equal(noReason.ok ? null : noReason.code, "testo_nome_persona", "names are blocked in free text");
  const partial = await submitReferentAnswer(exec!, l, item("q.servizio.04"), { payload: "09:00-13:00", partial: true, note: "manca l'orario del sabato" }, popts());
  assert.ok(partial.ok, partial.ok ? "" : partial.message);
  assert.equal(await statusOf("q.servizio.04"), "parziale");
  const again = await submitReferentAnswer(exec!, l, item("q.servizio.04"), { payload: "09:00-13:00", partial: true }, popts());
  assert.equal(again.ok ? null : again.code, "stato_non_ammesso");
});

test("rule confirmation: «Confermo» records the confirming referent; the role comes from the request", opts, async () => {
  const l = await link(state.tokenService);
  const missing = await submitReferentAnswer(exec!, l, item("q.servizio.03"), { payload: { choice: "confermo" } }, popts());
  assert.equal(missing.ok ? null : missing.code, "risposta_non_valida", "exceptions are asked by the template");
  const r = await submitReferentAnswer(exec!, l, item("q.servizio.03"), { payload: { choice: "confermo", exceptions: "nessuna" } }, popts());
  assert.ok(r.ok, r.ok ? "" : r.message);
  const row = await one(
    `SELECT i.confirmed_by_contact_id, a.kind, a.text_hash IS NOT NULL AS hashed FROM uc_items i JOIN uc_answers a ON a.id = i.current_answer_id WHERE i.id = $1::uuid`,
    [item("q.servizio.03")],
  );
  assert.deepEqual([row.confirmed_by_contact_id, row.kind, row.hashed], [state.contactService, "conferma", true]);
});

test("declared value: shown to confirm, prose is retyped, the confirmation supersedes the declared answer", opts, async () => {
  const l = await link(state.tokenSystems);
  assert.ok((await acknowledgePrivacy(exec!, l, { version: REFERENT_PRIVACY_NOTICE.version }, popts())).ok);
  const view = await viewOf(state.tokenSystems);
  const v = itemView(view, "q.sistemi.07");
  assert.ok(v.toConfirm);
  assert.equal(v.toConfirm.declaredInCall, true);
  assert.equal(v.toConfirm.sourceLabel, "In una call con Lateral Space", "the source in plain words, never the fact code");
  assert.equal(v.toConfirm.canConfirm, false, "prose on a choice cannot be confirmed with one click");
  assert.deepEqual(v.toConfirm.prefill, { option: "ogni settimana" });
  const l2 = await link(state.tokenSystems);
  const oneClick = await submitReferentAnswer(exec!, l2, item("q.sistemi.07"), { kind: "conferma" }, popts());
  assert.equal(oneClick.ok ? null : oneClick.code, "risposta_non_valida");
  assert.ok(!oneClick.ok && oneClick.issues?.some((i) => i.code === "valore_non_tipizzato"));
  const stale = await submitReferentAnswer(exec!, l2, item("q.sistemi.07"), { kind: "conferma", payload: { option: "ogni settimana" }, supersedes_answer_id: randomUUID() }, popts());
  assert.equal(stale.ok ? null : stale.code, "conflitto");
  const confirmed = await submitReferentAnswer(exec!, l2, item("q.sistemi.07"), { kind: "conferma", payload: { option: "ogni settimana" }, supersedes_answer_id: v.toConfirm.answerId }, popts());
  assert.ok(confirmed.ok, confirmed.ok ? "" : confirmed.message);
  const row = await one(
    `SELECT a.kind, a.value, a.supersedes_answer_id, a.version, i.confirmed_by_contact_id FROM uc_items i JOIN uc_answers a ON a.id = i.current_answer_id WHERE i.id = $1::uuid`,
    [item("q.sistemi.07")],
  );
  assert.deepEqual([row.kind, row.value, row.supersedes_answer_id, num(row.version), row.confirmed_by_contact_id], ["conferma", { option: "ogni settimana" }, v.toConfirm.answerId, 2, state.contactSystems]);
});

test("«Non si applica» from the link: a reason of at least 10 characters, then the item waits in verification for both signatures", opts, async () => {
  const l = await link(state.tokenSystems);
  const short = await submitReferentAnswer(exec!, l, item("q.sistemi.06"), { kind: "proposta_na", reason: "No" }, popts());
  assert.equal(short.ok ? null : short.code, "risposta_non_valida");
  const health = await submitReferentAnswer(exec!, l, item("q.sistemi.06"), { kind: "proposta_na", reason: "Serve solo per le visite mediche dei piloti" }, popts());
  assert.equal(health.ok ? null : health.code, "testo_sanitario");
  const r = await submitReferentAnswer(exec!, l, item("q.sistemi.06"), { kind: "proposta_na", reason: "Il sistema non ha un export di questo tipo" }, popts());
  assert.ok(r.ok, r.ok ? "" : r.message);
  const row = await one(
    `SELECT i.status, i.na_reason, i.na_proposed_at IS NOT NULL AS proposed, i.na_proposed_by_contact_id, i.na_approved_at, a.kind
     FROM uc_items i JOIN uc_answers a ON a.id = i.current_answer_id WHERE i.id = $1::uuid`,
    [item("q.sistemi.06")],
  );
  assert.deepEqual(
    [row.status, row.na_reason, row.proposed, row.na_proposed_by_contact_id, row.na_approved_at, row.kind],
    ["in_verifica", "Il sistema non ha un export di questo tipo", true, state.contactSystems, null, "proposta_na"],
  );
});

test("delegation: a colleague of a known domain gets a new link right away; depth and Lateral Space are limited", opts, async () => {
  const l = await link(state.tokenSystems);
  const toLs = await delegateItems(exec!, l, { nome: "Collega", email: `qualcuno-${suffix}@ls.test`, voci: [item("q.sistemi.02")] }, popts());
  assert.equal(toLs.ok ? null : toLs.code, "delega_a_lateral_space");
  const self = await delegateItems(exec!, l, { nome: "Io", email: `sistemi-${suffix}@cliente.test`, voci: [item("q.sistemi.02")] }, popts());
  assert.equal(self.ok ? null : self.code, "delega_a_se_stessi");
  const notMine = await delegateItems(exec!, l, { nome: "Collega", email: `collega-${suffix}@cliente.test`, voci: [item("q.servizio.01")] }, popts());
  assert.equal(notMine.ok ? null : notMine.code, "risposta_non_valida");
  const done = await delegateItems(exec!, l, { nome: "Collega Sistemi", email: `collega-${suffix}@cliente.test`, messaggio: "Ci pensi tu?", voci: [item("q.sistemi.02")] }, popts());
  assert.ok(done.ok, done.ok ? "" : done.message);
  assert.equal(done.value.status, "inviata");
  assert.ok(done.value.link, "without email the colleague's link comes back once");
  const colleague = await one(`SELECT id FROM uc_contacts WHERE workspace_id = $1::uuid AND email = $2`, [ids.ws, `collega-${suffix}@cliente.test`]);
  const moved = await one(`SELECT status, assignee_contact_id FROM uc_items WHERE id = $1::uuid`, [item("q.sistemi.02")]);
  assert.deepEqual([moved.status, moved.assignee_contact_id], ["chiesta", colleague.id]);
  const old = await one(`SELECT state FROM uc_request_items WHERE request_id = $1::uuid AND item_id = $2::uuid`, [state.requestSystems, item("q.sistemi.02")]);
  assert.equal(old.state, "delegata");
  const child = await one(
    `SELECT status, delegation_depth, acting_role_key, delegated_by_contact_id, message, expires_at > now() AS live FROM uc_requests WHERE delegated_from_request_id = $1::uuid`,
    [state.requestSystems],
  );
  assert.deepEqual([child.status, num(child.delegation_depth), child.acting_role_key, child.delegated_by_contact_id, child.message, child.live], ["inviata", 1, "referente_sistemi", state.contactSystems, "Ci pensi tu?", true]);
  const ev = await one(`SELECT payload FROM uc_events WHERE case_id = $1::uuid AND event_type = 'delega.creata'`, [state.caseId]);
  assert.deepEqual(ev.payload, { items: 1, depth: 1, needs_approval: false });
  const childId = String((await one(`SELECT id FROM uc_requests WHERE delegated_from_request_id = $1::uuid`, [state.requestSystems])).id);
  const lsBell = await q(`SELECT recipient_user_id FROM uc_notifications WHERE request_id = $1::uuid AND channel = 'in_app'`, [childId]);
  assert.equal(lsBell.length, 2, "Lateral Space is told about every delegation");
  const created = await one(`SELECT payload::text AS p FROM uc_events WHERE case_id = $1::uuid AND event_type = 'referente.creato' AND target_id = $2::uuid`, [state.caseId, colleague.id]);
  assert.ok(created && !String(created.p).includes("@") && !String(created.p).includes("Collega"), "no names or emails in the audit");
  // The colleague's own link works and shows only the delegated item.
  const childToken = tokenFromPath(done.value.link);
  const lc = await link(childToken);
  assert.equal(lc.delegationDepth, 1);
  assert.ok((await acknowledgePrivacy(exec!, lc, { version: REFERENT_PRIVACY_NOTICE.version }, popts())).ok);
  const childView = await viewOf(childToken);
  assert.deepEqual(childView.modules.flatMap((m) => m.items.map((i) => i.key)), ["q.sistemi.02"]);
  const deeper = await delegateItems(exec!, await link(childToken), { nome: "Terzo", email: `terzo-${suffix}@cliente.test`, voci: [item("q.sistemi.02")] }, popts({ emailConfigured: true }));
  assert.ok(deeper.ok, deeper.ok ? "" : deeper.message);
  assert.equal(deeper.value.link, null, "with email configured the link leaves only by email");
  const queued = await q(`SELECT template_key, recipient_contact_id FROM uc_notifications WHERE template_key = 'delega' AND case_id = $1::uuid`, [state.caseId]);
  assert.ok(queued.length >= 3, "colleague and delegator emails are queued");
  const third = await one(`SELECT id FROM uc_requests WHERE case_id = $1::uuid AND delegation_depth = 2`, [state.caseId]);
  const thirdToken = await issueRequestToken(exec!, { workspaceId: ids.ws, caseId: state.caseId, requestId: String(third.id), issuedFor: "invio" });
  assert.ok(thirdToken.ok);
  const lt = await link(thirdToken.value.token);
  assert.ok((await acknowledgePrivacy(exec!, lt, { version: REFERENT_PRIVACY_NOTICE.version }, popts())).ok);
  const tooDeep = await delegateItems(exec!, await link(thirdToken.value.token), { nome: "Quarto", email: `quarto-${suffix}@cliente.test`, voci: [item("q.sistemi.02")] }, popts());
  assert.equal(tooDeep.ok ? null : tooDeep.code, "delega_troppo_profonda");
});

test("delegation: at most five a day from the same link", opts, async () => {
  const existing = num((await one(`SELECT count(*) AS n FROM uc_requests WHERE delegated_from_request_id = $1::uuid`, [state.requestSystems])).n);
  const fakes: string[] = [];
  for (let n = existing; n < 5; n++) {
    const id = randomUUID();
    fakes.push(id);
    await q(
      `INSERT INTO uc_requests (id, case_id, contact_id, purpose, share_epoch, status, delegated_from_request_id, delegated_by_contact_id, delegation_depth)
       SELECT $1::uuid, $2::uuid, $3::uuid, 'raccolta', c.share_epoch, 'bozza', $4::uuid, $3::uuid, 1 FROM uc_cases c WHERE c.id = $2::uuid`,
      [id, state.caseId, state.contactSystems, state.requestSystems],
    );
  }
  try {
    const sixth = await delegateItems(exec!, await link(state.tokenSystems), { nome: "Sesto Collega", email: `sesto-${suffix}@cliente.test`, voci: [item("q.sistemi.01")] }, popts());
    assert.equal(sixth.ok ? null : sixth.code, "troppe_deleghe");
    assert.equal(await statusOf("q.sistemi.01"), "chiesta");
  } finally {
    if (fakes.length) await q(`DELETE FROM uc_requests WHERE id = ANY($1::uuid[])`, [fakes]);
  }
});

test("delegation to a new domain waits for Lateral Space: draft, no link, bell; approval hands the items over", opts, async () => {
  const l = await link(state.tokenSystems);
  const pending = await delegateItems(exec!, l, { nome: "Fornitore", email: `esterno-${suffix}@fornitore.test`, voci: [item("q.sistemi.04")] }, popts());
  assert.ok(pending.ok, pending.ok ? "" : pending.message);
  assert.deepEqual([pending.value.status, pending.value.link], ["da_approvare", null]);
  const req = await one(`SELECT id, status, expires_at FROM uc_requests WHERE delegated_from_request_id = $1::uuid AND status = 'bozza'`, [state.requestSystems]);
  assert.ok(req);
  assert.equal(req.expires_at, null);
  assert.equal(num((await one(`SELECT count(*) AS n FROM uc_request_tokens WHERE request_id = $1::uuid`, [req.id])).n), 0, "no link before approval");
  const still = await one(`SELECT assignee_contact_id FROM uc_items WHERE id = $1::uuid`, [item("q.sistemi.04")]);
  assert.equal(still.assignee_contact_id, state.contactSystems);
  const bell = await q(`SELECT recipient_user_id FROM uc_notifications WHERE request_id = $1::uuid AND channel = 'in_app'`, [req.id]);
  assert.equal(bell.length, 2);
  const approved = await approveDelegation(exec!, await ctxFor(ids.lead), { requestId: String(req.id) });
  assert.ok(approved.ok, approved.ok ? "" : approved.message);
  const moved = await one(`SELECT c.email FROM uc_items i JOIN uc_contacts c ON c.id = i.assignee_contact_id WHERE i.id = $1::uuid`, [item("q.sistemi.04")]);
  assert.equal(moved.email, `esterno-${suffix}@fornitore.test`);
});

test("revoked links and paused cases: revoked = «non valido»; paused = read only, no writes", opts, async () => {
  const lead = await ctxFor(ids.lead);
  const suspended = await transitionCase(exec!, lead, { to: "sospeso", reason: "Pausa del cliente" });
  assert.ok(suspended.ok, suspended.ok ? "" : suspended.message);
  const paused = await link(state.tokenService);
  assert.equal(paused.live, false);
  const view = await loadReferentView(exec!, paused, popts());
  assert.equal(view.access, "sola_lettura");
  assert.ok(view.modules.flatMap((m) => m.items).every((i) => !i.can.answer));
  const write = await submitReferentAnswer(exec!, paused, item("q.servizio.01"), { payload: "x" }, popts());
  assert.equal(write.ok ? null : write.code, "caso_sospeso");
  const opened = await markLinkOpened(exec!, paused, popts());
  assert.ok(opened.ok && !opened.value.recorded);
  const resumed = await transitionCase(exec!, lead, { to: "raccolta", reason: "Si riparte" });
  assert.ok(resumed.ok, resumed.ok ? "" : resumed.message);

  const copy = await copyRequestLink(exec!, lead, { requestId: state.requestService });
  assert.ok(copy.ok, copy.ok ? "" : copy.message);
  const live = await link(tokenFromPath(copy.value.path));
  // The token is revoked after the link was read: the guard inside the batch stops the write.
  await revokeIssuedToken(exec!, { caseId: state.caseId, tokenId: live.tokenId });
  const late = await submitReferentAnswer(exec!, live, item("q.servizio.01"), { payload: "Canale\tSu 100\nemail\t60\ntelefono\t30\nchat\t10" }, popts());
  assert.equal(late.ok ? null : late.code, "link_non_valido", "a link revoked after it was read does not write");
  assert.equal(await statusOf("q.servizio.01"), "chiesta");
  const revoked = await revokeRequest(exec!, lead, { requestId: state.requestService });
  assert.ok(revoked.ok, revoked.ok ? "" : revoked.message);
  assert.equal(await resolveRequestToken(exec!, state.tokenService), null, "a revoked request is «non valido»");
  assert.equal(await statusOf("q.servizio.01"), "da_chiedere", "revocation puts asked items back (row 31)");
});

test("approval link: the designated Owner signs a «non applicabile» and a fallback; only the read text counts", opts, async () => {
  const lead = await ctxFor(ids.lead);
  await q(
    `INSERT INTO uc_files (id, workspace_id, case_id, file_name, mime, size_bytes, sha256, privacy_class, max_size_bytes, scan_status, content_scanned)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'prova.pdf', 'application/pdf', 100, $4, 'riservato_azienda', 1000, 'pulito', true)`,
    [ids.file, ids.ws, state.caseId, "c".repeat(64)],
  );
  for (const [designation, contactId] of [
    ["owner", state.contactOwner],
    ["privacy", state.contactPrivacy],
  ] as const) {
    const d = await setCaseSigner(exec!, lead, { designation, contactId, evidenceFileId: ids.file });
    assert.ok(d.ok, d.ok ? "" : d.message);
  }
  assert.ok((await proposeNa(exec!, lead, { itemId: item("q.costi.04"), reason: "La data non serve per questo processo" })).ok);
  const fallback = await proposeFallback(exec!, lead, { itemId: item("src.crm.api_richieste"), descrizione: "Export CSV autorizzato dal cliente", daSostituireEntro: "2027-06-30" });
  assert.ok(fallback.ok, fallback.ok ? "" : fallback.message);
  const req = await requestApproval(exec!, lead, { designation: "owner" }, { emailConfigured: true });
  assert.ok(req.ok, req.ok ? "" : req.message);
  const token = await issueRequestToken(exec!, { workspaceId: ids.ws, caseId: state.caseId, requestId: req.value.requestId, issuedFor: "invio" });
  assert.ok(token.ok);
  const unacked = await link(token.value.token);
  assert.equal(unacked.purpose, "approvazioni");
  assert.ok((await acknowledgePrivacy(exec!, unacked, { version: REFERENT_PRIVACY_NOTICE.version }, popts())).ok);
  // Every call resolves the link again, as the route handlers do.
  const l = await link(token.value.token);
  const view = await loadReferentView(exec!, l, popts());
  assert.equal(view.mode, "approvazioni");
  const na = view.approvals.find((a) => a.kind === "na" && a.targetId === item("q.costi.04"));
  const rip = view.approvals.find((a) => a.kind === "ripiego");
  assert.ok(na && rip);
  assert.ok(!view.approvals.some((a) => a.kind === "a8"), "the Owner does not sign the privacy sheet");
  const answer = await submitReferentAnswer(exec!, l, item("q.costi.04"), { payload: "2026-01-01" }, popts());
  assert.equal(answer.ok ? null : answer.code, "stato_non_ammesso", "an approval link does not answer questions");
  const unread = await decideApproval(exec!, l, { kind: "na", target_id: na.targetId, decision: "approvo", text_hash: na.textHash }, popts());
  assert.equal(unread.ok ? null : unread.code, "dati_non_validi");
  const changed = await decideApproval(exec!, l, { kind: "na", target_id: na.targetId, decision: "approvo", read: true, text_hash: "0".repeat(64) }, popts());
  assert.equal(changed.ok ? null : changed.code, "testo_cambiato");
  const signed = await decideApproval(exec!, l, { kind: "na", target_id: na.targetId, decision: "approvo", read: true, text_hash: na.textHash }, popts());
  assert.ok(signed.ok, signed.ok ? "" : signed.message);
  assert.equal(signed.value.complete, false, "Lateral Space still has to sign");
  assert.equal(String((await one(`SELECT na_approved_by_contact_id FROM uc_items WHERE id = $1::uuid`, [item("q.costi.04")])).na_approved_by_contact_id), state.contactOwner);
  const lsSign = await signNa(exec!, lead, { itemId: item("q.costi.04") });
  assert.ok(lsSign.ok && lsSign.value.complete, lsSign.ok ? "" : lsSign.message);
  assert.equal(await statusOf("q.costi.04"), "non_applicabile");
  const ripSigned = await decideApproval(exec!, l, { kind: "ripiego", target_id: rip.targetId, decision: "approvo", read: true, text_hash: rip.textHash }, popts());
  assert.ok(ripSigned.ok, ripSigned.ok ? "" : ripSigned.message);
  const fb = await one(`SELECT fallback FROM uc_items WHERE id = $1::uuid`, [item("src.crm.api_richieste")]);
  const approvals = (fb.fallback as { approvazioni: { metodo: string; ip_hash: string | null; contact_id: string | null }[] }).approvazioni;
  assert.ok(approvals.some((a) => a.metodo === "link" && a.ip_hash === IP_HASH && a.contact_id === state.contactOwner), "link signature with the IP hash");
  const reject = await decideApproval(exec!, l, { kind: "ripiego", target_id: rip.targetId, decision: "non_approvo", read: true, text_hash: rip.textHash, reason: "No" }, popts());
  assert.equal(reject.ok ? null : reject.code, "approvazione_non_trovata", "already signed: no longer pending");
});

test("privacy approver: signs A.8 from the link; then a personal item is answered only encrypted, never as a draft", opts, async () => {
  const lead = await ctxFor(ids.lead);
  const a8 = await one(`SELECT id FROM uc_blockers WHERE case_id = $1::uuid AND key = 'a8'`, [state.caseId]);
  const evidence = {
    documento: "Scheda privacy",
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
  const req = await requestApproval(exec!, lead, { designation: "privacy" }, { emailConfigured: true });
  assert.ok(req.ok, req.ok ? "" : req.message);
  const token = await issueRequestToken(exec!, { workspaceId: ids.ws, caseId: state.caseId, requestId: req.value.requestId, issuedFor: "invio" });
  assert.ok(token.ok);
  assert.ok((await acknowledgePrivacy(exec!, await link(token.value.token), { version: REFERENT_PRIVACY_NOTICE.version }, popts())).ok);
  const l = await link(token.value.token);
  const view = await loadReferentView(exec!, l, popts());
  const sheet = view.approvals.find((a) => a.kind === "a8");
  assert.ok(sheet);
  assert.ok(sheet.lines.some((line) => line.includes("Persona LS")), "names of the people with access");
  assert.ok(!view.approvals.some((a) => a.kind === "na"), "the privacy approver signs only privacy decisions");
  const reject = await decideApproval(exec!, l, { kind: "a8", target_id: sheet.targetId, decision: "non_approvo", read: true, text_hash: sheet.textHash, reason: "Non ancora" }, popts());
  assert.equal(reject.ok ? null : reject.code, "rifiuto_non_disponibile");
  const signed = await decideApproval(exec!, l, { kind: "a8", target_id: sheet.targetId, decision: "approvo", read: true, text_hash: sheet.textHash }, popts());
  assert.ok(signed.ok, signed.ok ? "" : signed.message);
  assert.equal(signed.value.complete, true);
  const blocker = await one(`SELECT status, approvals FROM uc_blockers WHERE id = $1::uuid`, [a8.id]);
  assert.equal(blocker.status, "sciolto");
  assert.ok((blocker.approvals as { metodo: string; ip_hash: string | null }[]).some((a) => a.metodo === "link" && a.ip_hash === IP_HASH));
  assert.equal(await statusOf("q.sistemi.05"), "da_chiedere");

  // With A.8 resolved, Lateral Space proposes the personal zone for a colleague; the privacy approver confirms from the link.
  const proposed = await proposePersonalZoneAccess(exec!, lead, { userId: ids.analyst });
  assert.ok(proposed.ok, proposed.ok ? "" : proposed.message);
  const zoneView = await loadReferentView(exec!, await link(token.value.token), popts());
  const grant = zoneView.approvals.find((a) => a.kind === "zona_personale");
  assert.ok(grant);
  assert.equal(grant.targetId, ids.analyst);
  assert.ok(grant.lines.some((line) => line.includes("Analista LS")));
  const zone = await decideApproval(exec!, await link(token.value.token), { kind: "zona_personale", target_id: grant.targetId, decision: "approvo", read: true, text_hash: grant.textHash }, popts());
  assert.ok(zone.ok, zone.ok ? "" : zone.message);
  assert.equal(zone.value.complete, true);
  const member = await one(`SELECT bool_or(personal_zone_access) AS access, max(personal_zone_grant::text) AS g FROM uc_case_members WHERE case_id = $1::uuid AND user_id = $2::uuid`, [state.caseId, ids.analyst]);
  assert.equal(member.access, true);
  assert.ok(String(member.g).includes(IP_HASH), "the link signature keeps the IP hash");

  const sent = await sendRequests(exec!, lead, { itemIds: [item("q.sistemi.05")] });
  assert.ok(sent.ok, sent.ok ? "" : sent.message);
  const personalReq = sent.value.requests[0].requestId;
  const pt = await issueRequestToken(exec!, { workspaceId: ids.ws, caseId: state.caseId, requestId: personalReq, issuedFor: "invio" });
  assert.ok(pt.ok);
  assert.ok((await acknowledgePrivacy(exec!, await link(pt.value.token), { version: REFERENT_PRIVACY_NOTICE.version }, popts())).ok);
  const lp = await link(pt.value.token);
  const closed = await submitReferentAnswer(exec!, lp, item("q.sistemi.05"), { payload: "turno A" }, popts());
  assert.equal(closed.ok ? null : closed.code, "zona_personale_chiusa", "without the key the personal zone stays closed");
  // While closed it is out of the progress; once open it counts (DESIGN §4.4 point 6).
  assert.deepEqual((await loadReferentView(exec!, lp, popts())).progress, { done: 0, total: 0 });
  assert.deepEqual((await loadReferentView(exec!, lp, popts({ personalZoneKey: ZONE_KEY }))).progress, { done: 0, total: 1 });
  // Personal data never travel in a batch, even with the zone open: they leave on their own, encrypted.
  const batch = await submitReferentAnswers(exec!, lp, { answers: [{ item_id: item("q.sistemi.05"), kind: "valore", payload: "turno A" }] }, popts({ personalZoneKey: ZONE_KEY }));
  assert.ok(batch.ok, batch.ok ? "" : batch.message);
  assert.deepEqual(batch.value.results.map((x) => (x.ok ? "ok" : x.code)), ["invio_singolo"]);
  assert.equal(num((await one(`SELECT count(*) AS n FROM uc_answers WHERE item_id = $1::uuid`, [item("q.sistemi.05")])).n), 0, "nothing written by the batch");
  const draft = await saveReferentDraft(exec!, lp, item("q.sistemi.05"), { payload: "turno A" }, popts({ personalZoneKey: ZONE_KEY }));
  assert.equal(draft.ok ? null : draft.code, "bozza_non_ammessa");
  const answered = await submitReferentAnswer(exec!, lp, item("q.sistemi.05"), { payload: "turno A" }, popts({ personalZoneKey: ZONE_KEY }));
  assert.ok(answered.ok, answered.ok ? "" : answered.message);
  const row = await one(`SELECT id, value, value_normalized, text_hash, encode(value_encrypted, 'base64') AS enc FROM uc_answers WHERE item_id = $1::uuid ORDER BY version DESC LIMIT 1`, [item("q.sistemi.05")]);
  assert.deepEqual([row.value, row.value_normalized, row.text_hash], [null, null, null]);
  const kek = deriveWorkspaceKek(ZONE_KEY, ids.ws);
  assert.ok(kek.ok);
  const opened = openJson(kek.value, Buffer.from(String(row.enc), "base64"), envelopeAad({ workspaceId: ids.ws, caseId: state.caseId, objectId: String(row.id) }));
  assert.ok(opened.ok);
  assert.deepEqual((opened.value as { value: unknown }).value, { text: "turno A" });
  const pv = await loadReferentView(exec!, await link(pt.value.token), popts({ personalZoneKey: ZONE_KEY }));
  const pitem = itemView(pv, "q.sistemi.05");
  assert.deepEqual([pitem.personal, pitem.draft, pitem.ownAnswer?.display, pitem.ownAnswer?.value, pitem.ownAnswer?.encrypted], [true, null, null, null, true], "personal values never come back to the page");
});

test("rate limits: counts per bucket and window, the first rule over the limit wins", opts, async () => {
  const rule = { bucket: `test:${suffix}`, unit: "minute" as const, limit: 2 };
  assert.equal(await hitRateLimits(exec!, [rule]), null);
  assert.equal(await hitRateLimits(exec!, [rule]), null);
  assert.deepEqual(await hitRateLimits(exec!, [rule]), rule);
});

// ── WP8 · Referente: one topic with many questions (DESIGN §4, P0-11, P0-13) ──

/** Questions of the synthetic «Volumi» topic: enough for a 60-answer batch, then a 100+ delegation. */
const VOLUME_QUESTIONS = 180;
const volumeKey = (n: number) => `q.volumi.${String(n).padStart(3, "0")}`;
const vol = { caseId: "", items: new Map<string, string>(), contact: "", request: "", token: "", tokenId: "" };

/** A second case in the same workspace, from the example schema plus a «Volumi» topic of 180 numeric questions. */
async function volumesCase(): Promise<typeof vol> {
  if (vol.token) return vol;
  const value = JSON.parse(exampleText) as { key: string; roles: unknown[]; items: unknown[]; request_modules: unknown[] };
  value.key = `prova.volumi_${suffix}`;
  value.roles.push({ key: "resp_volumi", label: "Responsabile dei volumi" });
  const keys: string[] = [];
  for (let n = 1; n <= VOLUME_QUESTIONS; n++) {
    keys.push(volumeKey(n));
    value.items.push({
      key: volumeKey(n),
      kind: "domanda",
      section: "documenti_dataset",
      request_module: "m.volumi.base",
      title: `Quante pratiche di tipo ${n} arrivano in un mese?`,
      priority: "should",
      privacy_class: "nessuna",
      owner_role_key: "resp_volumi",
      response: { type: "numero", config: { unit: "pratiche al mese", integer: true, min: 0 } },
    });
  }
  value.request_modules.push({ key: "m.volumi.base", title: "Volumi", role_key: "resp_volumi", why: "Per dimensionare il servizio.", estimated_minutes: 60, items: keys });
  const plan = planTemplateLoad(JSON.stringify(value), { restrictToWorkspaceId: ids.ws });
  assert.ok(plan.ok, "synthetic template");
  const loaded = await applyTemplateLoad(exec!, plan.plan, { actorUserId: ids.lead, publish: true });
  assert.ok(loaded.ok, loaded.ok ? "" : loaded.message);
  const lead = await loadUserContext(exec!, ids.lead, LS_DOMAINS);
  const created = await createCase(exec!, { workspaceId: ids.ws, user: lead!, canReviewWorkspacePortfolio: true, input: { templateId: loaded.value.templateId, code: `VOL-${suffix.toUpperCase()}`, title: "Caso dei volumi" } });
  assert.ok(created.ok, created.ok ? "" : created.message);
  vol.caseId = created.value.caseId;
  for (const r of await q(`SELECT id, key FROM uc_items WHERE case_id = $1::uuid`, [vol.caseId])) vol.items.set(String(r.key), String(r.id));
  const ctx = await commandContextFor(exec!, { workspaceId: ids.ws, caseId: vol.caseId, userId: ids.lead, lsDomains: LS_DOMAINS });
  assert.ok(ctx.ok, ctx.ok ? "" : ctx.message);
  const contact = await createContact(exec!, ctx.value, { displayName: "Marco Volumi", templateRoleKey: "resp_volumi", email: `volumi-${suffix}@cliente.test` });
  assert.ok(contact.ok, contact.ok ? "" : contact.message);
  vol.contact = contact.value.contactId;
  const assigned = await assignItems(exec!, ctx.value, { mode: "ruolo", roleKey: "resp_volumi", contactId: vol.contact });
  assert.ok(assigned.ok, assigned.ok ? "" : assigned.message);
  const sent = await sendRequests(exec!, ctx.value, { contactIds: [vol.contact] });
  assert.ok(sent.ok, sent.ok ? "" : sent.message);
  vol.request = sent.value.requests[0].requestId;
  const issued = await issueRequestToken(exec!, { workspaceId: ids.ws, caseId: vol.caseId, requestId: vol.request, issuedFor: "invio" });
  assert.ok(issued.ok, issued.ok ? "" : issued.message);
  vol.token = issued.value.token;
  vol.tokenId = (await link(vol.token)).tokenId;
  return vol;
}

const volItem = (key: string) => {
  const id = vol.items.get(key);
  assert.ok(id, `item ${key}`);
  return id;
};

after(async () => {
  if (!sql || !vol.tokenId) return;
  await q(`DELETE FROM uc_rate_limits WHERE bucket LIKE $1`, [`tok:${vol.tokenId}%`]);
});

test("referent view: first name, two-level notice, question counts, minutes in proportion", opts, async () => {
  const v = await volumesCase();
  const l = await link(v.token);
  const old = await acknowledgePrivacy(exec!, l, { version: "uc-2026-10-1" }, popts());
  assert.equal(old.ok ? null : old.code, "informativa_cambiata", "the two-level notice is a new version");
  assert.ok((await acknowledgePrivacy(exec!, l, { version: REFERENT_PRIVACY_NOTICE.version }, popts())).ok);
  assert.equal(REFERENT_PRIVACY_NOTICE.version, "uc-2026-10-2");
  const view = await viewOf(v.token);
  assert.equal(view.greetingName, "Marco");
  assert.equal(view.greetingName, greetingNameFrom("Marco Volumi"));
  const topic = view.modules.find((m) => m.key === "m.volumi.base");
  assert.ok(topic);
  assert.equal(topic.questionCount, VOLUME_QUESTIONS);
  assert.equal(topic.items.length, VOLUME_QUESTIONS);
  assert.deepEqual(view.progress, { done: 0, total: VOLUME_QUESTIONS });
  assert.equal(view.estimatedMinutes, 60, "the whole topic is in the request: the whole estimate");
  assert.equal(view.delegation.allowed, true);
});

test("batch send: 60 answers of one topic in two calls of one unit each, no rate-limit error, all in verification", opts, async () => {
  const v = await volumesCase();
  const entries = Array.from({ length: 60 }, (_, n) => ({ item_id: volItem(volumeKey(n + 1)), kind: "valore", payload: { value: String(100 + n) } }));
  const chunks = chunkBatch(entries);
  assert.deepEqual(chunks.map((c) => c.length), [50, 10]);
  const rule = tokenRateLimitRule(v.tokenId, "invio");
  for (const chunk of chunks) {
    // The route handler counts one unit of «invio» per call, whatever the number of answers.
    assert.equal(await hitRateLimits(exec!, [rule]), null, "one unit per batch, far below 20 a minute");
    const r = await submitReferentAnswers(exec!, await link(v.token), { answers: chunk }, popts());
    assert.ok(r.ok, r.ok ? "" : r.message);
    assert.deepEqual([r.value.sent, r.value.failed], [chunk.length, 0]);
    assert.ok(r.value.results.every((x) => x.ok && x.status === "in_verifica"));
  }
  const counts = await one(
    `SELECT count(*) FILTER (WHERE status = 'in_verifica') AS verifying, count(*) AS n FROM uc_items WHERE case_id = $1::uuid AND key = ANY($2::text[])`,
    [v.caseId, entries.map((_, n) => volumeKey(n + 1))],
  );
  assert.deepEqual([num(counts.verifying), num(counts.n)], [60, 60]);
  const answers = await one(`SELECT count(*) AS n FROM uc_answers WHERE case_id = $1::uuid AND request_id = $2::uuid AND source_kind = 'referente'`, [v.caseId, v.request]);
  assert.equal(num(answers.n), 60);
  const window = await one(`SELECT count FROM uc_rate_limits WHERE bucket = $1 ORDER BY window_start DESC LIMIT 1`, [rule.bucket]);
  assert.ok(num(window.count) <= 2, "two calls, two units");
  assert.equal((await viewOf(v.token)).progress.done, 60);
  const tooMany = await submitReferentAnswers(exec!, await link(v.token), { answers: Array.from({ length: MAX_BATCH_ANSWERS + 1 }, () => ({ item_id: volItem(volumeKey(61)), kind: "valore", payload: { value: "1" } })) }, popts());
  assert.deepEqual(tooMany.ok ? null : [tooMany.code, tooMany.message], ["dati_non_validi", "Manda al massimo 50 risposte alla volta."]);
});

test("batch send: an outcome per answer; a wrong one does not stop the others; clarification replies never go in a batch", opts, async () => {
  const v = await volumesCase();
  const r = await submitReferentAnswers(
    exec!,
    await link(v.token),
    {
      answers: [
        { item_id: volItem(volumeKey(61)), kind: "valore", payload: { value: "12" } },
        { item_id: volItem(volumeKey(62)), kind: "valore", payload: { value: "tanti" } },
        { item_id: volItem(volumeKey(61)), kind: "valore", payload: { value: "13" } },
        { item_id: item("q.servizio.01"), kind: "valore", payload: { value: "1" } },
        { item_id: volItem(volumeKey(63)), kind: "risposta_chiarimento", payload: { value: "3" }, note: "Sì" },
        { kind: "valore" },
      ],
    },
    popts(),
  );
  assert.ok(r.ok, r.ok ? "" : r.message);
  assert.deepEqual(r.value.results.map((x) => (x.ok ? "ok" : x.code)), ["ok", "risposta_non_valida", "voce_ripetuta", "voce_non_disponibile", "invio_singolo", "dati_non_validi"]);
  assert.deepEqual([r.value.sent, r.value.failed], [1, 5]);
  const wrong = r.value.results[1];
  assert.ok(!wrong.ok && (wrong.issues?.length ?? 0) > 0, "the reason comes back next to the field");
  assert.equal(await one(`SELECT status FROM uc_items WHERE id = $1::uuid`, [volItem(volumeKey(62))]).then((x) => x.status), "chiesta");
});

test("drafts keep the decision: «È così», «Non lo so» and «Non si applica» wait in the draft, then leave together; a typed value alone is not ready", opts, async () => {
  const v = await volumesCase();
  // A typed value declared in a call: «È così» confirms it with one tap.
  const config = { unit: "pratiche al mese", integer: true, min: 0 };
  const declared = normalizeAnswer("numero", { value: "250" }, config, answerContext(new Date(), true));
  assert.ok(declared.ok);
  const answerId = randomUUID();
  await q(
    `INSERT INTO uc_answers (id, case_id, item_id, version, kind, value, value_normalized, source_kind, source_ref) VALUES ($1::uuid, $2::uuid, $3::uuid, 1, 'valore', $4::jsonb, $5::jsonb, 'dichiarato_in_call', 'F009')`,
    [answerId, v.caseId, volItem(volumeKey(65)), JSON.stringify(declared.value), JSON.stringify(declared.normalized)],
  );
  await q(`UPDATE uc_items SET current_answer_id = $1::uuid WHERE id = $2::uuid`, [answerId, volItem(volumeKey(65))]);
  const l = await link(v.token);
  // A value typed and saved by autosave, without «Avanti»: after a reload it is a draft, not a ready answer.
  const typed = await saveReferentDraft(exec!, l, volItem(volumeKey(66)), { kind: "valore", payload: { value: "3" } }, popts());
  assert.ok(typed.ok, typed.ok ? "" : typed.message);
  const undecided = itemView(await viewOf(v.token), volumeKey(66));
  assert.equal(initialForm(undecided).intent, null, "a typed value is not a decision");
  assert.equal(isReadyToSend(undecided, initialForm(undecided), [], new Date()), false);
  for (const [n, body] of [
    [65, { kind: "conferma", decided: true }],
    [66, { kind: "non_so", who_might_know: "l'ufficio acquisti", decided: true }],
    [67, { kind: "proposta_na", reason: "Da noi questo tipo di pratica non esiste.", decided: true }],
  ] as const) {
    const saved = await saveReferentDraft(exec!, l, volItem(volumeKey(n)), body, popts());
    assert.ok(saved.ok, saved.ok ? "" : saved.message);
  }
  const view = await viewOf(v.token);
  const pick = (n: number) => itemView(view, volumeKey(n));
  const confirm = pick(65);
  assert.ok(confirm.toConfirm?.canConfirm, "typed and visible: one tap");
  assert.equal(confirm.toConfirm?.sourceLabel, "In una call con Lateral Space");
  const forms = [65, 66, 67].map((n) => ({ item: pick(n), form: initialForm(pick(n)) }));
  assert.deepEqual(forms.map((f) => f.form.intent), ["conferma", "non_so", "non_si_applica"], "the decision comes back from the draft");
  assert.ok(forms.every((f) => isReadyToSend(f.item, f.form, [], new Date())));
  const r = await submitReferentAnswers(exec!, await link(v.token), { answers: forms.map((f) => batchEntry(f.item, f.form)) }, popts());
  assert.ok(r.ok, r.ok ? "" : r.message);
  assert.deepEqual(r.value.results.map((x) => (x.ok ? x.status : x.code)), ["in_verifica", "mancante", "in_verifica"]);
  const confirmed = await one(`SELECT a.kind, a.supersedes_answer_id FROM uc_items i JOIN uc_answers a ON a.id = i.current_answer_id WHERE i.id = $1::uuid`, [volItem(volumeKey(65))]);
  assert.deepEqual([confirmed.kind, confirmed.supersedes_answer_id], ["conferma", answerId]);
  const rows = await q(`SELECT state, draft FROM uc_request_items WHERE request_id = $1::uuid AND item_id = ANY($2::uuid[])`, [v.request, [65, 66, 67].map((n) => volItem(volumeKey(n)))]);
  assert.ok(rows.every((x) => x.draft === null), "drafts cleared by the answers");
  assert.deepEqual(rows.map((x) => x.state).sort(), ["inviata", "inviata", "non_so"]);
});

test("delegation carries more than 100 questions in one call (P0-13)", opts, async () => {
  const v = await volumesCase();
  const open = Array.from({ length: VOLUME_QUESTIONS - 67 }, (_, n) => volItem(volumeKey(68 + n))).concat(volItem(volumeKey(62)), volItem(volumeKey(63)), volItem(volumeKey(64)));
  assert.ok(open.length > 100);
  const r = await delegateItems(exec!, await link(v.token), { nome: "Giulia Volumi", email: `giulia-${suffix}@cliente.test`, voci: open }, popts());
  assert.ok(r.ok, r.ok ? "" : r.message);
  assert.deepEqual([r.value.status, r.value.items], ["inviata", open.length]);
  const moved = await one(
    `SELECT count(*) FILTER (WHERE c.email = $2) AS n FROM uc_items i JOIN uc_contacts c ON c.id = i.assignee_contact_id WHERE i.id = ANY($1::uuid[])`,
    [open, `giulia-${suffix}@cliente.test`],
  );
  assert.equal(num(moved.n), open.length);
  assert.ok(r.value.link);
  const colleague = await link(tokenFromPath(r.value.link));
  assert.ok((await acknowledgePrivacy(exec!, colleague, { version: REFERENT_PRIVACY_NOTICE.version }, popts())).ok);
  const theirs = await loadReferentView(exec!, await link(tokenFromPath(r.value.link)), popts());
  assert.equal(theirs.modules.flatMap((m) => m.items).length, open.length);
  assert.equal(theirs.greetingName, "Giulia");
  const mine = await viewOf(v.token);
  assert.ok(!mine.modules.flatMap((m) => m.items).some((i) => open.includes(i.id)), "the delegated questions leave my list");
});

test("a link of a workspace outside UC_WORKSPACE_IDS is the generic «non valido» (P0-1)", opts, async () => {
  const v = await volumesCase();
  assert.deepEqual(await loadReferentPage(exec!, v.token, popts({ workspaceEnabled: () => false })), { access: "non_valido" });
  const on = await loadReferentPage(exec!, v.token, popts({ workspaceEnabled: (ws) => ws === ids.ws }));
  assert.equal(on.access, "scrivibile");
});
