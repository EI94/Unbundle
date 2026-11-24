import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CONTEXT_TEXT } from "../../lib/context/text.ts";
import type { AccountSheetData } from "../../lib/shell/account.ts";
import { SHELL_TEXT } from "../../lib/shell/text.ts";
import { enableTsxImports } from "../use-cases/detail/referent/tsx-test-loader.ts";

// (Rilascio 10, ondata 2a «Cornice», docs/ui-10/PROPOSTA-10.md §3.10) Il foglio «Il tuo account», reso in HTML senza
// database: chi sei; «Notifiche via email» (uscita dalla campanella); «Claude e terminale» con gli accessi in una lista,
// «Revoca» e la guida a due scelte; «Granola» per Lateral Space; il tema sempre. Una parte che non ti riguarda non c'è.
// Dati inventati (codici XX-00NN).

const T = SHELL_TEXT.account;

type Body = typeof import("./account-sheet-body.tsx");
let body: Body;
let renderToStaticMarkup: (element: unknown) => string;
let h: (type: unknown, props: unknown) => unknown;

before(async () => {
  await enableTsxImports();
  body = await import("./account-sheet-body.tsx");
  const react = await import("react");
  h = (type, props) => react.createElement(type as never, props as never);
  ({ renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string });
});

const readable = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const text = (html: string) => readable(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

const unused = async () => {
  throw new Error("non chiamata");
};
const actions = {
  setEmailAlerts: unused,
  setReadinessEmails: unused,
  createClaudeAccess: unused,
  revokeClaudeAccess: unused,
  revokeTerminalLink: unused,
  connectGranola: unused,
  disconnectGranola: unused,
};

const USER = { name: "Persona Prova", email: "persona@esempio.test", image: null };

const token = (over: Record<string, unknown> = {}) => ({
  id: "00000000-0000-4000-8000-0000000000b1",
  label: "Claude Code sul portatile",
  tokenPrefix: "ubt_ab12",
  readOnly: false,
  state: "attivo",
  active: true,
  expiresIn: "tra 40 giorni",
  exposed: false,
  createdOn: "10/11/2026",
  expiresOn: "08/02/2027",
  lastUsedOn: "15/11/2026",
  revokedOn: null,
  exposedOn: null,
  ...over,
});

const CLAUDE = {
  status: "pronta" as const,
  tokens: [token(), token({ id: "00000000-0000-4000-8000-0000000000b2", label: "Vecchio", state: "revocato", active: false })],
  routeEnabled: true,
  ttlDays: 90,
  defaultLabel: "Claude Code",
  url: "https://esempio.test/api/mcp/team",
  connectorName: "Unbundle Use case",
  claudeCodeName: "unbundle-use-case",
  warningDays: 14,
  skillName: null,
};

const TERMINAL = {
  links: [
    { id: "00000000-0000-4000-8000-0000000000c1", label: "MacBook di prova", prefix: "ubc_cd34", caseCode: "XX-0012", createdAt: "2026-11-01T09:00:00.000Z", lastUsedAt: "2026-11-16T10:00:00.000Z", expiresAt: "2027-01-30T09:00:00.000Z" },
  ],
};

const everything: AccountSheetData = {
  email: { on: true },
  claude: CLAUDE as unknown as AccountSheetData["claude"],
  terminal: TERMINAL,
  granola: { state: "collegato", accountEmail: "persona@esempio.test", plan: "Business" },
};

function render(state: unknown, granola?: { flash: string | null; rulesHref: string | null }): string {
  return readable(renderToStaticMarkup(h(body.AccountSheetBody, { user: USER, state, actions, onRetry() {}, onChanged() {}, granola })));
}

const SECTIONS = { email: T.email.title, claude: T.claude.title, granola: T.granola.title, tema: T.theme.title };
const sectionsIn = (html: string) => [...html.matchAll(/<section id="account-([a-z]+)"/g)].map((match) => match[1]);

test("revisore di Lateral Space con tutto: le quattro parti, nell'ordine del foglio", () => {
  const html = render({ status: "ready", account: everything });
  assert.deepEqual(sectionsIn(html), ["email", "claude", "granola", "tema"]);
  for (const title of Object.values(SECTIONS)) assert.ok(html.includes(`>${title}</h3>`), title);
  // Chi sei, in cima.
  assert.ok(html.includes("Persona Prova") && html.includes("persona@esempio.test"));
  // L'interruttore delle email, con la sua frase come etichetta.
  assert.match(html, /role="switch"[^>]*aria-checked="true"|aria-checked="true"[^>]*role="switch"/);
  assert.ok(html.includes(`>${T.email.toggle}</label>`));
  // Gli accessi in una lista sola: il token attivo di Claude e il collegamento del terminale, non il token revocato.
  const list = /<ul aria-label="I tuoi accessi"[\s\S]*?<\/ul>/.exec(html)?.[0] ?? "";
  assert.equal((list.match(/<li /g) ?? []).length, 2);
  assert.ok(text(list).includes("Claude · Claude Code sul portatile lettura e scrittura · scade il 08/02/2027 · usato il 15/11/2026"), text(list));
  // (F-227) L'inizio del collegamento, per riconoscerlo: «ubc_cd34…», mai il resto.
  assert.ok(text(list).includes("Terminale · MacBook di prova ubc_cd34… · solo XX-0012 · usato il 16/11/2026 · scade il 30/01/2027"), text(list));
  assert.ok(!list.includes("Vecchio"), "un accesso revocato non è nella lista");
  assert.equal((list.match(/>Revoca</g) ?? []).length, 2);
  // La guida a due scelte, con Claude scelto: il nome, «Solo lettura», «Crea l'accesso».
  assert.match(html, /role="group" aria-label="Come ti colleghi"/);
  assert.match(html, /aria-pressed="true"[^>]*>Claude</);
  assert.match(html, /aria-pressed="false"[^>]*>Terminale</);
  assert.ok(html.includes(T.claude.claudeLead(90)) && html.includes(`>${T.claude.create}</button>`) && html.includes(T.claude.readOnlyLabel));
  // Granola collegato: l'account, il piano, «Scollega».
  assert.ok(html.includes("Collegato come persona@esempio.test") && html.includes("Piano Business") && html.includes(">Scollega</button>"));
  // Il tema: tre scelte, «Scuro» predefinito.
  const radios = [...html.matchAll(/<input type="radio"[^>]*value="(dark|light|system)"[^>]*>/g)];
  assert.deepEqual(radios.map((match) => match[1]), ["dark", "light", "system"]);
  assert.match(radios[0][0], /checked=""/);
  for (const label of ["Scuro", "Chiaro", "Come il sistema"]) assert.ok(html.includes(label), label);
});

test("(0044) «Notifiche via email»: l'interruttore dell'AI Readiness a chi gestisce, accanto a quello del referente o da solo", () => {
  const both = render({ status: "ready", account: { ...everything, readinessEmail: { on: false } } });
  assert.ok(both.includes(`>${T.email.toggle}</label>`) && both.includes(`>${T.email.readinessToggle}</label>`));
  assert.equal(T.email.readinessToggle, "Avvisami per email sull'AI Readiness");
  assert.equal((both.match(/role="switch"/g) ?? []).length, 2, "due interruttori, ognuno con la sua etichetta");
  assert.equal(sectionsIn(both).filter((part) => part === "email").length, 1, "una sezione sola");
  const alone = render({ status: "ready", account: { email: null, readinessEmail: { on: true }, claude: null, terminal: null, granola: null } });
  assert.deepEqual(sectionsIn(alone), ["email", "tema"]);
  assert.ok(alone.includes(`>${T.email.readinessToggle}</label>`) && !alone.includes(`>${T.email.toggle}</label>`));
  assert.match(alone, /role="switch"[^>]*aria-checked="true"|aria-checked="true"[^>]*role="switch"/);
  const none = render({ status: "ready", account: { email: null, readinessEmail: null, claude: null, terminal: null, granola: null } });
  assert.deepEqual(sectionsIn(none), ["tema"], "chi non riceve email non vede la sezione");
});

test("un pannello ha i suoi pulsanti, mai uno pieno: il foglio non è il prossimo passo", () => {
  const html = render({ status: "ready", account: everything });
  assert.doesNotMatch(html, /class="[^"]*(?<![\w:-])bg-primary text-primary-foreground/);
  // «Revoca» nelle righe è fantasma (con la conferma in una finestra), «Crea l'accesso» è bordato.
  assert.match(html, /<button[^>]*class="[^"]*hover:bg-muted[^"]*"[^>]*>Revoca<\/button>/);
});

