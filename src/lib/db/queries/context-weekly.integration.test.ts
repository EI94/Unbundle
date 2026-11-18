import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

// (9b) The weekly context of the Monday summary on the package database (RILASCIO-9b-COSTRUZIONE.md §2.9, §5.8, D6):
// `loadWeeklyContext` (context-weekly.ts, next to this file) counts, per workspace, the facts born in the last 7 days
// (all and «Per tutti»), the proposals to confirm, the facts to check and the open commitments due within 7 Rome days, and
// picks up to three client commitments «Per tutti»; another workspace's rows never count. Then one summary row per
// audience goes through `loadDeliveryFacts`, `planDelivery` and `renderEmail` on the same rows.
//
// - With scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> on 127.0.0.1). Invented data
//   (codes XX-…, people «Prova …»), created and deleted here. No model, no e-mail sent.
const url = process.env.DATABASE_URL;
const enabled = process.env.HUB_TEST_ISOLATED === "true" && Boolean(url);
if (enabled) {
  const parsed = new URL(url!);
  if (parsed.hostname !== "127.0.0.1" || process.env.UC_TEST_DATABASE_URL !== url) throw new Error("Hub DB tests need a loopback DATABASE_URL equal to UC_TEST_DATABASE_URL");
  if (!/^\/hub_[a-z0-9][a-z0-9_]{0,39}$/.test(parsed.pathname)) throw new Error("Run this suite only on a package database hub_<id>");
}
const opts = { skip: !enabled };

type Row = Record<string, unknown>;
type WeeklyContext = import("../../uc/notify/dispatch.ts").WeeklyContext;
let q: (text: string, params?: unknown[]) => Promise<Row[]>;
let exec: import("../uc-executor.ts").UcExecutor;
let weekly: typeof import("./context-weekly.ts");

const LS = ["ls.test"];
const ORIGIN = "http://127.0.0.1:53110";
const DAY = 86_400_000;
const MINUTE = 60_000;
const suffix = randomBytes(3).toString("hex");
const ids = {
  orgA: randomUUID(),
  orgB: randomUUID(),
  wsA: randomUUID(),
  wsB: randomUUID(),
  lead: randomUUID(),
  owner: randomUUID(),
  template: randomUUID(),
  caseA: randomUUID(),
  sourceA: randomUUID(),
  sourceB: randomUUID(),
};
/** The time of the suite: rows are dated from here, and the reads run at this instant. */
const NOW = new Date();
let today = "";
let day: (offset: number) => string;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

async function insertFact(ws: string, f: { visibility: "tutti" | "ls"; createdAt: string; status?: "attivo" | "superato" | "ritirato"; needsCheck?: boolean }): Promise<void> {
  const status = f.status ?? "attivo";
  await q(
    `INSERT INTO context_facts (workspace_id, section, statement, basis, visibility, status, origin, needs_check, created_at, last_confirmed_at, ended_at)
     VALUES ($1::uuid, 'lavoro', $2, 'detto', $3, $4, 'manuale', $5, $6::timestamptz, $6::timestamptz, $7::timestamptz)`,
    [ws, `Un fatto di prova del riepilogo ${randomBytes(2).toString("hex")}.`, f.visibility, status, f.needsCheck === true, f.createdAt, status === "attivo" ? null : NOW.toISOString()],
  );
}

async function insertCommitment(
  ws: string,
  c: { statement: string; party: "nostra" | "cliente"; visibility: "tutti" | "ls"; dueOn: string | null; status?: "aperto" | "fatto" | "annullato" },
): Promise<void> {
  const status = c.status ?? "aperto";
  await q(
    `INSERT INTO context_commitments (workspace_id, statement, party, role_label, due_on, status, visibility, origin, closed_at)
     VALUES ($1::uuid, $2, $3, 'Responsabile amministrativo', $4::date, $5, $6, 'manuale', $7::timestamptz)`,
    [ws, c.statement, c.party, c.dueOn, status, c.visibility, status === "aperto" ? null : NOW.toISOString()],
  );
}

