import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { pathToFileURL } from "node:url";
import { installAppModules } from "../../lib/ai/claude-test-kit.ts";
import { enableTsxImports } from "../use-cases/detail/referent/tsx-test-loader.ts";
import { filledButtons, folds, visibleText, wordCount } from "../../lib/learning/render-test-kit.ts";
import { mountClient } from "../../lib/learning/client-render-test-kit.ts";
import { serverPayload, trackAppComponents, trackedServerComponents } from "../../lib/learning/server-payload-test-kit.ts";
import { findHubForbiddenIn } from "../../lib/use-cases/copy-guard.ts";
import { AI_READINESS_SYSTEM_TEMPLATE } from "../../lib/ai-readiness/default-template.ts";

// (Rilascio 10, ondata 7b, docs/ui-10/PROPOSTA-10.md §3.9; audit «Fuori» §5.1-5.4, §8.4) La dashboard AI Readiness e la
// pagina «Domande» rese in HTML, con i dati finti al posto del database: un solo pulsante pieno che segue lo stato,
// quattro schede al loro indirizzo, le parole contate con le pieghe chiuse (circa 120 a zero risposte, circa 350 con i
// dati, prima 900 e 1.900), niente inglese né codici, ogni controllo solo a chi lo può usare. Dati inventati.

type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve?(specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: object) => ResolveResult): ResolveResult }): void;
};

const WS = "00000000-0000-4000-8000-0000000000f7";
const AS = "00000000-0000-4000-8000-0000000000a7";
const OTHER = "00000000-0000-4000-8000-0000000000b7";

type Fake = Record<string, unknown>;
const fake: Fake = {};
(globalThis as { __readinessFake?: Fake }).__readinessFake = fake;

const read = (name: string) => `(...args) => globalThis.__readinessFake.${name}(...args)`;
await installAppModules({
  "@/lib/auth/require-workspace": `export async function requireWorkspacePage() { return globalThis.__readinessFake.access; }`,
  "@/lib/db/queries/ai-readiness": [
    "ensureAiReadinessSystemTemplate",
    "listAssessmentsByWorkspace",
    "getAssessmentBundleById",
    "getAiReadinessDashboard",
    "listRespondentsByAssessment",
    "listUseCaseSubmissionsByAssessment",
    "listAiReadinessExports",
    "listAiReadinessInsights",
    "listResponsesByAssessment",
    "templateDefinitionFromRow",
  ]
    .map((name) => `export const ${name} = ${read(name)};`)
    .join("\n"),
  "@/lib/actions/ai-readiness": [
    "createAiReadinessAssessmentAction",
    "updateAiReadinessAssessmentStatusAction",
    "deleteAiReadinessAssessmentAction",
    "updateAiReadinessThresholdAction",
    "customizeAssessmentQuestionAction",
    "generateAiReadinessOpenLinkAction",
    "copyAiReadinessOpenLinkAction",
    "createAiReadinessRespondentInviteAction",
    "recomputeAiReadinessScoresAction",
    "generateAiReadinessInsightsAction",
    "updateAiReadinessInsightStatusAction",
    "promoteAiReadinessUseCaseToPortfolioAction",
  ]
    .map((name) => `export async function ${name}() { return { ok: true }; }`)
    .join("\n"),
});
await enableTsxImports();
// Il router finto: `replace` e `push` li racconta a `fake.onNavigate`, per seguire le ancore di prima nel browser.
const routerStub = `data:text/javascript,${encodeURIComponent(
  "const go = (kind) => (href) => globalThis.__readinessFake.onNavigate?.(kind, href); const router = { push: go('push'), replace: go('replace'), refresh() {}, back() {}, prefetch() {} }; export function useRouter() { return router; } export function usePathname() { return '/'; }",
)}`;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/navigation" && context.parentURL?.includes("/components/ai-readiness/")) return { url: routerStub, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

// Prima di importare la pagina: i componenti server si riconoscono, per leggere il payload come lo scrive Next.
trackAppComponents();

