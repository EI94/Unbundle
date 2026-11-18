import test from "node:test";
import assert from "node:assert/strict";
import { AGENT_CONTEXT_TEXT, agentSourcePhrase, contextBriefLine, formatAgentContext, formatContestoMd, slashDay, type AgentContext, type AgentFact } from "./agent-text.ts";

// Il contesto per i coding agent (RILASCIO-9b-COSTRUZIONE.md §2.4, §2.5): CONTESTO.md, lo strato `contesto`, la riga del
// brief. Dati inventati: il caso XX-0012, nessun nome di persona.

const fact = (statement: string, over: Partial<AgentFact> = {}): AgentFact => ({ statement, section: "sistemi", source: "call", on: "2026-11-14", ...over });
const EMPTY: AgentContext = { brief: [], caseFacts: [], rules: [], words: [], commitments: [], questions: [], since: null };
const FULL: AgentContext = {
  brief: ["Azienda di arredamento con due stabilimenti.", "Gli ordini arrivano soprattutto via e-mail."],
  caseFacts: [fact("Il gestionale è SAP Business One."), fact("Le fatture si esportano ogni notte.", { source: "documento", on: "2026-11-10" })],
  rules: [fact("I dati dei clienti restano in Italia.", { section: "regole", source: "referente", on: "2026-11-12" })],
  words: [fact("«Commessa» vuol dire un ordine con il suo progetto.", { section: "parole", source: "costruzione", on: "2026-11-18" })],
  commitments: [{ statement: "Inviare l'esportazione delle fatture", party: "cliente", role: "Responsabile amministrativo", dueOn: "2026-11-25" }],
  questions: [{ question: "Chi approva gli acquisti sopra soglia?", askWhom: "Direzione acquisti" }],
  since: null,
};

