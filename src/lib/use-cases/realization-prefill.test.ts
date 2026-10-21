import test from "node:test";
import assert from "node:assert/strict";
import { COLLECTED_BLOCK_KEY, PREFILL_ONE_LINER_MAX, isConnectorIntake, prefillOneLiner, realizationPrefill } from "./realization-prefill.ts";

const guide = {
  areas: [{ id: "amministrazione", label: "Amministrazione e finanza" }, "logistica"],
  tools: [{ id: "foglio_calcolo", label: "Foglio di calcolo" }, { id: "erp", nome: "Gestionale" }],
};

test("solo le schede del connettore (contratto v2) partono precompilate", () => {
  assert.equal(isConnectorIntake({ contractVersion: 2 }), true);
  assert.equal(isConnectorIntake({ contractVersion: 1 }), false);
  assert.equal(isConnectorIntake({ contractVersion: "2" }), false);
  assert.equal(isConnectorIntake(null), false);
  assert.equal(realizationPrefill({ problem: "P", flow: "S", intake: { tools: ["erp"] }, guide }), null);
  assert.equal(realizationPrefill({ problem: "P", flow: "S", intake: null, guide }), null);
});

test("«In una frase»: il problema intero in una riga, al massimo 500 caratteri", () => {
  assert.equal(prefillOneLiner("Le fatture arrivano per email.\n\nOgni mese  ne perdiamo qualcuna."), "Le fatture arrivano per email. Ogni mese ne perdiamo qualcuna.");
  const long = prefillOneLiner("a".repeat(700));
  assert.equal(long.length, PREFILL_ONE_LINER_MAX);
  assert.ok(long.endsWith("…"));
  assert.equal(prefillOneLiner("   "), "");
  assert.equal(prefillOneLiner(null), "");
});

test("problema, soluzione, area e strumenti con i titoli della guida, mai le chiavi né altri campi", () => {
  const prefill = realizationPrefill({
    problem: "Le fatture arrivano per email.",
    flow: "Claude legge la casella e prepara la registrazione.",
    intake: {
      contractVersion: 2,
      area: "amministrazione",
      tools: ["foglio_calcolo", "erp", "posta_elettronica", "altro"],
      toolsOther: "Portale della banca",
      submitterEmail: "persona@cliente.test",
      proposerEstimate: { time: { reasoning: "stima" } },
    },
    guide,
  });
  assert.ok(prefill);
  assert.equal(prefill.oneLiner, "Le fatture arrivano per email.");
  assert.deepEqual(prefill.rows, [
    { label: "Problema", value: "Le fatture arrivano per email." },
    { label: "Soluzione", value: "Claude legge la casella e prepara la registrazione." },
    { label: "Area", value: "Amministrazione e finanza" },
    { label: "Strumenti", value: "Foglio di calcolo, Gestionale, posta elettronica, Portale della banca" },
  ]);
  assert.deepEqual(prefill.description, {
    [COLLECTED_BLOCK_KEY]: {
      problema: "Le fatture arrivano per email.",
      soluzione: "Claude legge la casella e prepara la registrazione.",
      area: "Amministrazione e finanza",
      strumenti: "Foglio di calcolo, Gestionale, posta elettronica, Portale della banca",
    },
  });
  const all = JSON.stringify(prefill);
  for (const leaked of ["persona@cliente.test", "stima", "foglio_calcolo", "amministrazione\""]) assert.ok(!all.includes(leaked), leaked);
});

test("un'area senza elenco nella guida resta il testo salvato; senza dati nessun blocco", () => {
  const prefill = realizationPrefill({ problem: null, flow: null, intake: { contractVersion: 2, area: "Ufficio acquisti" }, guide: null });
  assert.deepEqual(prefill, {
    oneLiner: "",
    rows: [{ label: "Area", value: "Ufficio acquisti" }],
    description: { [COLLECTED_BLOCK_KEY]: { area: "Ufficio acquisti" } },
  });
  assert.deepEqual(realizationPrefill({ problem: " ", flow: null, intake: { contractVersion: 2 }, guide }), { oneLiner: "", rows: [], description: {} });
});
