import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

// «Raccolta informazioni» e i passaggi automatici sul database di prova (SPEC §P2.8, §P2.9): ogni
// passaggio cambia le esigenze e la Storia come dice la tabella, mai la scheda; «Chiedi di nuovo»
// dopo la scadenza e su una richiesta «Senza risposta» ancora viva; lo stato derivato per i revisori.
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


let progress: typeof import("../../db/queries/use-case-info-progress.ts");
const reviewer = () => ({ userId: ids.builder, email: emails.builder, emailVerified: true, role: "function_lead", isLateralSpace: false });
const ANNA = `anna.verdi.${suffix}@topjet.test`;

async function version(requestId: string): Promise<number> {
  return Number((await q(`SELECT version FROM use_case_referent_requests WHERE id = $1::uuid`, [requestId]))[0].version);
}
async function needVersion(id: string): Promise<number> {
  return Number((await q(`SELECT version FROM use_case_needs WHERE id = $1::uuid`, [id]))[0].version);
}
async function sendNew(email: string, needs: string[], previousRequestId?: string) {
  const contacts = await q(`SELECT id::text AS id FROM uc_contacts WHERE workspace_id = $1::uuid AND email = $2`, [ids.ws, email]);
  const contact = contacts[0] ? { kind: "esistente", contactId: String(contacts[0].id) } : { kind: "nuovo", displayName: "Referente di prova", email };
  return referents.sendReferentRequest(as("builder"), ids.useCase, { contact, needIds: needs, previousRequestId }, { env: ENV, requester: requester("builder") });
}
async function infoState(): Promise<string | undefined> {
  return (await progress.listInfoProgress(ids.ws, reviewer()))?.[ids.useCase]?.state;
}

test("preparazione e T14: «Prepara le domande» crea esigenze «Da chiedere», la scheda non cambia", opts, async () => {
  progress = await import("../../db/queries/use-case-info-progress.ts");
  await q(
    `INSERT INTO uc_subprocessor_acks (workspace_id, list_version, statement_text, declared_by_user_id, declared_by_role) VALUES ($1::uuid, '2026-10', 'Autorizzazione di prova', $2::uuid, 'function_lead')`,
    [ids.ws, ids.builder],
  );
  const before = await useCaseSnapshot();
  ok(await referents.prepareReferentQuestions(as("builder"), ids.useCase));
  state.needs = await needIds();
  assert.equal(await useCaseSnapshot(), before);
  const added = await q(`SELECT actor_kind, channel, phase_after FROM use_case_events WHERE use_case_id = $1::uuid AND 'cosa_serve' = ANY(fields)`, [ids.useCase]);
  assert.equal(added.length, 6);
  assert.ok(added.every((e) => e.actor_kind === "persona" && e.channel === "pagina" && e.phase_after === "aggiunta.requisito.da_chiedere"));
  assert.equal(await infoState(), "da_chiedere");
  assert.equal(await progress.listInfoProgress(ids.ws, { ...reviewer(), userId: ids.contributor, role: "contributor" }), null);
});

test("T1, T2: «Chiedi al referente» e «Aggiungi domande» portano a «chiesta»; in attesa", opts, async () => {
  const before = await useCaseSnapshot();
  const sent = ok(await sendNew(REFERENT_EMAIL, state.needs.slice(0, 2)));
  state.requestId = sent.requestId;
  ok(await referents.addToReferentRequest(as("builder"), ids.useCase, sent.requestId, await version(sent.requestId), { needIds: [state.needs[2]] }, { env: ENV }));
  for (const id of state.needs.slice(0, 3)) assert.equal(await statusOf(id), "chiesta");
  assert.equal(await useCaseSnapshot(), before);
  await dispatch.dispatchReferentEmails({ requestId: sent.requestId, env: ENV, mailer: fakeMailer(), sendIntervalMs: 0 });
  assert.equal(await infoState(), "in_attesa");
  const history = await q(`SELECT phase_after FROM use_case_events WHERE use_case_id = $1::uuid AND 'richiesta_referente' = ANY(fields) ORDER BY at`, [ids.useCase]);
  assert.deepEqual(history.map((h) => h.phase_after), ["inviata", "domande_aggiunte"]);
});

