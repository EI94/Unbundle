import test from "node:test";
import assert from "node:assert/strict";
import { findHubForbidden } from "../copy-guard.ts";
import { REFERENT_REQUEST_WORD } from "./labels.ts";
import { PANEL_VIEW_KEYS, requestWordOf } from "./view.ts";

// (Rilascio 4, §11) La parola di una richiesta in «Richieste inviate»: una sola, calcolata sul server,
// senza colore. «Nessuna risposta» è la parola della campanella per lo stesso fatto.
test("la parola di ogni stato: «In attesa», «Nessuna risposta», «Risposte ricevute», «Chiusa»", () => {
  const W = REFERENT_REQUEST_WORD;
  const cases: [Parameters<typeof requestWordOf>[0], string][] = [
    [{ status: "inviata", silent: false, openItems: 2 }, W.waiting],
    [{ status: "inviata", silent: false, openItems: 0 }, W.waiting],
    [{ status: "inviata", silent: true, openItems: 2 }, W.silent],
    [{ status: "scaduta", silent: false, openItems: 1 }, W.silent],
    [{ status: "scaduta", silent: false, openItems: 0 }, W.closed],
    [{ status: "completata", silent: false, openItems: 0 }, W.answered],
    [{ status: "revocata", silent: false, openItems: 3 }, W.closed],
    [{ status: "revocata", silent: false, openItems: 0 }, W.closed],
  ];
  for (const [input, word] of cases) assert.equal(requestWordOf(input), word, JSON.stringify(input));
  assert.deepEqual(Object.values(W), ["In attesa", "Nessuna risposta", "Risposte ricevute", "Chiusa"]);
  for (const word of Object.values(W)) assert.deepEqual(findHubForbidden(word, "area"), [], word);
});

test("il pannello non porta più colori delle richieste né persone del workspace", () => {
  assert.ok(!PANEL_VIEW_KEYS.includes("requests[].tone"));
  assert.ok(PANEL_VIEW_KEYS.includes("requests[].statusLabel"));
  assert.ok(!PANEL_VIEW_KEYS.some((key) => key.startsWith("members")));
});
