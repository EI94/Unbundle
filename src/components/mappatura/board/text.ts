/**
 * «Mappatura board»: le scritte delle viste della board, S1 e «Processi di oggi» (docs/mappatura/MAPPATURA-BOARD-PIANO.md
 * §7.2).
 *
 * Stile della casa: frasi semplici e corte, genere neutro, maiuscola solo all'inizio, «use case». Le maiuscole che si
 * vedono in etichette e sigle le mette il CSS. La parola dell'unità arriva dal workspace (`UnitTerm`, `{singolare}`,
 * `{plurale}`): nessuna frase fa concordare un aggettivo con lei. I componenti di questa cartella importano le scritte
 * da qui e non ne scrivono: così un test le legge tutte. Le scritte della cornice, della pillola, dei toast e del
 * vocabolario sono quelle delle fondamenta (`src/lib/mappatura/text.ts`).
 *
 * Modulo puro.
 */
import { counted, formatCount, formatHours } from "../../../lib/mappatura/text.ts";

/** La parola dell'unità di un workspace: «funzione», «funzioni» (src/lib/utils/unit-terminology.ts). */
export interface UnitWords {
  singular: string;
  plural: string;
}

/** La prima lettera maiuscola: il titolo della sezione delle unità («Funzioni»). */
export const capitalized = (text: string): string => (text ? text.charAt(0).toLocaleUpperCase("it") + text.slice(1) : text);

export const VIEW_TEXT = Object.freeze({
  units: Object.freeze({
    eyebrow: "Activity mapping",
    titlePlain: "Il lavoro di oggi,",
    discovery: Object.freeze({ title: "Prima la Discovery", link: "Vai alla Discovery" }),
  }),
  header: Object.freeze({ assistant: "Assistente" }),
  today: Object.freeze({
    titlePlain: "Come lavora oggi",
    headlineLabel: "La scoperta",
    headlinePlaceholder: "La scoperta, in una frase.",
    hoursLabel: "ore a settimana",
  }),
  points: Object.freeze({
    title: "Punti di analisi",
    add: "+ punto",
    titlePlaceholder: "Titolo",
    textPlaceholder: "Che cosa emerge.",
    titleLabel: "Titolo del punto",
    textLabel: "Testo del punto",
    edit: "Modifica il punto",
  }),
  roles: Object.freeze({ title: "Chi fa cosa e con quali strumenti", role: "Ruolo", tool: "Strumento", steps: "Passi" }),
  map: Object.freeze({
    title: "I processi, uno per uno",
    hint: "clicca un passo per aprire attività, persone, dati, attriti, tempi e volumi",
    dim: "Evidenzia attriti",
    copy: "Copia la mappa come testo",
  }),
  legend: Object.freeze({
    strong: "attrito forte",
    medium: "attrito medio",
    light: "lieve",
    decides: "decide una persona",
    toValidate: "«da validare» = passo da confermare",
  }),
  row: Object.freeze({
    namePlaceholder: "Nome del processo",
    ownerPlaceholder: "Chi lo segue",
    up: "Sposta su",
    down: "Sposta giù",
    remove: "Elimina il processo",
  }),
  add: Object.freeze({ step: "+ passo", process: "+ processo" }),
  card: Object.freeze({ grip: "Trascina per spostare" }),
  empty: Object.freeze({
    title: "Nessun passo, per ora",
    text: "Racconta il lavoro all'assistente, oppure aggiungi il primo passo.",
    assistant: "Inizia con l'assistente",
    addStep: "Aggiungi un passo",
  }),
  drawer: Object.freeze({
    titlePlaceholder: "Titolo del passo",
    descriptionLabel: "Descrizione del passo",
    descriptionPlaceholder: "Che cosa succede, in una frase.",
    addRole: "+ ruolo",
    rolePlaceholder: "Ruolo o persona",
    addTool: "+ strumento",
    toolPlaceholder: "Strumento o sistema",
    input: "Entra",
    output: "Esce",
    decides: "Decide una persona",
    exception: "Eccezioni",
    links: "Collegamenti",
    more: "Altri dettagli",
    inputPlaceholder: "Che cosa arriva, e da chi.",
    outputPlaceholder: "Che cosa esce, e per chi.",
    decisionLabelPlaceholder: "Nome della decisione",
    decisionPlaceholder: "Chi decide, e che cosa.",
    exceptionPlaceholder: "Che cosa succede quando qualcosa va storto.",
    addNote: "+ nota",
    friction: "Attrito",
    frequency: "Frequenza",
    hoursWeek: "Ore a settimana",
    dependsOn: "Dipende da",
    neededBy: "Serve a",
    workType: "Tipo di lavoro",
    quality: "Qualità percepita",
    confirm: "Conferma il passo",
    unconfirm: "Segna da validare",
    left: "Sposta a sinistra",
    right: "Sposta a destra",
    moveTo: "Sposta in",
    remove: "Elimina il passo",
  }),
  copy: Object.freeze({ title: "La mappa come testo", context: "Copia a mano" }),
});

