import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { isWorkingDay, romeDate, romeLocalToUtc, workingDaysBetween } from "../../uc/calendar.ts";

// Referente già iscritto (27/10) sul database di prova, una persona per caso. Il referente risponde
// sempre dal link personale, senza account; ma può avere già un account Unbundle (per esempio ha
// partecipato a una formazione):
// - un contributore scelto dall'elenco «A chi chiedi?» → referente collegato al suo account, email con
//   «Hai già un account Unbundle…», nessun link alla dashboard; la seconda volta lo stesso referente;
// - un revisore scelto dall'elenco → la riga del team con il link alla scheda;
// - un partecipante a un corso (learner) non è nell'elenco (chi guarda non lo vede in Impostazioni ›
//   Persone): scritto in «+ Nuovo referente» si collega al suo account, ha la riga, nessuna campanella;
// - Lateral Space mai nell'elenco e rifiutato se forzato; chi chiede rifiutato; un id di un altro
//   workspace rifiutato;
// - l'email di un referente che c'è già → si usa quello (nessuna riga in più), uno disattivato → errore;
// - chi si iscrive dopo la richiesta → il promemoria ha la riga;
// - «Correggi l'email» sposta il collegamento all'account.
// - (revisione) un collegamento all'account vale solo finché l'email del contatto è la sua; due revisori che
//   aggiungono insieme la stessa persona hanno un referente solo.
//
// Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su
// 127.0.0.1). Dati sintetici, creati e cancellati qui. Nessuna email vera: un mailer finto.
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
type BellData = typeof import("../../notifications/bell-data.ts");
type Ctx = import("../service.ts").WriteContext;
type Mail = import("../../uc/notify/dispatch.ts").OutgoingEmail;

let referents: Referents;
let pub: Public;
let dispatch: Dispatch;
let bell: BellData;
let q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

const suffix = randomBytes(3).toString("hex");
const ids = {
  org: randomUUID(),
  ws: randomUUID(),
  otherOrg: randomUUID(),
  otherWs: randomUUID(),
  builder: randomUUID(),
  federico: randomUUID(),
  corsista: randomUUID(),
  contrib: randomUUID(),
  ls: randomUUID(),
  outsider: randomUUID(),
  tardi: randomUUID(),
  program: randomUUID(),
  dario: randomUUID(),
  // (Rilascio 4) I partecipanti ai corsi nel selettore, e chi li guarda.
  sisterWs: randomUUID(),
  sponsor: randomUUID(),
  analyst: randomUUID(),
  lia: randomUUID(),
  sara: randomUUID(),
  sister: randomUUID(),
  far: randomUUID(),
  orgLearner: randomUUID(),
  unverified: randomUUID(),
  lsLearner: randomUUID(),
};
/** (Rilascio 4) Le persone in più: chi guarda (sponsor, analista) e i partecipanti ai corsi, di qui e d'altrove. */
const EXTRA = {
  sponsor: { name: "Ornella Sponsor", email: `ornella.${suffix}@topjet.test` },
  analyst: { name: "Teo Analisi", email: `teo.${suffix}@topjet.test` },
  lia: { name: "Lia Esempio", email: `lia.${suffix}@topjet.test` },
  sara: { name: "Sara Prova", email: `sara.${suffix}@topjet.test` },
  sister: { name: "Nina Sorella", email: `nina.${suffix}@topjet.test` },
  far: { name: "Ivo Lontano", email: `ivo.${suffix}@altra.test` },
  orgLearner: { name: "Olga Gruppo", email: `olga.${suffix}@topjet.test` },
  unverified: { name: "Ugo Attesa", email: `ugo.${suffix}@topjet.test` },
  lsLearner: { name: "Lino Laterale", email: `lino.${suffix}@ls.test` },
} as const;
type Extra = keyof typeof EXTRA;
type Person = "builder" | "federico" | "corsista" | "contrib" | "ls";
const PEOPLE: Person[] = ["builder", "federico", "corsista", "contrib", "ls"];
const ROLE: Record<Person, string> = { builder: "function_lead", federico: "function_lead", corsista: "learner", contrib: "contributor", ls: "transformation_lead" };
const NAME: Record<Person, string> = { builder: "Giulia Neri", federico: "Fabio Esempio", corsista: "Carla Corsi", contrib: "Bruno Bianchi", ls: "Pier Lateral" };
const emails: Record<Person, string> = {
  builder: `giulia.${suffix}@topjet.test`,
  federico: `federico.${suffix}@topjet.test`,
  corsista: `carla.${suffix}@topjet.test`,
  contrib: `bruno.${suffix}@topjet.test`,
  ls: `pier.${suffix}@ls.test`,
};
const OUTSIDER = `esterno.${suffix}@altra.test`;
const MARIO = `mario.rossi.${suffix}@topjet.test`;
const ELENA = `elena.${suffix}@topjet.test`;
const TARDI = `luca.tardi.${suffix}@topjet.test`;
const LUCA_DOSSIER = `luca.dossier.${suffix}@topjet.test`;
const DARIO = `dario.${suffix}@topjet.test`;
const NUOVA = `nuova.persona.${suffix}@topjet.test`;
const COURSE_TITLE = `Corso AI generativa ${suffix}`;
const contacts = { mario: randomUUID(), elena: randomUUID() };
const cards = {
  forged: randomUUID(),
  contrib: randomUUID(),
  contrib2: randomUUID(),
  fed: randomUUID(),
  learner: randomUUID(),
  mario: randomUUID(),
  tardi: randomUUID(),
  dossier1: randomUUID(),
  dossier2: randomUUID(),
  race1: randomUUID(),
  race2: randomUUID(),
  race3: randomUUID(),
  race4: randomUUID(),
  lia: randomUUID(),
  sara: randomUUID(),
};
const storageDir = mkdtempSync(join(tmpdir(), "referenti-iscritti-"));

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

