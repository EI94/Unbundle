import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chunkDocument } from "./chunker.ts";

// (Rilascio 9a, RILASCIO-9a-COSTRUZIONE.md §10.6) `chunkDocument` non finiva mai: arrivato in fondo al testo, il giro
// ripartiva 200 caratteri indietro. Il giro è sincrono, e un tempo massimo del test non lo fermerebbe: la prima prova
// lo esegue in un processo figlio, che senza la correzione viene fermato dopo 5 secondi.

const MODULE = fileURLToPath(new URL("./chunker.ts", import.meta.url));
/** Vero dopo la prima prova: le altre chiamano la funzione in questo processo, e senza la correzione lo bloccherebbero. */
let finishes = false;
const mustFinish = () => assert.ok(finishes, "chunkDocument non finisce: vedi la prima prova");

test("chunkDocument finisce: un testo corto dà un pezzo solo (in un processo figlio, con 5 secondi di tempo)", () => {
  const script = `
    const { chunkDocument } = await import(${JSON.stringify(MODULE)});
    const short = chunkDocument("parola ".repeat(80));
    const long = chunkDocument("Una frase di prova. ".repeat(400));
    if (short.length !== 1 || long.length < 5) process.exit(2);
    process.stdout.write(String(short.length) + " " + String(long.length));
  `;
  const child = spawnSync(process.execPath, ["--no-warnings", "--input-type=module", "-e", script], { timeout: 5000, encoding: "utf8" });
  assert.equal(child.error, undefined, "il processo figlio è finito da solo (senza la correzione viene fermato dopo 5 secondi)");
  assert.equal(child.signal, null);
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /^1 \d+$/);
  finishes = true;
});

test("un testo corto: un pezzo; vuoto o troppo corto: nessuno", () => {
  mustFinish();
  const short = "parola ".repeat(80);
  assert.deepEqual(chunkDocument(short), [short.trim()]);
  assert.deepEqual(chunkDocument(""), []);
  assert.deepEqual(chunkDocument("troppo corto"), []);
  const exact = "x".repeat(1000);
  assert.deepEqual(chunkDocument(exact), [exact]);
});

test("un testo di 5.000 caratteri: pezzi da al massimo 1.000 che lo coprono tutto, con 200 caratteri in comune", () => {
  mustFinish();
  // Parole numerate, così ogni punto del testo si riconosce.
  const words = Array.from({ length: 715 }, (_, i) => `p${String(i).padStart(5, "0")}`);
  const text = words.join(" ");
  assert.equal(text.length, 5004);
  const chunks = chunkDocument(text);
  assert.ok(chunks.length >= 6 && chunks.length <= 8, String(chunks.length));
  for (const chunk of chunks) assert.ok(chunk.length > 50 && chunk.length <= 1000, String(chunk.length));
  // Ogni parola sta in almeno un pezzo, per intero.
  for (const word of words) assert.ok(chunks.some((chunk) => chunk.split(" ").includes(word)), word);
  // Ogni pezzo riparte dentro quello di prima: gli ultimi 150 caratteri di un pezzo sono anche nel successivo.
  for (let i = 0; i + 1 < chunks.length; i++) {
    const tail = chunks[i].slice(-150);
    assert.ok(chunks[i + 1].includes(tail), `tra il pezzo ${i} e il ${i + 1}`);
    assert.ok(chunks[i + 1].indexOf(tail) <= 60, "in testa al pezzo dopo");
  }
  assert.ok(chunks[0].startsWith("p00000") && chunks.at(-1)?.endsWith("p00714"));
});

test("il taglio è a un a capo o a un punto, quando ce n'è uno nella seconda metà del pezzo", () => {
  mustFinish();
  const sentence = "Il magazzino riceve la merce ogni mattina alle otto. ";
  const chunks = chunkDocument(sentence.repeat(60));
  assert.ok(chunks.length > 3);
  for (const chunk of chunks.slice(0, -1)) assert.ok(chunk.endsWith("."), chunk.slice(-20));
  const lines = chunkDocument(Array.from({ length: 80 }, (_, i) => `Riga numero ${i} del documento di prova, abbastanza lunga.`).join("\n"));
  for (const chunk of lines.slice(0, -1)) assert.match(chunk, /lunga\.$/);
});
