import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { fileURLToPath } from "node:url";

/** `module.registerHooks` di Node 24 (i tipi di @types/node del progetto non lo hanno ancora). */
type ResolveResult = { url: string; shortCircuit?: boolean };
type LoadResult = { format?: string; source?: string | Uint8Array; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: {
    resolve?(specifier: string, context: object, nextResolve: (specifier: string, context: object) => ResolveResult): ResolveResult;
    load?(url: string, context: object, nextLoad: (url: string, context: object) => LoadResult): LoadResult;
  }): void;
};

// Il collegamento tra use case e dossier (docs/use-case/PIANO-LAVORI.md H6a e H6i; docs/use-case/
// DESIGN.md §6.5, §4.5, §9.7, §10.4; decisione di Pierpaolo del 19/10/2026): «Avvia la
// realizzazione» dalla pagina con la riga di Storia e il dossier precompilato da una scheda del
// connettore, il capitolo «Realizzazione» e le card della Roadmap per ruolo, la card v1 di Claude
// chiusa nei workspace accesi.
//
// Solo con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database del pacchetto
// hub_<id> su 127.0.0.1, con le tabelle uc della 0018): `@/lib/auth` è la sessione scelta dalla
// prova, `next/cache` e `after()` registrano e basta. Dentro `npm run check` si salta. Dati
// sintetici, creati e cancellati qui.
const url = process.env.DATABASE_URL;
const enabled = process.env.HUB_TEST_ISOLATED === "true" && Boolean(url);
if (enabled) {
  const parsed = new URL(url!);
  if (parsed.hostname !== "127.0.0.1" || process.env.UC_TEST_DATABASE_URL !== url) {
    throw new Error("Hub DB tests need a loopback DATABASE_URL equal to UC_TEST_DATABASE_URL");
  }
  if (!/^\/hub_[a-z0-9][a-z0-9_]{0,39}$/.test(parsed.pathname)) throw new Error("Run this suite only on a package database hub_<id>");
  if ((globalThis.fetch as { name?: string }).name !== "localNeonFetch") {
    throw new Error("Preload scripts/uc-test/local-neon.cjs to reach the local test database");
  }
}
const opts = { skip: !enabled };

type PageProps = { params: Promise<Record<string, string>>; searchParams?: Promise<Record<string, string>> };
type Page = (props: PageProps) => Promise<unknown>;
type StartResult = { ok: boolean; message?: string | null; value?: { caseId: string; code: string } } & Record<string, unknown>;

let q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
let startAction: (workspaceId: string, input: unknown) => Promise<StartResult>;
let createV1Token: (workspaceId: string, prev: unknown, formData: FormData) => Promise<{ ok: boolean; message?: string | null }>;
let dossiers: typeof import("../db/queries/use-case-dossiers.ts");
let detailPage: Page;
let roadmapModule: typeof import("../../components/use-cases/roadmap-view.tsx");
let renderToStaticMarkup: (element: unknown) => string;
let createElementOf: (type: unknown, props: Record<string, unknown> | null) => unknown;

const suffix = randomBytes(3).toString("hex");
const ids = {
  org: randomUUID(),
  ws: randomUUID(),
  wsOff: randomUUID(),
  lsLead: randomUUID(),
  builder: randomUUID(),
  manager: randomUUID(),
  contributor: randomUUID(),
  fromConnector: randomUUID(),
  fromPage: randomUUID(),
  practice: randomUUID(),
};
const emails = {
  lsLead: `h6-lslead.${suffix}@ls.test`,
  builder: `h6-builder.${suffix}@cliente.test`,
  manager: `h6-manager.${suffix}@cliente.test`,
  contributor: `h6-contrib.${suffix}@cliente.test`,
};
type Person = keyof typeof emails;
const prefix = `H${String.fromCharCode(65 + Math.floor(Math.random() * 26))}${String.fromCharCode(65 + Math.floor(Math.random() * 26))}`;
const state = globalThis as { __hubH6Session?: unknown };
const ENV_KEYS = ["USE_CASE_HUB_WORKSPACES", "UC_LS_EMAIL_DOMAINS", "UC_ENABLED", "UC_WORKSPACE_IDS", "VERCEL_ENV"] as const;
const envBefore = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const exampleText = readFileSync(new URL("../../../templates/uc/esempio.minimo/1.0.0.json", import.meta.url), "utf8");
let templateId = "";

