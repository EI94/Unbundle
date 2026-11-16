import test from "node:test";
import assert from "node:assert/strict";
import {
  adoptionOrder,
  allSteps,
  boardAsText,
  boardNumbers,
  firstSentence,
  hasHumanDecision,
  locateStep,
  processFrictions,
  processLetter,
  rolesTable,
  shownFriction,
  shownUnitStatus,
  stepCode,
  stepFrictions,
  streamNumbers,
  toolsTable,
  uncheckedNoteStatus,
  unitNumbers,
  useCaseLinksOf,
  useCaseStream,
  withUseCaseLinks,
} from "./board-model.ts";
import { FIXTURE_IDS, fixtureBoard, fixtureUnits } from "./board-fixture.ts";
import { STREAM_OF_CLASSIFICATION, streamOf } from "./streams.ts";
import { STREAMS } from "./vocab.ts";

// Il modello di lettura della board (docs/mappatura/MAPPATURA-BOARD-PIANO.md §4.2): riquadri, conteggi, lettere e codici,
// l'attrito mostrato, le tabelle di ruoli e strumenti, gli stream dai nove valori salvati, l'ordine di adozione, la
// prima frase, la mappa come testo.

const I = FIXTURE_IDS;

test("le lettere dei processi e i codici dei passi nascono dal posto, mai da un valore salvato", () => {
  assert.deepEqual([0, 1, 25, 26, 27, 51, 52].map(processLetter), ["A", "B", "Z", "AA", "AB", "AZ", "BA"]);
  assert.deepEqual([stepCode(0, 0), stepCode(0, 1), stepCode(1, 0), stepCode(25, 39)], ["A1", "A2", "B1", "Z40"]);
  const board = fixtureBoard();
  const place = locateStep(board, I.solleciti);
  assert.deepEqual([place?.code, place?.process.name, place?.processIndex, place?.stepIndex, place?.step.title], ["B1", "Dall'ordine alla consegna", 1, 0, "Solleciti di consegna"]);
  assert.equal(locateStep(board, "non-c'è"), null);
  assert.deepEqual(allSteps(board).map((step) => step.id), [I.richieste, I.confronto, I.scelta, I.ordine, I.solleciti, I.controllo]);
});

test("i riquadri di «Processi di oggi»: passi, processi, ore, decisioni, da validare, confermati, attriti", () => {
  const board = fixtureBoard();
  assert.deepEqual(boardNumbers(board), { steps: 6, processes: 2, hoursWeek: 28.5, decisions: 3, toValidate: 2, confirmed: 4, frictions: 5 });
  assert.deepEqual(boardNumbers(fixtureBoard({ empty: true })), { steps: 0, processes: 0, hoursWeek: 0, decisions: 0, toValidate: 0, confirmed: 0, frictions: 0 });
  // Gli attriti di una riga: le note della corsia; un livello scelto senza note conta per uno.
  assert.deepEqual(board.processes.map(processFrictions), [4, 1]);
  assert.deepEqual(allSteps(board).map(stepFrictions), [2, 1, 0, 1, 1, 0]);
  // Decide una persona: c'è il testo della decisione, o il suo nome.
  assert.deepEqual(allSteps(board).map(hasHumanDecision), [true, false, true, false, false, true]);
  assert.equal(hasHumanDecision({ decision: "  ", decisionLabel: "Firma" }), true);
  assert.equal(hasHumanDecision({ decision: " ", decisionLabel: null }), false);
});

test("l'attrito mostrato: quello salvato; senza, «medio» se un attrito è scritto, altrimenti nessuno", () => {
  assert.deepEqual([shownFriction(3, false), shownFriction(0, true), shownFriction(1, true)], [3, 0, 1]);
  assert.deepEqual([shownFriction(null, true), shownFriction(null, false)], [2, 0]);
  const board = fixtureBoard();
  const friction = (id: string) => [locateStep(board, id)!.step.friction, locateStep(board, id)!.step.frictionSet];
  assert.deepEqual([friction(I.richieste), friction(I.confronto), friction(I.scelta), friction(I.ordine)], [[3, true], [2, false], [0, false], [1, true]]);
});

