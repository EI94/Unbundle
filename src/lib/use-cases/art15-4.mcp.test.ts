import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { MemoryView } from "../db/queries/context-memory.ts";
import type { ContextLinks } from "../db/queries/context-team.ts";
import { COST_BANDS } from "./cost-bands.ts";
import { askOutputOf, commitmentsOutputOf, contextOutputOf, joinMemory } from "./mcp/context-tools.ts";
import { TEAM_MCP_TOOL_NAMES, teamToolDefinitions, validateTeamToolInput } from "./mcp/contract.ts";
import { COLLECTED_INTAKE_KEYS, cardOutput, needOutput, searchItemOutput } from "./mcp/output.ts";
import { filterSearchItems } from "./mcp/tools.ts";
import type { HubItem, UseCaseDetail } from "./views.ts";

// Art. 15.4 per il MCP del team (docs/use-case/PIANO-LAVORI.md §5.4, DESIGN §11 e §12.5 test 1):
// gli ingressi dei tool non hanno filtri o campi sulla persona; le uscite non hanno il
// proponente, nemmeno per chi gestisce il workspace, la cui proiezione lo porta.
//
// Una sola eccezione, voluta: «Chi» di «Cosa serve» (`ownerLabel`, `ownerSide`, spec di
// Pierpaolo, 25/10/2026) è un testo che il team scrive sulla riga di un'esigenza, come nella
// pagina. Si scrive con `save_needs` e si legge con `list_needs`; nessun tool filtra, ordina o
// conta per lui. Il controllo
// sul sorgente (`art15-4.source.test.ts`) copre già `src/lib/use-cases/mcp/**`, la rotta e
// `src/lib/db/queries/team-mcp-*.ts`.

/** Nomi di campo che parlano di chi ha proposto o di una persona. */
const PERSON_KEY = /propos|submitter|submitted_?by|autore|author|persona|actor|owner|created_?by|reviewed_?by|^email$|^user_?id$/i;

function keysOf(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const item of node) keysOf(item, out);
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      out.push(key);
      keysOf(value, out);
    }
  }
  return out;
}

/** Le chiavi di `properties` degli schemi (i nomi dei campi d'ingresso), a ogni livello. */
function inputFieldNames(schema: unknown, out: string[] = []): string[] {
  if (Array.isArray(schema)) {
    for (const item of schema) inputFieldNames(item, out);
  } else if (schema && typeof schema === "object") {
    for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
      if (key === "properties" && value && typeof value === "object") out.push(...Object.keys(value as object));
      inputFieldNames(value, out);
    }
  }
  return out;
}

/** «Chi» di un'esigenza: un testo della riga, scritto dal team; solo `save_needs` lo riceve. */
const NEED_OWNER_FIELDS = ["ownerLabel", "ownerSide"];
/** «(proposta)» accanto alla scadenza: la data è da confermare. Non parla di chi ha proposto. */
const DUE_IS_PROPOSAL = "dueIsProposal";

test("ingressi dei 14 tool: nessun campo o filtro sulla persona; «Chi» di un'esigenza solo in save_needs", () => {
  const defs = teamToolDefinitions();
  assert.equal(defs.length, TEAM_MCP_TOOL_NAMES.length);
  assert.equal(defs.length, 14);
  for (const def of defs) {
    const fields = inputFieldNames(def.inputSchema);
    assert.ok(fields.length > 0, def.name);
    const allowed = def.name === "save_needs" ? ["confirmedByUser", DUE_IS_PROPOSAL, ...NEED_OWNER_FIELDS] : ["confirmedByUser"];
    assert.deepEqual(fields.filter((name) => !allowed.includes(name) && PERSON_KEY.test(name)), [], def.name);
  }
  const save = inputFieldNames(defs.find((def) => def.name === "save_needs")!.inputSchema);
  assert.deepEqual(save.filter((name) => PERSON_KEY.test(name) && name !== "confirmedByUser" && name !== DUE_IS_PROPOSAL), NEED_OWNER_FIELDS);
});