test("T4: «Chiedi di nuovo» su una richiesta viva dopo l'ultimo promemoria: la vecchia è «sostituita», il suo link non vale più", opts, async () => {
  const mailer = fakeMailer();
  // Il link della richiesta di adesso, poi l'ultimo promemoria partito.
  const [tok] = await q(`SELECT count(*)::int AS n FROM use_case_referent_tokens WHERE request_id = $1::uuid AND revoked_at IS NULL`, [state.requestId]);
  assert.ok(Number(tok.n) >= 1);
  await q(`UPDATE use_case_referent_requests SET reminder_count = 2, last_reminder_at = now() - interval '1 day', last_email_at = now() - interval '1 day' WHERE id = $1::uuid`, [state.requestId]);
  assert.equal(await infoState(), "senza_risposta");
  // Ancora viva: senza «Chiedi di nuovo» non si può chiedere di nuovo alla stessa persona.
  const plain = await sendNew(REFERENT_EMAIL, state.needs.slice(0, 1));
  assert.equal(plain.ok, false);
  const before = await useCaseSnapshot();
  const again = ok(await sendNew(REFERENT_EMAIL, state.needs.slice(0, 3), state.requestId), "chiedi di nuovo");
  const [old] = await q(`SELECT status, revoked_reason FROM use_case_referent_requests WHERE id = $1::uuid`, [state.requestId]);
  assert.deepEqual([old.status, old.revoked_reason], ["revocata", "sostituita"]);
  for (const id of state.needs.slice(0, 3)) assert.equal(await statusOf(id), "chiesta", "restano «chiesta»");
  assert.equal((await q(`SELECT 1 FROM use_case_referent_tokens WHERE request_id = $1::uuid AND revoked_at IS NULL`, [state.requestId])).length, 0);
  assert.equal(await useCaseSnapshot(), before);
  await dispatch.dispatchReferentEmails({ requestId: again.requestId, env: ENV, mailer, sendIntervalMs: 0 });
  state.requestId = again.requestId;
  assert.equal(await infoState(), "in_attesa");
});

test("T3: dopo la scadenza «Chiedi di nuovo» è ammesso; un'esigenza senza risposta si chiede anche a un'altra persona", opts, async () => {
  await q(`UPDATE use_case_referent_requests SET created_at = now() - interval '31 days', sent_at = now() - interval '31 days', expires_at = now() - interval '1 minute' WHERE id = $1::uuid`, [state.requestId]);
  assert.equal(await infoState(), "senza_risposta");
  // Un'altra persona, sulla stessa esigenza «Senza risposta».
  const other = ok(await sendNew(ANNA, state.needs.slice(0, 1)), "un'altra persona");
  assert.equal(await statusOf(state.needs[0]), "chiesta");
  ok(await referents.revokeReferentRequest(as("builder"), ids.useCase, other.requestId, await version(other.requestId)));
  // La stessa persona, con «Chiedi di nuovo» sulla richiesta scaduta (già scaduta dall'invio di prima).
  const silentBefore = (await q(`SELECT 1 FROM use_case_notifications WHERE use_case_id = $1::uuid AND kind = 'senza_risposta'`, [ids.useCase])).length;
  const again = ok(await sendNew(REFERENT_EMAIL, state.needs.slice(1, 3), state.requestId), "di nuovo dopo la scadenza");
  const [expired] = await q(`SELECT status FROM use_case_referent_requests WHERE id = $1::uuid`, [state.requestId]);
  assert.equal(expired.status, "scaduta");
  // Nessun «Nessuna risposta» in più per la richiesta che si chiede di nuovo.
  assert.equal((await q(`SELECT 1 FROM use_case_notifications WHERE use_case_id = $1::uuid AND kind = 'senza_risposta'`, [ids.useCase])).length, silentBefore);
  state.requestId = again.requestId;
});

test("T5-T7: risposte del referente, risposta e file del team; «L'ho già verificata» porta ad «A posto»", opts, async () => {
  await dispatch.dispatchReferentEmails({ requestId: state.requestId, env: ENV, mailer: fakeMailer(), sendIntervalMs: 0 });
  ok(await referents.addReviewerAnswer(as("builder"), ids.useCase, state.needs[3], { text: "Tre persone" }));
  assert.equal(await statusOf(state.needs[3]), "in_verifica");
  assert.equal(await infoState(), "da_verificare");
  ok(await referents.addReviewerAnswer(as("builder"), ids.useCase, state.needs[4], { text: "Excel", validate: true }));
  assert.equal(await statusOf(state.needs[4]), "validata");
  const view = await progress.loadUseCaseInfoProgress({
    workspaceId: ids.ws,
    useCaseId: ids.useCase,
    viewer: reviewer(),
    needs: { requirements: await (async () => {
      const base = await import("../../db/queries/use-case-referent-base.ts");
      const { getAppUcExecutor } = await import("../../db/uc-executor.ts");
      return (await base.readCardNeeds(await getAppUcExecutor(), ids.ws, ids.useCase)).filter((n) => n.type === "requisito");
    })(), steps: [], linkable: [] },
    canAsk: true,
  });
  assert.equal(view?.state, "da_verificare");
  assert.equal(view?.count, "2 di 6 informazioni ricevute");
});

test("T11: la revoca riporta a «Da chiedere» le domande aperte; T13 le modifiche a mano in «Cosa serve» restano com'erano", opts, async () => {
  ok(await referents.revokeReferentRequest(as("builder"), ids.useCase, state.requestId, await version(state.requestId)));
  for (const id of state.needs.slice(1, 3)) assert.equal(await statusOf(id), "da_chiedere");
  const needsService = await import("../needs-service.ts");
  const before = await useCaseSnapshot();
  ok(await needsService.updateNeed(as("builder"), state.needs[5], await needVersion(state.needs[5]), { status: "non_applicabile" }));
  assert.equal(await statusOf(state.needs[5]), "non_applicabile");
  assert.equal(await useCaseSnapshot(), before);
});

// Gli aiuti di prova comuni alle suite di «Chiedi al referente»: questa non li usa tutti.
void (() => [pub, refused, tokenOf]);