test("i riquadri di «Classificazione»: passi e ore per stream, da classificare, esposizione media, diversi dalla proposta", () => {
  const numbers = streamNumbers(fixtureBoard({ classified: true }));
  assert.deepEqual(numbers.byStream, { automate: { steps: 3, hoursWeek: 19.5 }, differentiate: { steps: 1, hoursWeek: 3 }, innovate: { steps: 1, hoursWeek: 4 } });
  assert.equal(numbers.unclassified, 1);
  // (0,34 + 0,22 + 0,40) / 3 = 0,32
  assert.equal(numbers.avgExposurePct, 32);
  assert.equal(numbers.differsFromProposal, 1, "«Confronto» è stato corretto a mano");
  const before = streamNumbers(fixtureBoard());
  assert.deepEqual([before.unclassified, before.avgExposurePct, before.differsFromProposal], [6, null, 0]);
});

test("streamOf piega i nove valori salvati nei tre stream, come la dashboard di prima", () => {
  assert.deepEqual(
    ["automate", "differentiate", "innovate", "automatable", "augmentable", "differentiating", "emerging_opportunity", "blocked_by_system", "blocked_by_governance"].map(streamOf),
    ["automate", "differentiate", "innovate", "automate", "differentiate", "differentiate", "innovate", "automate", "automate"],
  );
  assert.deepEqual([streamOf(null), streamOf(""), streamOf("altro"), streamOf("toString")], [null, null, null, null]);
  assert.equal(Object.keys(STREAM_OF_CLASSIFICATION).length, 9);
  for (const stream of Object.values(STREAM_OF_CLASSIFICATION)) assert.ok(STREAMS.includes(stream));
});

test("chi fa cosa e con quali strumenti: una riga per ruolo e per strumento, con i passi", () => {
  const board = fixtureBoard();
  const roles = rolesTable(board);
  assert.deepEqual(roles.map((row) => row.role), ["Buyer", "Magazzino", "Responsabile acquisti", "Ufficio tecnico"]);
  assert.deepEqual(roles[0].steps, [
    { code: "A1", title: "Raccolta delle richieste" },
    { code: "A2", title: "Confronto delle offerte" },
    { code: "A4", title: "Invio dell'ordine" },
    { code: "B1", title: "Solleciti di consegna" },
  ]);
  const tools = toolsTable(board);
  assert.deepEqual(tools.map((row) => [row.tool, row.steps.map((step) => step.code).join(" ")]), [
    ["Archivio offerte", "A2"],
    ["E-mail", "A1 A2 B1"],
    ["Foglio di calcolo", "A1 A2 A3"],
    ["Gestionale", "A4"],
    ["Portale fornitori", "A2"],
    ["Telefono", "A2 B1"],
  ]);
  // Lo stesso nome scritto con maiuscole o spazi diversi è una riga sola, con la prima grafia.
  const mixed = fixtureBoard();
  mixed.processes[1].steps[1].who = ["  buyer ", "BUYER"];
  assert.deepEqual(rolesTable(mixed)[0].steps.map((step) => step.code), ["A1", "A2", "A4", "B1", "B2"]);
  assert.equal(rolesTable(mixed)[0].role, "Buyer");
  assert.deepEqual([rolesTable(fixtureBoard({ empty: true })), toolsTable(fixtureBoard({ empty: true }))], [[], []]);
});

test("i riquadri dell'elenco delle unità", () => {
  assert.deepEqual(unitNumbers(fixtureUnits()), { complete: 1, total: 3, steps: 10, hoursWeek: 59.5, toValidate: 6 });
  assert.deepEqual(unitNumbers([]), { complete: 0, total: 0, steps: 0, hoursWeek: 0, toValidate: 0 });
  const validated = fixtureUnits().map((unit) => ({ ...unit, status: "validated" as const }));
  assert.equal(unitNumbers(validated).complete, 3);
});

test("un'unità va «in corso» da sola al primo passo, e niente la riporta indietro", () => {
  assert.deepEqual([shownUnitStatus("not_started", 0), shownUnitStatus("not_started", 1), shownUnitStatus("in_progress", 0), shownUnitStatus("mapped", 0), shownUnitStatus("validated", 3)], ["not_started", "in_progress", "in_progress", "mapped", "validated"]);
});

