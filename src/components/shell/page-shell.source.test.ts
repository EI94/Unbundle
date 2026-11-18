import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// (Rilascio 10, ondata 2a «Cornice», docs/ui-10/PROPOSTA-10.md §5.2, §5.3, regola 11) Una sola anatomia: ogni pagina
// della dashboard sta in `PageContainer`, con un H1 solo stile (24/32, semibold, senza occhiello maiuscolo). Controllato
// sul sorgente: una pagina nuova senza contenitore, o un H1 di un'altra misura, fanno fallire il test.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const APP = join(ROOT, "src/app/(dashboard)");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

function pages(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) pages(path, out);
    else if (entry === "page.tsx") out.push(relative(ROOT, path));
  }
  return out.sort();
}

const W = "src/app/(dashboard)/dashboard/[workspaceId]";

/** Le pagine che non disegnano niente: reindirizzano o rispondono «non trovato». */
const REDIRECTS = [
  `${W}/ai-readiness/preview/[assessmentId]/page.tsx`,
  `${W}/setup/context/page.tsx`,
  `${W}/use-cases/[useCaseId]/proposte/page.tsx`,
  `${W}/use-cases/[useCaseId]/progetto/page.tsx`,
  `${W}/learning/[programId]/live/page.tsx`,
  `${W}/learning/[programId]/manage/page.tsx`,
  `${W}/casi-duso/[caseId]/[...resto]/page.tsx`,
];

/** Le pagine che hanno una cornice loro, a tutta pagina, con il motivo. */
const OWN_FRAME: Record<string, string> = {
  [`${W}/mapping/page.tsx`]: "la board: la sua grafica resta (scelta del titolare del 15/11), con la testata fissa e il titolo in Instrument Serif (§5.1)",
  [`${W}/mapping/[deptId]/page.tsx`]: "la board di un'unità, come sopra",
  [`${W}/setup/leadership/page.tsx`]: "la chat dell'Intervista iniziale, alta quanto lo schermo, con la colonna laterale",
};

/** Le pagine dell'ondata 2b «Home» (in parallelo con questa): le rifà lei, con il suo contenitore. */
const WAVE_HOME = [`${W}/page.tsx`, `${W}/programma/page.tsx`];

/** Le pagine che disegnano con un componente che sta in `PageContainer`. */
const VIA: Array<[RegExp, string, string]> = [
  [/^src\/app\/\(dashboard\)\/dashboard\/\[workspaceId\]\/learning\//, "LearningShell|ProgramOverview", "src/components/learning/learning-shell.tsx"],
];

test("ogni pagina della dashboard sta in PageContainer, direttamente o con il componente che la disegna", () => {
  const all = pages(APP);
  assert.ok(all.length > 60, `pagine trovate: ${all.length}`);
  for (const path of [...REDIRECTS, ...Object.keys(OWN_FRAME), ...WAVE_HOME]) assert.ok(existsSync(join(ROOT, path)), `elenco vecchio: ${path}`);
  const missing: string[] = [];
  for (const path of all) {
    const source = read(path);
    if (source.includes("<PageContainer")) continue;
    if (REDIRECTS.includes(path)) {
      assert.match(source, /\b(redirect|permanentRedirect|notFound)\(|<RedirectKeepingHash\b/, `${path}: non reindirizza`);
      assert.doesNotMatch(source, /<(div|main|section|header|h1)\b/, `${path}: disegna qualcosa`);
      continue;
    }
    if (path in OWN_FRAME || WAVE_HOME.includes(path)) continue;
    const via = VIA.find(([pattern]) => pattern.test(path));
    if (via && new RegExp(`<(${via[1]})\\b`).test(source)) continue;
    missing.push(path);
  }
  assert.deepEqual(missing, [], "pagine senza PageContainer");
  // I componenti che disegnano le pagine della Formazione stanno nel contenitore.
  assert.match(read("src/components/learning/learning-shell.tsx"), /return <PageContainer className="space-y-6">/);
  assert.match(read("src/components/learning/program-overview.tsx"), /<LearningShell\b/);
  assert.doesNotMatch(read("src/components/learning/learning-shell.tsx"), /<main\b/, "un solo <main>, quello della cornice");
});

test("un solo stile di H1: 24/32 semibold, la classe comune o la stessa scritta, mai un'altra misura", () => {
  assert.match(read("src/components/dashboard/page-container.tsx"), /export const PAGE_TITLE_CLASS = "text-2xl font-semibold tracking-tight";/);
  const bad: string[] = [];
  const check = (path: string, h1: string) => {
    if (/className="sr-only"/.test(h1)) return;
    const shared = /className=\{PAGE_TITLE_CLASS\}|className=\{`\$\{PAGE_TITLE_CLASS\}[ a-z0-9:-]*`\}/.test(h1);
    const literal = /className="[^"]*\btext-2xl font-semibold tracking-tight\b[^"]*"/.test(h1);
    if (!shared && !literal) bad.push(`${path}: ${h1}`);
    if (/\b(?:sm:|md:|lg:)?text-(?:lg|xl|3xl|4xl)\b|\bfont-(?:bold|medium)\b/.test(h1)) bad.push(`${path}: ${h1}`);
  };
  const files = [
    ...pages(APP).filter((path) => !WAVE_HOME.includes(path) && !(path in OWN_FRAME)),
    // Le testate che le pagine usano per il loro H1.
    "src/components/learning/learning-shell.tsx",
    "src/components/uc/shell/case-header.tsx",
    "src/components/use-cases/hub-header.tsx",
    "src/components/use-cases/detail/detail-header.tsx",
    "src/components/use-cases/detail/inline-text-field.tsx",
    "src/components/context/context-page.tsx",
    "src/components/context/confirm-view.tsx",
    "src/components/context/verify-view.tsx",
    "src/components/dashboard/page-load-error.tsx",
  ];
  for (const path of files) {
    for (const match of read(path).matchAll(/<h1\b[^>]*>/g)) check(path, match[0]);
  }
  assert.deepEqual(bad, []);
});

test("nessun occhiello maiuscolo sopra il titolo della pagina", () => {
  const bad: string[] = [];
  for (const path of pages(APP).filter((page) => !WAVE_HOME.includes(page))) {
    const source = read(path);
    for (const match of source.matchAll(/<h1\b/g)) {
      const before = source.slice(Math.max(0, match.index - 400), match.index);
      if (/className="[^"]*\buppercase\b[^"]*"/.test(before.slice(before.lastIndexOf("<div"))) && /tracking-wide/.test(before)) bad.push(path);
    }
  }
  assert.deepEqual(bad, []);
});