test("revisore del cliente: Claude senza il terminale, niente Granola né scelta fra due", () => {
  const html = render({ status: "ready", account: { email: null, claude: CLAUDE, terminal: null, granola: null } });
  assert.deepEqual(sectionsIn(html), ["claude", "tema"]);
  assert.doesNotMatch(html, /Come ti colleghi/);
  assert.ok(html.includes(T.claude.claudeLead(90)));
  assert.doesNotMatch(html, /unbundle login/);
});

test("chi costruisce con la sola CLI: il collegamento del terminale e la sua riga di guida", () => {
  const html = render({ status: "ready", account: { email: null, claude: null, terminal: TERMINAL, granola: null } });
  assert.deepEqual(sectionsIn(html), ["claude", "tema"]);
  assert.ok(html.includes(T.claude.terminalLead));
  assert.doesNotMatch(html, new RegExp(T.claude.create));
  // Una CLI per tutti i casi e mai usata.
  const all = render({ status: "ready", account: { email: null, claude: null, terminal: { links: [{ ...TERMINAL.links[0], caseCode: null, lastUsedAt: null, expiresAt: null }] }, granola: null } });
  assert.ok(text(all).includes("Terminale · MacBook di prova ubc_cd34… · tutti i tuoi use case · mai usato"), text(all));
});

