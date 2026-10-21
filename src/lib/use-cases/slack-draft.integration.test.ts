import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import * as nodeModule from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

/** `module.registerHooks` di Node 24 (i tipi di @types/node del progetto non lo hanno ancora). */
type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: {
    resolve?(specifier: string, context: object, nextResolve: (specifier: string, context: object) => ResolveResult): ResolveResult;
  }): void;
};

// Invio da Slack (docs/use-case/PIANO-LAVORI.md H3e; docs/use-case/DESIGN.md §6.8, §14.2,
// §14.5; decisioni D2 e D14):
// - dopo l'invio riuscito la bozza resta `submitted` e le sue colonne di testo vanno a NULL
//   (le stesse di `use-case-admin slack-drafts`); se la scheda non nasce la bozza torna in
//   `drafting` con i suoi testi; se la scheda nasce ma la risposta si perde, l'invio la
//   ritrova subito (ha l'id della bozza) e riesce; se nemmeno la rilettura va, la bozza torna
//   in `drafting` e il nuovo tentativo ritrova la stessa scheda, senza rifare valutazione e
//   annuncio su una scheda che un revisore ha già toccato; se dopo la scheda non vanno
//   valutazione AI o notifiche, l'invio resta riuscito e la bozza non torna indietro
//   (niente doppioni);
// - a chi ha proposto risponde «Grazie, l'ho registrato. Il codice è XX-0012: {teamName} lo
//   valuta.» con il link di condivisione; senza codice la frase resta senza;
// - il nome del team è quello del workspace, o il predefinito; nel testo WhatsApp «in coda
//   a {teamName}», senza «team» davanti.
//
// Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database del pacchetto
// hub_<id> su 127.0.0.1). Trasporti finti: la valutazione AI non chiama nessun modello e il
// webhook WhatsApp arriva a un server su 127.0.0.1 aperto da questa prova. Dentro
// `npm run check` si salta: in testa solo moduli di Node; i moduli dell'app arrivano con
// `await import()` dentro `before()`. Dati sintetici, creati e cancellati qui.
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
type Submit = typeof import("../slack/submit-contribution.ts").submitSlackContributionDraft;
type Converse = typeof import("../slack/use-case-agent.ts").handleUseCaseConversation;

let q: (text: string, params?: unknown[]) => Promise<Row[]>;
let submit: Submit;
let converse: Converse;
let DEFAULT_REVIEW_TEAM_NAME: string;
let TEXT_COLUMNS: readonly string[];

const suffix = randomBytes(3).toString("hex");
const APP_URL = "https://app.esempio.test";
const ids = { org: randomUUID(), coded: randomUUID(), named: randomUUID() };
const PREFIX = "HTE";
const NAMED_TEAM = "Digital Factory";
const SLACK = { team: `T_H3E_${suffix}`.toUpperCase(), user: `U_H3E_${suffix}`.toUpperCase(), channel: `C_H3E_${suffix}`.toUpperCase() };

/** Le chiamate ai trasporti finti, e gli interruttori per farli fallire. */
interface Fakes {
  aiCalls: string[];
  /** Le valutazioni AI chieste senza `onlyIfUntouched`: devono restare zero. */
  aiUnguarded: string[];
  /** La creazione fallisce prima dell'INSERT. */
  createFails: boolean;
  /** L'INSERT arriva al database, poi la risposta si perde (errore dopo il commit). */
  createAnswerLost: boolean;
  /** La rilettura della scheda dopo l'errore della creazione non va. */
  readBackFails: boolean;
  /** Con `createAnswerLost`: la risposta si perde prima che la scheda riceva il codice. */
  lostBeforeCode: ((useCaseId: string) => Promise<void>) | null;
  dispatchFails: boolean;
}
const fakes = (): Fakes => (globalThis as unknown as { __h3eSlack: Fakes }).__h3eSlack;

/** I corpi ricevuti dal webhook WhatsApp finto. */
const whatsapp: Array<{ text: string; event: string }> = [];
let webhook: Server;
let webhookUrl: string;

