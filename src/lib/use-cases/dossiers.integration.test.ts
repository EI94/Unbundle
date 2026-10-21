import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

// Letture minime del dossier (docs/use-case/PIANO-LAVORI.md H1d; docs/use-case/DESIGN.md
// §9.1 «Letture uc», §10.4 punti 5 e 6): src/lib/db/queries/use-case-dossiers.ts.
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database del
//   pacchetto hub_<id> su 127.0.0.1) gira sul database di prova.
// - Dentro `npm run check` si salta: in testa solo moduli di Node; i moduli dell'app
//   arrivano con `await import()` dentro `before()`.
// Alcune prove cambiano lo schema uc per un momento (tabella o colonna rinominata, indice
// unico tolto o creato) e lo rimettono com'era in `finally`: per questo girano solo sul
// database del pacchetto, mai sul modello. Dati sintetici, creati e cancellati qui.
const url = process.env.DATABASE_URL;
const enabled = process.env.HUB_TEST_ISOLATED === "true" && Boolean(url);
if (enabled) {
  const parsed = new URL(url!);
  if (parsed.hostname !== "127.0.0.1" || process.env.UC_TEST_DATABASE_URL !== url) {
    throw new Error("Hub DB tests need a loopback DATABASE_URL equal to UC_TEST_DATABASE_URL");
  }
  if (!/^\/hub_[a-z0-9][a-z0-9_]{0,39}$/.test(parsed.pathname)) {
    throw new Error("This suite changes the uc schema for a moment: run it only on a package database hub_<id>");
  }
  if ((globalThis.fetch as { name?: string }).name !== "localNeonFetch") {
    throw new Error("Preload scripts/uc-test/local-neon.cjs to reach the local test database");
  }
}
const opts = { skip: !enabled };

type Reads = typeof import("../db/queries/use-case-dossiers.ts");
let reads: Reads;
let q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

const suffix = randomBytes(3).toString("hex").toUpperCase();
const ids = {
  org: randomUUID(),
  wsA: randomUUID(),
  wsB: randomUUID(),
  template: randomUUID(),
  // Use case del workspace A.
  ucComplete: randomUUID(),
  ucIncomplete: randomUUID(),
  ucNone: randomUUID(),
  ucTwice: randomUUID(),
  // Use case del workspace B.
  ucOther: randomUUID(),
  // Dossier.
  caseComplete: randomUUID(),
  caseIncomplete: randomUUID(),
  caseOther: randomUUID(),
};
const codes = { complete: `XX-${suffix}1`, incomplete: `XX-${suffix}2`, other: `XX-${suffix}3` };
const envBefore = {
  UC_ENABLED: process.env.UC_ENABLED,
  UC_WORKSPACE_IDS: process.env.UC_WORKSPACE_IDS,
  VERCEL_ENV: process.env.VERCEL_ENV,
};

const SPENTA = { ok: false, motivo: "spenta" };
const ERRORE = { ok: false, motivo: "errore" };

/**
 * Sezione accesa (`UC_ENABLED`) per i workspace indicati (`UC_WORKSPACE_IDS`, casi-duso
 * P0-1), fuori produzione. Predefiniti: i due workspace di prova.
 */
function switchOn(workspaces: string = `${ids.wsA},${ids.wsB}`): void {
  process.env.UC_ENABLED = "true";
  process.env.UC_WORKSPACE_IDS = workspaces;
  delete process.env.VERCEL_ENV;
}

async function insertCase(i: {
  id?: string;
  workspaceId: string;
  useCaseId: string | null;
  code: string;
  status?: string;
  complete: boolean;
  createdAt?: string;
}): Promise<string> {
  const id = i.id ?? randomUUID();
  await q(
    `INSERT INTO uc_cases (id, workspace_id, organization_id, portfolio_use_case_id, template_id, template_version, code, title, status, setup_completed_at, created_at)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, '1.0.0', $6, 'Dossier di prova', $7, CASE WHEN $8 THEN now() END, coalesce($9::timestamptz, now()))`,
    [id, i.workspaceId, ids.org, i.useCaseId, ids.template, i.code, i.status ?? "raccolta", i.complete, i.createdAt ?? null],
  );
  return id;
}

async function deleteCases(caseIds: string[]): Promise<void> {
  await q(`DELETE FROM uc_cases WHERE id = ANY($1::uuid[])`, [caseIds]);
}

