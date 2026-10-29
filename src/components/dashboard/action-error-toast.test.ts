import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

// Il messaggio di un errore lanciato da una server action non arriva mai al browser in produzione:
// React lo sostituisce con un testo inglese, che con il React di Next 16.4.3 è anche minimizzato
// («Minified React error #441; visit https://react.dev/errors/441…»). Un toast che mostrava
// `error.message` dopo un `catch` mostrava quel testo; il toast dice in italiano cosa non è andato,
// come `useUcAction`.
const components = new URL("../", import.meta.url);
const files = (readdirSync(components, { recursive: true }) as string[]).filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file));

test("nessun toast mostra il messaggio di un errore preso con `catch`", () => {
  assert.ok(files.length > 100, "i componenti ci sono");
  const found = new Set<string>();
  for (const file of files) {
    const source = readFileSync(new URL(file, components), "utf8");
    if (/toast\.error\(\s*\w+ instanceof Error \? \w+\.message/.test(source)) found.add(file);
    for (const match of source.matchAll(/catch \((\w+)\) \{([\s\S]*?)\n\s*\}/g)) {
      if (new RegExp(`toast\\.error\\([^)]*\\b${match[1]}\\.message`).test(match[2])) found.add(file);
    }
  }
  assert.deepEqual([...found], []);
});