const ENV_KEYS = ["PORTFOLIO_SHARE_SECRET", "NEXT_PUBLIC_APP_URL", "VERCEL_URL"] as const;
const envBefore = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

before(async () => {
  if (!enabled) return;
  (globalThis as unknown as { __h3eSlack: Fakes }).__h3eSlack = { aiCalls: [], aiUnguarded: [], createFails: false, createAnswerLost: false, readBackFails: false, lostBeforeCode: null, dispatchFails: false };
  const src = (path: string) => pathToFileURL(fileURLToPath(new URL(`../../${path}`, import.meta.url))).href;
  const stub = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
  // La valutazione AI non chiama mai il modello. Creazione della scheda e notifiche sono le
  // vere, con un interruttore per farle fallire.
  const stubs: Record<string, string> = {
    "@/lib/portfolio/ai-ranking": stub(
      `export async function autoScorePortfolioUseCase(p) {
         globalThis.__h3eSlack.aiCalls.push(p.useCaseId);
         if (p.onlyIfUntouched !== true) globalThis.__h3eSlack.aiUnguarded.push(p.useCaseId);
         throw new Error("modello finto: nessuna chiamata");
       }`,
    ),
    "@/lib/db/queries/use-cases": stub(
      `export * from ${JSON.stringify(src("lib/db/queries/use-cases.ts"))};
       import { createUseCaseOnce as real, getUseCaseById as realGet } from ${JSON.stringify(src("lib/db/queries/use-cases.ts"))};
       export async function createUseCaseOnce(data) {
         if (globalThis.__h3eSlack.createFails) throw new Error("creazione finta non riuscita");
         const created = await real(data);
         if (globalThis.__h3eSlack.lostBeforeCode) await globalThis.__h3eSlack.lostBeforeCode(created.useCase.id);
         if (globalThis.__h3eSlack.createAnswerLost) throw new Error("risposta finta persa dopo il commit");
         return created;
       }
       export async function getUseCaseById(id) {
         if (globalThis.__h3eSlack.readBackFails) throw new Error("rilettura finta non riuscita");
         return realGet(id);
       }`,
    ),
    "@/lib/notifications/portfolio-dispatch": stub(
      `export * from ${JSON.stringify(src("lib/notifications/portfolio-dispatch.ts"))};
       import { dispatchNewPortfolioNotifications as real } from ${JSON.stringify(src("lib/notifications/portfolio-dispatch.ts"))};
       export async function dispatchNewPortfolioNotifications(params) {
         if (globalThis.__h3eSlack.dispatchFails) throw new Error("notifiche finte non riuscite");
         return real(params);
       }`,
    ),
  };
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (Object.hasOwn(stubs, specifier)) return { url: stubs[specifier], shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });

  webhook = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      whatsapp.push(JSON.parse(body));
      res.writeHead(204).end();
    });
  });
  await new Promise<void>((resolve) => webhook.listen(0, "127.0.0.1", resolve));
  const address = webhook.address();
  webhookUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/whatsapp`;

  // Il segreto dei link di condivisione vive solo in questo processo.
  process.env.PORTFOLIO_SHARE_SECRET = randomBytes(32).toString("base64");
  process.env.NEXT_PUBLIC_APP_URL = APP_URL;
  delete process.env.VERCEL_URL;

  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Row[]>;
  ({ submitSlackContributionDraft: submit } = await import("../slack/submit-contribution.ts"));
  ({ handleUseCaseConversation: converse } = await import("../slack/use-case-agent.ts"));
  ({ DEFAULT_REVIEW_TEAM_NAME } = await import("../review-team.ts"));
  ({ SLACK_DRAFT_TEXT_COLUMNS: TEXT_COLUMNS } = await import("./admin/slack-drafts.ts"));

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Organizzazione di prova H3e', $2)`, [ids.org, `hub-h3e-${ids.org}`]);
  // «coded»: senza nome del team, con i codici; «named»: con il nome e il webhook, senza codici.
  await q(
    `INSERT INTO workspaces (id, organization_id, name, ai_transformation_team_name, whatsapp_webhook_url)
     VALUES ($1::uuid, $3::uuid, 'Prova H3e codici', NULL, NULL),
            ($2::uuid, $3::uuid, 'Prova H3e nome', $4, $5)`,
    [ids.coded, ids.named, ids.org, NAMED_TEAM, webhookUrl],
  );
  await q(`INSERT INTO workspace_connector_configs (workspace_id, slug, code_prefix) VALUES ($1::uuid, $2, $3)`, [ids.coded, `hub-h3e-${suffix}`, PREFIX]);
  // «named» senza codici: un workspace senza riga la riceve alla prima scheda (assignUseCaseCode),
  // quindi qui la riga c'è con il contatore al massimo, l'unico caso in cui il codice non arriva.
  await q(`INSERT INTO workspace_connector_configs (workspace_id, slug, code_prefix, next_code_seq) VALUES ($1::uuid, $2, 'NC', 99999)`, [ids.named, `hub-h3e-nome-${suffix}`]);
});

