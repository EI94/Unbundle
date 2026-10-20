import test from "node:test";
import assert from "node:assert/strict";
import { agentCatalogFromGuide, MATCHING_AGENTS_MAX, matchingAgents, matchStems } from "./matching-agents.ts";

// Agenti corrispondenti della ricerca (prompt WP6). Catalogo sintetico, nomi inventati.

const GUIDE: Record<string, unknown> = {
  agentCatalog: [
    {
      id: "atlante",
      nome: "ATLANTE",
      sistema: "Sistema Alfa",
      cosaFa: "Prepara bozze di risposta alle email dei clienti",
      keywords: ["email clienti", "bozze di risposta", "posta"],
    },
    {
      id: "borea",
      nome: "BOREA",
      sistema: "Sistema Alfa",
      cosaFa: "Controlla le fatture dei fornitori",
      keywords: ["fattura", "fornitori", "riconciliazione"],
    },
    { id: "cirro", nome: "CIRRO", sistema: "Sistema Beta", cosaFa: "Pianifica i turni", keywords: ["turni del personale", "orario"] },
    { id: "senza_parole", nome: "SENZA", cosaFa: "Non ha parole chiave" },
  ],
};

test("radici: accenti, apostrofi, maiuscole e parole vuote non contano", () => {
  assert.deepEqual(matchStems("Qualità dell'assistenza ai clienti"), ["qualit", "assistenz", "client"]);
  assert.deepEqual(matchStems("fattura FATTURE fatturà"), ["fattur"]);
  assert.deepEqual(matchStems("orario orari"), ["orar"]);
  assert.deepEqual(matchStems("il di la e a"), []);
  assert.deepEqual(matchStems("per con della nelle"), []);
  assert.deepEqual(matchStems("l’ordine «urgente» — AB3CD"), ["ordin", "urgent", "ab3cd"]);
});

test("corrispondenza: singolare e plurale, accenti, apostrofi e inizio di parola", () => {
  assert.deepEqual(matchingAgents("controllo delle fatture", GUIDE).map((a) => a.id), ["borea"]);
  assert.deepEqual(matchingAgents("fatturazione passiva", GUIDE).map((a) => a.id), ["borea"], "fattur → fatturazion");
  assert.deepEqual(matchingAgents("rispondere all'email dei clienti", GUIDE).map((a) => a.id), ["atlante"]);
  assert.deepEqual(matchingAgents("ORARI e turni del Personale", GUIDE).map((a) => a.id), ["cirro"]);
  // Parola chiave di più parole: servono tutte («turni del personale» senza «personale» non basta).
  assert.deepEqual(matchingAgents("turni", GUIDE).map((a) => a.id), []);
  // Una radice corta non vale come inizio: «post» (posta) non è l'inizio di «postazione».
  assert.deepEqual(matchingAgents("postazione di lavoro", GUIDE), []);
  assert.deepEqual(matchingAgents("nulla di simile", GUIDE), []);
});

test("ordine: più parole chiave trovate prima, poi l'ordine del catalogo; al massimo 5", () => {
  const both = matchingAgents("riconciliazione fatture fornitori via email clienti", GUIDE);
  assert.deepEqual(both.map((a) => a.id), ["borea", "atlante"]);
  const many = {
    agentCatalog: Array.from({ length: 8 }, (_, i) => ({ id: `agente_${i}`, nome: `A${i}`, keywords: ["verbali"] })),
  };
  const found = matchingAgents("verbali delle riunioni", many);
  assert.equal(found.length, MATCHING_AGENTS_MAX);
  assert.deepEqual(found.map((a) => a.id), ["agente_0", "agente_1", "agente_2", "agente_3", "agente_4"]);
});

test("uscita: solo id, nome, sistema e cosaFa; mai le parole chiave", () => {
  const [agent] = matchingAgents("fatture fornitori", GUIDE);
  assert.deepEqual(agent, { id: "borea", nome: "BOREA", sistema: "Sistema Alfa", cosaFa: "Controlla le fatture dei fornitori" });
  assert.deepEqual(Object.keys(agent), ["id", "nome", "sistema", "cosaFa"]);
  assert.equal(JSON.stringify(agent).includes("riconciliazione"), false);
});

test("catalogo tollerante: elenco assente, voci senza id, nomi alternativi, parole chiave in un testo", () => {
  assert.deepEqual(agentCatalogFromGuide(null), []);
  assert.deepEqual(agentCatalogFromGuide({}), []);
  assert.deepEqual(agentCatalogFromGuide({ agentCatalog: "atlante" }), []);
  const catalog = agentCatalogFromGuide({
    agentCatalog: [
      null,
      "atlante",
      { nome: "Senza id" },
      { id: "  " },
      { id: "delta", name: "DELTA", system: "Sistema Gamma", "cosa fa": "Riassume i verbali", keywords: "verbali, riunioni; sintesi" },
      { id: "delta", nome: "Doppione" },
      { id: "eco", keywords: [7, "", "archivio", "archivio", "x".repeat(81)] },
    ],
  });
  assert.deepEqual(catalog, [
    { id: "delta", nome: "DELTA", sistema: "Sistema Gamma", cosaFa: "Riassume i verbali", keywords: ["verbali", "riunioni", "sintesi"] },
    { id: "eco", nome: null, sistema: null, cosaFa: null, keywords: ["archivio"] },
  ]);
  // Un agente senza parole chiave non corrisponde mai.
  assert.deepEqual(matchingAgents("non ha parole chiave", GUIDE), []);
  assert.deepEqual(matchingAgents("archivio storico", { agentCatalog: [{ id: "eco", keywords: ["archivio"] }] }), [
    { id: "eco", nome: null, sistema: null, cosaFa: null },
  ]);
});