const ACCOUNT_LINE = "Hai già un account Unbundle: per rispondere non serve entrare, basta questo link.";
const TEAM_LINE = "Hai già accesso a Unbundle: puoi rispondere anche dalla scheda.";

function as(person: Person): Ctx {
  return { workspaceId: ids.ws, actor: { userId: ids[person], role: ROLE[person], isLateralSpace: false, kind: "persona" }, channel: "pagina" };
}
const requester = (person: Person) => ({ name: NAME[person], emailVerified: true });
const viewer = (person: Person, role = ROLE[person]) => ({ userId: ids[person], email: emails[person], emailVerified: true, role, isLateralSpace: false });

function ok<T>(result: { ok: true; value: T } | { ok: false; error: string; message: string }, label = "esito"): T {
  if (!result.ok) assert.fail(`${label}: atteso ok, ricevuto ${result.error} (${result.message})`);
  return result.value;
}
function refused(result: { ok: boolean; error?: string }, code: string, label: string) {
  assert.equal(result.ok, false, label);
  assert.equal((result as { error?: string }).error, code, label);
}
function fakeMailer() {
  const outbox: Mail[] = [];
  return { outbox, async send(m: Mail) { outbox.push(m); return { ok: true as const }; } };
}
const tokenOf = (m: Mail) => /\/rispondi\/(ucq_[A-Za-z0-9_-]{32})/.exec(m.text)?.[1] ?? null;
const cardUrl = (card: string) => `http://localhost:3000/dashboard/${ids.ws}/use-cases/${card}?capitolo=cosa-serve`;

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

async function panelFor(person: Person, card: string, role = ROLE[person]) {
  const base = await import("../../db/queries/use-case-referent-base.ts");
  const { getAppUcExecutor } = await import("../../db/uc-executor.ts");
  const all = await base.readCardNeeds(await getAppUcExecutor(), ids.ws, card);
  return referents.loadUseCaseReferentPanel({
    workspaceId: ids.ws,
    useCaseId: card,
    viewer: viewer(person, role),
    session: { id: ids[person], name: NAME[person], email: emails[person], emailVerified: true },
    role,
    needs: { requirements: all.filter((n) => n.type === "requisito"), steps: [], linkable: [] },
    env: ENV,
  });
}

type ContactInput = import("./contract.ts").SendReferentRequestInput["contact"];

/** Una richiesta da Giulia, l'email partita con il mailer finto: id, email e token. */
async function ask(card: string, contact: ContactInput, count = 1) {
  const needIds = (await needsOf(card)).slice(0, count);
  const sent = ok(await referents.sendReferentRequest(as("builder"), card, { contact, needIds }, { env: ENV, requester: requester("builder") }), `invio su ${card}`);
  const mailer = fakeMailer();
  await dispatch.dispatchReferentEmails({ requestId: sent.requestId, env: ENV, mailer, sendIntervalMs: 0 });
  assert.equal(mailer.outbox.length, 1, "un'email");
  const mail = mailer.outbox[0];
  return { ...sent, mail, token: tokenOf(mail) ?? "", needIds };
}

async function contactRow(email: string) {
  return q(`SELECT id::text AS id, display_name, user_id::text AS user_id FROM uc_contacts WHERE workspace_id = $1::uuid AND lower(email) = lower($2)`, [ids.ws, email]);
}
async function requestContact(requestId: string): Promise<string> {
  return String((await q(`SELECT contact_id::text AS c FROM use_case_referent_requests WHERE id = $1::uuid`, [requestId]))[0]?.c);
}

