import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { fileURLToPath } from "node:url";

// «Benefici e costi» sul database di prova (spec di Pierpaolo, 25/10/2026; drizzle/0022):
// `saveValuation` con `model` (versione alzata una volta dal trigger, Storia, null che toglie,
// errori, permessi), le letture per ruolo (`listHubItems`, `getUseCaseDetail`: il modello solo ai
// revisori) e «Ipotesi di calcolo» (`saveValueParams`: solo i manager, solo la sua chiave).
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database del pacchetto
//   hub_<id> su 127.0.0.1) gira sul database di prova; dentro `npm run check` si salta.
// - Dati sintetici, creati e cancellati qui.
const url = process.env.DATABASE_URL;
const enabled = process.env.HUB_TEST_ISOLATED === "true" && Boolean(url);
if (enabled) {
  const parsed = new URL(url!);
  if (parsed.hostname !== "127.0.0.1" || process.env.UC_TEST_DATABASE_URL !== url) {
    throw new Error("Hub DB tests need a loopback DATABASE_URL equal to UC_TEST_DATABASE_URL");
  }
  if (!/^\/hub_[a-z0-9][a-z0-9_]{0,39}$/.test(parsed.pathname)) {
    throw new Error("Run this suite only on a package database hub_<id>");
  }
  if ((globalThis.fetch as { name?: string }).name !== "localNeonFetch") {
    throw new Error("Preload scripts/uc-test/local-neon.cjs to reach the local test database");
  }
}
const opts = { skip: !enabled };

type Service = typeof import("./service.ts");
type Hub = typeof import("../db/queries/use-case-hub.ts");
type Data = typeof import("./settings-data.ts");
type Ctx = import("./service.ts").WriteContext;
type ValueModel = import("./value-model.ts").ValueModel;

let svc: Service;
let hub: Hub;
let data: Data;
let q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

const suffix = randomBytes(3).toString("hex");
const ids = {
  org: randomUUID(),
  ws: randomUUID(),
  ls: randomUUID(),
  builder: randomUUID(),
  manager: randomUUID(),
  contributor: randomUUID(),
};
const emails = {
  ls: `ls.${suffix}@ls.test`,
  builder: `builder.${suffix}@cliente.test`,
  manager: `manager.${suffix}@cliente.test`,
  contributor: `contributor.${suffix}@cliente.test`,
};
type Person = keyof typeof emails;
const ROLE: Record<Person, string> = { ls: "transformation_lead", builder: "function_lead", manager: "exec_sponsor", contributor: "contributor" };

const ENV_KEYS = ["USE_CASE_HUB_WORKSPACES", "UC_LS_EMAIL_DOMAINS", "UC_ENABLED", "UC_WORKSPACE_IDS"] as const;
const envBefore = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

const MODEL: ValueModel = {
  v: 1,
  primary: "tempo",
  components: [
    { key: "tempo", lever: "tempo", label: "Smistamento delle richieste", kind: "ore", volumeYear: 6600, minutesPerUnit: 1.5, automatablePct: 70, confidence: "ipotesi" },
    { key: "qualita", lever: "qualita", label: "Meno errori di smistamento", kind: "qualitativo", confidence: "da_misurare" },
  ],
  ease: 4,
  costs: { devDays: 4, internalHours: 16, runCostEurYear: 600 },
  confirmBy: "Responsabile di prova",
};

function as(person: Person): Ctx {
  return { workspaceId: ids.ws, actor: { userId: ids[person], role: "exec_sponsor", isLateralSpace: false, kind: "persona" }, channel: "pagina" };
}

function viewer(person: Person) {
  return { userId: ids[person], email: emails[person], emailVerified: true, role: ROLE[person], isLateralSpace: person === "ls" };
}

function ok<T>(result: { ok: true; value: T } | { ok: false; error: string; message: string }, label = "esito"): T {
  if (!result.ok) assert.fail(`${label}: atteso ok, ricevuto ${result.error} (${result.message})`);
  return result.value;
}

let codeSeq = 7000 + Math.floor(Math.random() * 2000);

async function seed(): Promise<string> {
  const id = randomUUID();
  await q(
    `INSERT INTO use_cases (id, workspace_id, title, description, status, portfolio_review_status, portfolio_kind, code, source, target_quarter, proposed_by)
     VALUES ($1::uuid, $2::uuid, 'Smistamento di prova', 'Problema di prova', 'accepted', 'scored', 'use_case_ai', $3, 'web_proposed', '2026-Q4', $4)`,
    [id, ids.ws, `XV-${String(codeSeq++).padStart(4, "0")}`, emails.builder],
  );
  return id;
}

