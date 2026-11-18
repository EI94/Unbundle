import test from "node:test";
import assert from "node:assert/strict";
import { dayLabel, factSourceLabel } from "./labels.ts";

// Da dove viene un fatto, a parole (RILASCIO-9a-COSTRUZIONE.md §7.2).

const TODAY = "2026-11-16";

test("la fonte di un fatto: call, documento, scritto a mano, senza fonte", () => {
  assert.deepEqual(factSourceLabel({ origin: "fonte", sourceKind: "appunti", sourceOccurredOn: "2026-11-14" }, TODAY), { kind: "call", label: "Call 14 nov", word: "Call", day: "14 nov" });
  assert.deepEqual(factSourceLabel({ origin: "fonte", sourceKind: "trascrizione", sourceOccurredOn: "2026-11-14" }, TODAY).label, "Call 14 nov");
  assert.deepEqual(factSourceLabel({ origin: "fonte", sourceKind: "documento", sourceOccurredOn: "2026-11-14" }, TODAY), { kind: "documento", label: "Documento 14 nov", word: "Documento", day: "14 nov" });
  assert.deepEqual(factSourceLabel({ origin: "manuale", sourceKind: null, sourceOccurredOn: null }, TODAY), { kind: "manuale", label: "Scritto a mano", word: "Scritto a mano", day: null });
  // L'appunto è stato tolto: il fatto resta, «senza fonte».
  assert.deepEqual(factSourceLabel({ origin: "fonte", sourceKind: null, sourceOccurredOn: null }, TODAY), { kind: "senza_fonte", label: "senza fonte", word: "senza fonte", day: null });
  // Una domanda nata da «Chiedi al contesto» è scritta a mano.
  assert.equal(factSourceLabel({ origin: "chiedi", sourceKind: null, sourceOccurredOn: null }, TODAY).kind, "manuale");
});

test("le date: «14 nov», con l'anno se è un altro; mai «14/11»", () => {
  assert.equal(dayLabel("2026-11-14", TODAY), "14 nov");
  assert.equal(dayLabel("2025-11-14", TODAY), "14 nov 2025");
  assert.equal(factSourceLabel({ origin: "fonte", sourceKind: "appunti", sourceOccurredOn: "2025-12-03" }, TODAY).label, "Call 3 dic 2025");
  assert.equal(dayLabel(new Date("2026-11-14T23:30:00Z"), TODAY), "15 nov", "il giorno è quello di Roma");
  assert.equal(dayLabel(null, TODAY), "");
  assert.equal(dayLabel("non una data", TODAY), "");
  assert.equal(factSourceLabel({ origin: "fonte", sourceKind: "appunti", sourceOccurredOn: null }, TODAY).label, "Call");
});

test("(9b) le risposte del referente si leggono «Referente 14 nov», le cose imparate «Costruzione 14 nov»: mai «Call»", () => {
  assert.deepEqual(factSourceLabel({ origin: "fonte", sourceKind: "risposta", sourceOccurredOn: "2026-11-14" }, TODAY), { kind: "referente", label: "Referente 14 nov", word: "Referente", day: "14 nov" });
  assert.deepEqual(
    factSourceLabel({ origin: "fonte", sourceKind: "appunti", sourceOrigin: "cli", sourceExternalId: "impara:3f2a9c1e-0000-4000-8000-000000000001", sourceOccurredOn: "2026-11-14" }, TODAY),
    { kind: "costruzione", label: "Costruzione 14 nov", word: "Costruzione", day: "14 nov" },
  );
  // Un appunto mandato con `unbundle nota` è una call come le altre.
  assert.equal(factSourceLabel({ origin: "fonte", sourceKind: "appunti", sourceOrigin: "cli", sourceExternalId: null, sourceOccurredOn: "2026-11-14" }, TODAY).label, "Call 14 nov");
  assert.equal(factSourceLabel({ origin: "fonte", sourceKind: "risposta", sourceOccurredOn: null }, TODAY).label, "Referente");
  // Senza la fonte (tolta) resta «senza fonte», qualunque fosse.
  assert.equal(factSourceLabel({ origin: "fonte", sourceKind: null, sourceOrigin: null, sourceExternalId: null, sourceOccurredOn: null }, TODAY).kind, "senza_fonte");
});
