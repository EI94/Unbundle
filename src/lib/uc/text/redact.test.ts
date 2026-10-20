import test from "node:test";
import assert from "node:assert/strict";
import { REDACTION_PLACEHOLDER, findNames, redactPersonalMentions } from "./redact.ts";

test("names from the list become «[referente]», whole words only, any case or accent", () => {
  const r = redactPersonalMentions("Zebedeo ha detto a ZEBEDEO e a zebedeoni: Nicolò lo sa.", ["Zebedeo", "Nicolo"]);
  assert.equal(r.text, "[referente] ha detto a [referente] e a zebedeoni: [referente] lo sa.");
  assert.equal(r.count, 3);
  assert.equal(REDACTION_PLACEHOLDER, "[referente]");
});

test("full names win over parts and adjacent mentions merge", () => {
  assert.deepEqual(redactPersonalMentions("Parla con Zebedeo Quarzi.", ["Zebedeo", "Zebedeo Quarzi", "Quarzi"]), {
    text: "Parla con [referente].",
    count: 1,
  });
  assert.deepEqual(redactPersonalMentions("Parla con Zebedeo Quarzi.", ["Zebedeo", "Quarzi"]), { text: "Parla con [referente].", count: 1 });
  assert.deepEqual(redactPersonalMentions("Zebedeo e Quarzi", ["Zebedeo", "Quarzi"]), { text: "[referente] e [referente]", count: 2 });
  assert.deepEqual(redactPersonalMentions("D'Ambrosio Zebedeo", ["D'Ambrosio"]).text, "[referente] Zebedeo");
});

test("emails, phones and tax codes are redacted even without names", () => {
  const r = redactPersonalMentions("scrivi a ufficio@esempio.it o chiama il +39 333 1234567 (CF RSSMRA80A01H501U)", []);
  assert.equal(r.text, "scrivi a [referente] o chiama il [referente] (CF [referente])");
  assert.equal(r.count, 3);
});

test("texts without mentions are returned in NFC and unchanged", () => {
  assert.deepEqual(redactPersonalMentions("café 2.000 €", ["Zebedeo"]), { text: "café 2.000 €", count: 0 });
  assert.deepEqual(redactPersonalMentions("", ["Zebedeo"]), { text: "", count: 0 });
  assert.deepEqual(redactPersonalMentions("ok", ["", "  ", "a", 3 as never]), { text: "ok", count: 0 });
});

test("names are matched word by word, whatever the punctuation of the list", () => {
  assert.deepEqual(findNames("Prova (xy) e A.B", ["(xy)", "A.B"]).length, 2);
  // Un nome di una sola lettera non si cerca: oscurerebbe mezzo testo.
  assert.deepEqual(findNames("x e y", ["(x)"]), []);
  assert.equal(redactPersonalMentions("Gian-Maria, Gian Maria e GianMaria", ["Gian-Maria"]).text, "[referente], [referente] e GianMaria");
});