const ROOT = new URL("../../../", import.meta.url);
const app = (path: string) => pathToFileURL(new URL(path, ROOT).pathname).href;
const page = (await import(app("src/app/(dashboard)/dashboard/[workspaceId]/ai-readiness/page.tsx"))) as { default: (props: unknown) => Promise<unknown> };
const questionsPage = (await import(app("src/app/(dashboard)/dashboard/[workspaceId]/ai-readiness/questions/[assessmentId]/page.tsx"))) as { default: (props: unknown) => Promise<unknown> };
const { renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string };

const template = AI_READINESS_SYSTEM_TEMPLATE;
const now = new Date("2026-11-23T10:00:00Z");

interface Scenario {
  role?: string;
  status?: string;
  responses?: number;
  expected?: number | null;
  link?: boolean;
  insights?: Array<{ status: string; type?: string; at?: Date }>;
  /** Le risposte contate all'ultima sintesi (`inputScope.responseCount`); di base, quelle di adesso. */
  synthesisAt?: number;
  people?: number;
  proposals?: number;
  exports?: number;
}

function setUp(s: Scenario = {}) {
  const responses = s.responses ?? 0;
  const assessment = {
    id: AS,
    workspaceId: WS,
    name: "AI Readiness Cliente Demo",
    status: s.status ?? "open",
    aggregationThreshold: 5,
    anonymousMode: true,
    privacyConfig: { controllerName: "Cliente Demo", supportEmail: "privacy@cliente.test" },
    scoringConfig: {
      ...(s.link === false ? {} : { openLinkTokenHash: "h".repeat(64), openLinkCopies: [{ h: "copia-hash-1", at: now.toISOString() }] }),
      ...(s.expected === null ? {} : { expectedRespondents: s.expected ?? 120 }),
    },
  };
  const people = Array.from({ length: s.people ?? 0 }, (_, i) => ({
    id: `p${i}`,
    name: i === 0 ? "Persona" : null,
    surname: i === 0 ? "Prova" : null,
    email: i === 1 ? "prova@cliente.test" : null,
    role: i === 0 ? "Capoturno magazzino" : null,
    organizationUnit: i % 2 ? "Amministrazione" : "Vendite",
    inviteTokenHash: `invito-hash-${i}`,
    surveyTrack: i === 0 ? "internal" : "everyone",
    inviteStatus: i < responses ? "completed" : "opened",
    completedAt: i < responses ? new Date(now.getTime() - 3_600_000) : null,
    questionScope: null,
    pseudonymousId: `pseudo-${i}-0123456789abcdef`,
  }));
  const pillarScores = Object.fromEntries(template.pillars.map((p, i) => [p.id, responses ? 2 + i * 0.4 : null]));
  const sectionScores = Object.fromEntries(template.sections.map((sec, i) => [sec.id, responses ? 1.5 + (i % 5) * 0.6 : null]));
  Object.assign(fake, {
    access: { session: { user: { id: "u1", email: "responsabile@cliente.test" } }, access: { role: s.role ?? "transformation_lead", workspace: { name: "Cliente Demo" } } },
    ensureAiReadinessSystemTemplate: async () => ({}),
    listAssessmentsByWorkspace: async () => [{ assessment }, { assessment: { ...assessment, id: OTHER, name: "Prima rilevazione", status: "closed" } }],
    getAssessmentBundleById: async () => ({ assessment, template: {}, templateDefinition: template }),
    getAiReadinessDashboard: async () => ({
      responseCount: responses,
      invitedCount: people.length,
      startedCount: responses,
      completedCount: responses,
      overallScore: responses ? 3.12 : null,
      bottleneckPillar: responses ? "workflow" : null,
      confidence: 0.8,
      aggregationThresholdMet: responses >= 5,
      pillarScores,
      sectionScores,
      units: responses ? [{ unit: "Vendite", respondentCount: 6, aggregationThresholdMet: true, overallScore: 3.4, bottleneckPillar: "context", pillarScores: {} }, { unit: "Amministrazione", respondentCount: 2, aggregationThresholdMet: false, overallScore: null, bottleneckPillar: null, pillarScores: {} }] : [],
    }),
    listRespondentsByAssessment: async () => people,
    listUseCaseSubmissionsByAssessment: async () =>
      Array.from({ length: s.proposals ?? 0 }, (_, i) => ({ id: `u${i}`, title: `Idea di prova ${i + 1}`, riskLevel: "Alta", frequency: "Ogni settimana", linkedUseCaseId: i === 0 ? "00000000-0000-4000-8000-0000000000c1" : null })),
    listAiReadinessExports: async () => Array.from({ length: s.exports ?? 0 }, (_, i) => ({ id: `e${i}`, exportType: i ? "excel_aggregated" : "executive_pdf", createdAt: now, includedPersonalData: false })),
    listAiReadinessInsights: async () =>
      (s.insights ?? []).map((insight, i) => ({
        id: `i${i}`,
        insightType: insight.type ?? "executive_summary",
        title: `Punto di prova ${i + 1}`,
        body: "Una frase di prova della sintesi.",
        validationStatus: insight.status,
        generatedAt: insight.at ?? now,
        inputScope: { responseCount: s.synthesisAt ?? responses },
        evidence: insight.type === "roadmap" ? { waves: [{ id: "w1", horizon: "0-90 giorni", title: "Prima tappa", focus: "Mettere ordine." }] } : {},
      })),
    listResponsesByAssessment: async () => Array.from({ length: responses }, () => ({ status: "submitted" })),
    templateDefinitionFromRow: () => template,
  });
}