// ─── S1 · Le unità ───────────────────────────────────────────────────

/** Il titolo dell'elenco: «Il lavoro di oggi, *funzione per funzione*». */
export function unitsTitle(words: UnitWords): { plain: string; accent: string } {
  return { plain: VIEW_TEXT.units.titlePlain, accent: `${words.singular} per ${words.singular}` };
}

export function unitsLede(words: UnitWords): string {
  return `Ogni ${words.singular} ha la sua board: i processi, i passi, chi li fa e dove decide una persona.`;
}

/** I quattro riquadri dell'elenco: unità complete, passi, ore, passi da validare. */
export function unitsTileTexts(n: { complete: number; total: number; steps: number; hoursWeek: number; toValidate: number }, words: UnitWords): Array<{ value: string; label: string }> {
  return [
    { value: `${formatCount(n.complete)} di ${formatCount(n.total)}`, label: `${words.plural} con la mappatura completa` },
    { value: formatCount(n.steps), label: n.steps === 1 ? "passo mappato" : "passi mappati" },
    { value: `${formatHours(n.hoursWeek)} h`, label: VIEW_TEXT.today.hoursLabel },
    { value: formatCount(n.toValidate), label: n.toValidate === 1 ? "passo da validare" : "passi da validare" },
  ];
}

/** Il titolo della sezione delle righe: la parola dell'unità al plurale, con la maiuscola. */
export const unitsSectionTitle = (words: UnitWords): string => capitalized(words.plural);

/** «6 passi · 28,5 h a settimana». */
export const unitStepsLine = (steps: number, hoursWeek: number): string => `${counted(steps, "passo", "passi")} · ${formatHours(hoursWeek)} h a settimana`;
export const toValidateText = (n: number): string => `${formatCount(n)} da validare`;
export const toClassifyText = (n: number): string => `${formatCount(n)} da classificare`;
export const peopleText = (n: number): string => counted(n, "persona", "persone");
export const openBoardLabel = (unitName: string): string => `Apri la board di ${unitName}`;
export const discoveryText = (words: UnitWords): string => `Le ${words.plural} nascono nella Discovery. Completa quella fase per aprire la mappatura.`;

// ─── S2 · «Processi di oggi» ─────────────────────────────────────────

/** I quattro riquadri: passi (in quanti processi), ore, passi dove decide una persona, passi da validare. */
export function todayTileTexts(n: { steps: number; processes: number; hoursWeek: number; decisions: number; toValidate: number }): Array<{ value: string; label: string }> {
  const steps = n.steps === 1 ? "passo" : "passi";
  const processes = n.processes === 1 ? "1 processo" : `${formatCount(n.processes)} processi`;
  return [
    { value: formatCount(n.steps), label: `${steps} in ${processes}` },
    { value: `${formatHours(n.hoursWeek)} h`, label: VIEW_TEXT.today.hoursLabel },
    { value: formatCount(n.decisions), label: n.decisions === 1 ? "passo dove decide una persona" : "passi dove decide una persona" },
    { value: formatCount(n.toValidate), label: n.toValidate === 1 ? "passo da validare" : "passi da validare" },
  ];
}

/** «2 ruoli · 5 strumenti». */
export const rolesToolsHint = (roles: number, tools: number): string => `${counted(roles, "ruolo", "ruoli")} · ${counted(tools, "strumento", "strumenti")}`;

/** La riga dei conteggi sopra la mappa (P60): «2 da validare · 4 confermati · 5 attriti». */
export const mapCountsLine = (toValidate: number, confirmed: number, frictions: number): string =>
  `${formatCount(toValidate)} da validare · ${counted(confirmed, "confermato", "confermati")} · ${counted(frictions, "attrito", "attriti")}`;

/** Gli attriti di una riga, nell'etichetta: «3 attriti», «1 attrito». */
export const rowFrictionsText = (n: number): string => counted(n, "attrito", "attriti");
export const addStepLabel = (processName: string): string => `Aggiungi un passo a ${processName}`;
export const addNoteLabel = (laneLabel: string): string => `Aggiungi nota: ${laneLabel}`;
export const noteLabel = (laneLabel: string): string => `Nota: ${laneLabel}`;
export const frictionGroupLabel = (levelLabel: string): string => `${VIEW_TEXT.drawer.friction}: ${levelLabel}`;
/** La riga del contesto del drawer di un passo: «Dalla richiesta all'ordine · A2». */
export const drawerContext = (processName: string, code: string): string => `${processName} · ${code}`;
/** Un passo nominato altrove (le tabelle, i collegamenti): «A2 · Confronto delle offerte». */
export const stepRefText = (code: string, title: string): string => `${code} · ${title}`;
/** Un processo nel menu «Sposta in»: «B · Dall'ordine alla consegna». */
export const processOptionText = (letter: string, name: string): string => `${letter} · ${name}`;