test("contributore: niente da mostrare se non il tema (lo zero non si vede)", () => {
  const html = render({ status: "ready", account: { email: null, claude: null, terminal: null, granola: null } });
  assert.deepEqual(sectionsIn(html), ["tema"]);
  assert.doesNotMatch(html, /Nessun|nessun/);
});

test("chi segue solo un corso: il solo tema, senza leggere niente", () => {
  const html = render({ status: "none" });
  assert.deepEqual(sectionsIn(html), ["tema"]);
  assert.doesNotMatch(html, new RegExp(T.loading));
});

test("mentre legge e se non riesce: «Caricamento…», poi la frase e «Riprova»; il tema resta", () => {
  const loading = render({ status: "loading" });
  assert.match(loading, /role="status"[^>]*>Caricamento…</);
  assert.deepEqual(sectionsIn(loading), ["tema"]);
  const failed = render({ status: "error" });
  assert.match(failed, /role="alert"/);
  assert.ok(failed.includes(T.loadFailed) && failed.includes(`>${T.retry}</button>`));
  assert.deepEqual(sectionsIn(failed), ["tema"]);
});

test("(ondata 6b) un accesso in scadenza o esposto lo dice in un avviso sopra l'elenco; la riga ha la data; il collegamento spento una volta", () => {
  const claude = { ...CLAUDE, routeEnabled: false, tokens: [token({ state: "in_scadenza", expiresIn: "tra 3 giorni", readOnly: true, lastUsedOn: null, exposed: true, exposedOn: "18/11/2026" })] };
  const html = render({ status: "ready", account: { email: null, claude, terminal: null, granola: null } });
  const row = text(/<ul aria-label="I tuoi accessi"[\s\S]*?<\/ul>/.exec(html)?.[0] ?? "");
  // Un dato, un posto (come la card «Claude per il team» delle Impostazioni, che qui è arrivata).
  assert.ok(row.includes("solo lettura · scade il 08/02/2027 · mai usato"), row);
  assert.ok(!row.includes("tra 3 giorni") && !row.includes("esposto"), row);
  assert.match(html, /<p role="alert"[^>]*data-slot="account-exposed"[^>]*>«Claude Code sul portatile» è arrivato dentro un indirizzo web il 18\/11\/2026: revocalo e creane uno nuovo\.<\/p>/);
  assert.match(html, /<p role="status"[^>]*data-slot="account-expiring"[^>]*>«Claude Code sul portatile» scade tra 3 giorni: crea un accesso nuovo e sostituiscilo in Claude\.<\/p>/);
  assert.equal(html.split(T.claude.claudeOff).length - 1, 1);
  // Gli accessi non si leggono: una frase, niente modulo.
  const broken = render({ status: "ready", account: { email: null, claude: { ...CLAUDE, status: "errore", tokens: [] }, terminal: null, granola: null } });
  assert.ok(broken.includes(T.claude.claudeLoadFailed));
  assert.doesNotMatch(broken, new RegExp(T.claude.create));
});