test("CONTESTO.md: l'intestazione con codice e versione, «In breve», le tre sezioni di fatti, la fonte di ogni riga", () => {
  const file = formatContestoMd(FULL, { code: "XX-0012", version: 3, day: "2026-11-18" });
  assert.equal(
    file,
    [
      "# Contesto del cliente per XX-0012 (k3)",
      "",
      "Sola lettura: lo scrive Unbundle con i fatti che Lateral Space ha confermato. Le persone sono indicate per ruolo. Aggiornato il 2026-11-18.",
      "",
      "## In breve",
      "- Azienda di arredamento con due stabilimenti.",
      "- Gli ordini arrivano soprattutto via e-mail.",
      "",
      "## Che cosa tocca questo caso",
      "- Il gestionale è SAP Business One. (call del 14/11/2026)",
      "- Le fatture si esportano ogni notte. (documento del 10/11/2026)",
      "",
      "## Regole e vincoli",
      "- I dati dei clienti restano in Italia. (risposta del referente del 12/11/2026)",
      "",
      "## Parole del cliente",
      "- «Commessa» vuol dire un ordine con il suo progetto. (imparato costruendo il 18/11/2026)",
      "",
    ].join("\n"),
  );
  // Impegni e domande stanno nello strato, non nel file del pacchetto.
  assert.doesNotMatch(file ?? "", /Inviare l'esportazione|Chi approva/);
});

test("CONTESTO.md: le sezioni vuote non si scrivono; senza fatti niente file, anche con «In breve»", () => {
  assert.equal(formatContestoMd(EMPTY, { code: "XX-0012", version: 1, day: "2026-11-18" }), null);
  assert.equal(formatContestoMd({ ...EMPTY, brief: ["Una riga di «In breve»."] }, { code: "XX-0012", version: 1, day: "2026-11-18" }), null);
  const onlyRules = formatContestoMd({ ...EMPTY, rules: [fact("Nessun dato esce dall'Italia.", { section: "regole" })] }, { code: "XX-0012", version: 2, day: "2026-11-18" }) ?? "";
  assert.match(onlyRules, /## Regole e vincoli\n- Nessun dato esce dall'Italia\. \(call del 14\/11\/2026\)\n$/);
  assert.doesNotMatch(onlyRules, /## In breve|## Che cosa tocca|## Parole del cliente/);
});

test("CONTESTO.md: ogni riga al massimo 220 caratteri, i tetti del piano (6, 40, 25, 25)", () => {
  const long = fact(`Il processo ${"molto ".repeat(60)}lungo.`);
  const file = formatContestoMd(
    {
      ...EMPTY,
      brief: Array.from({ length: 9 }, (_, i) => `Riga ${i + 1} di «In breve».`),
      caseFacts: [long, ...Array.from({ length: 50 }, (_, i) => fact(`Fatto ${i + 1} dello use case.`))],
      rules: Array.from({ length: 30 }, (_, i) => fact(`Regola ${i + 1}.`, { section: "regole" })),
      words: Array.from({ length: 30 }, (_, i) => fact(`Parola ${i + 1}.`, { section: "parole" })),
    },
    { code: "XX-0012", version: 1, day: "2026-11-18" },
  ) ?? "";
  for (const line of file.split("\n")) assert.ok(line.length <= 220, `${line.length}: ${line.slice(0, 40)}`);
  assert.ok(file.includes(`- Il processo ${"molto ".repeat(10)}`) && file.split("\n").some((line) => line.length === 220 && line.endsWith("…")));
  const count = (prefix: string) => file.split("\n").filter((line) => line.startsWith(prefix)).length;
  assert.equal(count("- Riga "), 6);
  assert.equal(count("- Fatto ") + count("- Il processo"), 40);
  assert.equal(count("- Regola "), 25);
  assert.equal(count("- Parola "), 25);
});

test("le fonti tra parentesi: call, documento, risposta del referente, imparato costruendo, scritto a mano, senza fonte", () => {
  assert.equal(agentSourcePhrase({ source: "call", on: "2026-11-14" }), "call del 14/11/2026");
  assert.equal(agentSourcePhrase({ source: "documento", on: "2026-11-14" }), "documento del 14/11/2026");
  assert.equal(agentSourcePhrase({ source: "referente", on: "2026-11-14" }), "risposta del referente del 14/11/2026");
  assert.equal(agentSourcePhrase({ source: "costruzione", on: "2026-11-14" }), "imparato costruendo il 14/11/2026");
  assert.equal(agentSourcePhrase({ source: "manuale", on: "2026-11-14" }), "scritto a mano");
  assert.equal(agentSourcePhrase({ source: "senza_fonte", on: "" }), "senza fonte");
  assert.equal(agentSourcePhrase({ source: "call", on: "" }), "call");
  assert.equal(slashDay("2026-11-04"), "04/11/2026");
  assert.equal(slashDay("non una data"), "");
});

test("lo strato `contesto`: tutte le sezioni, impegni per parte e ruolo, domande con a chi chiedere, la frase finale", () => {
  assert.equal(
    formatAgentContext(FULL, { code: "XX-0012" }),
    [
      "Contesto del cliente per XX-0012",
      "",
      "In breve",
      "- Azienda di arredamento con due stabilimenti.",
      "- Gli ordini arrivano soprattutto via e-mail.",
      "Che cosa tocca questo caso",
      "- Il gestionale è SAP Business One. (call del 14/11/2026)",
      "- Le fatture si esportano ogni notte. (documento del 10/11/2026)",
      "Regole e vincoli",
      "- I dati dei clienti restano in Italia. (risposta del referente del 12/11/2026)",
      "Parole del cliente",
      "- «Commessa» vuol dire un ordine con il suo progetto. (imparato costruendo il 18/11/2026)",
      "Impegni aperti",
      "- Inviare l'esportazione delle fatture · del cliente · Responsabile amministrativo · entro il 25/11/2026",
      "Domande aperte",
      "- Chi approva gli acquisti sopra soglia? · da chiedere a: Direzione acquisti",
      "",
      "I fatti li conferma Lateral Space. Se un fatto non torna, dillo alla persona: non correggerlo nel repository.",
    ].join("\n"),
  );
  const ours = formatAgentContext({ ...EMPTY, commitments: [{ statement: "Preparare la demo", party: "nostra", role: null, dueOn: null }] }, { code: "XX-0012" });
  assert.match(ours, /\n- Preparare la demo · nostro\n/);
  assert.equal(formatAgentContext(EMPTY, { code: "XX-0012" }), "Contesto del cliente per XX-0012\n\nAncora niente nella memoria del cliente per questo caso.");
});

test("lo strato con `since`: in cima «Dal …» con i conti, sotto solo i fatti nuovi e cambiati", () => {
  const since = { from: "2026-11-01", added: 3, changed: 1, retired: 1 };
  const text = formatAgentContext({ ...FULL, since }, { code: "XX-0012" });
  assert.ok(text.startsWith("Contesto del cliente per XX-0012\n\nDal 01/11/2026: 3 fatti nuovi, 1 cambiato, 1 tolto.\n\nChe cosa tocca questo caso\n"), text);
  assert.ok(text.includes("- Il gestionale è SAP Business One. (call del 14/11/2026)"));
  // Con `since` niente «In breve», impegni e domande: solo i fatti che `loadAgentContext` porta.
  assert.doesNotMatch(text, /In breve|Impegni aperti|Domande aperte|Inviare l'esportazione|Chi approva/);
  assert.equal(
    formatAgentContext({ ...EMPTY, since: { from: "2026-11-01", added: 0, changed: 0, retired: 0 } }, { code: "XX-0012" }),
    "Contesto del cliente per XX-0012\n\nDal 01/11/2026: niente di nuovo nel contesto.",
  );
  assert.match(formatAgentContext({ ...EMPTY, since: { from: "2026-11-01", added: 1, changed: 2, retired: 0 } }, { code: "XX-0012" }), /Dal 01\/11\/2026: 1 fatto nuovo, 2 cambiati\.$/);
  assert.match(formatAgentContext({ ...EMPTY, since: { from: "2026-11-01", added: 0, changed: 0, retired: 2 } }, { code: "XX-0012" }), /Dal 01\/11\/2026: 2 tolti\.$/);
});

test("la riga del brief: null senza novità, le due forme, sotto i 110 caratteri", () => {
  assert.equal(contextBriefLine({ code: "XX-0012", delta: 0, packageVersion: 2 }), null);
  assert.equal(contextBriefLine({ code: "XX-0012", delta: -1, packageVersion: null }), null);
  assert.equal(contextBriefLine({ code: "XX-0012", delta: Number.NaN, packageVersion: 2 }), null);
  assert.equal(contextBriefLine({ code: "XX-0012", delta: 3, packageVersion: 2 }), "Contesto: 3 novità dopo il pacchetto k2 (unbundle context XX-0012 --contesto).");
  assert.equal(contextBriefLine({ code: "XX-0012", delta: 1, packageVersion: 2 }), "Contesto: 1 novità dopo il pacchetto k2 (unbundle context XX-0012 --contesto).");
  assert.equal(contextBriefLine({ code: "XX-0012", delta: 12, packageVersion: null }), "Contesto: 12 fatti sul cliente (unbundle context XX-0012 --contesto).");
  assert.equal(contextBriefLine({ code: "XX-0012", delta: 1, packageVersion: null }), "Contesto: 1 fatto sul cliente (unbundle context XX-0012 --contesto).");
  for (const line of [contextBriefLine({ code: "XXXX-9999", delta: 999, packageVersion: 999 }), contextBriefLine({ code: "XXXX-9999", delta: 999, packageVersion: null })]) {
    assert.ok(line && line.length < 110, `${line?.length}: ${line}`);
  }
});

test("i testi per gli agenti dicono «caso», mai «use case» né «caso d'uso»; nessun nome di persona", () => {
  const texts: string[] = [];
  const walk = (node: unknown) => {
    if (typeof node === "string") texts.push(node);
    else if (typeof node === "function") {
      const out = (node as (...args: unknown[]) => unknown)("XX-0012", 2, "XX-0012", "estratto");
      if (typeof out === "string") texts.push(out);
    } else if (node && typeof node === "object") for (const value of Object.values(node)) walk(value);
  };
  walk(AGENT_CONTEXT_TEXT);
  assert.ok(texts.length > 40, `${texts.length} testi`);
  for (const text of texts) {
    assert.doesNotMatch(text, /use case|caso d['’]uso|casi d['’]uso/i, text);
    assert.doesNotMatch(text, /\b[a-z]+_[a-z_]+\b/, `${text}: nessuna chiave interna`);
  }
  assert.equal(AGENT_CONTEXT_TEXT.learn.needYes, "Serve il sì della persona: chiedilo, poi ripeti con --si.");
  assert.equal(AGENT_CONTEXT_TEXT.unavailable, "Unbundle non risponde: riprova tra qualche minuto.");
});
