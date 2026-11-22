import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

// I due blocchi di Granola (RILASCIO-9a-COSTRUZIONE.md §8.9, §11.5), letti come sorgenti: il blocco non si mostra a
// chi non è di Lateral Space, e nessun testo è scritto a mano fuori da CONTEXT_TEXT.

const DIR = new URL("./", import.meta.url);
const read = (name: string) => readFileSync(new URL(name, DIR), "utf8");
const FILES = (readdirSync(DIR) as string[]).filter((name) => name.endsWith(".tsx"));
/** Il codice senza commenti. */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1").replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "");

test("i file del blocco: il componente server, il suo pannello client e le regole delle call", () => {
  // (Rilascio 10, ondata 6b) Il blocco delle Impostazioni (`granola-card*.tsx`) non c'è più: il collegamento sta nel
  // foglio «Il tuo account», le regole delle call nelle Fonti, sotto Granola, chiuse.
  assert.deepEqual(FILES.sort(), ["granola-inbox-panel.tsx", "granola-inbox.tsx", "granola-rules.tsx"]);
  assert.doesNotMatch(read("granola-inbox.tsx"), /^"use client"/m, "granola-inbox.tsx");
  for (const client of ["granola-inbox-panel.tsx", "granola-rules.tsx"]) assert.match(read(client), /^"use client";/, client);
  assert.match(code(read("granola-inbox-panel.tsx")), /<Fold id="granola-regole-cliente" title=\{T\.rulesTitle\(workspaceName\)\}[^>]*>\s*<GranolaRulesFields workspaceId=\{workspaceId\} rules=\{rules\} \/>/);
  // Le regole si leggono solo nel blocco intero e con un collegamento attivo, dopo il controllo di chi guarda.
  const inbox = code(read("granola-inbox.tsx"));
  assert.match(inbox, /const rules = !compact && status\.connected && status\.status !== "da_ricollegare" \? await readGranolaRules\(who\.actor\) : null;/);
});

test("a chi non è di Lateral Space il blocco non c'è: il controllo viene prima di ogni lettura", () => {
  for (const [file, load] of [["granola-inbox.tsx", "loadGranolaStatus("]] as const) {
    const source = code(read(file));
    const gate = source.search(/if \([^)]*!contextAbilities\([^)]*\)\.canUseGranola\) return null;/);
    assert.ok(gate > 0, `${file}: senza canUseGranola il componente risponde null`);
    assert.ok(source.indexOf(load) > gate, `${file}: lo stato si legge solo dopo il controllo`);
  }
  // La pagina passa da contextActorFromSession: senza sessione o senza accesso, niente.
  assert.match(code(read("granola-inbox.tsx")), /const who = await contextActorFromSession\(workspaceId\);\s*\/?\/?[^\n]*\n?\s*if \(!who\.ok \|\|/);
});

