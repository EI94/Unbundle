import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// L'avviso dell'ok ai fornitori di AI (RILASCIO-9a-COSTRUZIONE.md §6.3): calmo, con un'azione sola.

const source = readFileSync(new URL("./ai-consent-notice.tsx", import.meta.url), "utf8");
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

test("colori neutri: nessun rosso, nessun giallo d'allarme, nessuna icona di pericolo, nessuna finestra che si apre", () => {
  assert.doesNotMatch(code, /\b(text|bg|border|ring)-(red|rose|amber|orange|yellow|destructive)\b/, "nessun colore d'allarme");
  assert.doesNotMatch(code, /variant="destructive"/);
  assert.doesNotMatch(code, /lucide-react/, "nessuna icona");
  assert.doesNotMatch(code, /AlertTriangle|AlertCircle|ShieldAlert|TriangleAlert|OctagonAlert/);
  assert.doesNotMatch(code, /@\/components\/ui\/(dialog|sheet|popover)/, "nessuna finestra");
  assert.doesNotMatch(code, /useEffect/, "niente parte da solo");
  assert.match(code, /text-muted-foreground/);
});

test("un'azione sola per chi può darla: il pulsante non pieno di Lateral Space, il link del cliente, niente per gli altri", () => {
  assert.equal(code.match(/<Button\b/g)?.length, 1, "un pulsante solo");
  assert.match(code, /<Button type="button" variant="outline"/, "non pieno: il pulsante pieno è della pagina");
  assert.match(code, /min-h-11/, "ogni cosa che si tocca è alta almeno 44 px");
  assert.match(code, /declareSubprocessorsAction\(notice\.workspaceId, notice\.listVersion, true\)/);
  assert.match(code, /onGranted\?\.\(\);\s+router\.refresh\(\);/, "dopo l'ok: onGranted, poi la pagina si aggiorna");
  assert.match(code, /notice\.declarer === "lateral_space" \?/);
  assert.match(code, /notice\.declarer === "cliente" \?/);
  assert.match(code, /<Link href=\{notice\.settingsHref\}/);
  assert.match(code, /subprocessorsWaitingLine\(notice\.companyName\)/);
  // «Che cosa registro» apre il testo e i nomi dei fornitori, senza JavaScript.
  assert.match(code, /<details/);
  assert.match(code, /\{notice\.statement\}/);
  assert.match(code, /notice\.suppliers\.map/);
});

test("ogni testo viene da CONTEXT_TEXT.consent: niente frasi scritte nel componente", () => {
  for (const key of ["title", "bodyLs", "bodyClient", "whatIRegister", "seeAndAuthorize", "granted", "failed"]) {
    assert.ok(code.includes(`CONTEXT_TEXT.consent.${key}`), key);
  }
  // Tra i tag ci sono solo espressioni: nessuna frase scritta a mano nel disegno del componente.
  const jsx = code.slice(code.indexOf("return (\n    <section"));
  assert.ok(jsx.length > 200);
  // Un pezzo tra `>` e `<` senza segni di codice (parentesi, `?`, `:`, `=`) sarebbe testo a schermo.
  const textNodes = [...jsx.matchAll(/>([^<>{}]*)</g)].map((m) => m[1].trim()).filter((text) => /\p{L}/u.test(text) && !/[()?:=]/.test(text));
  assert.deepEqual(textNodes, []);
  // E nessuna stringa con lettere accentate o virgolette italiane (le classi e gli attributi non ne hanno).
  const italian = [...code.matchAll(/"([^"\n]*)"/g)].map((m) => m[1]).filter((text) => /[àèéìòù…«»]/.test(text));
  assert.deepEqual(italian, []);
});
