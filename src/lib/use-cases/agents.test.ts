import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_TONES,
  NO_AGENT_LABEL,
  NO_AGENT_PARAM,
  agentFilterOptions,
  agentLabel,
  agentOfTitle,
  agentPalette,
  agentParamOf,
  agentToneOf,
  parseAgentParam,
  titleAgent,
} from "./agents.ts";

// Gli agenti dal titolo (rilascio «Panoramica»): il prefisso «LIBRA L1 · …», il filtro «Agente» e
// i toni. Le forme dei titoli sono quelle di TopJet (lette il 29/10/2026: 45 approvati con il
// prefisso, uno approvato e quattro proposte senza); gli altri titoli sono inventati.

const titles = (...list: string[]) => list.map((title) => ({ title }));

test("titleAgent: agente, codice, testo del tag, prefisso e resto del titolo", () => {
  assert.deepEqual(titleAgent("LIBRA L1 · Lettura delle fatture estere e bozza di registrazione"), {
    agent: "LIBRA",
    code: "L1",
    label: "LIBRA L1",
    prefix: "LIBRA L1 · ",
    rest: "Lettura delle fatture estere e bozza di registrazione",
  });
  assert.deepEqual(titleAgent("  TAIGETE T12 · Turni  "), { agent: "TAIGETE", code: "T12", label: "TAIGETE T12", prefix: "TAIGETE T12 · ", rest: "Turni" }, "senza spazi ai lati");
  assert.deepEqual(titleAgent("LIBRA · Senza codice"), { agent: "LIBRA", code: null, label: "LIBRA", prefix: "LIBRA · ", rest: "Senza codice" });
  // Spazi non separabili attorno a «·».
  assert.deepEqual(titleAgent("LIBRA L1 · Spazi non separabili"), {
    agent: "LIBRA",
    code: "L1",
    label: "LIBRA L1",
    prefix: "LIBRA L1 · ",
    rest: "Spazi non separabili",
  });
  assert.equal(titleAgent("LIBRA L1 · Fatture · estere")?.rest, "Fatture · estere", "conta solo il primo «·»");
  for (const [title, agent, code] of [
    ["AUTO H1 · Cedolini consegnati", "AUTO", "H1"],
    ["ÈLIOS E1 · Accento", "ÈLIOS", "E1"],
    ["MEROPE M1.2 · Un decimale", "MEROPE", "M1.2"],
    ["DENEB D10 · Due cifre", "DENEB", "D10"],
    ["SPICA P2 · Incassi abbinati e stato «paid» in FL3XX", "SPICA", "P2"],
  ] as const) {
    const found = titleAgent(title);
    assert.deepEqual([found?.agent, found?.code], [agent, code], title);
  }
});

test("titleAgent: le forme di TopJet; senza il prefisso nessun agente", () => {
  for (const [title, label] of [
    ["ALCIONE A1 · Presenze del personale di terra senza ricopiature", "ALCIONE A1"],
    ["AUTO X2 · Bonifici massivi e riconciliazione bancaria in Echo", "AUTO X2"],
    ["TAIGETE T3 · Pratiche ENAC: lista dei documenti e stato", "TAIGETE T3"],
    ["SPICA P3 · Calendario dei pagamenti e fabbisogno per banca", "SPICA P3"],
    ["SIRIO S4 · Prevalenza internazionale (art. 8-bis)", "SIRIO S4"],
    ["MAIA M3 · Canale unico per le note spese (modulo di Echo o app collegata)", "MAIA M3"],
  ] as const) {
    assert.equal(titleAgent(title)?.label, label, title);
  }
  // L'approvato senza prefisso e le quattro proposte: «Altri use case».
  for (const title of [
    "Strategia per volo",
    "Ricerca settimanale di nuovi clienti e invio della presentazione",
    "Verifica documenti passeggeri e inserimento voli in FL3XX",
    "Risposta automatica alle richieste di quotazione in Avinode",
    "Ricerca automatica delle ricevute per le note spese delle carte aziendali",
  ]) {
    assert.equal(titleAgent(title), null, title);
    assert.equal(agentParamOf(title), NO_AGENT_PARAM, title);
  }
});

