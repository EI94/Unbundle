import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

// «Cosa serve» sul database di prova (spec di Pierpaolo, 25/10/2026; drizzle/0022): il servizio
// delle esigenze (aggiungere con i legami, modificare con la versione, `done_at`, collegare e
// scollegare, archiviare con il motivo, mai cancellare), i permessi (solo i revisori, area
// accesa) e la lettura per ruolo (`listWorkspaceNeeds`: null a chi non è revisore).
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database del pacchetto
//   hub_<id> su 127.0.0.1) gira sul database di prova; dentro `npm run check` si salta.
// - Dati sintetici, creati e cancellati qui.
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

type NeedsService = typeof import("./needs-service.ts");
type NeedsReads = typeof import("../db/queries/use-case-needs.ts");
type Ctx = import("./service.ts").WriteContext;

let svc: NeedsService;
let reads: NeedsReads;
let q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

const suffix = randomBytes(3).toString("hex");
const ids = {
  org: randomUUID(),
  ws: randomUUID(),
  /** Un altro workspace, con l'area accesa: i legami non lo attraversano. */
  other: randomUUID(),
  /** Area spenta. */
  off: randomUUID(),
  ls: randomUUID(),
  builder: randomUUID(),
  contributor: randomUUID(),
};
const emails = {
  ls: `ls.esigenze.${suffix}@ls.test`,
  builder: `builder.esigenze.${suffix}@cliente.test`,
  contributor: `contributor.esigenze.${suffix}@cliente.test`,
};
type Person = keyof typeof emails;
const ROLE: Record<Person, string> = { ls: "transformation_lead", builder: "function_lead", contributor: "contributor" };

const ENV_KEYS = ["USE_CASE_HUB_WORKSPACES", "UC_LS_EMAIL_DOMAINS", "UC_ENABLED", "UC_WORKSPACE_IDS"] as const;
const envBefore = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function as(person: Person, workspaceId: string = ids.ws): Ctx {
  // Il ruolo scritto qui non conta: il servizio lo rilegge.
  return { workspaceId, actor: { userId: ids[person], role: "exec_sponsor", isLateralSpace: false, kind: "persona" }, channel: "pagina" };
}

function viewer(person: Person) {
  return { userId: ids[person], email: emails[person], emailVerified: true, role: ROLE[person], isLateralSpace: person === "ls" };
}

function ok<T>(result: { ok: true; value: T } | { ok: false; error: string; message: string }, label = "esito"): T {
  if (!result.ok) assert.fail(`${label}: atteso ok, ricevuto ${result.error} (${result.message})`);
  return result.value;
}

function refused(result: { ok: boolean; error?: string; fieldErrors?: Record<string, string> }, error: string, label = "rifiuto") {
  assert.equal(result.ok, false, label);
  assert.equal(result.error, error, label);
  return result.fieldErrors ?? {};
}

let codeSeq = 3000 + Math.floor(Math.random() * 5000);

async function seedUseCase(workspaceId: string = ids.ws): Promise<string> {
  const id = randomUUID();
  await q(
    `INSERT INTO use_cases (id, workspace_id, title, description, status, portfolio_review_status, portfolio_kind, code, source, target_quarter)
     VALUES ($1::uuid, $2::uuid, 'Use case di prova', 'Problema di prova', 'accepted', 'scored', 'use_case_ai', $3, 'web_proposed', '2026-Q4')`,
    [id, workspaceId, `XN-${String(codeSeq++).padStart(4, "0")}`],
  );
  return id;
}

async function needRow(id: string): Promise<Record<string, unknown>> {
  const [row] = await q(`SELECT * FROM use_case_needs WHERE id = $1::uuid`, [id]);
  return row;
}

async function links(id: string): Promise<string[]> {
  const rows = await q(`SELECT use_case_id::text AS id FROM use_case_need_links WHERE need_id = $1::uuid ORDER BY 1`, [id]);
  return rows.map((row) => String(row.id));
}

