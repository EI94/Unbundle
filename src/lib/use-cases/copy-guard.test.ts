import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import * as costInputState from "../../components/use-cases/cost-input-state.ts";
import * as agents from "./agents.ts";
import * as costBands from "./cost-bands.ts";
import {
  AREA_SOURCE_DIRS,
  HUB_COPY_RULES,
  OLD_NAME_GUARD_ENV,
  OLD_NAME_GUARD_MARKER,
  OLD_NAME_PENDING,
  OLD_NAME_SOURCES,
  copyScopeOfFile,
  findHubForbidden,
  findHubForbiddenIn,
  type HubCopyScope,
} from "./copy-guard.ts";
import * as format from "./format.ts";
import { costLongText, costShortText, costSourceText, valueEurSourceText, valueLongText } from "./format.ts";
import * as inputs from "./inputs.ts";
import * as labels from "./labels.ts";
import * as lanes from "./lanes.ts";
import { PLAN_SOURCE_LABEL } from "./mcp/output.ts";
import { SAVED_NEED_ACTION_LABEL } from "./mcp/tools.ts";
import * as needs from "./needs.ts";
import * as needsHistory from "./needs-history.ts";
import * as valueCharts from "./value-charts.ts";
import * as valueModel from "./value-model.ts";
import * as valueParamsForm from "./value-params-form.ts";
import { offMatrixLabel, toEstimateLabel } from "./views.ts";
import { PHASE_LABEL, SUB_STATE_LABEL } from "./phase.ts";
import * as quarter from "./quarter.ts";
import { WHEN_CHOICES, USE_CASE_SOURCES } from "./types.ts";

// Testi dell'area «Use case»: docs/use-case/DESIGN.md §14.1 e §14.5; PIANO-LAVORI H2d.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

// ─── Regole ──────────────────────────────────────────────────────────

test("nell'area: ogni parola vietata di §14.5, senza distinguere maiuscole", () => {
  const cases: Array<[string, string]> = [
    ["caso_d_uso", "Apri il caso d'uso"],
    ["caso_d_uso", "Nuovo Caso d’uso"],
    ["vecchio_nome", "Vai a Raccolta & ranking"],
    ["vecchio_nome", "Raccolta & Ranking"],
    ["vecchio_nome", "Ora il team lo vede in Raccolta e ranking."],
    ["vecchio_nome", "Raccolta &amp; Ranking"],
    ["quick_win", "Quick Win"],
    ["quick_win", "tre quick wins"],
    ["strategic_bet", "Strategic Bet"],
    ["capability_builder", "Capability Builder"],
    ["not_yet", "Not Yet"],
    ["wave", "Organizza le wave"],
    ["wave", "Wave 2"],
    ["effort", "Effort"],
    ["impact", "Impact"],
    ["feasibility", "Feasibility"],
  ];
  for (const [rule, text] of cases) {
    const found = findHubForbidden(text, "area");
    assert.ok(found.some((m) => m.rule === rule), `${rule}: «${text}» → ${JSON.stringify(found)}`);
  }
  assert.deepEqual(
    HUB_COPY_RULES.map((r) => r.word),
    ["caso d'uso", "Raccolta & ranking", "Quick Win", "Strategic Bet", "Capability Builder", "Not Yet", "wave", "Effort", "Impact", "Feasibility"],
  );
});

test("nell'area passano i testi di §14.3, «Casi d'uso» come nome della sezione e il nome del team", () => {
  const ok = [
    "Use case",
    "Dal basso e dall'alto: quali use case realizzare e quando.",
    "Senza dossier: la sezione Casi d'uso è spenta per questo workspace.",
    "Le zone sono un suggerimento, non la decisione.",
    "Subito · Da pianificare · Se avanza tempo · Non ora",
    "Valore · Costo di realizzazione",
    "La valuta AI Builder: qui vedi come va.",
    "Impatto atteso · Fattibilità",
    "Costo impegnato · su 7 use case · 2 da fascia",
    "Raccolta delle idee e ranking",
    "Una wavelength non è una wave? No: «wavelength» passa.",
  ];
  for (const text of ok.slice(0, -1)) assert.deepEqual(findHubForbidden(text, "area"), [], text);
  assert.deepEqual(
    findHubForbidden(ok.at(-1)!, "area").map((m) => m.match),
    ["wave"],
    "solo la parola intera",
  );
});

