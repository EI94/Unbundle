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
  paletteForTitles,
  paletteHasAgents,
  shortRefOf,
  parseAgentParam,
  titleAgent,
  workspaceAgentPalette,
} from "./agents.ts";

// Gli agenti dal titolo (rilascio «Panoramica»): il prefisso «LIBRA L1 · …», il filtro «Agente» e
// i toni. Le forme dei titoli sono quelle di Rondine (lette il 29/10/2026: 45 approvati con il
// prefisso, uno approvato e quattro proposte senza); gli altri titoli sono inventati.

const titles = (...list: string[]) => list.map((title) => ({ title }));

test("titleAgent: agente, codice, testo del tag, prefisso e resto del titolo", () => {
  assert.deepEqual(titleAgent("LIBRA L1 · Lettura dei documenti esteri e bozza di registrazione"), {
    agent: "LIBRA",
    code: "L1",
    label: "LIBRA L1",
    prefix: "LIBRA L1 · ",
    rest: "Lettura dei documenti esteri e bozza di registrazione",
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
    ["SPICA P2 · Incassi abbinati e stato «paid» nel gestionale", "SPICA", "P2"],
  ] as const) {
    const found = titleAgent(title);
    assert.deepEqual([found?.agent, found?.code], [agent, code], title);
  }
});

test("titleAgent: le forme di Rondine; senza il prefisso nessun agente", () => {
  for (const [title, label] of [
    ["ALCIONE A1 · Presenze del personale di sede senza ricopiature", "ALCIONE A1"],
    ["AUTO X2 · Pagamenti in blocco e riconciliazione con la banca", "AUTO X2"],
    ["TAIGETE T3 · Pratiche dell'ente: lista dei documenti e stato", "TAIGETE T3"],
    ["SPICA P3 · Scadenzario dei pagamenti e cassa per ogni conto", "SPICA P3"],
    ["SIRIO S4 · Regime IVA particolare (art. 17-ter)", "SIRIO S4"],
    ["MAIA M3 · Canale unico per i rimborsi (modulo del gestionale o app collegata)", "MAIA M3"],
  ] as const) {
    assert.equal(titleAgent(title)?.label, label, title);
  }
  // L'approvato senza prefisso e le quattro proposte: «Altri use case».
  for (const title of [
    "Margine per commessa",
    "Ricerca mensile di nuovi contatti e invio della presentazione",
    "Verifica documenti dei clienti e inserimento ordini nel gestionale",
    "Risposta automatica alle richieste di preventivo dal portale",
    "Ricerca automatica degli scontrini per i rimborsi delle carte aziendali",
  ]) {
    assert.equal(titleAgent(title), null, title);
    assert.equal(agentParamOf(title), NO_AGENT_PARAM, title);
  }
});