test("titleAgent: null fuori dalla grammatica", () => {
  for (const title of [
    "Strategia per volo",
    "SAP FI · Accesso in lettura",
    "HR · Due lettere",
    "AI · Due lettere",
    "L1 · Solo codice",
    "Libra L1 · Minuscole",
    "LIBRA L1 - Trattino",
    "LIBRA L1 ·",
    "LIBRA L1 ·Senza spazio",
    "TAIGETE T2·Turni",
    "TJ-0001 · Codice",
    "R2D2 X1 · Cifre",
    "ORSA L1 L2 · Due codici",
    "LIBRA",
    "ABCDEFGHIJKLMNOPQ · Diciassette caratteri",
    "",
  ]) {
    assert.equal(titleAgent(title), null, title);
    assert.equal(agentOfTitle(title), null, title);
  }
  // Falsi positivi noti e innocui: una sigla di tre lettere in testa.
  assert.equal(agentOfTitle("CFO · Report mensile"), "CFO");
  assert.equal(agentOfTitle("IVA · Calcolo trimestrale"), "IVA");
  assert.equal(agentOfTitle("ABCDEFGHIJKLMNOP · Sedici caratteri"), "ABCDEFGHIJKLMNOP");
});

test("titleAgent: prefisso e resto ricompongono il titolo", () => {
  for (const title of [
    "LIBRA L1 · Lettura delle fatture estere",
    "  TAIGETE T12 · Turni  ",
    "LIBRA · Senza codice",
    "LIBRA L1 · Spazi",
    "LIBRA L1  ·  Due spazi",
    "LIBRA L1 · Fatture · estere",
    "CFO · Report",
    "MEROPE M1.2 · Un decimale",
  ]) {
    const found = titleAgent(title);
    assert.ok(found, title);
    assert.equal(found.prefix + found.rest, title.trim(), title);
  }
});

test("parseAgentParam: «altri» o il nome di un agente, con le maiuscole", () => {
  for (const raw of ["LIBRA", "altri", "ÈLIOS", "TAIGETE", "CFO", "ABCDEFGHIJKLMNOP"]) assert.equal(parseAgentParam(raw), raw, raw);
  for (const raw of ["libra", "Libra", "AB", "ABCDEFGHIJKLMNOPQ", "", null, "persona", "LIBRA L1", " LIBRA", "R2D2"]) {
    assert.equal(parseAgentParam(raw), null, String(raw));
  }
});

test("agentParamOf e agentLabel: il nome dell'agente, o «altri» e «Altri use case»", () => {
  assert.equal(agentParamOf("LIBRA L1 · Lettura delle fatture estere"), "LIBRA");
  assert.equal(agentParamOf("Smistamento delle richieste"), "altri");
  assert.equal(agentLabel("LIBRA"), "LIBRA");
  assert.equal(agentLabel(NO_AGENT_PARAM), "Altri use case");
  assert.equal(NO_AGENT_LABEL, "Altri use case");
});

test("agentPalette: in ordine alfabetico su tutte le schede, dieci toni, poi da capo", () => {
  const palette = agentPalette(titles("SIRIO S1 · Cassa", "Senza prefisso", "AUTO H1 · Cedolini", "LIBRA L1 · Fatture", "LIBRA L2 · Pagamenti"));
  assert.deepEqual(palette.tones, { AUTO: 1, LIBRA: 2, SIRIO: 3 });
  // L'ordine delle schede e i doppioni non contano.
  assert.deepEqual(agentPalette(titles("LIBRA L2 · Pagamenti", "AUTO H1 · Cedolini", "SIRIO S1 · Cassa", "AUTO H2 · IBAN")).tones, palette.tones);
  assert.deepEqual(agentPalette(titles("Senza prefisso", "Un altro")).tones, {});
  assert.equal(AGENT_TONES, 10);
  const eleven = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF", "GGG", "HHH", "III", "JJJ", "KKK"];
  const wrapped = agentPalette(eleven.map((agent) => ({ title: `${agent} X1 · Prova` })));
  assert.deepEqual(eleven.map((agent) => wrapped.tones[agent]), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 1], "dall'undicesimo agente si ricomincia");
});

