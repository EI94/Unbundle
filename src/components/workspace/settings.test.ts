// Le Impostazioni del workspace in cinque schede (rilascio 10, ondata 6b, docs/ui-10/PROPOSTA-10.md §3.10 e §2.4;
// audit F-217…F-237): chi vede quale scheda, dove portano le ancore di prima, e le schede rese in HTML. Una riga per
// collegamento con lo stato e un pulsante bordato; Team con «Chi ha accesso (N)», «(tu)» e «Invita» bordato solo a chi
// gestisce; i fornitori dei dati con «Autorizza» pieno al cliente che autorizza, bordato a Lateral Space, «Leggi il
// testo» agli altri. Router e azioni sono finti; dati inventati.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { installAppModules } from "../../lib/ai/claude-test-kit.ts";
import { findHubForbiddenIn } from "../../lib/use-cases/copy-guard.ts";
import { enableTsxImports } from "../use-cases/detail/referent/tsx-test-loader.ts";
import { SETTINGS_TEXT } from "./settings-text.ts";
import { SETTINGS_ANCHOR_TAB, SETTINGS_TABS, settingsAnchorTarget, settingsTabHref, settingsTabOf, visibleSettingsTabs } from "./settings-view.ts";

const stub = (names: string[]) => names.map((name) => `export async function ${name}() { return { ok: false, message: "no" }; }`).join("\n");
await installAppModules({
  "next/navigation": `export function useRouter() { return { push() {}, refresh() {}, replace() {} }; }
    export function usePathname() { return "/"; }
    export function useSearchParams() { return new URLSearchParams(); }`,
  sonner: `export const toast = Object.assign(() => {}, { success() {}, error() {} });`,
  "@/lib/actions/workspace-collaboration": stub([
    "createWorkspaceInvitationAction",
    "recreateWorkspaceInvitationAction",
    "removeWorkspaceMemberAction",
    "revokeWorkspaceInvitationAction",
    "updateWorkspaceMemberRoleAction",
  ]),
  "@/lib/actions/team-mcp-tokens": stub(["revokeAllTeamMcpTokensAction"]),
  "@/lib/actions/portfolio": stub(["updateWhatsappWebhookAction"]),
});
await enableTsxImports();
const { ConnectionsTab } = await import("./connections-tab.tsx");
const { TeamTab } = await import("./workspace-collaboration-card.tsx");
const { SuppliersSection } = await import("./suppliers-section.tsx");
const { TeamTokensRevokeAll } = await import("./team-mcp-card.tsx");
const { AlertsForm } = await import("./alerts-form.tsx");

const WS = "11111111-1111-4111-8111-111111111111";
const readable = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const render = (element: ReactElement) => readable(renderToStaticMarkup(element));
const visible = (html: string) =>
  html
    .replace(/<span [^>]*class="sr-only"[^>]*>[\s\S]*?<\/span>/g, " ")
    .split(/<[^>]+>/)
    .map((p) => p.trim())
    .filter(Boolean);
function filledButtons(html: string): string[] {
  return [...html.matchAll(/<(?:a|button)\b[^>]*>/g)]
    .map(([tag]) => tag)
    .filter((tag) => tag.includes('data-slot="button"') && (/class="([^"]*)"/.exec(tag)?.[1].split(/\s+/) ?? []).includes("bg-primary"));
}
const controls = (html: string) => [...html.matchAll(/<(?:a|button|select|input)\b/g)].length;

test("le schede: Team a tutti; Collegamenti, Valutazione, Privacy, Zona pericolosa a chi può farci qualcosa", () => {
  const admin = visibleSettingsTabs({ manages: true, links: true, privacy: true, canDelete: true });
  assert.deepEqual(admin, [...SETTINGS_TABS]);
  assert.deepEqual(visibleSettingsTabs({ manages: false, links: false, privacy: true, canDelete: false }), ["team", "privacy"], "un revisore che vede i fornitori");
  assert.deepEqual(visibleSettingsTabs({ manages: false, links: false, privacy: false, canDelete: false }), ["team"], "un contributore: chi ha accesso");
  // La scheda dell'indirizzo, se chi guarda la vede; il ritorno da Slack apre Collegamenti; altrimenti la prima.
  assert.equal(settingsTabOf("privacy", admin), "privacy");
  assert.equal(settingsTabOf("zona-pericolosa", ["team", "privacy"]), "team", "una scheda che non si vede non si apre");
  assert.equal(settingsTabOf(null, admin, { slackReturn: true }), "collegamenti");
  assert.equal(settingsTabOf("boh", admin), "team");
  assert.equal(settingsTabHref(WS, "team"), `/dashboard/${WS}/settings`);
  assert.equal(settingsTabHref(WS, "privacy"), `/dashboard/${WS}/settings?scheda=privacy`);
});

