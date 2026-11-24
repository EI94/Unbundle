import test from "node:test";
import assert from "node:assert/strict";
import { installAppModules } from "../ai/claude-test-kit.ts";

// (0044) L'indirizzo pulito delle email dell'AI Readiness: le due rotte vere con il redirect vero di Next, l'accesso e
// la rilevazione finti. Prima l'accesso come la pagina, poi 307 alla scheda giusta; (revisione) un link morto porta alla
// pagina con «Questa rilevazione non c'è più.», sempre allo stesso indirizzo. La prova con l'accesso vero sul database:
// src/lib/db/queries/ai-readiness-email-route.integration.test.ts. Id inventati.

type Prova = { asked: string[]; refuse: Error | null; inWorkspace: boolean };
const prova: Prova = { asked: [], refuse: null, inWorkspace: true };
(globalThis as { __airLanding?: Prova }).__airLanding = prova;

await installAppModules({
  "@/lib/auth/require-workspace": `export async function requireWorkspacePage(workspaceId) {
    const p = globalThis.__airLanding; p.asked.push("accesso:" + workspaceId);
    if (p.refuse) throw p.refuse;
    return { session: { user: { id: "utente-prova" } }, access: { role: "transformation_lead" } };
  }`,
  "@/lib/db/queries/ai-readiness-email": `export async function assessmentInWorkspace(workspaceId, assessmentId) {
    const p = globalThis.__airLanding; p.asked.push("rilevazione:" + workspaceId + ":" + assessmentId); return p.inWorkspace;
  }`,
});

const WS = "3f2a9c1e-0000-4000-8000-0000000000a1";
const AS = "3f2a9c1e-0000-4000-8000-0000000000c1";
type Get = (request: Request, context: { params: Promise<{ workspaceId: string; assessmentId: string }> }) => Promise<unknown>;
const app = "../../app/(dashboard)/dashboard/[workspaceId]/ai-readiness/aggiornamenti/[assessmentId]";
const answers = ((await import(`${app}/route.ts`)) as { GET: Get; dynamic: string });
const results = ((await import(`${app}/risultati/route.ts`)) as { GET: Get; dynamic: string });

const call = (route: { GET: Get }) =>
  route.GET(new Request(`http://unbundle.test/dashboard/${WS}/ai-readiness/aggiornamenti/${AS}`), { params: Promise.resolve({ workspaceId: WS, assessmentId: AS }) }).then(
    () => assert.fail("la rotta reindirizza o risponde «non trovata»"),
    (error: unknown) => String((error as { digest?: unknown }).digest),
  );

function reset(over: Partial<Prova> = {}) {
  Object.assign(prova, { asked: [], refuse: null, inWorkspace: true }, over);
}

test("le risposte: prima l'accesso, poi la rilevazione, poi 307 a «Raccolta» › «Persone»", async () => {
  reset();
  assert.equal(await call(answers), `NEXT_REDIRECT;replace;/dashboard/${WS}/ai-readiness?assessment=${AS}&scheda=raccolta#persone;307;`);
  assert.deepEqual(prova.asked, [`accesso:${WS}`, `rilevazione:${WS}:${AS}`]);
  assert.equal(answers.dynamic, "force-dynamic");
});

test("i risultati: 307 a «Risultati» della rilevazione", async () => {
  reset();
  assert.equal(await call(results), `NEXT_REDIRECT;replace;/dashboard/${WS}/ai-readiness?assessment=${AS};307;`);
  assert.equal(results.dynamic, "force-dynamic");
});

test("chi non può entrare non arriva mai alla rilevazione: decide l'accesso, prima di ogni lettura", async () => {
  for (const route of [answers, results]) {
    const refused = Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK;404"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    reset({ refuse: refused });
    assert.equal(await call(route), "NEXT_HTTP_ERROR_FALLBACK;404");
    assert.deepEqual(prova.asked, [`accesso:${WS}`], "nessuna lettura della rilevazione");
  }
});

test("(revisione) un link morto (rilevazione eliminata, sconosciuta o di un altro workspace): 307 alla pagina con l'avviso, sempre uguale", async () => {
  for (const route of [answers, results]) {
    reset({ inWorkspace: false });
    assert.equal(await call(route), `NEXT_REDIRECT;replace;/dashboard/${WS}/ai-readiness?assente=1;307;`, "mai una pagina vuota, mai «esiste altrove»");
  }
  const { READINESS_TEXT } = await import("./dashboard-text.ts");
  assert.equal(READINESS_TEXT.gone, "Questa rilevazione non c'è più.");
});
