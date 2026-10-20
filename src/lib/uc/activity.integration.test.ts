import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { createUcExecutor, type UcExecutor } from "../db/uc-executor.ts";
import { applyTemplateLoad } from "../db/queries/uc-templates.ts";
import { addCaseMember, commandContextFor, createCase, loadUserContext } from "../db/queries/uc-cases.ts";
import { loadActivityExport, loadActivityPage, loadPrivacyPage } from "../db/queries/uc-events.ts";
import { planTemplateLoad } from "./template/load.ts";
import { findForbidden } from "./views/copy-guard.ts";
import { ACTIVITY_PAGE_SIZE, EMPTY_AUDIT_FILTER, activityDays, parseAuditFilter } from "./views/audit.ts";

// Opt-in integration suite for the Activity and Privacy reads of C7 (DESIGN
// §3.10, §3.12), on the isolated local harness only. Same guard as the other uc
// integration suites:
//   UC_TEST_DATABASE_URL=postgresql://uc_test@127.0.0.1:55449/<own database> UC_TEST_ISOLATED=true \
//   NODE_OPTIONS=--require=./scripts/uc-test/local-neon.cjs node --no-warnings --test --test-concurrency=1 src/lib/uc/activity.integration.test.ts
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
  unverified: randomUUID(),
  contact: randomUUID(),
  personalFile: randomUUID(),
};
const exampleText = readFileSync(new URL("../../../templates/uc/esempio.minimo/1.0.0.json", import.meta.url), "utf8");
const state: { caseId: string; items: Map<string, { id: string; title: string }> } = { caseId: "", items: new Map() };

type Actor = { type: "utente"; userId: string } | { type: "referente" } | { type: "sistema" };

async function event(type: string, actor: Actor, at: string, payload: Record<string, unknown> = {}, states: { from?: string; to?: string } = {}) {
  await q(
    `INSERT INTO uc_events (workspace_id, case_id, actor_type, actor_user_id, actor_contact_id, event_type, payload, from_state, to_state, created_at)
     VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5::uuid, $6, $7::jsonb, $8, $9, $10::timestamptz)`,
    [ids.ws, state.caseId, actor.type, actor.type === "utente" ? actor.userId : null, actor.type === "referente" ? ids.contact : null, type, JSON.stringify(payload), states.from ?? null, states.to ?? null, at],
  );
}

const query = (over: Partial<Parameters<typeof loadActivityPage>[1]> = {}) => ({
  workspaceId: ids.ws,
  caseId: state.caseId,
  filter: EMPTY_AUDIT_FILTER,
  clientView: false,
  lsDomains: LS_DOMAINS,
  ...over,
});

