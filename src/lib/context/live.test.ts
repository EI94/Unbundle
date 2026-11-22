import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { briefFactsHash } from "./brief/prompt.ts";
import { buildLiveRows, compactEuro, liveHashLines, liveLines, LIVE_HASH_LABELS, LIVE_ROWS_PER_SECTION, type LiveDiscoveryData } from "./live.ts";
import { CONTEXT_TEXT } from "./text.ts";

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
    ["azienda", null, "Dove fa la differenza: Progettazione, Montaggio"],
    ["azienda", null, "Lavoro di routine: Contabilità"],
    ["azienda", null, "Da dove viene il margine: Linea premium"],
    ["azienda", null, "Rischi: Tempi di consegna"],
    ["azienda", null, "Maturità AI: Bassa"],
    ["azienda", null, "Dipendenti: 420"],
    ["azienda", null, "Ricavo dell'ultimo anno: 12 mln €"],
    ["lavoro", null, "Acquisti: Compra legno e ferramenta · 4 persone · 7 passi mappati"],
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
    [[null, "Dipendenti: 420"], [null, "Ricavo dell'ultimo anno: 12 mln €"], ["Obiettivo", "Crescere"], ["Obiettivo", "Qualità"], [null, "Perimetro: incluse Vendite"]],
  );
  // Una persona, un'attività: al singolare.
  const one = buildLiveRows(data({ departments: [{ id: U1, name: "Acquisti", description: null, teamSize: 1 }], activityCounts: new Map([[U1, 1]]) }));
  assert.ok(one.some((r) => r.text === "Acquisti · 1 persona · 1 passo mappato"));
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

// (Rilascio 10) L'impronta di «In breve» (`facts_hash`) prende i dati della Discovery con le etichette del rilascio 9a,
// ferme: le parole a schermo nuove («Dove fa la differenza», «passi mappati») non cambiano l'impronta, e la prima
// conferma dopo il rilascio non riscrive «In breve» con il modello se nessun fatto è cambiato.
const LINES_9A = [
  "Cucine su misura per il mercato italiano.",
  "Nodi strategici: Progettazione, Montaggio",
  "Nodi commodity: Contabilità",
  "Motori di margine: Linea premium",
  "Rischi: Tempi di consegna",
  "Maturità AI: Bassa",
  "Dipendenti: 420",
  "Ricavo dell'ultimo anno: 12 mln €",
  "Acquisti: Compra legno e ferramenta · 4 persone · 7 attività mappate",
  "Vendite",
  "Risultato chiave: Consegna in 20 giorni",
  "Perimetro: incluse Vendite, Acquisti; escluse Produzione",
  "Si parte da dove c'è più carta.",
  "Orizzonte: 12 mesi",
];

test("l'impronta di «In breve»: gli stessi dati con le etichette ferme del 9a, qualunque cosa dica la pagina", () => {
  assert.deepEqual(liveHashLines(data()), LINES_9A);
  assert.notDeepEqual(liveLines(buildLiveRows(data())), LINES_9A, "a schermo le parole nuove");
  const facts = [{ id: "00000000-0000-4000-8000-0000000000f1", version: 2 }];
  // L'impronta di prima del rilascio (righe del 9a, calcolata a mano come `briefFactsHash`) è quella di oggi.
  const before = createHash("sha256");
  before.update(`${facts[0].id}:2\n`, "utf8");
  before.update("--\n", "utf8");
  for (const line of LINES_9A) before.update(`${line}\n`, "utf8");
  assert.equal(briefFactsHash(facts, liveHashLines(data())), before.digest("hex"));
  // Le etichette ferme hanno le stesse voci di quelle a schermo, e non le prendono da lì.
  assert.deepEqual(Object.keys(LIVE_HASH_LABELS).sort(), Object.keys(CONTEXT_TEXT.live).sort());
  assert.doesNotMatch(readFileSync(new URL("./live.ts", import.meta.url), "utf8"), /LIVE_HASH_LABELS: LiveLabels = Object\.freeze\(\{\s*\.\.\./, "nessuna voce copiata dalle etichette a schermo");
  // «In breve» calcola l'impronta con le righe ferme e scrive il prompt con quelle a schermo.
  const brief = readFileSync(new URL("../db/queries/context-brief.ts", import.meta.url), "utf8");
  assert.match(brief, /briefFactsHash\(facts\.map\(\(f\) => \(\{ id: f\.id, version: Number\(f\.version\) \}\)\), live \? liveHashLines\(live\) : \[\]\)/);
  assert.match(brief, /const lines = live \? liveLines\(buildLiveRows\(live\)\) : \[\];/);
  assert.match(brief, /buildBriefPrompt\(\{ clientName: workspace\.name, facts, live: lines \}\)/);
});