async function render(s: Scenario = {}, search: Record<string, string> = {}) {
  setUp(s);
  return renderToStaticMarkup(await page.default({ params: Promise.resolve({ workspaceId: WS }), searchParams: Promise.resolve({ assessment: AS, ...search }) }));
}

const englishOrCodes = /\b(?:Draft|Open|Closed|Archived|AI Readiness OS|Fase \d|Intelligence|Roadmap|waves?|Cluster|benchmark|heatmap|Privacy guardrails|Controller|Raw individual|Evidence|executive_summary|use_cases|invited|opened|respondent|survey|Portfolio|Percorso \d|Alimenta|Score|N\/D)\b/;

function checkScreen(html: string, label: string) {
  const text = visibleText(html);
  assert.doesNotMatch(text, englishOrCodes, `${label}: niente inglese né codici`);
  assert.deepEqual(findHubForbiddenIn([text], "area").map((m) => m.match), [], `${label}: le parole della dashboard`);
  assert.doesNotMatch(text, /pseudo-\d/, `${label}: mai l'id pseudonimo`);
  return text;
}

test("the filled button follows the state (§3.9): one per screen, and it is the next step", async () => {
  const cases: Array<[Scenario, string]> = [
    [{ status: "draft", link: false }, "Apri la raccolta"],
    [{ link: false }, "Crea il link per tutti"],
    [{}, "Copia il link per tutti"],
    [{ responses: 46, people: 50 }, "Genera la sintesi"],
    [{ responses: 46, people: 50, insights: [{ status: "draft" }, { status: "draft" }, { status: "approved" }] }, "Rivedi 2 insight"],
    // (Revisione 7b) Dopo la sintesi, ogni risposta nuova non la rimette in testa: si torna a copiare il link…
    [{ responses: 46, people: 50, insights: [{ status: "approved" }], synthesisAt: 30 }, "Copia il link per tutti"],
    // …fino a 20 risposte in più.
    [{ responses: 50, people: 50, insights: [{ status: "approved" }], synthesisAt: 30 }, "Genera la sintesi"],
    [{ status: "closed", responses: 46, people: 50 }, "Scarica il report"],
  ];
  for (const [scenario, label] of cases) {
    const html = await render(scenario);
    const filled = filledButtons(html);
    assert.equal(filled.length, 1, `${label}: un solo pulsante pieno (${filled.join(" | ")})`);
    assert.ok(visibleText(html).includes(label), label);
    checkScreen(html, label);
  }
  // «Rivedi N insight» porta alla scheda Insight; «Scarica il report» è un link vero con `download`.
  const step = (html: string) => /<a\b[^>]*data-action="next-step"[^>]*>/.exec(html)?.[0] ?? "";
  assert.ok(step(await render({ responses: 46, people: 50, insights: [{ status: "draft" }] })).includes(`href="/dashboard/${WS}/ai-readiness?assessment=${AS}&amp;scheda=insight"`));
  const report = step(await render({ status: "closed", responses: 6, people: 6 }));
  assert.ok(report.includes(`href="/api/ai-readiness/assessments/${AS}/export?type=pdf"`) && report.includes('download=""'), report);
});

