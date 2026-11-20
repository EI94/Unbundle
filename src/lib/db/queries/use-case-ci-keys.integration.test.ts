import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";

// Le chiavi della CI sul database di prova dell'hub (rilascio 8.2b, RILASCIO-8.2b-SPEC.md §2.2, §2.5, §2.8, §3.2):
// - la chiave: `ub_ci_` e 32 byte, in tabella solo l'impronta e il prefisso; 180 giorni; mai scambiata con un token della CLI;
// - chi la gestisce (D6): chi gestisce il workspace e chi è responsabile di un caso aperto del repository, di Lateral Space
//   con l'e-mail verificata; sviluppatori di Lateral Space, chi costruisce da fuori, il cliente, chi segue un corso mai;
// - l'ambito: i casi del repository della chiave nel suo workspace; chiusi, in pausa, senza dossier, di un altro
//   repository o di un altro workspace no;
// - la rotazione: la vecchia vale al più 7 giorni, il primo invio con la nuova la revoca, mai più di due chiavi vive, la
//   seconda rotazione con la nuova mai usata si rifiuta, due rotazioni insieme ne fanno una;
// - le revoche: a mano, la chiave in un indirizzo, il repository senza casi, il workspace cancellato;
// - il cron: l'avviso a 14 giorni una volta sola, solo a chi gestisce le chiavi; le chiavi finite da più di 12 mesi;
// - mai `ub_ci_` nei log.
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su 127.0.0.1).
//   Dati sintetici, creati e cancellati qui.
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

type Row = Record<string, unknown>;
type Store = typeof import("./use-case-ci-keys.ts");
let q: (text: string, params?: unknown[]) => Promise<Row[]>;
let exec: import("../uc-executor.ts").UcExecutor;
let store: Store;

const suffix = randomBytes(3).toString("hex");
const SUFFIX = suffix.toUpperCase();
const LS = ["ls.test"];
const REPO = `Voltaen/esempio-rosa-${suffix}`;
const OTHER_REPO = `Voltaen/esempio-blu-${suffix}`;
const LONE_REPO = `Voltaen/esempio-verde-${suffix}`;
const ids = {
  org: randomUUID(),
  ws: randomUUID(),
  wsB: randomUUID(),
  template: randomUUID(),
  uc1: randomUUID(),
  uc2: randomUUID(),
  uc3: randomUUID(),
  uc4: randomUUID(),
  uc5: randomUUID(),
  uc6: randomUUID(),
  ucB: randomUUID(),
  case1: randomUUID(),
  case2: randomUUID(),
  case3: randomUUID(),
  case4: randomUUID(),
  case6: randomUUID(),
  caseB: randomUUID(),
  manager: randomUUID(),
  lead: randomUUID(),
  dev: randomUUID(),
  outside: randomUUID(),
  client: randomUUID(),
  unverified: randomUUID(),
  learner: randomUUID(),
};
type Person = "manager" | "lead" | "dev" | "outside" | "client" | "unverified" | "learner";
const PEOPLE: readonly Person[] = ["manager", "lead", "dev", "outside", "client", "unverified", "learner"];
const EMAIL: Record<Person, string> = {
  manager: `manager-${suffix}@ls.test`,
  lead: `responsabile-${suffix}@ls.test`,
  dev: `sviluppo-${suffix}@ls.test`,
  outside: `da-fuori-${suffix}@esterni.test`,
  client: `cliente-${suffix}@cliente.test`,
  unverified: `non-verificata-${suffix}@ls.test`,
  learner: `corso-${suffix}@ls.test`,
};
// Chi gestisce il workspace per Lateral Space ha un ruolo da revisore (`lsManager` della pagina «Agent Factory»); il
// responsabile del caso e lo sviluppatore di Lateral Space qui no, così conta solo il loro ruolo nel caso.
const ROLE: Record<Person, string> = {
  manager: "transformation_lead",
  lead: "contributor",
  dev: "contributor",
  outside: "analyst",
  client: "transformation_lead",
  unverified: "transformation_lead",
  learner: "learner",
};

const logged: string[] = [];
const consoleBefore = { log: console.log, warn: console.warn, error: console.error, info: console.info };

const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const actor = (person: Person) => ({ userId: ids[person] });
const keyRows = (repo = REPO) => q(`SELECT * FROM use_case_ci_keys WHERE workspace_id = $1 AND lower(repo) = lower($2) ORDER BY created_at, id`, [ids.ws, repo]);
const notices = (template: string, keyId: string) =>
  q(`SELECT recipient_user_id::text AS user_id FROM uc_notifications WHERE template_key = $1 AND payload->>'keyId' = $2 ORDER BY recipient_user_id`, [template, keyId]);
const usersOf = (...people: Person[]) => people.map((p) => ids[p]).sort();

function okValue<T>(r: { ok: true; value: T } | { ok: false; code: string; message: string }, label: string): T {
  if (!r.ok) assert.fail(`${label}: atteso ok, ricevuto ${r.code}`);
  return r.value;
}