before(async () => {
  if (!sql) return;
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Org prova attività', $2)`, [ids.org, `uc-act-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $3::uuid, 'Prova attività'), ($2::uuid, $3::uuid, 'Altra attività')`, [ids.ws, ids.otherWs, ids.org]);
  // L'analista senza nome (si vede l'email solo a Lateral Space); un account con un dominio di Lateral Space ma senza verifica non è Lateral Space.
  await q(
    `INSERT INTO users (id, email, email_verified, name) VALUES
       ($1::uuid, $6, now(), 'Luca Verdi'), ($2::uuid, $7, now(), NULL), ($3::uuid, $8, now(), 'Anna Bianchi'),
       ($4::uuid, $9, now(), 'Paola Neri'), ($5::uuid, $10, NULL, 'Non verificato')`,
    [
      ids.lead,
      ids.analyst,
      ids.owner,
      ids.privacy,
      ids.unverified,
      `act-lead-${suffix}@ls.test`,
      `act-analista-${suffix}@ls.test`,
      `act-owner-${suffix}@cliente.test`,
      `act-privacy-${suffix}@cliente.test`,
      `act-nonverificato-${suffix}@ls.test`,
    ],
  );
  await q(
    `INSERT INTO memberships (user_id, organization_id, role) VALUES ($1::uuid, $5::uuid, 'transformation_lead'), ($2::uuid, $5::uuid, 'analyst'),
       ($3::uuid, $5::uuid, 'contributor'), ($4::uuid, $5::uuid, 'contributor')`,
    [ids.lead, ids.analyst, ids.owner, ids.privacy, ids.org],
  );
  const value = JSON.parse(exampleText) as Record<string, unknown>;
  value.key = `prova.attivita_${suffix}`;
  const plan = planTemplateLoad(JSON.stringify(value), { restrictToWorkspaceId: ids.ws });
  assert.ok(plan.ok);
  const loaded = await applyTemplateLoad(exec!, plan.plan, { actorUserId: ids.lead, publish: true });
  assert.ok(loaded.ok, loaded.ok ? "" : loaded.message);
  const leadUser = await loadUserContext(exec!, ids.lead, LS_DOMAINS);
  const created = await createCase(exec!, {
    workspaceId: ids.ws,
    user: leadUser!,
    canReviewWorkspacePortfolio: true,
    input: { templateId: loaded.value.templateId, code: `ATT-${suffix}`.toUpperCase(), title: "Caso dell'attività" },
  });
  assert.ok(created.ok, created.ok ? "" : created.message);
  state.caseId = created.value.caseId;
  for (const r of await q(`SELECT id, key, title FROM uc_items WHERE case_id = $1::uuid`, [state.caseId])) state.items.set(String(r.key), { id: String(r.id), title: String(r.title) });
  const ctx = await commandContextFor(exec!, { workspaceId: ids.ws, caseId: state.caseId, userId: ids.lead, lsDomains: LS_DOMAINS });
  assert.ok(ctx.ok);
  for (const [userId, role] of [
    [ids.analyst, "ls_analista"],
    [ids.owner, "owner_cliente"],
    [ids.privacy, "approvatore_privacy"],
  ] as const) {
    const r = await addCaseMember(exec!, ctx.value, { userId, role });
    assert.ok(r.ok, r.ok ? "" : r.message);
  }
  await q(`INSERT INTO uc_contacts (id, workspace_id, display_name, email, template_role_key) VALUES ($1::uuid, $2::uuid, 'Mario Rossi', $3, 'resp_servizio')`, [
    ids.contact,
    ids.ws,
    `act-ref-${suffix}@cliente.test`,
  ]);
  await q(
    `INSERT INTO uc_files (id, workspace_id, case_id, item_id, file_name, mime, size_bytes, sha256, storage_zone, encryption_key_ref, privacy_class, max_size_bytes, scan_status, content_scanned)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'turni-nome-cognome.csv', 'text/csv', 50, $5, 'personale', 'UC_PERSONAL_ZONE_KEY/v1/hkdf', 'personale', 1000, 'pulito', true)`,
    [ids.personalFile, ids.ws, state.caseId, state.items.get("q.servizio.01")!.id, "a".repeat(64)],
  );

  // Attività su più giorni: persone di Lateral Space e del cliente, referente, sistema.
  await event("voce.stato_cambiato", { type: "utente", userId: ids.lead }, "2026-10-01T07:15:00Z", { item_key: "q.servizio.01", trigger: "valida" }, { from: "in_verifica", to: "validata" });
  await event("link.aperto", { type: "referente" }, "2026-10-01T09:00:00Z");
  await event("informativa.vista", { type: "referente" }, "2026-10-01T09:05:00Z", { notice_version: "v1" });
  for (let n = 0; n < 5; n++) await event("risposta.inviata", { type: "referente" }, `2026-10-02T0${n}:10:00Z`, { item_key: "q.servizio.01", version: n + 1 });
  for (let n = 0; n < 2; n++) await event("risposta.inviata", { type: "referente" }, `2026-10-03T0${n}:10:00Z`, { item_key: "q.servizio.02", version: n + 1 });
  await event("blocco.firmato", { type: "utente", userId: ids.privacy }, "2026-10-03T10:00:00Z", { blocker_key: "a8", ruolo: "approvatore_privacy", complete: false });
  await event("commento.creato", { type: "utente", userId: ids.unverified }, "2026-10-03T11:00:00Z", { item_key: "q.servizio.02", kind: "nota", visibility: "interno" });
  await event("membro.zona_personale", { type: "utente", userId: ids.lead }, "2026-10-04T08:00:00Z", { action: "proposta", role: "ls_analista" });
  await event("risposta.letta_personale", { type: "utente", userId: ids.analyst }, "2026-10-04T10:00:00Z", { item_key: "q.servizio.01", version: 1 });
  await event("file.scaricato", { type: "utente", userId: ids.analyst }, "2026-10-04T11:00:00Z", { zona: "personale", mime: "text/csv" });
  await event("file.scaricato", { type: "utente", userId: ids.owner }, "2026-10-04T11:30:00Z", { zona: "standard", mime: "application/pdf" });
  // Più di una pagina: 55 notifiche del sistema il 5 ottobre.
  await q(
    `INSERT INTO uc_events (workspace_id, case_id, actor_type, event_type, payload, created_at)
     SELECT $1::uuid, $2::uuid, 'sistema', 'notifica.inviata', '{"channel": "email"}'::jsonb, '2026-10-05T08:00:00Z'::timestamptz + make_interval(secs => g)
     FROM generate_series(1, 55) AS g`,
    [ids.ws, state.caseId],
  );
});