test("le ancore di prima portano alla loro scheda; `#cli` e `#granola` le apre il foglio; `#granola-regole` porta a Fonti", () => {
  const all = [...SETTINGS_TABS];
  const at = (hash: string, current: (typeof all)[number] = "team") => settingsAnchorTarget({ hash, current, visible: all, workspaceId: WS });
  assert.deepEqual(SETTINGS_ANCHOR_TAB, {
    persone: "team",
    integrazioni: "collegamenti",
    "connettore-claude": "collegamenti",
    "claude-per-il-team": "collegamenti",
    valutazione: "valutazione",
    "valutazione-use-case": "valutazione",
    "sub-responsabili": "privacy",
    "zona-pericolosa": "zona-pericolosa",
  });
  assert.equal(at("#sub-responsabili"), `/dashboard/${WS}/settings?scheda=privacy#sub-responsabili`);
  assert.equal(at("#integrazioni"), `/dashboard/${WS}/settings?scheda=collegamenti#integrazioni`);
  assert.equal(at("#valutazione-use-case"), `/dashboard/${WS}/settings?scheda=valutazione#valutazione-use-case`);
  assert.equal(at("#zona-pericolosa"), `/dashboard/${WS}/settings?scheda=zona-pericolosa#zona-pericolosa`);
  assert.equal(at("#persone", "privacy"), `/dashboard/${WS}/settings#persone`);
  assert.equal(at("#persone"), null, "già nella scheda giusta: niente");
  assert.equal(at("#cli"), null, "il foglio «Il tuo account»");
  assert.equal(at("#granola"), null, "il foglio «Il tuo account»");
  assert.equal(at("#granola-regole"), `/dashboard/${WS}/contesto?vista=fonti#granola-regole-cliente`);
  assert.equal(at(""), null);
  assert.equal(at("#sconosciuta"), null);
  // Una scheda che chi guarda non ha: l'ancora non la apre.
  assert.equal(settingsAnchorTarget({ hash: "#zona-pericolosa", current: "team", visible: ["team"], workspaceId: WS }), null);
});

test("Collegamenti: una riga per servizio, con lo stato in una parola e un pulsante bordato; nessun pulsante pieno", () => {
  const rows = [
    { key: "slack" as const, name: "Slack", state: { tone: "verde" as const, label: "Collegato" }, fact: "Collegato a Team prova", action: { kind: "panel" as const, label: "Gestisci" } },
    { key: "organizzazione" as const, name: "Claude per l'organizzazione", state: { tone: "giallo" as const, label: "Sospeso" }, action: { kind: "panel" as const, label: "Gestisci" } },
    { key: "avvisi" as const, name: "Altri avvisi", state: { tone: "grigio" as const, label: "Spenti" }, action: { kind: "panel" as const, label: "Gestisci" } },
  ];
  const html = render(createElement(ConnectionsTab, { workspaceId: WS, rows, panels: { slack: "s", organizzazione: "o", avvisi: "a" }, initialPanel: null }));
  assert.equal([...html.matchAll(/data-connection=/g)].length, 3);
  assert.deepEqual(filledButtons(html), []);
  for (const row of rows) assert.match(html, new RegExp(`aria-label="Gestisci: ${row.name}"`));
  assert.match(html, /data-slot="status-dot"[\s\S]*?Collegato/);
  assert.match(html, /id="integrazioni"/, "l'ancora di prima resta");
  assert.match(html, /id="connettore-claude"/);
  assert.ok(controls(html) <= 20, `${controls(html)} controlli`);
  // Senza pannello (chi non gestisce) la riga non ha pulsanti; Slack da collegare comincia il collegamento.
  const reader = render(createElement(ConnectionsTab, { workspaceId: WS, rows: [{ key: "slack", name: "Slack", state: { tone: "verde", label: "Collegato" }, fact: "Collegato a Team prova", action: null }], panels: {}, initialPanel: null }));
  assert.equal([...reader.matchAll(/<button/g)].length, 0);
  const connect = render(createElement(ConnectionsTab, { workspaceId: WS, rows: [{ key: "slack", name: "Slack", state: { tone: "grigio", label: "Da collegare" }, action: { kind: "slack", label: "Collega" } }], panels: {}, initialPanel: null }));
  assert.match(connect, /aria-label="Collega: Slack"/);
  assert.deepEqual(filledButtons(connect), []);
});