async function insertProposal(ws: string, source: string, position: number, status: "aperta" | "confermata" | "scartata" | "superata", kind: "nuovo" | "impegno" = "nuovo"): Promise<void> {
  await q(
    `INSERT INTO context_proposals (workspace_id, source_id, position, kind, statement, basis, section, visibility, party, status, decided_at)
     VALUES ($1::uuid, $2::uuid, $3, $4, 'Una proposta di prova del riepilogo.', 'detto', $5, 'tutti', $6, $7, $8::timestamptz)`,
    [ws, source, position, kind, kind === "impegno" ? null : "lavoro", kind === "impegno" ? "cliente" : null, status, status === "aperta" ? null : NOW.toISOString()],
  );
}

before(async () => {
  if (!enabled) return;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Row[]>;
  const { ensureDbSchema } = await import("../ensure-schema.ts");
  await ensureDbSchema();
  exec = (await import("../uc-executor.ts")).createUcExecutor(sql);
  weekly = await import("./context-weekly.ts");
  const calendar = await import("../../uc/calendar.ts");
  today = calendar.romeDate(NOW);
  day = (offset) => calendar.addCalendarDays(today, offset);

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione A di prova riepilogo', $2), ($3, 'Organizzazione B di prova riepilogo', $4)`, [
    ids.orgA,
    `org-riepilogo-a-${suffix}`,
    ids.orgB,
    `org-riepilogo-b-${suffix}`,
  ]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Cliente A di prova riepilogo'), ($3, $4, 'Cliente B di prova riepilogo')`, [ids.wsA, ids.orgA, ids.wsB, ids.orgB]);
  for (const [id, ws] of [
    [ids.sourceA, ids.wsA],
    [ids.sourceB, ids.wsB],
  ]) {
    await q(
      `INSERT INTO context_sources (id, workspace_id, kind, origin, title, occurred_on, body, body_chars, visibility, read_status, parts_read)
       VALUES ($1::uuid, $2::uuid, 'appunti', 'web', 'Call di prova del riepilogo', $3::date, 'Testo di prova.', 15, 'ls', 'letto', 1)`,
      [id, ws, today],
    );
  }

  // Workspace A. Facts: three novelties in the last 7 days (two «Per tutti», one just inside the week), one just outside,
  // two that are no longer active; two active facts to check, one inactive.
  await insertFact(ids.wsA, { visibility: "tutti", createdAt: ago(2 * DAY) });
  await insertFact(ids.wsA, { visibility: "ls", createdAt: ago(1 * DAY) });
  await insertFact(ids.wsA, { visibility: "tutti", createdAt: ago(7 * DAY - 5 * MINUTE) });
  await insertFact(ids.wsA, { visibility: "tutti", createdAt: ago(7 * DAY + 5 * MINUTE) });
  await insertFact(ids.wsA, { visibility: "tutti", createdAt: ago(3 * DAY), status: "superato" });
  await insertFact(ids.wsA, { visibility: "ls", createdAt: ago(2 * DAY), status: "ritirato" });
  await insertFact(ids.wsA, { visibility: "tutti", createdAt: ago(200 * DAY), needsCheck: true });
  await insertFact(ids.wsA, { visibility: "ls", createdAt: ago(300 * DAY), needsCheck: true });
  await insertFact(ids.wsA, { visibility: "tutti", createdAt: ago(250 * DAY), needsCheck: true, status: "superato" });
  // Proposals: three open (one a commitment), three decided.
  await insertProposal(ids.wsA, ids.sourceA, 1, "aperta");
  await insertProposal(ids.wsA, ids.sourceA, 2, "aperta");
  await insertProposal(ids.wsA, ids.sourceA, 3, "aperta", "impegno");
  await insertProposal(ids.wsA, ids.sourceA, 4, "confermata");
  await insertProposal(ids.wsA, ids.sourceA, 5, "scartata");
  await insertProposal(ids.wsA, ids.sourceA, 6, "superata");
  // Commitments: ours due (one «Solo Lateral Space», one overdue), one ours too late; the client's in the week, overdue,
  // with a person's name, «Solo Lateral Space», on the last day of the week; then too late, closed, cancelled, undated.
  await insertCommitment(ids.wsA, { statement: "Preparare la bozza del preventivo", party: "nostra", visibility: "tutti", dueOn: day(3) });
  await insertCommitment(ids.wsA, { statement: "Rivedere il contratto riservato", party: "nostra", visibility: "ls", dueOn: day(-1) });
  await insertCommitment(ids.wsA, { statement: "Preparare la demo del pilota", party: "nostra", visibility: "tutti", dueOn: day(8) });
  await insertCommitment(ids.wsA, { statement: "Mandare l'organigramma aggiornato", party: "cliente", visibility: "tutti", dueOn: day(-3) });
  await insertCommitment(ids.wsA, { statement: "Inviare a Giulia Esempio il verbale firmato", party: "cliente", visibility: "tutti", dueOn: day(2) });
  await insertCommitment(ids.wsA, { statement: "Solo per noi: ricontrollare il listino", party: "cliente", visibility: "ls", dueOn: day(1) });
  await insertCommitment(ids.wsA, { statement: "Inviare l'esportazione delle fatture", party: "cliente", visibility: "tutti", dueOn: day(5) });
  await insertCommitment(ids.wsA, { statement: "Confermare la data del collaudo", party: "cliente", visibility: "tutti", dueOn: day(6) });
  await insertCommitment(ids.wsA, { statement: "Indicare chi approva gli acquisti", party: "cliente", visibility: "tutti", dueOn: day(7) });
  await insertCommitment(ids.wsA, { statement: "Mandare il calendario delle ferie", party: "cliente", visibility: "tutti", dueOn: day(8) });
  await insertCommitment(ids.wsA, { statement: "Firmare il verbale di avvio", party: "cliente", visibility: "tutti", dueOn: day(0), status: "fatto" });
  await insertCommitment(ids.wsA, { statement: "Mandare il vecchio listino", party: "cliente", visibility: "tutti", dueOn: day(0), status: "annullato" });
  await insertCommitment(ids.wsA, { statement: "Raccogliere le richieste dei reparti", party: "cliente", visibility: "tutti", dueOn: null });

  // Workspace B: its own week, which A never counts.
  await insertFact(ids.wsB, { visibility: "tutti", createdAt: ago(1 * DAY) });
  await insertFact(ids.wsB, { visibility: "tutti", createdAt: ago(1 * DAY) });
  await insertFact(ids.wsB, { visibility: "tutti", createdAt: ago(400 * DAY), needsCheck: true });
  await insertProposal(ids.wsB, ids.sourceB, 1, "aperta");
  await insertCommitment(ids.wsB, { statement: "Inviare il listino aggiornato", party: "cliente", visibility: "tutti", dueOn: day(1) });
  await insertCommitment(ids.wsB, { statement: "Preparare il piano di formazione", party: "nostra", visibility: "tutti", dueOn: day(0) });
});

