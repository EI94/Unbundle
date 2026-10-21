import test from "node:test";
import assert from "node:assert/strict";
import {
  JOINT_COMPANY_LABEL,
  NO_AREA_LABEL,
  OTHER_AREAS_LABEL,
  OTHER_COMPANIES_LABEL,
  PARTICIPATION_MIN_GROUP,
  PARTICIPATION_SOURCES,
  participationGuideLabels,
  summarizeParticipation,
  type AreaCount,
  type CompanyCount,
  type Participation,
} from "./participation.ts";

const GUIDE = {
  guideVersion: "1.0",
  workspace: { nome: "TopJet e Aliserio", società: ["topjet", "aliserio", "entrambe"], esgEnabled: false },
  areas: [
    { id: "operazioni", label: "Operazioni" },
    { id: "vendite", label: "Vendite" },
    { id: "amministrazione", label: "Amministrazione", descrizione: "Fatture e pagamenti." },
    { id: "persone", label: "Persone" },
    { id: "legale", label: "Legale" },
  ],
};

const area = (id: string | null, proposals: number, bestPractices = 0): AreaCount => ({ area: id, proposals, bestPractices });
const company = (id: string | null, proposals: number): CompanyCount => ({ company: id, proposals });
/** Con una guida con aree il risultato non è mai null. */
function summarize(input: Parameters<typeof summarizeParticipation>[0]): Participation {
  const result = summarizeParticipation(input);
  assert.ok(result, "con aree nella guida la scheda c'è");
  return result;
}

test("la soglia è 3 e i canali sono quelli in cui propone una persona", () => {
  assert.equal(PARTICIPATION_MIN_GROUP, 3);
  assert.deepEqual([...PARTICIPATION_SOURCES], ["claude_connector", "claude_mcp", "web_proposed", "slack_proposed", "learning"]);
  assert.ok(Object.isFrozen(PARTICIPATION_SOURCES));
});

test("ordina dalla più alta, mostra le etichette della guida e mai gli id", () => {
  const result = summarize({
    areas: [area("vendite", 4, 1), area("operazioni", 9, 3), area("amministrazione", 4)],
    companies: [],
    guide: GUIDE,
  });
  assert.deepEqual(result.rows, [
    { label: "Operazioni", count: 9, bestPractices: 3 },
    { label: "Amministrazione", count: 4, bestPractices: 0 },
    { label: "Vendite", count: 4, bestPractices: 1 },
  ]);
  const text = JSON.stringify(result);
  for (const id of ["operazioni", "vendite", "amministrazione"]) assert.ok(!text.includes(`"${id}"`), id);
});

test("a parità di proposte l'ordine è alfabetico in italiano", () => {
  const guide = { areas: [{ id: "a", label: "Zeta" }, { id: "b", label: "Ácqua" }, { id: "c", label: "Beta" }] };
  const result = summarize({ areas: [area("a", 5), area("b", 5), area("c", 5)], companies: [], guide });
  assert.deepEqual(result.rows.map((r) => r.label), ["Ácqua", "Beta", "Zeta"]);
});

test("aree con meno di 3 proposte vanno in «Altre aree», in coda, con le loro best practice", () => {
  const result = summarize({
    areas: [area("operazioni", 3, 1), area("vendite", 2, 1), area("persone", 1), area("legale", 2, 2)],
    companies: [],
    guide: GUIDE,
  });
  assert.deepEqual(result.rows, [
    { label: "Operazioni", count: 3, bestPractices: 1 },
    { label: OTHER_AREAS_LABEL, count: 5, bestPractices: 3 },
  ]);
});

test("«Altre aree» resta in coda anche quando è il gruppo più grande", () => {
  const result = summarize({
    areas: [area("operazioni", 3), area("vendite", 2), area("persone", 2), area("legale", 2), area("ignota", 4)],
    companies: [],
    guide: GUIDE,
  });
  assert.deepEqual(result.rows.map((r) => [r.label, r.count]), [["Operazioni", 3], [OTHER_AREAS_LABEL, 10]]);
});

test("un'area che la guida non conosce va in «Altre aree», senza mostrare l'id", () => {
  const result = summarize({ areas: [area("logistica_interna", 7, 2)], companies: [], guide: GUIDE });
  assert.deepEqual(result.rows, [{ label: OTHER_AREAS_LABEL, count: 7, bestPractices: 2 }]);
  assert.ok(!JSON.stringify(result).includes("logistica"));
});

