// Synthetic use cases for the use case hub harness (docs/use-case/PIANO-LAVORI.md H2b
// and §5.1). Run after scripts/uc-test/seed-fixtures.mjs, on the same database and Auth
// emulator, from a checkout without .env files:
//
//   export UC_TEST_ROOT=/private/tmp/<dir>/hub
//   export UC_TEST_PG_PORT=55479 UC_TEST_PG_DB=<hub database> UC_TEST_AUTH_PORT=59119
//   node --no-warnings scripts/uc-test/seed-fixtures.mjs
//   node --no-warnings scripts/use-case-test/seed-hub.mjs
//
// What it adds (seed-fixtures.mjs is not modified):
// - the account sponsor-cliente@cliente.test (exec_sponsor of workspace «a», a client
//   person who manages the workspace) in the emulator, in `users` and in the manifest
//   $UC_TEST_ROOT/uc-fixtures/synthetic-fixtures.json;
// - memberships in workspace «b» for ls-lead, function-lead, osservatore and
//   sponsor-cliente, so one login run checks the area on («a») and off («b»);
// - a code configuration for both workspaces (prefixes XX and YY, connector off) and the
//   codes, assigned with the app's own SQL;
// - about thirty use cases in «a»: the 23 rows of docs/use-case/DESIGN.md §3.5, both
//   origins, both kinds, a cost from every source the hub reads today (team amount, team
//   band, effort, none), cards hidden from search, two dossiers started from their cards
//   through the app's createCase (one «In preparazione», one «In sviluppo»), and two
//   proposals of osservatore (D13): one saved with their email, one with their user id;
//   the first has a public note, the second is hidden from search;
// - a few use cases in «b», with scores and notes, for the pages of workspaces that are off;
// - Story rows for the two «Riapri», the two realizations and one «Serve info» answered by its
//   proposer (D17: the decision, then the answer), without texts; every «Creato» row is dated
//   when the card was submitted (or before its oldest Story row), not on the day of the seed;
// - an empty workspace (no use case) in the organization of «a», where the four accounts have
//   their roles of «a», for the empty states of the page (scripts/use-case-test/screens/
//   hub.routes.mjs reads its id from HUB_EMPTY_WORKSPACE_ID; the seed prints it). Put it in
//   USE_CASE_HUB_WORKSPACES together with «a».
//
// Every value is invented. Only the local cluster (127.0.0.1, never the Casi d'uso,
// Learning or connector clusters) and the local emulator are reached. It runs once per
// fixture set: a second run stops without writing.
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  UC_TEST_AUTH_PORT,
  UC_TEST_DATABASE_URL,
  UC_TEST_DB,
  UC_TEST_HOST,
  UC_TEST_LS_DOMAIN,
  UC_TEST_PORT,
  UC_TEST_USER,
  ucTestRoot,
} from "../uc-test/config.mjs";
import { ASSIGN_USE_CASE_CODE_SQL } from "../../src/lib/portfolio/use-case-code.ts";
import { currentQuarter, nextQuarter, romeToday } from "../../src/lib/use-cases/quarter.ts";

// 55439 Learning, 55449 Casi d'uso, 55469 connector: the hub seed never writes there.
if ([55439, 55449, 55469].includes(UC_TEST_PORT)) {
  throw new Error(`Port ${UC_TEST_PORT} is not the hub's cluster: set UC_TEST_PG_PORT (the hub uses 55479)`);
}
if (readdirSync(process.cwd()).some((name) => /^\.env($|\.)/.test(name))) {
  throw new Error("Run the hub harness in a checkout without .env files");
}

const requireFromApp = createRequire(resolve("package.json"));
const { Client } = requireFromApp("pg");
const root = ucTestRoot();
const manifestPath = join(root, "uc-fixtures", "synthetic-fixtures.json");
if (!existsSync(manifestPath)) throw new Error(`No fixtures manifest at ${manifestPath}: run scripts/uc-test/seed-fixtures.mjs first`);
const fixtures = JSON.parse(readFileSync(manifestPath, "utf8"));
if (fixtures.hub) throw new Error("The hub seed already ran for this fixture set: reuse it or start from a new database");
for (const name of ["ls-lead", "function-lead", "osservatore", "owner-cliente", "approvatore-privacy", "estraneo"]) {
  if (!fixtures.accounts?.[name]) throw new Error(`The manifest has no ${name} account`);
}
const auth = `http://${UC_TEST_HOST}:${UC_TEST_AUTH_PORT}`;
const SPONSOR = "sponsor-cliente";
const SPONSOR_EMAIL = `${SPONSOR}@cliente.test`;