function noDashboard(mail: Mail, label: string) {
  assert.ok(!mail.text.includes("/dashboard/"), `${label}: nessun link alla dashboard nel testo`);
  assert.ok(!mail.html.includes("/dashboard/"), `${label}: nessun link alla dashboard nell'HTML`);
}

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
  bell = await import("../../notifications/bell-data.ts");

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Organizzazione iscritti', $2)`, [ids.org, `hub-iscritti-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $2::uuid, 'TopJet iscritti')`, [ids.ws, ids.org]);
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Altra organizzazione', $2)`, [ids.otherOrg, `hub-altra-${ids.otherOrg}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $2::uuid, 'Altra azienda')`, [ids.otherWs, ids.otherOrg]);
  for (const person of PEOPLE) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1::uuid, $2, $3, now())`, [ids[person], emails[person], NAME[person]]);
    await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [ids.ws, ids[person], ROLE[person]]);
  }
  // Una persona di un altro workspace: mai referente qui, nemmeno con il suo id.
  await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1::uuid, $2, 'Esterno Altri', now())`, [ids.outsider, OUTSIDER]);
  await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'contributor')`, [ids.otherWs, ids.outsider]);
  // (Rilascio 4) Un altro workspace della stessa organizzazione, e i partecipanti ai corsi: di questo
  // workspace (verificati, uno senza email verificata, uno di Lateral Space), di quell'altro, di
  // un'altra organizzazione, e uno con il solo ruolo «learner» dell'organizzazione.
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $2::uuid, 'TopJet sorella')`, [ids.sisterWs, ids.org]);
  for (const key of Object.keys(EXTRA) as Extra[]) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1::uuid, $2, $3, ${key === "unverified" ? "NULL" : "now()"})`, [ids[key], EXTRA[key].email, EXTRA[key].name]);
  }
  const extraRole: [Extra, string, string][] = [
    ["sponsor", ids.ws, "exec_sponsor"],
    ["analyst", ids.ws, "analyst"],
    ["lia", ids.ws, "learner"],
    ["sara", ids.ws, "learner"],
    ["unverified", ids.ws, "learner"],
    ["lsLearner", ids.ws, "learner"],
    ["sister", ids.sisterWs, "learner"],
    ["far", ids.otherWs, "learner"],
  ];
  for (const [key, ws, role] of extraRole) {
    await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [ws, ids[key], role]);
  }
  await q(`INSERT INTO memberships (user_id, organization_id, role) VALUES ($1::uuid, $2::uuid, 'learner')`, [ids.orgLearner, ids.org]);
  for (const [code, card] of Object.entries(cards)) {
    await q(
      `INSERT INTO use_cases (id, workspace_id, title, description, status, portfolio_review_status, portfolio_kind, code, source)
       VALUES ($1::uuid, $2::uuid, $3, 'Problema di prova', 'accepted', 'scored', 'use_case_ai', $4, 'web_proposed')`,
      [card, ids.ws, `Scheda ${code}`, `RI-${String(1000 + Math.floor(Math.random() * 8000))}`],
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
  await q(`DELETE FROM uc_contacts WHERE workspace_id = ANY($1::uuid[])`, [[ids.ws, ids.otherWs, ids.sisterWs]]);
  await q(`DELETE FROM workspaces WHERE id = ANY($1::uuid[])`, [[ids.ws, ids.otherWs, ids.sisterWs]]);
  await q(`DELETE FROM organizations WHERE id = ANY($1::uuid[])`, [[ids.org, ids.otherOrg]]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[...PEOPLE.map((p) => ids[p]), ids.outsider, ids.tardi, ids.dario, ...(Object.keys(EXTRA) as Extra[]).map((k) => ids[k])]]);
});

test("preparazione: autorizzazione, domande, un referente senza account, uno disattivato, la corsista iscritta al corso", opts, async () => {
  await q(
    `INSERT INTO uc_subprocessor_acks (workspace_id, list_version, statement_text, declared_by_user_id, declared_by_role) VALUES ($1::uuid, '2026-10', 'Autorizzazione di prova', $2::uuid, 'function_lead')`,
    [ids.ws, ids.builder],
  );
  for (const card of Object.values(cards)) ok(await referents.prepareReferentQuestions(as("builder"), card), "Prepara");
  await q(`INSERT INTO uc_contacts (id, workspace_id, display_name, email) VALUES ($1::uuid, $2::uuid, 'Mario Rossi', $3)`, [contacts.mario, ids.ws, MARIO]);
  await q(`INSERT INTO uc_contacts (id, workspace_id, display_name, email, is_active) VALUES ($1::uuid, $2::uuid, 'Elena Ferri', $3, false)`, [contacts.elena, ids.ws, ELENA]);
  await q(
    `INSERT INTO learning_programs (id, workspace_id, family_key, title, content_version, pack_hash, private_pack, visibility_policy, retention_days, published_by)
     VALUES ($1::uuid, $2::uuid, 'ai-generativa', $3, 'v1', $4, '{}'::jsonb, 'solo-partecipante', 365, $5::uuid)`,
    [ids.program, ids.ws, COURSE_TITLE, "b".repeat(64), ids.builder],
  );
  await q(
    `INSERT INTO learning_sessions (workspace_id, program_id, module_id, cohort_id, starts_at, ends_at) VALUES ($1::uuid, $2::uuid, 'm1', 'c1', now(), now() + interval '2 hours')`,
    [ids.ws, ids.program],
  );
  await q(`INSERT INTO learning_enrollments (workspace_id, program_id, user_id, module_id, cohort_id) VALUES ($1::uuid, $2::uuid, $3::uuid, 'm1', 'c1')`, [ids.ws, ids.program, ids.corsista]);
});

test("selettore: le persone del workspace nell'elenco della finestra, senza ruoli né corsi; la scheda non le porta", opts, async () => {
  const panel = await panelFor("builder", cards.contrib);
  assert.ok(panel?.available);
  // (Rilascio 4) Il pannello di ogni scheda non ha più le persone del workspace.
  assert.ok(!Object.hasOwn(panel!, "members"), "nessuna persona nel pannello della scheda");
  // L'elenco della finestra: il contributore, i revisori e i partecipanti ai corsi del workspace, in
  // ordine alfabetico; mai Lateral Space o chi guarda.
  const list = ok(await referents.listReferentPickerPeople(as("builder"), cards.contrib, ENV), "elenco");
  assert.deepEqual(
    list.members.map((m) => [m.userId, m.displayName, m.team]),
    [
      [ids.contrib, NAME.contrib, false],
      [ids.corsista, NAME.corsista, false],
      [ids.federico, NAME.federico, true],
      [ids.lia, EXTRA.lia.name, false],
      [ids.sponsor, EXTRA.sponsor.name, true],
      [ids.sara, EXTRA.sara.name, false],
      [ids.analyst, EXTRA.analyst.name, true],
    ],
  );
  for (const m of list.members) assert.match(m.emailMasked ?? "", /^[a-z]•••@topjet\.test$/, "email coperta");
  assert.ok(panel!.contacts.some((c) => c.id === contacts.mario), "i referenti restano");
  assert.ok(!panel!.contacts.some((c) => c.id === contacts.elena), "un referente disattivato non si propone");
  for (const [label, value] of [
    ["pannello", panel],
    ["elenco", list],
  ] as const) {
    const json = JSON.stringify(value);
    for (const word of [COURSE_TITLE, ids.program, emails.corsista, ids.ls, emails.ls, emails.contrib, emails.federico, "learning", "Formazione", "learner", "contributor"]) {
      assert.ok(!json.includes(word), `${label}: ${word}`);
    }
  }
  assert.ok(!JSON.stringify(panel).includes(ids.corsista), "la partecipante mai nel pannello");
  const { PANEL_VIEW_KEYS, keyPaths } = await import("./view.ts");
  assert.deepEqual(keyPaths(panel, { dictionaries: ["needs"] }).filter((k) => !PANEL_VIEW_KEYS.includes(k)), []);
  // Un altro revisore vede Giulia; un contributore e una corsista non vedono il pannello.
  assert.ok(ok(await referents.listReferentPickerPeople(as("federico"), cards.contrib, ENV), "elenco di Federico").members.some((m) => m.userId === ids.builder));
  assert.equal(await panelFor("contrib", cards.contrib), null);
  assert.equal(await panelFor("corsista", cards.contrib), null);
});

test("scelte forzate: chi chiede, Lateral Space, la corsista dall'elenco, un altro workspace, un id inventato", opts, async () => {
  const [n0] = await needsOf(cards.forged);
  const send = (userId: string) => referents.sendReferentRequest(as("builder"), cards.forged, { contact: { kind: "membro", userId }, needIds: [n0] }, { env: ENV, requester: requester("builder") });
  refused(await send(ids.builder), "referente_sei_tu", "chi chiede");
  refused(await send(ids.ls), "referente_lateral_space", "Lateral Space");
  refused(await send(ids.lsLearner), "referente_lateral_space", "un partecipante ai corsi di Lateral Space");
  // (Revisione) Una persona che non si può scegliere non è mai stata un referente: il suo testo, e la
  // pagina si rilegge (codice «superato»).
  const { REFERENT_ERROR_MESSAGES } = await import("./labels.ts");
  const { REFERENT_STALE_CODES } = await import("../../../components/use-cases/detail/referent/referent-outcome.ts");
  assert.ok(REFERENT_STALE_CODES.has("persona_non_disponibile"));
  // (Rilascio 4) I partecipanti ai corsi di questo workspace si scelgono; quelli d'altrove, con il solo
  // ruolo dell'organizzazione o senza email verificata no.
  for (const [userId, label] of [
    [ids.sister, "una partecipante di un altro workspace della stessa organizzazione"],
    [ids.far, "un partecipante di un'altra organizzazione"],
    [ids.orgLearner, "il solo ruolo «learner» dell'organizzazione"],
    [ids.unverified, "senza email verificata"],
    [ids.outsider, "un altro workspace"],
    [randomUUID(), "un id inventato"],
  ] as const) {
    const result = await send(userId);
    refused(result, "persona_non_disponibile", label);
    if (!result.ok) assert.equal(result.message, REFERENT_ERROR_MESSAGES.persona_non_disponibile, label);
  }
  // Un contributore non chiede (non è revisore), nemmeno scegliendo dall'elenco.
  const byContrib = await referents.sendReferentRequest(as("contrib"), cards.forged, { contact: { kind: "membro", userId: ids.federico }, needIds: [n0] }, { env: ENV, requester: requester("contrib") });
  assert.equal(byContrib.ok, false);
  assert.equal((await q(`SELECT 1 FROM use_case_referent_requests WHERE use_case_id = $1::uuid`, [cards.forged])).length, 0, "nessuna richiesta");
  assert.equal((await q(`SELECT 1 FROM uc_contacts WHERE workspace_id = $1::uuid AND user_id IS NOT NULL`, [ids.ws])).length, 0, "nessun referente nuovo");
  assert.equal((await q(`SELECT 1 FROM use_case_referent_emails WHERE workspace_id = $1::uuid`, [ids.ws])).length, 0, "nessuna email in coda");
});

// ── (Rilascio 4) La finestra in tre passi: le persone lette quando si apre ──

const COURSE_WORDS = ["learner", "learning", "corso", "formazione", "partecipant"];

async function pickerFor(ctx: Ctx, card: string) {
  return referents.listReferentPickerPeople(ctx, card, ENV);
}
function asViewer(userId: string, role: string): Ctx {
  return { workspaceId: ids.ws, actor: { userId, role, isLateralSpace: false, kind: "persona" }, channel: "pagina" };
}
const LISTED = [ids.lia, ids.sara, ids.corsista];
const NEVER = [ids.sister, ids.far, ids.orgLearner, ids.unverified, ids.lsLearner, ids.ls, ids.outsider];

test("(rilascio 4) l'elenco della finestra: i partecipanti ai corsi di questo workspace per ogni revisore, mai quelli d'altrove", opts, async () => {
  const viewers: [string, Ctx][] = [
    ["function_lead", as("builder")],
    ["exec_sponsor", asViewer(ids.sponsor, "exec_sponsor")],
    ["analyst", asViewer(ids.analyst, "analyst")],
    ["Lateral Space", as("ls")],
  ];
  for (const [label, ctx] of viewers) {
    const result = ok(await pickerFor(ctx, cards.contrib), label);
    const listed = result.members.map((m) => m.userId);
    for (const userId of LISTED) assert.ok(listed.includes(userId), `${label}: un partecipante ai corsi di questo workspace è nell'elenco`);
    for (const userId of NEVER) assert.ok(!listed.includes(userId), `${label}: ${userId} mai`);
    assert.ok(!listed.includes(String(ctx.actor.userId)), `${label}: mai chi guarda`);
    // Alfabetico, nome ed email coperta, «Fa parte del team» solo per i revisori; niente che distingua un partecipante.
    const names = result.members.map((m) => m.displayName);
    assert.deepEqual(names, [...names].sort((a, b) => new Intl.Collator("it", { sensitivity: "base" }).compare(a, b)), label);
    for (const m of result.members) {
      assert.deepEqual(Object.keys(m).sort(), ["displayName", "emailMasked", "team", "userId"], label);
      assert.match(m.emailMasked ?? "", /^[a-z]•••@topjet\.test$/, `${label}: email coperta`);
    }
    assert.equal(result.members.find((m) => m.userId === ids.lia)?.team, false);
    assert.equal(result.members.find((m) => m.userId === ids.federico)?.team, true);
    const json = JSON.stringify(result);
    for (const word of [...COURSE_WORDS, COURSE_TITLE, ids.program, EXTRA.lia.email, EXTRA.sara.email, emails.corsista]) assert.ok(!json.toLowerCase().includes(word.toLowerCase()), `${label}: ${word}`);
  }
  // Un contributore non chiede: nessun elenco.
  const byContrib = await pickerFor(as("contrib"), cards.contrib);
  assert.equal(byContrib.ok, false, "un contributore non riceve l'elenco");
  if (!byContrib.ok) assert.match(byContrib.error, /^(permesso_mancante|funzione_spenta)$/);
  // Una scheda d'un altro workspace o inventata: niente.
  refused(await pickerFor(as("builder"), randomUUID()), "non_trovato", "una scheda inventata");
  // Il pannello di ogni scheda non ha le persone del workspace.
  const panel = await panelFor("builder", cards.contrib);
  assert.ok(!Object.hasOwn(panel!, "members"), "mai nel pannello della scheda");
  for (const userId of LISTED) assert.ok(!JSON.stringify(panel).includes(userId), "nessun partecipante nel pannello");
});