test("Granola negli altri stati: «Collega Granola», «Ricollega», non ancora attivo", () => {
  const of = (state: string) => render({ status: "ready", account: { email: null, claude: null, terminal: null, granola: { state, accountEmail: null, plan: null } } });
  assert.ok(of("non_collegato").includes(">Collega Granola</button>"));
  assert.ok(of("da_ricollegare").includes(">Ricollega</button>") && of("da_ricollegare").includes("Il collegamento è scaduto."));
  assert.ok(of("non_disponibile").includes("Il collegamento con Granola non è ancora attivo."));
  assert.doesNotMatch(of("non_disponibile"), /<button[^>]*>(Collega|Ricollega|Scollega)/);
});

test("le parole del foglio: niente chiavi, niente «token» nel testo, «use case» nella dashboard", () => {
  const html = text(render({ status: "ready", account: everything }));
  assert.doesNotMatch(html, /\btoken\b|caso d'uso|casi d'uso|in_scadenza|non_collegato|collegato,|pronta/i);
  // I testi della cornice, anche le voci della barra di prima (area «Use case» spenta, fino all'ondata 8).
  assert.doesNotMatch(JSON.stringify(SHELL_TEXT), /caso d'uso|casi d'uso|Altri strumenti|\btoken\b/i);
});

// ─── Granola per chi non gestisce il workspace (rifiniture dell'ondata 2a) ──
// Il ritorno da Granola (`settings?granola=…#granola`) apre il foglio: la riga che dice com'è andata sta nel foglio. Le
// regole delle call (ondata 6b) stanno in Contesto › Fonti, che si raggiunge anche da qui.

const RULES = "/dashboard/00000000-0000-4000-8000-0000000000f1/contesto?vista=fonti#granola-regole-cliente";
const granolaIn = (state: string) => ({ status: "ready", account: { email: null, claude: null, terminal: null, granola: { state, accountEmail: state === "collegato" ? "persona@esempio.test" : null, plan: null } } });

