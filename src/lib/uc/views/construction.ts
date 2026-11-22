/**
 * (Rilascio 10, docs/ui-10/PROPOSTA-10.md §3.5, D9 (a)) La Costruzione: dopo il via allo sviluppo è la seconda scheda
 * della realizzazione, al posto di Domande (prima del via si apre dal «⋯»). È il progetto dell'agente (rilascio 8.0a)
 * con i compiti (8.1a, 8.1b), la qualità (8.2a, 8.2b) e, per chi costruisce, «Per il coding agent».
 *
 * - In vista: lo stato del progetto con «8 di 10 scelte» e il suo solo pulsante pieno; i Compiti (al massimo 3 righe,
 *   poi «Vedi tutti (N)»; «Accetta» bordato sulle proposte); «Qualità» in una riga e, per ogni ruolo, la sola
 *   raccomandazione.
 * - In piega, chiuse finché un link non le apre: Scelte · Decisioni · Contesto · «Per il coding agent».
 * - Ai ruoli del cliente la qualità è una frase sola: niente comandi, rami, commit o p95.
 * - Gli argomenti hanno nomi italiani a schermo («Percorso dell'utente», «Strumenti», «Monitoraggio», «Prove e
 *   autonomia»); il pacchetto, la CLI e lo storico tengono i nomi di `SETUP_TOPIC_LABELS`.
 *
 * Qui i testi e le regole pure della pagina. Mai «caso» a schermo: «realizzazione», «use case», «progetto».
 * Modulo puro.
 */
import { SETUP_TOPICS, type SetupTopic } from "../../db/use-case-hub-factory-ddl.ts";

/** I nomi degli argomenti a schermo (§3.5, «Argomenti in italiano»), nell'ordine dei 10 argomenti. */
export const CONSTRUCTION_TOPIC_LABEL: Readonly<Record<SetupTopic, string>> = Object.freeze({
  funzionalita: "Funzionalità",
  journey: "Percorso dell'utente",
  dati: "Dati",
  framework: "Strumenti",
  backend: "Servizi",
  frontend: "Interfaccia",
  integrazioni: "Integrazioni",
  modelli: "Modelli",
  osservabilita: "Monitoraggio",
  evals_autonomia: "Prove e autonomia",
});

/** Il nome a schermo di un argomento; per una chiave che non è un argomento, il testo che arriva. */
export function constructionTopicLabel(topic: string | null | undefined, fallback = ""): string {
  return topic && Object.hasOwn(CONSTRUCTION_TOPIC_LABEL, topic) ? CONSTRUCTION_TOPIC_LABEL[topic as SetupTopic] : fallback;
}

export type ProjectStatusKey = "in_corso" | "da_approvare" | "approvato" | "superato";
export type ProjectAction = "imposta" | "manda" | "approva" | "rivedi" | "ok_board" | "riapri";
export type TaskStatusKey = "da_fare" | "in_corso" | "in_revisione" | "fatto" | "annullato";