test("(rilascio 4) l'indirizzo intero della persona scelta: per un partecipante dell'elenco sì, per gli altri no", opts, async () => {
  const reveal = (userId: string, ctx: Ctx = as("builder")) => referents.revealReferentMemberEmail(ctx, cards.lia, userId, ENV);
  assert.deepEqual(ok(await reveal(ids.lia), "partecipante"), { email: EXTRA.lia.email });
  assert.deepEqual(ok(await reveal(ids.lia, asViewer(ids.analyst, "analyst")), "dall'analista"), { email: EXTRA.lia.email });
  assert.deepEqual(ok(await reveal(ids.federico), "un revisore"), { email: emails.federico });
  for (const userId of [ids.sister, ids.far, ids.orgLearner, ids.unverified, ids.outsider, randomUUID()]) refused(await reveal(userId), "persona_non_disponibile", userId);
  refused(await reveal(ids.lsLearner), "referente_lateral_space", "partecipante di Lateral Space");
  refused(await reveal(ids.ls), "referente_lateral_space", "Lateral Space");
  refused(await reveal(ids.builder), "referente_sei_tu", "chi guarda");
  const byContrib = await reveal(ids.lia, as("contrib"));
  assert.equal(byContrib.ok, false, "un contributore no");
  const json = JSON.stringify(await reveal(ids.lia));
  for (const word of COURSE_WORDS) assert.ok(!json.toLowerCase().includes(word), word);
});