const MEMBERS = [
  { userId: "u1", name: "Persona Uno", email: "uno@cliente.test", role: "exec_sponsor", source: "organization" as const, createdAt: "2026-11-01T09:00:00.000Z" },
  { userId: "u2", name: "Persona Due", email: "due@cliente.test", role: "analyst", source: "workspace" as const, createdAt: "2026-11-02T09:00:00.000Z" },
  { userId: "u3", name: "Corsista", email: "tre@cliente.test", role: "learner", source: "workspace" as const, createdAt: "2026-11-03T09:00:00.000Z" },
];
const INVITE = { id: "i1", email: "nuova@cliente.test", role: "analyst", maxUses: 1, usedCount: 0, expiresAt: "2099-01-01T00:00:00.000Z", revokedAt: null, createdAt: "2026-11-20T09:00:00.000Z", createdByName: "Persona Uno", acceptedByEmail: null };

test("Team: «Chi ha accesso (N)» con «(tu)» e il ruolo; «Invita» bordato e gli inviti chiusi solo a chi gestisce", () => {
  const manager = render(createElement(TeamTab, { workspaceId: WS, workspaceName: "Cliente Demo", members: MEMBERS, invitations: [INVITE], canManage: true, currentUserId: "u1" }));
  assert.match(manager, /<h2 id="who-has-access"[^>]*>Chi ha accesso \(2\)<\/h2>/, "i partecipanti ai corsi non contano");
  assert.match(manager, /Persona Uno<span[^>]*> \(tu\)<\/span>/);
  assert.match(manager, /data-testid="workspace-invite-open"[^>]*>[\s\S]*?Invita<\/button>/);
  assert.deepEqual(filledButtons(manager), [], "nella scheda nessun pulsante pieno: «Crea il link» è del pannello");
  assert.match(manager, /<section id="inviti" data-slot="fold"/, "gli inviti aperti in una piega");
  assert.doesNotMatch(manager, /data-open=""/, "chiusa");
  assert.match(manager, /1 partecipante ai corsi: vede solo i suoi corsi\./);
  // Il ruolo si cambia con un menu da 44 px al telefono; il proprio no.
  assert.equal([...manager.matchAll(/data-testid="workspace-member-role-select"/g)].length, 1);
  assert.match(manager, /class="h-11 w-full rounded-lg border[^"]*sm:h-8/);
  const reader = render(createElement(TeamTab, { workspaceId: WS, workspaceName: "Cliente Demo", members: MEMBERS, invitations: [], canManage: false, currentUserId: "u2" }));
  assert.doesNotMatch(reader, /Invita|workspace-member-role-select|Rimuovi|Puoi vedere chi ha accesso/);
  assert.match(reader, /Chi ha accesso \(2\)/);
  assert.ok(controls(manager) <= 20, `${controls(manager)} controlli`);
  assert.deepEqual(findHubForbiddenIn(visible(manager), "area"), []);
});