after(async () => {
  if (!sql) return;
  await q(`DELETE FROM workspaces WHERE id IN ($1::uuid, $2::uuid)`, [ids.ws, ids.otherWs]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id IN ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid)`, [ids.lead, ids.analyst, ids.owner, ids.privacy, ids.unverified]);
});

test("activity for the case lead: 50 events a page, item titles, names and «Lateral Space» from the verified domain", opts, async () => {
  const first = await loadActivityPage(exec!, query());
  assert.equal(first.rows.length, ACTIVITY_PAGE_SIZE);
  assert.equal(first.daily, null);
  const second = await loadActivityPage(exec!, query({ filter: parseAuditFilter({ pagina: "2" }, false) }));
  assert.equal(first.total, second.total);
  assert.equal(first.rows.length + second.rows.length, first.total, "two pages hold every event");
  assert.equal(new Set([...first.rows, ...second.rows].map((r) => r.id)).size, first.total, "no event on both pages");

  const all = [...first.rows, ...second.rows];
  const validated = all.find((r) => r.type === "voce.stato_cambiato");
  assert.equal(validated?.itemTitle, state.items.get("q.servizio.01")!.title);
  assert.equal(validated?.actorName, "Luca Verdi");
  assert.equal(validated?.actorIsLs, true);
  assert.equal(all.find((r) => r.type === "risposta.letta_personale")?.actorName, `act-analista-${suffix}@ls.test`, "the email only when the name is missing, only for Lateral Space");
  assert.equal(all.find((r) => r.type === "commento.creato")?.actorIsLs, false, "an unverified Lateral Space domain is not Lateral Space");
  assert.equal(all.find((r) => r.type === "file.scaricato" && r.actorName === "Anna Bianchi")?.actorIsLs, false);
  const referent = all.filter((r) => r.actorType === "referente");
  assert.ok(referent.length >= 7 && referent.every((r) => r.actorName === "Mario Rossi"));
  assert.ok(all.some((r) => r.type === "link.aperto") && all.some((r) => r.type === "informativa.vista"));

  const days = activityDays(all, { now: new Date("2026-10-05T12:00:00Z"), audience: "ls" });
  const oct2 = days.find((d) => d.key === "2026-10-02");
  assert.deepEqual(oct2?.lines.map((l) => [l.who, l.text, l.count]), [["Mario Rossi", "ha risposto a 5 domande", 5]]);
  const oct5 = days.find((d) => d.key === "2026-10-05");
  assert.equal(oct5?.label, "Oggi");
  assert.deepEqual(oct5?.lines.map((l) => [l.who, l.text, l.count]), [[null, "55 email inviate.", 55]], "one line for the automatic emails of the day");
});

test("activity for client roles: the art. 15.4 filter in the query, daily answers in the same round-trip, never an email", opts, async () => {
  const client = await loadActivityPage(exec!, query({ clientView: true }));
  assert.ok(client.rows.length > 0);
  assert.ok(client.rows.every((r) => r.actorType !== "referente"));
  assert.ok(!client.rows.some((r) => r.type === "link.aperto" || r.type === "informativa.vista"));
  assert.ok(client.rows.every((r) => !r.actorName?.includes("@")), "no email to the client");
  assert.deepEqual(client.daily, { days: [{ day: "2026-10-02", count: 5 }], below: 0 }, "a day with 2 answers stays hidden");
  const days = activityDays(client.rows, { now: new Date("2026-10-06T12:00:00Z"), audience: "cliente" });
  for (const line of days.flatMap((d) => d.lines)) assert.deepEqual(findForbidden(`${line.who ?? ""} ${line.text}`, "cliente"), [], line.text);

  // L'export ha tutte le righe del filtro, nello stesso ordine della pagina (che ne mostra 50).
  const exported = await loadActivityExport(exec!, query({ clientView: true }));
  assert.equal(exported.rows.length, client.total);
  assert.deepEqual(
    exported.rows.slice(0, client.rows.length).map((r) => r.id),
    client.rows.map((r) => r.id),
  );
  assert.deepEqual(exported.daily, client.daily);
  const narrow = await loadActivityPage(exec!, query({ clientView: true, filter: parseAuditFilter({ dal: "2026-10-03", al: "2026-10-03" }, true) }));
  assert.deepEqual(narrow.daily, { days: [], below: 0 });
  // With a period only the days from 5 up leave the database, never a sum of the smaller ones.
  const fromFirst = await loadActivityPage(exec!, query({ clientView: true, filter: parseAuditFilter({ dal: "2026-10-01" }, true) }));
  assert.deepEqual(fromFirst.daily, { days: [{ day: "2026-10-02", count: 5 }], below: 0 });
  assert.deepEqual((await loadActivityExport(exec!, query({ clientView: true, filter: parseAuditFilter({ al: "2026-10-03" }, true) }))).daily, { days: [{ day: "2026-10-02", count: 5 }], below: 0 });
  // A «Tipo» that excludes the answers removes the section; «Risposte» keeps it.
  assert.equal((await loadActivityPage(exec!, query({ clientView: true, filter: parseAuditFilter({ tipo: "voce" }, true) }))).daily, null);
  assert.equal((await loadActivityExport(exec!, query({ clientView: true, filter: parseAuditFilter({ tipo: "voce" }, true) }))).daily, null);
  assert.deepEqual((await loadActivityPage(exec!, query({ clientView: true, filter: parseAuditFilter({ tipo: "risposta" }, true) }))).daily, { days: [{ day: "2026-10-02", count: 5 }], below: 0 });
});

test("«Chi»: Lateral Space and client people from the verified domain, automatic events, nothing from another workspace", opts, async () => {
  const ls = await loadActivityExport(exec!, query({ filter: parseAuditFilter({ chi: "ls" }, false) }));
  assert.ok(ls.rows.length > 0 && ls.rows.every((r) => r.actorType === "utente" && r.actorIsLs));
  const people = await loadActivityExport(exec!, query({ filter: parseAuditFilter({ chi: "cliente" }, false) }));
  assert.deepEqual([...new Set(people.rows.map((r) => r.actorName))].sort(), ["Anna Bianchi", "Non verificato", "Paola Neri"]);
  const auto = await loadActivityPage(exec!, query({ filter: parseAuditFilter({ chi: "sistema", tipo: "notifica" }, false) }));
  assert.equal(auto.total, 55);
  const refs = await loadActivityExport(exec!, query({ filter: parseAuditFilter({ chi: "referenti" }, false) }));
  assert.ok(refs.rows.length >= 7 && refs.rows.every((r) => r.actorType === "referente"));
  const clientRefs = await loadActivityExport(exec!, query({ clientView: true, filter: parseAuditFilter({ chi: "referenti" }, true) }));
  assert.ok(clientRefs.rows.every((r) => r.actorType !== "referente"), "the client cannot ask for referents");
  const clientDaily = await loadActivityPage(exec!, query({ clientView: true, filter: parseAuditFilter({ chi: "ls" }, true) }));
  assert.equal(clientDaily.daily, null, "no daily answers section with a «Chi» filter");
  assert.deepEqual((await loadActivityPage(exec!, query({ workspaceId: ids.otherWs }))).rows, []);
  assert.deepEqual((await loadActivityPage(exec!, query({ caseId: "non-un-uuid" }))).rows, []);
});

test("privacy page: privacy form, questions by class, personal files and access log with titles, never keys, names of files or emails", opts, async () => {
  const p = await loadPrivacyPage(exec!, { workspaceId: ids.ws, caseId: state.caseId, lsDomains: LS_DOMAINS });
  assert.ok(p);
  assert.equal(p.dataMode, "solo_sintetici");
  assert.equal(p.privacyDesignated, false);
  assert.equal(p.a8?.key, "a8");
  assert.equal(p.a8?.status, "attivo");
  const total = Object.values(p.classCounts.all).reduce((n, x) => n + (x ?? 0), 0);
  assert.equal(total, state.items.size);
  assert.deepEqual(
    p.personalFiles.map((f) => [f.id, f.itemTitle, f.mime]),
    [[ids.personalFile, state.items.get("q.servizio.01")!.title, "text/csv"]],
  );
  assert.deepEqual(p.accessLog.map((e) => e.type).sort(), ["file.scaricato", "membro.zona_personale", "risposta.letta_personale"]);
  const read = p.accessLog.find((e) => e.type === "risposta.letta_personale");
  assert.equal(read?.itemTitle, state.items.get("q.servizio.01")!.title);
  assert.equal(read?.actorName, null, "a person without a name has no email in its place");
  assert.equal(p.accessLog.find((e) => e.type === "membro.zona_personale")?.action, "proposta");
  // Members, usable files and the case context come in the same round-trip; Lateral Space from the verified domain, no email.
  assert.equal(p.context.caseId, state.caseId);
  assert.ok(Object.keys(p.context.roleLabels).length > 0);
  const lead = p.members.find((m) => m.userId === ids.lead);
  assert.equal(lead?.role, "ls_lead");
  assert.equal(lead?.isLateralSpace, true);
  assert.equal(lead?.email, null);
  assert.equal(p.members.find((m) => m.userId === ids.owner)?.isLateralSpace, false);
  assert.ok(Array.isArray(p.usableFiles));
  assert.ok(!p.usableFiles.some((f) => f.id === ids.personalFile), "personal files are never offered for the privacy form");
  const text = JSON.stringify(p);
  assert.doesNotMatch(text, /q\.servizio\.\d+/, "no item keys");
  assert.doesNotMatch(text, /turni-nome-cognome/, "no names of personal files");
  assert.doesNotMatch(text, /@/, "no emails");
  assert.equal(await loadPrivacyPage(exec!, { workspaceId: ids.otherWs, caseId: state.caseId, lsDomains: LS_DOMAINS }), null);
  assert.equal(await loadPrivacyPage(exec!, { workspaceId: ids.ws, caseId: "non-un-uuid", lsDomains: LS_DOMAINS }), null);
});