test("(rilascio 4) chiedere a un partecipante ai corsi: referente collegato, la riga dell'account, nessun link alla dashboard, nessuna campanella", opts, async () => {
  const sent = await ask(cards.lia, { kind: "membro", userId: ids.lia });
  assert.equal(sent.contactName, EXTRA.lia.name);
  const [row] = await contactRow(EXTRA.lia.email);
  assert.deepEqual([row?.display_name, row?.user_id], [EXTRA.lia.name, ids.lia], "il referente nasce collegato al suo account");
  assert.equal(sent.mail.to, EXTRA.lia.email);
  assert.ok(sent.mail.text.includes(ACCOUNT_LINE), "«Hai già un account Unbundle…»");
  assert.ok(!sent.mail.text.includes(TEAM_LINE));
  noDashboard(sent.mail, "partecipante");
  // Parole intere: «un'informazione» dell'email (rilascio 5) non è «formazione».
  for (const word of COURSE_WORDS) assert.ok(!new RegExp(`\\b${word}`).test(sent.mail.text.toLowerCase()), word);
  assert.equal((await q(`SELECT 1 FROM use_case_notifications WHERE recipient_user_id = $1::uuid`, [ids.lia])).length, 0, "nessuna campanella per lei");
  const forLearner = await bell.loadBellPayload({ workspaceId: ids.ws, userId: ids.lia, role: "learner", useCaseHub: true, env: ENV });
  assert.equal(forLearner.entries.filter((e) => e.source === "use_case").length, 0);
  // Adesso è un referente: nell'elenco non c'è più come persona.
  assert.ok(!ok(await pickerFor(as("builder"), cards.contrib2), "elenco").members.some((m) => m.userId === ids.lia));
});

test("(rilascio 4) un partecipante tolto dal workspace fra l'elenco e l'invio: «persona_non_disponibile», niente scritto", opts, async () => {
  assert.ok(ok(await pickerFor(as("builder"), cards.sara), "elenco").members.some((m) => m.userId === ids.sara));
  await q(`DELETE FROM workspace_memberships WHERE workspace_id = $1::uuid AND user_id = $2::uuid`, [ids.ws, ids.sara]);
  assert.ok(!ok(await pickerFor(as("builder"), cards.sara), "elenco dopo").members.some((m) => m.userId === ids.sara));
  const [n0] = await needsOf(cards.sara);
  const result = await referents.sendReferentRequest(as("builder"), cards.sara, { contact: { kind: "membro", userId: ids.sara }, needIds: [n0] }, { env: ENV, requester: requester("builder") });
  refused(result, "persona_non_disponibile", "tolta");
  refused(await referents.revealReferentMemberEmail(as("builder"), cards.sara, ids.sara, ENV), "persona_non_disponibile", "indirizzo");
  assert.equal((await q(`SELECT 1 FROM use_case_referent_requests WHERE use_case_id = $1::uuid`, [cards.sara])).length, 0);
  assert.equal((await contactRow(EXTRA.sara.email)).length, 0);
});

const flow = { learner: { token: "", needId: "" } };

