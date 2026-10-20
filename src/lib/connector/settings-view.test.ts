import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { CONNECTOR_TOKEN_PREFIX } from "./auth.ts";
import { CONNECTOR_DEFAULT_LIMITS } from "./config.ts";
import { EXAMPLE_CONNECTOR_PROFILE_INPUT, EXAMPLE_INSTRUCTIONS_TEMPLATE } from "./contract.fixtures.ts";
import { intakeGuideOutput } from "./tools.ts";
import {
  CONNECTOR_TOKEN_DEFAULT_LABEL,
  canActivateConnector,
  canManageConnectorSettings,
  connectorEnabledInput,
  connectorFieldErrors,
  connectorPublicUrl,
  connectorConfigView,
  connectorSettingsView,
  connectorTokenCreateInput,
  connectorTokenRevokeInput,
  connectorTokenView,
  formatItalianDay,
  inDaysText,
  isConnectorProfileReady,
  isConnectorSetUp,
  normalizeAllowedDomains,
  romeCalendarDaysBetween,
  shouldShowConnectorCard,
  type ConnectorSettingsRow,
  type ConnectorTokenRow,
} from "./settings-view.ts";

// Scheda «Connettore Claude» (PIANO-LAVORI §3.5, K7r; prompt WP7). Dati sintetici.

const NOW = new Date("2026-10-14T10:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function token(patch: Partial<ConnectorTokenRow> = {}): ConnectorTokenRow {
  return {
    id: randomUUID(),
    label: "Connettore di prova",
    tokenPrefix: `${CONNECTOR_TOKEN_PREFIX}AbCdEfG...`,
    createdAt: new Date(NOW.getTime() - 10 * DAY),
    expiresAt: new Date(NOW.getTime() + 80 * DAY),
    lastUsedAt: null,
    revokedAt: null,
    exposedAt: null,
    ...patch,
  };
}

function config(patch: Partial<ConnectorSettingsRow> = {}): ConnectorSettingsRow {
  return {
    slug: "prova-a",
    enabled: true,
    codePrefix: "XX",
    codeSeq: 42,
    identityMode: "dichiarata",
    authMode: "header",
    workspaceDisplayName: "  Organizzazione di prova  ",
    guideVersion: " 1.2 ",
    guideJsonVersion: "1.1",
    hasGuide: true,
    profileReady: true,
    allowedDomains: ["Prova.TEST", "@altra.test", "prova.test", "non valido", 42],
    allowedOrigins: ["https://claude.ai/", "non valida"],
    limits: { readsPerHour: 100 },
    ...patch,
  };
}

test("permessi: solo chi gestisce le integrazioni dall'organizzazione", () => {
  for (const role of ["exec_sponsor", "transformation_lead"]) {
    assert.equal(canManageConnectorSettings({ source: "organization", role }), true, role);
    // Un responsabile invitato al solo workspace non gestisce le integrazioni (come Slack).
    assert.equal(canManageConnectorSettings({ source: "workspace", role }), false, `${role} workspace`);
  }
  for (const role of ["function_lead", "analyst", "contributor", "learner", ""]) {
    assert.equal(canManageConnectorSettings({ source: "organization", role }), false, role);
  }
  assert.equal(canManageConnectorSettings(null), false);
  assert.equal(canManageConnectorSettings(undefined), false);
});

test("indirizzo pubblico: sempre www, lo slug nel percorso", () => {
  assert.equal(connectorPublicUrl("prova-a"), "https://www.theunbundle.com/api/mcp/connettore/prova-a");
  assert.equal(connectorPublicUrl("prova-a", "http://127.0.0.1:53130/"), "http://127.0.0.1:53130/api/mcp/connettore/prova-a");
});

test("date in italiano, nel fuso di Roma", () => {
  assert.equal(formatItalianDay(new Date("2027-01-12T10:00:00Z")), "12 gen 2027");
  // 23:30 UTC del 31 ottobre è già il 1° novembre a Roma.
  assert.equal(formatItalianDay(new Date("2026-10-31T23:30:00Z")), "1 nov 2026");
  assert.equal(formatItalianDay(null), null);
  assert.equal(formatItalianDay(new Date("non una data")), null);
});