test("una nota senza spunta torna «da fonti» se viene da fuori della board, «ipotesi» altrimenti", () => {
  assert.deepEqual([uncheckedNoteStatus("board"), uncheckedNoteStatus("chat"), uncheckedNoteStatus("documenti"), uncheckedNoteStatus("prima")], ["ipotesi", "fonte", "fonte", "fonte"]);
});

test("la prima frase di un testo, e il resto per «Dettagli»", () => {
  assert.deepEqual(firstSentence("Ogni ordine chiede in media tre solleciti. Nessuno li conta."), { first: "Ogni ordine chiede in media tre solleciti.", rest: "Nessuno li conta." });
  assert.deepEqual(firstSentence("Una frase sola."), { first: "Una frase sola.", rest: "" });
  assert.deepEqual(firstSentence("  Senza punto  "), { first: "Senza punto", rest: "" });
  assert.deepEqual(firstSentence("Quanto costa? Nessuno lo sa. Davvero."), { first: "Quanto costa?", rest: "Nessuno lo sa. Davvero." });
  assert.deepEqual(firstSentence("Prima riga\nSeconda riga"), { first: "Prima riga", rest: "Seconda riga" });
  // Un punto dentro un numero o prima di una minuscola non chiude la frase.
  assert.deepEqual(firstSentence("Costa 1.250 euro, es. per i resi. Poi basta."), { first: "Costa 1.250 euro, es. per i resi.", rest: "Poi basta." });
  assert.deepEqual(firstSentence(""), { first: "", rest: "" });
});

test("l'ordine di adozione: quello di creazione, spostato solo quanto serve perché un'attività venga dopo quelle da cui dipende", () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 10, 16, 9, minute));
  const activities = [
    { id: "a", createdAt: at(1) },
    { id: "b", createdAt: at(2) },
    { id: "c", createdAt: at(3) },
    { id: "d", createdAt: at(4) },
  ];
  assert.deepEqual(adoptionOrder(activities, []), ["a", "b", "c", "d"]);
  // «b» dipende da «d», creata dopo: «b» aspetta, «c» resta dov'è.
  assert.deepEqual(adoptionOrder(activities, [{ sourceActivityId: "b", targetActivityId: "d" }]), ["a", "c", "d", "b"]);
  // Una catena: a dipende da b, b da c.
  assert.deepEqual(adoptionOrder(activities, [{ sourceActivityId: "a", targetActivityId: "b" }, { sourceActivityId: "b", targetActivityId: "c" }]), ["c", "b", "a", "d"]);
  // Un ciclo tiene l'ordine di creazione; chi dipende da sé stesso o da un'attività fuori elenco non aspetta nessuno.
  assert.deepEqual(adoptionOrder(activities, [{ sourceActivityId: "a", targetActivityId: "b" }, { sourceActivityId: "b", targetActivityId: "a" }]), ["a", "b", "c", "d"]);
  assert.deepEqual(adoptionOrder(activities, [{ sourceActivityId: "a", targetActivityId: "a" }, { sourceActivityId: "a", targetActivityId: "z" }]), ["a", "b", "c", "d"]);
  // L'ordine è quello delle date, non quello in cui arrivano; a parità di data, quello in cui arrivano.
  assert.deepEqual(adoptionOrder([activities[2], activities[0], { id: "e", createdAt: at(1) }], []), ["a", "e", "c"]);
  assert.deepEqual(adoptionOrder([], []), []);
});