after(async () => {
  if (!enabled) return;
  await q(`DELETE FROM workspaces WHERE id = ANY($1::uuid[])`, [[ids.wsA, ids.wsB]]);
  await q(`DELETE FROM uc_templates WHERE id = $1`, [ids.template]);
  await q(`DELETE FROM organizations WHERE id = ANY($1::uuid[])`, [[ids.orgA, ids.orgB]]);
  await q(`DELETE FROM users WHERE id = $1`, [ids.lead]);
});

/** Workspace A as `loadWeeklyContext` should read it at NOW. */
const EXPECTED_A = (): WeeklyContext => ({
  novelties: { all: 3, shared: 2 },
  toConfirm: 3,
  toCheck: 2,
  due: { ours: 2, theirs: 6 },
  theirsShared: [
    { statement: "Mandare l'organigramma aggiornato", dueOn: day(-3), visibility: "tutti" },
    { statement: "Inviare l'esportazione delle fatture", dueOn: day(5), visibility: "tutti" },
    { statement: "Confermare la data del collaudo", dueOn: day(6), visibility: "tutti" },
  ],
});

test("the week of a workspace: novelties of the last 7 days, proposals to confirm, facts to check, commitments due within 7 days", opts, async () => {
  const out = await weekly.loadWeeklyContext(exec, [ids.wsA], NOW);
  assert.deepEqual([...out.keys()], [ids.wsA]);
  // Exact numbers: the rows of workspace B (two novelties, a proposal, a fact to check, two commitments due) never count.
  assert.deepEqual(out.get(ids.wsA), EXPECTED_A());
});