test("token: attivo, in scadenza da 14 giorni prima, scaduto, revocato", () => {
  const active = connectorTokenView(token({ lastUsedAt: new Date("2026-10-13T08:00:00Z") }), NOW);
  assert.equal(active.state, "attivo");
  assert.equal(active.active, true);
  assert.equal(active.daysLeft, 80);
  assert.equal(active.expiresIn, "tra 80 giorni");
  assert.equal(active.lastUsedOn, "13 ott 2026");
  assert.equal(active.createdOn, "4 ott 2026");
  assert.equal(active.expiresOn, "2 gen 2027");

  const fifteen = connectorTokenView(token({ expiresAt: new Date(NOW.getTime() + 15 * DAY) }), NOW);
  assert.equal(fifteen.state, "attivo", "15 giorni: ancora nessun avviso");
  const fourteen = connectorTokenView(token({ expiresAt: new Date(NOW.getTime() + 14 * DAY) }), NOW);
  assert.equal(fourteen.state, "in_scadenza");
  assert.equal(fourteen.active, true);
  assert.equal(fourteen.daysLeft, 14);
  assert.equal(fourteen.expiresIn, "tra 14 giorni");
  // Scade fra 3 ore, lo stesso giorno a Roma: «oggi», non «domani».
  const hours = connectorTokenView(token({ expiresAt: new Date(NOW.getTime() + 3 * 60 * 60 * 1000) }), NOW);
  assert.equal(hours.state, "in_scadenza");
  assert.equal(hours.daysLeft, 0);
  assert.equal(hours.expiresIn, "oggi");
  assert.equal(hours.expiresOn, "14 ott 2026");

  const expired = connectorTokenView(token({ expiresAt: new Date(NOW.getTime() - 1000) }), NOW);
  assert.equal(expired.state, "scaduto");
  assert.equal(expired.active, false);
  assert.equal(expired.daysLeft, null);
  assert.equal(expired.expiresIn, null);

  const revoked = connectorTokenView(token({ revokedAt: new Date("2026-10-12T09:00:00Z"), expiresAt: new Date(NOW.getTime() - DAY) }), NOW);
  assert.equal(revoked.state, "revocato", "la revoca vince sulla scadenza");
  assert.equal(revoked.revokedOn, "12 ott 2026");

  const timeless = connectorTokenView(token({ expiresAt: null }), NOW);
  assert.equal(timeless.state, "attivo");
  assert.equal(timeless.daysLeft, null);
  assert.equal(timeless.expiresIn, null);
  assert.equal(timeless.expiresOn, null);
});

test("scadenza in giorni di calendario a Roma, coerente con la data mostrata", () => {
  // Vista alle 8:00 di Roma: un token creato in un'ora più tarda del giorno.
  const morning = new Date("2026-10-14T06:00:00Z");
  const view = (expiresAt: string, now = morning) => connectorTokenView(token({ expiresAt: new Date(expiresAt) }), now);
  const today = view("2026-10-14T18:00:00Z");
  assert.deepEqual([today.state, today.daysLeft, today.expiresIn, today.expiresOn], ["in_scadenza", 0, "oggi", "14 ott 2026"]);
  // 38 ore: domani sera, non «tra 2 giorni».
  const tomorrow = view("2026-10-15T20:00:00Z");
  assert.deepEqual([tomorrow.daysLeft, tomorrow.expiresIn, tomorrow.expiresOn], [1, "domani", "15 ott 2026"]);
  // 9 giorni e 12 ore: il 23 ottobre è fra 9 giorni di calendario, non 10.
  const nine = view("2026-10-23T18:00:00Z");
  assert.deepEqual([nine.state, nine.daysLeft, nine.expiresIn, nine.expiresOn], ["in_scadenza", 9, "tra 9 giorni", "23 ott 2026"]);
  // Dopo le 22:00 UTC è già il giorno dopo a Roma.
  const lateNight = view("2026-10-15T22:30:00Z");
  assert.deepEqual([lateNight.expiresIn, lateNight.expiresOn], ["tra 2 giorni", "16 ott 2026"]);
  // Cambio d'ora del 25 ottobre: dalle 00:30 del 25 (ora legale) alle 00:30 del 3 novembre (ora solare).
  assert.equal(romeCalendarDaysBetween(new Date("2026-10-24T22:30:00Z"), new Date("2026-11-02T23:30:00Z")), 9);
  // E quello di marzo: dalle 23:30 del 27 alle 00:30 del 29 (ora legale).
  assert.equal(romeCalendarDaysBetween(new Date("2027-03-27T22:30:00Z"), new Date("2027-03-28T22:30:00Z")), 2);
  assert.deepEqual([0, 1, 2, 30].map(inDaysText), ["oggi", "domani", "tra 2 giorni", "tra 30 giorni"]);
});