/**
 * (Rilascio 9a) `participants` di `add_context_notes` è «Con chi» della call: un testo libero degli appunti, che vede
 * solo Lateral Space e che non va al modello. Non è un filtro né un campo su chi ha proposto uno use case: nessuno
 * strumento cerca, ordina o conta per lui, e nessuna uscita lo restituisce (context-tools.test.ts).
 */
test("«Contesto»: participants è «Con chi» della call, solo in add_context_notes; nessun filtro su chi aggiunge o conferma", () => {
  const defs = teamToolDefinitions();
  const fieldsOf = (name: string) => inputFieldNames(defs.find((def) => def.name === name)!.inputSchema);
  assert.deepEqual(fieldsOf("add_context_notes").sort(), ["confirmedByUser", "date", "idempotencyKey", "link", "participants", "text", "title"]);
  assert.deepEqual(fieldsOf("list_context_proposals"), ["sourceId"]);
  for (const def of defs.filter((d) => d.name !== "add_context_notes")) assert.equal(inputFieldNames(def.inputSchema).includes("participants"), false, def.name);
  for (const key of ["participants", "addedBy", "confirmedBy", "persona", "userId", "email"]) {
    assert.equal(validateTeamToolInput("list_context_proposals", { [key]: "chiunque" }).ok, false, key);
  }
});

/**
 * (Rilascio 9b, RILASCIO-9b-COSTRUZIONE.md §2.7, §2.14) Le tre letture della memoria: un impegno vale per parte e ruolo,
 * mai per persona; nessuno strumento filtra per chi ha confermato un fatto, chi ha aggiunto gli appunti o «Con chi», e
 * nessuna uscita li restituisce, nemmeno se la vista letta li portasse.
 */
test("«Contesto» nel lavoro: get_context, ask_context e list_context_commitments non filtrano né restituiscono per persona", () => {
  const defs = teamToolDefinitions();
  const fieldsOf = (name: string) => inputFieldNames(defs.find((def) => def.name === name)!.inputSchema);
  assert.deepEqual(fieldsOf("get_context"), ["useCase", "section", "since"]);
  assert.deepEqual(fieldsOf("ask_context"), ["question"]);
  assert.deepEqual(fieldsOf("list_context_commitments"), ["party", "useCase", "overdueOnly"]);
  for (const name of ["get_context", "ask_context", "list_context_commitments"] as const) {
    for (const key of ["persona", "owner", "ownerUserId", "userId", "email", "confirmedBy", "addedBy", "participants", "assignee", "role"]) {
      assert.equal(validateTeamToolInput(name, { question: "Che gestionale usano?", [key]: "Mario Rossi" }).ok, false, `${name}: ${key}`);
    }
  }

  // Righe con campi in più sulla persona, come una vista futura: non escono.
  const who = { confirmedBy: { name: "Persona che ha confermato", on: "2026-11-14" }, confirmedByUserId: randomUUID(), addedBy: PROPOSER_EMAIL, participants: "Persona della call", ownerUserId: randomUUID(), email: PROPOSER_EMAIL, quote: "Citazione della call" };
  const factId = randomUUID();
  const commitmentId = randomUUID();
  const questionId = randomUUID();
  const useCaseId = randomUUID();
  const memory = {
    sections: [
      {
        section: "sistemi",
        live: [],
        facts: [{ id: factId, version: 1, kind: "fatto", section: "sistemi", statement: "Il gestionale è SAP Business One.", basis: "detto", visibility: "tutti", needsCheck: false, sourceKind: "call", sourceLabel: "Call 14 nov", lastConfirmedOn: "2026-11-14", ...who }],
      },
    ],
    nextSteps: { nostri: [{ id: commitmentId, version: 1, statement: "Mandare il preventivo.", party: "nostra", roleLabel: "Responsabile del progetto", dueOn: "2026-11-20", overdue: false, visibility: "tutti", ...who }], cliente: [] },
    questions: [{ id: questionId, version: 1, question: "Chi approva gli acquisti?", askWhom: "Direzione acquisti", visibility: "tutti", ...who }],
    brief: { lines: ["Distributore di ricambi."], updatedOn: "2026-11-15" },
    novelties: null,
    counts: { facts: 1, openProposals: 0, unreadSources: 0, pendingSourceIds: [], toCheck: 0 },
  } as unknown as MemoryView;
  const links: ContextLinks = {
    useCases: { [useCaseId]: { code: "XX-0042", title: "Smistamento richieste" } },
    facts: { [factId]: { useCaseIds: [useCaseId], createdOn: "2026-11-14" } },
    commitments: { [commitmentId]: [useCaseId] },
    questions: { [questionId]: [] },
  };
  for (const lateralSpace of [true, false]) {
    const read = joinMemory(memory, links, { isLateralSpace: lateralSpace });
    const outputs = [
      contextOutputOf(read, {}, links.useCases, "https://www.theunbundle.com/dashboard/x/contesto"),
      commitmentsOutputOf(read, {}, links.useCases, "https://www.theunbundle.com/dashboard/x/contesto"),
      askOutputOf({ status: "risposta", answer: "Usano SAP Business One [1].", sources: [{ n: 1, kind: "fatto", label: "Call 14 nov", date: "2026-11-14", excerpt: "Il gestionale è SAP Business One." }] }, "2026-11-16"),
    ];
    for (const output of outputs) {
      const text = JSON.stringify(output);
      assert.equal(text.includes(PROPOSER_EMAIL), false);
      assert.equal(/Persona che ha confermato|Persona della call|Citazione della call/.test(text), false);
      assert.deepEqual(keysOf(output).filter((key) => PERSON_KEY.test(key) || /^(quote|participants|addedBy|confirmedBy)$/.test(key)), [], `Lateral Space ${lateralSpace}`);
    }
  }
});

