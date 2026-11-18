import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

// «Cerca una persona» sul database del pacchetto (rilascio 9b, RILASCIO-9b-COSTRUZIONE.md §2.13, §5.9): la stessa
// espressione in Postgres e in JavaScript; la ricerca trova appunti (testo, titolo, «Con chi»), fatti anche della storia,
// citazioni, proposte, impegni, domande, documenti, regole di Granola e memoria della chat; «Togli … da tutto» cambia solo
// quel workspace, tiene i fatti, toglie il nome anche dalle proposte chiuse (con il loro stato), conta come la ricerca,
// cancella «In breve» solo se lo citava, toglie l'indirizzo dalle regole di Granola; chi non è di Lateral Space riceve
// `permesso_mancante`; nei log e nella storia mai il nome.
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su 127.0.0.1). Dati
//   sintetici e inventati (persone «Prova …», «Rossi» come cognome di prova), creati e cancellati qui. Nessun modello.
const url = process.env.DATABASE_URL;
const enabled = process.env.HUB_TEST_ISOLATED === "true" && Boolean(url);
if (enabled) {
  const parsed = new URL(url!);
  if (parsed.hostname !== "127.0.0.1" || process.env.UC_TEST_DATABASE_URL !== url) throw new Error("Hub DB tests need a loopback DATABASE_URL equal to UC_TEST_DATABASE_URL");
  if (!/^\/hub_[a-z0-9][a-z0-9_]{0,39}$/.test(parsed.pathname)) throw new Error("Run this suite only on a package database hub_<id>");
}
const opts = { skip: !enabled };

type Row = Record<string, unknown>;
let q: (text: string, params?: unknown[]) => Promise<Row[]>;
let people: typeof import("../db/queries/context-people.ts");
let pure: typeof import("./people.ts");
let dbModule: typeof import("../db/index.ts");

const LS = ["ls.test"];
const suffix = randomBytes(3).toString("hex");

/** Nel workspace A: ls (Lateral Space) e rev (cliente, revisore). Nel workspace B: lsb (Lateral Space). */
const persons = ["ls", "rev", "lsb"] as const;
type Person = (typeof persons)[number];
const ids = {
  orgA: randomUUID(),
  orgB: randomUUID(),
  wsA: randomUUID(),
  wsB: randomUUID(),
  ...(Object.fromEntries(persons.map((p) => [p, randomUUID()])) as Record<Person, string>),
};
const EMAIL: Record<Person, string> = { ls: `ls-${suffix}@ls.test`, rev: `rev-${suffix}@cliente.test`, lsb: `lsb-${suffix}@ls.test` };
const ROLE: Record<Person, ["wsA" | "wsB", string]> = { ls: ["wsA", "transformation_lead"], rev: ["wsA", "analyst"], lsb: ["wsB", "transformation_lead"] };

type Actor = import("./visibility.ts").ContextActor;
const actor = (person: Person, over: Partial<Actor> = {}): Actor => ({
  workspaceId: ids[ROLE[person][0]],
  userId: ids[person],
  role: ROLE[person][1],
  isLateralSpace: EMAIL[person].endsWith("@ls.test"),
  channel: "web",
  ...over,
});

function okValue<T>(result: { ok: true; value: T } | { ok: false; error: string; message: string; fieldErrors?: Record<string, string> }): T {
  assert.ok(result.ok, result.ok ? "" : `${result.error}: ${result.message} ${JSON.stringify(result.fieldErrors ?? {})}`);
  return (result as { ok: true; value: T }).value;
}

/** Il cognome di prova e un indirizzo di prova: inventati. */
const NAME = "Rossi";
const ADDRESS = "mario.rossi@cliente.test";
const NAME_ANYWHERE = /rossi/i;

/** Le righe di prova, per id. */
const rows = {
  n1: randomUUID(), n2: randomUUID(), n3: randomUUID(), nB: randomUUID(),
  p1: randomUUID(), p2: randomUUID(), p3: randomUUID(), p4: randomUUID(), p5: randomUUID(), p6: randomUUID(),
  f0: randomUUID(), f1: randomUUID(), f2: randomUUID(), f3: randomUUID(), f4: randomUUID(), f5: randomUUID(), fB: randomUUID(),
  c1: randomUUID(), c2: randomUUID(), c3: randomUUID(),
  q1: randomUUID(), q2: randomUUID(),
  d1: randomUUID(), d2: randomUUID(), d3: randomUUID(), s1: randomUUID(), s3: randomUUID(),
  convA: randomUUID(), convB: randomUUID(),
};
/** Un fatto lungo 198 caratteri: con «una persona» al posto di «Rossi» supera i 200, e si accorcia. */
const LONG = `${NAME} ${"tiene i conti del magazzino e degli ordini ".repeat(5)}`.slice(0, 198);