test("token esposto: segnale presente anche dopo la revoca, la vista dice quando", () => {
  const exposed = connectorTokenView(token({ exposedAt: new Date("2026-10-14T07:00:00Z") }), NOW);
  assert.equal(exposed.exposed, true);
  assert.equal(exposed.active, true);
  assert.equal(exposed.exposedOn, "14 ott 2026");
  const revoked = connectorTokenView(token({ exposedAt: new Date("2026-10-14T07:00:00Z"), revokedAt: NOW }), NOW);
  assert.equal(revoked.exposed, true);
  assert.equal(revoked.active, false);
  assert.equal(connectorTokenView(token(), NOW).exposed, false);
});

test("la vista del token non porta mai l'hash né campi in più", () => {
  const view = connectorTokenView({ ...token(), tokenHash: "f".repeat(64), createdByUserId: randomUUID() } as ConnectorTokenRow, NOW);
  assert.deepEqual(Object.keys(view).sort(), [
    "active",
    "createdOn",
    "daysLeft",
    "expiresIn",
    "expiresOn",
    "exposed",
    "exposedOn",
    "id",
    "label",
    "lastUsedOn",
    "revokedOn",
    "state",
    "tokenPrefix",
  ]);
});

test("configurazione: valori ripuliti, limiti con i predefiniti, domini e origini normalizzati", () => {
  const view = connectorSettingsView(config(), [token()], NOW);
  assert.equal(view.status, "attivo");
  assert.deepEqual(view.config, {
    slug: "prova-a",
    url: "https://www.theunbundle.com/api/mcp/connettore/prova-a",
    enabled: true,
    codePrefix: "XX",
    nextCode: "XX-0043",
    displayName: "Organizzazione di prova",
    guideVersion: "1.2",
    hasGuide: true,
    profileReady: true,
    canActivate: true,
    identityMode: "dichiarata",
    authMode: "header",
    allowedDomains: ["prova.test", "altra.test"],
    allowedOrigins: ["https://claude.ai"],
    limits: { ...CONNECTOR_DEFAULT_LIMITS, readsPerHour: 100 },
  });
  const bare = connectorSettingsView(
    config({
      codeSeq: 0,
      workspaceDisplayName: "  ",
      guideVersion: null,
      guideJsonVersion: null,
      hasGuide: false,
      allowedDomains: null,
      allowedOrigins: "x",
      limits: null,
      identityMode: "altro",
      authMode: "oauth",
    }),
    [],
    NOW
  ).config!;
  assert.equal(bare.nextCode, "XX-0001", "nessun codice ancora: il primo");
  assert.equal(bare.displayName, null);
  assert.equal(bare.guideVersion, null);
  assert.equal(bare.hasGuide, false);
  assert.deepEqual(bare.allowedDomains, []);
  assert.deepEqual(bare.allowedOrigins, []);
  assert.deepEqual(bare.limits, { ...CONNECTOR_DEFAULT_LIMITS });
  assert.equal(bare.identityMode, "dichiarata");
  assert.equal(bare.authMode, "oauth");
});

test("prossimo codice: dal contatore del workspace, cinque cifre oltre 9999, nessuno a numeri finiti", () => {
  const next = (codeSeq: number) => connectorSettingsView(config({ codeSeq }), [], NOW).config!.nextCode;
  assert.equal(next(0), "XX-0001");
  assert.equal(next(9999), "XX-10000");
  assert.equal(next(99998), "XX-99999");
  assert.equal(next(99999), null);
});

test("versione della guida: la stessa che Claude riceve da get_intake_guide", () => {
  const cases: Array<[string | null, string | null, string | null]> = [
    // colonna, guideVersion nella guida, attesa
    ["1.2", "1.1", "1.2"],
    [null, "1.3", "1.3"],
    ["  ", "1.3", "1.3"],
    [null, null, null],
  ];
  for (const [column, inGuide, expected] of cases) {
    const card = connectorConfigView(config({ guideVersion: column, guideJsonVersion: inGuide })).guideVersion;
    const guide = inGuide === null ? {} : { guideVersion: inGuide };
    const served = intakeGuideOutput({ guide, guideVersion: column?.trim() || null, identityMode: "dichiarata" }).guideVersion;
    assert.equal(card, expected, `scheda ${column} / ${inGuide}`);
    assert.equal(served, expected, `get_intake_guide ${column} / ${inGuide}`);
  }
});