test("whoever cannot take the step sees the state without a filled button", async () => {
  const contributor = await render({ role: "contributor", status: "draft", link: false });
  assert.deepEqual(filledButtons(contributor), []);
  assert.ok(visibleText(contributor).includes("Raccolta in bozza") && visibleText(contributor).includes("Tocca a chi gestisce la rilevazione"));
  const analyst = await render({ role: "analyst", responses: 46, people: 50 });
  assert.equal(filledButtons(analyst).length, 1, "chi valuta genera la sintesi");
  const analystOpen = await render({ role: "analyst" });
  assert.deepEqual(filledButtons(analystOpen), [], "il link per tutti è di chi gestisce");
  // Chi non gestisce non ha «Raccolta» senza use case proposti; chi non valuta non ha «Insight» senza insight.
  assert.doesNotMatch(contributor, /scheda=raccolta|scheda=insight/);
  assert.match(analystOpen, /scheda=insight/);
});

test("zero answers: about 120 words, the line under the title, one sentence in Risultati", async (t) => {
  const html = await render({});
  const text = checkScreen(html, "zero");
  assert.ok(text.includes("Ancora nessuna risposta · bastano 5 per i risultati"));
  assert.ok(text.includes("Aperta"), "lo stato in italiano");
  assert.ok(text.includes("Ancora nessuna risposta: i risultati compaiono con la prima."));
  const words = wordCount(text);
  t.diagnostic(`parole a zero risposte: ${words}`);
  assert.ok(words <= 120, `${words} parole a zero risposte (prima circa 900)`);
  assert.match(html, /<nav aria-label="Sezioni della rilevazione"/);
  for (const tab of ["Risultati", "Raccolta", "Insight", "Impostazioni"]) assert.ok(text.includes(tab), tab);
});

test("with data: about 350 words on Risultati, the index as the big number, areas and teams folded", async (t) => {
  const html = await render({ responses: 46, people: 50, expected: 120 });
  const text = checkScreen(html, "con i dati");
  assert.ok(text.includes("46 risposte su 120 attese · bastano 5 per i risultati"));
  assert.ok(text.includes("3,1 su 5") && text.includes("Indice di prontezza") && text.includes("Strutturata · più debole: Processi"));
  for (const area of ["Tecnologia", "Contesto", "Processi", "Adozione", "Use case"]) assert.ok(html.includes(`>${area}<`), area);
  const words = wordCount(text);
  t.diagnostic(`parole con i dati: ${words}`);
  assert.ok(words <= 350, `${words} parole con i dati (prima circa 1.900)`);
  assert.deepEqual(folds(html), [{ id: "per-area", open: false }, { id: "per-team", open: false }]);
});