async function seed() {
  const A = ids.wsA;
  // Gli appunti: n1 con il nome nel testo, nel titolo e in «Con chi»; n2 senza; n3 con l'indirizzo, in lettura adesso.
  await q(
    `INSERT INTO context_sources (id, workspace_id, kind, origin, title, occurred_on, participants, body, body_chars, body_hash, visibility, read_status, parts_read, read_started_at)
     VALUES ($1, $4, 'appunti', 'web', 'Call di avvio con Rossi', '2026-11-14', 'Mario Rossi, Anna Bianchi',
             E'Ha parlato Mario Rossi del magazzino.\\nRossi gestisce il magazzino; il cartone lo fornisce Rossini.', 90, $5, 'ls', 'letto', 1, NULL),
            ($2, $4, 'appunti', 'web', 'Call sui sistemi', '2026-11-10', NULL, 'Il gestionale è SAP Business One e gira in sede.', 49, NULL, 'ls', 'letto', 1, NULL),
            ($3, $4, 'trascrizione', 'granola', 'Trascrizione del 12 nov', '2026-11-12', NULL, 'Scrivere a mario.rossi@cliente.test per il listino aggiornato.', 61, NULL, 'ls', 'in_lettura', 0, now())`,
    [rows.n1, rows.n2, rows.n3, A, "a".repeat(64)],
  );
  await q(
    `INSERT INTO context_sources (id, workspace_id, kind, origin, title, occurred_on, body, body_chars, visibility, read_status, parts_read)
     VALUES ($1, $2, 'appunti', 'web', 'Call del cliente B', '2026-11-14', 'Rossi è il responsabile del cliente B.', 38, 'ls', 'letto', 1)`,
    [rows.nB, ids.wsB],
  );
  // Le proposte aperte, e due chiuse con il nome: una confermata e una scartata (di un appunto che si toglie).
  await q(
    `INSERT INTO context_proposals (id, workspace_id, source_id, position, kind, statement, quote, basis, section, visibility, party, role_label, status, decided_at)
     VALUES ($1, $7, $8, 1, 'nuovo', 'Rossi approva gli ordini sopra soglia.', 'lo dice Rossi', 'detto', 'lavoro', 'ls', NULL, NULL, 'aperta', NULL),
            ($2, $7, $8, 2, 'nuovo', 'Il magazzino è a Bologna.', NULL, 'detto', 'azienda', 'tutti', NULL, NULL, 'aperta', NULL),
            ($3, $7, $9, 1, 'nuovo', 'Il gestionale è SAP Business One.', NULL, 'detto', 'sistemi', 'tutti', NULL, NULL, 'aperta', NULL),
            ($4, $7, $9, 2, 'impegno', 'Mandare il listino.', NULL, 'detto', NULL, 'ls', 'cliente', 'Ufficio di Rossi', 'aperta', NULL),
            ($5, $7, $9, 3, 'nuovo', 'Rossi firma i contratti.', NULL, 'detto', 'regole', 'ls', NULL, NULL, 'confermata', now() - interval '2 days'),
            ($6, $7, $8, 3, 'impegno', 'Richiamare Rossi per il listino.', 'lo richiama Rossi', 'detto', NULL, 'ls', 'nostra', 'Segreteria di Rossi', 'scartata', now() - interval '3 days')`,
    [rows.p1, rows.p2, rows.p3, rows.p4, rows.p5, rows.p6, A, rows.n1, rows.n2],
  );
  // I fatti: una storia (f0 → f1), uno con il nome solo nella citazione, «Rossini», uno ritirato, uno lungo; uno in B.
  const fact = (id: string, ws: string, statement: string, o: { status?: string; quote?: string | null; source?: string | null; supersedes?: string | null; visibility?: string } = {}) =>
    q(
      `INSERT INTO context_facts (id, workspace_id, section, statement, basis, visibility, status, origin, source_id, quote, supersedes_id, ended_at)
       VALUES ($1, $2, 'lavoro', $3, 'detto', $4, $5::text, $6, $7, $8, $9, CASE WHEN $5::text = 'attivo' THEN NULL ELSE now() END)`,
      [id, ws, statement, o.visibility ?? "tutti", o.status ?? "attivo", o.source ? "fonte" : "manuale", o.source ?? null, o.quote ?? null, o.supersedes ?? null],
    );
  await fact(rows.f0, A, "Rossi gestiva gli ordini.", { status: "superato" });
  await fact(rows.f1, A, "Rossi gestisce il magazzino.", { quote: "Rossi gestisce il magazzino da anni", source: rows.n1, supersedes: rows.f0 });
  await fact(rows.f2, A, "Il gestionale è SAP Business One.", { quote: "ce lo ha detto Rossi", source: rows.n2 });
  await fact(rows.f3, A, "Rossini fornisce il cartone.");
  await fact(rows.f4, A, "Mario Rossi era il referente.", { status: "ritirato", visibility: "ls" });
  await fact(rows.f5, A, LONG);
  await fact(rows.fB, ids.wsB, "Rossi decide nel cliente B.");
  // Gli impegni e le domande (aperti e chiusi).
  await q(
    `INSERT INTO context_commitments (id, workspace_id, statement, party, role_label, status, visibility, origin, closed_at)
     VALUES ($1, $4, 'Mandare a Rossi l''elenco dei fornitori', 'nostra', 'Ufficio acquisti', 'aperto', 'tutti', 'manuale', NULL),
            ($2, $4, 'Chiamare il fornitore', 'nostra', 'Segreteria di Rossi', 'fatto', 'ls', 'manuale', now()),
            ($3, $4, 'Inviare l''esportazione delle fatture', 'cliente', 'Amministrazione', 'aperto', 'tutti', 'manuale', NULL)`,
    [rows.c1, rows.c2, rows.c3, A],
  );
  await q(
    `INSERT INTO context_questions (id, workspace_id, question, ask_whom, visibility, origin)
     VALUES ($1, $3, 'Rossi conferma il listino?', 'Mario Rossi', 'ls', 'manuale'), ($2, $3, 'Chi approva gli acquisti?', 'Direzione', 'tutti', 'manuale')`,
    [rows.q1, rows.q2, A],
  );
  // «In breve» con il nome; le regole di Granola con due indirizzi e un dominio (in B lo stesso indirizzo).
  await q(`INSERT INTO context_briefs (workspace_id, lines, facts_hash) VALUES ($1, $2::jsonb, $3)`, [
    A,
    JSON.stringify(["Il magazzino lo gestisce Rossi.", "Il gestionale è SAP Business One.", "Gli ordini arrivano via e-mail."]),
    "b".repeat(64),
  ]);
  await q(`INSERT INTO context_granola_rules (workspace_id, emails, domains) VALUES ($1, $2::text[], '{cliente.test}'), ($3, $4::text[], '{}')`, [
    A,
    `{${ADDRESS},anna.bianchi@cliente.test}`,
    ids.wsB,
    `{${ADDRESS}}`,
  ]);
  // La memoria della chat.
  await q(`INSERT INTO conversations (id, workspace_id, user_id, type) VALUES ($1, $2, $3, 'general'), ($4, $5, $6, 'general')`, [rows.convA, A, ids.ls, rows.convB, ids.wsB, ids.lsb]);
  await q(
    `INSERT INTO conversation_memory (conversation_id, workspace_id, content, role)
     VALUES ($1, $2, 'Rossi dice che il magazzino apre alle 8.', 'user'), ($1, $2, 'Il gestionale è SAP Business One.', 'assistant'), ($3, $4, 'Rossi nel cliente B.', 'user')`,
    [rows.convA, A, rows.convB, ids.wsB],
  );
  // I documenti: d1 con il nome nel nome del file, d2 di prima della 9a (senza fonte) con il nome nel testo, d3 senza.
  await q(
    `INSERT INTO uploaded_documents (id, workspace_id, user_id, file_name, file_type, file_size, blob_url, extracted_text, created_at)
     VALUES ($1, $4, $5, 'organigramma-rossi.pdf', 'application/pdf', 1000, 'https://blob.test/d1.pdf', 'Organigramma: magazzino, acquisti.', now() - interval '2 days'),
            ($2, $4, $5, 'listino.xlsx', 'application/vnd.ms-excel', 1000, 'https://blob.test/d2.xlsx', 'Referente: Mario Rossi', now() - interval '1 day'),
            ($3, $4, $5, 'procedure.pdf', 'application/pdf', 1000, 'https://blob.test/d3.pdf', 'Procedure di magazzino.', now())`,
    [rows.d1, rows.d2, rows.d3, A, ids.ls],
  );
  await q(
    `INSERT INTO context_sources (id, workspace_id, kind, origin, title, occurred_on, body_chars, document_id, visibility, read_status)
     VALUES ($1, $3, 'documento', 'web', 'Organigramma', '2026-11-13', 34, $4, 'tutti', 'letto'), ($2, $3, 'documento', 'web', 'Procedure', '2026-11-13', 23, $5, 'tutti', 'letto')`,
    [rows.s1, rows.s3, A, rows.d1, rows.d3],
  );
}

