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
// connettore, il capitolo «Realizzazione» e le card della Panoramica per ruolo, la card v1 di Claude
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
let lanesModule: typeof import("../../components/use-cases/panorama-lanes.tsx");
let agentPalette: typeof import("./agents.ts").agentPalette;
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
  lanesModule = await import("../../components/use-cases/panorama-lanes.tsx");
  ({ agentPalette } = await import("./agents.ts"));
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

/** I pulsanti pieni (`[data-slot=button].bg-primary`, anche i link) di un pezzo di HTML, con il loro testo. */
function filledIn(html: string): string[] {
  return [...html.matchAll(/<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/g)]
    .filter(([, , attrs]) => /\sdata-slot="button"/.test(attrs) && (/\sclass="([^"]*)"/.exec(attrs)?.[1].split(/\s+/) ?? []).includes("bg-primary"))
    .map(([, , , body]) => body.replace(/<[^>]+>/g, "").trim());
}

/** La scheda: l'elemento della pagina e i suoi pezzi (riquadro, piega «Realizzazione»). */
async function schedaOf(person: Person, useCaseId: string) {
  signIn(person);
  const element = await detailPage({ params: Promise.resolve({ workspaceId: ids.ws, useCaseId }), searchParams: Promise.resolve({}) });
  const html = renderToStaticMarkup(element);
  return {
    element,
    html,
    box: html.slice(html.indexOf('data-slot="next-step"'), html.indexOf('data-slot="scheda-grid"')),
    fold: html.includes('id="realizzazione"') ? html.slice(html.indexOf('<details id="realizzazione"'), html.indexOf("</details>", html.indexOf('<details id="realizzazione"'))) : "",
  };
}

test("piega «Realizzazione» e riquadro: «Avvia» pieno nel riquadro quando è pronto (G9), outline nella piega quando mancano informazioni; dossier non letto: E7", opts, async () => {
  const ready = randomUUID();
  await q(
    `INSERT INTO use_cases (id, workspace_id, title, description, status, portfolio_review_status, portfolio_kind, code, source, origin, target_quarter)
     VALUES ($1::uuid, $2::uuid, $3, 'Problema', 'accepted', 'scored', 'use_case_ai', $4, 'web_proposed', 'adoption', '2027-Q1')`,
    [ready, ids.ws, `Pronta ${suffix}`, `${prefix}-0090`],
  );
  const start = `/dashboard/${ids.ws}/casi-duso/nuovo?useCaseId=${ready}`;
  const lead = await schedaOf("lsLead", ready);
  assert.match(lead.box, /data-key="G9"/);
  assert.deepEqual(filledIn(lead.html), ["Avvia la realizzazione"], "il solo pulsante pieno della pagina");
  assert.deepEqual(filledIn(lead.box), ["Avvia la realizzazione"], "nel riquadro");
  assert.ok(lead.box.includes(`href="${start}"`));
  assert.ok(lead.fold.includes("La realizzazione non è ancora partita.") && !lead.fold.includes("Avvia la realizzazione"), "la piega non lo ripete");
  const builder = await schedaOf("builder", ready);
  assert.match(builder.box, /data-key="G9"/);
  assert.ok(builder.box.includes("Tocca a Lateral Space. Da Prova H6 non serve nessuna informazione."));
  assert.deepEqual(filledIn(builder.html), [], "il revisore del cliente non avvia");
  assert.ok(!builder.html.includes("casi-duso/nuovo"));

  // Approvato per più avanti o con il trimestre finito, senza informazioni da chiedere (G3): la piega
  // dice il trimestre, non le informazioni, che il percorso dice «nessuna da chiedere».
  for (const [label, quarterValue, title] of [
    ["più avanti", null, "Approvato per più avanti"],
    ["trimestre finito", "2020-Q1", "Scegliere un nuovo trimestre"],
  ] as const) {
    const later = randomUUID();
    await q(
      `INSERT INTO use_cases (id, workspace_id, title, description, status, portfolio_review_status, portfolio_kind, code, source, origin, target_quarter)
       VALUES ($1::uuid, $2::uuid, $3, 'Problema', 'accepted', 'scored', 'use_case_ai', $4, 'web_proposed', 'adoption', $5)`,
      [later, ids.ws, `Più avanti ${suffix} ${label}`, `${prefix}-${quarterValue ? "0092" : "0091"}`, quarterValue],
    );
    const g3 = await schedaOf("lsLead", later);
    // (Rilascio 5, D51) Senza referente il riquadro chiede prima il referente (qui l'ok sui fornitori
    // manca: G4); la piega dice lo stesso che il motivo è il trimestre.
    assert.match(g3.box, /data-key="G4"/, label);
    void title;
    assert.match(g3.html, /data-step="informazioni"[\s\S]*?nessuna da chiedere/, `${label}: il percorso`);
    assert.ok(g3.fold.includes("Avvia la realizzazione") && !filledIn(g3.html).includes("Avvia la realizzazione"), `${label}: outline nella piega`);
    assert.ok(g3.fold.includes("Prima si sceglie il trimestre in «Quando»."), `${label}: il motivo è il trimestre`);
    assert.ok(!g3.fold.includes("Le informazioni non sono ancora tutte a posto."), `${label}: nessuna frase sulle informazioni`);
    await q(`DELETE FROM use_cases WHERE id = $1::uuid`, [later]);
  }

  // Un'informazione ancora da chiedere: il riquadro chiede le informazioni, «Avvia» resta outline nella piega.
  const need = randomUUID();
  await q(`INSERT INTO use_case_needs (id, workspace_id, type, title, status, owner_side) VALUES ($1::uuid, $2::uuid, 'requisito', 'Quante fatture al mese?', 'da_chiedere', 'cliente')`, [need, ids.ws]);
  await q(`INSERT INTO use_case_need_links (need_id, use_case_id) VALUES ($1::uuid, $2::uuid)`, [need, ready]);
  const pending = await schedaOf("lsLead", ready);
  assert.doesNotMatch(pending.box, /data-key="G9"/);
  assert.match(pending.box, /data-key="G[456]"/);
  assert.ok(pending.fold.includes("Avvia la realizzazione"), "nella piega");
  assert.ok(!filledIn(pending.html).includes("Avvia la realizzazione"), "outline");
  assert.ok(pending.fold.includes(`href="${start}"`) && pending.fold.includes("Le informazioni non sono ancora tutte a posto."));

  // In realizzazione con la lettura del dossier fallita: E7, niente di pieno.
  const started = await schedaOf("lsLead", ids.fromConnector);
  const view = (function find(node: unknown): { type: unknown; props: Record<string, unknown> } | null {
    if (Array.isArray(node)) return node.map(find).find(Boolean) ?? null;
    if (!node || typeof node !== "object" || !("props" in node)) return null;
    const el = node as { type: unknown; props: Record<string, unknown> };
    if (typeof el.type === "function" && (el.type as { name?: string }).name === "UseCaseDetailView") return el;
    return find(el.props.children);
  })(started.element);
  assert.ok(view, "la pagina monta UseCaseDetailView");
  const failed = renderToStaticMarkup(createElementOf(view.type, { ...view.props, result: { ...(view.props.result as object), dossierRead: "errore" }, realization: null }));
  assert.match(failed, /data-slot="next-step" data-key="E7"/);
  assert.ok(failed.includes("Il riepilogo del dossier non è disponibile ora."));
  assert.deepEqual(filledIn(failed), [], "E7: niente di pieno");
  assert.match(failed, /data-step="realizzazione" data-state="adesso"[^>]*aria-current="step"/);
  await q(`DELETE FROM use_cases WHERE id = $1::uuid`, [ready]);
});

