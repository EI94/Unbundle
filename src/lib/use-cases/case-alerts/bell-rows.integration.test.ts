import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

// (0025) Le righe «Pronto da avviare» e «Autorizza i fornitori» nella campanella, sul database di
// prova: chi le vede (i revisori a cui sono scritte; mai un contributore), dove portano, e che
// spariscono da sole, senza scritture, appena non valgono più (lo use case non è più pronto, l'ok
// sui sub-responsabili è dato), anche dal numero rosso. Le righe si scrivono qui a mano: chi le
// scrive davvero si prova in readiness.integration.test.ts e subprocessors-wait.integration.test.ts.
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su
//   127.0.0.1); la 0025 la porta il vero ensureDbSchema(). Dati sintetici, creati e cancellati qui.
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

type BellData = typeof import("../../notifications/bell-data.ts");
let data: BellData;
let q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), ws: randomUUID(), ls: randomUUID(), lead: randomUUID(), contributor: randomUUID(), card: randomUUID(), need: randomUUID() };
const emails = { ls: `ls.righe.${suffix}@ls.test`, lead: `lead.righe.${suffix}@cliente.test`, contributor: `contrib.righe.${suffix}@cliente.test` };
type Person = keyof typeof emails;
const ROLE: Record<Person, string> = { ls: "transformation_lead", lead: "function_lead", contributor: "contributor" };
const ENV_KEYS = ["USE_CASE_HUB_WORKSPACES", "UC_ENABLED", "UC_WORKSPACE_IDS", "UC_LS_EMAIL_DOMAINS"] as const;
const envBefore = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

const payload = (person: Person) => data.loadBellPayload({ workspaceId: ids.ws, userId: ids[person], role: ROLE[person], useCaseHub: true });

/** Il trimestre di adesso a Roma, come lo scrive la scheda. */
function quarterNow(): string {
  const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit" }).format(new Date()).split("-");
  return `${y}-Q${Math.floor((Number(m) - 1) / 3) + 1}`;
}

async function row(person: Person, kind: "pronto" | "fornitori"): Promise<string> {
  const [r] = await q(
    `INSERT INTO use_case_notifications (workspace_id, use_case_id, recipient_user_id, kind, rome_day, first_event_at, last_event_at)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4, (now() AT TIME ZONE 'Europe/Rome')::date, now(), now()) RETURNING id`,
    [ids.ws, ids.card, ids[person], kind],
  );
  return String(r.id);
}

before(async () => {
  if (!enabled) return;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Record<string, unknown>[]>;
  process.env.USE_CASE_HUB_WORKSPACES = ids.ws;
  process.env.UC_LS_EMAIL_DOMAINS = "ls.test";
  delete process.env.UC_ENABLED;
  delete process.env.UC_WORKSPACE_IDS;
  const ensure = await import("../../db/ensure-schema.ts");
  await ensure.ensureDbSchema();
  data = await import("../../notifications/bell-data.ts");
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Organizzazione righe', $2)`, [ids.org, `hub-righe-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $2::uuid, 'Rondine righe')`, [ids.ws, ids.org]);
  for (const person of Object.keys(emails) as Person[]) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1::uuid, $2, $3, now())`, [ids[person], emails[person], `Persona ${person}`]);
    // Iscritti da un mese: il numero rosso conta le righe dopo l'inizio dell'iscrizione.
    await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role, created_at) VALUES ($1::uuid, $2::uuid, $3::member_role, now() - interval '30 days')`, [ids.ws, ids[person], ROLE[person]]);
  }
  await q(
    `INSERT INTO use_cases (id, workspace_id, title, description, status, portfolio_review_status, portfolio_kind, code, source, target_quarter)
     VALUES ($1::uuid, $2::uuid, 'Fatture fornitori', 'Problema', 'accepted', 'scored', 'use_case_ai', $3, 'web_proposed', $4)`,
    [ids.card, ids.ws, `RR-${String(1000 + Math.floor(Math.random() * 8000))}`, quarterNow()],
  );
  await q(
    `INSERT INTO use_case_needs (id, workspace_id, type, kind, title, owner_side, status) VALUES ($1::uuid, $2::uuid, 'requisito', 'dato', 'Volumi mensili', 'cliente', 'validata')`,
    [ids.need, ids.ws],
  );
  await q(`INSERT INTO use_case_need_links (need_id, use_case_id) VALUES ($1::uuid, $2::uuid)`, [ids.need, ids.card]);
});

