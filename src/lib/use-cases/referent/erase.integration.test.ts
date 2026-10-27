import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

// La cancellazione dei dati di un referente da parte dell'operatore sul database di prova (SPEC
// §3.10): `use-case-admin erase-referent` a secco e con `--apply`, in una transazione, con lo stesso
// risultato di «Cancella i dati di questa persona»; una seconda volta non cambia niente.
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su
//   127.0.0.1). Il comando gira con un `AdminDb` come quello dello script. Dati sintetici.
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


type AdminRow = Record<string, unknown>;

function adminCtx(apply: boolean, contactId: string, printed: unknown[]) {
  const db = {
    async read(text: string, params: readonly unknown[] = []): Promise<AdminRow[]> {
      return q(text, [...params]);
    },
    async write(statements: readonly { text: string; params: readonly unknown[] }[]): Promise<AdminRow[][]> {
      if (!apply) throw new Error("solo con --apply");
      const { neon } = await import("@neondatabase/serverless");
      const sql = neon(url!);
      return (await sql.transaction(statements.map((s) => sql.query(s.text, [...s.params])))) as AdminRow[][];
    },
  };
  return {
    command: "erase-referent" as const,
    scope: { kind: "workspace" as const, workspaceId: ids.ws },
    apply,
    value: (name: string) => (name === "contact" ? contactId : null),
    flag: () => false,
    db,
    lsEmailDomains: "ls.test",
    hubWorkspaces: new Set([ids.ws]),
    readJsonFile: () => null,
    print: (output: unknown) => printed.push(output),
  };
}

test("preparazione: una richiesta con una risposta inviata e una bozza", opts, async () => {
  await q(
    `INSERT INTO uc_subprocessor_acks (workspace_id, list_version, statement_text, declared_by_user_id, declared_by_role) VALUES ($1::uuid, '2026-10', 'Autorizzazione di prova', $2::uuid, 'function_lead')`,
    [ids.ws, ids.builder],
  );
  ok(await referents.prepareReferentQuestions(as("builder"), ids.useCase));
  state.needs = await needIds();
  const sent = ok(await referents.sendReferentRequest(as("builder"), ids.useCase, { contact: { kind: "nuovo", displayName: "Mario Rossi", email: REFERENT_EMAIL }, needIds: state.needs.slice(0, 2), message: "Messaggio di prova" }, { env: ENV, requester: requester("builder") }));
  state.requestId = sent.requestId;
  const mailer = fakeMailer();
  await dispatch.dispatchReferentEmails({ requestId: sent.requestId, env: ENV, mailer, sendIntervalMs: 0 });
  state.token = tokenOf(mailer.outbox[0]) ?? "";
  state.contactId = String((await q(`SELECT contact_id FROM use_case_referent_requests WHERE id = $1::uuid`, [sent.requestId]))[0].contact_id);
  const resolved = await pub.resolveReferentToken(state.token, new Date());
  assert.ok(resolved.access === "ok");
  if (resolved.access !== "ok") return;
  assert.ok((await pub.acceptReferentPrivacy(resolved.link, { version: "ucq-2026-10-1" }, new Date())).ok);
  const link = await pub.resolveReferentToken(state.token, new Date());
  if (link.access !== "ok") return assert.fail("link");
  assert.ok((await pub.saveReferentDraft(link.link, { needId: state.needs[0], text: "Circa 20 al giorno", dontKnow: false }, new Date())).ok);
  assert.ok((await pub.submitReferentAnswers(link.link, { needIds: [state.needs[0]] }, new Date())).ok);
  assert.ok((await pub.saveReferentDraft(link.link, { needId: state.needs[1], text: "Bozza", dontKnow: false }, new Date())).ok);
});

test("a secco: il piano, nessuna scrittura; nessun nome, email o testo nell'uscita", opts, async () => {
  const { command } = await import("../../../../scripts/use-case-admin/erase-referent.ts");
  const printed: unknown[] = [];
  const outcome = await command.run(adminCtx(false, state.contactId, printed) as never);
  assert.equal(outcome.exitCode, 0);
  assert.equal((outcome.output as { status: string }).status, "DRY_RUN");
  assert.equal((outcome.output as unknown as { useCase: number }).useCase, 1);
  const text = JSON.stringify(outcome.output);
  for (const secret of [REFERENT_EMAIL, "Mario Rossi", "Circa 20", "Messaggio di prova"]) assert.ok(!text.includes(secret), secret);
  const [answer] = await q(`SELECT body FROM use_case_need_answers WHERE request_id = $1::uuid AND status = 'inviata'`, [state.requestId]);
  assert.equal(answer.body, "Circa 20 al giorno", "niente scritto");
});

test("con --apply: lo stesso risultato della scheda, in una transazione; poi niente da fare", opts, async () => {
  const { command } = await import("../../../../scripts/use-case-admin/erase-referent.ts");
  const printed: unknown[] = [];
  const outcome = await command.run(adminCtx(true, state.contactId, printed) as never);
  assert.equal((outcome.output as { status: string }).status, "APPLIED", JSON.stringify(outcome.output));
  assert.equal((printed[0] as { status: string }).status, "PLAN");
  const [r] = await q(`SELECT status, revoked_reason, message, purged_at FROM use_case_referent_requests WHERE id = $1::uuid`, [state.requestId]);
  assert.deepEqual([r.status, r.revoked_reason, r.message], ["revocata", "cancellazione", null]);
  assert.ok(r.purged_at);
  const answers = await q(`SELECT body, status FROM use_case_need_answers WHERE request_id = $1::uuid`, [state.requestId]);
  assert.ok(answers.every((a) => a.body === null));
  assert.equal(answers.filter((a) => a.status === "bozza").length, 0, "le bozze si cancellano");
  assert.equal(await statusOf(state.needs[1]), "da_chiedere", "la domanda aperta torna da chiedere");
  assert.equal(await statusOf(state.needs[0]), "in_verifica", "la risposta già data resta come stato");
  const [c] = await q(`SELECT anonymized_at FROM uc_contacts WHERE id = $1::uuid`, [state.contactId]);
  assert.ok(c.anonymized_at, "solo dell'hub: anonimizzato");
  assert.equal((await pub.resolveReferentToken(state.token, new Date())).access, "non_valido");
  const history = await q(`SELECT actor_kind, channel FROM use_case_events WHERE use_case_id = $1::uuid AND phase_after = 'dati_cancellati'`, [ids.useCase]);
  assert.deepEqual(history.map((h) => [h.actor_kind, h.channel]), [["sistema", "altro"]]);
  const again = await command.run(adminCtx(true, state.contactId, []) as never);
  assert.ok(["NOTHING_TO_DO", "APPLIED"].includes((again.output as { status: string }).status));
  assert.equal((await q(`SELECT 1 FROM use_case_events WHERE use_case_id = $1::uuid AND phase_after = 'dati_cancellati'`, [ids.useCase])).length, 1, "una seconda volta non scrive righe nuove");
});

test("argomenti: --workspace e --contact uuid", opts, async () => {
  const { command } = await import("../../../../scripts/use-case-admin/erase-referent.ts");
  await assert.rejects(command.run(adminCtx(false, "mario@example.com", []) as never), /--contact/);
  await assert.rejects(command.run({ ...adminCtx(false, state.contactId, []), scope: { kind: "all" } } as never), /--workspace/);
  await assert.rejects(command.run(adminCtx(false, randomUUID(), []) as never), /non trovato/);
});

// Gli aiuti di prova comuni alle suite di «Chiedi al referente»: questa non li usa tutti.
void (() => [refused, useCaseSnapshot]);
