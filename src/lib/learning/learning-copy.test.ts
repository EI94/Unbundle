import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { copyScopeOfFile, findHubForbiddenIn } from "../use-cases/copy-guard.ts";
import { LEARNING_TEXT } from "./text.ts";

// (Rilascio 10, ondata 7a «Formazione», docs/ui-10/PROPOSTA-10.md §4, §4.2) Le parole della Formazione: le regole della
// dashboard (`copy-guard.ts`, ambito «area», che ora comprende i componenti e le pagine della Formazione), «AI» e mai
// «IA» a schermo (la norma del Registro e il PDF tengono la loro), niente codici del turno né fusi orari, una parola per
// cosa («Corso · Lezione · Esercizio · Prova · Risultato»).

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** Tutte le stringhe del modulo dei testi, anche quelle che escono dalle funzioni (con argomenti inventati). */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (typeof value === "function") {
    const fn = value as (...args: unknown[]) => unknown;
    for (const args of [[1, 2], [3, 5], ["lun 23 nov, 14:30", 4], [2, 5, 30]]) {
      try { strings(fn(...args), out); } catch { /* una funzione con altri argomenti */ }
    }
  } else if (value && typeof value === "object") for (const entry of Object.values(value)) strings(entry, out);
  return out;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const path = join(dir, entry);
    if (statSync(join(ROOT, path)).isDirectory()) out.push(...walk(path));
    else if (/\.(?:ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) out.push(path);
  }
  return out;
}

/** Il sorgente senza commenti: le parole a schermo stanno nei testi, non nelle note per chi legge il codice. */
function withoutComments(source: string): string {
  return source.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

/**
 * I testi che possono andare a schermo: le stringhe e i testi JSX con una parola vera (una lettera e uno spazio, o una
 * maiuscola), non i nomi dei parametri, le classi o le chiavi.
 */
function screenTexts(source: string): string[] {
  const code = withoutComments(source);
  // Le espressioni dentro un testo `…${x}…` sono codice: restano le parole attorno.
  const literals = [...code.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)].map((m) => (m[1] ?? m[2] ?? m[3] ?? "").replace(/\$\{[^}]*\}?/g, " "));
  const jsx = [...code.matchAll(/>([^<>{}]+)</g)].map((m) => m[1]).filter((text) => !/=>|[;=]/.test(text));
  return [...literals, ...jsx].filter((text) => /[A-Za-zÀ-ÿ]/.test(text) && (/\s/.test(text.trim()) || /^[A-ZÀ-Ý]/.test(text.trim())) && !/^[a-z0-9-]+(?:\s[a-z0-9:/[\]().%-]+)+$/.test(text.trim()));
}

const texts = strings(LEARNING_TEXT);
const files = [...walk("src/components/learning"), ...walk("src/app/(dashboard)/dashboard/[workspaceId]/learning")].map((path) => relative(ROOT, join(ROOT, path)));

test("the Formazione text module follows the dashboard words, says «AI», and shows no codes", () => {
  assert.ok(texts.length > 300, `${texts.length} testi controllati`);
  assert.deepEqual(findHubForbiddenIn(texts, "area").map((m) => `«${m.match}» in «${m.text}»`), []);
  assert.deepEqual(texts.filter((text) => /\bIA\b/.test(text)), [], "«AI», non «IA»");
  // «attività» resta per chi tiene il corso: le attività di una lezione si aprono e si sospendono (§3.9, «Lezioni»).
  assert.deepEqual(texts.filter((text) => /Europe\/Rome|cohort|\bturn[oi]\b|percorso/i.test(text)), [], "Lezione, Esercizio, Corso; niente codici né fusi");
  assert.ok(texts.includes("Registro della formazione AI"));
});

test("every Formazione screen is in the dashboard copy guard (the course link page stays an outside page)", () => {
  for (const file of files) {
    const expected = file === "src/components/learning/join-course-form.tsx" ? "esterno" : "area";
    assert.equal(copyScopeOfFile(file), expected, file);
  }
  assert.ok(files.includes("src/components/learning/program-overview.tsx"));
  assert.ok(files.includes("src/app/(dashboard)/dashboard/[workspaceId]/learning/register/page.tsx"));
});

test("no «IA», cohort codes or time zones written on a Formazione screen", () => {
  const found: string[] = [];
  for (const file of files) {
    const source = readFileSync(join(ROOT, file), "utf8");
    const shown = screenTexts(source);
    for (const [pattern, why] of [
      [/\bIA\b/, "«IA»"],
      // Il fuso come opzione del formato delle date è codice; in una frase andrebbe a schermo.
      [/Europe\/Rome\S*\s|\s\S*Europe\/Rome/, "il fuso orario a schermo"],
      [/\b(?:Turno|Turni|turno|turni)\b/, "«turno»: si dice «lezione»"],
    ] as const) {
      for (const text of shown) if (pattern.test(text)) found.push(`${file}: ${why} («${text.trim().slice(0, 60)}»)`);
    }
    // Il codice del turno come testo JSX: `>{x.cohortId}<` o `· {x.cohortId}`.
    if (/[>·]\s*\{\w+\.cohortId\}|\{\w+\.cohortId\}\s*[<·]/.test(withoutComments(source))) found.push(`${file}: il codice del turno a schermo`);
  }
  // «Turno» resta il nome di una colonna del file scaricato (`exportLearningCsv`): sulla pagina lo dice l'elenco delle colonne.
  assert.deepEqual(found.filter((entry) => !(entry.startsWith("src/components/learning/results-export.tsx") && entry.includes("«turno»"))), []);
});
