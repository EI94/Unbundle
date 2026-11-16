/**
 * Solo per i test e per la vetrina delle schermate: nessun file dell'app lo importa.
 *
 * Una board inventata: l'unità «Ufficio acquisti», due processi, sei passi generici. Mai nomi, persone o testi di un
 * cliente (docs/mappatura/MAPPATURA-BOARD-PIANO.md, in testa). Gli id sono fissi, così i test li possono nominare.
 *
 * Modulo puro.
 */
import { emptyNotes, type BoardNote, type BoardStep, type MappingBoard, type UnitBoardSummary } from "./board-model.ts";
import type { Friction, NoteStatus, Origin, StepLane, StepStatus, Stream, WorkType } from "./vocab.ts";

const uuid = (group: string, n: number) => `${group}${group}${group}${group}${group}${group}${group}${group}-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const FIXTURE_IDS = Object.freeze({
  unit: uuid("d", 1),
  workspace: uuid("e", 1),
  /** Chi ha la board aperta (la sua bozza sul dispositivo). */
  user: uuid("f", 1),
  processA: uuid("a", 1),
  processB: uuid("a", 2),
  richieste: uuid("b", 1),
  confronto: uuid("b", 2),
  scelta: uuid("b", 3),
  ordine: uuid("b", 4),
  solleciti: uuid("b", 5),
  controllo: uuid("b", 6),
});

let noteSeq = 0;
function note(lane: StepLane | "analisi", text: string, status: NoteStatus = "validato", origin: Origin = "board", title: string | null = null): BoardNote {
  return { id: uuid("c", ++noteSeq), lane, title, text, status, origin };
}

interface StepSeed {
  id: string;
  title: string;
  description?: string;
  who?: string[];
  tools?: string[];
  input?: string;
  output?: string;
  decision?: string;
  decisionLabel?: string;
  exception?: string;
  friction?: Friction;
  frequency?: string;
  hoursWeek?: number;
  quality?: string;
  workType?: WorkType;
  status?: StepStatus;
  origin?: Origin;
  notes?: Partial<Record<StepLane, BoardNote[]>>;
  stream?: Stream;
  proposedStream?: Stream;
  confidence?: number;
  reason?: string;
  aiPotential?: string;
  onetCode?: string;
  onetTitle?: string;
  aiExposure?: number;
  dependsOn?: string[];
  neededBy?: string[];
}

function step(seed: StepSeed, classified: boolean): BoardStep {
  const notes = { ...emptyNotes(), ...seed.notes };
  return {
    id: seed.id,
    title: seed.title,
    description: seed.description ?? null,
    who: seed.who ?? [],
    tools: seed.tools ?? [],
    input: seed.input ?? null,
    output: seed.output ?? null,
    decision: seed.decision ?? null,
    decisionLabel: seed.decisionLabel ?? null,
    exception: seed.exception ?? null,
    friction: seed.friction ?? (notes.attriti.length > 0 ? 2 : 0),
    frictionSet: seed.friction !== undefined,
    frequency: seed.frequency ?? null,
    hoursWeek: seed.hoursWeek ?? null,
    quality: seed.quality ?? null,
    workType: seed.workType ?? null,
    status: seed.status ?? "confermato",
    origin: seed.origin ?? "board",
    notes,
    stream: classified ? (seed.stream ?? null) : null,
    proposedStream: classified ? (seed.proposedStream ?? seed.stream ?? null) : null,
    confidence: classified ? (seed.confidence ?? null) : null,
    reason: classified ? (seed.reason ?? null) : null,
    aiPotential: classified ? (seed.aiPotential ?? null) : null,
    onetCode: classified ? (seed.onetCode ?? null) : null,
    onetTitle: classified ? (seed.onetTitle ?? null) : null,
    aiExposure: classified ? (seed.aiExposure ?? null) : null,
    dependsOn: seed.dependsOn ?? [],
    neededBy: seed.neededBy ?? [],
    useCaseIds: [],
  };
}

/**
 * «Ufficio acquisti»: due processi, sei passi. `classified`: dopo «Completa la mappatura» (cinque passi con lo stream,
 * uno da classificare, uno corretto a mano). `empty`: l'unità senza passi.
 */
export function fixtureBoard(options: { classified?: boolean; empty?: boolean; readOnly?: boolean } = {}): MappingBoard {
  noteSeq = 0;
  const classified = options.classified === true;
  const I = FIXTURE_IDS;
  const analysis = [
    note("analisi", "Ogni ordine chiede in media tre solleciti. Nessuno li conta.", "validato", "board", "Il tempo va nei solleciti"),
    note("analisi", "Le richieste arrivano senza centro di costo e tornano indietro.", "fonte", "chat", "Le richieste partono incomplete"),
  ];
  const processA = [
    step(
      {
        id: I.richieste,
        title: "Raccolta delle richieste",
        description: "Le richieste degli uffici arrivano per e-mail e si copiano in un foglio.",
        who: ["Buyer"],
        tools: ["E-mail", "Foglio di calcolo"],
        input: "La richiesta di un ufficio.",
        output: "Una riga nel foglio delle richieste.",
        decision: "Chi compra decide se la richiesta è completa.",
        decisionLabel: "Richiesta completa",
        exception: "Se manca il centro di costo, la richiesta torna indietro.",
        friction: 3,
        frequency: "giornaliera",
        hoursWeek: 6.5,
        quality: "Media",
        workType: "enrichment",
        notes: {
          attivita: [note("attivita", "Si apre la casella condivisa"), note("attivita", "Si copia la richiesta nel foglio", "ipotesi")],
          attriti: [note("attriti", "Richieste incomplete"), note("attriti", "Nessun modulo unico", "fonte", "chat")],
          dati: [note("dati", "Elenco dei fornitori", "fonte", "documenti")],
          tempi: [note("tempi", "Quaranta richieste a settimana")],
          idee: [note("idee", "Un modulo unico per tutti gli uffici")],
        },
        stream: "automate",
        confidence: 0.86,
        reason: "Lavoro ripetitivo, con dati in ingresso e in uscita chiari.",
        aiPotential: "La richiesta si può leggere e completare da sola.",
        onetCode: "13-1023.00",
        onetTitle: "Purchasing agents",
        aiExposure: 0.34,
        neededBy: [I.confronto],
      },
      classified,
    ),
    step(
      {
        id: I.confronto,
        title: "Confronto delle offerte",
        description: "Per ogni richiesta si chiedono tre offerte e si confrontano.",
        who: ["Buyer", "Ufficio tecnico"],
        tools: ["E-mail", "Foglio di calcolo", "Portale fornitori", "Telefono", "Archivio offerte"],
        frequency: "settimanale",
        hoursWeek: 8,
        workType: "detection",
        status: "da_validare",
        origin: "chat",
        notes: { attriti: [note("attriti", "Offerte in formati diversi", "fonte", "chat")] },
        stream: "automate",
        proposedStream: "differentiate",
        confidence: 0.61,
        reason: "Il confronto è meccanico, ma la scelta dei criteri no.",
        aiPotential: "Le offerte si possono riportare in una tabella unica.",
        aiExposure: 0.22,
        dependsOn: [I.richieste],
        neededBy: [I.scelta],
      },
      classified,
    ),
    step(
      {
        id: I.scelta,
        title: "Scelta del fornitore",
        description: "Si sceglie l'offerta e si motiva la scelta.",
        who: ["Responsabile acquisti"],
        tools: ["Foglio di calcolo"],
        decision: "Il responsabile sceglie il fornitore e firma.",
        decisionLabel: "Scelta del fornitore",
        hoursWeek: 3,
        workType: "interpretation",
        stream: "differentiate",
        confidence: 0.9,
        reason: "Qui contano l'esperienza e il rapporto con i fornitori.",
        dependsOn: [I.confronto],
      },
      classified,
    ),
    step({ id: I.ordine, title: "Invio dell'ordine", who: ["Buyer"], tools: ["Gestionale"], frequency: "settimanale", hoursWeek: 2, workType: "delivery", friction: 1 }, classified),
  ];
  const processB = [
    step(
      {
        id: I.solleciti,
        title: "Solleciti di consegna",
        description: "Si chiama o si scrive al fornitore quando la merce tarda.",
        who: ["Buyer"],
        tools: ["Telefono", "E-mail"],
        frequency: "giornaliera",
        hoursWeek: 5,
        status: "da_validare",
        origin: "documenti",
        notes: { attriti: [note("attriti", "Tre solleciti per ordine", "fonte", "documenti")] },
        stream: "automate",
        confidence: 0.8,
        aiExposure: 0.4,
      },
      classified,
    ),
    step(
      {
        id: I.controllo,
        title: "Controllo della merce",
        who: ["Magazzino"],
        decision: "Chi riceve decide se accettare la merce.",
        hoursWeek: 4,
        stream: "innovate",
        confidence: 0.55,
        reason: "Dai controlli può nascere una valutazione dei fornitori che oggi non c'è.",
      },
      classified,
    ),
  ];
  const can = options.readOnly ? { edit: false, setStream: false, complete: false } : { edit: true, setStream: true, complete: true };
  if (options.empty) {
    return {
      unit: { id: I.unit, name: "Ufficio acquisti", description: "Compra materiali e servizi per gli altri uffici.", teamSize: 6, status: "not_started" },
      revision: 0,
      savedAt: null,
      headline: null,
      processes: [],
      analysis: [],
      useCases: [],
      can,
      store: "pronto",
    };
  }
  return {
    unit: { id: I.unit, name: "Ufficio acquisti", description: "Compra materiali e servizi per gli altri uffici.", teamSize: 6, status: classified ? "mapped" : "in_progress" },
    revision: 7,
    savedAt: "2026-11-16T09:30:00.000Z",
    headline: classified ? "Un terzo del tempo va a rincorrere richieste incomplete e consegne in ritardo." : null,
    processes: [
      { id: I.processA, name: "Dalla richiesta all'ordine", owner: "Responsabile acquisti", votes: 3, myVotes: 1, steps: processA },
      { id: I.processB, name: "Dall'ordine alla consegna", owner: null, votes: 0, myVotes: 0, steps: processB },
    ],
    analysis,
    useCases: [],
    can,
    store: "pronto",
  };
}

/** Le unità di un workspace inventato, per l'elenco. */
export function fixtureUnits(): UnitBoardSummary[] {
  return [
    { id: FIXTURE_IDS.unit, name: "Ufficio acquisti", description: "Compra materiali e servizi per gli altri uffici.", teamSize: 6, status: "mapped", processes: 2, steps: 6, hoursWeek: 28.5, toValidate: 2, unclassified: 1, streams: { automate: 3, differentiate: 1, innovate: 1 } },
    { id: uuid("d", 2), name: "Magazzino", description: "Riceve, sistema e spedisce la merce.", teamSize: 12, status: "in_progress", processes: 1, steps: 4, hoursWeek: 31, toValidate: 4, unclassified: 4, streams: { automate: 0, differentiate: 0, innovate: 0 } },
    { id: uuid("d", 3), name: "Amministrazione", description: null, teamSize: null, status: "not_started", processes: 0, steps: 0, hoursWeek: 0, toValidate: 0, unclassified: 0, streams: { automate: 0, differentiate: 0, innovate: 0 } },
  ];
}