test("la mappa come testo: per processo e per passo, una riga per corsia, i segni dopo passi e note", () => {
  const text = boardAsText(fixtureBoard());
  const lines = text.split("\n");
  assert.equal(lines[0], "A · Dalla richiesta all'ordine · Responsabile acquisti");
  assert.equal(lines[1], "  A1 · Raccolta delle richieste");
  assert.ok(lines.includes("    Attività: Le richieste degli uffici arrivano per e-mail e si copiano in un foglio. · Si apre la casella condivisa · Si copia la richiesta nel foglio [ipotesi]"));
  assert.ok(lines.includes("    Chi: Buyer"));
  assert.ok(lines.includes("    Strumenti: E-mail, Foglio di calcolo"));
  assert.ok(lines.includes("    Entra: La richiesta di un ufficio."));
  assert.ok(lines.includes("    Esce: Una riga nel foglio delle richieste."));
  assert.ok(lines.includes("    Dati e documenti: Elenco dei fornitori [fonte: documenti]"));
  assert.ok(lines.includes("    Attriti: Richieste incomplete · Nessun modulo unico [fonte: chat]"));
  assert.ok(lines.includes("    Tempi e volumi: Ogni giorno · 6,5 h a settimana · Quaranta richieste a settimana"));
  assert.ok(lines.includes("    Decide una persona: Richiesta completa: Chi compra decide se la richiesta è completa."));
  assert.ok(lines.includes("    Eccezioni: Se manca il centro di costo, la richiesta torna indietro."));
  // Un passo non confermato porta «[da validare]»; un processo senza chi lo segue non ha il secondo pezzo.
  assert.ok(lines.includes("  A2 · Confronto delle offerte [da validare]"));
  assert.ok(lines.includes("B · Dall'ordine alla consegna"));
  assert.ok(lines.includes("  B1 · Solleciti di consegna [da validare]"));
  // Le righe vuote di un passo non si scrivono.
  const b2 = lines.indexOf("  B2 · Controllo della merce");
  assert.deepEqual(lines.slice(b2 + 1, b2 + 4), ["    Chi: Magazzino", "    Tempi e volumi: 4 h a settimana", "    Decide una persona: Chi riceve decide se accettare la merce."]);
  // In fondo i punti di analisi, con il titolo e il segno.
  assert.deepEqual(lines.slice(-3), [
    "Punti di analisi",
    "  Il tempo va nei solleciti: Ogni ordine chiede in media tre solleciti. Nessuno li conta.",
    "  Le richieste partono incomplete: Le richieste arrivano senza centro di costo e tornano indietro. [fonte: chat]",
  ]);
  assert.doesNotMatch(text, /undefined|null|\[object/);
  assert.equal(boardAsText(fixtureBoard({ empty: true })), "");
  assert.ok(boardAsText(fixtureBoard({ classified: true })).startsWith("Un terzo del tempo va a rincorrere richieste incomplete e consegne in ritardo.\n\nA · "));
});

test("gli use case collegati: li mette la pagina, e restano quando arriva una board più nuova", () => {
  const board = fixtureBoard({ classified: true });
  const links = {
    links: [{ id: "uc-1", code: "UC-0001", title: "Lettura delle richieste", href: "/dashboard/ws/use-cases/uc-1", stream: "automate" as const }],
    byStep: new Map([[I.richieste, ["uc-1"]], ["passo-di-un-altra-unità", ["uc-1"]]]),
  };
  const linked = withUseCaseLinks(board, { ...links, links: links.links.map((link) => ({ ...link, stream: null })) });
  assert.deepEqual(linked.useCases, links.links, "lo stream è quello dei suoi passi su questa board");
  assert.deepEqual(allSteps(linked).map((step) => step.useCaseIds), [["uc-1"], [], [], [], [], []]);
  assert.deepEqual(allSteps(board).map((step) => step.useCaseIds), [[], [], [], [], [], []], "la board di partenza non cambia");
  // Una board riletta dal server non ha i collegamenti: si rimettono quelli che c'erano.
  const kept = useCaseLinksOf(linked);
  assert.deepEqual([kept.links, [...kept.byStep]], [links.links, [[I.richieste, ["uc-1"]]]]);
  assert.deepEqual(withUseCaseLinks(fixtureBoard({ classified: true }), kept), linked);
  // Lo stream di uno use case: quello della maggior parte dei suoi passi; a parità il primo; null senza passi classificati.
  const many = withUseCaseLinks(board, { links: links.links, byStep: new Map([[I.richieste, ["uc-1"]], [I.scelta, ["uc-1"]], [I.controllo, ["uc-1"]], [I.solleciti, ["uc-1"]], [I.ordine, ["uc-2"]]]) });
  assert.deepEqual([useCaseStream(many, "uc-1"), useCaseStream(many, "uc-2"), useCaseStream(many, "uc-3")], ["automate", null, null]);
  const tie = withUseCaseLinks(board, { links: links.links, byStep: new Map([[I.scelta, ["uc-1"]], [I.controllo, ["uc-1"]]]) });
  assert.deepEqual([useCaseStream(tie, "uc-1"), tie.useCases[0].stream], ["differentiate", "differentiate"]);
});
