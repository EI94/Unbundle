/**
 * Solo per la vetrina delle schermate della board (docs/mappatura/MAPPATURA-BOARD-PIANO.md §8.5): nessun file dell'app
 * lo importa.
 *
 * La board inventata delle fondamenta («Ufficio acquisti», src/lib/mappatura/board-fixture.ts) e quello che la vetrina
 * le aggiunge: una terza riga di sei passi generici, la riga che il riferimento misura (sei card in una riga, BOARD-SPEC
 * §6). Mai nomi, persone o testi di un cliente. Gli id sono fissi.
 *
 * Modulo puro.
 */
import { FIXTURE_IDS, fixtureBoard, fixtureUnits } from "../../src/lib/mappatura/board-fixture.ts";
import { emptyNotes, type BoardStep, type MappingBoard } from "../../src/lib/mappatura/board-model.ts";
import type { Friction } from "../../src/lib/mappatura/vocab.ts";

export { FIXTURE_IDS, fixtureBoard, fixtureUnits };

export const SHOWCASE = Object.freeze({
  workspaceName: "Officina di prova",
  unitTerm: Object.freeze({ singular: "funzione", plural: "funzioni" }),
});

const id = (group: string, n: number) => `${group.repeat(8)}-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const SHOWCASE_IDS = Object.freeze({ processC: id("8", 1) });

/** Un passo generico della terza riga: come lo legge il server, senza classificazione. */
function step(n: number, title: string, description: string, who: string[], tools: string[], friction: Friction, decision: string | null = null): BoardStep {
  return {
    id: id("9", n),
    title,
    description,
    who,
    tools,
    input: null,
    output: null,
    decision,
    decisionLabel: null,
    exception: null,
    friction,
    frictionSet: friction > 0,
    frequency: "giornaliera",
    hoursWeek: 2,
    quality: null,
    workType: null,
    status: n % 3 === 0 ? "da_validare" : "confermato",
    origin: "board",
    notes: emptyNotes(),
    stream: null,
    proposedStream: null,
    confidence: null,
    reason: null,
    aiPotential: null,
    onetCode: null,
    onetTitle: null,
    aiExposure: null,
    dependsOn: [],
    neededBy: [],
    useCaseIds: [],
  };
}

/** I sei passi della terza riga: dalla merce che arriva allo scaffale. */
function rowOfSix(): BoardStep[] {
  return [
    step(1, "Ricezione della merce", "Il corriere consegna e si firma la bolla.", ["Magazzino"], ["Bolla di consegna"], 0),
    step(2, "Controllo dei documenti", "Si confronta la bolla con l'ordine.", ["Magazzino", "Buyer"], ["Gestionale", "Foglio di calcolo"], 2, "Chi riceve decide se la bolla è giusta."),
    step(3, "Registrazione del carico", "Il carico entra nel gestionale, riga per riga.", ["Magazzino"], ["Gestionale"], 3),
    step(4, "Collocazione a scaffale", "La merce va al suo posto.", ["Magazzino"], ["Etichettatrice", "Mappa del magazzino"], 0),
    step(5, "Aggiornamento delle scorte", "Le scorte si aggiornano a fine giornata.", ["Magazzino"], ["Gestionale", "Foglio di calcolo", "E-mail"], 1),
    step(6, "Archiviazione delle bolle", "Le bolle firmate vanno nell'archivio.", ["Segreteria"], ["Archivio", "Scanner", "Cartella condivisa", "Gestionale", "E-mail"], 0),
  ];
}

/** La board della vetrina: quella delle fondamenta (classificata o no) con la riga di sei passi in fondo. */
export function showcaseBoard(options: { classified?: boolean; readOnly?: boolean } = {}): MappingBoard {
  const board = fixtureBoard(options);
  return {
    ...board,
    processes: [...board.processes, { id: SHOWCASE_IDS.processC, name: "Dalla merce allo scaffale", owner: "Magazzino", votes: 0, myVotes: 0, steps: rowOfSix() }],
  };
}