// ─── Dates, relative to today in Europe/Rome ─────────────────────────

const today = romeToday();
const thisQuarter = currentQuarter();
const followingQuarter = nextQuarter(thisQuarter);
function previousQuarter(q) {
  const year = Number(q.slice(0, 4));
  const n = Number(q.slice(6));
  return n === 1 ? `${year - 1}-Q4` : `${year}-Q${n - 1}`;
}
const pastQuarter = previousQuarter(thisQuarter);
/** `AAAA-MM-GG`, `days` after today (negative: before). */
function dayFromToday(days) {
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
/** An instant `days` before now, for `submitted_at` and the Story. */
function daysAgo(days) {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

// ─── Synthetic content ───────────────────────────────────────────────

const HIGH = { impact: { efficiency: 4, profitability: 4 } };
const MID = { impact: { efficiency: 3, profitability: 3 } };
const LOW = { impact: { efficiency: 2, profitability: 2 } };
const ai = (scores) => ({ scores, rationale: "Stima sintetica di prova.", model: "prova", at: daysAgo(2), kind: "auto" });

const account = (name) => fixtures.accounts[name];
const lead = account("ls-lead");

/**
 * The cards of workspace «a». `row` is the row of DESIGN §3.5 (null for the extra cards);
 * `dossier` starts one through createCase; `reopen` and `realized` add a Story row.
 * Proposers: emails and ids of synthetic accounts, a Slack id, labels.
 */
function cardsOfA(sponsorId) {
  const osservatore = account("osservatore");
  // D17: an answer waiting for a decision carries its date in `rispostaInAttesa` (answerInfoRequest).
  const answeredAt = daysAgo(1);
  const ownAnsweredAt = daysAgo(2);
  return [
    { key: "r01", row: 1, title: "Riepilogo settimanale dei turni", status: "proposed", review: "needs_inputs", proposedBy: account("owner-cliente").email, submittedDays: 2 },
    {
      key: "r02",
      row: 2,
      title: "Classificazione automatica delle email in arrivo",
      status: "draft",
      review: "needs_inputs",
      source: "activity_mapping",
      origin: "transformation",
      intake: { hiddenFromSearch: true },
      proposedBy: null,
      legacy: { impact_time: 4, impact_quality: 3, feasibility_data: 3, feasibility_workflow: 3, feasibility_tech: 2, feasibility_team: 3 },
      submittedDays: 9,
    },
    {
      key: "r03",
      row: 3,
      title: "Controllo delle note spese",
      source: "claude_connector",
      proposedBy: "Persona di prova",
      intake: {
        contractVersion: 2,
        area: "amministrazione",
        frequency: "giornaliera",
        beneficiaries: 3,
        timeSavedMinutesPerRun: 15,
        proposerEstimate: { efficiency: { score: 4 }, effort: { score: 2 }, impactFlag: { value: "verde" } },
        flags: { personalData: true },
        submitterEmail: "segnalante@cliente.test",
      },
      aiSuggestion: ai({ impact: { efficiency: 4 }, feasibility: { effort: 2 } }),
      submittedDays: 6,
    },
    { key: "r04", row: 4, title: "Verifica delle note spese dei consulenti", possibleDuplicateOf: "r03", submittedDays: 4 },
    {
      key: "r05",
      row: 5,
      title: "Archivio dei contratti fornitori",
      review: "needs_inputs",
      reviewedBy: lead.id,
      publicNote: "Quante note spese arrivano ogni mese?",
      proposedBy: account("function-lead").email,
      submittedDays: 15,
    },
    { key: "r06", row: 6, title: "Smistamento richieste", review: "scored", customScores: HIGH, costEurOnce: 18_000, valueEurYear: 60_000, proposedBy: account("approvatore-privacy").id, submittedDays: 12 },
    { key: "r07", row: 7, title: "Sintesi delle riunioni di reparto", customScores: MID, reviewBy: dayFromToday(30), submittedDays: 20 },
    { key: "r08", row: 8, title: "Calendario ferie condiviso", review: "scored", customScores: LOW, costBand: 1, reviewBy: dayFromToday(-5), submittedDays: 40 },
    { key: "r09", row: 9, title: "Preventivi automatici per i clienti", status: "accepted", review: "scored", targetQuarter: followingQuarter, customScores: HIGH, costBand: 2, valueEurYear: 45_000 },
    { key: "r10", row: 10, title: "Analisi dei reclami", status: "accepted", review: "scored", customScores: MID, costEurOnce: 120_000 },
    {
      key: "r11",
      row: 11,
      title: "Ordini ricorrenti di cancelleria",
      status: "accepted",
      review: "scored",
      targetQuarter: pastQuarter,
      customScores: HIGH,
      aiSuggestion: ai({ feasibility: { effort: 3 } }),
    },
    { key: "r12", row: 12, title: "Prezzi e sconti", status: "accepted", review: "scored", targetQuarter: thisQuarter, customScores: HIGH, costEurOnce: 40_000, valueEurYear: 80_000, dossier: "raccolta" },
    // Parent card of an orphan dossier, born as DESIGN §10.9 and §8.6 create it: hidden from search.
    {
      key: "r13",
      row: 13,
      title: "Inventario di magazzino",
      status: "accepted",
      review: "scored",
      source: "manual",
      origin: "transformation",
      intake: { hiddenFromSearch: true },
      proposedBy: null,
      customScores: MID,
      costBand: 3,
      dossier: "in_sviluppo",
    },
    { key: "r14", row: 14, title: "Risposte alle domande frequenti", status: "in_progress", review: "scored", customScores: MID, costEurOnce: 25_000 },
    { key: "r15", row: 15, title: "Fatture in arrivo", status: "implemented", review: "scored", valueEurYear: 30_000, realized: 20 },
    { key: "r16", row: 16, title: "Modelli di email per l'assistenza", kind: "best_practice", status: "implemented", review: "scored", realized: 40 },
    { key: "r17", row: 17, title: "Chatbot per il sito", status: "rejected", review: "scored", reviewedBy: lead.id, publicNote: "Non rientra nel perimetro di quest'anno." },
    { key: "r18", row: 18, title: "Traduzione dei cataloghi", submittedDays: 60, reopen: 3 },
    { key: "r19", row: 19, title: "Smistamento delle richieste dei clienti", review: "archived", archiveReason: "duplicato", duplicateOf: "r06" },
    { key: "r20", row: 20, title: "Report mensile manuale", review: "archived", archiveReason: "superato" },
    { key: "r21", row: 21, title: "Promemoria delle scadenze", status: "implemented", review: "archived", archiveReason: "superato" },
    { key: "r22", row: 22, title: "Riordino dei documenti", status: "accepted", review: "archived", archiveReason: "ritirato" },
    { key: "r23", row: 23, title: "Analisi del sentiment", reviewedBy: lead.id, publicNote: "Servono esempi di richieste.", submittedDays: 50, reopen: 1 },
    // D13: the two proposals of osservatore.
    {
      key: "osservatore-email",
      row: null,
      title: "Riepilogo delle chiamate di assistenza",
      review: "needs_inputs",
      reviewedBy: lead.id,
      publicNote: "Quante richieste arrivano a settimana?",
      proposedBy: osservatore.email,
      submittedDays: 8,
    },
    {
      key: "osservatore-id",
      row: null,
      title: "Glossario dei termini tecnici",
      source: "learning",
      origin: "transformation",
      intake: { hiddenFromSearch: true },
      proposedBy: osservatore.id,
      submittedDays: 3,
    },
    // Other cards: hidden from search, best practices, zones, channels.
    {
      key: "nascosta",
      row: null,
      title: "Previsione della domanda",
      status: "accepted",
      review: "scored",
      source: "manual",
      origin: "transformation",
      intake: { hiddenFromSearch: true },
      proposedBy: null,
      targetQuarter: thisQuarter,
      customScores: HIGH,
      costEurOnce: 120_000,
      valueEurYear: 150_000,
      publicNote: "Nota pubblica di una scheda nascosta.",
    },
    {
      key: "diffondere-stima",
      row: null,
      title: "Prompt per riassumere i verbali",
      kind: "best_practice",
      status: "accepted",
      review: "scored",
      source: "claude_connector",
      proposedBy: "Persona di prova",
      intake: { contractVersion: 2, frequency: "settimanale", beneficiaries: 12, timeSavedMinutesPerRun: 20 },
    },
    { key: "diffondere", row: null, title: "Checklist per le offerte", kind: "best_practice", status: "accepted", review: "scored" },
    { key: "non-ora", row: null, title: "Portale fornitori", review: "scored", customScores: MID, costEurOnce: 300_000 },
    { key: "se-avanza", row: null, title: "Etichette per l'archivio", review: "scored", customScores: LOW, costBand: 1, proposedBy: sponsorId },
    { key: "readiness", row: null, title: "Assistente per le policy interne", source: "ai_readiness_assessment", proposedBy: "AI Readiness respondent" },
    { key: "slack", row: null, title: "Ricerca nei manuali tecnici", source: "slack_proposed", proposedBy: "U0SLACK001", submittedDays: 1 },
    // D17: a «Serve info» already answered by the proposer, back in «Da decidere» (H4p).
    {
      key: "risposta",
      row: null,
      title: "Verbali delle visite ai clienti",
      reviewedBy: lead.id,
      publicNote: "Quante visite fate al mese?",
      intake: { risposte: [{ at: answeredAt, text: "Circa 40 visite al mese, con un verbale ciascuna." }], rispostaInAttesa: answeredAt },
      submittedDays: 10,
      asked: 2,
      answered: 1,
    },
    // D17 (H7): an own proposal of osservatore, answered and not decided yet: the contributor reads
    // the question with the own answer below it; the reviewers' row says «Risposta ricevuta».
    {
      key: "osservatore-risposta",
      row: null,
      title: "Scadenze dei contratti di manutenzione",
      reviewedBy: lead.id,
      publicNote: "Quanti contratti scadono ogni anno?",
      intake: { risposte: [{ at: ownAnsweredAt, text: "Una trentina, quasi tutti a dicembre." }], rispostaInAttesa: ownAnsweredAt },
      proposedBy: osservatore.id,
      submittedDays: 12,
      asked: 3,
      answered: 2,
    },
  ];
}

function cardsOfB() {
  return [
    {
      key: "b-visibile",
      title: "Gestione degli abbonamenti",
      review: "scored",
      customScores: HIGH,
      costEurOnce: 30_000,
      overall: { impact: 4, feasibility: 3.5, score: 3.8 },
      publicNote: "Nota pubblica del workspace b.",
      proposedBy: account("estraneo").email,
    },
    { key: "b-nascosta", title: "Piano dei fabbisogni", origin: "transformation", source: "manual", intake: { hiddenFromSearch: true }, proposedBy: null },
    { key: "b-osservatore", title: "Modulo per le richieste di ferie", proposedBy: account("osservatore").id, publicNote: "Ne parliamo alla prossima riunione." },
    { key: "b-approvata", title: "Promemoria per i pagamenti", status: "accepted", review: "scored", targetQuarter: followingQuarter, customScores: MID, overall: { impact: 3, feasibility: 3, score: 3 } },
  ];
}

// ─── Writes ──────────────────────────────────────────────────────────

const client = new Client({ host: UC_TEST_HOST, port: UC_TEST_PORT, user: UC_TEST_USER, database: UC_TEST_DB });
await client.connect();
try {
  const schema = await client.query(
    `SELECT to_regclass('public.use_case_events') IS NOT NULL AS hub,
            to_regclass('public.uc_cases') IS NOT NULL AS uc,
            EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'use_cases' AND column_name = 'target_quarter') AS columns`,
  );
  if (!schema.rows[0].hub || !schema.rows[0].columns) throw new Error("The database has no 0020: run scripts/uc-test/db-init.mjs init on the hub cluster first");
  if (!schema.rows[0].uc) throw new Error("The database has no uc tables (0018): the hub seed links two dossiers");
  const workspaces = { a: fixtures.workspaces.a.workspaceId, b: fixtures.workspaces.b.workspaceId };
  const existing = await client.query(`SELECT 1 FROM users WHERE email = $1`, [SPONSOR_EMAIL]);
  if (existing.rowCount) throw new Error(`${SPONSOR_EMAIL} already exists: the hub seed ran on this database`);

  // The new account: emulator first, then the app's rows (the same password as the other synthetic accounts).
  const password = lead.password;
  const signUp = await fetch(`${auth}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=local-only`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: SPONSOR_EMAIL, password, returnSecureToken: true }),
  });
  const signed = await signUp.json();
  if (!signUp.ok || !signed.localId) throw new Error(`Emulator signup failed for ${SPONSOR}`);
  const sponsorId = randomUUID();
  await client.query(`INSERT INTO users (id, firebase_uid, email, name, email_verified) VALUES ($1, $2, $3, $4, now())`, [
    sponsorId,
    signed.localId,
    SPONSOR_EMAIL,
    `Prova ${SPONSOR}`,
  ]);
  await client.query(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'exec_sponsor')`, [workspaces.a, sponsorId]);
  fixtures.accounts[SPONSOR] = { id: sponsorId, firebaseUid: signed.localId, email: SPONSOR_EMAIL, password, workspace: "a", workspaceRole: "exec_sponsor" };

  // Workspace «b» (area off) for the same four accounts.
  const membershipsB = { "ls-lead": "transformation_lead", "function-lead": "function_lead", osservatore: "contributor", [SPONSOR]: "exec_sponsor" };
  for (const [name, role] of Object.entries(membershipsB)) {
    await client.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [workspaces.b, fixtures.accounts[name].id, role],
    );
  }

  // Codes: one configuration per workspace (connector off), then the app's assignment.
  const prefixes = {};
  for (const [letter, prefix] of [
    ["a", "XX"],
    ["b", "YY"],
  ]) {
    await client.query(
      `INSERT INTO workspace_connector_configs (workspace_id, slug, code_prefix) VALUES ($1, $2, $3) ON CONFLICT (workspace_id) DO NOTHING`,
      [workspaces[letter], `uc-test-${letter}-hub`, prefix],
    );
    prefixes[letter] = (await client.query(`SELECT code_prefix FROM workspace_connector_configs WHERE workspace_id = $1`, [workspaces[letter]])).rows[0].code_prefix;
  }

  async function insertCard(workspaceId, card) {
    const id = randomUUID();
    const legacy = card.legacy ?? {};
    const intake = { ...(card.intake ?? {}) };
    if (card.archiveReason) intake.archiveReason = card.archiveReason;
    await client.query(
      `INSERT INTO use_cases (id, workspace_id, title, description, flow_description, business_case, status, portfolio_review_status,
         portfolio_kind, origin, source, proposed_by, intake, public_note, reviewed_by, reviewed_at, review_notes, target_quarter, review_by,
         custom_scores, ai_suggestion, value_eur_year, cost_eur_once, cost_band, submitted_at,
         impact_time, impact_quality, feasibility_data, feasibility_workflow, feasibility_tech, feasibility_team,
         overall_impact_score, overall_feasibility_score, overall_score)
       VALUES ($1, $2, $3, $4, $5, $6, $7::use_case_status, $8::portfolio_review_status,
         $9, $10, $11, $12, $13::jsonb, $14, $15, CASE WHEN $15::uuid IS NULL THEN NULL ELSE now() END, $16, $17, $18::date,
         $19::jsonb, $20::jsonb, $21, $22, $23, $24::timestamp,
         $25, $26, $27, $28, $29, $30, $31, $32, $33)`,
      [
        id,
        workspaceId,
        card.title,
        `Problema sintetico: ${card.title.toLowerCase()}.`,
        "Flusso sintetico di prova.",
        "Impatto atteso sintetico.",
        card.status ?? "proposed",
        card.review ?? "in_review",
        card.kind ?? "use_case_ai",
        card.origin ?? "adoption",
        card.source === undefined ? "web_proposed" : card.source,
        card.proposedBy === undefined ? account("owner-cliente").email : card.proposedBy,
        Object.keys(intake).length ? JSON.stringify(intake) : null,
        card.publicNote ?? null,
        card.reviewedBy ?? null,
        card.customScores ? "Nota interna sintetica del team." : null,
        card.targetQuarter ?? null,
        card.reviewBy ?? null,
        card.customScores ? JSON.stringify(card.customScores) : null,
        card.aiSuggestion ? JSON.stringify(card.aiSuggestion) : null,
        card.valueEurYear ?? null,
        card.costEurOnce ?? null,
        card.costBand ?? null,
        daysAgo(card.submittedDays ?? 30).replace("T", " ").replace("Z", ""),
        legacy.impact_time ?? null,
        legacy.impact_quality ?? null,
        legacy.feasibility_data ?? null,
        legacy.feasibility_workflow ?? null,
        legacy.feasibility_tech ?? null,
        legacy.feasibility_team ?? null,
        card.overall?.impact ?? null,
        card.overall?.feasibility ?? null,
        card.overall?.score ?? null,
      ],
    );
    // The 0020 trigger stamps «Creato» with now(): date it when the card was submitted, or
    // before its oldest Story row, so the seeded Story reads in order.
    const storyDays = [card.reopen, card.realized, card.asked, card.answered].filter((days) => Number.isFinite(days));
    const createdDays = Math.max(card.submittedDays ?? 30, ...storyDays.map((days) => days + 1));
    await client.query(`UPDATE use_case_events SET at = $2::timestamptz WHERE use_case_id = $1::uuid AND action = 'creato'`, [id, daysAgo(createdDays)]);
    const assigned = await client.query(ASSIGN_USE_CASE_CODE_SQL, [workspaceId, id]);
    const code = assigned.rows[0]?.code ?? null;
    if (!code) throw new Error(`No code assigned to ${card.key}`);
    return { key: card.key, row: card.row ?? null, id, code, title: card.title };
  }

  const seeded = { a: [], b: [] };
  const cardsA = cardsOfA(sponsorId);
  for (const card of cardsA) seeded.a.push(await insertCard(workspaces.a, card));
  for (const card of cardsOfB()) seeded.b.push(await insertCard(workspaces.b, card));
  const byKey = new Map(seeded.a.map((item) => [item.key, item]));

  // Codes of other cards, known only now: «Possibile doppione» and «Doppione di…».
  for (const card of cardsA) {
    const self = byKey.get(card.key);
    if (card.possibleDuplicateOf) {
      await client.query(`UPDATE use_cases SET intake = coalesce(intake, '{}'::jsonb) || jsonb_build_object('possibleDuplicateOf', $2::text) WHERE id = $1`, [
        self.id,
        byKey.get(card.possibleDuplicateOf).code,
      ]);
    }
    if (card.duplicateOf) {
      await client.query(`UPDATE use_cases SET intake = coalesce(intake, '{}'::jsonb) || jsonb_build_object('duplicateOfCode', $2::text) WHERE id = $1`, [
        self.id,
        byKey.get(card.duplicateOf).code,
      ]);
    }
  }

  // Story rows without texts: «Riapri» (phase before in «Chiuso»), «Serve info» and its answer, realizations.
  for (const card of cardsA) {
    const self = byKey.get(card.key);
    if (card.reopen) {
      await client.query(
        `INSERT INTO use_case_events (workspace_id, use_case_id, at, actor_user_id, actor_kind, channel, action, fields, phase_before, phase_after)
         VALUES ($1, $2, $3::timestamptz, $4, 'persona', 'pagina', 'decisione', '{}', 'chiuso.non_avviato', 'da_valutare.nuova')`,
        [workspaces.a, self.id, daysAgo(card.reopen), lead.id],
      );
    }
    if (card.asked) {
      // «Serve info» from the team, as the service writes it (decisions.ts): a person, the public note.
      await client.query(
        `INSERT INTO use_case_events (workspace_id, use_case_id, at, actor_user_id, actor_kind, channel, action, fields, phase_before, phase_after)
         VALUES ($1, $2, $3::timestamptz, $4, 'persona', 'pagina', 'decisione', '{nota_pubblica}', 'da_valutare.nuova', 'da_valutare.serve_info')`,
        [workspaces.a, self.id, daysAgo(card.asked), lead.id],
      );
    }
    if (card.answered) {
      await client.query(
        `INSERT INTO use_case_events (workspace_id, use_case_id, at, actor_user_id, actor_kind, channel, action, fields, phase_before, phase_after)
         VALUES ($1, $2, $3::timestamptz, NULL, 'proponente', 'pagina', 'modificato', '{intake}', 'da_valutare.serve_info', 'da_valutare.nuova')`,
        [workspaces.a, self.id, daysAgo(card.answered)],
      );
    }
    if (card.realized) {
      const after = card.kind === "best_practice" ? "realizzato.diffusa" : "realizzato.realizzato";
      const before = card.kind === "best_practice" ? "approvato.piu_avanti" : "in_realizzazione.senza_dossier";
      await client.query(
        `INSERT INTO use_case_events (workspace_id, use_case_id, at, actor_user_id, actor_kind, channel, action, fields, phase_before, phase_after)
         VALUES ($1, $2, $3::timestamptz, $4, 'persona', 'pagina', 'decisione', '{}', $5, $6)`,
        [workspaces.a, self.id, daysAgo(card.realized), lead.id, before, after],
      );
    }
  }

  // Dossiers started from their cards, through the app's commands.
  const dossiers = [];
  for (const card of cardsA.filter((item) => item.dossier)) {
    dossiers.push(await startDossier(byKey.get(card.key), card.dossier, workspaces.a));
  }

  // An empty workspace with the area on, for the empty states (no use case at all).
  const emptyWorkspace = randomUUID();
  const organization = (await client.query(`SELECT organization_id FROM workspaces WHERE id = $1`, [workspaces.a])).rows[0].organization_id;
  await client.query(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Workspace di prova vuoto')`, [emptyWorkspace, organization]);
  const rolesOfA = await client.query(
    `SELECT user_id, role FROM workspace_memberships WHERE workspace_id = $1 AND user_id = ANY($2::uuid[])`,
    [workspaces.a, ["ls-lead", "function-lead", "osservatore", SPONSOR].map((name) => fixtures.accounts[name].id)],
  );
  for (const row of rolesOfA.rows) {
    await client.query(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [emptyWorkspace, row.user_id, row.role]);
  }

  fixtures.hub = {
    seededOn: today,
    areaOn: "a",
    areaOff: "b",
    emptyWorkspace,
    memberships: { b: membershipsB },
    prefixes,
    useCases: seeded,
    dossiers,
    osservatore: { byEmail: byKey.get("osservatore-email").code, byId: byKey.get("osservatore-id").code },
  };
  writeFileSync(manifestPath, JSON.stringify(fixtures, null, 2), { mode: 0o600 });
  console.log(
    `Hub seed: ${SPONSOR} added; ${seeded.a.length} use cases in workspace a (area on), ${seeded.b.length} in workspace b (area off); ` +
      `${dossiers.length} dossiers linked. Manifest: ${manifestPath}`,
  );
  console.log(`App: node scripts/uc-test/start-app.mjs --flag USE_CASE_HUB_WORKSPACES=${workspaces.a},${emptyWorkspace}`);
  console.log(`Empty states: HUB_EMPTY_WORKSPACE_ID=${emptyWorkspace}`);
} finally {
  await client.end();
}

