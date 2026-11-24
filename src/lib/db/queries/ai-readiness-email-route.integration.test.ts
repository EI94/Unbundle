import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import * as nodeModule from "node:module";

/** `module.registerHooks` di Node 24 (i tipi di @types/node del progetto non lo hanno ancora). */
type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve?(specifier: string, context: object, nextResolve: (specifier: string, context: object) => ResolveResult): ResolveResult }): void;
};

// (0044) L'indirizzo pulito delle email dell'AI Readiness con l'accesso vero, sul database del pacchetto: le due rotte
// rispondono 307 alla scheda giusta solo a chi entra nella pagina dell'AI Readiness di quel workspace (le stesse porte
// di `requireWorkspacePage`), e solo per una rilevazione di quel workspace. Chi segue un corso va ai suoi corsi, «Solo
// questo use case» all'Agent Factory, chi non è nel workspace: «non trovata». (Revisione) Un link morto (la rilevazione
// eliminata, sconosciuta o di un altro workspace) porta alla pagina con «Questa rilevazione non c'è più.», sempre allo
// stesso indirizzo: non dice mai se la rilevazione esiste in un altro workspace.
// La sessione è quella della prova (`@/lib/auth`); ruolo e accesso si leggono dal database.
// Con scripts/use-case-test/run-db-tests.mjs. Dati inventati, creati e cancellati qui.

const url = process.env.DATABASE_URL;
const enabled = process.env.HUB_TEST_ISOLATED === "true" && Boolean(url) && new URL(url!).hostname === "127.0.0.1";
const opts = { skip: !enabled };

type Row = Record<string, unknown>;
type Get = (request: Request, context: { params: Promise<{ workspaceId: string; assessmentId: string }> }) => Promise<unknown>;
let q: (text: string, params?: unknown[]) => Promise<Row[]>;
let answers: { GET: Get };
let results: { GET: Get };

const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), otherOrg: randomUUID(), ws: randomUUID(), otherWs: randomUUID(), assessment: "", otherAssessment: "" };
type Person = "lead" | "contributor" | "learner" | "caseOnly" | "outsider";
const userIds = { lead: randomUUID(), contributor: randomUUID(), learner: randomUUID(), caseOnly: randomUUID(), outsider: randomUUID() } satisfies Record<Person, string>;

function signIn(person: Person): void {
  (globalThis as { __airRouteSession?: unknown }).__airRouteSession = {
    user: { id: userIds[person], email: `${person.toLowerCase()}.rotta.${suffix}@esempio.test`, emailVerified: true, name: "Persona di prova", image: null },
  };
}

before(async () => {
  if (!enabled) return;
  const stub = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
  // La sessione della prova al posto dei cookie di Firebase.
  const stubs: Record<string, string> = { "@/lib/auth": stub("export async function auth() { return globalThis.__airRouteSession ?? null; }") };
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (Object.hasOwn(stubs, specifier)) return { url: stubs[specifier], shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Row[]>;
  const { ensureDbSchema } = await import("../ensure-schema.ts");
  await ensureDbSchema();
  const air = await import("./ai-readiness.ts");
  const app = "../../../app/(dashboard)/dashboard/[workspaceId]/ai-readiness/aggiornamenti/[assessmentId]";
  answers = (await import(`${app}/route.ts`)) as { GET: Get };
  results = (await import(`${app}/risultati/route.ts`)) as { GET: Get };

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione di prova rotta', $2), ($3, 'Altra organizzazione di prova', $4)`, [
    ids.org,
    `org-air-rotta-${suffix}`,
    ids.otherOrg,
    `org-air-altra-${suffix}`,
  ]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Cliente Demo'), ($3, $4, 'Altro cliente di prova')`, [ids.ws, ids.org, ids.otherWs, ids.otherOrg]);
  for (const person of Object.keys(userIds) as Person[]) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1, $2, 'Persona di prova', now())`, [userIds[person], `${person.toLowerCase()}.rotta.${suffix}@esempio.test`]);
  }
  await q(`INSERT INTO memberships (user_id, organization_id, role) VALUES ($1, $2, 'transformation_lead'), ($3, $4, 'transformation_lead')`, [userIds.lead, ids.org, userIds.outsider, ids.otherOrg]);
  await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'contributor'), ($1, $3, 'learner'), ($1, $4, 'esterno_caso')`, [
    ids.ws,
    userIds.contributor,
    userIds.learner,
    userIds.caseOnly,
  ]);
  const template = await air.ensureAiReadinessSystemTemplate();
  ids.assessment = (await air.createAiReadinessAssessment({ organizationId: ids.org, workspaceId: ids.ws, templateId: template.id, name: "Rilevazione di prova", status: "open" })).id;
  ids.otherAssessment = (await air.createAiReadinessAssessment({ organizationId: ids.otherOrg, workspaceId: ids.otherWs, templateId: template.id, name: "Rilevazione di un altro cliente", status: "open" }))
    .id;
});