function refused(r: { ok: boolean; code?: string }, code: string, label: string): void {
  assert.equal(r.ok, false, `${label}: atteso un rifiuto ${code}`);
  assert.equal((r as { code: string }).code, code, label);
}

async function clearKeys(): Promise<void> {
  await q(`DELETE FROM uc_notifications WHERE workspace_id = $1 AND template_key LIKE 'chiave_ci_%'`, [ids.ws]);
  await q(`DELETE FROM use_case_ci_keys WHERE workspace_id IN ($1, $2)`, [ids.ws, ids.wsB]);
}

before(async () => {
  if (!enabled) return;
  // Ogni riga dei log della suite, per l'ultima prova: mai una chiave.
  for (const level of ["log", "warn", "error", "info"] as const) {
    console[level] = (...args: unknown[]) => {
      logged.push(args.map((a) => (a instanceof Error ? `${a.name} ${a.message} ${a.stack ?? ""}` : typeof a === "string" ? a : JSON.stringify(a))).join(" "));
      consoleBefore[level](...args);
    };
  }
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Row[]>;
  await (await import("../ensure-schema.ts")).ensureDbSchema();
  exec = (await import("../uc-executor.ts")).ucExecutorForUrl(url!);
  store = await import("./use-case-ci-keys.ts");

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione di prova CI', $2)`, [ids.org, `org-ci-${suffix}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Cliente di prova CI'), ($3, $2, 'Altro cliente di prova CI')`, [ids.ws, ids.org, ids.wsB]);
  for (const person of PEOPLE) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1, $2, $3, ${person === "unverified" ? "NULL" : "now()"})`, [ids[person], EMAIL[person], `Persona ${person}`]);
    await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [ids.ws, ids[person], ROLE[person]]);
  }
  await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'transformation_lead'::member_role)`, [ids.wsB, ids.manager]);
  await q(
    `INSERT INTO use_cases (id, workspace_id, title, code) VALUES
       ($1, $8, 'Rosa aperto', $9), ($2, $8, 'Rosa chiuso', $10), ($3, $8, 'Rosa in pausa', $11), ($4, $8, 'Blu aperto', $12),
       ($5, $8, 'Rosa senza dossier', $13), ($6, $8, 'Verde aperto', $14), ($7, $15, 'Rosa di un altro cliente', $16)`,
    [ids.uc1, ids.uc2, ids.uc3, ids.uc4, ids.uc5, ids.uc6, ids.ucB, ids.ws, "XX-0001", "XX-0002", "XX-0003", "XX-0004", "XX-0005", "XX-0006", ids.wsB, "XX-0101"],
  );
  await q(
    `INSERT INTO uc_templates (id, key, version, name, archetype, definition, definition_hash)
     VALUES ($1::uuid, $2, '1.0.0', 'Template di prova CI', 'prova', '{"confidential": false}'::jsonb, $3)`,
    [ids.template, `prova.ci_${suffix}`, randomBytes(32).toString("hex")],
  );
  const dossiers: [string, string, string, string][] = [
    [ids.case1, ids.ws, ids.uc1, "pronto_sviluppo"],
    [ids.case2, ids.ws, ids.uc2, "chiuso"],
    [ids.case3, ids.ws, ids.uc3, "sospeso"],
    [ids.case4, ids.ws, ids.uc4, "in_sviluppo"],
    [ids.case6, ids.ws, ids.uc6, "in_sviluppo"],
    [ids.caseB, ids.wsB, ids.ucB, "in_sviluppo"],
  ];
  for (const [caseId, ws, uc, status] of dossiers) {
    await q(
      `INSERT INTO uc_cases (id, workspace_id, organization_id, portfolio_use_case_id, template_id, template_version, code, title, status, status_before_suspension, setup_completed_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, '1.0.0', $6, 'Dossier di prova CI', $7, CASE WHEN $7 = 'sospeso' THEN 'in_sviluppo' END, now())`,
      [caseId, ws, ids.org, uc, ids.template, `XC-${SUFFIX}-${caseId.slice(0, 4).toUpperCase()}`, status],
    );
  }
  // Il responsabile del caso aperto del repository; lo sviluppatore di Lateral Space; chi costruisce da fuori; il cliente.
  await q(`INSERT INTO uc_case_members (case_id, user_id, role) VALUES ($1, $2, 'ls_lead'), ($1, $3, 'ls_sviluppatore'), ($1, $4, 'ls_sviluppatore'), ($1, $5, 'owner_cliente')`, [
    ids.case1,
    ids.lead,
    ids.dev,
    ids.outside,
    ids.client,
  ]);
  // Lo stesso responsabile, in un caso chiuso di un altro repository: lì non gestisce le chiavi.
  await q(`INSERT INTO uc_case_members (case_id, user_id, role) VALUES ($1, $2, 'ls_lead')`, [ids.case6, ids.dev]);
  await q(`UPDATE uc_cases SET status = 'chiuso' WHERE id = $1`, [ids.case6]);
  const register = (uc: string, ws: string, repo: string, folder: string) => q(`INSERT INTO use_case_repos (use_case_id, workspace_id, repo, folder) VALUES ($1, $2, $3, $4)`, [uc, ws, repo, folder]);
  await register(ids.uc1, ids.ws, REPO, "casi/xx-0001");
  await register(ids.uc2, ids.ws, REPO, "casi/xx-0002");
  await register(ids.uc3, ids.ws, REPO, "casi/xx-0003");
  await register(ids.uc5, ids.ws, REPO.toLowerCase(), "casi/xx-0005");
  await register(ids.uc4, ids.ws, OTHER_REPO, "casi/xx-0004");
  await register(ids.uc6, ids.ws, LONE_REPO, "casi/xx-0006");
  await register(ids.ucB, ids.wsB, REPO, "casi/xx-0101");
  await q(`INSERT INTO use_case_projects (use_case_id, workspace_id, version, status, approved_at) VALUES ($1, $2, 1, 'approvato', now())`, [ids.uc1, ids.ws]);
});

after(async () => {
  for (const level of ["log", "warn", "error", "info"] as const) console[level] = consoleBefore[level];
  if (!enabled) return;
  await q(`DELETE FROM workspaces WHERE id IN ($1, $2)`, [ids.ws, ids.wsB]);
  await q(`DELETE FROM uc_templates WHERE id = $1`, [ids.template]);
  await q(`DELETE FROM organizations WHERE id = $1`, [ids.org]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [PEOPLE.map((p) => ids[p])]);
});

test("la chiave: ub_ci_ e 32 byte, in tabella solo impronta e prefisso, 180 giorni; l'e-mail a chi gestisce le chiavi, tranne chi l'ha creata", opts, async () => {
  await clearKeys();
  assert.equal(await store.ciKeysStoreReady(exec), true);
  const issued = okValue(await store.createCiKey(exec, { workspaceId: ids.ws, repo: ` ${REPO.toLowerCase()}.git `, actor: actor("manager"), lsDomains: LS }), "creata");
  assert.match(issued.key, /^ub_ci_[A-Za-z0-9_-]{43}$/);
  assert.equal(issued.prefix, issued.key.slice(0, 10));
  assert.equal(issued.repo, REPO, "il repository come è registrato");
  assert.equal(issued.replaced, null);
  const days = (issued.expiresAt.getTime() - issued.createdAt.getTime()) / 86_400_000;
  assert.ok(Math.abs(days - 180) < 0.01, `180 giorni, non ${days}`);
  const [row] = await keyRows();
  assert.equal(row.token_hash, sha(issued.key), "solo l'impronta SHA-256");
  assert.equal(row.token_prefix, issued.prefix);
  assert.ok(!Object.values(row).some((v) => typeof v === "string" && v.includes(issued.key.slice(10))), "la chiave non c'è in nessuna colonna");
  assert.equal(row.created_by_user_id, ids.manager);
  assert.equal(row.use_case_id, null, "D1: una chiave per repository");
  assert.deepEqual((await notices("chiave_ci_creata", issued.keyId)).map((r) => r.user_id), usersOf("lead"), "al responsabile del caso, non a chi l'ha creata né agli altri");
  assert.deepEqual(issued.noticeIds.length, 1);
  // Una seconda chiave non si crea: si ruota. Un repository senza casi nel workspace: no. Un testo che non è un repository: no.
  refused(await store.createCiKey(exec, { workspaceId: ids.ws, repo: REPO, actor: actor("lead"), lsDomains: LS }), "gia_collegata", "già collegata");
  refused(await store.createCiKey(exec, { workspaceId: ids.ws, repo: "Voltaen/senza-casi", actor: actor("manager"), lsDomains: LS }), "repo_senza_casi", "senza casi");
  refused(await store.createCiKey(exec, { workspaceId: ids.ws, repo: "non un repository", actor: actor("manager"), lsDomains: LS }), "dati_non_validi", "non valido");
  assert.equal((await keyRows()).length, 1);
});

test("D6: chi gestisce il workspace e il responsabile di un caso aperto del repository sì; gli altri no, anche chiamando direttamente", opts, async () => {
  await clearKeys();
  for (const person of ["dev", "outside", "client", "unverified", "learner"] as const) {
    refused(await store.createCiKey(exec, { workspaceId: ids.ws, repo: REPO, actor: actor(person), lsDomains: LS }), "permesso_negato", person);
    assert.equal(await store.canManageCiKeys(exec, { workspaceId: ids.ws, userId: ids[person], repo: REPO, lsDomains: LS }), false, person);
  }
  // Senza i domini di Lateral Space nessuno gestisce le chiavi.
  refused(await store.createCiKey(exec, { workspaceId: ids.ws, repo: REPO, actor: actor("manager"), lsDomains: [] }), "permesso_negato", "senza domini");
  // Il responsabile di un caso chiuso di un altro repository: lì no.
  assert.equal(await store.canManageCiKeys(exec, { workspaceId: ids.ws, userId: ids.dev, repo: LONE_REPO, lsDomains: LS }), false);
  assert.equal(await store.canManageCiKeys(exec, { workspaceId: ids.ws, userId: ids.lead, repo: OTHER_REPO, lsDomains: LS }), false, "il responsabile di un caso di un altro repository");
  assert.equal(await store.canManageCiKeys(exec, { workspaceId: ids.ws, userId: ids.lead, repo: REPO, lsDomains: LS }), true);
  assert.equal(await store.canManageCiKeys(exec, { workspaceId: ids.ws, userId: ids.manager, repo: OTHER_REPO, lsDomains: LS }), true);
  // Chi gestisce un altro workspace non gestisce le chiavi di questo, e viceversa.
  assert.equal(await store.canManageCiKeys(exec, { workspaceId: ids.wsB, userId: ids.lead, repo: REPO, lsDomains: LS }), false);
  const managed = await store.ciKeyManagedRepos(exec, { workspaceId: ids.ws, userId: ids.lead, lsDomains: LS });
  assert.deepEqual({ all: managed.all, repos: [...managed.repos] }, { all: false, repos: [REPO.toLowerCase()] });
  const manager = await store.ciKeyManagedRepos(exec, { workspaceId: ids.ws, userId: ids.manager, lsDomains: LS });
  assert.equal(manager.all, true);
  for (const person of ["dev", "outside", "client"] as const) {
    const none = await store.ciKeyManagedRepos(exec, { workspaceId: ids.ws, userId: ids[person], lsDomains: LS });
    assert.deepEqual({ all: none.all, repos: [...none.repos] }, { all: false, repos: [] }, person);
  }
  const issued = okValue(await store.createCiKey(exec, { workspaceId: ids.ws, repo: REPO, actor: actor("lead"), lsDomains: LS }), "il responsabile");
  for (const person of ["dev", "outside", "client", "unverified", "learner"] as const) {
    refused(await store.rotateCiKey(exec, { workspaceId: ids.ws, repo: REPO, actor: actor(person), lsDomains: LS }), "permesso_negato", `ruota: ${person}`);
    refused(await store.revokeCiKeys(exec, { workspaceId: ids.ws, repo: REPO, actor: actor(person), lsDomains: LS }), "permesso_negato", `revoca: ${person}`);
  }
  const rows = await keyRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].revoked_at, null, "nessuno degli altri l'ha revocata");
  assert.deepEqual((await notices("chiave_ci_creata", issued.keyId)).map((r) => r.user_id), usersOf("manager"));
});

test("ogni richiesta: la chiave viva apre il suo repository; revocata, scaduta, di un altro tipo o inventata no", opts, async () => {
  await clearKeys();
  const issued = okValue(await store.createCiKey(exec, { workspaceId: ids.ws, repo: REPO, actor: actor("manager"), lsDomains: LS }), "creata");
  const principal = await store.authenticateCiKey(exec, `Bearer ${issued.key}`);
  assert.ok(principal);
  assert.deepEqual({ ...principal, expiresAt: undefined }, { keyId: issued.keyId, workspaceId: ids.ws, repo: REPO, useCaseId: null, expiresAt: undefined, revokedPrevious: false });
  assert.ok((await keyRows())[0].last_used_at, "l'ultimo uso");
  for (const header of [null, "", issued.key, `Basic ${issued.key}`, `Bearer ub_cli_${issued.key.slice(6)}`, `Bearer ub_ci_${"x".repeat(43)}`, `Bearer ${issued.key}x`]) {
    assert.equal(await store.authenticateCiKey(exec, header), null, String(header).slice(0, 12));
  }
  await q(`UPDATE use_case_ci_keys SET expires_at = now() - interval '1 second', created_at = now() - interval '181 days' WHERE id = $1`, [issued.keyId]);
  assert.equal(await store.authenticateCiKey(exec, `Bearer ${issued.key}`), null, "scaduta");
  // Scaduta: «Collega la CI» ne crea una nuova (nessuna chiave viva), e la vecchia non apre più niente.
  const fresh = okValue(await store.createCiKey(exec, { workspaceId: ids.ws, repo: REPO, actor: actor("manager"), lsDomains: LS }), "nuova dopo la scadenza");
  assert.ok(await store.authenticateCiKey(exec, `Bearer ${fresh.key}`));
  okValue(await store.revokeCiKeys(exec, { workspaceId: ids.ws, repo: REPO, actor: actor("lead"), lsDomains: LS }), "revocata");
  assert.equal(await store.authenticateCiKey(exec, `Bearer ${fresh.key}`), null, "revocata");
  const revoked = await keyRows();
  assert.ok(revoked.every((r) => r.revoked_reason === "a_mano" && r.revoked_by_user_id === ids.lead), "il registro: a mano, chi");
  refused(await store.revokeCiKeys(exec, { workspaceId: ids.ws, repo: REPO, actor: actor("lead"), lsDomains: LS }), "nessuna_chiave", "niente da revocare");
  refused(await store.rotateCiKey(exec, { workspaceId: ids.ws, repo: REPO, actor: actor("lead"), lsDomains: LS }), "nessuna_chiave", "niente da ruotare");
});

test("l'ambito: i casi del repository della chiave nel suo workspace; chiusi, in pausa, senza dossier, di altri repository o workspace no", opts, async () => {
  await clearKeys();
  const issued = okValue(await store.createCiKey(exec, { workspaceId: ids.ws, repo: REPO, actor: actor("manager"), lsDomains: LS }), "creata");
  const principal = (await store.authenticateCiKey(exec, `Bearer ${issued.key}`))!;
  const cases = await store.listCiKeyCases(exec, principal);
  assert.deepEqual(
    cases.map((c) => [c.code, c.folder, c.open, c.why]),
    [
      ["XX-0001", "casi/xx-0001", true, null],
      ["XX-0002", "casi/xx-0002", false, "chiuso"],
      ["XX-0003", "casi/xx-0003", false, "sospeso"],
      ["XX-0005", "casi/xx-0005", false, "senza_dossier"],
    ],
  );
  const found = okValue(await store.findCiKeyCase(exec, principal, "xx-0001"), "il caso aperto");
  assert.equal(found.useCaseId, ids.uc1);
  assert.equal(found.dossierId, ids.case1);
  refused(await store.findCiKeyCase(exec, principal, "XX-0002"), "caso_chiuso", "chiuso");
  refused(await store.findCiKeyCase(exec, principal, "XX-0003"), "caso_sospeso", "in pausa");
  refused(await store.findCiKeyCase(exec, principal, "XX-0005"), "senza_dossier", "senza dossier");
  refused(await store.findCiKeyCase(exec, principal, "XX-0004"), "non_trovato", "un altro repository");
  refused(await store.findCiKeyCase(exec, principal, "XX-0101"), "non_trovato", "un altro workspace");
  refused(await store.findCiKeyCase(exec, principal, "'; SELECT 1 --"), "non_trovato", "non un codice");
  // La chiave dell'altro workspace, sullo stesso repository, vede solo il caso di quel workspace.
  const other = okValue(await store.createCiKey(exec, { workspaceId: ids.wsB, repo: REPO, actor: actor("manager"), lsDomains: LS }), "altro workspace");
  const otherPrincipal = (await store.authenticateCiKey(exec, `Bearer ${other.key}`))!;
  assert.equal(otherPrincipal.workspaceId, ids.wsB);
  assert.deepEqual((await store.listCiKeyCases(exec, otherPrincipal)).map((c) => c.code), ["XX-0101"]);
  refused(await store.findCiKeyCase(exec, otherPrincipal, "XX-0001"), "non_trovato", "il caso di un altro workspace");
  // D1 «per caso», più avanti: una chiave con il caso vede solo quello.
  assert.deepEqual((await store.listCiKeyCases(exec, { ...principal, useCaseId: ids.uc2 })).map((c) => c.code), ["XX-0002"]);
  refused(await store.findCiKeyCase(exec, { ...principal, useCaseId: ids.uc2 }, "XX-0001"), "non_trovato", "un caso solo");
});

test("la rotazione: la vecchia al più 7 giorni, il primo invio con la nuova la revoca, mai più di due vive", opts, async () => {
  await clearKeys();
  const first = okValue(await store.createCiKey(exec, { workspaceId: ids.ws, repo: REPO, actor: actor("manager"), lsDomains: LS }), "creata");
  const second = okValue(await store.rotateCiKey(exec, { workspaceId: ids.ws, repo: REPO, actor: actor("lead"), lsDomains: LS }), "ruotata");
  assert.equal(second.replaced?.keyId, first.keyId);
  const graceDays = (second.replaced!.until.getTime() - second.createdAt.getTime()) / 86_400_000;
  assert.ok(graceDays <= 7.0001 && graceDays > 6.99, `la vecchia vale 7 giorni, non ${graceDays}`);
  assert.deepEqual((await notices("chiave_ci_creata", second.keyId)).map((r) => r.user_id), usersOf("manager"), "anche la chiave nuova di una rotazione");
  const [oldRow, newRow] = await keyRows();
  assert.equal(newRow.replaces_key_id, oldRow.id);
  // Una seconda rotazione, con la nuova mai usata, si rifiuta; anche due insieme.
  refused(await store.rotateCiKey(exec, { workspaceId: ids.ws, repo: REPO, actor: actor("manager"), lsDomains: LS }), "rotazione_in_corso", "seconda rotazione");
  refused(await store.createCiKey(exec, { workspaceId: ids.ws, repo: REPO, actor: actor("manager"), lsDomains: LS }), "gia_collegata", "crea durante la rotazione");
  // La vecchia vale ancora (la CI non ha ancora il segreto nuovo) e non revoca la nuova.
  const viaOld = await store.authenticateCiKey(exec, `Bearer ${first.key}`);
  assert.equal(viaOld?.keyId, first.keyId);
  assert.equal(viaOld?.revokedPrevious, false);
  assert.equal((await keyRows()).filter((r) => r.revoked_at === null).length, 2);
  // Il primo invio con la nuova revoca la vecchia (`ruotata`), nella stessa richiesta.
  const viaNew = await store.authenticateCiKey(exec, `Bearer ${second.key}`);
  assert.equal(viaNew?.revokedPrevious, true);
  assert.equal(await store.authenticateCiKey(exec, `Bearer ${first.key}`), null);
  const [revokedOld] = await keyRows();
  assert.equal(revokedOld.revoked_reason, "ruotata");
  assert.equal(revokedOld.revoked_by_user_id, null, "nessuna persona: l'ha revocata il primo invio");
  assert.equal((await store.authenticateCiKey(exec, `Bearer ${second.key}`))?.revokedPrevious, false, "una volta sola");
  // Usata la nuova, si può ruotare di nuovo; due rotazioni insieme ne fanno una sola.
  const together = await Promise.all([
    store.rotateCiKey(exec, { workspaceId: ids.ws, repo: REPO, actor: actor("manager"), lsDomains: LS }),
    store.rotateCiKey(exec, { workspaceId: ids.ws, repo: REPO, actor: actor("lead"), lsDomains: LS }),
  ]);
  assert.equal(together.filter((r) => r.ok).length, 1, "una sola rotazione");
  refused(together.find((r) => !r.ok)!, "rotazione_in_corso", "l'altra");
  const live = (await keyRows()).filter((r) => r.revoked_at === null && new Date(String(r.expires_at)).getTime() > Date.now());
  assert.equal(live.length, 2, "mai più di due chiavi vive");
  // Due «Crea la chiave» insieme su un repository senza chiave: una sola.
  await clearKeys();
  const created = await Promise.all([0, 1, 2].map(() => store.createCiKey(exec, { workspaceId: ids.ws, repo: REPO, actor: actor("manager"), lsDomains: LS })));
  assert.equal(created.filter((r) => r.ok).length, 1);
  assert.equal((await keyRows()).length, 1);
});

test("la chiave in un indirizzo: revocata subito (esposta), e l'e-mail a chi gestisce le chiavi; gli altri token si ignorano", opts, async () => {
  await clearKeys();
  const issued = okValue(await store.createCiKey(exec, { workspaceId: ids.ws, repo: REPO, actor: actor("manager"), lsDomains: LS }), "creata");
  const exposed = await store.revokeExposedCiKeys(exec, [`ub_cli_${"y".repeat(43)}`, issued.key, issued.key, `ub_ci_${"z".repeat(43)}`], LS);
  assert.equal(exposed.revoked, 1);
  assert.equal(exposed.noticeIds.length, 2);
  assert.equal(await store.authenticateCiKey(exec, `Bearer ${issued.key}`), null);
  const [row] = await keyRows();
  assert.equal(row.revoked_reason, "esposta");
  assert.deepEqual((await notices("chiave_ci_bloccata", issued.keyId)).map((r) => r.user_id), usersOf("manager", "lead"));
  // Già revocata: niente di nuovo, nessuna seconda e-mail.
  assert.deepEqual(await store.revokeExposedCiKeys(exec, [issued.key], LS), { revoked: 0, noticeIds: [] });
  assert.deepEqual(await store.revokeExposedCiKeys(exec, ["ub_team_qualcosa"], LS), { revoked: 0, noticeIds: [] });
});

test("il cron: l'avviso a 14 giorni una volta sola e non alla vecchia di una rotazione; le chiavi dei repository senza casi; le chiavi finite da 12 mesi", opts, async () => {
  await clearKeys();
  const sweep = () => store.runCiKeysSweep(exec, { lsDomains: LS, workspaceIds: [ids.ws] });
  const issued = okValue(await store.createCiKey(exec, { workspaceId: ids.ws, repo: REPO, actor: actor("manager"), lsDomains: LS }), "creata");
  assert.deepEqual(await sweep(), { ready: true, reminded: 0, reminderNotices: 0, revokedWithoutCases: 0, deleted: 0 }, "lontana dalla fine: niente");
  await q(`UPDATE use_case_ci_keys SET created_at = now() - interval '170 days', expires_at = now() + interval '10 days' WHERE id = $1`, [issued.keyId]);
  const reminded = await sweep();
  assert.equal(reminded.reminded, 1);
  assert.deepEqual((await notices("chiave_ci_scade", issued.keyId)).map((r) => r.user_id), usersOf("manager", "lead"), "solo a chi gestisce le chiavi");
  assert.equal((await sweep()).reminded, 0, "una volta sola");
  // La vecchia di una rotazione non si avvisa: la si sta cambiando.
  await clearKeys();
  const old = okValue(await store.createCiKey(exec, { workspaceId: ids.ws, repo: REPO, actor: actor("manager"), lsDomains: LS }), "vecchia");
  await q(`UPDATE use_case_ci_keys SET created_at = now() - interval '175 days', expires_at = now() + interval '5 days' WHERE id = $1`, [old.keyId]);
  okValue(await store.rotateCiKey(exec, { workspaceId: ids.ws, repo: REPO, actor: actor("manager"), lsDomains: LS }), "ruotata");
  assert.equal((await sweep()).reminded, 0);
  // Il repository senza casi: le sue chiavi si revocano (`senza_casi`); quelle degli altri repository restano.
  const lone = okValue(await store.createCiKey(exec, { workspaceId: ids.ws, repo: LONE_REPO, actor: actor("manager"), lsDomains: LS }), "verde");
  await q(`DELETE FROM use_case_repos WHERE workspace_id = $1 AND repo = $2`, [ids.ws, LONE_REPO]);
  assert.equal((await sweep()).revokedWithoutCases, 1);
  const [loneRow] = await keyRows(LONE_REPO);
  assert.equal(loneRow.id, lone.keyId);
  assert.equal(loneRow.revoked_reason, "senza_casi");
  assert.equal((await keyRows()).filter((r) => r.revoked_at === null).length, 2, "le chiavi del repository con i casi restano");
  await q(`INSERT INTO use_case_repos (use_case_id, workspace_id, repo, folder) VALUES ($1, $2, $3, 'casi/xx-0006')`, [ids.uc6, ids.ws, LONE_REPO]);
  // Finite da più di 12 mesi: si cancellano; da 11 mesi restano.
  await q(
    `INSERT INTO use_case_ci_keys (workspace_id, repo, token_hash, token_prefix, created_at, expires_at, revoked_at, revoked_reason) VALUES
       ($1, $2, $3, 'ub_ci_vec1', now() - interval '20 months', now() - interval '14 months', now() - interval '13 months', 'a_mano'),
       ($1, $2, $4, 'ub_ci_vec2', now() - interval '20 months', now() - interval '13 months', NULL, NULL),
       ($1, $2, $5, 'ub_ci_vec3', now() - interval '20 months', now() + interval '10 days', now() - interval '13 months', 'esposta'),
       ($1, $2, $6, 'ub_ci_vec4', now() - interval '20 months', now() - interval '11 months', NULL, NULL)`,
    [ids.ws, LONE_REPO, sha(`a${suffix}`), sha(`b${suffix}`), sha(`c${suffix}`), sha(`d${suffix}`)],
  );
  assert.equal((await sweep()).deleted, 3);
  assert.deepEqual((await keyRows(LONE_REPO)).map((r) => r.token_prefix).sort(), [loneRow.token_prefix, "ub_ci_vec4"].sort());
});

test("la riga della famiglia: i repository dei casi con le chiavi, dalla più nuova, e i casi dal progetto approvato; mai chi", opts, async () => {
  await clearKeys();
  const first = okValue(await store.createCiKey(exec, { workspaceId: ids.ws, repo: REPO, actor: actor("manager"), lsDomains: LS }), "creata");
  const second = okValue(await store.rotateCiKey(exec, { workspaceId: ids.ws, repo: REPO, actor: actor("lead"), lsDomains: LS }), "ruotata");
  const overview = await store.loadCiKeyOverview(exec, { workspaceId: ids.ws });
  assert.equal(overview.ready, true);
  assert.deepEqual([...overview.repos.keys()].sort(), [REPO, OTHER_REPO, LONE_REPO].map((r) => r.toLowerCase()).sort());
  const rosa = overview.repos.get(REPO.toLowerCase())!;
  assert.equal(rosa.repo, REPO);
  assert.equal(rosa.approvedCases, 1);
  assert.deepEqual(rosa.keys.map((k) => k.id), [second.keyId, first.keyId]);
  assert.equal(rosa.keys[0].replacesKeyId, first.keyId);
  for (const key of rosa.keys) {
    assert.deepEqual(Object.keys(key).sort(), ["createdAt", "expiresAt", "id", "lastUsedAt", "prefix", "remindedAt", "repo", "replacesKeyId", "revokedAt", "revokedReason"].sort());
  }
  assert.equal(overview.repos.get(OTHER_REPO.toLowerCase())!.approvedCases, 0);
  // I fatti dell'e-mail: chi riceve gestisce ancora le chiavi? la chiave è stata superata?
  const facts = await store.ciKeyMailFacts(exec, { keyId: first.keyId, workspaceId: ids.ws, recipientUserId: ids.lead, lsDomains: LS });
  assert.deepEqual({ repo: facts?.repo, manages: facts?.recipientManages, superseded: facts?.superseded }, { repo: REPO, manages: true, superseded: true });
  const dev = await store.ciKeyMailFacts(exec, { keyId: second.keyId, workspaceId: ids.ws, recipientUserId: ids.dev, lsDomains: LS });
  assert.deepEqual({ manages: dev?.recipientManages, superseded: dev?.superseded }, { manages: false, superseded: false });
  assert.equal(await store.ciKeyMailFacts(exec, { keyId: first.keyId, workspaceId: ids.wsB, recipientUserId: ids.lead, lsDomains: LS }), null, "solo nel workspace della riga");
});

test("le tre e-mail partono dalla coda a chi gestisce le chiavi, con il repository e il link all'Agent Factory; mai la chiave", opts, async () => {
  await clearKeys();
  const dispatch = await import("./uc-notifications-dispatch.ts");
  const sent: { to: string; subject: string; text: string; html: string }[] = [];
  const mailer = { send: async (email: { to: string; subject: string; text: string; html: string }) => (sent.push(email), { ok: true as const }) };
  const env = { RESEND_API_KEY: "re_prova", UC_EMAIL_FROM: "Unbundle <notifiche@unbundle.test>", NEXT_PUBLIC_APP_URL: "https://app.unbundle.test" };
  const run = () => dispatch.dispatchQueue(exec, { env, lsDomains: LS, workspaceId: ids.ws, mailer, sendIntervalMs: 0 });
  const issued = okValue(await store.createCiKey(exec, { workspaceId: ids.ws, repo: REPO, actor: actor("manager"), lsDomains: LS }), "creata");
  assert.equal((await run()).sent, 1);
  assert.deepEqual(sent.map((e) => e.to), [EMAIL.lead]);
  assert.match(sent[0].subject, /^Cliente di prov…: nuova chiave della CI «esempio-/);
  assert.ok(sent[0].text.includes(`la CI di ${REPO} manda a Unbundle le evals di main`));
  assert.ok(sent[0].text.includes(`https://app.unbundle.test/dashboard/${ids.ws}/agent-factory`));
  await store.revokeExposedCiKeys(exec, [issued.key], LS);
  assert.equal((await run()).sent, 2);
  assert.deepEqual(sent.slice(1).map((e) => e.to).sort(), [EMAIL.manager, EMAIL.lead].sort());
  assert.ok(sent.slice(1).every((e) => /chiave della CI bloccata/.test(e.subject)));
  // L'avviso di scadenza: a chi gestisce le chiavi; e si annulla per chi nel frattempo non le gestisce più.
  const soon = okValue(await store.createCiKey(exec, { workspaceId: ids.ws, repo: REPO, actor: actor("lead"), lsDomains: LS }), "nuova");
  await run();
  await q(`UPDATE use_case_ci_keys SET created_at = now() - interval '170 days', expires_at = now() + interval '3 days' WHERE id = $1`, [soon.keyId]);
  assert.equal((await store.runCiKeysSweep(exec, { lsDomains: LS, workspaceIds: [ids.ws] })).reminderNotices, 2);
  await q(`UPDATE uc_case_members SET role = 'ls_sviluppatore' WHERE case_id = $1 AND user_id = $2`, [ids.case1, ids.lead]);
  try {
    const before = sent.length;
    const summary = await run();
    assert.equal(summary.sent, 1);
    assert.equal(summary.cancelled, 1, "chi non è più responsabile del caso non la riceve");
    assert.deepEqual(sent.slice(before).map((e) => e.to), [EMAIL.manager]);
    assert.match(sent[sent.length - 1].subject, /chiave della CI in scadenza/);
  } finally {
    await q(`UPDATE uc_case_members SET role = 'ls_lead' WHERE case_id = $1 AND user_id = $2`, [ids.case1, ids.lead]);
  }
  for (const email of sent) assert.ok(![email.subject, email.text, email.html].some((t) => t.includes("ub_ci_")), "mai la chiave in un'e-mail");
});

test("il workspace cancellato porta via le sue chiavi", opts, async () => {
  const doomed = randomUUID();
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Workspace da cancellare CI')`, [doomed, ids.org]);
  await q(`INSERT INTO use_case_ci_keys (workspace_id, repo, token_hash, token_prefix, expires_at) VALUES ($1, $2, $3, 'ub_ci_canc', now() + interval '1 day')`, [doomed, REPO, sha(`doomed${suffix}`)]);
  await q(`DELETE FROM workspaces WHERE id = $1`, [doomed]);
  assert.equal((await q(`SELECT count(*)::int AS n FROM use_case_ci_keys WHERE workspace_id = $1`, [doomed]))[0].n, 0);
});

test("mai ub_ci_ nei log della suite", opts, async () => {
  assert.ok(!logged.some((line) => line.includes("ub_ci_")), "una chiave in un log");
});