test("un contributore scelto dall'elenco: referente collegato, email con «Hai già un account», nessun link alla dashboard", opts, async () => {
  const sent = await ask(cards.contrib, { kind: "membro", userId: ids.contrib });
  assert.equal(sent.contactName, NAME.contrib);
  const [row] = await contactRow(emails.contrib);
  assert.deepEqual([row?.display_name, row?.user_id], [NAME.contrib, ids.contrib], "il referente nasce collegato al suo account");
  assert.equal(sent.mail.to, emails.contrib);
  // (Rilascio 5, §8.4) Una richiesta di sole domande: «alcune domande su …».
  assert.equal(sent.mail.subject, `TopJet iscritti: alcune domande su «${(await q(`SELECT code FROM use_cases WHERE id = $1::uuid`, [cards.contrib]))[0].code} · Scheda contrib»`);
  assert.ok(sent.mail.text.includes(`${NAME.builder} ti chiede alcune informazioni sullo use case «`));
  assert.ok(sent.mail.text.includes(ACCOUNT_LINE));
  assert.ok(!sent.mail.text.includes(TEAM_LINE));
  assert.ok(sent.mail.text.includes(`/rispondi/${sent.token}`), "il link personale c'è sempre");
  noDashboard(sent.mail, "contributore");
  // Adesso è un referente: nel selettore una sola voce, quella del referente.
  const panel = await panelFor("builder", cards.contrib2);
  assert.ok(!ok(await referents.listReferentPickerPeople(as("builder"), cards.contrib2, ENV), "elenco").members.some((m) => m.userId === ids.contrib));
  assert.equal(panel!.contacts.filter((c) => c.id === row.id).length, 1);
  // Sceglierlo di nuovo dall'elenco (pagina vecchia) usa lo stesso referente: nessuna riga in più.
  const again = await ask(cards.contrib2, { kind: "membro", userId: ids.contrib });
  assert.equal(await requestContact(again.requestId), row.id);
  assert.equal((await contactRow(emails.contrib)).length, 1);
  // Sulla stessa scheda vale la regola di sempre: una richiesta aperta per persona.
  refused(
    await referents.sendReferentRequest(as("builder"), cards.contrib, { contact: { kind: "membro", userId: ids.contrib }, needIds: (await needsOf(cards.contrib)).slice(1, 2) }, { env: ENV, requester: requester("builder") }),
    "richiesta_aperta",
    "richiesta già aperta",
  );
});

test("un revisore scelto dall'elenco: la riga del team con il link alla scheda", opts, async () => {
  const sent = await ask(cards.fed, { kind: "membro", userId: ids.federico });
  const [row] = await contactRow(emails.federico);
  assert.equal(row?.user_id, ids.federico);
  assert.ok(sent.mail.text.includes(TEAM_LINE));
  assert.ok(sent.mail.text.includes(cardUrl(cards.fed)));
  assert.ok(!sent.mail.text.includes(ACCOUNT_LINE));
  const panel = await panelFor("builder", cards.contrib2);
  assert.equal(panel!.contacts.find((c) => c.id === row.id)?.team, true, "«Fa parte del team»");
  const listed = ok(await referents.listReferentPickerPeople(as("builder"), cards.contrib2, ENV), "elenco").members.map((m) => m.userId);
  assert.ok(!listed.includes(ids.federico) && !listed.includes(ids.contrib), "chi è ormai referente non è fra le persone");
  for (const userId of [ids.sponsor, ids.analyst]) assert.ok(listed.includes(userId), "gli altri membri restano");
});

test("una corsista scritta in «+ Nuovo referente»: collegata al suo account, la riga, nessuna campanella per lei", opts, async () => {
  const sent = await ask(cards.learner, { kind: "nuovo", displayName: "Carla dal corso", email: `  ${emails.corsista.toUpperCase()} ` });
  const [row] = await contactRow(emails.corsista);
  assert.deepEqual([row?.display_name, row?.user_id], ["Carla dal corso", ids.corsista], "collegata al suo account, il nome scritto");
  assert.ok(sent.mail.text.includes(ACCOUNT_LINE));
  noDashboard(sent.mail, "corsista");
  flow.learner = { token: sent.token, needId: sent.needIds[0] };
  // Risponde dal link come chiunque: la pagina non legge la sessione.
  const first = await pub.resolveReferentToken(sent.token, V);
  if (first.access !== "ok") assert.fail(first.access);
  assert.ok((await pub.acceptReferentPrivacy(first.link, { version: "ucq-2026-11-1" }, V)).ok);
  const resolved = await pub.resolveReferentToken(sent.token, V);
  if (resolved.access !== "ok") assert.fail(resolved.access);
  assert.ok((await pub.saveReferentDraft(resolved.link, { needId: sent.needIds[0], text: "Una volta alla settimana.", dontKnow: false }, V)).ok);
  assert.ok((await pub.submitReferentAnswers(resolved.link, {}, V)).ok);
  const rows = await q(`SELECT recipient_user_id::text AS who FROM use_case_notifications WHERE use_case_id = $1::uuid AND kind = 'risposte' ORDER BY recipient_user_id`, [cards.learner]);
  assert.deepEqual(rows.map((r) => r.who), [ids.builder, ids.federico, ids.ls, ids.sponsor, ids.analyst].sort(), "solo i revisori (anche Lateral Space), mai lei");
  assert.equal((await q(`SELECT 1 FROM use_case_notifications WHERE recipient_user_id = ANY($1::uuid[])`, [[ids.corsista, ids.contrib]])).length, 0);
  assert.equal((await q(`SELECT 1 FROM use_case_requester_emails WHERE recipient_user_id = ANY($1::uuid[])`, [[ids.corsista, ids.contrib]])).length, 0);
  const forLearner = await bell.loadBellPayload({ workspaceId: ids.ws, userId: ids.corsista, role: "learner", useCaseHub: true, env: ENV });
  assert.equal(forLearner.entries.filter((e) => e.source === "use_case").length, 0);
  assert.equal(await panelFor("corsista", cards.learner), null, "essere referente non dà accesso a niente");
});