test("nessun testo scritto a mano: ogni parola a schermo viene da CONTEXT_TEXT", () => {
  for (const file of FILES) {
    const source = code(read(file));
    // Il testo tra due etichette JSX: solo espressioni, mai parole.
    const jsxText = [...source.matchAll(/>\s*([^<>{}\n]*\p{L}[^<>{}\n]*)\s*[<{]/gu)].map((m) => m[1].trim()).filter((text) => text && !/^[=&|?:)(\s]+/.test(text) && !/=>/.test(text));
    assert.deepEqual(jsxText, [], `${file}: testo nel JSX`);
    // Una riga fatta solo di parole, in un file JSX, è testo a schermo.
    const KEYWORDS = /^\s*(?:return|const|let|await|throw|break|continue|export|import|else|case|default|if|for|while|type|interface|async|function)\b/;
    const wordLines = source.split("\n").filter((line) => !KEYWORDS.test(line) && /^\s*\p{L}+(?:\s+[\p{L}\p{N}.,:!?'’"-]+)+\s*$/u.test(line));
    assert.deepEqual(wordLines, [], `${file}: una riga di testo nel JSX`);
    // Le stringhe con lettere accentate, virgolette basse o puntini sono testi in italiano.
    const italian = [...source.matchAll(/(["'`])((?:(?!\1)[^\\\n]|\\.)*)\1/g)].map((m) => m[2]).filter((text) => /[àèéìòùÀÈÉÌÒÙ«»…]/.test(text));
    assert.deepEqual(italian, [], `${file}: una stringa in italiano`);
    // Gli attributi che si leggono (etichette per i lettori di schermo, segnaposto, titoli) vengono da CONTEXT_TEXT.
    for (const match of source.matchAll(/\b(aria-label|placeholder|title|alt)="([^"]*)"/g)) assert.fail(`${file}: ${match[1]}="${match[2]}" scritto a mano`);
  }
});

test("i testi dei blocchi sono quelli di CONTEXT_TEXT.granola (più i pochi comuni di Contesto)", () => {
  const used = new Set<string>();
  for (const file of FILES) for (const match of code(read(file)).matchAll(/CONTEXT_TEXT\.([a-z]+)\./g)) used.add(match[1]);
  for (const file of FILES) for (const match of code(read(file)).matchAll(/\bT\.([a-zA-Z]+)/g)) used.add(`granola.${match[1]}`);
  const outside = [...used].filter((key) => !key.startsWith("granola"));
  assert.deepEqual(outside.sort(), ["add", "notes"], "solo «Salvo…» e «Togli», comuni a Contesto");
  for (const file of FILES.filter((f) => f.endsWith("-panel.tsx") || f === "granola-rules.tsx")) assert.match(read(file), /const T = CONTEXT_TEXT\.granola;/, file);
});

test("«Da smistare» aperto: una riga mentre legge da Granola, e una quando non c'è niente; mai «Aggiorno da Granola…»", () => {
  const panel = code(read("granola-inbox-panel.tsx"));
  const unsorted = panel.slice(panel.indexOf("function UnsortedMeetings("));
  assert.ok(unsorted.length > 0);
  assert.match(unsorted, /\{loading && <p[^>]*>\{T\.unsortedLoading\}<\/p>\}/);
  assert.match(unsorted, /\{meetings && meetings\.length === 0 && <p[^>]*>\{T\.unsortedEmpty\}<\/p>\}/);
  assert.doesNotMatch(unsorted, /T\.refreshing/, "leggere l'elenco non aggiorna Granola");
});

test("«Da smistare» sul telefono: i due pulsanti vanno a capo, e «Assegna a …» con un nome lungo va a capo nel suo testo", () => {
  const source = code(read("granola-inbox-panel.tsx"));
  const row = source.slice(source.indexOf("onClick={() => assign(meeting)}") - 400, source.indexOf("onClick={() => assign(meeting)}"));
  assert.match(row, /<div className="flex min-w-0 flex-wrap gap-2 sm:shrink-0">/, "la riga dei pulsanti va a capo");
  assert.match(row, /<Button variant="outline" className="[^"]*\bwhitespace-normal\b[^"]*\bmax-w-full\b|<Button variant="outline" className="[^"]*\bmax-w-full\b[^"]*\bwhitespace-normal\b/, "il testo di «Assegna a …» va a capo");
  assert.match(row, /\bmin-h-11\b/, "e resta alto almeno 44 px");
});

test("nel blocco di Granola ogni pulsante è «outline» o «ghost», anche «Salva»", () => {
  for (const file of ["granola-inbox-panel.tsx", "granola-rules.tsx"]) {
    const buttons = [...code(read(file)).matchAll(/<Button\b[^>]*>/g)].map((m) => m[0]);
    assert.ok(buttons.length > 0, file);
    for (const button of buttons) assert.match(button, /\bvariant="(?:outline|ghost)"/, `${file}: ${button}`);
  }
  assert.match(code(read("granola-rules.tsx")), /<Button type="button" variant="outline"[^>]*onClick=\{save\}>/);
});

test("la riga di Granola nella Memoria: il link a «Da smistare» si tocca in un'area alta almeno 44 px", () => {
  const source = code(read("granola-inbox-panel.tsx"));
  const compact = source.slice(source.indexOf("if (compact) {"), source.indexOf("if (!connected || expired) {"));
  assert.match(compact, /<p role="status" className="[^"]*\bmin-h-11\b[^"]*">/);
  // (Rilascio 10, §3.7) La vista si chiama «Fonti»: il link va lì diretto.
  assert.match(compact, /<Link className="[^"]*\binline-flex\b[^"]*\bmin-h-11\b[^"]*" href=\{`\/dashboard\/\$\{workspaceId\}\/contesto\?vista=fonti`\}>/);
});
