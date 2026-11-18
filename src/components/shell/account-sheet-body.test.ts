import test, { before } from "node:test";
import assert from "node:assert/strict";
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

function render(state: unknown): string {
  return readable(renderToStaticMarkup(h(body.AccountSheetBody, { user: USER, state, actions, onRetry() {}, onChanged() {} })));
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
  assert.ok(text(list).includes("Terminale · MacBook di prova solo XX-0012 · usato il 16/11/2026 · scade il 30/01/2027"), text(list));
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
  assert.ok(text(all).includes("Terminale · MacBook di prova tutti i tuoi use case · mai usato"), text(all));
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

test("un accesso in scadenza o esposto lo dice nella sua riga; il collegamento spento lo dice una volta", () => {
  const claude = { ...CLAUDE, routeEnabled: false, tokens: [token({ state: "in_scadenza", expiresIn: "tra 3 giorni", readOnly: true, lastUsedOn: null, exposed: true })] };
  const html = render({ status: "ready", account: { email: null, claude, terminal: null, granola: null } });
  const row = text(/<ul aria-label="I tuoi accessi"[\s\S]*?<\/ul>/.exec(html)?.[0] ?? "");
  assert.ok(row.includes("solo lettura · scade tra 3 giorni · mai usato · esposto: revocalo"), row);
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
  // I testi della cornice, tolte le voci della barra di prima (area «Use case» spenta, fino all'ondata 8).
  const current = Object.fromEntries(Object.entries(SHELL_TEXT).filter(([key]) => key !== "legacy"));
  assert.doesNotMatch(JSON.stringify(current), /caso d'uso|casi d'uso|Altri strumenti|\btoken\b/i);
});
