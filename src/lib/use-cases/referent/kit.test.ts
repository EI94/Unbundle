import test from "node:test";
import assert from "node:assert/strict";
import { findHubForbidden } from "../copy-guard.ts";
import { REFERENT_KIT_TEXT, kitClientLine, kitProgress } from "./kit.ts";

// (Rilascio 10, D5) Il kit del referente: le parole che `/rispondi` e `/r` dicono uguali. Dati inventati.

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => strings(v, out));
  return out;
}

test("le parole comuni: «Non lo so», «Iniziamo», «Avanti» senza freccia, le due schede, un solo numero", () => {
  const K = REFERENT_KIT_TEXT;
  assert.equal(K.dontKnow, "Non lo so");
  assert.equal(K.start, "Iniziamo");
  assert.equal(K.next, "Avanti");
  assert.deepEqual({ ...K.linkGone }, { title: "Questo link non vale più.", text: "Rispondi all'email che hai ricevuto: arriva a chi ti ha scritto." });
  assert.deepEqual({ ...K.error }, { title: "Questa pagina non si è caricata.", text: "Le risposte che hai già inviato sono salve.", retry: "Riprova" });
  assert.equal(K.askOther, "Chiedi a un'altra persona", "genere neutro");
  assert.equal(K.reference, "Riferimento");
  assert.equal(kitProgress(2, 5, "saved"), "2 di 5 · salvato");
  assert.equal(kitProgress(3, 12, "saving"), "3 di 12 · salvataggio…");
  assert.equal(kitProgress(2, 5, null), "2 di 5");
  assert.equal(kitClientLine("Cliente Demo"), "Cliente Demo · con Lateral Space");
  assert.equal(kitClientLine("  Cliente   Demo "), "Cliente Demo · con Lateral Space");
  for (const empty of ["", "   ", null, undefined]) assert.equal(kitClientLine(empty), null, String(empty));
});

test("fuori dalla dashboard: nessuna parola vietata, niente inglese, «caso d'uso», mai «Non ce l'ho» né «collega»", () => {
  const texts = strings(REFERENT_KIT_TEXT);
  assert.ok(texts.length > 15);
  for (const text of texts) {
    assert.deepEqual(findHubForbidden(text, "esterno"), [], text);
    assert.doesNotMatch(text, /\b(token|MCP|workflow|login|Chiedi a un collega)\b/i, text);
  }
  assert.ok(texts.some((t) => /cas[oi] d'uso/.test(t)));
});