test("senza area: «Area non indicata», sempre ultima, da 3 proposte in su", () => {
  const result = summarize({
    areas: [area(null, 2, 1), area("", 1), area("  ", 1), area("operazioni", 3), area("vendite", 1)],
    companies: [],
    guide: GUIDE,
  });
  assert.deepEqual(result.rows, [
    { label: "Operazioni", count: 3, bestPractices: 0 },
    { label: OTHER_AREAS_LABEL, count: 1, bestPractices: 0 },
    { label: NO_AREA_LABEL, count: 4, bestPractices: 1 },
  ]);
});

test("«Area non indicata» sotto 3 va in «Altre aree»", () => {
  const result = summarize({ areas: [area("operazioni", 5), area("vendite", 1), area(null, 2, 1)], companies: [], guide: GUIDE });
  assert.deepEqual(result.rows, [
    { label: "Operazioni", count: 5, bestPractices: 0 },
    { label: OTHER_AREAS_LABEL, count: 3, bestPractices: 1 },
  ]);
  const alone = summarize({ areas: [area("operazioni", 5), area(null, 1)], companies: [], guide: GUIDE });
  assert.deepEqual(alone.rows.map((r) => [r.label, r.count]), [["Operazioni", 5], [OTHER_AREAS_LABEL, 1]]);
});

test("senza aree nella guida la scheda non c'è", () => {
  const input = { areas: [area("operazioni", 5), area(null, 3)], companies: [company("topjet", 5)] };
  for (const guide of [null, undefined, {}, { areas: [] }, { areas: [{ id: "operazioni" }] }, { workspace: GUIDE.workspace }]) {
    assert.equal(summarizeParticipation({ ...input, guide }), null);
  }
  assert.equal(summarizeParticipation({ areas: [], companies: [], guide: null }), null);
});

test("nessuna proposta: nessuna riga (la scheda mostra «Ancora nessuna proposta dai colleghi.»)", () => {
  assert.deepEqual(summarize({ areas: [], companies: [], guide: GUIDE }), { rows: [], companies: [] });
  assert.deepEqual(summarize({ areas: [area("operazioni", 0)], companies: [company("topjet", 0)], guide: GUIDE }), {
    rows: [],
    companies: [],
  });
});

test("aree con la stessa etichetta sono una riga sola; un'etichetta uguale a un gruppo va in «Altre aree»", () => {
  const guide = {
    areas: [
      { id: "x1", label: "Doppia" },
      { id: "x2", label: " doppia " },
      { id: "it", label: "Altre aree" },
      { id: "na", label: "AREA NON INDICATA" },
      { id: "hr", label: "Persone" },
    ],
  };
  const result = summarize({
    areas: [area("x1", 2, 1), area("x2", 2), area("it", 4), area("na", 1), area("hr", 3), area(null, 3)],
    companies: [],
    guide,
  });
  assert.deepEqual(result.rows, [
    { label: "Doppia", count: 4, bestPractices: 1 },
    { label: "Persone", count: 3, bestPractices: 0 },
    { label: OTHER_AREAS_LABEL, count: 5, bestPractices: 0 },
    { label: NO_AREA_LABEL, count: 3, bestPractices: 0 },
  ]);
  const labels = result.rows.map((r) => r.label.toLocaleLowerCase("it"));
  assert.equal(new Set(labels).size, labels.length, "etichette uniche: sono anche le chiavi delle righe");
});

test("conteggi dal database come testo, negativi o non numerici non rompono la scheda", () => {
  const result = summarize({
    areas: [
      { area: "operazioni", proposals: "4" as unknown as number, bestPractices: "9" as unknown as number },
      { area: "vendite", proposals: -2, bestPractices: 0 },
      { area: "persone", proposals: Number.NaN, bestPractices: 0 },
    ],
    companies: [],
    guide: GUIDE,
  });
  assert.deepEqual(result.rows, [{ label: "Operazioni", count: 4, bestPractices: 4 }]);
});

test("società: «Per società» dalla più alta, con la grafia del nome del workspace", () => {
  const result = summarize({
    areas: [area("operazioni", 17)],
    companies: [company("aliserio", 5), company("topjet", 12)],
    guide: GUIDE,
  });
  assert.deepEqual(result.companies, [
    { label: "TopJet", count: 12 },
    { label: "Aliserio", count: 5 },
  ]);
});