test("Raccolta: the link for everyone, «Invita una persona» in a panel, people and proposed use cases with «Mostra tutti»", async () => {
  const html = await render({ responses: 2, people: 9, proposals: 10 }, { scheda: "raccolta" });
  const text = checkScreen(html, "raccolta");
  for (const piece of ["Link per tutti", "Attivo", "Copia il link", "Invita una persona", "Persone (9)", "Use case proposti (10)", "Mostra tutti (9)", "Mostra tutti (10)", "Dal link per tutti", "Ha risposto"]) {
    assert.ok(text.includes(piece) || html.includes(piece), piece);
  }
  assert.equal(filledButtons(html).length, 1, "il pieno resta il prossimo passo");
  // Tutte le righe ci sono: nessuna tagliata.
  assert.equal(html.match(/data-row="use-case-proposto"/g)?.length, 10);
  assert.equal(html.match(/data-row="persona"/g)?.length, 9);
  assert.match(html, /aria-haspopup="dialog"[^>]*data-testid="invite-respondents-cta"/);
  // Chi non gestisce vede solo gli use case proposti, senza azioni.
  const contributor = await render({ role: "contributor", proposals: 2 }, { scheda: "raccolta" });
  assert.ok(visibleText(contributor).includes("Use case proposti (2)"));
  assert.doesNotMatch(visibleText(contributor), /Link per tutti|Invita una persona|Persone \(|Aggiungi agli use case/);
});

test("Insight: to review first, with «Approva», «Segna come visto», «Scarta» never filled; steps folded", async () => {
  const html = await render({ responses: 6, people: 6, insights: [{ status: "approved" }, { status: "draft", type: "roadmap" }, { status: "draft" }] }, { scheda: "insight" });
  const text = checkScreen(html, "insight");
  assert.ok(text.includes("2 da rivedere"));
  assert.ok(text.includes("Approva") && text.includes("Scarta") && text.includes("Segna come visto"));
  assert.equal(filledButtons(html).length, 1);
  assert.deepEqual(folds(html), [{ id: "tappe", open: false }]);
  assert.ok(html.indexOf('data-insight-status="draft"') < html.indexOf('data-insight-status="approved"'), "prima quelli da rivedere");
});

test("Impostazioni: two labelled fields, the privacy said once in Italian, the files folded", async () => {
  const html = await render({ responses: 6, people: 6, exports: 2 }, { scheda: "impostazioni" });
  const text = checkScreen(html, "impostazioni");
  assert.ok(text.includes("Risposte per vedere i risultati") && text.includes("Risposte attese"));
  assert.ok(text.includes("Le risposte si leggono solo insieme"));
  assert.ok(text.includes("Titolare del trattamento: Cliente Demo"));
  assert.deepEqual(folds(html), [{ id: "file-scaricati", open: false }]);
  // (Revisione 7b) I tipi che la rotta scrive davvero: il PDF si chiama PDF, l'Excel Excel.
  assert.ok(html.includes(">Report in PDF<") && html.includes(">Dati in Excel<"));
  assert.doesNotMatch(html, /executive_pdf|excel_aggregated/);
  const analyst = await render({ role: "analyst", responses: 6, people: 6 }, { scheda: "impostazioni" });
  assert.doesNotMatch(analyst, /data-testid="threshold-form"/, "la soglia la cambia chi gestisce");
  assert.ok(visibleText(analyst).includes("Risultati da 5 risposte"));
});

test("the old addresses keep working: ?new=1, ?deleted=1, an unknown tab, the old anchors", async () => {
  const created = await render({}, { new: "1" });
  assert.ok(visibleText(created).includes("Nuova rilevazione"));
  assert.equal(filledButtons(created).length, 1, "«Crea la rilevazione»");
  assert.ok(visibleText(created).includes("Crea la rilevazione"));
  // (Revisione 7b) L'email per le domande è il contatto del cliente che chi risponde vede: in vista sopra la piega, vuota
  // e obbligatoria, mai quella di chi crea. La piega «Privacy e soglie (già compilate)» resta chiusa (audit AD-2).
  assert.doesNotMatch(created, /responsabile@cliente\.test/, "mai l'email di chi crea");
  const contact = /<input[^>]*id="supportEmail"[^>]*>/.exec(created)?.[0] ?? "";
  assert.ok(contact && !/\svalue="[^"]+"/.test(contact), `campo vuoto: ${contact}`);
  assert.match(contact, /\srequired=""/);
  assert.match(contact, /aria-required="true"/);
  assert.match(created, /<label[^>]*for="supportEmail"[^>]*>Email per le domande di chi risponde<\/label>/);
  assert.match(created, /aria-expanded="false"[^>]*>Privacy e soglie \(già compilate\)/);
  const text = visibleText(created);
  assert.ok(text.includes("Email per le domande di chi risponde") && text.includes("scrivi il contatto dell'azienda"));
  assert.doesNotMatch(text, /Base giuridica|Titolare del trattamento|Responsabile del trattamento|Conservazione dei dati/, "i campi legali stanno nella piega chiusa");
  assert.ok(created.indexOf('id="supportEmail"') < created.indexOf("Privacy e soglie (già compilate)"), "sopra la piega");
  assert.match(created, /<form[^>]*novalidate=""[^>]*data-slot="readiness-create"/i, "le verifiche le fa la pagina, con le sue parole");
  // La piega si apre da sola solo per un errore in uno dei suoi campi; l'email non è uno di questi.
  const form = (await import(app("src/components/ai-readiness/assessment-create-form.tsx"))) as typeof import("./assessment-create-form.tsx");
  assert.equal(form.foldedErrorIn({ ok: true }), false);
  assert.equal(form.foldedErrorIn({ ok: false, fieldErrors: { supportEmail: "Scrivi un'email valida." } }), false);
  assert.equal(form.foldedErrorIn({ ok: false, fieldErrors: { legalBasis: "Indica la base giuridica." } }), true);
  assert.equal(form.foldedErrorIn({ ok: false, fieldErrors: { aggregationThreshold: "Da 3 a 50." } }), true);
  assert.ok(!form.FOLDED_FIELDS.includes("supportEmail"));
  assert.ok(visibleText(await render({}, { deleted: "1" })).includes("Rilevazione eliminata"));
  assert.match(await render({}, { scheda: "respondents" }), /data-readiness-tab="risultati"/);
  // `#respondents` e `#intelligence` le porta alla loro scheda `ReadinessAnchor` (provato in dashboard-view.test.ts e, nel
  // browser, nel test qui sotto).
  const source = readFileSync(new URL("src/app/(dashboard)/dashboard/[workspaceId]/ai-readiness/page.tsx", ROOT), "utf8");
  assert.match(source, /<ReadinessAnchor workspaceId=\{workspaceId\} assessmentId=\{assessment\.id\} current=\{tab\} visible=\{tabs\} \/>/);
});

// (Harness 7b) Da `#respondents` e `#intelligence` la testata compariva due volte: la pagina dava la stessa chiave alla
// testata e alla scheda, e React, ridisegnando nel browser dopo `router.replace`, lasciava la testata vecchia accanto
// alla nuova (e ne aggiungeva una a ogni aggiornamento). Qui la pagina si monta nel browser come la apre l'ancora, si
// ridisegna all'indirizzo nuovo, poi si aggiorna come fa la raccolta aperta ogni 30 secondi.
test("the old anchors in the browser: one header, one filled button, the right tab and section, also after a refresh", async () => {
  const cases: Array<{ hash: string; scenario: Scenario; target: string; tab: string; section: string }> = [
    { hash: "#respondents", scenario: { responses: 3, people: 6, proposals: 1 }, target: `?assessment=${AS}&scheda=raccolta#persone`, tab: "raccolta", section: "persone" },
    { hash: "#intelligence", scenario: { responses: 46, people: 50, insights: [{ status: "draft" }] }, target: `?assessment=${AS}&scheda=insight#da-rivedere`, tab: "insight", section: "da-rivedere" },
  ];
  for (const c of cases) {
    setUp(c.scenario);
    const moves: string[] = [];
    fake.onNavigate = (kind: string, href: string) => moves.push(`${kind} ${href}`);
    const base = `/dashboard/${WS}/ai-readiness`;
    const client = await mountClient(`https://app.test${base}${c.hash}`);
    const at = async (search: Record<string, string>) => page.default({ params: Promise.resolve({ workspaceId: WS }), searchParams: Promise.resolve(search) });
    try {
      client.render(await at({}));
      assert.deepEqual(moves, [`replace ${base}${c.target}`], `${c.hash}: l'ancora porta alla sua scheda, al posto dell'indirizzo`);
      const target = new URL(moves[0].slice("replace ".length), "https://app.test");
      client.navigate(target.href);
      const search = Object.fromEntries(target.searchParams);
      for (const moment of ["dopo l'ancora", "dopo l'aggiornamento"]) {
        client.render(await at(search));
        const html = client.html();
        assert.equal(html.split('data-slot="readiness-header"').length - 1, 1, `${c.hash}, ${moment}: una sola testata`);
        assert.equal(filledButtons(html).length, 1, `${c.hash}, ${moment}: un solo pulsante pieno (${filledButtons(html).join(" | ")})`);
        assert.match(html, new RegExp(`data-readiness-tab="${c.tab}"`), `${c.hash}, ${moment}: la scheda`);
        assert.match(html, new RegExp(`<section id="${c.section}"`), `${c.hash}, ${moment}: la sezione dell'ancora`);
      }
      assert.equal(moves.length, 1, `${c.hash}: all'indirizzo nuovo l'ancora non porta altrove`);
      assert.deepEqual(client.errors, [], `${c.hash}: React non segnala niente (prima: «Encountered two children with the same key»)`);
    } finally {
      client.unmount();
      delete fake.onNavigate;
    }
  }
});

// (Revisione 7b, sicurezza) Next scrive nella pagina ogni prop di un componente client, anche quelle che il componente
// non mostra: «Raccolta» si apre a chi non gestisce se ci sono use case proposti, e la lista delle persone partiva
// comunque. Qui si legge il payload come lo scrive Next (i componenti server eseguiti, quelli client con tutte le loro
// props), in ogni scheda, per chi non gestisce: niente nomi, email, ruoli, stati degli inviti; a nessuno i token, i loro
// hash o l'email per le domande.
test("the page payload: people, invites and the link only to whoever manages; tokens and contacts to nobody", async () => {
  assert.ok(trackedServerComponents() > 5, "i componenti server sono riconosciuti");
  const scenario: Scenario = { responses: 6, people: 6, proposals: 2, insights: [{ status: "draft" }], exports: 2 };
  const payload = async (role: string, scheda: string) => {
    setUp({ ...scenario, role });
    return serverPayload(await page.default({ params: Promise.resolve({ workspaceId: WS }), searchParams: Promise.resolve({ assessment: AS, scheda }) }));
  };
  const toNobody = ["invito-hash-", "h".repeat(64), "copia-hash-", "privacy@cliente.test"];
  const people = ["Persona Prova", "prova@cliente.test", "Capoturno magazzino", "pseudo-0-", '"Ha risposto"', '"Link aperto"', '"In corso"', '"Link creato"'];
  for (const role of ["contributor", "analyst", "function_lead"]) {
    for (const scheda of ["risultati", "raccolta", "insight", "impostazioni"]) {
      const json = await payload(role, scheda);
      for (const secret of [...people, ...toNobody]) assert.ok(!json.includes(secret), `${role}, ${scheda}: ${secret} nella pagina`);
    }
    // La scheda si apre davvero, con gli use case proposti, ma senza il link per tutti e senza gli inviti.
    const collection = await payload(role, "raccolta");
    assert.ok(collection.includes('"manager":null') && collection.includes("Idea di prova 1"), `${role}: solo gli use case proposti`);
  }
  // Il controllo legge davvero le props: a chi gestisce le persone arrivano, i token e l'email per le domande no.
  for (const scheda of ["risultati", "raccolta", "insight", "impostazioni"]) {
    const json = await payload("transformation_lead", scheda);
    if (scheda === "raccolta") assert.ok(people.slice(0, 3).every((piece) => json.includes(piece)), "chi gestisce vede le persone");
    for (const secret of toNobody) assert.ok(!json.includes(secret), `chi gestisce, ${scheda}: ${secret} nella pagina`);
  }
});

test("«Domande»: closed rows, «Per tutti (N) | Referenti (N)», «Scarica»; only for whoever manages", async () => {
  setUp({});
  const html = renderToStaticMarkup(await questionsPage.default({ params: Promise.resolve({ workspaceId: WS, assessmentId: AS }), searchParams: Promise.resolve({}) }));
  const text = visibleText(html);
  const everyone = template.questions.filter((q) => template.sections.find((s) => s.id === q.sectionId)?.audience !== "internal").length;
  const internal = template.questions.length - everyone;
  assert.ok(text.includes(`Per tutti (${everyone})`) && text.includes(`Referenti (${internal})`));
  assert.ok(text.includes("Scarica"));
  assert.equal(html.match(/data-testid="question-row"/g)?.length, everyone, "solo le domande per tutti");
  assert.equal(html.match(/aria-expanded="false"/g)?.length && true, true, "righe chiuse");
  assert.doesNotMatch(text, /Scala 0–5|lascia vuoto|esattamente ciò che riceveranno|OPIT/);
  assert.deepEqual(filledButtons(html), []);
  const referenti = renderToStaticMarkup(await questionsPage.default({ params: Promise.resolve({ workspaceId: WS, assessmentId: AS }), searchParams: Promise.resolve({ per: "referenti" }) }));
  assert.equal(referenti.match(/data-testid="question-row"/g)?.length, internal);
  fake.access = { session: { user: { id: "u2" } }, access: { role: "analyst", workspace: { name: "Cliente Demo" } } };
  await assert.rejects(questionsPage.default({ params: Promise.resolve({ workspaceId: WS, assessmentId: AS }), searchParams: Promise.resolve({}) }), /NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
});