async function uniqueIndexPresent(): Promise<boolean> {
  const [row] = await q(`SELECT to_regclass($1) IS NOT NULL AS present`, [`public.${reads.DOSSIER_LINK_UNIQUE_INDEX}`]);
  return row.present === true;
}

async function setUniqueIndex(present: boolean): Promise<void> {
  // La stessa definizione della 0020 (DESIGN §10.4 punto 2).
  if (present) {
    await q(
      `CREATE UNIQUE INDEX IF NOT EXISTS ${reads.DOSSIER_LINK_UNIQUE_INDEX} ON uc_cases (portfolio_use_case_id) WHERE portfolio_use_case_id IS NOT NULL`,
    );
  } else {
    await q(`DROP INDEX IF EXISTS ${reads.DOSSIER_LINK_UNIQUE_INDEX}`);
  }
}

/** Esegue `fn` con l'indice unico presente o assente, poi lo rimette com'era. */
async function withUniqueIndex<T>(present: boolean, fn: () => Promise<T>): Promise<T> {
  const had = await uniqueIndexPresent();
  await setUniqueIndex(present);
  try {
    return await fn();
  } finally {
    await setUniqueIndex(had);
  }
}

before(async () => {
  if (!enabled) return;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Record<string, unknown>[]>;
  reads = await import("../db/queries/use-case-dossiers.ts");

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Organizzazione di prova H1d', $2)`, [ids.org, `hub-h1d-${ids.org}`]);
  await q(
    `INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $3::uuid, 'Prova H1d A'), ($2::uuid, $3::uuid, 'Prova H1d B')`,
    [ids.wsA, ids.wsB, ids.org],
  );
  await q(
    `INSERT INTO use_cases (id, workspace_id, title) VALUES
       ($1::uuid, $6::uuid, 'Use case di prova con dossier'),
       ($2::uuid, $6::uuid, 'Use case di prova con dossier incompleto'),
       ($3::uuid, $6::uuid, 'Use case di prova senza dossier'),
       ($4::uuid, $6::uuid, 'Use case di prova con due dossier'),
       ($5::uuid, $7::uuid, 'Use case di prova dell''altro workspace')`,
    [ids.ucComplete, ids.ucIncomplete, ids.ucNone, ids.ucTwice, ids.ucOther, ids.wsA, ids.wsB],
  );
  await q(
    `INSERT INTO uc_templates (id, key, version, name, archetype, definition, definition_hash, restricted_to_workspace_id)
     VALUES ($1::uuid, $2, '1.0.0', 'Template di prova H1d', 'prova', '{"confidential": false}'::jsonb, $3, $4::uuid)`,
    [ids.template, `prova.hub_h1d_${suffix.toLowerCase()}`, randomBytes(32).toString("hex"), ids.wsA],
  );
  await insertCase({ id: ids.caseComplete, workspaceId: ids.wsA, useCaseId: ids.ucComplete, code: codes.complete, status: "in_sviluppo", complete: true });
  await insertCase({ id: ids.caseIncomplete, workspaceId: ids.wsA, useCaseId: ids.ucIncomplete, code: codes.incomplete, complete: false });
  await insertCase({ id: ids.caseOther, workspaceId: ids.wsB, useCaseId: ids.ucOther, code: codes.other, complete: true });
});