test("domini email: minuscole, senza @, validi, senza doppioni", () => {
  assert.deepEqual(normalizeAllowedDomains([" Esempio.TEST ", "@esempio.test", "sotto.esempio.test", "esempio", "-x.test", "a..test", null, {}]), [
    "esempio.test",
    "sotto.esempio.test",
  ]);
  assert.deepEqual(normalizeAllowedDomains("esempio.test"), []);
});

test("stato della scheda: non configurato, sospeso, senza token, attivo", () => {
  assert.equal(connectorSettingsView(null, [token()], NOW).status, "non_configurato");
  assert.equal(connectorSettingsView(null, [], NOW).config, null);
  // La riga che ogni workspace riceve per i codici (D6): spenta e senza guida.
  const d6 = config({ enabled: false, hasGuide: false, guideVersion: null, guideJsonVersion: null });
  assert.equal(connectorSettingsView(d6, [], NOW).status, "non_configurato");
  assert.equal(connectorSettingsView(d6, [], NOW).config, null, "niente indirizzo, interruttore o token nuovi");
  assert.equal(connectorSettingsView({ ...d6, hasGuide: true }, [], NOW).status, "sospeso", "con la guida è un connettore sospeso");
  // Acceso senza guida (solo a mano sul database): resta visibile, così si può spegnere.
  assert.equal(connectorSettingsView({ ...d6, enabled: true }, [token()], NOW).status, "attivo");
  assert.equal(connectorSettingsView(config({ enabled: false }), [token()], NOW).status, "sospeso");
  assert.equal(connectorSettingsView(config(), [], NOW).status, "senza_token");
  assert.equal(
    connectorSettingsView(config(), [token({ revokedAt: NOW }), token({ expiresAt: new Date(NOW.getTime() - DAY) })], NOW).status,
    "senza_token",
    "revocati e scaduti non contano"
  );
  assert.equal(connectorSettingsView(config(), [token({ expiresAt: new Date(NOW.getTime() + 2 * DAY) })], NOW).status, "attivo");
});

test("connettore preparato: guida caricata o acceso; si accende e riceve token solo con la guida", () => {
  assert.equal(isConnectorSetUp(null), false);
  assert.equal(isConnectorSetUp({ enabled: false, hasGuide: false }), false, "riga di D6");
  assert.equal(isConnectorSetUp({ enabled: false, hasGuide: true }), true);
  assert.equal(isConnectorSetUp({ enabled: true, hasGuide: false }), true);
  assert.equal(canActivateConnector(null), false);
  assert.equal(canActivateConnector({ hasGuide: false, profileReady: true }), false);
  assert.equal(canActivateConnector({ hasGuide: true, profileReady: true }), true);
});

test("profilo del cliente e modello delle istruzioni: senza, il connettore non si accende e non riceve token (la rotta risponderebbe 500)", () => {
  const profile = JSON.parse(JSON.stringify(EXAMPLE_CONNECTOR_PROFILE_INPUT));
  assert.equal(isConnectorProfileReady(profile, EXAMPLE_INSTRUCTIONS_TEMPLATE), true);
  for (const [label, p, t] of [
    ["nessun profilo", null, EXAMPLE_INSTRUCTIONS_TEMPLATE],
    ["nessun modello", profile, null],
    ["profilo senza un tool", { ...profile, tools: { ...profile.tools, get_contribution_status: undefined } }, EXAMPLE_INSTRUCTIONS_TEMPLATE],
    ["modello senza segnaposto", profile, "Istruzioni senza nome."],
    ["profilo come testo", JSON.stringify(profile), EXAMPLE_INSTRUCTIONS_TEMPLATE],
  ] as const) {
    assert.equal(isConnectorProfileReady(p, t), false, label);
  }
  assert.equal(canActivateConnector({ hasGuide: true, profileReady: false }), false);
  const view = connectorSettingsView(config({ profileReady: false }), [token()], NOW);
  assert.equal(view.status, "attivo", "lo stato resta quello dell'interruttore e dei token");
  assert.equal(view.config!.profileReady, false);
  assert.equal(view.config!.canActivate, false, "la scheda non offre token nuovi né l'accensione");
  assert.equal(connectorSettingsView(config({ hasGuide: false, enabled: true }), [], NOW).config!.canActivate, false);
  // La vista non porta il contenuto del profilo né del modello.
  assert.equal(JSON.stringify(view).includes("Lateral Space"), false);
});

