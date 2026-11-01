import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// xlsx-js-style è CommonJS con effetti collaterali (le tabelle di codepage di cpexcel.js) e il
// bundler non la elimina: se la importa write.ts, la carica ogni pagina e route che scrive un foglio.
const here = fileURLToPath(new URL(".", import.meta.url));
const srcRoot = join(here, "../..");
const read = (name: string) => readFileSync(join(here, name), "utf8");

/** Gli specificatori importati da un sorgente: import statici, `import type`, `import()` e `require()`. */
function importedSpecifiers(source: string): { specifier: string; typeOnly: boolean }[] {
  const found: { specifier: string; typeOnly: boolean }[] = [];
  for (const m of source.matchAll(/^\s*import\s+(type\s+)?[^"';]*?\bfrom\s*["']([^"']+)["']/gm)) {
    found.push({ specifier: m[2], typeOnly: Boolean(m[1]) });
  }
  for (const m of source.matchAll(/^\s*import\s*["']([^"']+)["']/gm)) found.push({ specifier: m[1], typeOnly: false });
  for (const m of source.matchAll(/\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g)) found.push({ specifier: m[1], typeOnly: false });
  return found;
}

test("write.ts non importa xlsx-js-style", () => {
  const specifiers = importedSpecifiers(read("write.ts")).map((i) => i.specifier);
  assert.ok(specifiers.includes("xlsx"), "write.ts scrive con xlsx");
  assert.deepEqual(specifiers.filter((s) => /^xlsx-js-style(\/|$)/.test(s)), []);
  assert.doesNotMatch(read("write.ts"), /xlsx-js-style["']/);
});

test("write-styled.ts scrive con xlsx-js-style e da xlsx prende solo tipi", () => {
  const imports = importedSpecifiers(read("write-styled.ts"));
  assert.ok(imports.some((i) => i.specifier === "xlsx-js-style" && !i.typeOnly));
  const fromXlsx = imports.filter((i) => /^xlsx(\/|$)/.test(i.specifier));
  assert.ok(fromXlsx.length > 0);
  assert.ok(fromXlsx.every((i) => i.typeOnly), "da xlsx solo import type");
});

/** I sorgenti di src/ fuori dai test che importano uno specificatore che soddisfa `match`. */
function importersOf(match: RegExp): string[] {
  const importers: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx|mts|js|mjs)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) {
        if (importedSpecifiers(readFileSync(path, "utf8")).some((i) => match.test(i.specifier))) importers.push(relative(srcRoot, path));
      }
    }
  };
  walk(srcRoot);
  return importers.sort();
}

test("fuori dai test, write-styled.ts lo importa solo l'export delle domande", () => {
  assert.deepEqual(importersOf(/(^|\/)write-styled(\.ts)?$/), ["lib/ai-readiness/question-doc.ts"]);
  assert.deepEqual(importersOf(/(^|\/)ai-readiness\/question-doc(\.ts)?$/), [
    "app/api/ai-readiness/assessments/[assessmentId]/questions-export/route.ts",
  ]);
});