after(async () => {
  for (const [key, value] of Object.entries(envBefore)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (!enabled) return;
  // I workspace portano via use case e dossier; il template ristretto al workspace A con loro.
  await q(`DELETE FROM workspaces WHERE id = ANY($1::uuid[])`, [[ids.wsA, ids.wsB]]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
});

test("UC_ENABLED spento: ogni lettura risponde «spenta», senza log", opts, async (t) => {
  // Workspace in elenco: «spenta» viene dal solo UC_ENABLED.
  switchOn();
  const log = t.mock.method(console, "error", () => {});
  for (const value of [undefined, "false", "1", "TRUE"]) {
    if (value === undefined) delete process.env.UC_ENABLED;
    else process.env.UC_ENABLED = value;
    assert.deepEqual(await reads.dossierStates(ids.wsA, [ids.ucComplete]), SPENTA, `UC_ENABLED=${value}`);
    assert.deepEqual(await reads.dossierStateForUseCase(ids.wsA, ids.ucComplete), SPENTA, `UC_ENABLED=${value}`);
    assert.deepEqual(await reads.dossierLinksReady(ids.wsA), SPENTA, `UC_ENABLED=${value}`);
  }
  assert.equal(log.mock.callCount(), 0);
});

test("tabelle uc assenti: ogni lettura risponde «spenta», senza log", opts, async (t) => {
  switchOn();
  const log = t.mock.method(console, "error", () => {});
  await q(`ALTER TABLE uc_cases RENAME TO uc_cases_h1d_assente`);
  try {
    assert.deepEqual(await reads.dossierStates(ids.wsA, [ids.ucComplete]), SPENTA);
    assert.deepEqual(await reads.dossierStateForUseCase(ids.wsA, ids.ucComplete), SPENTA);
    assert.deepEqual(await reads.dossierLinksReady(ids.wsA), SPENTA);
    // Anche con una lista vuota: prima si guarda se le tabelle ci sono.
    assert.deepEqual(await reads.dossierStates(ids.wsA, []), SPENTA);
  } finally {
    await q(`ALTER TABLE uc_cases_h1d_assente RENAME TO uc_cases`);
  }
  assert.equal(log.mock.callCount(), 0);
});

test("stato e codice dei soli dossier completi, nel solo workspace indicato", opts, async () => {
  switchOn();
  const result = await reads.dossierStates(ids.wsA, [ids.ucComplete, ids.ucIncomplete, ids.ucNone, ids.ucOther, "non-un-uuid", ids.ucComplete.toUpperCase()]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual([...result.states.entries()], [[ids.ucComplete, { caseId: ids.caseComplete, code: codes.complete, status: "in_sviluppo" }]]);

  // Il dossier di B si legge solo con il workspace B.
  const other = await reads.dossierStates(ids.wsB, [ids.ucComplete, ids.ucOther]);
  assert.ok(other.ok);
  assert.deepEqual([...other.states.keys()], [ids.ucOther]);

  assert.deepEqual(await reads.dossierStateForUseCase(ids.wsA, ids.ucComplete), {
    ok: true,
    dossier: { caseId: ids.caseComplete, code: codes.complete, status: "in_sviluppo" },
  });
  assert.deepEqual(await reads.dossierStateForUseCase(ids.wsA, ids.ucNone), { ok: true, dossier: null });
  assert.deepEqual(await reads.dossierStateForUseCase(ids.wsA, ids.ucOther), { ok: true, dossier: null });
  assert.deepEqual(await reads.dossierStateForUseCase(ids.wsA, "non-un-uuid"), { ok: true, dossier: null });

  const empty = await reads.dossierStates(ids.wsA, []);
  assert.ok(empty.ok);
  assert.equal(empty.states.size, 0);
  // Un workspace che non è un UUID non è in `UC_WORKSPACE_IDS`: sezione spenta.
  assert.deepEqual(await reads.dossierStates("non-un-uuid", [ids.ucComplete]), SPENTA);
});

test("un dossier incompleto non conta, finché la creazione non si chiude", opts, async () => {
  switchOn();
  assert.deepEqual(await reads.dossierStateForUseCase(ids.wsA, ids.ucIncomplete), { ok: true, dossier: null });
  await q(`UPDATE uc_cases SET setup_completed_at = now() WHERE id = $1::uuid`, [ids.caseIncomplete]);
  try {
    assert.deepEqual(await reads.dossierStateForUseCase(ids.wsA, ids.ucIncomplete), {
      ok: true,
      dossier: { caseId: ids.caseIncomplete, code: codes.incomplete, status: "raccolta" },
    });
  } finally {
    await q(`UPDATE uc_cases SET setup_completed_at = NULL WHERE id = $1::uuid`, [ids.caseIncomplete]);
  }
});

test("due dossier completi sulla stessa scheda (prima dell'indice unico): vale il più vecchio", opts, async () => {
  switchOn();
  await withUniqueIndex(false, async () => {
    const newer = await insertCase({ workspaceId: ids.wsA, useCaseId: ids.ucTwice, code: `XX-${suffix}5`, status: "chiuso", complete: true, createdAt: "2026-10-02T10:00:00Z" });
    const older = await insertCase({ workspaceId: ids.wsA, useCaseId: ids.ucTwice, code: `XX-${suffix}4`, status: "in_esercizio", complete: true, createdAt: "2026-10-01T10:00:00Z" });
    // Un incompleto ancora più vecchio non conta.
    const incomplete = await insertCase({ workspaceId: ids.wsA, useCaseId: ids.ucTwice, code: `XX-${suffix}6`, complete: false, createdAt: "2026-09-30T10:00:00Z" });
    try {
      assert.deepEqual(await reads.dossierStateForUseCase(ids.wsA, ids.ucTwice), {
        ok: true,
        dossier: { caseId: older, code: `XX-${suffix}4`, status: "in_esercizio" },
      });
      const all = await reads.dossierStates(ids.wsA, [ids.ucTwice, ids.ucComplete]);
      assert.ok(all.ok);
      assert.equal(all.states.size, 2);
      assert.equal(all.states.get(ids.ucTwice)?.caseId, older);
    } finally {
      await deleteCases([newer, older, incomplete]);
    }
  });
});

test("errore forzato: «errore» e una riga di log col solo nome dell'errore", opts, async (t) => {
  switchOn();
  const log = t.mock.method(console, "error", () => {});
  await q(`ALTER TABLE uc_cases RENAME COLUMN setup_completed_at TO setup_completed_at_h1d`);
  try {
    assert.deepEqual(await reads.dossierStates(ids.wsA, [ids.ucComplete]), ERRORE);
    assert.deepEqual(await reads.dossierStateForUseCase(ids.wsA, ids.ucComplete), ERRORE);
    assert.deepEqual(await reads.dossierLinksReady(ids.wsA), ERRORE);
  } finally {
    await q(`ALTER TABLE uc_cases RENAME COLUMN setup_completed_at_h1d TO setup_completed_at`);
  }
  assert.equal(log.mock.callCount(), 3, "una riga per lettura fallita");
  const ops: string[] = [];
  for (const call of log.mock.calls) {
    const line = call.arguments.map(String).join(" ");
    assert.doesNotMatch(line, /\n/, "una riga sola");
    const match = line.match(/^\[use-case-hub\] lettura del dossier non riuscita (\{.*\})$/);
    assert.ok(match, `forma della riga: ${line}`);
    const payload = JSON.parse(match[1]) as Record<string, unknown>;
    assert.deepEqual(Object.keys(payload).filter((key) => !["op", "error", "cause"].includes(key)), []);
    assert.match(String(payload.error), /^[A-Za-z][A-Za-z0-9_]*$/);
    if ("cause" in payload) assert.match(String(payload.cause), /^[A-Za-z][A-Za-z0-9_]*$/);
    ops.push(String(payload.op));
    // Niente messaggio, query, parametri o id.
    for (const secret of [ids.wsA, ids.ucComplete, "setup_completed_at", "uc_cases", "SELECT", "Failed query", "column", "does not exist", "non esiste"]) {
      assert.ok(!line.includes(secret), `la riga di log non contiene «${secret}»`);
    }
  }
  assert.deepEqual(ops, ["dossier_states", "dossier_states", "dossier_links_ready"]);

  // Schema rimesso a posto: le letture tornano a rispondere.
  assert.deepEqual(await reads.dossierStateForUseCase(ids.wsA, ids.ucComplete), {
    ok: true,
    dossier: { caseId: ids.caseComplete, code: codes.complete, status: "in_sviluppo" },
  });
});

test("dossierLinksReady: falso senza l'indice unico o con un dossier completo orfano", opts, async () => {
  switchOn();
  // Senza l'indice nuovo resta falso, anche senza orfani.
  await withUniqueIndex(false, async () => {
    assert.deepEqual(await reads.dossierLinksReady(ids.wsA), { ok: true, ready: false });
    assert.deepEqual(await reads.dossierLinksReady(ids.wsB), { ok: true, ready: false });
  });

  await withUniqueIndex(true, async () => {
    assert.deepEqual(await reads.dossierLinksReady(ids.wsA), { ok: true, ready: true });
    assert.deepEqual(await reads.dossierLinksReady("non-un-uuid"), SPENTA);

    // Un orfano incompleto non conta.
    const incompleteOrphan = await insertCase({ workspaceId: ids.wsA, useCaseId: null, code: `XX-${suffix}7`, complete: false });
    // Un orfano completo di un altro workspace non conta per A.
    const otherOrphan = await insertCase({ workspaceId: ids.wsB, useCaseId: null, code: `XX-${suffix}8`, complete: true });
    let orphan: string | null = null;
    try {
      assert.deepEqual(await reads.dossierLinksReady(ids.wsA), { ok: true, ready: true });
      assert.deepEqual(await reads.dossierLinksReady(ids.wsB), { ok: true, ready: false });

      // Un orfano completo in A lo rende falso.
      orphan = await insertCase({ workspaceId: ids.wsA, useCaseId: null, code: `XX-${suffix}9`, complete: true });
      assert.deepEqual(await reads.dossierLinksReady(ids.wsA), { ok: true, ready: false });

      // Collegato alla sua scheda madre (dossier-links, §10.9), torna vero.
      await q(`UPDATE uc_cases SET portfolio_use_case_id = $2::uuid WHERE id = $1::uuid`, [orphan, ids.ucNone]);
      assert.deepEqual(await reads.dossierLinksReady(ids.wsA), { ok: true, ready: true });
    } finally {
      await deleteCases([incompleteOrphan, otherOrphan, ...(orphan ? [orphan] : [])]);
    }
  });
});

test("UC_WORKSPACE_IDS: fuori elenco ogni lettura risponde «spenta», senza log", opts, async (t) => {
  const log = t.mock.method(console, "error", () => {});
  const offFor = async (workspaceId: string, useCaseId: string, label: string) => {
    assert.deepEqual(await reads.dossierStates(workspaceId, [useCaseId]), SPENTA, label);
    assert.deepEqual(await reads.dossierStateForUseCase(workspaceId, useCaseId), SPENTA, label);
    assert.deepEqual(await reads.dossierLinksReady(workspaceId), SPENTA, label);
  };
  const onFor = async (workspaceId: string, useCaseId: string, caseId: string, label: string) => {
    const states = await reads.dossierStates(workspaceId, [useCaseId]);
    assert.ok(states.ok, label);
    assert.equal(states.states.get(useCaseId)?.caseId, caseId, label);
    const one = await reads.dossierStateForUseCase(workspaceId, useCaseId);
    assert.ok(one.ok, label);
    assert.equal(one.dossier?.caseId, caseId, label);
    assert.equal((await reads.dossierLinksReady(workspaceId)).ok, true, label);
  };

  // Solo B in elenco: A, che ha un dossier completo, non ne mostra né stato né codice.
  switchOn(ids.wsB);
  await offFor(ids.wsA, ids.ucComplete, "A fuori elenco");
  await onFor(ids.wsB, ids.ucOther, ids.caseOther, "B in elenco");
  // Il confronto non guarda le maiuscole.
  switchOn(ids.wsB.toUpperCase());
  await offFor(ids.wsA, ids.ucComplete, "A fuori elenco, B in maiuscolo");
  await onFor(ids.wsB, ids.ucOther, ids.caseOther, "B in maiuscolo");

  // Elenco vuoto o assente: spenta per tutti.
  switchOn("");
  await offFor(ids.wsA, ids.ucComplete, "elenco vuoto, A");
  await offFor(ids.wsB, ids.ucOther, "elenco vuoto, B");
  delete process.env.UC_WORKSPACE_IDS;
  await offFor(ids.wsA, ids.ucComplete, "elenco assente, A");

  // `*` fuori produzione (harness, anteprima): tutti i workspace.
  switchOn("*");
  await onFor(ids.wsA, ids.ucComplete, ids.caseComplete, "* senza VERCEL_ENV");
  process.env.VERCEL_ENV = "preview";
  await onFor(ids.wsA, ids.ucComplete, ids.caseComplete, "* in anteprima");
  // Un workspace che non è un UUID resta spento anche con `*`.
  assert.deepEqual(await reads.dossierLinksReady("non-un-uuid"), SPENTA);

  // `*` in produzione non vale: conta solo l'elenco esplicito.
  process.env.VERCEL_ENV = "production";
  await offFor(ids.wsA, ids.ucComplete, "* in produzione, A");
  await offFor(ids.wsB, ids.ucOther, "* in produzione, B");
  process.env.UC_WORKSPACE_IDS = `*,${ids.wsB}`;
  await offFor(ids.wsA, ids.ucComplete, "* e B in produzione, A");
  await onFor(ids.wsB, ids.ucOther, ids.caseOther, "* e B in produzione, B");

  assert.equal(log.mock.callCount(), 0);
});
