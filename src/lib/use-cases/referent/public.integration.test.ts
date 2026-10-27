import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

// La pagina pubblica del referente sul database di prova (SPEC §2.3, §3.8, §4): quando il link vale
// (revocato, scaduto, un indirizzo cambiato, un referente anonimizzato o non più attivo, l'area spenta),
// l'informativa cambiata, le domande ritirate, i limiti di frequenza, la proiezione della vista.
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su
//   127.0.0.1). Nessuna email vera (mailer finto). Dati sintetici, creati e cancellati qui.
const url = process.env.DATABASE_URL;
const enabled = process.env.HUB_TEST_ISOLATED === "true" && Boolean(url);
if (enabled) {
  const parsed = new URL(url!);
  if (parsed.hostname !== "127.0.0.1" || process.env.UC_TEST_DATABASE_URL !== url) {
    throw new Error("Hub DB tests need a loopback DATABASE_URL equal to UC_TEST_DATABASE_URL");
  }
  if (!/^\/hub_[a-z0-9][a-z0-9_]{0,39}$/.test(parsed.pathname)) {
    throw new Error("Run this suite only on a package database hub_<id>");
  }
  if ((globalThis.fetch as { name?: string }).name !== "localNeonFetch") {
    throw new Error("Preload scripts/uc-test/local-neon.cjs to reach the local test database");
  }
}
const opts = { skip: !enabled };

type Referents = typeof import("../../db/queries/use-case-referents.ts");
type Public = typeof import("../../db/queries/use-case-referent-public.ts");
type Dispatch = typeof import("../../db/queries/use-case-referent-dispatch.ts");
type Ctx = import("../service.ts").WriteContext;
type Mail = import("../../uc/notify/dispatch.ts").OutgoingEmail;

let referents: Referents;
let pub: Public;
let dispatch: Dispatch;
let q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), ws: randomUUID(), other: randomUUID(), builder: randomUUID(), analyst: randomUUID(), contributor: randomUUID(), ls: randomUUID(), useCase: randomUUID(), otherCard: randomUUID() };
const emails = {
  builder: `builder.referenti.${suffix}@cliente.test`,
  analyst: `analyst.referenti.${suffix}@cliente.test`,
  contributor: `contributor.referenti.${suffix}@cliente.test`,
  ls: `ls.referenti.${suffix}@ls.test`,
};
type Person = keyof typeof emails;
const ROLE: Record<Person, string> = { builder: "function_lead", analyst: "analyst", contributor: "contributor", ls: "transformation_lead" };
const REFERENT_EMAIL = `mario.rossi.${suffix}@topjet.test`;
const storageDir = mkdtempSync(join(tmpdir(), "referenti-"));

const ENV = {
  USE_CASE_HUB_WORKSPACES: "",
  UC_LS_EMAIL_DOMAINS: "ls.test",
  RESEND_API_KEY: "re_test_finto",
  UC_EMAIL_FROM: "Lateral Space via Unbundle <test@example.test>",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  UC_LOCAL_STORAGE_DIR: storageDir,
} as Record<string, string | undefined>;
const ENV_KEYS = ["USE_CASE_HUB_WORKSPACES", "UC_LS_EMAIL_DOMAINS", "UC_ENABLED", "UC_WORKSPACE_IDS", "USE_CASE_REFERENTS"] as const;
const envBefore = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function as(person: Person, workspaceId: string = ids.ws): Ctx {
  return { workspaceId, actor: { userId: ids[person], role: ROLE[person], isLateralSpace: person === "ls", kind: "persona" }, channel: "pagina" };
}
const requester = (person: Person) => ({ name: `Persona ${person}`, emailVerified: true });

function ok<T>(result: { ok: true; value: T } | { ok: false; error: string; message: string }, label = "esito"): T {
  if (!result.ok) assert.fail(`${label}: atteso ok, ricevuto ${result.error} (${result.message})`);
  return result.value;
}
function refused(result: { ok: boolean; error?: string }, error: string, label = "rifiuto") {
  assert.equal(result.ok, false, label);
  assert.equal(result.error, error, label);
}