test("Privacy › Fornitori dei dati: «Autorizza» pieno al cliente, bordato a Lateral Space, «Leggi il testo» agli altri; l'ancora resta", () => {
  const client = render(createElement(SuppliersSection, { summary: { tone: "giallo", label: "Da autorizzare" }, action: { label: "Autorizza", filled: true }, initialPanel: null }, "testo"));
  assert.equal(filledButtons(client).length, 1);
  assert.match(client, /<section id="sub-responsabili"/);
  assert.match(client, /Fornitori dei dati/);
  assert.match(client, /Da autorizzare/);
  const ls = render(createElement(SuppliersSection, { summary: { tone: "giallo", label: "Da autorizzare" }, action: { label: "Registra l'ok di Cliente Demo", filled: false }, initialPanel: null }, "testo"));
  assert.deepEqual(filledButtons(ls), []);
  assert.match(ls, />Registra l'ok di Cliente Demo<\/button>/);
  const reader = render(createElement(SuppliersSection, { summary: { tone: "verde", label: "Autorizzati il 4 nov 2026" }, action: null, initialPanel: null }, "testo"));
  assert.match(reader, /data-slot="text-action"[^>]*>Leggi il testo/);
  assert.doesNotMatch(reader, /Sub-responsabili/);
});

test("«Revoca tutti» bordato nella riga, con la finestra dell'app; «Altri avvisi» in parole semplici, «Salva» solo dopo una modifica", () => {
  const all = render(createElement(TeamTokensRevokeAll, { workspaceId: WS, activeCount: 7 }));
  assert.match(all, /7 accessi personali a Claude attivi nel workspace\./);
  assert.match(all, /<button type="submit"[^>]*>Revoca tutti<\/button>/);
  assert.deepEqual(filledButtons(all), []);
  const alerts = render(createElement(AlertsForm, { workspaceId: WS, initialUrl: "https://esempio.test/relay" }));
  assert.match(alerts, /Avvisa un gruppo WhatsApp tramite un servizio esterno/);
  assert.doesNotMatch(visible(alerts).join(" ").replace(/Dettagli tecnici[\s\S]*$/, ""), /webhook|JSON|endpoint/i, "niente gergo in vista");
  assert.doesNotMatch(alerts, />Salva</, "«Salva» solo dopo una modifica");
});

test("i testi delle Impostazioni: le parole della dashboard, niente codici; la pagina senza finestre del browser né vecchie card", () => {
  const texts: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === "string") texts.push(value);
    else if (typeof value === "function") {
      const out = (value as (...a: unknown[]) => unknown)("x", "y", "z", true);
      if (typeof out === "string") texts.push(out);
    } else if (value && typeof value === "object") for (const v of Object.values(value)) walk(v);
  };
  walk(SETTINGS_TEXT);
  assert.ok(texts.length > 80, `${texts.length} testi`);
  assert.deepEqual(findHubForbiddenIn(texts, "area"), []);
  assert.doesNotMatch(texts.join(" "), /Sub-responsabili|Integrazioni|webhook|portfolio/i);
  const root = new URL("../../../", import.meta.url);
  const page = readFileSync(new URL("src/app/(dashboard)/dashboard/[workspaceId]/settings/page.tsx", root), "utf8");
  assert.match(page, /<SegmentedNav\b/);
  assert.doesNotMatch(page, /<TeamMcpCard\b|<CliCard|GranolaCard|<SettingsSection|Il tuo ruolo/);
  // (F-005) La configurazione di Lateral Space che manca: una riga per chi gestisce il workspace, con le realizzazioni accese.
  assert.match(page, /\{canManageSettings && isUcEnabledFor\(workspaceId\) && !isUcLsConfigured\(\) \? \(\s*<p role="status" data-slot="settings-config-incomplete"/);
  assert.match(SETTINGS_TEXT.configIncomplete, /^Configurazione da completare: le realizzazioni sono in sola lettura/);
  // Gli errori tecnici di Slack (il codice, che cosa fare per chi gestisce l'app) solo a Lateral Space.
  assert.match(page, /i\.lateralSpace \? \(\s*<details[\s\S]*?\{slackError\}/);
  const dir = new URL("src/components/workspace/", root);
  for (const file of readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && !f.includes(".test."))) {
    assert.doesNotMatch(readFileSync(new URL(file, dir), "utf8"), /window\.(confirm|prompt|alert)\(/, file);
  }
});