async function row(id: string): Promise<Record<string, unknown>> {
  const [r] = await q(`SELECT version, value_model, value_eur_year FROM use_cases WHERE id = $1::uuid`, [id]);
  return r;
}

async function lastFields(id: string): Promise<string[]> {
  const rows = await q(`SELECT fields FROM use_case_events WHERE use_case_id = $1::uuid ORDER BY at DESC, id DESC LIMIT 1`, [id]);
  return (rows[0]?.fields as string[]) ?? [];
}

/** I componenti `.tsx` sotto Node: trascritti con TypeScript, come in hub-page.integration.test.ts. */
async function registerTsx(): Promise<void> {
  const { default: ts } = await import("typescript");
  const { registerHooks } = nodeModule as unknown as {
    registerHooks: (hooks: {
      load: (url: string, context: unknown, next: (url: string, context: unknown) => unknown) => unknown;
    }) => void;
  };
  registerHooks({
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
}

before(async () => {
  if (!enabled) return;
  await registerTsx();
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Record<string, unknown>[]>;
  svc = await import("./service.ts");
  hub = await import("../db/queries/use-case-hub.ts");
  data = await import("./settings-data.ts");
  process.env.USE_CASE_HUB_WORKSPACES = ids.ws;
  process.env.UC_LS_EMAIL_DOMAINS = "ls.test";
  delete process.env.UC_ENABLED;
  delete process.env.UC_WORKSPACE_IDS;

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Organizzazione di prova valore', $2)`, [ids.org, `hub-valore-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $2::uuid, 'Prova valore')`, [ids.ws, ids.org]);
  for (const person of Object.keys(emails) as Person[]) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1::uuid, $2, $3, now())`, [ids[person], emails[person], `Persona di prova ${person}`]);
    await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [ids.ws, ids[person], ROLE[person]]);
  }
});

after(async () => {
  for (const key of ENV_KEYS) {
    const value = envBefore[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (!enabled) return;
  await q(`DELETE FROM workspaces WHERE id = $1::uuid`, [ids.ws]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [Object.keys(emails).map((p) => ids[p as Person])]);
});

// ─── saveValuation con «Benefici e costi» ────────────────────────────

test("saveValuation: il modello si salva, la versione sale di uno, la Storia dice «valore» e «costo»", opts, async () => {
  const id = await seed();
  const v0 = Number((await row(id)).version);
  const card = ok(await svc.saveValuation(as("builder"), id, v0, { model: MODEL }));
  assert.equal(card.version, v0 + 1, "il trigger della 0022 alza la versione una volta");
  const saved = await row(id);
  assert.equal((saved.value_model as { confirmBy?: string }).confirmBy, "Responsabile di prova");
  assert.deepEqual((await lastFields(id)).sort(), ["costo", "valore"]);

  // Lo stesso modello: nessun cambio di modello, nessuna versione in più.
  const same = ok(await svc.saveValuation(as("builder"), id, card.version, { model: MODEL }));
  assert.equal(same.version, card.version);

  // Solo una voce cambia: «valore», non «costo». Con un'altra colonna nello stesso salvataggio, una versione sola.
  const [hours, words] = MODEL.components;
  const changed: ValueModel = { ...MODEL, components: [{ ...hours, kind: "ore", volumeYear: 6600, minutesPerUnit: 2, automatablePct: 70 }, words] };
  const next = ok(await svc.saveValuation(as("builder"), id, same.version, { model: changed, valueEurYear: 5000 }));
  assert.equal(next.version, same.version + 1);
  assert.deepEqual((await lastFields(id)).sort(), ["valore"]);

  // La versione vecchia è superata.
  const stale = await svc.saveValuation(as("builder"), id, same.version, { model: MODEL });
  assert.equal(stale.ok, false);
  assert.equal(!stale.ok && stale.error, "versione_superata");

  // null toglie il modello.
  const cleared = ok(await svc.saveValuation(as("builder"), id, next.version, { model: null }));
  assert.equal(cleared.version, next.version + 1);
  assert.equal((await row(id)).value_model, null);
});

test("saveValuation: modello non valido rifiutato con il campo; il contributore non scrive", opts, async () => {
  const id = await seed();
  const v0 = Number((await row(id)).version);
  const bad = await svc.saveValuation(as("builder"), id, v0, { model: { ...MODEL, primary: "ricavi" } });
  assert.equal(bad.ok, false);
  assert.ok(!bad.ok && bad.fieldErrors?.["model.primary"], JSON.stringify(bad));
  const denied = await svc.saveValuation(as("contributor"), id, v0, { model: MODEL });
  assert.equal(!denied.ok && denied.error, "permesso_mancante");
  assert.equal((await row(id)).value_model, null);
  assert.equal(Number((await row(id)).version), v0);
});

// ─── Letture per ruolo ───────────────────────────────────────────────

test("letture: ai revisori modello e cifre «stima», al contributore niente", opts, async () => {
  const id = await seed();
  ok(await svc.saveValuation(as("ls"), id, Number((await row(id)).version), { model: MODEL }));

  for (const person of ["ls", "builder", "manager"] as const) {
    const list = await hub.listHubItems(ids.ws, viewer(person));
    assert.ok(list && list.projection !== "contributore", person);
    const item = list.items.find((i) => i.id === id);
    assert.ok(item, person);
    assert.equal(item.valueModel?.confirmBy, "Responsabile di prova", person);
    assert.equal(item.cost?.source, "stima", person);
    assert.equal(item.cost?.amount, 560, person);
    assert.equal(item.value.benefits?.state, "contato", person);
    assert.equal(list.valueParams.hourlyCostEur, 35, person);
    const detail = await hub.getUseCaseDetail(ids.ws, id, viewer(person));
    assert.ok(detail && detail.projection !== "contributore", person);
    assert.equal(detail.useCase.valueModel?.components.length, 2, person);
  }

  const list = await hub.listHubItems(ids.ws, viewer("contributor"));
  assert.equal(list?.projection, "contributore");
  const text = JSON.stringify(list);
  for (const word of ["valueModel", "Smistamento delle richieste", "Responsabile di prova", "\"source\":\"stima\"", "valueParams"]) {
    assert.ok(!text.includes(word), `«${word}» non arriva al contributore`);
  }
  const detail = await hub.getUseCaseDetail(ids.ws, id, viewer("contributor"));
  assert.ok(detail);
  assert.ok(!JSON.stringify(detail).includes("Responsabile di prova"));
});

// ─── «Ipotesi di calcolo» ────────────────────────────────────────────

test("saveValueParams: solo i manager; cambia solo config.valueParams; le cifre si rileggono con le ipotesi nuove", opts, async () => {
  const id = await seed();
  ok(await svc.saveValuation(as("ls"), id, Number((await row(id)).version), { model: MODEL }));
  const texts = {
    hourlyCostEur: "70",
    dayCostEur: "500",
    midValueEur: "15.000",
    highValueEur: "50.000",
    buildMonths: "2",
    rampMonths: "3",
    horizonMonths: "24",
    originMonth: "",
    includeUnmeasured: false,
  };
  for (const person of ["builder", "contributor"] as const) {
    const refused = await data.saveValueParams(ids[person], ids.ws, texts);
    assert.equal(!refused.ok && refused.error, "permesso_mancante", person);
  }
  // Una chiave del config che deve restare.
  await data.saveThresholds(ids.manager, ids.ws, { highImpact: "3,5", costLowBand: "2" });
  const versionBefore = Number((await row(id)).version);
  const saved = ok(await data.saveValueParams(ids.manager, ids.ws, texts));
  assert.equal(saved.valueParams.hourlyCostEur, 70);
  assert.equal(saved.storedOriginMonth, null);
  const [config] = await q(`SELECT config FROM workspace_scoring_models WHERE workspace_id = $1::uuid`, [ids.ws]);
  const stored = config.config as { valueParams?: Record<string, unknown>; thresholds?: Record<string, unknown> };
  assert.equal(stored.valueParams?.hourlyCostEur, 70);
  assert.equal("originMonth" in (stored.valueParams ?? {}), false, "il mese vuoto non si salva");
  assert.equal(stored.thresholds?.costLowBand, 2, "le soglie restano");
  assert.equal(Number((await row(id)).version), versionBefore, "nessuna scrittura sulle schede");

  const invalid = await data.saveValueParams(ids.manager, ids.ws, { ...texts, midValueEur: "60.000" });
  assert.ok(!invalid.ok && invalid.fieldErrors?.midValueEur);

  const list = await hub.listHubItems(ids.ws, viewer("builder"));
  assert.ok(list && list.projection !== "contributore");
  const item = list.items.find((i) => i.id === id)!;
  // 115,5 h × 70 € = 8.085 €; avvio 4 giorni × 500 € + 16 h × 70 € = 3.120 €.
  assert.ok(Math.abs((item.value.benefits?.benefitEur ?? 0) - 8085) < 1e-6);
  assert.equal(item.cost?.amount, 3120);
  const settings = await data.loadValuationSettings(ids.ws);
  assert.equal(settings?.valueParams.dayCostEur, 500);
});

// ─── Componenti resi in HTML ─────────────────────────────────────────

test("HTML: editor «Benefici e costi», cifre della riga e riquadro «Ipotesi di calcolo»", opts, async () => {
  // Le ipotesi predefinite (la prova di prima le ha cambiate).
  ok(
    await data.saveValueParams(ids.manager, ids.ws, {
      hourlyCostEur: "35",
      dayCostEur: "0",
      midValueEur: "15.000",
      highValueEur: "50.000",
      buildMonths: "2",
      rampMonths: "3",
      horizonMonths: "24",
      originMonth: "",
      includeUnmeasured: false,
    }),
  );
  const id = await seed();
  ok(await svc.saveValuation(as("ls"), id, Number((await row(id)).version), { model: MODEL }));
  const detail = await hub.getUseCaseDetail(ids.ws, id, viewer("builder"));
  assert.ok(detail && detail.projection !== "contributore");
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string };
  const { ValueModelEditor } = await import("../../components/use-cases/detail/value-model-editor.tsx");
  const { draftFromModel } = await import("../../components/use-cases/detail/value-model-draft.ts");
  const { RowFigures } = await import("../../components/use-cases/use-case-row.tsx");
  const { ValueFigure } = await import("../../components/use-cases/value-figure.tsx");
  const { CostFigure } = await import("../../components/use-cases/cost-figure.tsx");
  const { ValueParamsSummary } = await import("../../components/use-cases/value-params-summary.tsx");

  const editor = renderToStaticMarkup(
    createElement(ValueModelEditor, { draft: draftFromModel(detail.useCase.valueModel), errors: {}, params: detail.valueParams, onChange: () => {} }),
  );
  assert.match(editor, /Benefici e costi/);
  assert.match(editor, /116 h · 4\.043 €/, "la riga calcolata della voce a ore");
  assert.match(editor, /Contati: 116 h · 4\.043 € all&#x27;anno/);
  assert.match(editor, /avvio 560 € · ricorrenti 600 €\/anno/);
  assert.match(editor, /Avanzate/);
  assert.equal((editor.match(/data-slot="value-component"/g) ?? []).length, 2);

  const empty = renderToStaticMarkup(createElement(ValueModelEditor, { draft: draftFromModel(null), errors: {}, params: detail.valueParams, onChange: () => {} }));
  assert.match(empty, /Aggiungi una voce/);
  assert.doesNotMatch(empty, /Ritorno principale|Avanzate/, "senza voci solo «Aggiungi una voce»");

  const figures = renderToStaticMarkup(createElement(RowFigures, { item: detail.useCase }));
  // Con una cifra in euro la riga scrive solo la cifra, senza la parola (rilascio «Pulizia»).
  assert.match(figures.replace(/<[^>]+>/g, ""), /Valore: 4\.043 €\/anno/);
  assert.doesNotMatch(figures, /Basso/);
  // Nella riga stretta il Valore va a capo solo dopo «·»: la cifra resta intera.
  assert.ok(figures.includes('<span class="whitespace-nowrap">4.043 €/anno</span>'), figures);
  assert.match(figures, /avvio 560 € · ricorrenti 600 €\/anno/);
  assert.match(figures, /data-cost-source="stima"/);
  assert.doesNotMatch(figures, /data-source="stima"/, "nella riga la cifra del modello va senza fonte");

  const longValue = renderToStaticMarkup(createElement(ValueFigure, { value: detail.useCase.value, form: "lunga" }));
  const long = renderToStaticMarkup(createElement("div", null, createElement(ValueFigure, { value: detail.useCase.value, form: "lunga" }), createElement(CostFigure, { cost: detail.useCase.cost, form: "lunga" })));
  // La cifra grande: solo gli euro all'anno, senza parola né punteggio, scritti una volta sola.
  assert.doesNotMatch(long, /Basso/);
  assert.doesNotMatch(long, /1,4/);
  assert.match(long, /4\.043 € all&#x27;anno/);
  assert.match(long, /stima del team/);
  assert.equal((longValue.match(/data-source=/g) ?? []).length, 1, longValue);

  const summary = renderToStaticMarkup(createElement(ValueParamsSummary, { params: detail.valueParams }));
  assert.match(summary, /Ipotesi di calcolo/);
  assert.match(summary, /Costo di un&#x27;ora di lavoro/);
  assert.doesNotMatch(summary, /<details[^>]* open/, "chiuso di partenza");
});