test("agentPalette: i dieci agenti di TopJet hanno dieci colori, i cinque dell'amministrazione tutti diversi", () => {
  const palette = agentPalette(
    titles(
      "LIBRA L1 · Lettura delle fatture estere e bozza di registrazione",
      "SIRIO S3 · File F24 delle tasse passeggeri",
      "SPICA P3 · Calendario dei pagamenti e fabbisogno per banca",
      "ORSA O1 · Voli pieni, vuoti ed empty leg",
      "MAIA M3 · Canale unico per le note spese (modulo di Echo o app collegata)",
      "AUTO X2 · Bonifici massivi e riconciliazione bancaria in Echo",
      "ALCIONE A1 · Presenze del personale di terra senza ricopiature",
      "DENEB D1 · Richieste di riposo e ferie in un modulo, al posto delle email",
      "MEROPE R3 · Checklist di ingresso e uscita",
      "TAIGETE T3 · Pratiche ENAC: lista dei documenti e stato",
      "Strategia per volo",
    ),
  );
  assert.deepEqual(palette.tones, { ALCIONE: 1, AUTO: 2, DENEB: 3, LIBRA: 4, MAIA: 5, MEROPE: 6, ORSA: 7, SIRIO: 8, SPICA: 9, TAIGETE: 10 });
  const afc = ["LIBRA", "SIRIO", "SPICA", "ORSA", "MAIA"].map((agent) => agentToneOf(palette, agent));
  assert.equal(new Set(afc).size, 5, "amministrazione e finanza: cinque colori");
  assert.equal(agentToneOf(palette, "ALCIONE"), 1);
  assert.equal(agentToneOf(palette, "VEGA"), null, "un agente che non c'è");
  assert.equal(agentToneOf(palette, null), null);
  assert.equal(agentToneOf(null, "LIBRA"), null);
  assert.equal(agentToneOf(undefined, "LIBRA"), null);
  assert.equal(agentToneOf(palette, "toString"), null, "niente chiavi ereditate");
});

test("agentFilterOptions: agenti in ordine alfabetico, «Altri use case» in fondo, la scelta resta", () => {
  const items = titles("SIRIO S1 · Cassa", "LIBRA L1 · Fatture", "AUTO H1 · Cedolini", "LIBRA L2 · Pagamenti");
  assert.deepEqual(agentFilterOptions(items, null), [
    { value: "AUTO", label: "AUTO" },
    { value: "LIBRA", label: "LIBRA" },
    { value: "SIRIO", label: "SIRIO" },
  ]);
  const withOthers = agentFilterOptions([...items, ...titles("Strategia per volo")], null);
  assert.deepEqual(withOthers.at(-1), { value: "altri", label: "Altri use case" }, "solo con un titolo senza prefisso");
  assert.equal(withOthers.length, 4);
  // Senza nessun prefisso il campo non c'è.
  assert.deepEqual(agentFilterOptions(titles("Strategia per volo", "Smistamento delle richieste"), null), []);
  assert.deepEqual(agentFilterOptions([], null), []);
  // Un valore dell'indirizzo che nessuna scheda ha resta scelto, al suo posto.
  assert.deepEqual(
    agentFilterOptions(items, "MAIA").map((option) => option.value),
    ["AUTO", "LIBRA", "MAIA", "SIRIO"],
  );
  assert.deepEqual(agentFilterOptions(items, "altri").at(-1), { value: "altri", label: "Altri use case" });
  assert.deepEqual(agentFilterOptions(titles("Strategia per volo"), "LIBRA"), [
    { value: "LIBRA", label: "LIBRA" },
    { value: "altri", label: "Altri use case" },
  ]);
});