export const CONSTRUCTION_TEXT = Object.freeze({
  /** Il titolo del primo blocco; l'id resta quello a cui le azioni rimettono il fuoco. */
  project: "Il progetto",
  projectHeadingId: "progetto-titolo",
  status: Object.freeze({ in_corso: "In corso", da_approvare: "Da approvare", approvato: "Approvato", superato: "Superato" } satisfies Record<ProjectStatusKey, string>),
  notSet: "Il progetto non è ancora impostato.",
  version: (n: number) => `versione ${n}`,
  choices: (chosen: number, total: number) => `${chosen} di ${total} scelte`,
  approvedOn: (day: string) => `approvato il ${day}`,
  missing: (labels: readonly string[]) => (labels.length === 1 ? `Manca una scelta: ${labels[0]}.` : `Mancano ${labels.length} scelte: ${labels.join(", ")}.`),
  boardOkNeeded: "Prima dell'approvazione serve l'ok dell'AI Board agli strumenti nuovi.",
  changeRequest: (day: string | null) => `L'AI Board chiede una modifica${day ? ` (${day})` : ""}`,
  changeRequestLead: "Riapri il progetto per cambiarlo con il team.",
  changeRequestOthers: "Lo riapre la persona responsabile della realizzazione, per cambiarlo.",
  changeRequestStays: "Resta qui finché il progetto non torna da approvare.",
  primary: Object.freeze({ imposta: "Imposta il progetto", manda: "Manda in approvazione", approva: "Approva il progetto", rivedi: "Rivedi il progetto" }),
  reopen: "Riapri per cambiarlo",

  tasks: "Compiti",
  tasksHeadingId: "compiti",
  taskStatus: Object.freeze({ da_fare: "Da fare", in_corso: "In corso", in_revisione: "In revisione", fatto: "Fatto", annullato: "Annullato" } satisfies Record<TaskStatusKey, string>),
  noTasks: "Nessun compito ancora: nascono dal progetto approvato.",
  seeAll: (n: number) => `Vedi tutti (${n})`,
  seeFewer: "Mostra meno",
  proposals: (n: number) => (n === 1 ? "Una proposta da decidere" : `${n} proposte da decidere`),
  accept: "Accetta",
  discard: "Scarta",
  proposalFrom: (source: "github" | "slack") => (source === "github" ? "Da GitHub" : "Da Slack"),
  proposalOn: (day: string) => `il ${day}`,
  proposalExisting: (ref: string) => `forse c'è già: ${ref}`,
  taskAreas: (areas: readonly string[]) => `Aree: ${areas.join(", ")}`,
  taskEstimate: (hours: string) => `Stima: ${hours} ore`,
  taskEvidence: (text: string) => `Prove: ${text}`,
  taskBranch: (branch: string) => `Ramo: ${branch}`,
  taskChange: "La modifica su GitHub",

  choicesTitle: "Scelte",
  choicesId: "scelte",
  choiceTodo: "Da scegliere",
  choiceWhy: (text: string) => `Perché: ${text}`,
  choiceDropped: (text: string) => `Scartata: ${text}`,
  choiceChange: "Cambia",
  choicePick: "Scegli",
  previous: (version: number, day: string) => `Versione ${version} approvata il ${day}`,
  toolsTitle: "Strumenti nuovi e stima",
  noTools: "Nessuno strumento nuovo per il cliente.",
  boardOk: (day: string, note: string | null) => `Ok dell'AI Board il ${day}${note ? `: ${note}` : "."}`,
  boardOkAfterSubmit: "Dopo l'invio in approvazione serve l'ok dell'AI Board.",
  boardChangeAsked: "L'AI Board ha chiesto una modifica: niente ok per ora.",
  boardOkMissing: "Manca l'ok dell'AI Board.",
  estimateHours: (hours: string) => `Costruzione: circa ${hours} ore.`,
  estimateHoursNone: "Costruzione: non stimata.",
  estimateCost: (eur: string) => `Costo al mese: circa ${eur} €.`,
  estimateCostNone: "Costo al mese: non stimato.",

  decisionsTitle: "Decisioni",
  decisionsId: "decisioni",
  decisionsHint: "Valgono per chi costruisce l'agente, oltre alle scelte.",
  decisionsNone: "Nessuna decisione oltre alle scelte.",
  decisionsAll: (n: number, replaced: number) => `Tutte le decisioni (${n}${replaced ? `, di cui ${replaced} ${replaced === 1 ? "sostituita" : "sostituite"}` : ""})`,
  decisionReplaced: (day: string) => `Sostituita il ${day}`,

  contextId: "contesto",

  agentTitle: "Per il coding agent",
  agentId: "coding-agent",
  agentSummary: (parts: readonly string[]) => parts.join(" · "),
  agentPartPackage: "pacchetto",
  agentPartCommands: "comandi",
  agentPartClaude: "accessi di Claude",
  packageTitle: "Pacchetto",
  packageHint: "I file che il repository legge e non cambia: senza nomi di persona.",
  packageVersion: (n: number) => `Versione ${n}`,
  packageMade: (manual: boolean, day: string) => ` · ${manual ? "preparata a mano" : "generata dalla scheda dello use case"} il ${day}`,
  packageNone: "Nessun pacchetto ancora.",
  packageRead: "Leggi i file",
  commandsTitle: "Comandi",
  commandTake: "Prendi un compito:",
  commandImport: "Porta i compiti in Unbundle:",
  commandSetup: "Imposta il progetto dal coding agent, con la skill",

  catalog: "Catalogo",
  unavailable: "Non ancora disponibile: riprova tra qualche minuto.",
});

