import test from "node:test";
import assert from "node:assert/strict";
import { installAppModules } from "../ai/claude-test-kit.ts";

// (Rilascio 10, PROPOSTA-10 §3.10) La rotta del foglio «Il tuo account»: solo GET; 401 senza sessione, 404 a chi non
// lavora nel workspace (anche a chi segue solo un corso) e per un id che non è un id; mai in cache; il messaggio di un
// errore non esce. Sessione, accesso e lettura finti; id inventati.

type Prova = { session: unknown; role: string | null; asked: unknown[]; fail: boolean; opts?: unknown };
const prova: Prova = { session: null, role: null, asked: [], fail: false };
(globalThis as { __accountRoute?: Prova }).__accountRoute = prova;

await installAppModules({
  "@/lib/auth": `export async function auth() { return globalThis.__accountRoute.session; }`,
  // La porta come quella vera (\`workspaceDoor\`): i cinque collaboratori; «Solo questo use case» solo con l'opzione.
  "@/lib/workspace-access": `export async function getCollaboratorAccess(userId, workspaceId, opts = {}) {
    const p = globalThis.__accountRoute; p.opts = opts;
    const collaborators = ["exec_sponsor", "transformation_lead", "function_lead", "analyst", "contributor"];
    const open = collaborators.includes(p.role) || (p.role === "esterno_caso" && opts.allowCaseOnly === true);
    return open ? { role: p.role, workspace: { id: workspaceId } } : null; }`,
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

test("404 a chi non lavora nel workspace, a chi segue solo un corso, a un ruolo sconosciuto e per un id che non è un id", async () => {
  for (const [role, workspaceId] of [[null, WS], ["learner", WS], ["ruolo_inventato", WS], ["analyst", "non-un-id"]] as const) {
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

test("(8.0d) «Solo questo use case»: la porta lo dichiara, e il foglio si legge con il suo ruolo (che gli dà solo il terminale)", async () => {
  Object.assign(prova, { session: { user: USER }, role: "esterno_caso", asked: [], fail: false, opts: undefined });
  const r = await call();
  assert.equal(r.status, 200);
  assert.deepEqual(prova.opts, { allowCaseOnly: true });
  assert.deepEqual(prova.asked, [{ workspaceId: WS, user: { id: USER.id, email: USER.email, emailVerified: true }, role: "esterno_caso" }]);
});

test("(8.0d) il guscio fa leggere il foglio ai collaboratori e a «Solo questo use case»; chi segue un corso ha il solo tema", async () => {
  const { readFileSync } = await import("node:fs");
  const layout = readFileSync(new URL("../../app/(dashboard)/dashboard/[workspaceId]/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /accountData=\{collaborator \|\| caseOnly\}/);
  assert.match(layout, /const collaborator = isCollaboratorRole\(access\.role\);/);
});