test("several workspaces at once: each its own numbers, zeros for a workspace without context", opts, async () => {
  const empty = randomUUID();
  const out = await weekly.loadWeeklyContext(exec, [ids.wsB, ids.wsA.toUpperCase(), empty], NOW);
  assert.deepEqual(out.get(ids.wsA), EXPECTED_A());
  assert.deepEqual(out.get(ids.wsB), {
    novelties: { all: 2, shared: 2 },
    toConfirm: 1,
    toCheck: 1,
    due: { ours: 1, theirs: 1 },
    theirsShared: [{ statement: "Inviare il listino aggiornato", dueOn: day(1), visibility: "tutti" }],
  });
  assert.deepEqual(out.get(empty), { novelties: { all: 0, shared: 0 }, toConfirm: 0, toCheck: 0, due: { ours: 0, theirs: 0 }, theirsShared: [] });
});

test("eight days later: no novelty is left, and the window of the commitments moves with the Rome day", opts, async () => {
  const later = new Date(NOW.getTime() + 8 * DAY);
  const a = (await weekly.loadWeeklyContext(exec, [ids.wsA], later)).get(ids.wsA);
  assert.deepEqual(a?.novelties, { all: 0, shared: 0 });
  // Due by today + 15: every open dated commitment of A, the late ones too; still only three for the Owner, by date.
  assert.deepEqual(a?.due, { ours: 3, theirs: 7 });
  assert.deepEqual(a?.theirsShared, EXPECTED_A().theirsShared);
  assert.equal(a?.toConfirm, 3);
  assert.equal(a?.toCheck, 2);
});

