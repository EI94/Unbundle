import test from "node:test";
import assert from "node:assert/strict";
import { buildLiveRows, compactEuro, liveLines, LIVE_ROWS_PER_SECTION, type LiveDiscoveryData } from "./live.ts";

// I dati della Discovery nella Memoria (RILASCIO-9a-COSTRUZIONE.md §7.2). Azienda inventata.

const U1 = "00000000-0000-4000-8000-0000000000a1";
const U2 = "00000000-0000-4000-8000-0000000000a2";
const G1 = "00000000-0000-4000-8000-0000000000b1";

function data(over: Partial<LiveDiscoveryData> = {}): LiveDiscoveryData {
  return {
    thesis: {
      coreValueProposition: "Cucine su misura\nper il mercato italiano.",
      strategicNodes: ["Progettazione", "Montaggio"],
      commodityNodes: ["Contabilità"],
      marginDrivers: ["Linea premium"],
      keyRisks: ["Tempi di consegna"],
      aiReadiness: "Bassa",
    },
    boundary: { includedFunctions: ["Vendite", "Acquisti"], excludedFunctions: ["Produzione"], rationale: "Si parte da dove c'è più carta.", timeHorizon: "12 mesi" },
    departments: [
      { id: U1, name: "Acquisti", description: "Compra legno e ferramenta", teamSize: 4 },
      { id: U2, name: "Vendite", description: null, teamSize: null },
    ],
    activityCounts: new Map([[U1, 7]]),
    goals: [{ id: G1, type: "key_result", title: "Consegna in 20 giorni" }],
    employees: 420,
    revenueEur: 12_000_000,
    ...over,
  };
}

test("le righe, nella sezione giusta, come le mostra la pagina", () => {
  const rows = buildLiveRows(data());
  assert.deepEqual(rows.map((r) => [r.section, r.tag, r.text]), [
    ["azienda", null, "Cucine su misura per il mercato italiano."],
    ["azienda", null, "Nodi strategici: Progettazione, Montaggio"],
    ["azienda", null, "Nodi commodity: Contabilità"],
    ["azienda", null, "Motori di margine: Linea premium"],
    ["azienda", null, "Rischi: Tempi di consegna"],
    ["azienda", null, "Maturità AI: Bassa"],
    ["azienda", null, "Dipendenti: 420"],
    ["azienda", null, "Ricavo dell'ultimo anno: 12 mln €"],
    ["lavoro", null, "Acquisti: Compra legno e ferramenta · 4 persone · 7 attività mappate"],
    ["lavoro", null, "Vendite"],
    ["obiettivi", "Risultato chiave", "Consegna in 20 giorni"],
    ["regole", null, "Perimetro: incluse Vendite, Acquisti; escluse Produzione"],
    ["regole", null, "Si parte da dove c'è più carta."],
    ["regole", null, "Orizzonte: 12 mesi"],
  ]);
  assert.equal(new Set(rows.map((r) => r.key)).size, rows.length, "ogni riga ha la sua chiave");
  assert.deepEqual(liveLines(rows).slice(-4), ["Risultato chiave: Consegna in 20 giorni", "Perimetro: incluse Vendite, Acquisti; escluse Produzione", "Si parte da dove c'è più carta.", "Orizzonte: 12 mesi"]);
});

test("senza cifre (chi non è un revisore) le due righe non ci sono; i pezzi che mancano si saltano", () => {
  const rows = buildLiveRows(data({ employees: null, revenueEur: null }));
  assert.equal(rows.some((r) => /Dipendenti|Ricavo/.test(r.text)), false);
  const empty = buildLiveRows({ thesis: null, boundary: null, departments: [], activityCounts: new Map(), goals: [], employees: null, revenueEur: null });
  assert.deepEqual(empty, []);
  const partial = buildLiveRows(data({ thesis: { coreValueProposition: "  ", strategicNodes: [], keyRisks: "non un elenco" }, boundary: { includedFunctions: ["Vendite"] }, goals: [{ id: G1, type: "objective", title: "Crescere" }, { id: U2, type: "goal", title: "Qualità" }] }));
  assert.deepEqual(
    partial.filter((r) => r.section !== "lavoro").map((r) => [r.tag, r.text]),
    [[null, "Dipendenti: 420"], [null, "Ricavo dell'ultimo anno: 12 mln €"], ["Obiettivo", "Crescere"], ["Goal", "Qualità"], [null, "Perimetro: incluse Vendite"]],
  );
  // Una persona, un'attività: al singolare.
  const one = buildLiveRows(data({ departments: [{ id: U1, name: "Acquisti", description: null, teamSize: 1 }], activityCounts: new Map([[U1, 1]]) }));
  assert.ok(one.some((r) => r.text === "Acquisti · 1 persona · 1 attività mappata"));
});

test("una riga sta su una riga e ha un tetto; le unità e gli obiettivi hanno un massimo", () => {
  const long = buildLiveRows(data({ thesis: { coreValueProposition: `${"parola ".repeat(200)}\nfine` } }));
  assert.ok(long[0].text.length <= 400);
  assert.equal(long[0].text.includes("\n"), false);
  const many = buildLiveRows(data({ departments: Array.from({ length: 90 }, (_, i) => ({ id: `u${i}`, name: `Unità ${i}`, description: null, teamSize: null })) }));
  assert.equal(many.filter((r) => r.section === "lavoro").length, LIVE_ROWS_PER_SECTION);
});

test("il ricavo: «12 mln €» per i milioni tondi, altrimenti la cifra intera", () => {
  assert.equal(compactEuro(12_000_000), "12 mln €");
  assert.equal(compactEuro(12_500_000), "12,5 mln €");
  assert.equal(compactEuro(1_250_000), "1.250.000 €");
  assert.equal(compactEuro(800_000), "800.000 €");
});
