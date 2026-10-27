import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { isWorkingDay, romeDate, romeLocalToUtc, workingDaysBetween } from "../../uc/calendar.ts";

// Ruoli che si sovrappongono (SPEC Parte 3, §P3.9) sul database di prova, una persona per caso:
// - corsista e referente (ruolo learner), contributore e referente, revisore e referente (Federico,
//   function_lead), chi chiede a se stesso, revisore iscritto anche a un corso (Claudio), e un
//   referente senza account (Mario);
// - che cosa vede ciascuno nel pannello della scheda e in «Raccolta informazioni», nella pagina
//   pubblica, nella campanella e nelle email; che una risposta del team dalla scheda ferma i promemoria
//   di quella domanda e chiude la richiesta quando non resta niente.
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su
//   127.0.0.1). Dati sintetici, creati e cancellati qui. Nessuna email vera: un mailer finto.
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
type Notifications = typeof import("../../db/queries/use-case-notifications.ts");
type Progress = typeof import("../../db/queries/use-case-info-progress.ts");
type BellData = typeof import("../../notifications/bell-data.ts");
type Ctx = import("../service.ts").WriteContext;
type Mail = import("../../uc/notify/dispatch.ts").OutgoingEmail;

let referents: Referents;
let pub: Public;
let dispatch: Dispatch;
let notifications: Notifications;
let progress: Progress;
let bell: BellData;
let q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

const suffix = randomBytes(3).toString("hex");
const ids = {
  org: randomUUID(),
  ws: randomUUID(),
  builder: randomUUID(),
  claudio: randomUUID(),
  federico: randomUUID(),
  corsista: randomUUID(),
  contrib: randomUUID(),
  program: randomUUID(),
};
type Person = "builder" | "claudio" | "federico" | "corsista" | "contrib";
const PEOPLE: Person[] = ["builder", "claudio", "federico", "corsista", "contrib"];
const ROLE: Record<Person, string> = { builder: "function_lead", claudio: "function_lead", federico: "function_lead", corsista: "learner", contrib: "contributor" };
const emails: Record<Person, string> = {
  builder: `giulia.builder.${suffix}@topjet.test`,
  claudio: `claudio.${suffix}@topjet.test`,
  federico: `federico.${suffix}@topjet.test`,
  corsista: `corsista.${suffix}@topjet.test`,
  contrib: `contrib.${suffix}@topjet.test`,
};
const MARIO = `mario.rossi.${suffix}@topjet.test`;
const COURSE_TITLE = `Corso AI generativa ${suffix}`;
const contacts = { builder: randomUUID(), claudio: randomUUID(), federico: randomUUID(), corsista: randomUUID(), contrib: randomUUID(), mario: randomUUID() };
const cards = {
  fed: randomUUID(),
  learner: randomUUID(),
  contrib: randomUUID(),
  mario: randomUUID(),
  self: randomUUID(),
  recheck: randomUUID(),
  // D-B21 e D-B24 (decisioni del proprietario, 27/10).
  silent: randomUUID(),
  expired: randomUUID(),
  late: randomUUID(),
  late2: randomUUID(),
};
const LATE = { link: randomUUID(), email: randomUUID() };
const LATE_EMAILS = { link: `ritardo.${suffix}@topjet.test`, email: `ritardo.due.${suffix}@topjet.test` };
const storageDir = mkdtempSync(join(tmpdir(), "referenti-ruoli-"));

const ENV = {
  USE_CASE_HUB_WORKSPACES: "",
  UC_LS_EMAIL_DOMAINS: "ls.test",
  RESEND_API_KEY: "re_test_finto",
  UC_EMAIL_FROM: "Lateral Space via Unbundle <test@example.test>",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  UC_LOCAL_STORAGE_DIR: storageDir,
} as Record<string, string | undefined>;
const ENV_KEYS = ["USE_CASE_HUB_WORKSPACES", "UC_LS_EMAIL_DOMAINS", "UC_ENABLED", "UC_WORKSPACE_IDS", "USE_CASE_REFERENTS", "NEXT_PUBLIC_APP_URL"] as const;
const envBefore = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function as(person: Person): Ctx {
  return { workspaceId: ids.ws, actor: { userId: ids[person], role: ROLE[person], isLateralSpace: false, kind: "persona" }, channel: "pagina" };
}
const requester = (person: Person) => ({ name: `Persona ${person}`, emailVerified: true });
const viewer = (person: Person, role = ROLE[person]) => ({ userId: ids[person], email: emails[person], emailVerified: true, role, isLateralSpace: false });

function ok<T>(result: { ok: true; value: T } | { ok: false; error: string; message: string }, label = "esito"): T {
  if (!result.ok) assert.fail(`${label}: atteso ok, ricevuto ${result.error} (${result.message})`);
  return result.value;
}
function fakeMailer() {
  const outbox: Mail[] = [];
  return { outbox, async send(m: Mail) { outbox.push(m); return { ok: true as const }; } };
}
const tokenOf = (m: Mail) => /\/rispondi\/(ucq_[A-Za-z0-9_-]{32})/.exec(m.text)?.[1] ?? null;
const cardUrl = (card: string) => `http://localhost:3000/dashboard/${ids.ws}/use-cases/${card}?capitolo=cosa-serve`;
const TEAM_LINE = "Hai già accesso a Unbundle: puoi rispondere anche dalla scheda.";