after(async () => {
  for (const key of ENV_KEYS) {
    const value = envBefore[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (!enabled) return;
  await q(`DELETE FROM workspaces WHERE id = $1::uuid`, [ids.ws]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [Object.keys(emails).map((p) => ids[p as Person])]);
});

const keys = { ready: "", suppliers: "" };

test("le righe si vedono da chi le riceve, con i loro link; il contributore niente", opts, async () => {
  keys.ready = `n:${await row("ls", "pronto")}`;
  keys.suppliers = `n:${await row("lead", "fornitori")}`;
  const ls = await payload("ls");
  const ready = ls.entries.find((e) => e.key === keys.ready);
  assert.ok(ready, JSON.stringify(ls.entries));
  assert.equal(ready.title, "Pronto da avviare");
  assert.equal(ready.description, "Non manca niente dal cliente: si può avviare la realizzazione.");
  assert.equal(ready.href, `/dashboard/${ids.ws}/use-cases/${ids.card}?capitolo=realizzazione`);
  assert.match(String(ready.context), /^RR-\d{4} · Fatture fornitori$/);
  assert.equal(ls.newCount, 1);
  const lead = await payload("lead");
  const suppliers = lead.entries.find((e) => e.key === keys.suppliers);
  assert.ok(suppliers);
  assert.equal(suppliers.title, "Autorizza i fornitori");
  assert.equal(suppliers.href, `/dashboard/${ids.ws}/settings#sub-responsabili`);
  assert.equal(lead.newCount, 1);
  assert.equal((await payload("contributor")).entries.length, 0);
});

test("«Pronto da avviare» sparisce appena lo use case non è più pronto, e torna se lo è di nuovo", opts, async () => {
  const visible = async () => (await payload("ls")).entries.some((e) => e.key === keys.ready);
  const before = await q(`SELECT count(*)::int AS n FROM use_case_notifications WHERE workspace_id = $1::uuid`, [ids.ws]);
  await q(`UPDATE use_case_needs SET status = 'parziale' WHERE id = $1::uuid`, [ids.need]);
  assert.equal(await visible(), false, "un'informazione riaperta");
  assert.equal((await payload("ls")).newCount, 0, "e non conta nel numero rosso");
  await q(`UPDATE use_case_needs SET status = 'non_applicabile' WHERE id = $1::uuid`, [ids.need]);
  assert.equal(await visible(), true);
  await q(`UPDATE use_cases SET target_quarter = NULL WHERE id = $1::uuid`, [ids.card]);
  assert.equal(await visible(), false, "«Più avanti»");
  await q(`UPDATE use_cases SET target_quarter = '2020-Q1' WHERE id = $1::uuid`, [ids.card]);
  assert.equal(await visible(), false, "trimestre passato");
  await q(`UPDATE use_cases SET target_quarter = $2, portfolio_kind = 'best_practice' WHERE id = $1::uuid`, [ids.card, quarterNow()]);
  assert.equal(await visible(), false, "Da diffondere");
  await q(`UPDATE use_cases SET portfolio_kind = 'use_case_ai', status = 'in_progress' WHERE id = $1::uuid`, [ids.card]);
  assert.equal(await visible(), false, "in realizzazione");
  await q(`UPDATE use_cases SET status = 'accepted' WHERE id = $1::uuid`, [ids.card]);
  assert.equal(await visible(), true);
  const after = await q(`SELECT count(*)::int AS n FROM use_case_notifications WHERE workspace_id = $1::uuid`, [ids.ws]);
  assert.deepEqual(after, before, "leggere non scrive niente");
});

test("«Autorizza i fornitori» sparisce appena qualcuno dà l'ok", opts, async () => {
  assert.ok((await payload("lead")).entries.some((e) => e.key === keys.suppliers));
  await q(
    `INSERT INTO uc_subprocessor_acks (workspace_id, list_version, statement_text, declared_by_user_id, declared_by_role) VALUES ($1::uuid, '2026-10', 'Autorizzazione di prova', $2::uuid, 'function_lead')`,
    [ids.ws, ids.lead],
  );
  const lead = await payload("lead");
  assert.equal(lead.entries.some((e) => e.key === keys.suppliers), false);
  assert.equal(lead.newCount, 0);
  assert.ok((await payload("ls")).entries.some((e) => e.key === keys.ready), "«Pronto da avviare» non dipende dall'ok");
});
