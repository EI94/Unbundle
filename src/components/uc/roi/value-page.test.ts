import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { enableTsxImports } from "../../use-cases/detail/referent/tsx-test-loader.ts";
import { KPI_PANEL, kpiPanelFromLegacy, kpiPanelHref, kpiPanelValue, parseKpiPanel, vanityFilterLabel } from "../../../lib/uc/views/kpi.ts";
import { legacyCaseRoute } from "../../../lib/uc/views/legacy-routes.ts";
import { VALUE_TEXT, valueFigures, type ValueView } from "../../../lib/uc/views/roi.ts";
import { computeRoi } from "../../../lib/uc/views/roi-edit.ts";
import { findForbiddenIn } from "../../../lib/uc/views/copy-guard.ts";

// Rilascio 10, §3.5 (Valore): tre cifre con le parole di §4, «Stima» detto una volta, «Tutti i KPI» in un pannello da
// «Come si calcola»; `/valore/kpi` e `/kpi` aprono ancora i KPI. Le leve si accendono qui (prima in Impostazioni).

const CASE = "/dashboard/11111111-1111-4111-8111-111111111111/casi-duso/22222222-2222-4222-8222-222222222222";
const VALORE = `${CASE}/valore`;
const KPI = "33333333-3333-4333-8333-333333333333";
const CASE_DIR = new URL("../../../app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/", import.meta.url);
const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("il pannello dei KPI ha un indirizzo: l'elenco (`apri=kpi`) e un KPI (`apri=kpi-<id>`)", () => {
  assert.equal(KPI_PANEL, "kpi");
  assert.deepEqual(parseKpiPanel("kpi"), { kpiId: null });
  assert.deepEqual(parseKpiPanel(`kpi-${KPI.toUpperCase()}`), { kpiId: KPI });
  for (const other of [null, "", "dati", "leva-tempo", "costo-licenze", "kpi-x", "kpis"]) assert.equal(parseKpiPanel(other), null, String(other));
  assert.equal(kpiPanelValue(), "kpi");
  assert.equal(kpiPanelValue(KPI), `kpi-${KPI}`);
  assert.equal(kpiPanelHref(VALORE, {}), `${VALORE}?apri=kpi`);
  assert.equal(kpiPanelHref(VALORE, { kpiId: KPI, vista: "tutti", q: "tempo", gruppi: ["tempo"], pagine: { tempo: 2 } }), `${VALORE}?apri=kpi-${KPI}&vista=tutti&q=tempo&gruppi=tempo&pagine=tempo-2`);
});

test("redirect: `/valore/kpi` porta al pannello con vista, ricerca, gruppo, pagine e il KPI aperto", () => {
  assert.equal(kpiPanelFromLegacy(VALORE, {}), `${VALORE}?apri=kpi`);
  assert.equal(kpiPanelFromLegacy(VALORE, { apri: KPI }), `${VALORE}?apri=kpi-${KPI}`);
  assert.equal(
    kpiPanelFromLegacy(VALORE, { vista: "conto", q: "ore", gruppi: "tempo", pagine: "tempo-3", altro: "x" }),
    `${VALORE}?apri=kpi&vista=conto&q=ore&gruppi=tempo&pagine=tempo-3`,
    "un parametro sconosciuto si lascia cadere",
  );
  assert.equal(kpiPanelFromLegacy(VALORE, { apri: "non-un-id" }), `${VALORE}?apri=kpi`, "un id non valido apre l'elenco");
  // Il vecchio `/kpi` passa da `/valore/kpi` (308, senza leggere il database), poi qui.
  const legacy = new URL(legacyCaseRoute(CASE, ["kpi"], new URLSearchParams(`apri=${KPI}`))!, "http://x");
  assert.equal(legacy.pathname, VALORE + "/kpi");
  assert.equal(kpiPanelFromLegacy(VALORE, Object.fromEntries(legacy.searchParams)), `${VALORE}?apri=kpi-${KPI}`);
});

test("`/valore/kpi`: chi apre Valore va al pannello; lo sviluppatore, che Valore non lo apre, legge ancora l'elenco lì", () => {
  const page = strip(readFileSync(new URL("valore/kpi/page.tsx", CASE_DIR), "utf8"));
  assert.match(page, /if \(canOpenPage\("roi", viewer\.roles\)\) permanentRedirect\(kpiPanelFromLegacy\(casePath\(workspaceId, caseId, "valore"\), sp\)\);/);
  assert.ok(page.indexOf("permanentRedirect(") < page.indexOf("loadKpiPage("), "prima del giro dei KPI");
  assert.match(page, /<PageContainer>/, "l'elenco resta per lo sviluppatore");
});

