import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installAppModules, recordLogs } from "../../lib/ai/claude-test-kit.ts";

// Le azioni di «Cerca una persona» (rilascio 9b, RILASCIO-9b-COSTRUZIONE.md §2.13): chi chiama si rilegge dalla sessione
// e la funzione condivisa riceve lui e il termine; senza accesso nessuna funzione parte; la pagina si aggiorna solo dopo
// un «Togli … da tutto» riuscito; la ricerca non aggiorna niente; un errore inatteso risponde «riprova» e nei log non
// porta il nome. Chi chiama e le funzioni condivise sono finti: nessun database.

type Call = { fn: string; args: unknown[] };
type Prova = { result: unknown; throws: boolean; actorOk: boolean; calls: Call[]; revalidated: string[] };
const prova: Prova = { result: null, throws: false, actorOk: true, calls: [], revalidated: [] };
(globalThis as { __prova?: Prova }).__prova = prova;

const WS = "11111111-1111-4111-8111-111111111111";
const ACTOR = { workspaceId: WS, userId: "33333333-3333-4333-8333-333333333333", role: "transformation_lead", isLateralSpace: true, channel: "web" };

const fake = (name: string) => `export async function ${name}(...args) {
  globalThis.__prova.calls.push({ fn: "${name}", args });
  if (globalThis.__prova.throws) throw new Error("errore con il nome Rossi dentro");
  return globalThis.__prova.result;
}`;

await installAppModules({
  "@/lib/context/server/actor": `
    export async function contextActorFromSession(workspaceId) {
      if (!globalThis.__prova.actorOk) return { ok: false, status: 404 };
      return { ok: true, actor: { ...${JSON.stringify(ACTOR)}, workspaceId } };
    }`,
  "@/lib/db/queries/context-people": [fake("searchPerson"), fake("erasePerson")].join("\n"),
  "next/cache": `export function revalidatePath(path, type) { globalThis.__prova.revalidated.push(path + (type ? "|" + type : "")); }`,
});
const actions = await import("../../lib/actions/context-people.ts");

beforeEach(() => {
  Object.assign(prova, { result: { ok: true, value: true }, throws: false, actorOk: true, calls: [], revalidated: [] });
});

test("il file esporta le due azioni del pannello", () => {
  assert.deepEqual(Object.keys(actions).sort(), ["erasePersonAction", "searchPersonAction"]);
});

test("«Cerca»: la funzione condivisa riceve chi chiama e il termine; la pagina non si aggiorna", async () => {
  prova.result = { ok: true, value: { term: "Rossi" } };
  assert.deepEqual(await actions.searchPersonAction(WS, "Rossi"), prova.result);
  assert.deepEqual(prova.calls, [{ fn: "searchPerson", args: [ACTOR, "Rossi"] }]);
  assert.deepEqual(prova.revalidated, []);
});

test("«Togli … da tutto» riuscito: la pagina di «Contesto» si aggiorna, con «Appunti» sotto", async () => {
  prova.result = { ok: true, value: { notes: 2, texts: 5, rules: 1, chatMemory: 1 } };
  assert.deepEqual(await actions.erasePersonAction(WS, "Rossi"), prova.result);
  assert.deepEqual(prova.calls, [{ fn: "erasePerson", args: [ACTOR, "Rossi"] }]);
  assert.deepEqual(prova.revalidated, [`/dashboard/${WS}/contesto|layout`]);
});

test("«Togli» rifiutato (chi non è di Lateral Space): l'esito passa com'è e la pagina non si aggiorna", async () => {
  prova.result = { ok: false, error: "permesso_mancante", message: "Non hai i permessi per farlo." };
  assert.deepEqual(await actions.erasePersonAction(WS, "Rossi"), prova.result);
  assert.deepEqual(prova.revalidated, []);
});

test("senza accesso al workspace: permesso_mancante, e nessuna funzione condivisa parte", async () => {
  prova.actorOk = false;
  for (const result of [await actions.searchPersonAction(WS, "Rossi"), await actions.erasePersonAction(WS, "Rossi")]) {
    assert.deepEqual(result, { ok: false, error: "permesso_mancante", message: "Non hai i permessi per farlo." });
  }
  assert.deepEqual(prova.calls, []);
  assert.deepEqual(prova.revalidated, []);
});

test("un errore inatteso: «riprova», nessun aggiornamento, e nei log il codice dell'azione ma mai il nome", async (t) => {
  const logs = recordLogs(t);
  prova.throws = true;
  for (const result of [await actions.searchPersonAction(WS, "Rossi"), await actions.erasePersonAction(WS, "Rossi")]) {
    assert.deepEqual(result, { ok: false, error: "riprova", message: "Non è riuscito. Riprova tra poco." });
  }
  assert.deepEqual(prova.revalidated, []);
  assert.equal(logs.length, 2);
  assert.match(logs[0], /\[context\/people-actions\] ricerca_persona_non_riuscita/);
  assert.match(logs[1], /\[context\/people-actions\] persona_tolta_non_riuscita/);
  assert.doesNotMatch(logs.join("\n"), /rossi/i);
});