test("l'email di un referente che c'è già: si usa quello, con il suo nome; uno disattivato resta un errore chiaro", opts, async () => {
  const sent = await ask(cards.mario, { kind: "nuovo", displayName: "Un altro nome", email: ` ${MARIO.toUpperCase()} `, roleLabel: "Acquisti" });
  assert.equal(sent.contactName, "Mario Rossi", "il nome che c'era");
  assert.equal(await requestContact(sent.requestId), contacts.mario);
  const rows = await contactRow(MARIO);
  assert.equal(rows.length, 1, "nessun referente in più");
  assert.deepEqual([rows[0].display_name, rows[0].user_id], ["Mario Rossi", null], "i dati del referente non cambiano");
  assert.equal(sent.mail.to, MARIO);
  assert.ok(!sent.mail.text.includes(ACCOUNT_LINE) && !sent.mail.text.includes(TEAM_LINE), "senza account: nessuna delle due righe");
  noDashboard(sent.mail, "Mario");
  // Di nuovo sulla stessa scheda: la regola di sempre.
  const twice = await referents.sendReferentRequest(as("builder"), cards.mario, { contact: { kind: "nuovo", displayName: "Mario", email: MARIO }, needIds: (await needsOf(cards.mario)).slice(1, 2) }, { env: ENV, requester: requester("builder") });
  refused(twice, "richiesta_aperta", "una richiesta aperta per persona");
  const inactive = await referents.sendReferentRequest(as("builder"), cards.mario, { contact: { kind: "nuovo", displayName: "Elena", email: ELENA }, needIds: (await needsOf(cards.mario)).slice(1, 2) }, { env: ENV, requester: requester("builder") });
  refused(inactive, "referente_disattivato", "disattivato");
  if (inactive.ok) return;
  const { REFERENT_ERROR_MESSAGES } = await import("./labels.ts");
  assert.equal(inactive.fieldErrors?.email, REFERENT_ERROR_MESSAGES.referente_disattivato, "sotto «Email»");
  // (Revisione) Come lo tratta la finestra: lo stesso percorso di `ask-dialog.tsx` `confirm()` con la
  // risposta dell'action. La finestra resta aperta (la bozza non si perde) e l'errore sta sotto «Email».
  const { referentOutcome } = await import("../../../components/use-cases/detail/referent/referent-outcome.ts");
  const { askErrorView, NEW_CONTACT } = await import("../../../components/use-cases/detail/referent/ask-dialog-state.ts");
  const actionResult = { ok: false as const, code: inactive.error, message: inactive.message, fieldErrors: inactive.fieldErrors };
  const outcome = referentOutcome(actionResult, { inDialog: true });
  assert.deepEqual([outcome.close, outcome.refresh], [false, false], "la finestra resta aperta");
  assert.deepEqual(askErrorView(actionResult, { choice: NEW_CONTACT }), { formError: null, fieldErrors: { email: REFERENT_ERROR_MESSAGES.referente_disattivato } });
  assert.equal((await contactRow(ELENA)).length, 1);
});

test("chi si iscrive dopo la richiesta: il promemoria ha la riga, riletta all'invio", opts, async () => {
  const sent = await ask(cards.tardi, { kind: "nuovo", displayName: "Luca Tardi", email: TARDI });
  assert.ok(!sent.mail.text.includes(ACCOUNT_LINE), "ancora senza account");
  assert.equal((await contactRow(TARDI))[0]?.user_id, null);
  // Si iscrive (per esempio a una formazione) con la stessa email, verificata.
  await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1::uuid, $2, 'Luca Tardi', now())`, [ids.tardi, TARDI]);
  await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'learner')`, [ids.ws, ids.tardi]);
  const at = workingDaysBefore(V, 3);
  await q(
    `UPDATE use_case_referent_requests SET created_at = $2::timestamptz - interval '1 minute', sent_at = $2::timestamptz, last_email_at = $2::timestamptz, expires_at = $2::timestamptz + interval '30 days' WHERE id = $1::uuid`,
    [sent.requestId, at.toISOString()],
  );
  await q(`UPDATE use_case_referent_emails SET sent_at = $2::timestamptz, created_at = $2::timestamptz, due_at = $2::timestamptz, scheduled_at = $2::timestamptz WHERE request_id = $1::uuid`, [sent.requestId, at.toISOString()]);
  const mailer = fakeMailer();
  const counts = await referents.runReferentCron({ env: ENV, now: V, mailer });
  assert.equal(counts.errors, 0, JSON.stringify(counts));
  const reminders = mailer.outbox.filter((m) => m.to === TARDI);
  assert.equal(reminders.length, 1, JSON.stringify(counts));
  assert.match(reminders[0].subject, /^Promemoria: /);
  assert.ok(reminders[0].text.includes(ACCOUNT_LINE));
  noDashboard(reminders[0], "promemoria");
  // (Rilascio 4) È ormai un referente (la sua email verificata è quella del contatto): non ha una seconda voce fra le persone.
  assert.equal(ok(await referents.listReferentPickerPeople(as("builder"), cards.tardi, ENV), "elenco").members.some((m) => m.userId === ids.tardi), false, "una voce sola: il referente");
});

test("«Correggi l'email» di un referente dell'hub: il collegamento all'account segue l'indirizzo nuovo", opts, async () => {
  const [row] = await contactRow(emails.contrib);
  assert.equal(row.user_id, ids.contrib);
  const fresh = `bruno.nuovo.${suffix}@topjet.test`;
  ok(await referents.correctReferentEmail(as("builder"), cards.contrib, String(row.id), { email: fresh }, { env: ENV }), "correggi");
  const [moved] = await contactRow(fresh);
  assert.equal(moved?.user_id, null, "nessun account con il nuovo indirizzo: il collegamento si toglie");
  // Torna all'indirizzo del suo account: si ricollega.
  ok(await referents.correctReferentEmail(as("builder"), cards.contrib, String(row.id), { email: emails.contrib }, { env: ENV }), "correggi di nuovo");
  assert.equal((await contactRow(emails.contrib))[0]?.user_id, ids.contrib);
});