test("Valore: niente sottotitolo, «Tutti i KPI» dentro «Come si calcola», le leve da «Cambia le leve», i pannelli dall'indirizzo", () => {
  const page = strip(readFileSync(new URL("valore/page.tsx", CASE_DIR), "utf8"));
  assert.doesNotMatch(page, /Quanto costa e quanto rende/, "il sottotitolo non c'è più");
  assert.doesNotMatch(page, /Tutti i KPI/, "il link sta in «Come si calcola», non nella pagina");
  assert.match(page, /<HowCalculated how=\{view\.how\} kpiHref=\{kpiHref\} kpiTotal=\{view\.kpiTotal\} account=\{view\.source !== "vuoto"\} \/>/, "anche senza conto «Tutti i KPI» ha il suo ingresso");
  assert.match(page, /<KpiListPanel /);
  assert.match(page, /<KpiPanel\s/);
  assert.match(page, /<LeverSwitchesPanel /);
  assert.match(page, /leversHref=\{canLevers \? panelHref\(LEVERS_PANEL\) : null\}/);
  assert.match(page, /const leversEditable = roles\.includes\("ls_lead"\) && !viewer\.readOnly;/, "le leve le accende solo il responsabile Lateral Space");
  const how = readFileSync(new URL("./how-calculated.tsx", import.meta.url), "utf8");
  assert.match(how, /<Fold id="come-si-calcola" title=\{VALUE_TEXT\.howCalculated\}>/, "una piega chiusa, con un H2 vero");
  assert.doesNotMatch(how, /ipotesi e metodo, pareggio e valore nel tempo/, "senza il sottotitolo");
  const lever = readFileSync(new URL("./line-panels.tsx", import.meta.url), "utf8");
  // «Si misura con» apre il KPI nel suo pannello, con lo stesso valore di `kpiPanelValue` (scritto lì per non portare il modulo nel browser).
  assert.ok(lever.includes("href={`${kpiBase}?apri=kpi-${k.id}`}"));
  assert.equal(kpiPanelValue("ID"), "kpi-ID");
});

const COMPUTED = computeRoi({
  costLines: [{ key: "avvio", label: "Avvio", kind: "una_tantum", value: 34_000 }],
  benefitLines: [{ key: "tempo", leverLabel: null, lever: "tempo", value: 52_000 }],
});

function view(over: Partial<ValueView> = {}): ValueView {
  return {
    source: "modello",
    statusLabel: "Stima",
    computed: true,
    figures: valueFigures(COMPUTED),
    disclaimer: "Sono stime: nessun beneficio è garantito. Diventano misure dopo la prova sul passato.",
    levers: [],
    inactiveLevers: [],
    costs: [],
    missing: { total: 0, questions: [], questionTotal: 0, lines: [], needs: [] },
    how: { figures: [], note: null, method: [], assumptions: [], formula: [], example: { note: null, rows: [] } },
    kpiTotal: 0,
    ...over,
  };
}

let renderAccount: (v: ValueView) => string;

before(async () => {
  await enableTsxImports();
  const react = await import("react");
  const { renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string };
  const { ValueAccount } = await import("./value-account.tsx");
  renderAccount = (v) => renderToStaticMarkup(react.createElement(ValueAccount, { view: v, missingHref: `${VALORE}?apri=dati`, questionsHref: null }));
});

/** Il testo visibile: senza tag e senza le copie per i lettori di schermo. */
const visible = (html: string) =>
  html
    .replace(/<[^>]*class="sr-only"[^>]*>[^<]*<\/[^>]+>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

test("tre cifre con le parole di §4: «Valore all'anno» è il numero grande, «Stima» si dice una volta", () => {
  const html = renderAccount(view());
  const text = visible(html);
  for (const word of ["Valore all'anno", "Costo di realizzazione", "Pareggio", "52.000 €", "34.000 €"]) assert.ok(text.includes(word), word);
  assert.equal(text.match(/\bStima\b/g)?.length, 1, "«Stima» una volta");
  assert.ok(!text.includes("Sono stime"), "la frase sulle stime sta nel «?»");
  assert.equal(html.match(/data-slot="big-number-value"/g)?.length, 1, "un solo numero grande");
  assert.ok(html.indexOf("Valore all&#x27;anno") < html.indexOf("Costo di realizzazione"), "prima il valore, come nella scheda dello use case (D10)");
  assert.ok(text.split(" ").length <= 20, `il conto in poche parole: ${text}`);
});

test("da calcolare: una riga sola con «Vedi quali», nessuna cifra vuota", () => {
  const empty = computeRoi({ costLines: [], benefitLines: [] });
  const text = visible(renderAccount(view({ computed: false, figures: valueFigures(empty), missing: { total: 12, questions: [], questionTotal: 12, lines: [], needs: [] } })));
  assert.equal(text, "Il conto è da calcolare: mancano 12 dati. Vedi quali");
});

test("i testi di Valore passano il controllo e non tornano «Beneficio all'anno» né «Output»", () => {
  const texts = Object.values(VALUE_TEXT).map((v) => (typeof v === "string" ? v : v(3)));
  assert.deepEqual(findForbiddenIn([...texts, vanityFilterLabel(12)], "cliente"), []);
  assert.deepEqual(valueFigures(COMPUTED).map((f) => f.label), ["Costo di realizzazione", "Valore all'anno", "Pareggio"]);
  assert.equal(vanityFilterLabel(12), "KPI non collegati al conto (12)", "«Da sistemare» diventa il filtro di Lateral Space");
});