test("società piccole in «Altre società» quando sono almeno due", () => {
  const guide = { ...GUIDE, workspace: { ...GUIDE.workspace, società: ["topjet", "aliserio", "alfa", "beta"] } };
  const merged = summarize({
    areas: [],
    companies: [company("topjet", 12), company("aliserio", 5), company("alfa", 2), company("beta", 1)],
    guide,
  });
  assert.deepEqual(merged.companies, [
    { label: "TopJet", count: 12 },
    { label: "Aliserio", count: 5 },
    { label: OTHER_COMPANIES_LABEL, count: 3 },
  ]);
  // Una società fuori dalla guida è un gruppo a parte, mai con il suo id.
  const unknown = summarize({
    areas: [],
    companies: [company("topjet", 4), company("vecchia_societa", 6), company("aliserio", 1)],
    guide: GUIDE,
  });
  assert.deepEqual(unknown.companies, [
    { label: "TopJet", count: 4 },
    { label: OTHER_COMPANIES_LABEL, count: 7 },
  ]);
  assert.ok(!JSON.stringify(unknown).includes("vecchia"));
});

test("una società sola sotto soglia si unisce alla più piccola mostrata; se ne resta una, niente riga", () => {
  const guide = { workspace: { nome: "Alfa Beta Gamma", società: ["alfa", "beta", "gamma", "delta"] }, areas: GUIDE.areas };
  const four = summarize({ areas: [], companies: [company("alfa", 9), company("beta", 6), company("gamma", 4), company("delta", 1)], guide });
  assert.deepEqual(four.companies, [
    { label: "Alfa", count: 9 },
    { label: "Beta", count: 6 },
    { label: OTHER_COMPANIES_LABEL, count: 5 },
  ]);
  const three = summarize({ areas: [], companies: [company("alfa", 9), company("beta", 6), company("delta", 2)], guide });
  assert.deepEqual(three.companies, []);
  const two = summarize({ areas: [], companies: [company("alfa", 9), company("delta", 1)], guide });
  assert.deepEqual(two.companies, []);
});

test("caso della revisione: «entrambe» con 1 proposta non si ricava per differenza", () => {
  const result = summarize({
    areas: [area("operazioni", 8), area("vendite", 5), area(null, 3)],
    companies: [company("topjet", 8), company("aliserio", 4), company("entrambe", 1), company(null, 3)],
    guide: GUIDE,
  });
  assert.deepEqual(result.companies, []);
});

test("«entrambe» è «Entrambe le società», in coda, e non entra mai in «Altre società»", () => {
  const shown = summarize({ areas: [], companies: [company("topjet", 9), company("aliserio", 3), company("entrambe", 4)], guide: GUIDE });
  assert.deepEqual(shown.companies, [
    { label: "TopJet", count: 9 },
    { label: "Aliserio", count: 3 },
    { label: JOINT_COMPANY_LABEL, count: 4 },
  ]);
  const guide = { ...GUIDE, workspace: { ...GUIDE.workspace, società: ["topjet", "aliserio", "alfa", "beta", "entrambe"] } };
  const withOthers = summarize({
    areas: [],
    companies: [company("topjet", 9), company("aliserio", 5), company("alfa", 1), company("beta", 1), company("entrambe", 3)],
    guide,
  });
  assert.deepEqual(withOthers.companies, [
    { label: "TopJet", count: 9 },
    { label: "Aliserio", count: 5 },
    { label: OTHER_COMPANIES_LABEL, count: 2 },
    { label: JOINT_COMPANY_LABEL, count: 3 },
  ]);
  for (const n of [1, 2]) {
    assert.deepEqual(
      summarize({ areas: [], companies: [company("topjet", 9), company("aliserio", 5), company("alfa", 1), company("beta", 1), company("entrambe", n)], guide }).companies,
      []
    );
  }
});

test("1 o 2 proposte senza società: niente riga, sarebbero il totale meno la riga", () => {
  for (const n of [1, 2]) {
    const result = summarize({ areas: [], companies: [company("topjet", 9), company("aliserio", 5), company(null, n)], guide: GUIDE });
    assert.deepEqual(result.companies, []);
  }
  const three = summarize({ areas: [], companies: [company("topjet", 9), company("aliserio", 5), company(null, 3)], guide: GUIDE });
  assert.equal(three.companies.length, 2);
});

test("società: nessuna riga se nessuna supera la soglia o se la guida non ha società", () => {
  assert.deepEqual(summarize({ areas: [], companies: [company("topjet", 2), company("aliserio", 2)], guide: GUIDE }).companies, []);
  const noCompanies = { areas: GUIDE.areas };
  assert.deepEqual(summarize({ areas: [], companies: [company("topjet", 9)], guide: noCompanies }).companies, []);
});

