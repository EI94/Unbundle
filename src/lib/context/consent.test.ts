import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installAppModules, recordLogs } from "../ai/claude-test-kit.ts";
import { SUBPROCESSORS, SUBPROCESSORS_VERSION } from "../uc/legal/subprocessors.ts";

// L'ok ai sub-responsabili per le funzioni AI di «Contesto» (RILASCIO-9a-COSTRUZIONE.md §6): il controllo che si
// chiude e non si apre, l'avviso per chi guarda, e l'azione aperta a ogni workspace. Database e sessione finti.

type Prova = {
  /** `uc_subprocessor_acks` esiste. */
  table: boolean;
  /** La lettura del database lancia. */
  broken: boolean;
  /** Il workspace ha l'ok per la lista di oggi. */
  ack: boolean;
  user: { isLateralSpace: boolean; emailVerified: boolean; emailDomain: string | null } | null;
  dossiers: boolean;
  referents: boolean;
  declared: unknown[];
  revalidated: string[];
  sectionChecks: number;
  queries: string[];
};
const prova: Prova = { table: false, broken: false, ack: false, user: null, dossiers: false, referents: false, declared: [], revalidated: [], sectionChecks: 0, queries: [] };
(globalThis as { __prova?: Prova }).__prova = prova;

const WS = "00000000-0000-4000-8000-00000000c001";
const USER = "00000000-0000-4000-8000-00000000c002";

await installAppModules({
  "@/lib/db/uc-executor": `export async function getAppUcExecutor() {
    return { async batch(statements) {
      const p = globalThis.__prova;
      if (p.broken) throw Object.assign(new Error("connessione persa: dati riservati"), { code: "08006" });
      return statements.map((s) => { p.queries.push(s.text); return /to_regclass/.test(s.text) ? [{ ok: p.table }] : []; });
    } };
  }`,
  "@/lib/db/queries/uc-subprocessors": `export async function loadSubprocessorAck() { return globalThis.__prova.ack ? { listVersion: "x" } : null; }
    export async function declareSubprocessors(executor, input) { globalThis.__prova.declared.push(input); return { ok: true, value: { ack: { registeredBy: "lateral_space" }, created: true } }; }`,
  "@/lib/db/queries/uc-access": `export const getUcUserContext = async () => globalThis.__prova.user;
    export const ucLsDomains = () => ["ls.test"];
    export const isUcEnabledFor = () => globalThis.__prova.dossiers;`,
  "@/lib/db/queries/workspaces": `export const getWorkspaceById = async () => ({ id: "${WS}", name: "Nardi Arredamenti" });`,
  "@/lib/db/queries/use-case-referent-base": `export const referentStoreReady = async () => true;`,
  "@/lib/use-cases/referent/availability": `export const referentAskEnabled = () => globalThis.__prova.referents;`,
  "@/lib/auth/require-workspace": `export async function requireWorkspaceAccess() { return { session: { user: { id: "${USER}" } }, access: { role: "transformation_lead" } }; }`,
  "@/lib/uc/log": `export const ucLogError = () => {};`,
  "next/cache": `export const revalidatePath = (path, type) => { globalThis.__prova.revalidated.push(type ? path + " " + type : path); };`,
  "./uc-action-context": `export const ucFailure = (code, message) => ({ ok: false, code, message });
    export async function ucSectionAvailable() { globalThis.__prova.sectionChecks += 1; return globalThis.__prova.dossiers ? { ok: true, data: null } : { ok: false, code: "disattivata", message: "Sezione non disponibile." }; }`,
});
const consent = await import("../db/queries/context-consent.ts");
const { declareSubprocessorsAction } = await import("../actions/uc-subprocessors.ts");

const LS = { isLateralSpace: true, emailVerified: true, emailDomain: "ls.test" };
const CLIENT = { isLateralSpace: false, emailVerified: true, emailDomain: "cliente.test" };

function reset(over: Partial<Prova> = {}) {
  Object.assign(prova, { broken: false, ack: false, user: null, dossiers: false, referents: false, declared: [], revalidated: [], sectionChecks: 0, queries: [] }, over);
}

// Prima i casi senza la tabella: una volta vista, il processo ricorda che c'è.
test("senza la tabella dell'ok: l'ok non c'è, nessuno può darlo, e l'azione resta chiusa come prima", async () => {
  reset({ user: LS });
  assert.equal(await consent.subprocessorAcksReady(), false);
  assert.equal(await consent.contextAiConsent(WS), false);
  const notice = await consent.loadAiConsentNotice({ workspaceId: WS, userId: USER, role: "transformation_lead" });
  assert.equal(notice?.declarer, null, "senza la tabella l'avviso non ha un'azione");
  assert.equal(notice?.buttonLabel, null);
  const result = await declareSubprocessorsAction(WS, SUBPROCESSORS_VERSION, true);
  assert.deepEqual(result, { ok: false, code: "disattivata", message: "Sezione non disponibile." });
  assert.equal(prova.sectionChecks, 1);
  assert.deepEqual(prova.declared, []);
  assert.deepEqual(prova.revalidated, []);
});

