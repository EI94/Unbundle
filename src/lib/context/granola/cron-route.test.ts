import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installAppModules, recordLogs } from "../../ai/claude-test-kit.ts";

// Il cron della notte di «Contesto» (rilascio 9a, RILASCIO-9a-COSTRUZIONE.md §8.8): chi può chiamarlo, in che ordine
// fa le cose, e che cosa risponde: solo conteggi. La rotta è quella vera; l'archivio, Granola e il giro sono finti.
// (Il file nasce con la rotta, nella fondazione; poi è del pacchetto «granola», come la rotta.)

type Prova = {
  ready: boolean;
  granola: boolean;
  granolaThrows: boolean;
  nightlyThrows: boolean;
  /** Che cosa è stato chiamato, nell'ordine, con il tempo dato. */
  calls: string[];
};
const prova: Prova = { ready: true, granola: false, granolaThrows: false, nightlyThrows: false, calls: [] };
(globalThis as { __prova?: Prova }).__prova = prova;

await installAppModules({
  "@/lib/db/queries/context-store": `export async function contextStoreReady() { globalThis.__prova.calls.push("archivio"); return globalThis.__prova.ready; }`,
  // I due giri rispondono anche campi che non sono conteggi: la rotta non deve farli uscire.
  "@/lib/db/queries/context-granola": `
    export function granolaAvailable() { return globalThis.__prova.granola; }
    export async function syncGranolaAll(o) {
      globalThis.__prova.calls.push("granola:" + o.budgetMs);
      if (globalThis.__prova.granolaThrows) throw new Error("titolo riservato di una call");
      return { users: 2, imported: 3, errors: 0, ultimoTitolo: "Call riservata" };
    }`,
  "@/lib/db/queries/context-nightly": `
    export async function runContextNightly(o) {
      globalThis.__prova.calls.push("notte:" + o.budgetMs);
      if (globalThis.__prova.nightlyThrows) throw new Error("testo riservato di un appunto");
      return { read: 4, failed: 1, left: 2, briefs: 3, purged: 5, ultimoTesto: "Appunto riservato" };
    }`,
});
const route = await import("../../../app/api/cron/contesto/route.ts");

const SECRET = "segreto-di-prova-del-cron";
const ENV_KEYS = ["CRON_SECRET", "VERCEL_ENV"] as const;
const envBefore = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

beforeEach(() => {
  Object.assign(prova, { ready: true, granola: false, granolaThrows: false, nightlyThrows: false, calls: [] });
  process.env.CRON_SECRET = SECRET;
  delete process.env.VERCEL_ENV;
});
afterEach(() => {
  for (const key of ENV_KEYS) {
    if (envBefore[key] === undefined) delete process.env[key];
    else process.env[key] = envBefore[key];
  }
});

const call = (authorization: string | null = `Bearer ${SECRET}`) =>
  route.GET(new Request("https://unbundle.test/api/cron/contesto", authorization === null ? {} : { headers: { authorization } }));

/** Le righe `console.info` del test. */
function recordInfo(t: import("node:test").TestContext): string[] {
  const lines: string[] = [];
  t.mock.method(console, "info", (...args: unknown[]) => void lines.push(args.map(String).join(" ")));
  return lines;
}

test("la rotta è una funzione Node, mai in cache, con 120 secondi", () => {
  assert.deepEqual([route.runtime, route.dynamic, route.maxDuration], ["nodejs", "force-dynamic", 120]);
});

test("in un'anteprima di Vercel risponde 404 prima di tutto, anche con il segreto giusto", async () => {
  process.env.VERCEL_ENV = "preview";
  const response = await call();
  assert.equal(response.status, 404);
  assert.equal(await response.text(), "Not found");
  assert.deepEqual(prova.calls, [], "né l'archivio né i giri");
});

test("senza segreto, con il segreto sbagliato o senza intestazione risponde 401 e non fa niente", async (t) => {
  const errors = recordLogs(t);
  for (const header of [null, "Bearer sbagliato", SECRET, `Basic ${SECRET}`, "Bearer undefined"]) {
    const response = await call(header);
    assert.equal(response.status, 401, String(header));
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.deepEqual(errors, [], "un segreto sbagliato non scrive nei log");
  // `CRON_SECRET` assente o vuoto rifiuta sempre, anche «Bearer undefined», e lo dice nei log.
  for (const secret of [undefined, "", "   "]) {
    if (secret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = secret;
    for (const header of ["Bearer undefined", "Bearer ", `Bearer ${SECRET}`, null]) assert.equal((await call(header)).status, 401, `${JSON.stringify(secret)} ${header}`);
  }
  assert.ok(errors.length > 0 && errors.every((line) => line === "[context/cron] cron_secret_mancante"), errors.join("\n"));
  assert.deepEqual(prova.calls, []);
});

test("con l'archivio non pronto risponde 503 e non comincia i giri", async () => {
  prova.ready = false;
  prova.granola = true;
  const response = await call();
  assert.equal(response.status, 503);
  assert.deepEqual(prova.calls, ["archivio"]);
});

test("con Granola spento fa solo il giro di «Contesto», con 70 secondi, e risponde solo conteggi", async (t) => {
  const info = recordInfo(t);
  const response = await call();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { job: "contesto", granola: { users: 0, imported: 0, errors: 0 }, read: 4, failed: 1, left: 2, briefs: 3, purged: 5 });
  assert.deepEqual(prova.calls, ["archivio", "notte:70000"]);
  // Una riga di log, con gli stessi conteggi e la durata: nessun testo.
  assert.equal(info.length, 1);
  const [scope, payload] = [info[0].slice(0, info[0].indexOf("{")).trim(), JSON.parse(info[0].slice(info[0].indexOf("{")))];
  assert.equal(scope, "[context/cron] giro");
  assert.deepEqual(Object.keys(payload), ["granola", "read", "failed", "left", "briefs", "purged", "durationMs"]);
  assert.equal(typeof payload.durationMs, "number");
  assert.doesNotMatch(info[0], /riservat/);
});

test("con Granola attivo: prima Granola con 35 secondi, poi il giro; del giro di Granola escono solo i tre conteggi", async () => {
  prova.granola = true;
  const response = await call();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, { job: "contesto", granola: { users: 2, imported: 3, errors: 0 }, read: 4, failed: 1, left: 2, briefs: 3, purged: 5 });
  assert.deepEqual(prova.calls, ["archivio", "granola:35000", "notte:70000"]);
  assert.doesNotMatch(JSON.stringify(body), /riservat/i);
});

test("se Granola non riesce il giro di «Contesto» si fa lo stesso; nei log il nome dell'errore, mai il suo testo", async (t) => {
  const errors = recordLogs(t);
  recordInfo(t);
  prova.granola = true;
  prova.granolaThrows = true;
  const response = await call();
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).granola, { users: 0, imported: 0, errors: 1 });
  assert.deepEqual(prova.calls, ["archivio", "granola:35000", "notte:70000"]);
  assert.deepEqual(errors, ['[context/cron] granola_non_riuscito {"error":{"name":"Error"}}']);
});

test("se il giro non riesce risponde 503, senza il testo dell'errore nella risposta né nei log", async (t) => {
  const errors = recordLogs(t);
  prova.nightlyThrows = true;
  const response = await call();
  assert.equal(response.status, 503);
  assert.equal(await response.text(), "Unavailable");
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^\[context\/cron\] giro_non_riuscito \{"durationMs":\d+,"error":\{"name":"Error"\}\}$/);
});