test("fuori dall'area: solo «Raccolta & ranking» e «Raccolta e ranking»", () => {
  assert.deepEqual(
    findHubForbidden("Impact, Feasibility, wave planner e Raccolta & Ranking", "vecchio_nome").map((m) => [m.rule, m.match]),
    [["vecchio_nome", "Raccolta & Ranking"]],
  );
  assert.equal(findHubForbidden("RACCOLTA E RANKING", "vecchio_nome").length, 1);
  assert.deepEqual(findHubForbidden("Quick Win · caso d'uso · Effort", "vecchio_nome"), []);
  assert.deepEqual(findHubForbidden("", "area"), []);
  const many = findHubForbiddenIn(["Impact", "ok", "wave e Effort"], "area");
  assert.deepEqual(
    many.map((m) => [m.text, m.match]),
    [
      ["Impact", "Impact"],
      ["wave e Effort", "wave"],
      ["wave e Effort", "Effort"],
    ],
  );
});

test("ambito di un file: componenti dell'area, file del vecchio nome, nient'altro", () => {
  const cases: Array<[string, HubCopyScope | null]> = [
    ["src/components/use-cases/cost-input.tsx", "area"],
    ["src/components/use-cases/cost-input-state.ts", "area"],
    ["src/components/use-cases/detail/section-what.tsx", "area"],
    ["src/components/use-cases/cost-input.test.ts", null],
    ["src/lib/slack/use-case-agent.ts", "vecchio_nome"],
    ["src/lib/slack/use-case-agent.test.ts", null],
    ["src/app/share/portfolio/[workspaceId]/[useCaseId]/page.tsx", "vecchio_nome"],
    ["src/components/workspace/claude-mcp-card.tsx", "vecchio_nome"],
    ["src/components/portfolio/scoring-model-form.tsx", "vecchio_nome"],
    ["./src/components/portfolio/scoring-model-form.tsx", "vecchio_nome"],
    ["src/components/portfolio/ranking-matrix.tsx", null],
    ["src/components/dashboard/app-sidebar.tsx", null],
    ["src/lib/use-cases/labels.ts", null],
    ["src/components/use-cases/readme.md", null],
  ];
  for (const [path, scope] of cases) assert.equal(copyScopeOfFile(path), scope, path);
});

// ─── Testi visibili di un sorgente ───────────────────────────────────

