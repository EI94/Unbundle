import test from "node:test";
import assert from "node:assert/strict";
import { atLeast, contrast, declarations, hexRgb, parseColor, ratio, readRepo, topLevelRules } from "./test-support/color.ts";

// (Ondata 0, docs/ui-10/PROPOSTA-10.md §6.5 voce 0.24) La console della Formazione: «Ingresso chiuso», «Ingresso
// aperto», l'avviso delle impostazioni cambiate e «senza partecipazione documentata» erano `text-amber-700
// dark:text-amber-300` e simili. Nel dashboard `dark:` non vale mai (nessun elemento ha `.dark`), quindi sul tema scuro
// predefinito restava l'ambra 700, sotto 4,5:1. Ora i toni del semaforo, che valgono nei due temi.

const FILES = ["src/components/learning/admin-program.tsx", "src/components/learning/admin-join-links.tsx", "src/components/learning/register-console.tsx"];

test("the Formazione console states use the semaforo tokens, no dark: and no fixed amber or emerald", () => {
  for (const file of FILES) {
    const source = readRepo(file);
    assert.doesNotMatch(source, /(?<![\w-])dark:/, file);
    assert.doesNotMatch(source, /text-(?:amber|emerald)-\d00/, file);
  }
  const links = readRepo("src/components/learning/admin-join-links.tsx");
  assert.match(links, /label: "Ingresso chiuso", tone: "text-uc-giallo"/);
  assert.match(links, /label: "Ingresso aperto", tone: "text-uc-verde"/);
  assert.match(readRepo("src/components/learning/admin-program.tsx"), /<p role="status" className="text-sm text-uc-giallo">Il riepilogo contiene/);
  assert.match(readRepo("src/components/learning/register-console.tsx"), /className="block text-xs text-uc-giallo">\+ \{s\.undocumented\}/);
});

test("on the default dark theme the old amber was under 4.5:1; the semaforo yellow and green are well above", () => {
  const root = topLevelRules(readRepo("src/app/globals.css")).find((rule) => rule.selector === ":root");
  assert.ok(root);
  const values = declarations(root.body);
  const card = parseColor(values["--card"]).rgb;
  // Tailwind 4: amber-700 = #b45309 (in oklch nel tema di Tailwind, qui in esadecimale per il confronto).
  assert.ok(ratio(hexRgb("#b45309"), card) < 4.5, "l'ambra 700 di prima sulla card scura");
  atLeast(contrast(parseColor(values["--uc-giallo"]), card), 4.5, "uc-giallo sulla card scura");
  atLeast(contrast(parseColor(values["--uc-verde"]), card), 4.5, "uc-verde sulla card scura");
});
