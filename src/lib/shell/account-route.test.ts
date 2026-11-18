import test from "node:test";
import assert from "node:assert/strict";
import { installAppModules } from "../ai/claude-test-kit.ts";

// (Rilascio 10, PROPOSTA-10 §3.10) La rotta del foglio «Il tuo account»: solo GET; 401 senza sessione, 404 a chi non
// lavora nel workspace (anche a chi segue solo un corso) e per un id che non è un id; mai in cache; il messaggio di un
// errore non esce. Sessione, accesso e lettura finti; id inventati.

type Prova = { session: unknown; role: string | null; asked: unknown[]; fail: boolean };
const prova: Prova = { session: null, role: null, asked: [], fail: false };
(globalThis as { __accountRoute?: Prova }).__accountRoute = prova;

await installAppModules({
  "@/lib/auth": `export async function auth() { return globalThis.__accountRoute.session; }`,
  "@/lib/workspace-access": `export async function getCollaboratorAccess(userId, workspaceId) {
    const p = globalThis.__accountRoute;
    return p.role && p.role !== "learner" ? { role: p.role, workspace: { id: workspaceId } } : null; }`,
  "@/lib/shell/account-data": `export async function loadAccountSheet(i) {
    const p = globalThis.__accountRoute; p.asked.push(i);
    if (p.fail) throw new Error("dettaglio segreto");
    return { email: null, claude: null, terminal: null, granola: null }; }`,
  "@/lib/log/safe-error": `export function logSafeError() {}`,
});
const { GET } = await import("../../app/api/workspaces/[workspaceId]/account/route.ts");

const WS = "00000000-0000-4000-8000-0000000000f1";
const USER = { id: "00000000-0000-4000-8000-0000000000a1", name: "Persona", email: "persona@esempio.test", image: null, emailVerified: true };

async function call(workspaceId = WS) {
  const response = await GET(new Request(`http://localhost/api/workspaces/${workspaceId}/account`), { params: Promise.resolve({ workspaceId }) });
  return { status: response.status, cache: response.headers.get("cache-control"), body: (await response.json()) as Record<string, unknown> };
}

test("senza sessione: 401, e niente si legge", async () => {
  Object.assign(prova, { session: null, role: "analyst", asked: [], fail: false });
  const r = await call();
  assert.equal(r.status, 401);
  assert.deepEqual(prova.asked, []);
});

test("404 a chi non lavora nel workspace, a chi segue solo un corso e per un id che non è un id", async () => {
  for (const [role, workspaceId] of [[null, WS], ["learner", WS], ["analyst", "non-un-id"]] as const) {
    Object.assign(prova, { session: { user: USER }, role, asked: [], fail: false });
    const r = await call(workspaceId);
    assert.equal(r.status, 404, `${role} ${workspaceId}`);
    assert.deepEqual(prova.asked, []);
  }
});

test("chi lavora nel workspace: il foglio, per la persona in sessione e con il suo ruolo, mai in cache", async () => {
  Object.assign(prova, { session: { user: USER }, role: "function_lead", asked: [], fail: false });
  const r = await call();
  assert.equal(r.status, 200);
  assert.equal(r.cache, "private, no-store");
  assert.deepEqual(r.body, { ok: true, account: { email: null, claude: null, terminal: null, granola: null } });
  assert.deepEqual(prova.asked, [{ workspaceId: WS, user: { id: USER.id, email: USER.email, emailVerified: true }, role: "function_lead" }]);
});

test("un errore: 503 e «riprova», senza il messaggio", async () => {
  Object.assign(prova, { session: { user: USER }, role: "analyst", asked: [], fail: true });
  const r = await call();
  assert.equal(r.status, 503);
  assert.deepEqual(r.body, { ok: false, code: "riprova" });
});
