import test from "node:test";
import assert from "node:assert/strict";
import { CASE_ONLY_BELL_KINDS, CASE_TEAM_BELL_KINDS, bellSourcesFor } from "./bell.ts";

// La campanella per elenco (rilascio 8.0d-1 «Porte», RILASCIO-8.0d-ESTERNI-FASE-2.md §2.5, §2.10 U5-U6): che cosa vede
// ogni ruolo, senza database. Le righe vere (segnali e dossier nel database) le prova
// src/lib/use-cases/factory/case-only.integration.test.ts.

test("U5: «Solo questo use case» vede solo i tipi di chi costruisce, dei suoi casi; niente segnali, niente righe dei dossier", () => {
  const sources = bellSourcesFor("esterno_caso");
  assert.equal(sources.signals, "nessuno");
  assert.equal(sources.dossier, false);
  assert.deepEqual(sources.useCaseKinds, CASE_ONLY_BELL_KINDS);
  assert.equal(sources.onlyOwnCases, true);
  for (const kind of CASE_ONLY_BELL_KINDS) assert.ok(CASE_TEAM_BELL_KINDS.includes(kind), kind);
  for (const kind of ["pacchetto_nuovo", "progetto_ok", "modifica_chiesta", "compiti_pronti", "contesto_nuovo"]) {
    assert.ok((CASE_ONLY_BELL_KINDS as readonly string[]).includes(kind), kind);
  }
  // Mai i tipi che restano a Lateral Space e all'AI Board.
  for (const kind of ["progetto_appr", "domanda_agente", "strumento_nuovo", "ok_decaduto"]) {
    assert.ok(!(sources.useCaseKinds as readonly string[]).includes(kind), kind);
  }
});

test("U6: i segnali a chi non è revisore solo se è Contributore; a un ruolo che non si conosce, niente", () => {
  for (const role of ["exec_sponsor", "transformation_lead", "function_lead", "analyst"]) {
    assert.deepEqual(bellSourcesFor(role), { signals: "tutti", dossier: true, useCaseKinds: null, onlyOwnCases: false }, role);
  }
  assert.deepEqual(bellSourcesFor("contributor"), { signals: "senza_schede", dossier: true, useCaseKinds: CASE_TEAM_BELL_KINDS, onlyOwnCases: false });
  for (const role of ["learner", "", "inventato", "Contributor", null, undefined]) {
    const sources = bellSourcesFor(role);
    assert.deepEqual([sources.signals, sources.dossier, sources.useCaseKinds, sources.onlyOwnCases], ["nessuno", false, [], false], String(role));
  }
});