test("(revisione) l'email di un referente collegato cambia in un dossier: il collegamento all'account di prima non conta più", opts, async () => {
  const { getAppUcExecutor } = await import("../../db/uc-executor.ts");
  const { contactStaleLinkClearSql, contactUpdateSql } = await import("../../uc/sql/request-commands.ts");
  const { requestReferentUserSql } = await import("./people.ts");
  const { cast, toStatement, ucSql } = await import("../../uc/sql/statement.ts");
  const executor = await getAppUcExecutor();
  // Il referente di Federico, nato dall'hub collegato al suo account.
  const [row] = await contactRow(emails.federico);
  assert.equal(row?.user_id, ids.federico);
  const contactId = String(row.id);
  // Lateral Space cambia l'email del contatto in un dossier: le stesse SQL del comando dei dossier
  // (`updateContact` in uc-requests.ts; che le metta nel batch lo prova requests.integration.test.ts).
  await executor.batch([
    contactUpdateSql({ workspaceId: ids.ws, contactId, patch: { email: LUCA_DOSSIER }, expect: { email: emails.federico, isActive: true } }),
    contactStaleLinkClearSql({ workspaceId: ids.ws, contactId }),
  ]);
  const [moved] = await contactRow(LUCA_DOSSIER);
  assert.deepEqual([moved?.id, moved?.user_id], [contactId, null], "il collegamento all'account di Federico si toglie");

  // Per Federico il contatto (adesso Luca) non è «(sei tu)», non è «del team», e lui torna fra le persone.
  const forFederico = await panelFor("federico", cards.dossier1);
  const option = forFederico!.contacts.find((c) => c.id === contactId);
  assert.ok(option, "il referente c'è");
  assert.equal(option!.reason, null, "non è «sei tu»");
  assert.equal(option!.selectable, true);
  assert.equal(option!.team, false, "Luca non ha un account");
  const forBuilder = await panelFor("builder", cards.dossier1);
  assert.equal(forBuilder!.contacts.find((c) => c.id === contactId)?.team, false);
  assert.ok(ok(await referents.listReferentPickerPeople(as("builder"), cards.dossier1, ENV), "elenco").members.some((m) => m.userId === ids.federico), "Federico torna fra le persone del workspace");

  // Federico chiede a Luca: non è una richiesta a se stesso, l'email parte a Luca senza righe dell'account.
  const [n0] = await needsOf(cards.dossier1);
  const sent = ok(
    await referents.sendReferentRequest(as("federico"), cards.dossier1, { contact: { kind: "esistente", contactId }, needIds: [n0] }, { env: ENV, requester: requester("federico") }),
    "Federico chiede a Luca",
  );
  const mailer = fakeMailer();
  await dispatch.dispatchReferentEmails({ requestId: sent.requestId, env: ENV, mailer, sendIntervalMs: 0 });
  assert.deepEqual(mailer.outbox.map((m) => m.to), [LUCA_DOSSIER], "l'email parte, a Luca");
  assert.ok(!mailer.outbox[0].text.includes(TEAM_LINE) && !mailer.outbox[0].text.includes(ACCOUNT_LINE));
  const [email] = await q(`SELECT status, cancel_reason FROM use_case_referent_emails WHERE request_id = $1::uuid`, [sent.requestId]);
  assert.deepEqual([email?.status, email?.cancel_reason ?? null], ["inviata", null], "mai annullata come «sei tu»");
  // La persona del referente di questa richiesta (campanella, avvisi): nessuna, non Federico.
  const [[who]] = await executor.batch([
    toStatement(ucSql`SELECT ${requestReferentUserSql("r")}::text AS who FROM use_case_referent_requests r WHERE r.id = ${cast(sent.requestId, "uuid")}`),
  ]);
  assert.equal(who?.who ?? null, null, "la risposta di Luca non è di Federico");

  // Giulia sceglie Federico dall'elenco: un referente nuovo con la sua email, mai quello di Luca.
  const forFed = await ask(cards.dossier2, { kind: "membro", userId: ids.federico });
  assert.notEqual(await requestContact(forFed.requestId), contactId, "non il referente di Luca");
  assert.equal(forFed.mail.to, emails.federico);
  assert.ok(forFed.mail.text.includes(TEAM_LINE), "Federico è del team");
  const [fresh] = await contactRow(emails.federico);
  assert.equal(fresh?.user_id, ids.federico, "il referente nuovo è collegato a Federico");
});

test("(revisione) due revisori aggiungono insieme la stessa persona: un referente solo, nessun errore", opts, async () => {
  // Una persona nuova del workspace, non ancora referente.
  await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1::uuid, $2, 'Dario Neri', now())`, [ids.dario, DARIO]);
  await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'contributor')`, [ids.ws, ids.dario]);
  const sendAs = async (person: Person, card: string, contact: ContactInput) =>
    referents.sendReferentRequest(as(person), card, { contact, needIds: (await needsOf(card)).slice(0, 1) }, { env: ENV, requester: requester(person) });
  // Scelta dall'elenco «Persone del workspace», nello stesso momento, da Giulia e da Federico.
  const [a, b] = await Promise.all([sendAs("builder", cards.race1, { kind: "membro", userId: ids.dario }), sendAs("federico", cards.race2, { kind: "membro", userId: ids.dario })]);
  const first = ok(a, "Giulia");
  const second = ok(b, "Federico");
  const rows = await contactRow(DARIO);
  assert.equal(rows.length, 1, "un referente solo");
  assert.equal(rows[0].user_id, ids.dario);
  assert.deepEqual([await requestContact(first.requestId), await requestContact(second.requestId)], [String(rows[0].id), String(rows[0].id)], "lo stesso referente");
  // La stessa email scritta in «+ Nuovo referente», nello stesso momento.
  const [c, d] = await Promise.all([
    sendAs("builder", cards.race3, { kind: "nuovo", displayName: "Nuova Persona", email: NUOVA }),
    sendAs("federico", cards.race4, { kind: "nuovo", displayName: "Nuova P.", email: NUOVA.toUpperCase() }),
  ]);
  const third = ok(c, "Giulia, email");
  const fourth = ok(d, "Federico, email");
  const typed = await contactRow(NUOVA);
  assert.equal(typed.length, 1, "un referente solo");
  assert.deepEqual([await requestContact(third.requestId), await requestContact(fourth.requestId)], [String(typed[0].id), String(typed[0].id)]);
  // Adesso è fra i «Referenti», non più fra le persone del workspace.
  const panel = await panelFor("builder", cards.dossier2);
  assert.ok(!ok(await referents.listReferentPickerPeople(as("builder"), cards.dossier2, ENV), "elenco").members.some((m) => m.userId === ids.dario));
  assert.equal(panel!.contacts.filter((x) => x.id === String(rows[0].id)).length, 1);
});