after(async () => {
  for (const [key, value] of Object.entries(envBefore)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (!enabled) return;
  await new Promise<void>((resolve) => webhook.close(() => resolve()));
  // I workspace portano via bozze, schede, segnali e righe di config.
  await q(`DELETE FROM workspaces WHERE id = ANY($1::uuid[])`, [[ids.coded, ids.named]]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
});

/**
 * I testi di una bozza completa di use case AI, unici per questa esecuzione. Ogni colonna
 * dell'elenco ha un valore: una colonna di testo nuova si riempie da sola, e se l'invio non
 * la porta a NULL «invio riuscito» fallisce.
 */
function draftTexts(tag: string): Record<string, string> {
  const known: Record<string, string> = {
    title: `Sintesi dei verbali ${tag} ${suffix}`,
    problem: `Oggi i verbali si scrivono a mano dopo ogni riunione (${tag}).`,
    flow_description: "L'AI legge gli appunti e prepara il verbale con decisioni e responsabili.",
    human_in_the_loop: "Chi ha guidato la riunione rivede e approva il verbale prima dell'invio.",
    guardrails: "Non invia nulla da sola e segnala i punti incerti.",
    expected_impact: "Meno tempo speso sui verbali e decisioni più chiare.",
    data_requirements: "Appunti della riunione e elenco dei partecipanti.",
    sustainability_impact: "Meno lavoro ripetitivo per le persone.",
    urgency: "Pilota in quattro settimane.",
  };
  return Object.fromEntries(TEXT_COLUMNS.map((column) => [column, known[column] ?? `Testo di prova ${column} (${tag}).`]));
}

/** Una bozza completa in `drafting`, con il suo thread di Slack e tutte le colonne di testo piene. */
async function seedDraft(workspaceId: string, tag: string): Promise<{ id: string; threadTs: string; title: string }> {
  const id = randomUUID();
  const threadTs = `1777440000.${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`;
  const texts = draftTexts(tag);
  // Nomi di colonna dall'elenco del modulo (il primo test li confronta con il database).
  const columns = [...TEXT_COLUMNS];
  await q(
    `INSERT INTO slack_use_case_drafts (id, workspace_id, slack_user_id, slack_team_id, slack_channel_id, slack_thread_ts,
       contribution_kind, status, ${columns.join(", ")})
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, 'use_case_ai', 'drafting', ${columns.map((_, i) => `$${i + 7}`).join(", ")})`,
    [id, workspaceId, SLACK.user, SLACK.team, SLACK.channel, threadTs, ...columns.map((column) => texts[column])],
  );
  assert.deepEqual(textsLeft(await draftRow(id)), columns, "prima dell'invio la bozza ha tutti i testi");
  return { id, threadTs, title: texts.title };
}

async function draftRow(id: string): Promise<Row> {
  const [row] = await q(`SELECT * FROM slack_use_case_drafts WHERE id = $1::uuid`, [id]);
  assert.ok(row, "la bozza c'è ancora");
  return row;
}

/** Le colonne di testo della bozza ancora piene. */
const textsLeft = (row: Row) => TEXT_COLUMNS.filter((column) => row[column] !== null);

async function cardsTitled(workspaceId: string, title: string): Promise<Row[]> {
  return q(`SELECT id, code, title, description, flow_description FROM use_cases WHERE workspace_id = $1::uuid AND title = $2`, [workspaceId, title]);
}

/** I segnali della campanella di una scheda: uno per annuncio. */
async function signalsOf(workspaceId: string, useCaseId: string): Promise<Row[]> {
  return q(`SELECT id FROM weekly_signals WHERE workspace_id = $1::uuid AND related_entity_id = $2::uuid`, [workspaceId, useCaseId]);
}

/**
 * Primo invio con la risposta della creazione persa e la rilettura che non va: la bozza
 * torna in `drafting` con i testi, ma la scheda c'è già (l'INSERT era arrivato).
 */
async function submitLosingAnswerAndReadBack(draft: { id: string; title: string }): Promise<Row> {
  fakes().createAnswerLost = true;
  fakes().readBackFails = true;
  const result = await submit({ draftId: draft.id, actingSlackUserId: SLACK.user, expectedWorkspaceId: ids.coded }).finally(() => {
    fakes().createAnswerLost = false;
    fakes().readBackFails = false;
  });
  assert.deepEqual(result, { ok: false, error: "Errore durante la creazione del use case. Contatta un admin." });
  const row = await draftRow(draft.id);
  assert.equal(row.status, "drafting", "la bozza torna in drafting: l'invio non sa che la scheda c'è");
  assert.equal(row.submitted_at, null);
  assert.deepEqual(textsLeft(row), [...TEXT_COLUMNS]);
  const [card] = await cardsTitled(ids.coded, draft.title);
  assert.ok(card, "l'INSERT era arrivato");
  assert.equal(card.id, draft.id);
  return card;
}

test("le colonne di testo della bozza sono tutte nell'elenco che l'invio porta a NULL", opts, async () => {
  const rows = await q(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'slack_use_case_drafts'
        AND data_type IN ('text', 'character varying')
      ORDER BY column_name`,
  );
  // Gli id di Slack, il tipo e lo stato non sono testi delle persone.
  const kept = new Set(["slack_user_id", "slack_team_id", "slack_channel_id", "slack_thread_ts", "contribution_kind", "status"]);
  assert.deepEqual(
    rows.map((row) => String(row.column_name)).filter((column) => !kept.has(column)),
    [...TEXT_COLUMNS].sort(),
  );
});

test("invio riuscito: la scheda nasce con i testi, la bozza resta inviata e senza testi", opts, async () => {
  const draft = await seedDraft(ids.coded, "inviata");
  const before = fakes().aiCalls.length;
  const result = await submit({ draftId: draft.id, actingSlackUserId: SLACK.user, expectedWorkspaceId: ids.coded });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.match(result.code ?? "", new RegExp(`^${PREFIX}-\\d{4}$`));
  assert.equal(result.title, draft.title);

  const [card] = await cardsTitled(ids.coded, draft.title);
  assert.equal(card.id, result.useCaseId);
  assert.equal(card.id, draft.id, "la scheda ha l'id della bozza: un nuovo tentativo la ritrova");
  assert.equal(card.code, result.code);
  assert.equal(card.description, draftTexts("inviata").problem);
  assert.equal(card.flow_description, draftTexts("inviata").flow_description);

  const row = await draftRow(draft.id);
  assert.equal(row.status, "submitted");
  assert.notEqual(row.submitted_at, null);
  assert.deepEqual(textsLeft(row), [], "la bozza inviata non ha più testi");
  // Restano gli id di Slack e il tipo: servono a ritrovare la conversazione.
  assert.equal(row.slack_thread_ts, draft.threadTs);
  assert.equal(row.contribution_kind, "use_case_ai");

  assert.deepEqual(fakes().aiCalls.slice(before), [result.useCaseId], "una valutazione AI, finta");
  assert.deepEqual(fakes().aiUnguarded, [], "la valutazione AI non copre mai il lavoro di un revisore");
  assert.equal((await signalsOf(ids.coded, result.useCaseId)).length, 1, "la notifica della campanella è partita");

  // Un secondo «confermo» non crea un doppione e non cambia nulla.
  const again = await submit({ draftId: draft.id, actingSlackUserId: SLACK.user, expectedWorkspaceId: ids.coded });
  assert.deepEqual(again, { ok: false, error: "Questo contributo è già stato inviato" });
  assert.equal((await cardsTitled(ids.coded, draft.title)).length, 1);
});

test("conversazione Slack, «confermo»: codice, nome del team predefinito e link; la bozza perde i testi", opts, async () => {
  const draft = await seedDraft(ids.coded, "conversazione");
  const posted: string[] = [];
  const thread = { post: async (text: string) => void posted.push(text) };
  const message = {
    author: { userId: SLACK.user },
    text: "confermo",
    raw: { channel: SLACK.channel, team_id: SLACK.team, thread_ts: draft.threadTs },
  };
  await converse(thread as never, message as never, ids.coded, { slackTeamId: SLACK.team });

  const [card] = await cardsTitled(ids.coded, draft.title);
  assert.ok(card, "la scheda è nata");
  assert.equal(posted.length, 1);
  const [reply] = posted;
  // Il riepilogo usa la bozza letta prima dell'invio.
  assert.ok(reply.includes(`Titolo: ${draft.title}`), reply);
  assert.ok(reply.includes(`Grazie, l'ho registrato. Il codice è ${card.code}: ${DEFAULT_REVIEW_TEAM_NAME} lo valuta.`), reply);
  assert.ok(reply.includes(`\nScheda Unbundle: ${APP_URL}/share/portfolio/${ids.coded}/${card.id}?token=`), reply);
  assert.doesNotMatch(reply, /raccolta\s*(e|&)\s*ranking|\bteam\b/i);

  assert.deepEqual(textsLeft(await draftRow(draft.id)), []);
});

test("conversazione Slack senza codici: il nome del workspace da solo; WhatsApp «in coda a» quel nome", opts, async () => {
  const draft = await seedDraft(ids.named, "nome");
  const posted: string[] = [];
  const thread = { post: async (text: string) => void posted.push(text) };
  const message = {
    author: { userId: SLACK.user },
    text: "confermo",
    raw: { channel: SLACK.channel, team_id: SLACK.team, thread_ts: draft.threadTs },
  };
  const sent = whatsapp.length;
  await converse(thread as never, message as never, ids.named, { slackTeamId: SLACK.team });

  const [card] = await cardsTitled(ids.named, draft.title);
  assert.ok(card, "la scheda è nata");
  assert.equal(card.code, null, "il workspace non assegna codici (contatore al massimo)");
  const [reply] = posted;
  assert.ok(reply.includes(`Grazie, l'ho registrato: ${NAMED_TEAM} lo valuta.`), reply);
  assert.ok(!reply.includes("Il codice è"), reply);
  assert.ok(reply.includes(`\nScheda Unbundle: ${APP_URL}/share/portfolio/${ids.named}/${card.id}?token=`), reply);
  assert.deepEqual(textsLeft(await draftRow(draft.id)), []);

  const [hook] = whatsapp.slice(sent);
  assert.ok(hook, "il webhook WhatsApp è partito");
  assert.equal(hook.event, "portfolio.new");
  assert.ok(hook.text.startsWith(`Nuovo use case AI in coda a ${NAMED_TEAM}: "${draft.title}". Canale: Slack. `), hook.text);
  assert.doesNotMatch(hook.text, /in coda al|\bteam\b/i);
  // Il canale con la sua etichetta (DESIGN §4.7), mai la chiave; nessun punteggio (§14.1, D4).
  // Solo il testo prima del link: il token del link è casuale.
  const [words] = hook.text.split(" Apri in Unbundle: ");
  assert.doesNotMatch(words, /\b(?:slack|web|claude)(?:_\w+)?\b/, words);
  assert.doesNotMatch(words, /origine|score|punteggio|\d+\.\d{2}/i, words);
});

test("la scheda non nasce: la bozza torna in drafting con i suoi testi, e si può riprovare", opts, async () => {
  const draft = await seedDraft(ids.coded, "fallita");
  fakes().createFails = true;
  const result = await submit({ draftId: draft.id, actingSlackUserId: SLACK.user, expectedWorkspaceId: ids.coded }).finally(() => {
    fakes().createFails = false;
  });
  assert.deepEqual(result, { ok: false, error: "Errore durante la creazione del use case. Contatta un admin." });
  const row = await draftRow(draft.id);
  assert.equal(row.status, "drafting");
  assert.equal(row.submitted_at, null);
  assert.deepEqual(textsLeft(row), [...TEXT_COLUMNS], "i testi restano per il nuovo tentativo");
  assert.equal((await cardsTitled(ids.coded, draft.title)).length, 0);

  const retry = await submit({ draftId: draft.id, actingSlackUserId: SLACK.user, expectedWorkspaceId: ids.coded });
  assert.equal(retry.ok, true);
  assert.equal((await cardsTitled(ids.coded, draft.title)).length, 1);
  assert.deepEqual(textsLeft(await draftRow(draft.id)), []);
});

test("la scheda nasce ma la risposta si perde: l'invio ritrova la scheda e riesce subito", opts, async () => {
  const draft = await seedDraft(ids.coded, "risposta persa");
  const before = fakes().aiCalls.length;
  fakes().createAnswerLost = true;
  const result = await submit({ draftId: draft.id, actingSlackUserId: SLACK.user, expectedWorkspaceId: ids.coded }).finally(() => {
    fakes().createAnswerLost = false;
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  const [card] = await cardsTitled(ids.coded, draft.title);
  assert.equal(result.useCaseId, draft.id, "la scheda con l'id della bozza");
  assert.equal(card.id, draft.id);
  assert.match(result.code ?? "", new RegExp(`^${PREFIX}-\\d{4}$`));
  assert.equal(result.code, card.code);

  // La bozza non torna in drafting: niente promemoria per un contributo già nell'inbox, e
  // niente copia dei testi della scheda (DESIGN §6.8).
  const row = await draftRow(draft.id);
  assert.equal(row.status, "submitted");
  assert.notEqual(row.submitted_at, null);
  assert.deepEqual(textsLeft(row), []);
  assert.deepEqual(fakes().aiCalls.slice(before), [draft.id], "una valutazione AI, finta");
  assert.equal((await signalsOf(ids.coded, draft.id)).length, 1, "una notifica");

  const again = await submit({ draftId: draft.id, actingSlackUserId: SLACK.user, expectedWorkspaceId: ids.coded });
  assert.deepEqual(again, { ok: false, error: "Questo contributo è già stato inviato" });
  assert.equal((await cardsTitled(ids.coded, draft.title)).length, 1, "nessun doppione");
});

test("la risposta si perde prima del codice: l'invio ritrova la scheda e le dà il codice", opts, async () => {
  const draft = await seedDraft(ids.coded, "senza codice");
  fakes().createAnswerLost = true;
  // La scheda resta come appena inserita: senza codice (l'assegnazione non era arrivata).
  fakes().lostBeforeCode = async (useCaseId) => void (await q(`UPDATE use_cases SET code = NULL WHERE id = $1::uuid`, [useCaseId]));
  const result = await submit({ draftId: draft.id, actingSlackUserId: SLACK.user, expectedWorkspaceId: ids.coded }).finally(() => {
    fakes().createAnswerLost = false;
    fakes().lostBeforeCode = null;
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  const [card] = await cardsTitled(ids.coded, draft.title);
  assert.equal(card.id, draft.id);
  assert.match(String(card.code), new RegExp(`^${PREFIX}-\\d{4}$`), "la scheda ha il codice");
  assert.equal(result.code, card.code, "chi ha proposto riceve il codice");
  assert.equal((await draftRow(draft.id)).status, "submitted");
});

test("risposta e rilettura perse: il nuovo tentativo ritrova la stessa scheda, la valuta e la annuncia una volta", opts, async () => {
  const draft = await seedDraft(ids.coded, "rilettura persa");
  const before = fakes().aiCalls.length;
  const first = await submitLosingAnswerAndReadBack(draft);
  assert.deepEqual(fakes().aiCalls.slice(before), [], "il primo tentativo non valuta");
  assert.equal((await signalsOf(ids.coded, first.id as string)).length, 0, "il primo tentativo non annuncia");

  const retry = await submit({ draftId: draft.id, actingSlackUserId: SLACK.user, expectedWorkspaceId: ids.coded });
  assert.equal(retry.ok, true, JSON.stringify(retry));
  if (!retry.ok) return;
  assert.equal(retry.useCaseId, first.id, "la stessa scheda");
  assert.equal(retry.code, first.code, "lo stesso codice");
  assert.equal((await cardsTitled(ids.coded, draft.title)).length, 1, "nessun doppione");
  assert.deepEqual(textsLeft(await draftRow(draft.id)), []);
  // Intatta e mai annunciata: si valuta (con `onlyIfUntouched`) e si annuncia, una volta.
  assert.deepEqual(fakes().aiCalls.slice(before), [first.id]);
  assert.deepEqual(fakes().aiUnguarded, []);
  assert.equal((await signalsOf(ids.coded, first.id as string)).length, 1, "una notifica sola");
});

test("risposta e rilettura perse, poi un revisore archivia: il nuovo tentativo non tocca il suo lavoro", opts, async () => {
  const draft = await seedDraft(ids.coded, "revisore");
  const first = await submitLosingAnswerAndReadBack(draft);
  // La scheda è già nell'inbox: un revisore la archivia, con punteggi e nota, prima del nuovo «confermo».
  const reviewerScores = { impact: { efficiency: 2 }, feasibility: { effort: 4 } };
  await q(
    `UPDATE use_cases SET portfolio_review_status = 'archived', review_notes = 'Nota del revisore', custom_scores = $2::jsonb, reviewed_at = now()
      WHERE id = $1::uuid`,
    [first.id, JSON.stringify(reviewerScores)],
  );
  const [reviewed] = await q(`SELECT portfolio_review_status, review_notes, custom_scores, reviewed_at FROM use_cases WHERE id = $1::uuid`, [first.id]);
  const before = fakes().aiCalls.length;

  const retry = await submit({ draftId: draft.id, actingSlackUserId: SLACK.user, expectedWorkspaceId: ids.coded });
  assert.equal(retry.ok, true, JSON.stringify(retry));
  if (!retry.ok) return;
  assert.equal(retry.useCaseId, first.id, "la stessa scheda");
  assert.equal((await cardsTitled(ids.coded, draft.title)).length, 1, "nessun doppione");
  assert.deepEqual(textsLeft(await draftRow(draft.id)), [], "la bozza perde comunque i testi");

  const [after] = await q(`SELECT portfolio_review_status, review_notes, custom_scores, reviewed_at FROM use_cases WHERE id = $1::uuid`, [first.id]);
  assert.deepEqual(after, reviewed, "stato, nota, punteggi e data del revisore restano");
  assert.equal(after.portfolio_review_status, "archived");
  assert.deepEqual(fakes().aiCalls.slice(before), [], "nessuna valutazione AI su una scheda già valutata");
  assert.equal((await signalsOf(ids.coded, first.id as string)).length, 0, "nessun annuncio di una scheda già nell'inbox");
});

test("le notifiche non vanno dopo la scheda: l'invio resta riuscito, la bozza non torna indietro", opts, async () => {
  const draft = await seedDraft(ids.coded, "notifiche");
  fakes().dispatchFails = true;
  const result = await submit({ draftId: draft.id, actingSlackUserId: SLACK.user, expectedWorkspaceId: ids.coded }).finally(() => {
    fakes().dispatchFails = false;
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  const row = await draftRow(draft.id);
  assert.equal(row.status, "submitted");
  assert.deepEqual(textsLeft(row), []);
  // Un «confermo» in più non fa un doppione.
  const again = await submit({ draftId: draft.id, actingSlackUserId: SLACK.user, expectedWorkspaceId: ids.coded });
  assert.equal(again.ok, false);
  assert.equal((await cardsTitled(ids.coded, draft.title)).length, 1);
});
