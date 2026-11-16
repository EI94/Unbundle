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

test("i file del blocco: due componenti server e i loro due pannelli client", () => {
  assert.deepEqual(FILES.sort(), ["granola-card-panel.tsx", "granola-card.tsx", "granola-inbox-panel.tsx", "granola-inbox.tsx"]);
  for (const server of ["granola-card.tsx", "granola-inbox.tsx"]) assert.doesNotMatch(read(server), /^"use client"/m, server);
  for (const client of ["granola-card-panel.tsx", "granola-inbox-panel.tsx"]) assert.match(read(client), /^"use client";/, client);
});

test("a chi non è di Lateral Space il blocco non c'è: il controllo viene prima di ogni lettura", () => {
  for (const [file, load] of [
    ["granola-card.tsx", "loadGranolaStatus("],
    ["granola-inbox.tsx", "loadGranolaStatus("],
  ] as const) {
    const source = code(read(file));
    const gate = source.search(/if \([^)]*!contextAbilities\([^)]*\)\.canUseGranola\) return null;/);
    assert.ok(gate > 0, `${file}: senza canUseGranola il componente risponde null`);
    assert.ok(source.indexOf(load) > gate, `${file}: lo stato si legge solo dopo il controllo`);
  }
  // La persona del blocco in Impostazioni è quella della sessione, mai un'altra.
  assert.match(code(read("granola-card.tsx")), /session\.user\.id !== props\.userId\) return null;/);
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
  for (const file of FILES.filter((f) => f.endsWith("-panel.tsx"))) assert.match(read(file), /const T = CONTEXT_TEXT\.granola;/, file);
});