/** Attributi JSX che non sono testo a schermo. */
const NON_VISIBLE_ATTRIBUTES = new Set([
  "className",
  "key",
  "id",
  "href",
  "src",
  "type",
  "name",
  "role",
  "htmlFor",
  "inputMode",
  "autoComplete",
  "variant",
  "size",
  "side",
  "align",
  "mode",
  "form",
  "target",
  "rel",
  "method",
  "value",
  "tone",
  "figure",
  "source",
  "origin",
  "kind",
]);
/** Attributi JSX che sono testo a schermo (o letto dallo screen reader): sempre testo, anche in minuscolo. */
const VISIBLE_ATTRIBUTES = new Set(["title", "placeholder", "alt", "label", "aria-label", "aria-description", "aria-valuetext", "aria-roledescription"]);
/** Chiamate i cui argomenti sono classi o moduli. */
const NON_VISIBLE_CALLS = new Set(["cn", "clsx", "cva", "require"]);
/** Un identificatore, una classe, un percorso o una chiave: nessuno spazio, nessuna maiuscola. */
const CODE_LIKE = /^[a-z0-9_.:/#@\-[\]()=,*+?!&|<>%$]*$/;

/**
 * Una stringa che va dritta a schermo: figlia di un elemento JSX (`<b>{"impact"}</b>`, anche
 * dentro `?:`, `&&`, `||`, `??` e parentesi) o valore di un attributo visibile
 * (`VISIBLE_ATTRIBUTES`). Lì non può essere una classe né una chiave: niente filtro `CODE_LIKE`.
 */
function isRenderedLiteral(node: ts.Node): boolean {
  let child: ts.Node = node;
  let parent = node.parent;
  while (
    ts.isParenthesizedExpression(parent) ||
    (ts.isConditionalExpression(parent) && parent.condition !== child) ||
    (ts.isBinaryExpression(parent) &&
      [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(parent.operatorToken.kind) &&
      (parent.right === child || parent.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken))
  ) {
    child = parent;
    parent = parent.parent;
  }
  if (ts.isJsxExpression(parent)) {
    child = parent;
    parent = parent.parent;
    if (ts.isJsxElement(parent) || ts.isJsxFragment(parent)) return true;
  }
  return ts.isJsxAttribute(parent) && parent.initializer === child && VISIBLE_ATTRIBUTES.has(parent.name.getText());
}

/**
 * I testi che un sorgente può mettere a schermo: il testo JSX e le stringhe, esclusi import,
 * direttive, chiavi degli oggetti, attributi tecnici (`className`, `data-*`…), argomenti di
 * `cn()` e stringhe che sono codice. Il testo JSX e le stringhe figlie di un elemento o valori
 * di un attributo visibile contano sempre, anche se sono una sola parola in minuscolo
 * («wave», «effort»). I commenti non contano.
 */
function visibleTexts(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const push = (text: string, rendered = false) => {
    const t = text.replace(/\s+/g, " ").trim();
    if (t && (rendered || !CODE_LIKE.test(t))) out.push(t);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isExpressionStatement(node) && ts.isStringLiteral(node.expression)) return; // «use client»
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sf);
      if (NON_VISIBLE_ATTRIBUTES.has(name) || name.startsWith("data-") || name.startsWith("aria-hidden")) return;
    }
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) return;
      if (ts.isIdentifier(node.expression) && NON_VISIBLE_CALLS.has(node.expression.text)) return;
    }
    if (ts.isJsxText(node)) push(node.text, true);
    else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const parent = node.parent;
      const isKey = (ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent)) && parent.name === node;
      if (!isKey && !ts.isLiteralTypeNode(parent)) push(node.text, isRenderedLiteral(node));
    } else if (ts.isTemplateExpression(node)) {
      push([node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(" … "), isRenderedLiteral(node));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

test("testi visibili di un sorgente: JSX e stringhe sì, commenti, classi e codice no", () => {
  const source = `
    "use client";
    import { x } from "@/lib/raccolta-e-ranking";
    // Raccolta & ranking nel commento non conta
    /* Effort nemmeno */
    const KEY = { effort: 1, "Impact": 2 };
    type Kind = "Feasibility";
    const id = "effort";
    const message = "Ora il team lo vede in Raccolta e ranking.";
    const tpl = \`Ciao \${x} in Raccolta & ranking\`;
    export function A() {
      return <div className={cn("wave", "Effort-x")} data-note="Impact" aria-label="Apri la wave" title="Effort">
        Raccolta & Ranking {"Not Yet"}
      </div>;
    }`;
  const texts = visibleTexts("x.tsx", source);
  assert.deepEqual(texts, ["Ora il team lo vede in Raccolta e ranking.", "Ciao … in Raccolta & ranking", "Apri la wave", "Effort", "Raccolta & Ranking", "Not Yet"]);
  assert.deepEqual(
    findHubForbiddenIn(texts, "vecchio_nome").map((m) => m.match),
    ["Raccolta e ranking", "Raccolta & ranking", "Raccolta & Ranking"],
  );
  assert.deepEqual(
    findHubForbiddenIn(texts, "area").map((m) => m.rule),
    ["vecchio_nome", "vecchio_nome", "wave", "effort", "vecchio_nome", "not_yet"],
  );
});

test("testi visibili: una sola parola in minuscolo conta quando va a schermo", () => {
  const source = `
    const variant = "wave";
    const STATUS = { kind: "effort" };
    export function B({ n, ok, label }) {
      return <table title="effort" className="impact" data-kind="feasibility" type="wave"><tbody><tr>
        <th>effort</th>
        <td><span>{n} wave</span><b>{"impact"}</b><i>{ok ? "feasibility" : null}</i><u>{label ?? "waves"}</u><s>{ok && ("impact")}</s></td>
        <td><input placeholder="effort" name="impact" /><>{\`wave\`}</></td>
      </tr></tbody></table>;
    }`;
  const texts = visibleTexts("b.tsx", source);
  assert.deepEqual(texts, ["effort", "effort", "wave", "impact", "feasibility", "waves", "impact", "effort", "wave"]);
  assert.deepEqual(
    findHubForbiddenIn(texts, "area").map((m) => m.rule),
    ["effort", "effort", "wave", "impact", "feasibility", "wave", "impact", "effort", "wave"],
  );
  // Fuori dallo schermo la stessa parola resta codice: costanti, chiavi, classi, attributi tecnici.
  assert.ok(!visibleTexts("c.tsx", 'const v = "wave"; export const C = () => <div className="effort" id="impact" />;').length);
});

function walk(dir: string): string[] {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return [dir];
  const out: string[] = [];
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const full = join(abs, entry.name);
    const rel = relative(ROOT, full).split("\\").join("/");
    if (entry.isDirectory()) out.push(...walk(rel));
    else out.push(rel);
  }
  return out.sort();
}

function matchesOf(file: string, scope: HubCopyScope) {
  return findHubForbiddenIn(visibleTexts(file, readFileSync(join(ROOT, file), "utf8")), scope);
}

// ─── L'area ──────────────────────────────────────────────────────────

/** Tutte le stringhe di un valore: oggetti semplici e array, non le istanze di classi (es. gli schemi zod). */
function stringsOf(value: unknown, seen = new Set<unknown>()): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);
  const proto = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) return [];
  return Object.values(value).flatMap((v) => stringsOf(v, seen));
}