test("nessun numero nascosto si ricava per differenza fra aree e società", () => {
  // Come per TopJet: chi passa dal connettore indica area e società, gli altri canali nessuna
  // delle due. Per ogni combinazione la riga, se c'è, somma tutte le proposte con una società:
  // il totale delle aree meno la riga meno «Area non indicata» fa sempre 0.
  const guide = {
    workspace: { nome: "Alfa Beta Gamma", società: ["alfa", "beta", "gamma", "entrambe"] },
    areas: [{ id: "operazioni", label: "Operazioni" }],
  };
  const ids = ["alfa", "beta", "gamma", "entrambe", "vecchia"];
  const values = [0, 1, 2, 3, 4];
  let shown = 0;
  for (let code = 0; code < values.length ** ids.length; code++) {
    const counts = ids.map((_, i) => values[Math.floor(code / values.length ** i) % values.length]);
    for (const withoutCompany of [0, 1, 2, 3]) {
      const withCompany = counts.reduce((sum, n) => sum + n, 0);
      const result = summarize({
        areas: [area("operazioni", withCompany), area(null, withoutCompany)],
        companies: [...ids.map((id, i) => company(id, counts[i])), company(null, withoutCompany)],
        guide,
      });
      const line = result.companies;
      if (!line.length) continue;
      shown += 1;
      const where = JSON.stringify({ counts, withoutCompany, line });
      const total = result.rows.reduce((sum, row) => sum + row.count, 0);
      assert.equal(line.reduce((sum, c) => sum + c.count, 0), withCompany, `la riga somma ogni proposta con una società ${where}`);
      assert.equal(total - withCompany, withoutCompany, where);
      assert.ok(withoutCompany === 0 || withoutCompany >= PARTICIPATION_MIN_GROUP, `senza società: 0 o almeno 3 ${where}`);
      for (const entry of line) assert.ok(entry.count >= PARTICIPATION_MIN_GROUP || entry.label === OTHER_COMPANIES_LABEL, where);
      const names = new Set(line.map((c) => c.label));
      assert.equal(names.size, line.length, where);
      const hidden = ids.filter((id, i) => counts[i] > 0 && id !== "entrambe" && !names.has(id.charAt(0).toUpperCase() + id.slice(1)));
      if (names.has(OTHER_COMPANIES_LABEL)) assert.ok(hidden.length >= 2, `«Altre società» unisce almeno due società ${where}`);
      else assert.equal(hidden.length, 0, where);
      const joint = counts[ids.indexOf("entrambe")];
      assert.equal(names.has(JOINT_COMPANY_LABEL), joint > 0, where);
    }
  }
  assert.ok(shown > 100, `la riga compare in molte combinazioni (${shown})`);
});

test("etichette della guida lette in modo tollerante", () => {
  const labels = participationGuideLabels({
    areas: [{ id: "a", label: " Acquisti  e   gare " }, { id: "b" }, "c", { id: "a", label: "Doppione" }, null],
    workspace: { nome: "TopJet, Gruppo Nord e Sud-Est Città", società: ["topjet", "gruppo_nord", "est", "citta", "alfa_beta", 3, "", "topjet"] },
  });
  assert.deepEqual([...labels.areas], [["a", "Acquisti e gare"]]);
  assert.deepEqual([...labels.companies], [
    ["topjet", "TopJet"],
    ["gruppo_nord", "Gruppo Nord"],
    ["est", "Est"],
    ["citta", "Città"],
    ["alfa_beta", "Alfa beta"],
  ]);
  assert.deepEqual([...participationGuideLabels({ workspace: { società: ["topjet"] } }).companies], [["topjet", "Topjet"]]);
  for (const guide of [null, undefined, "testo", [], { areas: "no", workspace: [] }]) {
    const empty = participationGuideLabels(guide);
    assert.equal(empty.areas.size + empty.companies.size, 0);
  }
});

test("l'uscita ha solo etichette e numeri: nessun campo di chi propone", () => {
  const result = summarize({
    areas: [area("operazioni", 6, 2), area("vendite", 1), area(null, 3)],
    companies: [company("topjet", 6), company("aliserio", 4)],
    guide: GUIDE,
  });
  for (const row of result.rows) assert.deepEqual(Object.keys(row).sort(), ["bestPractices", "count", "label"]);
  for (const row of result.companies) assert.deepEqual(Object.keys(row).sort(), ["count", "label"]);
  assert.deepEqual(Object.keys(result).sort(), ["companies", "rows"]);
});