test("list_needs rifiuta ogni filtro sulla persona, anche su «Chi»", () => {
  for (const key of ["ownerLabel", "ownerSide", "owner", "chi", "persona", "proposedBy", "email", "userId"]) {
    assert.equal(validateTeamToolInput("list_needs", { [key]: "Ufficio IT" }).ok, false, key);
  }
});

test("uscite di list_needs: «Chi» resta il testo della riga, nessun'altra chiave sulla persona", () => {
  const out = needOutput(
    {
      id: randomUUID(),
      type: "requisito",
      kind: "persona",
      title: "Referente per i dati",
      detail: null,
      ownerLabel: "Ufficio acquisti",
      ownerSide: "cliente",
      status: "chiesta",
      availability: null,
      dueOn: null,
      dueLabel: null,
      dueIsProposal: false,
      forLabel: null,
      sortOrder: 0,
      version: 1,
      importKey: null,
      createdAt: "2026-10-20T08:00:00.000Z",
      updatedAt: "2026-10-20T08:00:00.000Z",
      doneAt: null,
      archivedAt: null,
      archiveReason: null,
      useCaseIds: [],
    },
    { today: "2026-10-25", refs: {}, link: () => "" },
  );
  assert.deepEqual(keysOf(out).filter((key) => PERSON_KEY.test(key) && key !== DUE_IS_PROPOSAL), ["ownerLabel", "ownerSide", "ownerSideLabel"]);
});

test("search_use_cases rifiuta ogni parametro sulla persona, anche scritto a mano", () => {
  for (const key of ["proponente", "proposedBy", "proposed_by", "autore", "persona", "submitterEmail", "submittedByUserId", "email", "actorUserId", "ownerUserId"]) {
    const result = validateTeamToolInput("search_use_cases", { [key]: "qualcuno@cliente.test" });
    assert.equal(result.ok, false, key);
  }
});