/** Le scelte fatte su 10 (gli argomenti con una scelta scritta). */
export function choicesMade(topics: Readonly<Record<string, { scelta?: string | null } | null | undefined>> | null | undefined): number {
  return SETUP_TOPICS.filter((t) => Boolean(topics?.[t]?.scelta?.trim())).length;
}

/** Gli argomenti ancora senza scelta, con il nome a schermo. */
export function missingChoices(topics: Readonly<Record<string, { scelta?: string | null } | null | undefined>> | null | undefined): string[] {
  return SETUP_TOPICS.filter((t) => !topics?.[t]?.scelta?.trim()).map((t) => CONSTRUCTION_TOPIC_LABEL[t]);
}

/**
 * La riga dello stato del progetto: «Approvato · versione 2 · 10 di 10 scelte · approvato il 12/11/2026» (la data solo
 * per uno approvato); senza progetto «Il progetto non è ancora impostato.».
 */
export function projectStateLine(project: { status: ProjectStatusKey; version: number; approvedAt: string | null; topics: Parameters<typeof choicesMade>[0] } | null, day: (iso: string) => string): string {
  if (!project) return CONSTRUCTION_TEXT.notSet;
  const T = CONSTRUCTION_TEXT;
  const parts = [T.status[project.status], T.version(project.version), T.choices(choicesMade(project.topics), SETUP_TOPICS.length)];
  if (project.status === "approvato" && project.approvedAt) parts.push(T.approvedOn(day(project.approvedAt)));
  return parts.join(" · ");
}

/** Il tono del puntino dello stato del progetto: verde approvato, giallo da approvare, blu in corso, grigio superato o senza. */
export function projectTone(status: ProjectStatusKey | null): "verde" | "giallo" | "blu" | "grigio" {
  if (status === "approvato") return "verde";
  if (status === "da_approvare") return "giallo";
  if (status === "in_corso") return "blu";
  return "grigio";
}

export interface ProjectActionInput {
  /** C'è un progetto (aperto o approvato). */
  hasProject: boolean;
  openStatus: "in_corso" | "da_approvare" | null;
  /** Chi guarda scrive il progetto (chi costruisce, non in sola lettura, realizzazione aperta). */
  writer: boolean;
  /** Chi guarda approva (il responsabile, con la scrittura). */
  approver: boolean;
  /** Il progetto da approvare ha strumenti nuovi senza l'ok dell'AI Board. */
  needsBoard: boolean;
  /** Chi guarda può dare (o registrare) l'ok dell'AI Board. */
  boardAllowed: boolean;
  /** L'AI Board ha chiesto una modifica. */
  changeRequested: boolean;
  /**
   * La testata della realizzazione mostra qui il suo passo, pieno (riconfermare il via, firmare, riprendere…:
   * `headerStepShownOn`): allora l'azione del progetto è bordata. Un solo pulsante pieno per schermata.
   */
  headerStep?: boolean;
}