before(async () => {
  if (!enabled) return;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Record<string, unknown>[]>;
  svc = await import("./needs-service.ts");
  reads = await import("../db/queries/use-case-needs.ts");
  process.env.USE_CASE_HUB_WORKSPACES = [ids.ws, ids.other].join(",");
  process.env.UC_LS_EMAIL_DOMAINS = "ls.test";
  delete process.env.UC_ENABLED;
  delete process.env.UC_WORKSPACE_IDS;

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Organizzazione di prova esigenze', $2)`, [ids.org, `hub-esigenze-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $4::uuid, 'Prova esigenze'), ($2::uuid, $4::uuid, 'Altro workspace'), ($3::uuid, $4::uuid, 'Area spenta')`, [
    ids.ws,
    ids.other,
    ids.off,
    ids.org,
  ]);
  for (const person of Object.keys(emails) as Person[]) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1::uuid, $2, $3, now())`, [ids[person], emails[person], `Persona di prova ${person}`]);
    for (const workspaceId of [ids.ws, ids.other, ids.off]) {
      await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [workspaceId, ids[person], ROLE[person]]);
    }
  }
});

after(async () => {
  for (const key of ENV_KEYS) {
    const value = envBefore[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (!enabled) return;
  await q(`DELETE FROM workspaces WHERE id = ANY($1::uuid[])`, [[ids.ws, ids.other, ids.off]]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [Object.keys(emails).map((p) => ids[p as Person])]);
});

test("aggiungere: valori predefiniti, legami nello stesso statement, done_at se nasce fatta", opts, async () => {
  const a = await seedUseCase();
  const b = await seedUseCase();
  const created = ok(
    await svc.createNeed(as("builder"), { type: "requisito", kind: "accesso", title: `Accesso al gestionale ${suffix}`, ownerLabel: "Ufficio IT", ownerSide: "cliente", dueOn: "2026-11-15" }, { useCaseIds: [a, b.toUpperCase(), a] }),
  );
  assert.equal(created.version, 1);
  const row = await needRow(created.id);
  assert.equal(row.workspace_id, ids.ws);
  assert.equal(row.status, "da_chiedere", "un requisito nasce da chiedere");
  assert.equal(row.done_at, null);
  assert.equal(row.due_is_proposal, false);
  assert.deepEqual(await links(created.id), [a, b].sort(), "doppioni e maiuscole non contano");

  const step = ok(await svc.createNeed(as("ls"), { type: "passo", title: "Kick-off fatto", status: "fatta" }));
  assert.ok((await needRow(step.id)).done_at, "nasce fatta: done_at");
  assert.deepEqual(await links(step.id), []);

  // Uno use case di un altro workspace, o che non c'è: nessuna esigenza, nessun legame.
  const foreign = await seedUseCase(ids.other);
  const before = await q(`SELECT count(*)::int AS n FROM use_case_needs WHERE workspace_id = $1::uuid`, [ids.ws]);
  const errors = refused(await svc.createNeed(as("builder"), { type: "requisito", title: "Non va" }, { useCaseIds: [a, foreign] }), "dati_non_validi");
  assert.equal(errors.useCaseIds, "Use case non trovato.");
  refused(await svc.createNeed(as("builder"), { type: "requisito", title: "Non va" }, { useCaseIds: ["non-un-id"] }), "dati_non_validi");
  const afterRows = await q(`SELECT count(*)::int AS n FROM use_case_needs WHERE workspace_id = $1::uuid`, [ids.ws]);
  assert.equal(afterRows[0].n, before[0].n);

  // Dati non validi: lo stato deve valere per il tipo.
  const wrong = refused(await svc.createNeed(as("builder"), { type: "passo", title: "x", status: "validata" }), "dati_non_validi");
  assert.equal(wrong.status, "Questo stato non vale per questo tipo.");
});

test("chiave di importazione: unica per workspace, libera tra workspace diversi", opts, async () => {
  const key = `imp-${suffix}`;
  ok(await svc.createNeed(as("builder"), { type: "requisito", title: "Prima", importKey: key }));
  const errors = refused(await svc.createNeed(as("builder"), { type: "requisito", title: "Seconda", importKey: key }), "dati_non_validi");
  assert.equal(errors.importKey, "Questa chiave è già usata in questo workspace.");
  ok(await svc.createNeed(as("builder", ids.other), { type: "requisito", title: "Altrove", importKey: key }), "un altro workspace");
  const other = ok(await svc.createNeed(as("builder"), { type: "requisito", title: "Terza" }));
  refused(await svc.updateNeed(as("builder"), other.id, other.version, { importKey: key }), "dati_non_validi");
});

test("modificare: la versione sale di uno, niente se non cambia, versione vecchia superata, done_at segue lo stato", opts, async () => {
  const a = await seedUseCase();
  const created = ok(await svc.createNeed(as("builder"), { type: "requisito", kind: "dato", title: "Estratto delle fatture" }, { useCaseIds: [a] }));
  const same = ok(await svc.updateNeed(as("builder"), created.id, created.version, { title: " Estratto delle fatture ", kind: "dato" }));
  assert.equal(same.version, created.version, "nessun cambio, nessuna versione in più");

  const v2 = ok(await svc.updateNeed(as("builder"), created.id, created.version, { status: "validata", ownerLabel: "Amministrazione" }));
  assert.equal(v2.version, created.version + 1);
  const doneAt = (await needRow(created.id)).done_at;
  assert.ok(doneAt, "a posto: done_at");
  refused(await svc.updateNeed(as("builder"), created.id, created.version, { title: "Vecchia" }), "versione_superata");

  const v3 = ok(await svc.updateNeed(as("ls"), created.id, v2.version, { status: "non_applicabile" }));
  assert.equal(String((await needRow(created.id)).done_at), String(doneAt), "ancora a posto: done_at resta quello di prima");
  const v4 = ok(await svc.updateNeed(as("ls"), created.id, v3.version, { status: "in_verifica" }));
  assert.equal((await needRow(created.id)).done_at, null, "non più a posto: done_at vuoto");

  // Cambiando tipo lo stato riparte; uno stato dell'altro tipo è rifiutato.
  refused(await svc.updateNeed(as("ls"), created.id, v4.version, { status: "fatta" }), "dati_non_validi");
  const v5 = ok(await svc.updateNeed(as("ls"), created.id, v4.version, { type: "passo", dueOn: "2026-12-01", dueIsProposal: true }));
  const row = await needRow(created.id);
  assert.equal(row.type, "passo");
  assert.equal(row.status, "proposta");
  assert.equal(row.due_is_proposal, true);
  const v6 = ok(await svc.updateNeed(as("ls"), created.id, v5.version, { status: "fatta", dueOn: null }));
  assert.equal(v6.version, v5.version + 1);
  assert.ok((await needRow(created.id)).done_at, "passo fatto: done_at");
  assert.equal((await needRow(created.id)).due_on, null, "null toglie la data");

  refused(await svc.updateNeed(as("builder"), randomUUID(), 1, { title: "x" }), "non_trovato");
  refused(await svc.updateNeed(as("builder", ids.other), created.id, v6.version, { title: "x" }), "non_trovato", "di un altro workspace");
});

test("collegare e scollegare: stesso workspace, due volte non fa niente, la versione non cambia", opts, async () => {
  const a = await seedUseCase();
  const b = await seedUseCase();
  const foreign = await seedUseCase(ids.other);
  const created = ok(await svc.createNeed(as("builder"), { type: "requisito", title: "Referente del processo" }, { useCaseIds: [a] }));
  const linked = ok(await svc.linkNeed(as("builder"), created.id, b));
  assert.equal(linked.version, created.version);
  ok(await svc.linkNeed(as("builder"), created.id, b), "già collegata");
  assert.deepEqual(await links(created.id), [a, b].sort());
  refused(await svc.linkNeed(as("builder"), created.id, foreign), "non_trovato", "uno use case di un altro workspace");
  refused(await svc.linkNeed(as("builder", ids.other), created.id, foreign), "non_trovato", "l'esigenza è di un altro workspace");
  assert.deepEqual(await links(created.id), [a, b].sort());

  ok(await svc.unlinkNeed(as("builder"), created.id, a));
  ok(await svc.unlinkNeed(as("builder"), created.id, a), "già scollegata");
  assert.deepEqual(await links(created.id), [b]);
  assert.ok(await needRow(created.id), "scollegare non tocca l'esigenza");
});

test("archiviare: col motivo, mai cancellare; fuori dalle letture; poi non si modifica né si collega", opts, async () => {
  const a = await seedUseCase();
  const created = ok(await svc.createNeed(as("builder"), { type: "requisito", title: `Da archiviare ${suffix}` }, { useCaseIds: [a] }));
  const errors = refused(await svc.archiveNeed(as("builder"), created.id, created.version, "  "), "dati_non_validi");
  assert.equal(errors.archiveReason, "Scrivi perché la archivi.");
  refused(await svc.archiveNeed(as("builder"), created.id, created.version + 5, "Non serve più"), "versione_superata");
  const archived = ok(await svc.archiveNeed(as("builder"), created.id, created.version, "Non serve più"));
  assert.equal(archived.version, created.version + 1);
  const row = await needRow(created.id);
  assert.ok(row.archived_at);
  assert.equal(row.archive_reason, "Non serve più");
  assert.deepEqual(await links(created.id), [a], "i legami restano");

  const list = await reads.listWorkspaceNeeds(ids.ws, viewer("builder"));
  assert.ok(list && !list.some((need) => need.id === created.id), "l'archiviata non si legge");
  const all = await reads.listWorkspaceNeeds(ids.ws, viewer("builder"), { includeArchived: true });
  assert.ok(all?.some((need) => need.id === created.id && need.archiveReason === "Non serve più"));

  const again = refused(await svc.archiveNeed(as("builder"), created.id, archived.version, "Ancora"), "transizione_non_ammessa");
  assert.deepEqual(again, {});
  refused(await svc.updateNeed(as("builder"), created.id, archived.version, { title: "x" }), "transizione_non_ammessa");
  refused(await svc.linkNeed(as("builder"), created.id, await seedUseCase()), "transizione_non_ammessa");
  refused(await svc.unlinkNeed(as("builder"), created.id, a), "transizione_non_ammessa");
});

test("permessi: solo i revisori scrivono e leggono; area spenta; nessuna persona di sistema", opts, async () => {
  const a = await seedUseCase();
  refused(await svc.createNeed(as("contributor"), { type: "requisito", title: "No" }, { useCaseIds: [a] }), "permesso_mancante");
  const created = ok(await svc.createNeed(as("builder"), { type: "requisito", title: "Sì" }, { useCaseIds: [a] }));
  refused(await svc.updateNeed(as("contributor"), created.id, created.version, { title: "No" }), "permesso_mancante");
  refused(await svc.archiveNeed(as("contributor"), created.id, created.version, "No"), "permesso_mancante");
  refused(await svc.linkNeed(as("contributor"), created.id, a), "permesso_mancante");
  refused(await svc.unlinkNeed(as("contributor"), created.id, a), "permesso_mancante");
  refused(await svc.createNeed(as("builder", ids.off), { type: "requisito", title: "Area spenta" }), "area_spenta");
  const system: Ctx = { workspaceId: ids.ws, actor: { userId: null, role: null, isLateralSpace: false, kind: "sistema" }, channel: "script" };
  refused(await svc.createNeed(system, { type: "requisito", title: "Sistema" }), "permesso_mancante");

  assert.equal(await reads.listWorkspaceNeeds(ids.ws, viewer("contributor")), null, "il contributore non riceve nulla");
  assert.equal(await reads.getWorkspaceNeed(ids.ws, created.id, viewer("contributor")), null);
  const mine = await reads.getWorkspaceNeed(ids.ws, created.id, viewer("ls"));
  assert.equal(mine?.title, "Sì");
  assert.deepEqual(mine?.useCaseIds, [a]);
});

test("lettura: gli use case collegati solo dello stesso workspace, per codice; le esigenze del workspace e basta", opts, async () => {
  const later = await seedUseCase();
  const first = await seedUseCase();
  const foreign = await seedUseCase(ids.other);
  const created = ok(await svc.createNeed(as("builder"), { type: "requisito", title: `Ordine ${suffix}` }, { useCaseIds: [first, later] }));
  // Un legame scritto a mano verso un altro workspace non si legge.
  await q(`INSERT INTO use_case_need_links (need_id, use_case_id) VALUES ($1::uuid, $2::uuid)`, [created.id, foreign]);
  const tail = String(Math.floor(Math.random() * 1000)).padStart(3, "0");
  await q(`UPDATE use_cases SET code = $2 WHERE id = $1::uuid`, [first, `XN-1${tail}`]);
  await q(`UPDATE use_cases SET code = $2 WHERE id = $1::uuid`, [later, `XN-9${tail}`]);
  const need = await reads.getWorkspaceNeed(ids.ws, created.id, viewer("builder"));
  assert.deepEqual(need?.useCaseIds, [first, later]);
  const list = (await reads.listWorkspaceNeeds(ids.ws, viewer("builder"))) ?? [];
  assert.ok(list.length > 0);
  assert.ok(list.every((row) => typeof row.createdAt === "string" && row.createdAt.endsWith("Z")));
  const elsewhere = (await reads.listWorkspaceNeeds(ids.other, viewer("builder"))) ?? [];
  assert.ok(!elsewhere.some((row) => row.id === created.id));
});