test("se la lettura non riesce l'ok non c'è (si chiude, non si apre); nel log solo codici", async (t) => {
  const lines = recordLogs(t);
  reset({ broken: true });
  assert.equal(await consent.contextAiConsent(WS), false);
  assert.equal(await consent.contextAiConsentNow(WS), false);
  assert.equal(await consent.subprocessorAcksReady(), false);
  assert.ok(lines.length >= 1);
  for (const line of lines) {
    assert.match(line, /^\[context\/consent\] sonda_non_riuscita /);
    assert.doesNotMatch(line, /riservati|connessione persa/, "mai il messaggio dell'errore");
  }
  // Un id che non è un UUID non arriva al database.
  reset();
  assert.equal(await consent.contextAiConsent("non-un-id"), false);
  assert.deepEqual(prova.queries, []);
});

test("con la tabella: senza la riga l'ok non c'è, con la riga c'è e l'avviso sparisce", async () => {
  reset({ table: true });
  assert.equal(await consent.subprocessorAcksReady(), true);
  assert.equal(await consent.contextAiConsent(WS), false);
  reset({ table: true, ack: true });
  assert.equal(await consent.contextAiConsent(WS), true);
  assert.equal(await consent.loadAiConsentNotice({ workspaceId: WS, userId: USER, role: "analyst" }), null);
});

test("l'avviso per chi guarda: Lateral Space con un clic, il cliente verso Impostazioni, gli altri senza azione", async () => {
  reset({ table: true, user: LS });
  const ls = await consent.loadAiConsentNotice({ workspaceId: WS, userId: USER, role: "transformation_lead" });
  assert.deepEqual(ls, {
    workspaceId: WS,
    companyName: "Nardi Arredamenti",
    declarer: "lateral_space",
    listVersion: SUBPROCESSORS_VERSION,
    statement: ls?.statement,
    suppliers: SUBPROCESSORS.map((s) => s.nome),
    buttonLabel: "Registra l'ok di Nardi Arredamenti",
    settingsHref: `/dashboard/${WS}/settings#sub-responsabili`,
  });
  assert.match(ls?.statement ?? "", /^Per conto di Nardi Arredamenti: .* L'ok lo registra Lateral Space\./);
  assert.ok(ls?.suppliers.includes("Anthropic"));

  reset({ table: true, user: CLIENT });
  const client = await consent.loadAiConsentNotice({ workspaceId: WS, userId: USER, role: "function_lead" });
  assert.equal(client?.declarer, "cliente");
  assert.equal(client?.buttonLabel, null, "il cliente autorizza in Impostazioni, con la casella dei poteri");
  assert.match(client?.statement ?? "", /^Per conto di Nardi Arredamenti, titolare del trattamento, autorizzo Lateral Space/);

  for (const [user, role] of [[LS, "analyst"], [LS, "contributor"], [CLIENT, "analyst"], [CLIENT, "contributor"], [null, "transformation_lead"], [LS, null]] as const) {
    reset({ table: true, user });
    const none = await consent.loadAiConsentNotice({ workspaceId: WS, userId: USER, role });
    assert.equal(none?.declarer, null, `${JSON.stringify(user)} ${role}`);
    assert.equal(none?.buttonLabel, null);
  }
});

test("l'azione: senza dossier e senza referenti l'ok si registra, se la tabella c'è; poi si rinfrescano «Contesto», Discovery e mappatura", async () => {
  reset({ table: true });
  const result = await declareSubprocessorsAction(WS, SUBPROCESSORS_VERSION, true);
  assert.deepEqual(result, { ok: true, data: null, message: "Ok registrato per conto del cliente." });
  assert.equal(prova.sectionChecks, 0, "la terza condizione salta il controllo dei dossier, come per i referenti");
  assert.deepEqual(prova.declared, [{ workspaceId: WS, userId: USER, lsDomains: ["ls.test"], listVersion: SUBPROCESSORS_VERSION, confirmed: true }]);
  for (const path of [`/dashboard/${WS}/contesto layout`, `/dashboard/${WS}/setup/leadership layout`, `/dashboard/${WS}/mapping layout`, `/dashboard/${WS}/settings`]) {
    assert.ok(prova.revalidated.includes(path), path);
  }
});

test("l'azione: con i dossier accesi passa ancora dal controllo della sezione; con i referenti resta com'era", async () => {
  reset({ table: true, dossiers: true });
  assert.equal((await declareSubprocessorsAction(WS, SUBPROCESSORS_VERSION, true)).ok, true);
  assert.equal(prova.sectionChecks, 1);
  reset({ table: true, referents: true });
  assert.equal((await declareSubprocessorsAction(WS, SUBPROCESSORS_VERSION, true)).ok, true);
  assert.equal(prova.sectionChecks, 0);
});

test("la scheda «Sub-responsabili» si mostra in ogni workspace, se la tabella dell'ok c'è", () => {
  const card = readFileSync(new URL("../../components/workspace/subprocessors-card.tsx", import.meta.url), "utf8");
  assert.match(card, /import \{ subprocessorAcksReady \} from "@\/lib\/db\/queries\/context-consent";/);
  assert.match(
    card,
    /if \(!dossiers && !\(referentAskEnabled\(workspaceId, process\.env\) && \(await referentStoreReady\(\)\)\) && !\(await subprocessorAcksReady\(\)\)\) return null;/,
  );
  // Chi può dare l'ok e il testo non cambiano.
  assert.match(card, /const declarer = ack \? null : subprocessorDeclarerOf\(user, workspaceRole, ucLsDomains\(\)\);/);
});