test("Panoramica: le card dei dossier in «In realizzazione» per i revisori, con la mini barra e il contesto; sezione spenta, nessuna card", opts, async () => {
  const column = await dossiers.dossierColumnOf(ids.ws, viewer("builder", "function_lead"), [ids.fromConnector, ids.fromPage, ids.practice]);
  assert.equal(column.state, "pronta");
  assert.ok(column.state === "pronta");
  const card = column.byUseCase.get(ids.fromConnector);
  assert.equal(card?.code, `${prefix}-0001`);
  assert.equal(card?.href, `/dashboard/${ids.ws}/use-cases/${ids.fromConnector}`, "chi non apre il dossier va alla scheda");
  assert.equal(column.byUseCase.has(ids.practice), false);
  assert.deepEqual(await dossiers.dossierColumnOf(ids.ws, viewer("contributor", "contributor"), [ids.fromConnector]), { state: "nascosta" });

  const html = renderToStaticMarkup(
    createElementOf(lanesModule.PanoramaLanes, {
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
      agents: agentPalette([]),
      barScale: 0,
      dossierColumn: column,
      basePath: `/dashboard/${ids.ws}/use-cases`,
      query: { vista: "panoramica" },
      filtersActive: false,
      clearHref: `/dashboard/${ids.ws}/use-cases?vista=panoramica`,
      grouping: null,
      agentHref: () => "",
      agentFilter: null,
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

/** L'elemento `Arrival` della scheda: l'ancora a cui la pagina arriva con il suo `?capitolo=` (`initial`). */
function arrivalOf(page: unknown): string | null {
  type El = { type?: unknown; props?: Record<string, unknown> };
  const named = (node: unknown, name: string): El | null => {
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = named(child, name);
        if (found) return found;
      }
      return null;
    }
    if (!node || typeof node !== "object" || !("props" in node)) return null;
    const el = node as El;
    if (typeof el.type === "function" && (el.type as { name?: string }).name === name) return el;
    return named(el.props?.children, name);
  };
  const view = named(page, "UseCaseDetailView");
  assert.ok(view, "la pagina monta UseCaseDetailView");
  // UseCaseDetailView è un componente del server senza hook: chiamato con le sue props dà l'albero della scheda.
  const arrival = named((view.type as (props: unknown) => unknown)(view.props), "Arrival");
  assert.ok(arrival, "la scheda monta Arrival");
  return (arrival.props?.initial as string | null | undefined) ?? null;
}

/** La scheda aperta da un link (campanella, email): il riquadro, la piega «Realizzazione», dove arriva e quale piega il server apre. */
async function landingOf(person: Person, useCaseId: string, href: string) {
  signIn(person);
  const searchParams = Object.fromEntries(new URL(href, "https://app.example.test").searchParams);
  const element = await detailPage({ params: Promise.resolve({ workspaceId: ids.ws, useCaseId }), searchParams: Promise.resolve(searchParams) });
  const html = renderToStaticMarkup(element);
  const foldAt = html.indexOf('<details id="realizzazione"');
  return {
    box: html.slice(html.indexOf('data-slot="next-step"'), html.indexOf('data-slot="scheda-grid"')),
    fold: foldAt === -1 ? "" : html.slice(foldAt, html.indexOf("</details>", foldAt)),
    target: arrivalOf(element),
    opened: [...html.matchAll(/<details id="([a-z-]+)"[^>]*\sopen=""/g)].map((m) => m[1]),
  };
}

test("«Pronto da avviare»: la campanella e l'email arrivano al riquadro con «Avvia la realizzazione», anche i link già mandati; non più pronto, alla piega", opts, async () => {
  const { noticeHref } = await import("../notifications/bell.ts");
  const { cardLinkTo } = await import("./referent/links.ts");
  const ready = randomUUID();
  await q(
    `INSERT INTO use_cases (id, workspace_id, title, description, status, portfolio_review_status, portfolio_kind, code, source, origin, target_quarter)
     VALUES ($1::uuid, $2::uuid, $3, 'Problema', 'accepted', 'scored', 'use_case_ai', $4, 'web_proposed', 'adoption', '2027-Q1')`,
    [ready, ids.ws, `Pronta da avviare ${suffix}`, `${prefix}-0095`],
  );
  try {
    // Gli indirizzi di oggi: `?capitolo=realizzazione`, come nelle email già partite.
    const links = { campanella: noticeHref(ids.ws, { kind: "pronto", useCaseId: ready }), email: cardLinkTo("https://app.example.test", ids.ws, ready, "realizzazione") };
    for (const href of Object.values(links)) assert.ok(href.endsWith(`/use-cases/${ready}?capitolo=realizzazione`), href);
    for (const [variant, workspaces, label] of [
      ["sezione Casi d'uso accesa", `${ids.ws},${ids.wsOff}`, "Avvia la realizzazione"],
      ["sezione Casi d'uso spenta", ids.wsOff, "Segna come in realizzazione"],
    ] as const) {
      process.env.UC_WORKSPACE_IDS = workspaces;
      try {
        for (const [from, href] of Object.entries(links)) {
          const landing = await landingOf("lsLead", ready, href);
          assert.match(landing.box, /data-key="G9"/, `${variant}, ${from}`);
          assert.ok(landing.box.includes(label), `${variant}, ${from}: «${label}» nel riquadro`);
          assert.ok(landing.fold.includes("non ancora partita") && !landing.fold.includes(label), `${variant}, ${from}: la piega c'è e non lo ripete`);
          assert.equal(landing.target, "decisione", `${variant}, ${from}: arriva al riquadro «Prossimo passo», non alla piega senza pulsante`);
          assert.deepEqual(landing.opened, [], `${variant}, ${from}: nessuna piega aperta`);
        }
      } finally {
        process.env.UC_WORKSPACE_IDS = `${ids.ws},${ids.wsOff}`;
      }
    }
    // Il revisore del cliente (un link inoltrato): il riquadro dice «Tocca a Lateral Space.», la piega chi avvia.
    const client = await landingOf("builder", ready, links.campanella);
    assert.match(client.box, /data-key="G9"/);
    assert.equal(client.target, "realizzazione");
    assert.deepEqual(client.opened, ["realizzazione"]);
    assert.ok(client.fold.includes("La realizzazione la avvia Lateral Space."));
    // Non più pronto, il trimestre è finito: (rilascio 5, D51) il riquadro chiede prima il referente
    // (qui l'ok sui fornitori manca: G4); la piega, con «Avvia» outline e il motivo del trimestre.
    await q(`UPDATE use_cases SET target_quarter = '2020-Q1' WHERE id = $1::uuid`, [ready]);
    const expired = await landingOf("lsLead", ready, links.email);
    assert.match(expired.box, /data-key="G4"/);
    assert.equal(expired.target, "realizzazione");
    assert.deepEqual(expired.opened, ["realizzazione"]);
    assert.ok(expired.fold.includes("Avvia la realizzazione") && expired.fold.includes("Prima si sceglie il trimestre in «Quando»."));
    // Già partito (la scheda del connettore ha il suo dossier): la piega con il dossier.
    const started = await landingOf("lsLead", ids.fromConnector, noticeHref(ids.ws, { kind: "pronto", useCaseId: ids.fromConnector }));
    assert.doesNotMatch(started.box, /data-key="G9"/);
    assert.equal(started.target, "realizzazione");
    assert.deepEqual(started.opened, ["realizzazione"]);
    assert.ok(started.fold.includes("Apri il dossier"));
  } finally {
    await q(`DELETE FROM use_cases WHERE id = $1::uuid`, [ready]);
  }
});