after(async () => {
  if (!enabled) return;
  await q(`DELETE FROM workspaces WHERE id = ANY($1::uuid[])`, [[ids.ws, ids.otherWs]]);
  await q(`DELETE FROM organizations WHERE id = ANY($1::uuid[])`, [[ids.org, ids.otherOrg]]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [Object.values(userIds)]);
});

/** Il `digest` di Next della rotta: «NEXT_REDIRECT;replace;<indirizzo>;307;» o «NEXT_HTTP_ERROR_FALLBACK;404». */
async function open(route: { GET: Get }, person: Person, workspaceId: string, assessmentId: string): Promise<string> {
  signIn(person);
  try {
    await route.GET(new Request(`http://localhost:3000/dashboard/${workspaceId}/ai-readiness/aggiornamenti/${assessmentId}`), { params: Promise.resolve({ workspaceId, assessmentId }) });
  } catch (error) {
    const digest = (error as { digest?: unknown })?.digest;
    if (typeof digest === "string") return digest;
    throw error;
  }
  assert.fail("la rotta risponde sempre con un redirect o con «non trovata»");
}

const redirectTo = (target: string) => `NEXT_REDIRECT;replace;${target};307;`;
const NOT_FOUND = "NEXT_HTTP_ERROR_FALLBACK;404";

test("chi gestisce: 307 a «Raccolta» › «Persone» per le risposte, a «Risultati» per la soglia", opts, async () => {
  assert.equal(await open(answers, "lead", ids.ws, ids.assessment), redirectTo(`/dashboard/${ids.ws}/ai-readiness?assessment=${ids.assessment}&scheda=raccolta#persone`));
  assert.equal(await open(results, "lead", ids.ws, ids.assessment), redirectTo(`/dashboard/${ids.ws}/ai-readiness?assessment=${ids.assessment}`));
});

test("le porte della pagina: un collaboratore entra; chi segue un corso va ai corsi; «Solo questo use case» all'Agent Factory; chi non è nel workspace no", opts, async () => {
  // La pagina dell'AI Readiness si apre a ogni collaboratore: la rotta fa lo stesso (la pagina sceglie poi la scheda).
  assert.equal(await open(answers, "contributor", ids.ws, ids.assessment), redirectTo(`/dashboard/${ids.ws}/ai-readiness?assessment=${ids.assessment}&scheda=raccolta#persone`));
  for (const route of [answers, results]) {
    assert.equal(await open(route, "learner", ids.ws, ids.assessment), redirectTo(`/dashboard/${ids.ws}/learning`));
    assert.equal(await open(route, "caseOnly", ids.ws, ids.assessment), redirectTo(`/dashboard/${ids.ws}/agent-factory`));
    assert.equal(await open(route, "outsider", ids.ws, ids.assessment), NOT_FOUND);
  }
});

test("(revisione) un link morto: 307 alla pagina con l'avviso, uguale per una rilevazione di un altro workspace, sconosciuta, eliminata o un id sbagliato", opts, async () => {
  const gone = redirectTo(`/dashboard/${ids.ws}/ai-readiness?assente=1`);
  const deleted = (await q(`INSERT INTO ai_readiness_assessments (organization_id, workspace_id, template_id, name, status)
    SELECT organization_id, workspace_id, template_id, 'Rilevazione da eliminare', 'open' FROM ai_readiness_assessments WHERE id = $1 RETURNING id`, [ids.assessment]))[0].id as string;
  await q(`DELETE FROM ai_readiness_assessments WHERE id = $1`, [deleted]);
  for (const route of [answers, results]) {
    for (const [what, assessmentId] of [
      ["di un altro cliente", ids.otherAssessment],
      ["che non c'è", randomUUID()],
      ["eliminata", deleted],
      ["non è un id", "non-un-id"],
    ] as Array<[string, string]>) {
      assert.equal(await open(route, "lead", ids.ws, assessmentId), gone, what);
    }
    // Chi gestisce l'altro workspace, dal suo workspace: lo stesso avviso, mai la rilevazione di questo.
    assert.equal(await open(route, "outsider", ids.otherWs, ids.assessment), redirectTo(`/dashboard/${ids.otherWs}/ai-readiness?assente=1`));
  }
});
