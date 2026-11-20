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
  ...["people.ts", "case-settings.ts", "privacy.ts", "kpi.ts", "audit.ts", "activity-period.ts", "domande-text.ts", "progress.ts"].map((f) => join(SRC, "lib/uc/views", f)),
  // (Rilascio 10, §3.5) Anche Domande, la testata e la Panoramica.
  ...inDir("components/uc/catalog"),
  ...inDir("components/uc/overview"),
  ...["layout.tsx", "page.tsx", "not-found.tsx", "error.tsx", "domande/page.tsx", "domande/verifica/page.tsx"].map((f) => join(CASE, f)),
  // (Ondata 5b) La Costruzione e i suoi testi.
  ...["costruzione/page.tsx", "costruzione/project-forms.tsx"].map((f) => join(CASE, f)),
  join(SRC, "lib/uc/views/construction.ts"),
  join(SRC, "components/agent-factory/eval-summary.tsx"),
  // (Ondata 5b) La Soluzione da leggere, i suoi pannelli e le due pagine senza scheda.
  ...["soluzione/page.tsx", "soluzione/mappa/page.tsx", "soluzione/dati/page.tsx"].map((f) => join(CASE, f)),
  ...["process-board.tsx", "step-panel.tsx"].map((f) => join(SRC, "components/uc/map", f)),
  join(SRC, "lib/uc/views/solution.ts"),
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

/**
 * Genere neutro per una persona: niente «collega/colleghi», niente pronomi che dicono il genere («lui», «lei», «-gli»
 * attaccato al verbo, «gli arrivano», «lo chiamate»). «gli» articolo («gli accessi») e «le» per le cose («le domande»)
 * restano.
 */
const GENDERED = /\bcolleg(?:a|he|hi)\b|\b(?:lui|lei)\b|\b[a-zàèéìòù]+(?:ar|er|ir)(?:gli|glielo|gliela)\b|\bgli (?:arriv|mand|chied|scriv|invi|serv|rest|passa|tocca)|\b(?:lo|la) (?:chiamate|chiamano|indicate|scegliete)\b/i;

test("il controllo del genere riconosce le forme di prima", () => {
  for (const old of ["Si possono mandargli domande.", "Come lo chiamate (facoltativo)", "Le domande di questo ruolo gli arrivano per prime.", "restano a lei o a lui", "Delega da un collega."]) {
    assert.match(old, GENDERED, old);
  }
  for (const ok of ["Può ricevere domande.", "Come chiamate il suo ruolo (facoltativo)", "gli accessi ai dati personali", "Le domande di questo ruolo le riceve per prime.", "un'altra persona"]) {
    assert.doesNotMatch(ok, GENDERED, ok);
  }
});

test("genere neutro: nessun «collega» e nessun pronome che dice il genere di una persona", () => {
  const found = FILES.flatMap((file) => visibleTexts(file).filter((t) => GENDERED.test(t)).map((t) => `${file.slice(SRC.length)}: «${t}»`));
  assert.deepEqual(found, []);
});

test("«realizzazione» a schermo, mai «caso»", () => {
  const found = FILES.flatMap((file) =>
    visibleTexts(file)
      // «un caso di prova» è un'altra cosa, e resta.
      // Maiuscole comprese («Questo caso…»); le chiavi interne («caso.creato») non sono testo a schermo.
      .filter((t) => /\b(?:il|del|al|nel|dal|sul|questo|un) caso\b(?! di prova)/i.test(t) || /^Caso\b/.test(t))
      .map((t) => `${file.slice(SRC.length)}: «${t}»`),
  );
  assert.deepEqual(found, []);
  assert.ok(FILES.length > 30, `file controllati: ${FILES.length}`);
});