test("a summary row per audience on these rows: Lateral Space gets the numbers and the link, the Owner only «Per tutti»", opts, async () => {
  const { loadDeliveryFacts, rowToClaimed } = await import("./uc-notifications-dispatch.ts");
  const { planDelivery } = await import("../../uc/notify/dispatch.ts");
  const { renderEmail } = await import("../../uc/notify/email-templates.ts");
  const contact = randomUUID();
  await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1, $2, 'Prova responsabile', now())`, [ids.lead, `lead-riepilogo-${suffix}@ls.test`]);
  await q(`INSERT INTO uc_contacts (id, workspace_id, display_name, role_label, email) VALUES ($1::uuid, $2::uuid, 'Responsabile del cliente', 'Direzione', $3)`, [
    contact,
    ids.wsA,
    `owner-riepilogo-${suffix}@cliente.test`,
  ]);
  await q(
    `INSERT INTO uc_templates (id, key, version, name, archetype, definition, definition_hash, restricted_to_workspace_id)
     VALUES ($1::uuid, $2, '1.0.0', 'Template di prova riepilogo', 'prova', '{"confidential": false}'::jsonb, $3, $4::uuid)`,
    [ids.template, `prova.riepilogo_${suffix}`, randomBytes(32).toString("hex"), ids.wsA],
  );
  await q(
    `INSERT INTO uc_cases (id, workspace_id, organization_id, template_id, template_version, code, title, status, setup_completed_at, client_owner_contact_id, readiness)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, '1.0.0', $5, 'Dossier di prova riepilogo', 'raccolta', now(), $6::uuid, '{"per_stato": {"da_chiedere": 1}, "scope_total": 1, "green_pct": 0}'::jsonb)`,
    [ids.caseA, ids.wsA, ids.orgA, ids.template, `XR-${suffix.toUpperCase()}`, contact],
  );
  await q(`INSERT INTO uc_case_members (case_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'ls_lead')`, [ids.caseA, ids.lead]);
  const week = "2026-W47";
  await q(
    `INSERT INTO uc_notifications (workspace_id, recipient_user_id, recipient_contact_id, channel, template_key, payload, dedupe_key)
     VALUES ($1::uuid, $2::uuid, NULL, 'email', 'riepilogo_settimanale', $4::jsonb, $5), ($1::uuid, NULL, $3::uuid, 'email', 'riepilogo_settimanale', $4::jsonb, $6)`,
    [ids.wsA, ids.lead, contact, JSON.stringify({ week }), `riepilogo-prova:${suffix}:u`, `riepilogo-prova:${suffix}:c`],
  );
  const rows = await q(
    `SELECT id, workspace_id, case_id, request_id, recipient_contact_id, recipient_user_id, template_key, payload, attempts, dedupe_key
     FROM uc_notifications WHERE workspace_id = $1::uuid AND template_key = 'riepilogo_settimanale' ORDER BY dedupe_key`,
    [ids.wsA],
  );
  const [toOwner, toLead] = rows.map(rowToClaimed);
  assert.ok(toOwner?.recipientContactId === contact && toLead?.recipientUserId === ids.lead);

  const mailFor = async (n: NonNullable<typeof toOwner>) => {
    const facts = await loadDeliveryFacts(exec, n, { lsDomains: LS, now: NOW });
    assert.equal(facts.weekly?.cases.length, 1);
    assert.deepEqual(facts.weekly?.context, EXPECTED_A());
    const plan = planDelivery(n, facts, { origin: ORIGIN, lsDomains: LS, now: NOW });
    assert.equal(plan.action, "send", plan.action === "send" ? "" : plan.reason);
    return renderEmail((plan as Extract<typeof plan, { action: "send" }>).build(null));
  };

  const lead = await mailFor(toLead!);
  assert.ok(
    lead.text.includes(
      `Contesto del cliente:\n\n- 3 novità questa settimana\n- 3 proposte da confermare\n- 2 fatti da verificare (fermi da più di 6 mesi)\n- Impegni in scadenza: 2 nostri, 6 del cliente\n\nApri il contesto: ${ORIGIN}/dashboard/${ids.wsA}/contesto\n`,
    ),
    lead.text,
  );
  for (const text of ["organigramma", "fatture", "ricontrollare"]) assert.ok(!lead.text.includes(text), `no text of a fact or a commitment for Lateral Space: ${text}`);

  const owner = await mailFor(toOwner!);
  assert.ok(owner.text.includes("Che cosa sappiamo del vostro lavoro:\n\n- 2 fatti nuovi o aggiornati questa settimana\n"), owner.text);
  assert.ok(owner.text.includes("Impegni del vostro team in scadenza:\n\n- Mandare l'organigramma aggiornato · scaduto "), owner.text);
  assert.ok(owner.text.includes("\n- Inviare l'esportazione delle fatture · entro ") && owner.text.includes("\n- Confermare la data del collaudo · entro "));
  for (const text of ["Giulia", "ricontrollare", "approva gli acquisti", "proposte da confermare", "da verificare", "nostri", "Contesto del cliente", "/dashboard/", "/contesto"]) {
    assert.ok(!owner.text.includes(text), `not for the Owner: ${text}`);
  }
  assert.ok(!owner.html.includes("href="));
});