/**
 * L'azione del progetto, una sola, e se «Riapri per cambiarlo» sta accanto (8.0a, invariata): impostare, mandare in
 * approvazione, l'ok dell'AI Board, approvare, rivedere; «riapri» al posto dell'ok quando l'AI Board ha chiesto una
 * modifica. «Rivedi il progetto» non è urgente: bordato (`filled` falso); bordata anche ogni azione quando la testata
 * ha qui il suo passo pieno (`headerStep`).
 */
export function projectAction(i: ProjectActionInput): { action: ProjectAction | null; reopenAside: boolean; filled: boolean } {
  let action: ProjectAction | null = null;
  let reopenAside = false;
  if (!i.hasProject) action = i.writer ? "imposta" : null;
  else if (i.openStatus === "in_corso") action = i.writer ? "manda" : null;
  else if (i.openStatus === "da_approvare") {
    if (i.approver) {
      if (i.needsBoard && i.changeRequested) action = "riapri";
      else {
        action = i.needsBoard ? "ok_board" : "approva";
        reopenAside = true;
      }
    } else if (i.needsBoard && i.boardAllowed) action = "ok_board";
  } else action = i.writer ? "rivedi" : null;
  return { action, reopenAside, filled: action !== null && action !== "rivedi" && !i.headerStep };
}

/** «3 da prendere · 2 in corso · 4 fatti»: lo zero non si vede; "" senza compiti vivi. */
export function tasksTally(tasks: readonly { status: TaskStatusKey }[]): string {
  const open = tasks.filter((t) => t.status === "da_fare").length;
  const busy = tasks.filter((t) => t.status === "in_corso" || t.status === "in_revisione").length;
  const done = tasks.filter((t) => t.status === "fatto").length;
  return [open ? `${open} da prendere` : null, busy ? `${busy} in corso` : null, done ? `${done} ${done === 1 ? "fatto" : "fatti"}` : null].filter(Boolean).join(" · ");
}

/** Quante righe di compiti in vista prima di «Vedi tutti (N)» (§1, regola 4). */
export const TASKS_SHOWN = 3;

/**
 * L'ordine dei compiti in vista: prima quelli in revisione e in corso (si stanno facendo), poi quelli da prendere, poi i
 * fatti, gli annullati per ultimi; a parità, l'ordine di arrivo.
 */
export function tasksInOrder<T extends { status: TaskStatusKey }>(tasks: readonly T[]): T[] {
  const rank: Readonly<Record<TaskStatusKey, number>> = { in_revisione: 0, in_corso: 1, da_fare: 2, fatto: 3, annullato: 4 };
  return tasks.map((t, i) => ({ t, i })).sort((a, b) => rank[a.t.status] - rank[b.t.status] || a.i - b.i).map(({ t }) => t);
}

/** Il parametro di «Vedi tutti (N)» dei compiti: l'elenco intero resta nell'indirizzo. */
export const TASKS_ALL_PARAM = "compiti";
export const TASKS_ALL_VALUE = "tutti";

/**
 * Chi legge i dettagli di chi costruisce (comandi, rami, la modifica su GitHub, il banco intero, il pacchetto): chi
 * costruisce il progetto (anche da fuori) e Lateral Space. Gli altri ruoli leggono la qualità in una frase.
 */
export function seesBuildDetails(i: { builder: boolean; lateralSpace: boolean }): boolean {
  return i.builder || i.lateralSpace;
}

/** La riga grigia della piega «Per il coding agent»: le parti che chi guarda ci trova. */
export function agentFoldSummary(i: { packageShown: boolean; commandsShown: boolean; claudeShown: boolean }): string {
  const T = CONSTRUCTION_TEXT;
  const parts: string[] = [];
  if (i.packageShown) parts.push(T.agentPartPackage);
  if (i.commandsShown) parts.push(T.agentPartCommands);
  if (i.claudeShown) parts.push(T.agentPartClaude);
  if (parts.length === 0) return "";
  const [first, ...rest] = parts;
  return T.agentSummary([first.charAt(0).toUpperCase() + first.slice(1), ...rest]);
}