before(async () => {
  if (!enabled) return;
  process.env.UC_LS_EMAIL_DOMAINS = LS.join(",");
  const { neon } = await import("@neondatabase/serverless");
  const client = neon(url!);
  q = (text, params = []) => client.query(text, params) as Promise<Row[]>;
  await (await import("../db/ensure-schema.ts")).ensureDbSchema();
  people = await import("../db/queries/context-people.ts");
  pure = await import("./people.ts");
  dbModule = await import("../db/index.ts");
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione A di prova persone', $2), ($3, 'Organizzazione B di prova persone', $4)`, [
    ids.orgA,
    `org-persone-a-${suffix}`,
    ids.orgB,
    `org-persone-b-${suffix}`,
  ]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Cliente A di prova persone'), ($3, $4, 'Cliente B di prova persone')`, [ids.wsA, ids.orgA, ids.wsB, ids.orgB]);
  for (const person of persons) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1, $2, $3, now())`, [ids[person], EMAIL[person], `Prova ${person}`]);
    await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [ids[ROLE[person][0]], ids[person], ROLE[person][1]]);
  }
  await seed();
});

after(async () => {
  if (!enabled) return;
  await q(`DELETE FROM context_proposals WHERE workspace_id = ANY($1::uuid[])`, [[ids.wsA, ids.wsB]]);
  await q(`UPDATE context_facts SET supersedes_id = NULL WHERE workspace_id = ANY($1::uuid[])`, [[ids.wsA, ids.wsB]]);
  await q(`DELETE FROM workspaces WHERE id = ANY($1::uuid[])`, [[ids.wsA, ids.wsB]]);
  await q(`DELETE FROM organizations WHERE id = ANY($1::uuid[])`, [[ids.orgA, ids.orgB]]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [persons.map((p) => ids[p])]);
});

/** Quello che finisce nella console durante `run`, senza stamparlo. */
async function consoleOf(t: import("node:test").TestContext, run: () => Promise<unknown>): Promise<string> {
  const lines: string[] = [];
  const record = (...args: unknown[]) => void lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  for (const method of ["log", "info", "warn", "error", "debug"] as const) t.mock.method(console, method, record);
  await run();
  t.mock.restoreAll();
  return lines.join("\n");
}

/** Tutto quello che il workspace B ha con il nome: non deve cambiare. */
async function workspaceB(): Promise<string> {
  const B = ids.wsB;
  const parts = await Promise.all([
    q(`SELECT title, body, participants, text_purged_at FROM context_sources WHERE workspace_id = $1 ORDER BY id`, [B]),
    q(`SELECT statement, quote, version FROM context_facts WHERE workspace_id = $1 ORDER BY id`, [B]),
    q(`SELECT emails FROM context_granola_rules WHERE workspace_id = $1`, [B]),
    q(`SELECT content FROM conversation_memory WHERE workspace_id = $1 ORDER BY id`, [B]),
    q(`SELECT count(*)::int AS n FROM context_events WHERE workspace_id = $1`, [B]),
  ]);
  return JSON.stringify(parts);
}

// ─── La stessa espressione in Postgres e in JavaScript ───────────────

test("Postgres e JavaScript: con l'espressione di personPattern, gli stessi testi trovati e le stesse sostituzioni", opts, async () => {
  const cases: Array<[term: string, texts: string[]]> = [
    ["Rossi", ["Mario Rossi e Rossini", "ROSSÌ, rossi; Rossi-Bianchi", "Rossì a capo\nRossi", "dott.Rossi (Rossi) «Rossi»", "Grossi Rossiello XRossi Rossi2 Rossi_x", "📞 Rossi"]],
    ["Nicolò", ["Nicolo NICOLÒ nicolò", "Nicolò".normalize("NFD"), "Nicolosi"]],
    ["De Luca", ["de  luca", "De\nLuca", "De Luca", "DeLuca", "De Lucarelli"]],
    ["D'Angelo", ["D’Angelo e d'angelo", "dell'Angelo"]],
    ["Søren", ["SØREN e søren", "Soren"]],
    ["Νίκος", ["ΝΊΚΟΣ και νίκος", "Νικος", "Νίκοσ"]],
    ["Rossi 3", ["Rossi 3 e Rossi 33"]],
    ["O'Neil-Smith", ["o’neil–smith", "O'Neil-Smithson"]],
    [ADDRESS, ["Mario.Rossi@Cliente.TEST", "scrivi a mario.rossi@cliente.test.", "joanna.mario.rossi@cliente.test", "mario.rossi@cliente.test.com", "<mario.rossi@cliente.test>"]],
    ["R.ssi (x|y) [a-z]+$", ["R.ssi (x|y) [a-z]+$ e Rossi (x|y) za"]],
    ["x".repeat(80), [`a ${"x".repeat(80)} b`, "x".repeat(81)]],
  ];
  let compared = 0;
  for (const [term, texts] of cases) {
    const pattern = pure.personPattern(term);
    for (const text of texts) {
      const [row] = await q(`SELECT $1::text ~ $2::text AS found, regexp_replace($1::text, $2::text, $3::text, 'g') AS replaced`, [text, pattern, pure.PERSON_PLACEHOLDER]);
      assert.equal(row.found, new RegExp(pattern).test(text), `${term} in ${JSON.stringify(text)}`);
      assert.equal(row.replaced, pure.replacePerson(text, term), `${term} in ${JSON.stringify(text)}`);
      compared += 1;
    }
  }
  assert.ok(compared >= 30, `${compared} confronti`);
  // regexp_instr conta i caratteri come personSnippet: un'emoji prima del nome non sposta il nome.
  const [where] = await q(`SELECT regexp_instr($1::text, $2::text) AS at, regexp_instr($1::text, $2::text, 1, 1, 1) - regexp_instr($1::text, $2::text) AS len`, ["📞 Rossi richiama", pure.personPattern(NAME)]);
  assert.deepEqual([Number(where.at) - 1, Number(where.len)], [2, 5]);
});

// ─── Chi può ─────────────────────────────────────────────────────────

test("chi non è di Lateral Space riceve permesso_mancante, e niente cambia; un termine troppo corto: dati_non_validi", opts, async () => {
  const snapshot = async () =>
    JSON.stringify(
      await Promise.all([
        q(`SELECT id, title, body, version FROM context_sources WHERE workspace_id = $1 ORDER BY id`, [ids.wsA]),
        q(`SELECT id, statement, quote, version FROM context_facts WHERE workspace_id = $1 ORDER BY id`, [ids.wsA]),
        q(`SELECT emails FROM context_granola_rules WHERE workspace_id = $1`, [ids.wsA]),
        q(`SELECT count(*)::int AS n FROM conversation_memory WHERE workspace_id = $1`, [ids.wsA]),
      ]),
    );
  const beforeAll = await snapshot();
  const client = actor("rev");
  for (const result of [await people.searchPerson(client, NAME), await people.erasePerson(client, NAME)]) {
    assert.equal(result.ok ? "ok" : result.error, "permesso_mancante");
  }
  // Un indirizzo di Lateral Space non verificato non è Lateral Space; chi segue solo un corso non entra.
  assert.equal(((await people.erasePerson(actor("ls", { isLateralSpace: false }), NAME)) as { error?: string }).error, "permesso_mancante");
  assert.equal(((await people.erasePerson(actor("ls", { role: "learner" }), NAME)) as { error?: string }).error, "permesso_mancante");
  const short = await people.erasePerson(actor("ls"), "Ro");
  assert.deepEqual(short.ok ? null : [short.error, short.message], ["dati_non_validi", "Scrivi almeno 3 lettere."]);
  assert.equal(await snapshot(), beforeAll, "nessuna scrittura");
});

// ─── La ricerca ──────────────────────────────────────────────────────

test("la ricerca trova appunti (testo, titolo, «Con chi»), fatti anche della storia, citazioni, proposte, impegni, domande, documenti, Granola, chat", opts, async () => {
  const hits = okValue(await people.searchPerson(actor("ls"), `  ${NAME} `));
  assert.equal(hits.term, NAME);
  assert.equal(hits.isEmail, false);
  // Gli appunti: n1 (testo, titolo, «Con chi») e n3 (il nome nell'indirizzo); non n2, non quelli di B. Dal più recente.
  assert.equal(hits.notes.total, 2);
  assert.deepEqual(hits.notes.rows.map((r) => [r.id, r.occurredOn]), [[rows.n1, "2026-11-14"], [rows.n3, "2026-11-12"]]);
  assert.deepEqual(hits.notes.rows[0].snippet, { before: "Ha parlato Mario ", match: "Rossi", after: " del magazzino. Rossi gestisce il magazzino; il cartone lo fornisce Rossini." });
  assert.deepEqual(hits.notes.rows[1].snippet, { before: "Scrivere a mario.", match: "rossi", after: "@cliente.test per il listino aggiornato." });
  // I fatti: gli attivi prima, poi la storia (la versione di prima, il ritirato). Non «Rossini», non quello di B.
  assert.equal(hits.facts.total, 4);
  assert.deepEqual(new Set(hits.facts.rows.map((r) => r.id)), new Set([rows.f1, rows.f5, rows.f0, rows.f4]));
  assert.deepEqual(hits.facts.rows.map((r) => r.history), [false, false, true, true]);
  const f1 = hits.facts.rows.find((r) => r.id === rows.f1)!;
  assert.deepEqual(f1.snippet, { before: "", match: "Rossi", after: " gestisce il magazzino." }, "la frase intera, senza «…»");
  // Citazioni dei fatti (f1, f2), proposte di ogni stato (p1, p4 aperte; p5 confermata, p6 scartata), impegni (c1, c2), domande (q1).
  assert.equal(hits.items.total, 2 + 4 + 2 + 1);
  // I documenti: il nome del file (d1, con il suo pannello) e il testo di uno di prima della 9a (d2, senza pannello).
  assert.equal(hits.documents.total, 2);
  assert.deepEqual(hits.documents.rows, [
    { sourceId: null, fileName: "listino.xlsx" },
    { sourceId: rows.s1, fileName: "organigramma-rossi.pdf" },
  ]);
  assert.equal(hits.granola.total, 1, "l'indirizzo che contiene il cognome");
  assert.equal(hits.chat.total, 1);
});

test("con l'e-mail: il testo esatto, senza maiuscole", opts, async () => {
  const hits = okValue(await people.searchPerson(actor("ls"), "Mario.Rossi@Cliente.TEST"));
  assert.equal(hits.isEmail, true);
  assert.deepEqual(hits.notes.rows.map((r) => r.id), [rows.n3]);
  assert.deepEqual(hits.notes.rows[0].snippet, { before: "Scrivere a ", match: ADDRESS, after: " per il listino aggiornato." });
  assert.deepEqual([hits.facts.total, hits.items.total, hits.documents.total, hits.granola.total, hits.chat.total], [0, 0, 0, 1, 0]);
});

// ─── «Togli … da tutto» ──────────────────────────────────────────────

test("«Togli … da tutto»: solo quel workspace; gli appunti senza testo, i fatti tenuti con «una persona», «In breve» cancellato, Granola senza l'indirizzo", opts, async (t) => {
  const otherBefore = await workspaceB();
  const factsBefore = await q(`SELECT id, status, version FROM context_facts WHERE workspace_id = $1 ORDER BY id`, [ids.wsA]);
  const decidedBefore = await q(`SELECT id, decided_at::text AS decided_at FROM context_proposals WHERE id = ANY($1::uuid[]) ORDER BY id`, [[rows.p5, rows.p6]]);
  const logs = await consoleOf(t, async () => {
    const found = okValue(await people.searchPerson(actor("ls"), NAME));
    const erased = okValue(await people.erasePerson(actor("ls"), NAME));
    // 2 appunti; testi: 4 fatti + 2 citazioni + 4 proposte (2 aperte, 2 chiuse) + 2 impegni + 1 domanda.
    assert.deepEqual(erased, { notes: 2, texts: 13, rules: 1, chatMemory: 1 });
    // Gli stessi numeri della ricerca: i testi corretti sono i fatti più le citazioni, proposte, impegni e domande trovati.
    assert.deepEqual([erased.notes, erased.texts, erased.rules, erased.chatMemory], [found.notes.total, found.facts.total + found.items.total, found.granola.total, found.chat.total]);
  });
  assert.doesNotMatch(logs, NAME_ANYWHERE, "nei log mai il nome");

  // Gli appunti trovati: niente testo né «Con chi», un titolo generico, il testo cancellato; la lettura in corso perde la presa.
  const notes = new Map((await q(`SELECT id, title, body, body_hash, participants, text_purged_at, read_status, read_reason, read_started_at, version FROM context_sources WHERE workspace_id = $1`, [ids.wsA])).map((r) => [r.id, r]));
  for (const [id, day] of [[rows.n1, "2026-11-14"], [rows.n3, "2026-11-12"]] as const) {
    const note = notes.get(id)!;
    assert.deepEqual([note.title, note.body, note.body_hash, note.participants, note.version], [pure.erasedNoteTitle(day), null, null, null, 2], id);
    assert.ok(note.text_purged_at, id);
  }
  assert.equal(notes.get(rows.n1)!.title, "Appunti del 14/11/2026");
  assert.deepEqual([notes.get(rows.n1)!.read_status, notes.get(rows.n1)!.read_reason], ["letto", null], "una nota già letta resta letta");
  assert.deepEqual([notes.get(rows.n3)!.read_status, notes.get(rows.n3)!.read_reason, notes.get(rows.n3)!.read_started_at], ["non_letto", "vuoto", null]);
  assert.deepEqual([notes.get(rows.n2)!.title, notes.get(rows.n2)!.version, notes.get(rows.n2)!.text_purged_at], ["Call sui sistemi", 1, null], "gli altri appunti non cambiano");
  // I documenti restano, anche con il nome.
  assert.deepEqual((await q(`SELECT file_name FROM uploaded_documents WHERE workspace_id = $1 ORDER BY file_name`, [ids.wsA])).map((r) => r.file_name), ["listino.xlsx", "organigramma-rossi.pdf", "procedure.pdf"]);
  assert.equal((await q(`SELECT count(*)::int AS n FROM context_sources WHERE workspace_id = $1 AND kind = 'documento'`, [ids.wsA]))[0].n, 2);

  // Le proposte: il nome diventa «una persona»; quelle aperte degli appunti tolti «superate»; le chiuse perdono il nome
  // e tengono stato e data della decisione.
  const proposals = new Map((await q(`SELECT id, statement, quote, role_label, status, decided_at, version FROM context_proposals WHERE workspace_id = $1`, [ids.wsA])).map((r) => [r.id, r]));
  assert.deepEqual([proposals.get(rows.p1)!.statement, proposals.get(rows.p1)!.quote, proposals.get(rows.p1)!.status], ["una persona approva gli ordini sopra soglia.", null, "superata"]);
  assert.ok(proposals.get(rows.p1)!.decided_at);
  assert.deepEqual([proposals.get(rows.p2)!.statement, proposals.get(rows.p2)!.status], ["Il magazzino è a Bologna.", "superata"]);
  assert.deepEqual([proposals.get(rows.p3)!.status, proposals.get(rows.p3)!.version], ["aperta", 1], "una proposta senza il nome, di un appunto che resta, non cambia");
  assert.deepEqual([proposals.get(rows.p4)!.role_label, proposals.get(rows.p4)!.status, proposals.get(rows.p4)!.version], ["Ufficio di una persona", "aperta", 2]);
  const p5 = proposals.get(rows.p5)!;
  assert.deepEqual([p5.statement, p5.status, p5.version], ["una persona firma i contratti.", "confermata", 2], "la confermata perde il nome, resta confermata");
  const p6 = proposals.get(rows.p6)!;
  assert.deepEqual([p6.statement, p6.quote, p6.role_label, p6.status, p6.version], ["Richiamare una persona per il listino.", null, "Segreteria di una persona", "scartata", 2], "la scartata perde il nome, resta scartata (non «superata»)");
  assert.deepEqual(await q(`SELECT id, decided_at::text AS decided_at FROM context_proposals WHERE id = ANY($1::uuid[]) ORDER BY id`, [[rows.p5, rows.p6]]), decidedBefore, "la data della decisione non cambia");
  assert.equal((await q(`SELECT count(*)::int AS n FROM context_proposals WHERE workspace_id = $1 AND (statement ~* 'rossi' OR quote ~* 'rossi' OR role_label ~* 'rossi')`, [ids.wsA]))[0].n, 0, "nessuna proposta, di nessuno stato, tiene il nome");

  // I fatti restano tutti, con lo stesso stato: nella frase (anche nella storia) «una persona», la citazione con il nome nulla.
  const facts = await q(`SELECT id, statement, quote, status, version FROM context_facts WHERE workspace_id = $1 ORDER BY id`, [ids.wsA]);
  assert.deepEqual(facts.map((f) => [f.id, f.status]), factsBefore.map((f) => [f.id, f.status]), "nessun fatto tolto, nessuno stato cambiato");
  const fact = new Map(facts.map((f) => [f.id, f]));
  assert.deepEqual([fact.get(rows.f0)!.statement, fact.get(rows.f0)!.status], ["una persona gestiva gli ordini.", "superato"]);
  assert.deepEqual([fact.get(rows.f1)!.statement, fact.get(rows.f1)!.quote, fact.get(rows.f1)!.version], ["una persona gestisce il magazzino.", null, 2]);
  assert.deepEqual([fact.get(rows.f2)!.statement, fact.get(rows.f2)!.quote], ["Il gestionale è SAP Business One.", null], "la citazione con il nome si cancella, la frase resta");
  assert.deepEqual([fact.get(rows.f3)!.statement, fact.get(rows.f3)!.version], ["Rossini fornisce il cartone.", 1]);
  assert.deepEqual([fact.get(rows.f4)!.statement, fact.get(rows.f4)!.status], ["Mario una persona era il referente.", "ritirato"]);
  assert.equal(fact.get(rows.f5)!.statement, pure.replacePerson(LONG, NAME).slice(0, 200), "dentro i 200 caratteri");
  assert.equal(String(fact.get(rows.f5)!.statement).length, 200);

  // Impegni e domande, aperti e chiusi: la frase e il ruolo con «una persona»; gli altri non cambiano.
  const commitments = new Map((await q(`SELECT id, statement, role_label, status, version FROM context_commitments WHERE workspace_id = $1`, [ids.wsA])).map((r) => [r.id, r]));
  assert.equal(commitments.get(rows.c1)!.statement, "Mandare a una persona l'elenco dei fornitori");
  assert.deepEqual([commitments.get(rows.c2)!.role_label, commitments.get(rows.c2)!.status], ["Segreteria di una persona", "fatto"]);
  assert.equal(commitments.get(rows.c3)!.version, 1);
  const questions = new Map((await q(`SELECT id, question, ask_whom, version FROM context_questions WHERE workspace_id = $1`, [ids.wsA])).map((r) => [r.id, r]));
  assert.deepEqual([questions.get(rows.q1)!.question, questions.get(rows.q1)!.ask_whom], ["una persona conferma il listino?", "Mario una persona"]);
  assert.equal(questions.get(rows.q2)!.version, 1);

  // «In breve» lo citava: cancellato (lo riscrive la notte). Granola: l'indirizzo esce, il resto resta. La chat: la riga con il nome.
  assert.equal((await q(`SELECT count(*)::int AS n FROM context_briefs WHERE workspace_id = $1`, [ids.wsA]))[0].n, 0);
  const [rules] = await q(`SELECT emails, domains FROM context_granola_rules WHERE workspace_id = $1`, [ids.wsA]);
  assert.deepEqual([rules.emails, rules.domains], [["anna.bianchi@cliente.test"], ["cliente.test"]]);
  assert.deepEqual((await q(`SELECT content FROM conversation_memory WHERE workspace_id = $1`, [ids.wsA])).map((r) => r.content), ["Il gestionale è SAP Business One."]);

  // Un evento `persona_tolta` con i soli numeri; nella storia di A mai il nome.
  const events = await q(`SELECT action, channel, actor_user_id, source_id, fact_id, detail FROM context_events WHERE workspace_id = $1`, [ids.wsA]);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    action: "persona_tolta",
    channel: "web",
    actor_user_id: ids.ls,
    source_id: null,
    fact_id: null,
    detail: { appunti: 2, fatti: 4, citazioni: 2, proposte: 4, impegni: 2, domande: 1, superate: 2, in_breve: 1, regole: 1, chat: 1 },
  });
  assert.ok(Object.values(events[0].detail as Record<string, unknown>).every((v) => typeof v === "number"));
  assert.doesNotMatch(JSON.stringify(events), NAME_ANYWHERE);

  // Il workspace B non cambia.
  assert.equal(await workspaceB(), otherBefore);
});

test("dopo «Togli» la ricerca trova solo i documenti, che si tolgono uno per uno; una seconda volta non tocca niente", opts, async () => {
  const hits = okValue(await people.searchPerson(actor("ls"), NAME));
  assert.deepEqual([hits.notes.total, hits.facts.total, hits.items.total, hits.granola.total, hits.chat.total], [0, 0, 0, 0, 0]);
  assert.equal(hits.documents.total, 2);
  const versions = JSON.stringify(await q(`SELECT id, version FROM context_facts WHERE workspace_id = $1 ORDER BY id`, [ids.wsA]));
  assert.deepEqual(okValue(await people.erasePerson(actor("ls"), NAME)), { notes: 0, texts: 0, rules: 0, chatMemory: 0 });
  assert.equal(JSON.stringify(await q(`SELECT id, version FROM context_facts WHERE workspace_id = $1 ORDER BY id`, [ids.wsA])), versions);
  assert.equal((await q(`SELECT count(*)::int AS n FROM context_events WHERE workspace_id = $1`, [ids.wsA]))[0].n, 1, "niente da togliere: nessun evento");
});

test("«In breve» resta se non cita il nome", opts, async () => {
  await q(`INSERT INTO context_briefs (workspace_id, lines, facts_hash) VALUES ($1, $2::jsonb, $3)`, [ids.wsA, JSON.stringify(["Il gestionale è SAP Business One.", "Gli ordini arrivano via e-mail."]), "c".repeat(64)]);
  await q(`INSERT INTO context_facts (workspace_id, section, statement, basis, visibility, origin) VALUES ($1, 'lavoro', 'Verdi approva i preventivi.', 'detto', 'tutti', 'manuale')`, [ids.wsA]);
  const erased = okValue(await people.erasePerson(actor("ls"), "Verdi"));
  assert.deepEqual(erased, { notes: 0, texts: 1, rules: 0, chatMemory: 0 });
  assert.equal((await q(`SELECT count(*)::int AS n FROM context_briefs WHERE workspace_id = $1`, [ids.wsA]))[0].n, 1);
  assert.equal((await q(`SELECT count(*)::int AS n FROM context_facts WHERE workspace_id = $1 AND statement = 'una persona approva i preventivi.'`, [ids.wsA]))[0].n, 1);
});

test("nei log mai il nome, anche quando il database non risponde; il messaggio di errore non lo ripete", opts, async (t) => {
  let result: { ok: boolean; error?: string; message?: string } | null = null;
  const logs = await consoleOf(t, async () => {
    t.mock.method(dbModule.db, "batch", async () => {
      throw Object.assign(new Error(`invalid regular expression near ${NAME} in ${ADDRESS}`), { code: "2201B", detail: `${NAME}` });
    });
    result = await people.searchPerson(actor("ls"), NAME);
    const erased = await people.erasePerson(actor("ls"), ADDRESS);
    assert.equal(erased.ok ? "ok" : erased.error, "riprova");
  });
  assert.equal(result!.ok ? "ok" : result!.error, "riprova");
  assert.match(logs, /\[context\/people\] persona_non_cercata/);
  assert.match(logs, /\[context\/people\] persona_non_tolta/);
  assert.match(logs, /"code":"2201B"/, "il codice dell'errore c'è");
  assert.doesNotMatch(logs, NAME_ANYWHERE);
  assert.doesNotMatch(String(result!.message), NAME_ANYWHERE);
});
