import test, { before } from "node:test";
import assert from "node:assert/strict";
import type { UseCaseEventRow } from "../../../lib/db/queries/use-case-events.ts";
import { enableTsxImports } from "./referent/tsx-test-loader.ts";

// La Storia con «Chiedi al referente» e le righe automatiche di «Cosa serve» (SPEC §5.6, §P2.10.6):
// «Referente» dalla pagina pubblica, «Unbundle» per promemoria, scadenze e email; mai il nome del
// referente, mai un testo, mai il canale di una riga di «Chiedi al referente».
let history: typeof import("./section-history.tsx");
before(async () => {
  await enableTsxImports();
  history = await import("./section-history.tsx");
});

const TODAY = "2026-10-27";
function row(over: Partial<UseCaseEventRow>): UseCaseEventRow {
  return {
    id: "e1",
    at: new Date("2026-10-27T09:00:00Z"),
    actorKind: "persona",
    actorName: "Giulia Neri",
    channel: "pagina",
    action: "modificato",
    fields: ["richiesta_referente"],
    phaseBefore: null,
    phaseAfter: "inviata",
    ...over,
  };
}
const parts = (event: UseCaseEventRow) => history.historyRowParts(event, { kind: "da_costruire", today: TODAY });

test("una richiesta inviata da una persona del team: il suo nome, il testo, nessun canale", () => {
  assert.deepEqual(parts(row({})), ["27 ott", "Giulia Neri", "Chiedi al referente: richiesta inviata"]);
});

test("le righe automatiche: «Unbundle» per il sistema, «Referente» dalla pagina pubblica, senza canale", () => {
  assert.deepEqual(parts(row({ actorKind: "sistema", actorName: null, channel: "altro", phaseAfter: "promemoria_1" })), ["27 ott", "Unbundle", "Chiedi al referente: promemoria automatico inviato"]);
  assert.deepEqual(parts(row({ actorKind: "sistema", actorName: null, channel: "web", phaseAfter: "risposte" })), ["27 ott", "Referente", "Chiedi al referente: risposte ricevute"]);
  assert.deepEqual(parts(row({ actorKind: "sistema", actorName: null, channel: "altro", phaseAfter: "completata" })), ["27 ott", "Unbundle", "Chiedi al referente: tutte le risposte ricevute"]);
  // Un cambio automatico di «Cosa serve» (l'informazione passa a «Da verificare» dopo una risposta).
  const need = parts(row({ actorKind: "sistema", actorName: null, channel: "web", fields: ["cosa_serve"], phaseBefore: null, phaseAfter: null }));
  assert.equal(need[1], "Referente");
  assert.equal(need.length, 3, need.join(" · "));
});

test("un codice sconosciuto resta «Chiedi al referente»; le righe di «Cosa serve» delle persone tengono il canale", () => {
  assert.deepEqual(parts(row({ phaseAfter: "qualcosa" })), ["27 ott", "Giulia Neri", "Chiedi al referente"]);
  const person = parts(row({ fields: ["cosa_serve"], phaseAfter: null }));
  assert.equal(person[1], "Giulia Neri");
  assert.equal(person.at(-1), "pagina");
  assert.equal(history.eventFieldsText(["richiesta_referente"], "da_costruire"), "Chiedi al referente");
});

test("le altre righe della Storia non cambiano", () => {
  assert.deepEqual(parts(row({ fields: ["titolo"], phaseAfter: null })), ["27 ott", "Giulia Neri", "Modificato: Titolo", "pagina"]);
  assert.deepEqual(parts(row({ action: "creato", fields: [], actorName: null, channel: "slack", phaseAfter: null })), ["27 ott", "Creato", "da Slack"]);
});