function fakeMailer() {
  const outbox: Mail[] = [];
  return { outbox, async send(m: Mail) { outbox.push(m); return { ok: true as const }; } };
}
const tokenOf = (m: Mail) => /\/rispondi\/(ucq_[A-Za-z0-9_-]{32})/.exec(m.text)?.[1] ?? null;

async function needIds(useCaseId: string = ids.useCase): Promise<string[]> {
  const rows = await q(`SELECT n.id::text AS id FROM use_case_needs n JOIN use_case_need_links l ON l.need_id = n.id WHERE l.use_case_id = $1::uuid ORDER BY n.sort_order, n.id`, [useCaseId]);
  return rows.map((r) => String(r.id));
}
async function statusOf(needId: string): Promise<string> {
  return String((await q(`SELECT status FROM use_case_needs WHERE id = $1::uuid`, [needId]))[0]?.status);
}
async function useCaseSnapshot(): Promise<string> {
  return JSON.stringify(await q(`SELECT version, portfolio_review_status, intake, updated_at FROM use_cases WHERE id = $1::uuid`, [ids.useCase]));
}

before(async () => {
  if (!enabled) return;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Record<string, unknown>[]>;
  ENV.USE_CASE_HUB_WORKSPACES = [ids.ws, ids.other].join(",");
  process.env.USE_CASE_HUB_WORKSPACES = ENV.USE_CASE_HUB_WORKSPACES;
  process.env.UC_LS_EMAIL_DOMAINS = "ls.test";
  delete process.env.UC_ENABLED;
  delete process.env.UC_WORKSPACE_IDS;
  delete process.env.USE_CASE_REFERENTS;
  referents = await import("../../db/queries/use-case-referents.ts");
  pub = await import("../../db/queries/use-case-referent-public.ts");
  dispatch = await import("../../db/queries/use-case-referent-dispatch.ts");

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Organizzazione referenti', $2)`, [ids.org, `hub-referenti-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $3::uuid, 'TopJet prova'), ($2::uuid, $3::uuid, 'Altro workspace')`, [ids.ws, ids.other, ids.org]);
  for (const person of Object.keys(emails) as Person[]) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1::uuid, $2, $3, now())`, [ids[person], emails[person], `Persona ${person}`]);
    for (const ws of [ids.ws, ids.other]) await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [ws, ids[person], ROLE[person]]);
  }
  for (const [id, ws, code] of [
    [ids.useCase, ids.ws, `RF-${String(1000 + Math.floor(Math.random() * 8000))}`],
    [ids.otherCard, ids.other, `RG-${String(1000 + Math.floor(Math.random() * 8000))}`],
  ]) {
    await q(
      `INSERT INTO use_cases (id, workspace_id, title, description, status, portfolio_review_status, portfolio_kind, code, source)
       VALUES ($1::uuid, $2::uuid, 'Fatture fornitori', 'Problema di prova', 'accepted', 'scored', 'use_case_ai', $3, 'web_proposed')`,
      [id, ws, code],
    );
  }
});

after(async () => {
  for (const key of ENV_KEYS) {
    const value = envBefore[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(storageDir, { recursive: true, force: true });
  if (!enabled) return;
  await q(`DELETE FROM uc_rate_limits WHERE bucket LIKE 'ucq:%'`);
  await q(`DELETE FROM workspaces WHERE id = ANY($1::uuid[])`, [[ids.ws, ids.other]]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [Object.keys(emails).map((p) => ids[p as Person])]);
});

const state = { requestId: "", contactId: "", token: "", needs: [] as string[] };


async function freshLink(email: string, needs: string[]): Promise<{ requestId: string; token: string; contactId: string }> {
  const contacts = await q(`SELECT id::text AS id FROM uc_contacts WHERE workspace_id = $1::uuid AND email = $2`, [ids.ws, email]);
  const contact = contacts[0] ? { kind: "esistente", contactId: String(contacts[0].id) } : { kind: "nuovo", displayName: "Referente di prova", email };
  const sent = ok(await referents.sendReferentRequest(as("builder"), ids.useCase, { contact, needIds: needs }, { env: ENV, requester: requester("builder") }));
  const mailer = fakeMailer();
  await dispatch.dispatchReferentEmails({ requestId: sent.requestId, env: ENV, mailer, sendIntervalMs: 0 });
  const [row] = await q(`SELECT contact_id::text AS c FROM use_case_referent_requests WHERE id = $1::uuid`, [sent.requestId]);
  return { requestId: sent.requestId, token: tokenOf(mailer.outbox[0]) ?? "", contactId: String(row.c) };
}
const access = async (token: string) => (await pub.resolveReferentToken(token, new Date())).access;

test("preparazione: la scheda ha proponente, note e valori che la pagina non deve mai mostrare", opts, async () => {
  await q(
    `INSERT INTO uc_subprocessor_acks (workspace_id, list_version, statement_text, declared_by_user_id, declared_by_role) VALUES ($1::uuid, '2026-10', 'Autorizzazione di prova', $2::uuid, 'function_lead')`,
    [ids.ws, ids.builder],
  );
  await q(`UPDATE use_cases SET proposed_by = $2, review_notes = 'NOTA-RISERVATA', value_eur_year = 98765 WHERE id = $1::uuid`, [ids.useCase, `proponente.${suffix}@cliente.test`]);
  ok(await referents.prepareReferentQuestions(as("builder"), ids.useCase));
  state.needs = await needIds();
});

test("il link: valido; dopo un cambio d'indirizzo, un'anonimizzazione o con il referente non attivo è «non valido»", opts, async () => {
  const a = await freshLink(`uno.${suffix}@topjet.test`, state.needs.slice(0, 1));
  assert.equal(await access(a.token), "ok");
  await q(`UPDATE uc_contacts SET email = $2 WHERE id = $1::uuid`, [a.contactId, `uno.nuovo.${suffix}@topjet.test`]);
  assert.equal(await access(a.token), "non_valido", "l'indirizzo è cambiato");
  await q(`UPDATE uc_contacts SET email = $2 WHERE id = $1::uuid`, [a.contactId, `uno.${suffix}@topjet.test`]);
  assert.equal(await access(a.token), "ok");
  await q(`UPDATE uc_contacts SET is_active = false WHERE id = $1::uuid`, [a.contactId]);
  assert.equal(await access(a.token), "non_valido", "non più attivo");
  await q(`UPDATE uc_contacts SET is_active = true WHERE id = $1::uuid`, [a.contactId]);
  ok(await referents.revokeReferentRequest(as("builder"), ids.useCase, a.requestId, Number((await q(`SELECT version FROM use_case_referent_requests WHERE id = $1::uuid`, [a.requestId]))[0].version)));
  assert.equal(await access(a.token), "revocato");
  const b = await freshLink(`due.${suffix}@topjet.test`, state.needs.slice(1, 2));
  await q(`UPDATE use_case_referent_tokens SET expires_at = now() - interval '1 minute' WHERE request_id = $1::uuid`, [b.requestId]);
  assert.equal(await access(b.token), "scaduto");
  await q(`UPDATE uc_contacts SET anonymized_at = now(), email = NULL, display_name = 'Persona cancellata' WHERE id = $1::uuid`, [b.contactId]).catch(async () => {
    await q(`UPDATE uc_contacts SET anonymized_at = now() WHERE id = $1::uuid`, [b.contactId]);
  });
  assert.equal(await access(b.token), "non_valido", "anonimizzato");
  assert.equal(await access(`ucq_${"x".repeat(32)}`), "non_valido");
  assert.equal(await access("non-un-token"), "non_valido");
});

test("la pagina: l'area spenta per il workspace è «non valido»; la funzione spenta è «non disponibile»", opts, async () => {
  const c = await freshLink(`tre.${suffix}@topjet.test`, state.needs.slice(2, 3));
  state.token = c.token;
  state.requestId = c.requestId;
  const page = await pub.loadReferentAskPage(c.token, { env: ENV, now: new Date() });
  assert.equal(page.access, "ok");
  assert.equal((await pub.loadReferentAskPage(c.token, { env: { ...ENV, USE_CASE_HUB_WORKSPACES: ids.other }, now: new Date() })).access, "non_valido");
  assert.equal((await pub.loadReferentAskPage(c.token, { env: { ...ENV, USE_CASE_REFERENTS: "off" }, now: new Date() })).access, "non_disponibile");
  if (page.access !== "ok") return;
  const { PUBLIC_VIEW_KEYS, keyPaths } = await import("./view.ts");
  assert.deepEqual(keyPaths(page.view).filter((k) => !PUBLIC_VIEW_KEYS.includes(k)), []);
  const json = JSON.stringify(page.view);
  for (const secret of ["NOTA-RISERVATA", "98765", `proponente.${suffix}`, "Serve per stimare"]) assert.ok(!json.includes(secret), secret);
});

test("un'informativa vecchia si mostra di nuovo e blocca le bozze; una domanda ritirata non si vede", opts, async () => {
  const resolved = await pub.resolveReferentToken(state.token, new Date());
  assert.ok(resolved.access === "ok");
  if (resolved.access !== "ok") return;
  assert.ok((await pub.acceptReferentPrivacy(resolved.link, { version: "ucq-2026-10-1" }, new Date())).ok);
  await q(`UPDATE use_case_referent_requests SET privacy_notice_version = 'ucq-2025-01-1' WHERE id = $1::uuid`, [state.requestId]);
  const old = await pub.resolveReferentToken(state.token, new Date());
  assert.ok(old.access === "ok" && !old.link.privacyAccepted);
  if (old.access !== "ok") return;
  const draft = await pub.saveReferentDraft(old.link, { needId: state.needs[2], text: "Excel", dontKnow: false }, new Date());
  assert.ok(!draft.ok && draft.code === "informativa_da_leggere");
  // Il revisore cambia lo stato dell'esigenza: la domanda esce dalla pagina.
  const needsService = await import("../needs-service.ts");
  const [n] = await q(`SELECT version FROM use_case_needs WHERE id = $1::uuid`, [state.needs[2]]);
  ok(await needsService.updateNeed(as("builder"), state.needs[2], Number(n.version), { status: "non_applicabile" }));
  const view = await pub.loadReferentAskPage(state.token, { env: ENV, now: new Date() });
  assert.ok(view.access === "ok" && view.view.questions.length === 0 && view.view.state === "vuota", JSON.stringify(view));
});

test("limiti di frequenza: il secchio del link, 61 bozze in un minuto → la 61ª è oltre il limite", opts, async () => {
  const resolved = await pub.resolveReferentToken(state.token, new Date());
  assert.ok(resolved.access === "ok");
  if (resolved.access !== "ok") return;
  const rule = pub.referentRateRule(resolved.link.tokenId, "bozza");
  assert.equal(rule.bucket, `ucq:${resolved.link.tokenId}:bozza`);
  assert.equal(rule.limit, 60);
  const { hitRateLimits } = await import("../../db/queries/uc-public.ts");
  const { getAppUcExecutor } = await import("../../db/uc-executor.ts");
  const executor = await getAppUcExecutor();
  let exceeded = null;
  for (let i = 0; i < 61; i++) exceeded = await hitRateLimits(executor, [rule]);
  assert.equal(exceeded?.bucket, rule.bucket);
  assert.throws(() => pub.referentRateRule("non-un-id", "bozza"));
});

test("i codici HTTP della pagina pubblica", opts, async () => {
  assert.equal(pub.REFERENT_PUBLIC_STATUS.link_non_valido, 404);
  assert.equal(pub.REFERENT_PUBLIC_STATUS.risposte_da_correggere, 422);
  assert.equal(pub.REFERENT_PUBLIC_STATUS.informativa_da_leggere, 409);
  assert.equal(pub.REFERENT_PUBLIC_STATUS.file_non_trovato, 404);
});

// Gli aiuti di prova comuni alle suite di «Chiedi al referente»: questa non li usa tutti.
void (() => [REFERENT_EMAIL, refused, statusOf, useCaseSnapshot]);