function signIn(person: Person | null): void {
  state.__hubH6Session = person ? { user: { id: ids[person], email: emails[person], emailVerified: true, name: `Persona ${person}`, image: null } } : null;
}

function viewer(person: Person, role: string) {
  return { userId: ids[person], role };
}

function start(useCaseId: string) {
  return startAction(ids.ws, { useCaseId, templateId, title: "Fatture dalla casella", oneLiner: "Le fatture arrivano per email." });
}

before(async () => {
  if (!enabled) return;
  const { default: ts } = await import("typescript");
  const stub = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
  const stubs: Record<string, string> = {
    "@/lib/auth": stub("export async function auth() { return globalThis.__hubH6Session ?? null; }"),
    "next/cache": stub(
      "export function revalidatePath() {}\nexport function revalidateTag() {}\nexport function refresh() {}\nexport function updateTag() {}\n" +
        "export function unstable_cache(fn) { return fn; }\nexport function unstable_noStore() {}",
    ),
    // Fuori da una richiesta `after()` non c'è: i lavori dopo la risposta qui non servono.
    "next/server": stub("export function after() {}\nexport const NextResponse = {};\nexport class NextRequest {}"),
  };
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (Object.hasOwn(stubs, specifier)) return { url: stubs[specifier], shortCircuit: true };
      return nextResolve(specifier, context);
    },
    load(moduleUrl, context, nextLoad) {
      if (!moduleUrl.startsWith("file:") || !moduleUrl.endsWith(".tsx")) return nextLoad(moduleUrl, context);
      const file = fileURLToPath(moduleUrl);
      const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
        fileName: file,
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
      });
      return { format: "module", source: outputText, shortCircuit: true };
    },
  });

  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Record<string, unknown>[]>;

  process.env.USE_CASE_HUB_WORKSPACES = ids.ws;
  process.env.UC_LS_EMAIL_DOMAINS = "ls.test";
  process.env.UC_ENABLED = "true";
  process.env.UC_WORKSPACE_IDS = `${ids.ws},${ids.wsOff}`;
  delete process.env.VERCEL_ENV;

  startAction = (await import("../actions/uc-realization.ts")).startRealizationAction as unknown as typeof startAction;
  createV1Token = (await import("../actions/workspace-integrations.ts")).createClaudeMcpTokenAction as unknown as typeof createV1Token;
  dossiers = await import("../db/queries/use-case-dossiers.ts");
  detailPage = (await import("../../app/(dashboard)/dashboard/[workspaceId]/use-cases/[useCaseId]/page.tsx")).default as Page;
  roadmapModule = await import("../../components/use-cases/roadmap-view.tsx");
  const { createElement } = await import("react");
  createElementOf = (type, props) => createElement(type as never, props as never);
  const { renderToStaticMarkup: toHtml } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string };
  const { AppRouterContext } = (await import("next/dist/shared/lib/app-router-context.shared-runtime.js")) as unknown as {
    AppRouterContext: import("react").Context<object | null>;
  };
  const router = { push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {} };
  renderToStaticMarkup = (element) => toHtml(createElement(AppRouterContext.Provider, { value: router }, element as never));

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Organizzazione di prova H6', $2)`, [ids.org, `hub-h6-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $3::uuid, 'Prova H6'), ($2::uuid, $3::uuid, 'Prova H6 spento')`, [ids.ws, ids.wsOff, ids.org]);
  for (const person of Object.keys(emails) as Person[]) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1::uuid, $2, $3, now())`, [ids[person], emails[person], `Persona ${person}`]);
  }
  // Chi gestisce è dell'organizzazione (le integrazioni le gestisce l'organizzazione); gli altri del workspace.
  await q(`INSERT INTO memberships (user_id, organization_id, role) VALUES ($1::uuid, $2::uuid, 'exec_sponsor')`, [ids.manager, ids.org]);
  for (const [person, role] of [["lsLead", "transformation_lead"], ["builder", "function_lead"], ["contributor", "contributor"]] as const) {
    await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [ids.ws, ids[person], role]);
  }
  await q(
    `INSERT INTO workspace_connector_configs (workspace_id, slug, code_prefix, guide) VALUES ($1::uuid, $2, $3, $4::jsonb)`,
    [ids.ws, `hub-h6-${suffix}`, prefix, JSON.stringify({ areas: [{ id: "amministrazione", label: "Amministrazione e finanza" }], tools: [{ id: "erp", label: "Gestionale" }] })],
  );

  const { planTemplateLoad } = await import("../uc/template/load.ts");
  const { applyTemplateLoad } = await import("../db/queries/uc-templates.ts");
  const { createUcExecutor } = await import("../db/uc-executor.ts");
  const value = JSON.parse(exampleText) as Record<string, unknown>;
  value.key = `prova.hub_h6_${suffix}`;
  const plan = planTemplateLoad(JSON.stringify(value), { restrictToWorkspaceId: ids.ws });
  assert.ok(plan.ok);
  const loaded = await applyTemplateLoad(createUcExecutor(sql), plan.plan, { actorUserId: ids.lsLead, publish: true });
  assert.ok(loaded.ok, loaded.ok ? "" : loaded.message);
  templateId = loaded.value.templateId;

  const insert = (id: string, code: string, kind: string, intake: Record<string, unknown> | null) =>
    q(
      `INSERT INTO use_cases (id, workspace_id, title, description, flow_description, status, portfolio_review_status, portfolio_kind, code, intake, source, proposed_by, origin, target_quarter)
       VALUES ($1::uuid, $2::uuid, $3, 'Le fatture arrivano per email. Ogni mese ne perdiamo qualcuna.', 'Claude legge la casella e prepara la registrazione.',
         'accepted', 'scored', $4, $5, $6::jsonb, 'web_proposed', $7, 'adoption', '2027-Q1')`,
      [id, ids.ws, `Fatture ${code}`, kind, code, intake ? JSON.stringify(intake) : null, emails.contributor],
    );
  await insert(ids.fromConnector, `${prefix}-0001`, "use_case_ai", {
    contractVersion: 2,
    area: "amministrazione",
    tools: ["erp", "posta_elettronica"],
    submitterEmail: emails.contributor,
  });
  await insert(ids.fromPage, `${prefix}-0002`, "use_case_ai", null);
  await insert(ids.practice, `${prefix}-0003`, "best_practice", null);
});

after(async () => {
  signIn(null);
  for (const key of ENV_KEYS) {
    const value = envBefore[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (!enabled) return;
  await q(`DELETE FROM uc_templates WHERE key = $1`, [`prova.hub_h6_${suffix}`]).catch(() => {});
  await q(`DELETE FROM workspaces WHERE id = ANY($1::uuid[])`, [[ids.ws, ids.wsOff]]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [Object.keys(emails).map((p) => ids[p as Person])]);
});

async function dossierOf(useCaseId: string) {
  return q(`SELECT id::text AS id, code, title, one_liner, description, setup_completed_at IS NOT NULL AS complete FROM uc_cases WHERE portfolio_use_case_id = $1::uuid`, [useCaseId]);
}

async function storyOf(useCaseId: string) {
  return q(`SELECT action, channel, actor_user_id::text AS actor, phase_before, phase_after FROM use_case_events WHERE use_case_id = $1::uuid ORDER BY at, id`, [useCaseId]);
}

test("«Avvia la realizzazione»: solo Lateral Space, solo uno use case «Da costruire» approvato senza dossier", opts, async () => {
  signIn("builder");
  const client = await start(ids.fromPage);
  assert.equal(client.ok, false, "un revisore del cliente non avvia");
  signIn("lsLead");
  const practice = await start(ids.practice);
  assert.equal(practice.ok, false, "una best practice non ha un dossier");
  assert.equal((await dossierOf(ids.fromPage)).length + (await dossierOf(ids.practice)).length, 0);
  assert.equal((await storyOf(ids.practice)).filter((e) => e.action === "realizzazione_avviata").length, 0);
});

test("avvio da una scheda del connettore: codice dello use case, dati raccolti da Claude in sola lettura, una riga di Storia", opts, async () => {
  signIn("lsLead");
  const started = await start(ids.fromConnector);
  assert.equal(started.ok, true, String(started.message));
  const [dossier, ...more] = await dossierOf(ids.fromConnector);
  assert.equal(more.length, 0);
  assert.equal(dossier.code, `${prefix}-0001`, "il dossier prende il codice dello use case");
  assert.equal(dossier.complete, true);
  const description = dossier.description as Record<string, unknown>;
  assert.deepEqual(description.dati_raccolti_da_Claude, {
    problema: "Le fatture arrivano per email. Ogni mese ne perdiamo qualcuna.",
    soluzione: "Claude legge la casella e prepara la registrazione.",
    area: "Amministrazione e finanza",
    strumenti: "Gestionale, posta elettronica",
  });
  assert.ok(!JSON.stringify(dossier).includes(emails.contributor), "il proponente non entra nel dossier");

  const story = (await storyOf(ids.fromConnector)).filter((e) => e.action === "realizzazione_avviata");
  assert.equal(story.length, 1);
  assert.equal(story[0].channel, "pagina");
  assert.equal(story[0].actor, ids.lsLead);
  assert.match(String(story[0].phase_before), /^approvato\./);
  assert.match(String(story[0].phase_after), /^in_realizzazione\./);

  // Un secondo avvio sullo stesso use case è rifiutato; la Storia non cambia.
  const again = await start(ids.fromConnector);
  assert.equal(again.ok, false);
  assert.equal(again.message, "Questo use case ha già un dossier.");
  assert.equal((await dossierOf(ids.fromConnector)).length, 1);
  assert.equal((await storyOf(ids.fromConnector)).filter((e) => e.action === "realizzazione_avviata").length, 1);
});

test("avvio da una scheda della pagina: nessun blocco di Claude; la scheda del connettore precompila «In una frase»", opts, async () => {
  assert.equal(await dossiers.realizationPrefillOf(ids.ws, ids.fromPage), null);
  const prefill = await dossiers.realizationPrefillOf(ids.ws, ids.fromConnector);
  assert.equal(prefill?.oneLiner, "Le fatture arrivano per email. Ogni mese ne perdiamo qualcuna.");
  assert.equal(await dossiers.realizationPrefillOf(ids.wsOff, ids.fromConnector), null, "solo nel suo workspace");
  signIn("lsLead");
  const started = await start(ids.fromPage);
  assert.equal(started.ok, true, String(started.message));
  const [dossier] = await dossierOf(ids.fromPage);
  assert.equal((dossier.description as Record<string, unknown>).dati_raccolti_da_Claude, undefined);
});

test("capitolo «Realizzazione»: riepilogo per ogni revisore, «Apri il dossier» solo a chi lo apre, niente ai contributori", opts, async () => {
  const lead = await dossiers.realizationOfUseCase(ids.ws, viewer("lsLead", "transformation_lead"), ids.fromConnector);
  assert.equal(lead?.state, "avviata");
  assert.ok(lead?.state === "avviata" && lead.dossier.href?.includes("/casi-duso/"), "chi ha avviato è membro del dossier");
  const builder = await dossiers.realizationOfUseCase(ids.ws, viewer("builder", "function_lead"), ids.fromConnector);
  assert.equal(builder?.state, "avviata");
  assert.equal(builder?.state === "avviata" ? builder.dossier.href : "x", null, "un revisore non membro non riceve il link");
  assert.deepEqual(await dossiers.realizationOfUseCase(ids.ws, viewer("contributor", "contributor"), ids.fromConnector), { state: "nascosta" });

  signIn("builder");
  const page = await detailPage({ params: Promise.resolve({ workspaceId: ids.ws, useCaseId: ids.fromConnector }), searchParams: Promise.resolve({}) });
  const html = renderToStaticMarkup(page);
  const chapter = html.slice(html.indexOf('data-slot="section-realization"'));
  assert.match(chapter, /data-variant="riepilogo"/);
  for (const text of ["Costo di realizzazione", "Beneficio all&#x27;anno", "Pareggio", "Il dossier lo vedono i suoi membri e chi gestisce il workspace."]) {
    assert.ok(chapter.includes(text), text);
  }
  assert.ok(!chapter.includes("Apri il dossier"), "niente link per chi non apre il dossier");

  signIn("lsLead");
  const leadHtml = renderToStaticMarkup(await detailPage({ params: Promise.resolve({ workspaceId: ids.ws, useCaseId: ids.fromConnector }), searchParams: Promise.resolve({}) }));
  assert.ok(leadHtml.slice(leadHtml.indexOf('data-slot="section-realization"')).includes("Apri il dossier"));

  signIn("contributor");
  const own = renderToStaticMarkup(await detailPage({ params: Promise.resolve({ workspaceId: ids.ws, useCaseId: ids.fromConnector }), searchParams: Promise.resolve({}) }));
  assert.ok(!own.includes("section-realization") && !own.includes("Costo di realizzazione"), "il contributore non riceve il capitolo");
});

test("Roadmap: le card dei dossier in «In realizzazione» per i revisori, con la mini barra e il contesto; sezione spenta, nessuna card", opts, async () => {
  const column = await dossiers.dossierColumnOf(ids.ws, viewer("builder", "function_lead"), [ids.fromConnector, ids.fromPage, ids.practice]);
  assert.equal(column.state, "pronta");
  assert.ok(column.state === "pronta");
  const card = column.byUseCase.get(ids.fromConnector);
  assert.equal(card?.code, `${prefix}-0001`);
  assert.equal(card?.href, `/dashboard/${ids.ws}/use-cases/${ids.fromConnector}`, "chi non apre il dossier va alla scheda");
  assert.equal(column.byUseCase.has(ids.practice), false);
  assert.deepEqual(await dossiers.dossierColumnOf(ids.ws, viewer("contributor", "contributor"), [ids.fromConnector]), { state: "nascosta" });

  const html = renderToStaticMarkup(
    createElementOf(roadmapModule.RoadmapView, {
      items: [
        {
          id: ids.fromConnector,
          code: `${prefix}-0001`,
          title: `Fatture ${prefix}-0001`,
          origin: "adoption",
          kind: "da_costruire",
          phase: "in_realizzazione",
          subState: "dossier",
          phaseLabel: "In realizzazione",
          tone: "blu",
          dossier: { caseId: card!.caseId, code: `${prefix}-0001`, status: "bozza", readiness: null },
        },
      ],
      today: "2026-10-20",
      showTiles: false,
      dossierColumn: column,
      basePath: `/dashboard/${ids.ws}/use-cases`,
      query: { vista: "roadmap" },
      filtersActive: false,
      clearHref: `/dashboard/${ids.ws}/use-cases?vista=roadmap`,
    }),
  );
  assert.ok(html.includes('data-slot="dossier-card"'), "la card del dossier");
  assert.ok(html.includes(`${prefix}-0001`));

  process.env.UC_WORKSPACE_IDS = ids.wsOff;
  try {
    assert.deepEqual(await dossiers.dossierColumnOf(ids.ws, viewer("builder", "function_lead"), [ids.fromConnector]), { state: "spenta" });
    assert.deepEqual(await dossiers.realizationOfUseCase(ids.ws, viewer("builder", "function_lead"), ids.fromConnector), { state: "spenta" });
  } finally {
    process.env.UC_WORKSPACE_IDS = `${ids.ws},${ids.wsOff}`;
  }
});

test("indice unico e dossierLinksReady: un solo dossier per scheda; vero con ogni dossier collegato, falso con un orfano", opts, async () => {
  const [{ ok }] = await q(`SELECT to_regclass('public.uc_cases_portfolio_use_case_unique_idx') IS NOT NULL AS ok`);
  assert.equal(ok, true);
  const [dossier] = await dossierOf(ids.fromPage);
  await assert.rejects(q(`UPDATE uc_cases SET portfolio_use_case_id = $2::uuid WHERE id = $1::uuid`, [dossier.id, ids.fromConnector]), (error: unknown) =>
    /uc_cases_portfolio_use_case_unique_idx/.test(String((error as Error).message) + String((error as { constraint?: string }).constraint)),
  );
  const ready = await dossiers.dossierLinksReady(ids.ws);
  assert.deepEqual(ready, { ok: true, ready: true });
  await q(`UPDATE uc_cases SET portfolio_use_case_id = NULL WHERE id = $1::uuid`, [dossier.id]);
  try {
    assert.deepEqual(await dossiers.dossierLinksReady(ids.ws), { ok: true, ready: false });
  } finally {
    await q(`UPDATE uc_cases SET portfolio_use_case_id = $2::uuid WHERE id = $1::uuid`, [dossier.id, ids.fromPage]);
  }
});

test("card v1 «Claude per Unbundle»: nessun token nuovo in un workspace acceso, anche chiamando l'action", opts, async () => {
  signIn("manager");
  const form = new FormData();
  form.set("label", "Claude team");
  const refused = await createV1Token(ids.ws, { ok: true }, form);
  assert.equal(refused.ok, false);
  assert.equal(refused.message, "Per proporre con Claude ora si usa il connettore «Unbundle».");
  const [{ n }] = await q(`SELECT count(*)::int AS n FROM workspace_integration_tokens WHERE workspace_id = $1::uuid`, [ids.ws]);
  assert.equal(n, 0);
});