test("titleAgent: null fuori dalla grammatica", () => {
  for (const title of [
    "Margine per commessa",
    "SAP FI · Accesso in lettura",
    "HR · Due lettere",
    "AI · Due lettere",
    "L1 · Solo codice",
    "Libra L1 · Minuscole",
    "LIBRA L1 - Trattino",
    "LIBRA L1 ·",
    "LIBRA L1 ·Senza spazio",
    "TAIGETE T2·Turni",
    "RD-0001 · Codice",
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
    "LIBRA L1 · Lettura dei documenti esteri",
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
  assert.equal(agentParamOf("LIBRA L1 · Lettura dei documenti esteri"), "LIBRA");
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

test("agentPalette: i dieci agenti di Rondine hanno dieci colori, i cinque dell'amministrazione tutti diversi", () => {
  const palette = agentPalette(
    titles(
      "LIBRA L1 · Lettura dei documenti esteri e bozza di registrazione",
      "SIRIO S3 · File F24 delle imposte locali",
      "SPICA P3 · Scadenzario dei pagamenti e cassa per ogni conto",
      "ORSA O1 · Viaggi pieni, vuoti e di ritorno",
      "MAIA M3 · Canale unico per i rimborsi (modulo del gestionale o app collegata)",
      "AUTO X2 · Pagamenti in blocco e riconciliazione con la banca",
      "ALCIONE A1 · Presenze del personale di sede senza ricopiature",
      "DENEB D1 · Richieste di permessi e ferie in un modulo, al posto delle email",
      "MEROPE R3 · Controlli di apertura e chiusura",
      "TAIGETE T3 · Pratiche dell'ente: lista dei documenti e stato",
      "Margine per commessa",
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

test("workspaceAgentPalette: solo gli use case della Panoramica; una proposta «IVA · …» non sposta nessun colore", () => {
  const approved = (title: string, phase = "approvato") => ({ title, phase });
  const rondine = [
    approved("LIBRA L1 · Lettura dei documenti esteri e bozza di registrazione"),
    approved("SIRIO S3 · File F24 delle imposte locali"),
    approved("SPICA P3 · Scadenzario dei pagamenti e cassa per ogni conto"),
    approved("ORSA O1 · Viaggi pieni, vuoti e di ritorno", "in_realizzazione"),
    approved("MAIA M3 · Canale unico per le note spese"),
    approved("AUTO X2 · Pagamenti in blocco e riconciliazione con la banca"),
    approved("ALCIONE A1 · Presenze del personale di sede senza ricopiature"),
    approved("DENEB D1 · Richieste di permessi e ferie in un modulo, al posto delle email"),
    approved("MEROPE R3 · Controlli di apertura e chiusura", "realizzato"),
    approved("TAIGETE T3 · Pratiche dell'ente: lista dei documenti e stato"),
    approved("Margine per commessa"),
  ];
  const tones = { ALCIONE: 1, AUTO: 2, DENEB: 3, LIBRA: 4, MAIA: 5, MEROPE: 6, ORSA: 7, SIRIO: 8, SPICA: 9, TAIGETE: 10 };
  assert.deepEqual(workspaceAgentPalette(rondine).tones, tones);
  // Una proposta e due schede chiuse con una sigla in testa: nessun tono, nessun colore spostato.
  const withProposal = [
    ...rondine,
    approved("IVA · Calcolo dell'imposta sui biglietti", "da_valutare"),
    approved("CFO · Report mensile", "chiuso"),
    approved("BETA B1 · Prova archiviata", "chiuso"),
  ];
  const palette = workspaceAgentPalette(withProposal);
  assert.deepEqual(palette.tones, tones, "ALCIONE…TAIGETE restano sui toni 1…10");
  assert.equal(agentToneOf(palette, "IVA"), null, "l'agente di sole proposte ha il tag neutro");
  assert.notEqual(agentToneOf(palette, "TAIGETE"), agentToneOf(palette, "ALCIONE"));
  // Il contributore: gli stessi toni dei revisori, solo per gli agenti dei titoli che vede.
  const seen = [{ title: "TAIGETE T3 · Pratiche dell'ente: lista dei documenti e stato" }, { title: "LIBRA L2 · Pagamenti" }, { title: "IVA · Calcolo dell'imposta sui biglietti" }, { title: "Margine per commessa" }];
  const contributor = paletteForTitles(palette, seen);
  assert.deepEqual(contributor.tones, { LIBRA: 4, TAIGETE: 10 });
  for (const agent of ["LIBRA", "TAIGETE"]) assert.equal(agentToneOf(contributor, agent), agentToneOf(palette, agent), agent);
  assert.equal(agentToneOf(contributor, "ALCIONE"), null, "mai il nome di un agente che non vede");
  assert.deepEqual(paletteForTitles(palette, []).tones, {});
  // «I titoli portano gli agenti»: almeno un tono.
  assert.equal(paletteHasAgents(palette), true);
  assert.equal(paletteHasAgents(workspaceAgentPalette([approved("IVA · Calcolo", "da_valutare")])), false);
  assert.equal(paletteHasAgents(null), false);
});

test("agentFilterOptions: agenti in ordine alfabetico, «Altri use case» in fondo, la scelta resta", () => {
  const items = titles("SIRIO S1 · Cassa", "LIBRA L1 · Fatture", "AUTO H1 · Cedolini", "LIBRA L2 · Pagamenti");
  assert.deepEqual(agentFilterOptions(items, null), [
    { value: "AUTO", label: "AUTO" },
    { value: "LIBRA", label: "LIBRA" },
    { value: "SIRIO", label: "SIRIO" },
  ]);
  const withOthers = agentFilterOptions([...items, ...titles("Margine per commessa")], null);
  assert.deepEqual(withOthers.at(-1), { value: "altri", label: "Altri use case" }, "solo con un titolo senza prefisso");
  assert.equal(withOthers.length, 4);
  // Senza nessun prefisso il campo non c'è.
  assert.deepEqual(agentFilterOptions(titles("Margine per commessa", "Smistamento delle richieste"), null), []);
  assert.deepEqual(agentFilterOptions([], null), []);
  // Un valore dell'indirizzo che nessuna scheda ha resta scelto, al suo posto.
  assert.deepEqual(
    agentFilterOptions(items, "MAIA").map((option) => option.value),
    ["AUTO", "LIBRA", "MAIA", "SIRIO"],
  );
  assert.deepEqual(agentFilterOptions(items, "altri").at(-1), { value: "altri", label: "Altri use case" });
  assert.deepEqual(agentFilterOptions(titles("Margine per commessa"), "LIBRA"), [
    { value: "LIBRA", label: "LIBRA" },
    { value: "altri", label: "Altri use case" },
  ]);
});

test("l'etichetta corta dei punti dei grafici: il tag dell'agente, altrimenti il codice", () => {
  assert.equal(shortRefOf({ code: "RD-0001", title: "LIBRA L1 · Lettura dei documenti esteri" }), "LIBRA L1");
  assert.equal(shortRefOf({ code: "RD-0002", title: "ORSA · Solleciti" }), "ORSA");
  assert.equal(shortRefOf({ code: "RD-0003", title: "Margine per commessa" }), "RD-0003");
  assert.equal(shortRefOf({ code: null, title: "Margine per commessa" }), null);
});