function exportedStrings(mod: Record<string, unknown>): string[] {
  return Object.values(mod)
    .filter((v) => typeof v !== "function")
    .flatMap((v) => stringsOf(v));
}

test("copy-guard verde sulle etichette dell'area", () => {
  const now = new Date("2026-10-14T10:00:00Z");
  const texts = [
    ...exportedStrings(labels),
    ...exportedStrings(costBands),
    ...exportedStrings(inputs),
    ...exportedStrings(quarter),
    ...exportedStrings(costInputState),
    // «Agente» (rilascio «Panoramica»): «Altri use case».
    ...exportedStrings(agents),
    // Le corsie della Panoramica: «ritorno qualitativo» e i testi delle corsie.
    ...exportedStrings(lanes),
    lanes.laneSummaryText(3, 24_500),
    lanes.laneMoreLabel(1),
    lanes.laneMoreLabel(3),
    ...Object.values(PHASE_LABEL),
    ...Object.values(SUB_STATE_LABEL),
    ...WHEN_CHOICES.map((choice) => quarter.whenChoiceLabel(choice, now)),
    ...USE_CASE_SOURCES.map((source) => labels.channelLabel(source)),
    ...labels.COST_SOURCES.flatMap((s) => [costSourceText(s, "corta"), costSourceText(s, "lunga")]),
    valueEurSourceText("dossier", "corta"),
    valueEurSourceText("dossier", "lunga"),
    valueLongText({ word: "alto", score: 3.8 }),
    ...([1, 2, 3, 4, 5] as const).flatMap((band) => [
      costShortText({ source: "team_fascia", amount: null, band, fromBand: true }),
      costLongText({ source: "sforzo", amount: null, band, fromBand: true }),
    ]),
    ...costInputState.bandOptions().map((o) => `${o.symbol} ${o.label}`),
    // «Benefici e costi» e «Cosa serve»: i moduli dei testi che vanno nelle pagine e nel MCP.
    ...exportedStrings(needs),
    // «Cosa serve» nella Storia (0023).
    ...exportedStrings(needsHistory),
    needsHistory.needHistoryText({ phaseBefore: null, phaseAfter: "aggiunta.requisito.da_chiedere" }),
    needsHistory.needHistoryText({ phaseBefore: "requisito.chiesta", phaseAfter: "modificata.requisito.validata" }),
    needsHistory.needHistoryText({ phaseBefore: "requisito.chiesta", phaseAfter: "modificata.passo.proposta" }),
    ...exportedStrings(valueCharts),
    ...exportedStrings(valueModel),
    ...exportedStrings(valueParamsForm),
    ...exportedStrings(format),
    ...Object.values(PLAN_SOURCE_LABEL),
    ...Object.values(SAVED_NEED_ACTION_LABEL),
    format.hoursFreedText(116),
    format.qualitativeCountText(2),
    format.oneoffRunText(560, 600),
    format.zoneText(null, { benefits: { state: "qualitativo", benefitEur: 0, pendingEur: 0, hours: 0 } }),
    format.valueShortText({ word: null, perYear: null, benefits: { state: "da_misurare", benefitEur: 0, pendingEur: 5840, hours: 0 } }),
    format.valueScreenText({ word: "basso", perYear: { amount: 12_250, source: "team" } }),
    format.valueScreenLongText({ word: "basso", score: 2.2, perYear: { amount: 12_250, source: "dossier" } }),
    valueCharts.otherGroupsLabel(["Amministrazione", "Logistica", "Produzione", "Vendite"], true),
    valueCharts.groupText(null),
    valueCharts.beyondHorizonText("2028-10"),
    valueCharts.bubbleWhenText({ when: "questo_trimestre", expired: true }),
    toEstimateLabel(5),
    offMatrixLabel({ count: 3, withoutBenefit: 2 }),
  ];
  assert.ok(texts.length > 400, `${texts.length} testi controllati`);
  assert.deepEqual(findHubForbiddenIn(texts, "area"), []);
});