const PROPOSER_EMAIL = "proponente.art154@cliente.test";

function item(over: Partial<HubItem> = {}): HubItem {
  return {
    id: randomUUID(),
    code: "XX-0042",
    title: "Smistamento richieste",
    origin: "adoption",
    kind: "da_costruire",
    phase: "da_valutare",
    subState: "nuova",
    phaseLabel: "Da valutare · Nuova",
    tone: "grigio",
    quando: null,
    targetQuarter: null,
    reviewBy: null,
    value: { score: null, word: null, source: null, perYear: null },
    cost: null,
    zone: null,
    valueModel: null,
    risks: [],
    claudeHoursPerYear: null,
    source: "web_proposed",
    area: null,
    aiLab: null,
    hiddenFromSearch: false,
    publicNote: null,
    answered: false,
    problemPreview: null,
    arrivedOn: "2026-10-01",
    waitingSince: "2026-10-01",
    realizedOn: null,
    dossier: null,
    version: 1,
    ...over,
  };
}

test("uscite: né search_use_cases né get_use_case portano il proponente, nemmeno dalla proiezione di chi gestisce", () => {
  const base = item();
  // Una riga con campi in più (come una proiezione futura o quella di chi gestisce): non escono.
  const managerDetail = {
    ...base,
    description: "Problema",
    flowDescription: null,
    humanInTheLoop: null,
    guardrails: null,
    businessCase: null,
    dataRequirements: null,
    sustainabilityImpact: null,
    intake: { area: "Operazioni", frequency: "settimanale", submitterEmail: PROPOSER_EMAIL },
    possibleDuplicateOf: null,
    customScores: null,
    aiSuggestion: null,
    valueEurYear: null,
    costEurOnce: null,
    costBand: null,
    reviewNotes: "Nota interna",
    timeline: null,
    requirements: null,
    dataDependencies: null,
    proposer: { label: "Persona che ha proposto", email: PROPOSER_EMAIL },
    proposedBy: PROPOSER_EMAIL,
    submittedByUserId: randomUUID(),
  } as UseCaseDetail & Record<string, unknown>;
  const outputs = [
    searchItemOutput({ ...base, proposedBy: PROPOSER_EMAIL } as HubItem, COST_BANDS, "2026-10-19"),
    cardOutput(managerDetail, {
      model: { dimensions: { impact: [], feasibility: [], esg: [] } },
      costBands: COST_BANDS,
      esgEnabled: false,
      today: "2026-10-19",
      dossierRead: "ok",
      link: "https://www.theunbundle.com/dashboard/x/use-cases/y",
    }),
  ];
  for (const output of outputs) {
    const text = JSON.stringify(output);
    assert.equal(text.includes(PROPOSER_EMAIL), false);
    assert.equal(text.includes("Persona che ha proposto"), false);
    assert.equal(text.includes("Nota interna"), false, "le note interne non escono");
    assert.deepEqual(keysOf(output).filter((key) => PERSON_KEY.test(key) && key !== "proposerEstimate"), []);
  }
});

test("i dati raccolti della scheda sono un elenco chiuso, senza recapiti di chi ha proposto", () => {
  assert.ok(COLLECTED_INTAKE_KEYS.includes("frequency") && COLLECTED_INTAKE_KEYS.includes("risposte"));
  for (const key of ["submitterEmail", "submitterName", "proposedBy", "submittedBy", "email"]) assert.equal(COLLECTED_INTAKE_KEYS.includes(key), false, key);
});

test("i filtri della ricerca non guardano mai chi ha proposto", () => {
  const items = [item({ code: "XX-0001" }), item({ code: "XX-0002" })];
  const withPerson = { ...{}, proponente: PROPOSER_EMAIL } as unknown as Parameters<typeof filterSearchItems>[1];
  assert.deepEqual(filterSearchItems(items, withPerson).map((i) => i.code), ["XX-0001", "XX-0002"], "un campo sconosciuto non filtra");
});
