import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// Rilascio 10, §4 (copy guard della Realizzazione, parte «persone» dell'ondata 5a): sulle schermate di Persone, Firme,
// Valore, KPI, Privacy, Attività, Impostazioni ed Esporta… il genere è neutro («un'altra persona», mai «un collega») e
// la realizzazione si chiama «realizzazione», mai «caso». Si controllano i testi che si vedono: stringhe e testo JSX,
// senza commenti né import.

const SRC = fileURLToPath(new URL("../../../", import.meta.url));
const CASE = join(SRC, "app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]");
const inDir = (dir: string) =>
  readdirSync(join(SRC, dir))
    .filter((n) => /\.tsx?$/.test(n) && !n.includes(".test."))
    .map((n) => join(SRC, dir, n));

const FILES = [
  ...inDir("components/uc/people"),
  ...inDir("components/uc/approvals"),
  ...inDir("components/uc/roi"),
  ...inDir("components/uc/kpi"),
  ...inDir("components/uc/privacy"),
  ...inDir("components/uc/export"),
  join(SRC, "components/uc/progress/audit-log.tsx"),
  join(SRC, "components/uc/shell/case-status-control.tsx"),
  ...["persone/page.tsx", "valore/page.tsx", "valore/kpi/page.tsx", "privacy/page.tsx", "attivita/page.tsx", "impostazioni/page.tsx", "impostazioni/settings-forms.tsx", "firme/route.ts"].map((f) => join(CASE, f)),
  ...["people.ts", "case-settings.ts", "privacy.ts", "kpi.ts", "audit.ts", "activity-period.ts"].map((f) => join(SRC, "lib/uc/views", f)),
];

/** Le stringhe e il testo JSX di un sorgente, senza commenti, import e operandi di confronto. */
function visibleTexts(file: string): string[] {
  const source = readFileSync(file, "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
    .replace(/^\s*import .*$/gm, "")
    .replace(/[!=]==\s*"[^"\n]*"/g, "");
  const out: string[] = [];
  for (const m of source.matchAll(/>([^<>{}]+)</g)) out.push(m[1]);
  for (const m of source.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)) out.push(m[1]);
  for (const m of source.matchAll(/`((?:[^`\\]|\\.)*)`/g)) out.push(m[1]);
  return out.map((t) => t.replace(/\s+/g, " ").trim()).filter((t) => /[a-zà-ÿ]{3}/i.test(t));
}

test("genere neutro: nessun «collega» o «colleghi» per una persona", () => {
  const found = FILES.flatMap((file) => visibleTexts(file).filter((t) => /\bcolleg(?:a|he|hi)\b/i.test(t)).map((t) => `${file.slice(SRC.length)}: «${t}»`));
  assert.deepEqual(found, []);
});

test("«realizzazione» a schermo, mai «caso»", () => {
  const found = FILES.flatMap((file) =>
    visibleTexts(file)
      // «un caso di prova» è un'altra cosa, e resta.
      .filter((t) => /\b(?:il|del|al|nel|dal|sul|questo|un) caso\b(?! di prova)|^Caso\b/.test(t))
      .map((t) => `${file.slice(SRC.length)}: «${t}»`),
  );
  assert.deepEqual(found, []);
  assert.ok(FILES.length > 30, `file controllati: ${FILES.length}`);
});