test("copy-guard verde sui testi dei componenti dell'area (src/components/use-cases)", () => {
  const files = AREA_SOURCE_DIRS.flatMap(walk).filter((file) => copyScopeOfFile(file) === "area");
  const pieces = ["phase-pill", "origin-chip", "kind-label", "value-figure", "cost-figure", "source-tag", "cost-input"].map((name) => `src/components/use-cases/${name}.tsx`);
  for (const piece of pieces) assert.ok(files.includes(piece), `${piece} si controlla`);
  assert.ok(files.includes("src/components/use-cases/cost-input-state.ts"));
  const found = files.flatMap((file) => matchesOf(file, "area").map((m) => `${file}: «${m.match}» in «${m.text}»`));
  assert.deepEqual(found, []);
  // I testi del campo costo si leggono davvero dal sorgente.
  const costTexts = visibleTexts("cost-input-state.ts", readFileSync(join(ROOT, "src/components/use-cases/cost-input-state.ts"), "utf8"));
  assert.ok(costTexts.includes("Non sai l'importo? Scegli una fascia"));
});

// ─── Il vecchio nome fuori dall'area (si accende in H7) ──────────────

/** Acceso da H7 in poi (c'è il file che crea solo H7), oppure prima con la variabile. */
const OLD_NAME_GUARD_ON = existsSync(join(ROOT, OLD_NAME_GUARD_MARKER)) || process.env[OLD_NAME_GUARD_ENV] === "1";

test("vecchio nome fuori dall'area: si accende con il file di H7, senza variabili", () => {
  assert.equal(OLD_NAME_GUARD_MARKER, "docs/use-case/RUNBOOK.md", "il RUNBOOK dell'hub, che crea solo H7");
  assert.ok(!OLD_NAME_GUARD_MARKER.startsWith("/") && !OLD_NAME_GUARD_MARKER.includes(".."), "percorso relativo alla radice");
  if (existsSync(join(ROOT, OLD_NAME_GUARD_MARKER))) assert.equal(OLD_NAME_GUARD_ON, true);
});

test("vecchio nome fuori dall'area: l'elenco dei file in attesa è valido", () => {
  for (const [file, owner] of Object.entries(OLD_NAME_PENDING)) {
    assert.ok(existsSync(join(ROOT, file)), `${file} esiste`);
    assert.equal(copyScopeOfFile(file), "vecchio_nome", file);
    assert.match(owner, /^H\d[a-z]?$/, file);
  }
  assert.deepEqual(Object.values(OLD_NAME_PENDING).sort(), ["H2e", "H3d", "H3e", "H6i"]);
  assert.ok(OLD_NAME_SOURCES.every((entry) => existsSync(join(ROOT, entry))), "ogni file o cartella dell'elenco esiste");
});

test(`vecchio nome fuori dall'area: pulito subito dove è già cambiato; nei file in attesa da H7 (${OLD_NAME_GUARD_MARKER}) o con ${OLD_NAME_GUARD_ENV}=1`, (t) => {
  const files = OLD_NAME_SOURCES.flatMap(walk).filter((file) => copyScopeOfFile(file) === "vecchio_nome");
  assert.ok(files.length >= OLD_NAME_SOURCES.length, `${files.length} file controllati`);
  const failures: string[] = [];
  for (const file of files) {
    const found = matchesOf(file, "vecchio_nome");
    if (!found.length) continue;
    const lines = found.map((m) => `${file}: «${m.match}» in «${m.text.slice(0, 80)}»`);
    const owner = OLD_NAME_PENDING[file];
    if (owner && !OLD_NAME_GUARD_ON) for (const line of lines) t.diagnostic(`in attesa di ${owner} (si accende in H7): ${line}`);
    else failures.push(...lines);
  }
  assert.deepEqual(failures, []);
});