/** Un giorno lavorativo alle 10 di Roma, non dopo adesso. */
function virtualNow(): Date {
  let day = romeDate(new Date());
  for (let i = 0; i < 20; i++) {
    const at = romeLocalToUtc(day, 10);
    if (isWorkingDay(day) && at.getTime() <= Date.now()) return at;
    const d = new Date(`${day}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    day = d.toISOString().slice(0, 10);
  }
  throw new Error("nessun giorno lavorativo");
}
function workingDaysBefore(to: Date, n: number): Date {
  let day = romeDate(to);
  for (let i = 0; i < 60; i++) {
    const d = new Date(`${day}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    day = d.toISOString().slice(0, 10);
    if (isWorkingDay(day) && workingDaysBetween(day, to) === n) return romeLocalToUtc(day, 10);
  }
  throw new Error("giorno non trovato");
}
const V = virtualNow();

async function needsOf(card: string): Promise<string[]> {
  const rows = await q(`SELECT n.id::text AS id FROM use_case_needs n JOIN use_case_need_links l ON l.need_id = n.id WHERE l.use_case_id = $1::uuid ORDER BY n.sort_order, n.id`, [card]);
  return rows.map((r) => String(r.id));
}
async function statusOf(needId: string): Promise<string> {
  return String((await q(`SELECT status FROM use_case_needs WHERE id = $1::uuid`, [needId]))[0]?.status);
}
async function setRole(person: Person, role: string) {
  await q(`UPDATE workspace_memberships SET role = $3::member_role WHERE workspace_id = $1::uuid AND user_id = $2::uuid`, [ids.ws, ids[person], role]);
}

async function panelFor(person: Person, card: string, role = ROLE[person]) {
  const base = await import("../../db/queries/use-case-referent-base.ts");
  const { getAppUcExecutor } = await import("../../db/uc-executor.ts");
  const all = await base.readCardNeeds(await getAppUcExecutor(), ids.ws, card);
  return referents.loadUseCaseReferentPanel({
    workspaceId: ids.ws,
    useCaseId: card,
    viewer: viewer(person, role),
    session: { id: ids[person], name: `Persona ${person}`, email: emails[person], emailVerified: true },
    role,
    needs: { requirements: all.filter((n) => n.type === "requisito"), steps: [], linkable: [] },
    env: ENV,
  });
}

/** Una richiesta a un contatto esistente, l'email partita con il mailer finto: id, email e token. */
async function ask(by: Person, card: string, contactId: string, needIds: string[]) {
  const sent = ok(await referents.sendReferentRequest(as(by), card, { contact: { kind: "esistente", contactId }, needIds }, { env: ENV, requester: requester(by) }), `invio di ${by}`);
  const mailer = fakeMailer();
  await dispatch.dispatchReferentEmails({ requestId: sent.requestId, env: ENV, mailer, sendIntervalMs: 0 });
  assert.equal(mailer.outbox.length, 1, "un'email");
  const mail = mailer.outbox[0];
  return { requestId: sent.requestId, mail, token: tokenOf(mail) ?? "" };
}

/** Il referente risponde dal link (informativa, bozza, invio) all'istante V. */
async function answerByLink(token: string, needId: string, text: string) {
  const first = await pub.resolveReferentToken(token, V);
  assert.equal(first.access, "ok");
  if (first.access !== "ok") return;
  assert.ok((await pub.acceptReferentPrivacy(first.link, { version: "ucq-2026-10-1" }, V)).ok);
  const resolved = await pub.resolveReferentToken(token, V);
  if (resolved.access !== "ok") assert.fail("link");
  assert.ok((await pub.saveReferentDraft(resolved.link, { needId, text, dontKnow: false }, V)).ok, "bozza");
  const submitted = await pub.submitReferentAnswers(resolved.link, {}, V);
  assert.ok(submitted.ok, JSON.stringify(submitted));
}

async function bellRows(card: string, kind = "risposte") {
  return q(`SELECT recipient_user_id::text AS who FROM use_case_notifications WHERE use_case_id = $1::uuid AND kind = $2 ORDER BY recipient_user_id`, [card, kind]);
}
const sorted = (...people: Person[]) => people.map((p) => ids[p]).sort();

before(async () => {
  if (!enabled) return;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Record<string, unknown>[]>;
  ENV.USE_CASE_HUB_WORKSPACES = ids.ws;
  process.env.USE_CASE_HUB_WORKSPACES = ids.ws;
  process.env.UC_LS_EMAIL_DOMAINS = "ls.test";
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
  delete process.env.UC_ENABLED;
  delete process.env.UC_WORKSPACE_IDS;
  delete process.env.USE_CASE_REFERENTS;
  referents = await import("../../db/queries/use-case-referents.ts");
  pub = await import("../../db/queries/use-case-referent-public.ts");
  dispatch = await import("../../db/queries/use-case-referent-dispatch.ts");
  notifications = await import("../../db/queries/use-case-notifications.ts");
  progress = await import("../../db/queries/use-case-info-progress.ts");
  bell = await import("../../notifications/bell-data.ts");

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Organizzazione ruoli', $2)`, [ids.org, `hub-ruoli-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $2::uuid, 'TopJet ruoli')`, [ids.ws, ids.org]);
  for (const person of PEOPLE) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1::uuid, $2, $3, now())`, [ids[person], emails[person], `Persona ${person}`]);
    await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [ids.ws, ids[person], ROLE[person]]);
  }
  for (const [code, card] of Object.entries(cards)) {
    await q(
      `INSERT INTO use_cases (id, workspace_id, title, description, status, portfolio_review_status, portfolio_kind, code, source)
       VALUES ($1::uuid, $2::uuid, $3, 'Problema di prova', 'accepted', 'scored', 'use_case_ai', $4, 'web_proposed')`,
      [card, ids.ws, `Scheda ${code}`, `RR-${String(1000 + Math.floor(Math.random() * 8000))}`],
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
  await q(`DELETE FROM learning_enrollments WHERE workspace_id = $1::uuid`, [ids.ws]);
  await q(`DELETE FROM uc_contacts WHERE workspace_id = $1::uuid`, [ids.ws]);
  await q(`DELETE FROM workspaces WHERE id = $1::uuid`, [ids.ws]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [PEOPLE.map((p) => ids[p])]);
});

test("preparazione: autorizzazione, schede con le domande, referenti, il corso di Claudio", opts, async () => {
  await q(
    `INSERT INTO uc_subprocessor_acks (workspace_id, list_version, statement_text, declared_by_user_id, declared_by_role) VALUES ($1::uuid, '2026-10', 'Autorizzazione di prova', $2::uuid, 'function_lead')`,
    [ids.ws, ids.builder],
  );
  for (const card of Object.values(cards)) ok(await referents.prepareReferentQuestions(as("builder"), card), "Prepara");
  // I referenti: lo stesso elenco dei dossier. Claudio collegato al suo account, gli altri solo per email.
  for (const person of PEOPLE) {
    await q(`INSERT INTO uc_contacts (id, workspace_id, display_name, email, user_id) VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid)`, [
      contacts[person],
      ids.ws,
      `Persona ${person}`,
      emails[person],
      person === "claudio" ? ids.claudio : null,
    ]);
  }
  await q(`INSERT INTO uc_contacts (id, workspace_id, display_name, email) VALUES ($1::uuid, $2::uuid, 'Mario Rossi', $3)`, [contacts.mario, ids.ws, MARIO]);
  // Claudio è revisore e partecipa anche al corso.
  await q(
    `INSERT INTO learning_programs (id, workspace_id, family_key, title, content_version, pack_hash, private_pack, visibility_policy, retention_days, published_by)
     VALUES ($1::uuid, $2::uuid, 'ai-generativa', $3, 'v1', $4, '{}'::jsonb, 'solo-partecipante', 365, $5::uuid)`,
    [ids.program, ids.ws, COURSE_TITLE, "a".repeat(64), ids.builder],
  );
  await q(
    `INSERT INTO learning_sessions (workspace_id, program_id, module_id, cohort_id, starts_at, ends_at) VALUES ($1::uuid, $2::uuid, 'm1', 'c1', now(), now() + interval '2 hours')`,
    [ids.ws, ids.program],
  );
  for (const person of ["claudio", "corsista"] as const) {
    await q(`INSERT INTO learning_enrollments (workspace_id, program_id, user_id, module_id, cohort_id) VALUES ($1::uuid, $2::uuid, $3::uuid, 'm1', 'c1')`, [ids.ws, ids.program, ids[person]]);
  }
});

test("scheda: vede solo chi ha il ruolo da revisore; il referente non dà accesso; nessun segno dei corsi", opts, async () => {
  // Corsista e contributore, anche se sono referenti: niente «Cosa serve», niente referenti, niente avanzamento.
  for (const person of ["corsista", "contrib"] as const) {
    assert.equal(await panelFor(person, cards.fed), null, person);
    assert.equal(await progress.listInfoProgress(ids.ws, viewer(person)), null, person);
  }
  const forBuilder = await panelFor("builder", cards.fed);
  assert.ok(forBuilder?.available);
  const option = (panel: typeof forBuilder, contactId: string) => panel!.contacts.find((c) => c.id === contactId)!;
  assert.deepEqual([option(forBuilder, contacts.federico).team, option(forBuilder, contacts.federico).selectable], [true, true], "un revisore si può scegliere, «Fa parte del team»");
  assert.equal(option(forBuilder, contacts.claudio).team, true, "collegato al suo account");
  for (const c of [contacts.corsista, contacts.contrib, contacts.mario]) assert.deepEqual([option(forBuilder, c).team, option(forBuilder, c).selectable], [false, true]);
  assert.deepEqual([option(forBuilder, contacts.builder).reason, option(forBuilder, contacts.builder).selectable], ["sei_tu", false], "chi guarda non chiede a se stesso");
  // Claudio, revisore iscritto al corso: vede tutto quello che vede un revisore, e niente del corso.
  const forClaudio = await panelFor("claudio", cards.fed);
  assert.ok(forClaudio?.available);
  assert.deepEqual([option(forClaudio, contacts.builder).reason, option(forClaudio, contacts.builder).team], [null, true]);
  assert.equal(option(forClaudio, contacts.claudio).reason, "sei_tu");
  const json = JSON.stringify([forClaudio, forBuilder, await progress.listInfoProgress(ids.ws, viewer("claudio"))]);
  for (const word of [COURSE_TITLE, "learning", "Formazione", ids.program]) assert.ok(!json.includes(word), word);
  assert.ok(await progress.listInfoProgress(ids.ws, viewer("claudio")));
});

test("chiedere a se stesso: niente email, risponde dalla scheda; chiedere a un altro revisore si può", opts, async () => {
  const [n0] = await needsOf(cards.self);
  const own = await referents.sendReferentRequest(as("builder"), cards.self, { contact: { kind: "esistente", contactId: contacts.builder }, needIds: [n0] }, { env: ENV, requester: requester("builder") });
  assert.equal(own.ok, false);
  if (!own.ok) assert.equal(own.error, "referente_sei_tu");
  const fresh = await referents.sendReferentRequest(
    as("claudio"),
    cards.self,
    { contact: { kind: "nuovo", displayName: "Claudio di nuovo", email: ` ${emails.claudio.toUpperCase()} ` }, needIds: [n0] },
    { env: ENV, requester: requester("claudio") },
  );
  assert.equal(fresh.ok, false);
  if (!fresh.ok) {
    assert.equal(fresh.error, "referente_sei_tu");
    assert.match(fresh.fieldErrors?.email ?? "", /Cosa serve/);
  }
  assert.equal((await q(`SELECT 1 FROM use_case_referent_requests WHERE use_case_id = $1::uuid`, [cards.self])).length, 0, "nessuna richiesta");
  assert.equal((await q(`SELECT 1 FROM use_case_referent_emails WHERE workspace_id = $1::uuid`, [ids.ws])).length, 0, "nessuna email in coda");
  assert.equal(await statusOf(n0), "da_chiedere");
});

const flow = { fed: { requestId: "", token: "" }, learner: { requestId: "", token: "" }, contrib: { requestId: "", token: "" }, self: { requestId: "", token: "" }, mario: { requestId: "", token: "" } };

test("email al referente: il link alla scheda solo a un revisore con l'email verificata, ricontrollato a ogni invio", opts, async () => {
  const fed = await ask("builder", cards.fed, contacts.federico, (await needsOf(cards.fed)).slice(0, 2));
  flow.fed = { requestId: fed.requestId, token: fed.token };
  assert.equal(fed.mail.to, emails.federico);
  assert.ok(fed.mail.text.includes(`/rispondi/${fed.token}`), "il link personale resta");
  assert.ok(fed.mail.text.includes(TEAM_LINE));
  assert.ok(fed.mail.text.includes(cardUrl(cards.fed)));
  for (const [key, contactId] of [["learner", contacts.corsista], ["contrib", contacts.contrib]] as const) {
    const sent = await ask("builder", cards[key], contactId, (await needsOf(cards[key])).slice(0, 2));
    flow[key] = { requestId: sent.requestId, token: sent.token };
    assert.ok(!sent.mail.text.includes("/dashboard/"), `${key}: nessun link alla dashboard`);
    assert.ok(!sent.mail.text.includes(TEAM_LINE), key);
    assert.ok(!sent.mail.html.includes("/dashboard/"), key);
  }
  const mario = await ask("claudio", cards.mario, contacts.mario, (await needsOf(cards.mario)).slice(0, 2));
  flow.mario = { requestId: mario.requestId, token: mario.token };
  assert.ok(!mario.mail.text.includes("/dashboard/"), "senza account: nessun link alla dashboard");
  // Claudio chiede a Giulia (un'altra revisore): si può, e la sua email ha il link alla scheda.
  const self = await ask("claudio", cards.self, contacts.builder, (await needsOf(cards.self)).slice(0, 1));
  flow.self = { requestId: self.requestId, token: self.token };
  assert.ok(self.mail.text.includes(cardUrl(cards.self)));
  // Federico non è più revisore: la prossima email non ha più la riga, il selettore non dice più «Fa parte del team».
  await setRole("federico", "contributor");
  try {
    const later = await ask("builder", cards.recheck, contacts.federico, (await needsOf(cards.recheck)).slice(0, 1));
    assert.ok(!later.mail.text.includes("/dashboard/"));
    assert.ok(!later.mail.text.includes(TEAM_LINE));
    const panel = await panelFor("builder", cards.recheck);
    assert.equal(panel!.contacts.find((c) => c.id === contacts.federico)!.team, false);
  } finally {
    await setRole("federico", "function_lead");
  }
  // Un'email non verificata non porta il link nemmeno a un revisore.
  await q(`UPDATE users SET email_verified = NULL WHERE id = $1::uuid`, [ids.federico]);
  try {
    const { getAppUcExecutor } = await import("../../db/uc-executor.ts");
    const base = await import("../../db/queries/use-case-referent-base.ts");
    const person = await base.readReferentPerson(await getAppUcExecutor(), ids.ws, contacts.federico);
    assert.deepEqual(person, { userId: null, reviewer: false, teamAccess: false }, "senza email verificata il contatto non porta all'account");
  } finally {
    await q(`UPDATE users SET email_verified = now() WHERE id = $1::uuid`, [ids.federico]);
  }
});

test("la pagina pubblica è la stessa per tutti: nessuna sessione, nessun rimando alla dashboard", opts, async () => {
  for (const key of ["fed", "learner", "contrib", "mario"] as const) {
    const page = await pub.loadReferentAskPage(flow[key].token, { env: ENV, now: new Date() });
    assert.equal(page.access, "ok", key);
    if (page.access !== "ok") continue;
    assert.equal(page.view.state, "aperta");
    assert.ok(!JSON.stringify(page.view).includes("/dashboard/"), key);
  }
});

test("risposte dal link: chi risponde non riceve la notifica di quello che ha fatto; corsisti e contributori mai", opts, async () => {
  const [fed0] = await needsOf(cards.fed);
  await answerByLink(flow.fed.token, fed0, "Circa venti volte al giorno.");
  assert.deepEqual((await bellRows(cards.fed)).map((r) => r.who), sorted("builder", "claudio"), "Federico ha risposto: non riceve la sua notifica");
  const [l0] = await needsOf(cards.learner);
  await answerByLink(flow.learner.token, l0, "Una volta alla settimana.");
  assert.deepEqual((await bellRows(cards.learner)).map((r) => r.who), sorted("builder", "claudio", "federico"));
  const [c0] = await needsOf(cards.contrib);
  await answerByLink(flow.contrib.token, c0, "Due ore ogni volta.");
  assert.deepEqual((await bellRows(cards.contrib)).map((r) => r.who), sorted("builder", "claudio", "federico"));
  // Giulia, revisora e referente di Claudio, risponde dal link: Claudio e Federico sì, lei no.
  const [s0] = await needsOf(cards.self);
  await answerByLink(flow.self.token, s0, "Lo facciamo in tre.");
  assert.deepEqual((await bellRows(cards.self)).map((r) => r.who), sorted("claudio", "federico"));
  // Nessuna riga della campanella né email a chi chiede per corsisti e contributori, in nessun caso.
  const never = [ids.corsista, ids.contrib];
  assert.equal((await q(`SELECT 1 FROM use_case_notifications WHERE recipient_user_id = ANY($1::uuid[])`, [never])).length, 0);
  assert.equal((await q(`SELECT 1 FROM use_case_requester_emails WHERE recipient_user_id = ANY($1::uuid[])`, [never])).length, 0);
  // La campanella: con il ruolo di adesso.
  const payload = (person: Person, role = ROLE[person]) => bell.loadBellPayload({ workspaceId: ids.ws, userId: ids[person], role, useCaseHub: true, env: ENV });
  for (const person of ["corsista", "contrib"] as const) assert.equal((await payload(person)).entries.filter((e) => e.source === "use_case").length, 0, person);
  const fedBell = (await payload("federico")).entries.filter((e) => e.source === "use_case").map((e) => e.href ?? "");
  assert.ok(fedBell.some((h) => h.includes(cards.learner)) && fedBell.some((h) => h.includes(cards.contrib)));
  assert.ok(!fedBell.some((h) => h.includes(cards.fed)), "la sua risposta non gli torna nella campanella");
  const claudioBell = (await payload("claudio")).entries.filter((e) => e.source === "use_case");
  assert.ok(claudioBell.length >= 4, "il revisore iscritto al corso riceve tutto come gli altri revisori");
  assert.ok(!JSON.stringify(claudioBell).includes(COURSE_TITLE));
});

test("email a chi ha chiesto: solo a chi è ancora revisore, mai a chi ha risposto", opts, async () => {
  // Giulia ha chiesto a Federico: le arriva l'avviso, senza il nome o l'email di Federico.
  const mailer = fakeMailer();
  await notifications.dispatchRequesterAlerts({ recipientUserId: ids.builder, env: ENV, now: V, mailer, sendIntervalMs: 0 });
  const toBuilder = mailer.outbox.filter((m) => m.to === emails.builder);
  assert.equal(toBuilder.length, 1);
  assert.ok(toBuilder[0].text.includes(cardUrl(cards.fed)));
  for (const leak of [emails.federico, "Persona federico", "Circa venti volte"]) assert.ok(!toBuilder[0].text.includes(leak), leak);
  // Giulia ha risposto a Claudio dal link: l'avviso è per Claudio, non per lei (nessun avviso del suo gesto).
  const self = await q(`SELECT e.recipient_user_id::text AS who FROM use_case_requester_email_items i JOIN use_case_requester_emails e ON e.id = i.email_id WHERE i.request_id = $1::uuid`, [flow.self.requestId]);
  assert.deepEqual(self.map((r) => r.who), [ids.claudio]);
  // Claudio non è più revisore (resta solo nel corso): l'avviso non parte.
  await setRole("claudio", "learner");
  try {
    const m2 = fakeMailer();
    const summary = await notifications.dispatchRequesterAlerts({ recipientUserId: ids.claudio, env: ENV, now: V, mailer: m2, sendIntervalMs: 0 });
    assert.equal(m2.outbox.length, 0, JSON.stringify(summary));
    const [row] = await q(`SELECT status, cancel_reason FROM use_case_requester_emails WHERE recipient_user_id = $1::uuid AND workspace_id = $2::uuid`, [ids.claudio, ids.ws]);
    assert.deepEqual([row?.status, row?.cancel_reason], ["annullata", "destinatario_non_valido"]);
    const asLearner = await bell.loadBellPayload({ workspaceId: ids.ws, userId: ids.claudio, role: "learner", useCaseHub: true, env: ENV });
    assert.equal(asLearner.entries.filter((e) => e.source === "use_case").length, 0, "come corsista non vede le righe degli use case");
    assert.equal(await panelFor("claudio", cards.mario, "learner"), null);
  } finally {
    await setRole("claudio", "function_lead");
  }
});

test("le due strade si incontrano: una risposta dalla scheda ferma il promemoria di quella domanda e chiude la richiesta", opts, async () => {
  const [m0, m1] = await needsOf(cards.mario);
  assert.deepEqual([await statusOf(m0), await statusOf(m1)], ["chiesta", "chiesta"]);
  // Federico (revisore) risponde dalla scheda alla prima domanda.
  ok(await referents.addReviewerAnswer(as("federico"), cards.mario, m0, { text: "Trenta al mese, lo sappiamo noi." }), "risposta del team");
  assert.equal(await statusOf(m0), "in_verifica");
  let [req] = await q(`SELECT status FROM use_case_referent_requests WHERE id = $1::uuid`, [flow.mario.requestId]);
  assert.equal(req.status, "inviata", "resta una domanda");
  // La pagina di Mario: la prima «gestita», senza il testo del team; la seconda aperta.
  let page = await pub.loadReferentAskPage(flow.mario.token, { env: ENV, now: new Date() });
  if (page.access !== "ok") assert.fail(page.access);
  const first = page.view.questions.find((x) => x.needId === m0)!;
  assert.deepEqual([first.state, first.draft, first.answer, first.files.length], ["gestita", null, null, 0]);
  assert.equal(page.view.questions.find((x) => x.needId === m1)?.state, "aperta");
  assert.ok(!JSON.stringify(page.view).includes("Trenta al mese"));
  // Il promemoria del terzo giorno conta solo la domanda rimasta.
  const sent = workingDaysBefore(V, 3);
  await q(
    `UPDATE use_case_referent_requests SET created_at = $2::timestamptz - interval '1 minute', sent_at = $2::timestamptz, last_email_at = $2::timestamptz, expires_at = $2::timestamptz + interval '30 days' WHERE id = $1::uuid`,
    [flow.mario.requestId, sent.toISOString()],
  );
  await q(`UPDATE use_case_referent_emails SET sent_at = $2::timestamptz, created_at = $2::timestamptz, due_at = $2::timestamptz, scheduled_at = $2::timestamptz WHERE request_id = $1::uuid`, [flow.mario.requestId, sent.toISOString()]);
  const mailer = fakeMailer();
  const counts = await referents.runReferentCron({ env: ENV, now: V, mailer });
  assert.equal(counts.errors, 0, JSON.stringify(counts));
  const toMario = mailer.outbox.filter((m) => m.to === MARIO);
  assert.equal(toMario.length, 1, JSON.stringify(counts));
  assert.match(toMario[0].subject, /^Promemoria: una domanda aperta su «/);
  // Anche la seconda dalla scheda: niente resta, la richiesta si chiude subito.
  ok(await referents.addReviewerAnswer(as("builder"), cards.mario, m1, { text: "Usano il gestionale e Excel." }), "seconda risposta del team");
  [req] = await q(`SELECT status, completed_at FROM use_case_referent_requests WHERE id = $1::uuid`, [flow.mario.requestId]);
  assert.equal(req.status, "completata");
  assert.ok(req.completed_at);
  const history = await q(`SELECT phase_after, actor_kind FROM use_case_events WHERE use_case_id = $1::uuid AND fields @> ARRAY['richiesta_referente']::text[] ORDER BY at, id`, [cards.mario]);
  assert.ok(history.some((h) => h.phase_after === "completata" && h.actor_kind === "sistema"));
  assert.equal(
    (await q(`SELECT 1 FROM use_case_referent_emails e WHERE e.workspace_id = $1::uuid AND e.status IN ('in_coda', 'errore') AND (e.request_id = $2::uuid OR e.id IN (SELECT email_id FROM use_case_referent_email_items WHERE request_id = $2::uuid AND state = 'in_coda'))`, [ids.ws, flow.mario.requestId])).length,
    0,
    "niente in coda per Mario",
  );
  page = await pub.loadReferentAskPage(flow.mario.token, { env: ENV, now: new Date() });
  if (page.access !== "ok") assert.fail(page.access);
  assert.equal(page.view.state, "vuota", "Mario non ha risposto a niente: non «Hai risposto a tutte le domande»");
  assert.ok(page.view.questions.every((x) => x.state === "gestita"));
  // L'ultimo promemoria non parte: la richiesta è chiusa.
  await q(`UPDATE use_case_referent_requests SET sent_at = $2::timestamptz, last_email_at = $3::timestamptz, reminder_count = 1 WHERE id = $1::uuid`, [
    flow.mario.requestId,
    workingDaysBefore(V, 7).toISOString(),
    workingDaysBefore(V, 4).toISOString(),
  ]);
  const later = fakeMailer();
  await referents.runReferentCron({ env: ENV, now: V, mailer: later });
  assert.equal(later.outbox.filter((m) => m.to === MARIO).length, 0);
  // Le risposte del team non sono una notifica «Risposte arrivate»: nessun doppio conteggio.
  assert.equal((await q(`SELECT 1 FROM use_case_notifications WHERE use_case_id = $1::uuid AND kind = 'risposte'`, [cards.mario])).length, 0);
  // Il link resta in sola lettura: niente da inviare.
  const resolved = await pub.resolveReferentToken(flow.mario.token, new Date());
  if (resolved.access !== "ok") assert.fail(resolved.access);
  const late = await pub.saveReferentDraft(resolved.link, { needId: m1, text: "x", dontKnow: false }, new Date());
  assert.equal(late.ok, false);
});

// ── Decisioni del proprietario, 27/10 ─────────────────────────────────

/** Le righe «Nessuna risposta» di una scheda, con il motivo. */
async function silentRows(card: string) {
  return q(`SELECT recipient_user_id::text AS who, follow_up FROM use_case_notifications WHERE use_case_id = $1::uuid AND kind = 'senza_risposta' ORDER BY recipient_user_id`, [card]);
}
/** Chi riceve un avviso per email su questa richiesta. */
async function alertRecipients(requestId: string) {
  const rows = await q(
    `SELECT e.recipient_user_id::text AS who, i.follow_up FROM use_case_requester_email_items i JOIN use_case_requester_emails e ON e.id = i.email_id WHERE i.request_id = $1::uuid ORDER BY e.recipient_user_id`,
    [requestId],
  );
  return rows.map((r) => ({ who: String(r.who), followUp: r.follow_up === null ? null : String(r.follow_up) }));
}

test("D-B21: dopo l'ultimo promemoria «Nessuna risposta» non arriva al revisore referente; gli altri revisori e chi ha chiesto sì", opts, async () => {
  // Giulia chiede a Federico (revisore): dopo 7 giorni lavorativi parte l'ultimo promemoria.
  const sent = await ask("builder", cards.silent, contacts.federico, (await needsOf(cards.silent)).slice(0, 2));
  await q(
    `UPDATE use_case_referent_requests SET created_at = $2::timestamptz - interval '1 minute', sent_at = $2::timestamptz, last_email_at = $3::timestamptz, reminder_count = 1,
       expires_at = $2::timestamptz + interval '30 days' WHERE id = $1::uuid`,
    [sent.requestId, workingDaysBefore(V, 7).toISOString(), workingDaysBefore(V, 4).toISOString()],
  );
  const mailer = fakeMailer();
  const counts = await referents.runReferentCron({ env: ENV, now: V, mailer });
  assert.equal(counts.errors, 0, JSON.stringify(counts));
  const last = mailer.outbox.filter((m) => m.to === emails.federico);
  assert.equal(last.length, 1, "l'ultimo promemoria parte comunque");
  assert.match(last[0].subject, /^Ultimo promemoria/);
  const [req] = await q(`SELECT reminder_count FROM use_case_referent_requests WHERE id = $1::uuid`, [sent.requestId]);
  assert.equal(Number(req.reminder_count), 2);
  // La campanella: Giulia (chi ha chiesto) e Claudio sì; Federico, che non ha risposto, no.
  const rows = await silentRows(cards.silent);
  assert.deepEqual(rows.map((r) => r.who), sorted("builder", "claudio"));
  assert.ok(rows.every((r) => r.follow_up === "ultimo_promemoria"));
  // L'avviso per email va solo a chi ha chiesto, mai a Federico.
  assert.deepEqual(await alertRecipients(sent.requestId), [{ who: ids.builder, followUp: "ultimo_promemoria" }]);
  const toFederico = await q(`SELECT 1 FROM use_case_requester_emails WHERE recipient_user_id = $1::uuid AND workspace_id = $2::uuid`, [ids.federico, ids.ws]);
  assert.equal(toFederico.length, 0, "nessuna email a chi ha chiesto per Federico");
  // Nella campanella di Federico la riga non c'è; in quella di Claudio sì.
  const fedBell = await bell.loadBellPayload({ workspaceId: ids.ws, userId: ids.federico, role: "function_lead", useCaseHub: true, env: ENV });
  assert.ok(!fedBell.entries.some((e) => e.source === "use_case" && (e.href ?? "").includes(cards.silent)));
  const claudioBell = await bell.loadBellPayload({ workspaceId: ids.ws, userId: ids.claudio, role: "function_lead", useCaseHub: true, env: ENV });
  assert.ok(claudioBell.entries.some((e) => e.source === "use_case" && (e.href ?? "").includes(cards.silent)));
});

test("D-B21: alla scadenza «Nessuna risposta» non arriva al revisore referente (collegato al suo account); gli altri revisori e chi ha chiesto sì", opts, async () => {
  // Giulia chiede a Claudio (contatto collegato al suo account): il link scade senza risposta.
  const sent = await ask("builder", cards.expired, contacts.claudio, (await needsOf(cards.expired)).slice(0, 2));
  await q(`UPDATE use_case_referent_requests SET created_at = now() - interval '31 days', sent_at = now() - interval '31 days', last_email_at = now() - interval '31 days', expires_at = now() - interval '1 minute' WHERE id = $1::uuid`, [sent.requestId]);
  const counts = await referents.runReferentCron({ env: ENV, now: V, mailer: fakeMailer() });
  assert.equal(counts.errors, 0, JSON.stringify(counts));
  const [req] = await q(`SELECT status FROM use_case_referent_requests WHERE id = $1::uuid`, [sent.requestId]);
  assert.equal(req.status, "scaduta");
  const rows = await silentRows(cards.expired);
  assert.deepEqual(rows.map((r) => r.who), sorted("builder", "federico"), "Claudio non riceve la riga della sua richiesta");
  assert.ok(rows.every((r) => r.follow_up === "scaduta"));
  assert.deepEqual(await alertRecipients(sent.requestId), [{ who: ids.builder, followUp: "scaduta" }]);
});

test("D-B24: un contatto collegato più tardi a chi ha chiesto non riceve mai l'email (account o email verificata uguale)", opts, async () => {
  await q(`INSERT INTO uc_contacts (id, workspace_id, display_name, email) VALUES ($1::uuid, $3::uuid, 'Contatto in ritardo', $2)`, [LATE.link, LATE_EMAILS.link, ids.ws]);
  await q(`INSERT INTO uc_contacts (id, workspace_id, display_name, email) VALUES ($1::uuid, $3::uuid, 'Contatto in ritardo due', $2)`, [LATE.email, LATE_EMAILS.email, ids.ws]);
  const first = ok(
    await referents.sendReferentRequest(as("builder"), cards.late, { contact: { kind: "esistente", contactId: LATE.link }, needIds: (await needsOf(cards.late)).slice(0, 1) }, { env: ENV, requester: requester("builder") }),
    "invio (account)",
  );
  const second = ok(
    await referents.sendReferentRequest(as("builder"), cards.late2, { contact: { kind: "esistente", contactId: LATE.email }, needIds: (await needsOf(cards.late2)).slice(0, 1) }, { env: ENV, requester: requester("builder") }),
    "invio (email)",
  );
  // Prima dell'invio dell'email, il primo contatto si collega all'account di Giulia…
  await q(`UPDATE uc_contacts SET user_id = $2::uuid WHERE id = $1::uuid`, [LATE.link, ids.builder]);
  const m1 = fakeMailer();
  await dispatch.dispatchReferentEmails({ requestId: first.requestId, env: ENV, mailer: m1, sendIntervalMs: 0 });
  assert.equal(m1.outbox.length, 0, "nessuna email a se stessi");
  const [row1] = await q(`SELECT status, cancel_reason, token_id FROM use_case_referent_emails WHERE request_id = $1::uuid AND template = 'richiesta'`, [first.requestId]);
  assert.deepEqual([row1.status, row1.cancel_reason, row1.token_id], ["annullata", "referente_sei_tu", null]);
  assert.equal((await q(`SELECT 1 FROM use_case_referent_tokens WHERE request_id = $1::uuid`, [first.requestId])).length, 0, "nessun link emesso");
  // …e l'email verificata di Giulia diventa quella del secondo contatto.
  await q(`UPDATE users SET email = $2 WHERE id = $1::uuid`, [ids.builder, LATE_EMAILS.email]);
  try {
    const m2 = fakeMailer();
    await dispatch.dispatchReferentEmails({ requestId: second.requestId, env: ENV, mailer: m2, sendIntervalMs: 0 });
    assert.equal(m2.outbox.length, 0, "nessuna email a se stessi (stessa email verificata)");
    const [row2] = await q(`SELECT status, cancel_reason FROM use_case_referent_emails WHERE request_id = $1::uuid AND template = 'richiesta'`, [second.requestId]);
    assert.deepEqual([row2.status, row2.cancel_reason], ["annullata", "referente_sei_tu"]);
  } finally {
    await q(`UPDATE users SET email = $2 WHERE id = $1::uuid`, [ids.builder, emails.builder]);
  }
  // Il link scade senza risposta: «Nessuna risposta» va agli altri revisori, non a Giulia (referente e
  // richiedente insieme), e nessun avviso per email sulla propria richiesta.
  await q(`UPDATE use_case_referent_requests SET created_at = now() - interval '31 days', sent_at = now() - interval '31 days', last_email_at = now() - interval '31 days', expires_at = now() - interval '1 minute' WHERE id = $1::uuid`, [first.requestId]);
  const counts = await referents.runReferentCron({ env: ENV, now: V, mailer: fakeMailer() });
  assert.equal(counts.errors, 0, JSON.stringify(counts));
  assert.deepEqual((await silentRows(cards.late)).map((r) => r.who), sorted("claudio", "federico"));
  assert.deepEqual(await alertRecipients(first.requestId), []);
});