test("la scheda compare solo dove il connettore è configurato o restano token attivi", () => {
  const d6 = config({ enabled: false, hasGuide: false });
  assert.equal(shouldShowConnectorCard(connectorSettingsView(null, [], NOW)), false);
  assert.equal(shouldShowConnectorCard(connectorSettingsView(d6, [], NOW)), false);
  assert.equal(shouldShowConnectorCard(connectorSettingsView(d6, [token({ revokedAt: NOW })], NOW)), false, "solo token revocati");
  assert.equal(shouldShowConnectorCard(connectorSettingsView(d6, [token()], NOW)), true, "un token attivo si deve poter revocare");
  assert.equal(shouldShowConnectorCard(connectorSettingsView(config({ enabled: false }), [], NOW)), true);
  assert.equal(shouldShowConnectorCard(connectorSettingsView(config(), [], NOW)), true);
});

test("ordine dei token: prima gli attivi, ognuno dal più recente", () => {
  const at = (days: number) => new Date(NOW.getTime() - days * DAY);
  const rows = [
    token({ label: "revocato recente", createdAt: at(1), revokedAt: NOW }),
    token({ label: "attivo vecchio", createdAt: at(30) }),
    token({ label: "scaduto", createdAt: at(100), expiresAt: at(10) }),
    token({ label: "attivo recente", createdAt: at(2) }),
  ];
  assert.deepEqual(
    connectorSettingsView(config(), rows, NOW).tokens.map((t) => t.label),
    ["attivo recente", "attivo vecchio", "revocato recente", "scaduto"]
  );
});

test("input dell'interruttore: workspace e booleano, niente altro", () => {
  const workspaceId = randomUUID();
  assert.deepEqual(connectorEnabledInput.parse({ workspaceId, enabled: false }), { workspaceId, enabled: false });
  for (const bad of [
    { workspaceId, enabled: "false" },
    { workspaceId, enabled: 1 },
    { workspaceId: "non-un-id", enabled: true },
    { workspaceId, enabled: true, slug: "altro" },
    { enabled: true },
  ]) {
    assert.equal(connectorEnabledInput.safeParse(bad).success, false, JSON.stringify(bad));
  }
});

test("input del token nuovo: nome ripulito da 2 a 80 caratteri, messaggi in italiano", () => {
  const workspaceId = randomUUID();
  assert.equal(connectorTokenCreateInput.parse({ workspaceId, label: `  ${CONNECTOR_TOKEN_DEFAULT_LABEL}  ` }).label, CONNECTOR_TOKEN_DEFAULT_LABEL);
  assert.equal(connectorTokenCreateInput.parse({ workspaceId, label: "x".repeat(80) }).label.length, 80);
  const cases: Array<[unknown, string]> = [
    [" a ", "Dai un nome al token."],
    ["", "Dai un nome al token."],
    [42, "Dai un nome al token."],
    ["Zq".repeat(41), "Nome troppo lungo: al massimo 80 caratteri."],
  ];
  for (const [label, message] of cases) {
    const parsed = connectorTokenCreateInput.safeParse({ workspaceId, label });
    assert.equal(parsed.success, false, String(label));
    if (parsed.success) continue;
    const errors = connectorFieldErrors(parsed.error);
    assert.deepEqual(errors, { label: message });
    // Il messaggio non ripete mai il valore ricevuto.
    assert.ok(!errors.label.includes("Zq"));
  }
});

test("input della revoca: id del token in forma di uuid", () => {
  const workspaceId = randomUUID();
  const tokenId = randomUUID();
  assert.deepEqual(connectorTokenRevokeInput.parse({ workspaceId, tokenId }), { workspaceId, tokenId });
  const parsed = connectorTokenRevokeInput.safeParse({ workspaceId, tokenId: `${CONNECTOR_TOKEN_PREFIX}non-un-id` });
  assert.equal(parsed.success, false);
  if (!parsed.success) assert.deepEqual(connectorFieldErrors(parsed.error), { tokenId: "Token non valido." });
  assert.equal(connectorTokenRevokeInput.safeParse({ workspaceId: "x", tokenId }).success, false);
});