test("il ritorno da Granola: il foglio dice com'è andata, con la stessa riga del blocco di Impostazioni", () => {
  const G = CONTEXT_TEXT.granola;
  const outcome = (html: string) => /<p role="(status|alert)" data-slot="granola-outcome"[^>]*>([^<]*)<\/p>/.exec(html)?.slice(1) ?? null;
  assert.deepEqual(outcome(render(granolaIn("collegato"), { flash: "collegato", rulesHref: RULES })), ["status", G.connected]);
  for (const flash of ["errore", "annullato"]) assert.deepEqual(outcome(render(granolaIn("non_collegato"), { flash, rulesHref: RULES })), ["alert", G.connectFailed], flash);
  assert.deepEqual(outcome(render(granolaIn("non_collegato"), { flash: "scaduto", rulesHref: RULES })), ["alert", G.stateExpired]);
  // Solo quando dice la stessa cosa del foglio: «errore» con un collegamento attivo, o niente nell'indirizzo, tace.
  assert.equal(outcome(render(granolaIn("collegato"), { flash: "errore", rulesHref: RULES })), null);
  assert.equal(outcome(render(granolaIn("non_collegato"), { flash: null, rulesHref: RULES })), null);
  assert.equal(outcome(render(granolaIn("non_collegato"))), null);
  // La riga sta nella parte «Granola», sopra «Collega Granola».
  const html = render(granolaIn("non_collegato"), { flash: "errore", rulesHref: RULES });
  const section = /<section id="account-granola"[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
  assert.ok(section.indexOf("granola-outcome") > 0 && section.indexOf("granola-outcome") < section.indexOf(">Collega Granola</button>"));
});

test("«Regole delle call ›»: con un collegamento, alle regole in Contesto › Fonti", () => {
  const html = render(granolaIn("collegato"), { flash: null, rulesHref: RULES });
  assert.match(html, new RegExp(`<a data-slot="text-action"[^>]*href="${RULES.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>${T.granola.rules}<svg`));
  // Senza collegamento le regole non ci sono (nemmeno in Fonti): niente link.
  for (const state of ["non_collegato", "da_ricollegare", "non_disponibile"]) assert.doesNotMatch(render(granolaIn(state), { flash: null, rulesHref: RULES }), /Regole delle call/, state);
  // Mai un pulsante pieno: il link è tranquillo.
  assert.doesNotMatch(html, /class="[^"]*(?<![\w:-])bg-primary text-primary-foreground/);
  // Il foglio passa `?granola=` dell'indirizzo e l'indirizzo delle regole di questo workspace.
  const sheet = readFileSync(new URL("./account-sheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /granola=\{\{ flash: params\?\.get\("granola"\) \?\? null, rulesHref: granolaRulesHref\(workspaceId\) \}\}/);
});

// ─── «Il tuo account» completo (ondata 6b): quello che la card «Claude per il team» delle Impostazioni faceva ──

test("(ondata 6b) gli accessi non più attivi, chiusi; il modulo dietro «Crea un altro accesso» con un accesso attivo; la guida «Come collegare Claude»", () => {
  const html = render({ status: "ready", account: { email: null, claude: CLAUDE, terminal: null, granola: null } });
  assert.match(html, /<details class="[^"]*" data-slot="account-inactive">\s*<summary[^>]*>Non più attivi \(1\)<\/summary>[\s\S]*?Vecchio[\s\S]*?revocato/);
  assert.match(html, /<details class="[^"]*" data-slot="account-create-more"><summary[^>]*>Crea un altro accesso<\/summary>/);
  const guide = /<details class="[^"]*" data-slot="account-connect-guide">[\s\S]*?<\/details>/.exec(html)?.[0] ?? "";
  assert.ok(guide.includes("Come collegare Claude"));
  assert.ok(guide.includes("claude mcp add --transport http unbundle-use-case https://esempio.test/api/mcp/team --header \"Authorization: Bearer IL_TUO_ACCESSO\""), guide);
  assert.ok(guide.includes("Authorization: Bearer IL_TUO_ACCESSO"));
  // Senza accessi attivi il modulo è aperto.
  const none = render({ status: "ready", account: { email: null, claude: { ...CLAUDE, tokens: [] }, terminal: null, granola: null } });
  assert.doesNotMatch(none, /Crea un altro accesso/);
  assert.match(none, /data-slot="account-create-access"/);
  // La skill «registra-ai-lab» solo a chi la riceve (Lateral Space).
  assert.doesNotMatch(html, /registra-ai-lab/);
  const ls = render({ status: "ready", account: { email: null, claude: { ...CLAUDE, skillName: "registra-ai-lab" }, terminal: null, granola: null } });
  assert.match(ls, /data-slot="account-skill"[^>]*>Dopo un AI Lab, la skill «registra-ai-lab» trasforma gli appunti in use case/);
});

test("(ondata 6b) l'accesso appena creato si offre finché è attivo e finché chi guarda non lo nasconde", async () => {
  const { newTokenToShow } = await import("./account-sheet-body.tsx");
  const fresh = { tokenId: "t9", token: "ubt_segreto", label: "Nuovo", readOnly: false, expiresOn: "01/02/2027" } as never;
  assert.equal(newTokenToShow(fresh, null, [{ id: "t9", active: true }]), fresh);
  assert.equal(newTokenToShow(fresh, "t9", [{ id: "t9", active: true }]), null, "nascosto");
  assert.equal(newTokenToShow(fresh, null, []), fresh, "elenco non ancora riletto: resta, l'accesso esiste");
  assert.equal(newTokenToShow(fresh, null, [{ id: "t9", active: false }]), null, "revocato: niente da copiare");
  assert.equal(newTokenToShow(undefined, null, []), null);
});