/**
 * A dossier started from its card with the app's createCase (ls-lead, the published
 * example template), then moved to the wanted status. The code is the card's.
 */
async function startDossier(card, status, workspaceId) {
  process.env.UC_TEST_DATABASE_URL = UC_TEST_DATABASE_URL;
  createRequire(import.meta.url)("../uc-test/local-neon.cjs");
  const { ucExecutorForUrl } = await import(new URL("../../src/lib/db/uc-executor.ts", import.meta.url).href);
  const { createCase, loadUserContext } = await import(new URL("../../src/lib/db/queries/uc-cases.ts", import.meta.url).href);
  const exec = ucExecutorForUrl(UC_TEST_DATABASE_URL);
  const templateKey = fixtures.exampleCase?.templateKey;
  if (!templateKey) throw new Error("The manifest has no example template: seed-fixtures.mjs did not finish");
  const template = await client.query(`SELECT id FROM uc_templates WHERE key = $1 AND status = 'pubblicato' ORDER BY created_at DESC LIMIT 1`, [templateKey]);
  if (!template.rowCount) throw new Error(`Template ${templateKey} not published`);
  const user = await loadUserContext(exec, lead.id, [UC_TEST_LS_DOMAIN]);
  const created = await createCase(exec, {
    workspaceId,
    user,
    canReviewWorkspacePortfolio: true,
    input: {
      templateId: template.rows[0].id,
      code: card.code,
      title: card.title,
      oneLiner: "Dossier sintetico del harness dell'area Use case.",
      levers: ["tempo"],
      portfolioUseCaseId: card.id,
    },
  });
  if (!created.ok) throw new Error(`Dossier for ${card.key} not created: ${created.message}`);
  await client.query(`UPDATE uc_cases SET status = $2, status_changed_at = now() WHERE id = $1`, [created.value.caseId, status]);
  return { key: card.key, caseId: created.value.caseId, code: created.value.code, status };
}
