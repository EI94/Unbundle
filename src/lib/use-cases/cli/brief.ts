/**
 * Il contesto per i coding agent (rilascio 8.0b, standard §7, RILASCIO-8.0b-COSTRUZIONE.md §4): il brief di al
 * massimo 300 token e gli strati (`progetto`, `decisioni`, `pacchetto`, `domande`), in testo italiano pronto da
 * leggere. Lo compone il server, la CLI lo stampa così com'è (`--json` per gli script).
 *
 * - **Mai nomi né e-mail:** ogni testo libero (titolo, scelte, decisioni, strumenti, domande) passa da `redact` con i nomi
 *   che Unbundle conosce, come il pacchetto. (8.0c) Gli identificativi tecnici (codice del caso, repository, cartelle,
 *   rami) non ci passano mai: «Voltaen/prova-esterni» con una persona di nome Prova restava «Voltaen/una persona-esterni».
 * - **Solo le decisioni che valgono:** quelle sostituite da una scelta rifatta restano fuori (`currentDecisions`).
 * - **Corto:** il brief sta in 1.200 caratteri (≈ 300 token); le righe lunghe si tagliano.
 * - **`dal`:** con una data, il brief dice anche che cosa è cambiato da allora.
 * - **(9b) Il contesto del cliente:** lo strato `contesto` (il testo lo compone `formatAgentContext`, src/lib/context/work/
 *   agent-text.ts) e, nel brief, una riga sola dopo quella del pacchetto quando ci sono novità (`contextBriefLine`).
 *
 * Modulo puro: import relativi `.ts`.
 */
import { CASE_STATUS_LABEL } from "../../uc/case-state.ts";
import type { CaseStatus } from "../../uc/vocab.ts";
import { SETUP_TOPICS, SETUP_TOPIC_LABELS, type ProjectNewTool, type ProjectStatus, type ProjectTopics, type SetupTopic } from "../../db/use-case-hub-factory-ddl.ts";
import { contextBriefLine } from "../../context/work/agent-text.ts";
import { currentDecisions } from "../factory/decisions.ts";
import { givenNames, nameTokens, redact } from "../factory/package.ts";

/** Quanto può essere lungo il brief: 300 token, a circa 4 caratteri l'uno. */
export const BRIEF_MAX_CHARS = 1200;

/**
 * Gli strati del contesto oltre al brief: `unbundle context --<strato>` e `get_case_context` con `layer`. (9b) `contesto`:
 * i fatti confermati sul cliente che toccano il caso, solo «Per tutti».
 */
export const CONTEXT_LAYERS = ["progetto", "decisioni", "pacchetto", "domande", "contesto"] as const;
export type ContextLayer = (typeof CONTEXT_LAYERS)[number];

/** (9b) La prima versione della CLI del modello che conosce `--contesto` (RILASCIO-9b-COSTRUZIONE.md §5.4). */
export const CONTEXT_LAYER_CLI_VERSION = Object.freeze([1, 6, 0] as const);

/**
 * (9b) La richiesta viene dalla CLI del modello (`user-agent: unbundle-cli/<versione>`) dalla 1.6.0 in su, l'unica che
 * conosce `--contesto`: la 1.5.0 risponde «--contesto vuole un valore.» (e con `--dal` se lo mangia). Solo a lei il
 * brief dice la riga del contesto e mette `--contesto` tra gli strati; le rotte restano per tutti. Un altro client (l'MCP
 * del caso, uno script) o una versione che non si legge: no.
 */
export function cliKnowsContextLayer(userAgent: string | null | undefined): boolean {
  const match = /^unbundle-cli\/(\d{1,4})\.(\d{1,4})\.(\d{1,4})(?![\d.])/.exec(String(userAgent ?? "").trim());
  if (!match) return false;
  const version = match.slice(1, 4).map(Number);
  for (let i = 0; i < 3; i++) if (version[i] !== CONTEXT_LAYER_CLI_VERSION[i]) return version[i] > CONTEXT_LAYER_CLI_VERSION[i];
  return true;
}
export const BRIEF_MAX_TOKENS = 300;
/** Le decisioni nel brief: le ultime valide. */
export const BRIEF_DECISIONS = 5;

/** Una stima prudente dei token di un testo italiano. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface BriefProject {
  version: number;
  status: ProjectStatus;
  revision: number;
  topics: ProjectTopics;
  framework: string | null;
  newTools: ProjectNewTool[];
  estimateHours: number | null;
  monthlyCostEur: number | null;
  approvedAt: string | null;
  aiBoardOkAt: string | null;
  changeRequest: string | null;
  updatedAt: string;
}

export interface BriefDecision {
  id: string;
  decidedOn: string;
  topicKey: string | null;
  topic: string;
  choice: string;
  reason: string | null;
  createdAt: string;
}

export interface BriefInput {
  code: string;
  title: string;
  dossierStatus: CaseStatus;
  open: BriefProject | null;
  approved: BriefProject | null;
  latestPackage: { version: number; createdAt: string; source: "generato" | "importato" } | null;
  decisions: BriefDecision[];
  /** Esigenze di «Cosa serve» ancora aperte; null se chi chiede non le può vedere. */
  openNeeds: number | null;
  proposedQuestions: number;
  repos: { repo: string; folder: string }[];
  /** (8.1a) La riga dei compiti (`tasksBriefLine`): «T-2 tuo, in corso · …», senza nomi; null senza compiti. */
  tasksLine?: string | null;
  /**
   * (9b) Le novità del contesto del cliente dopo l'ultimo pacchetto: le righe di `CONTESTO.md` che il prossimo «Aggiorna il
   * pacchetto» cambierebbe (tutte, se l'ultima versione non ce l'ha); senza pacchetto quanti fatti ci sono
   * (`packageContextDelta`). Con zero, o senza, nessuna riga.
   */
  contextDelta?: number;
  /**
   * (9b) Chi chiede conosce `--contesto` (la CLI dalla 1.6.0, `cliKnowsContextLayer`): solo allora la riga del contesto e
   * lo strato nella riga «Strati». Assente o falso: il brief di prima della 9b.
   */
  contextLayer?: boolean;
  namesToHide: readonly string[];
  /** Le novità da questa data (ISO), se chiesta. */
  since?: string | null;
}

const day = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  return new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Rome" }).format(d);
};
const shortDay = (iso: string) => day(iso).slice(0, 5);
const cut = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** Il prossimo passo, dal progetto e dal pacchetto: una frase. */
export function nextStep(input: Pick<BriefInput, "open" | "approved" | "latestPackage" | "code">): string {
  const { open, approved } = input;
  if (open?.status === "in_corso") {
    const missing = SETUP_TOPICS.filter((t) => !open.topics[t]?.scelta).length;
    if (open.changeRequest) return `l'AI Board chiede una modifica: cambia il progetto e rimandalo in approvazione.`;
    return missing ? `finire l'impostazione: ${missing === 1 ? "manca una scelta" : `mancano ${missing} scelte`} («unbundle setup ${input.code}»).` : "mandare il progetto in approvazione.";
  }
  if (open?.status === "da_approvare") {
    if (open.changeRequest) return "l'AI Board chiede una modifica: il responsabile del caso riapre il progetto.";
    if (open.newTools.length && !open.aiBoardOkAt) return "aspettare l'ok dell'AI Board agli strumenti nuovi.";
    return "aspettare l'approvazione del responsabile del caso.";
  }
  if (!approved) return `impostare il caso («unbundle setup ${input.code}»).`;
  if (!input.latestPackage) return "generare il pacchetto dalla pagina «Progetto dell'agente».";
  return `costruire secondo il progetto approvato (versione ${approved.version}).`;
}

function hider(names: readonly string[]): (text: string) => string {
  const tokens = nameTokens(names);
  const given = givenNames(names);
  return (text) => redact(text, tokens, given);
}

/** Il brief: al massimo 300 token, senza nomi, con il prossimo passo e le ultime decisioni che valgono. */
export function composeBrief(input: BriefInput): string {
  const hide = hider(input.namesToHide);
  const project = input.open ?? input.approved;
  const lines: string[] = [];
  // Solo il testo libero passa dai nomi da nascondere; codici, repository e cartelle restano come sono.
  lines.push(cut(`${input.code} · ${hide(oneLine(input.title))}`, 110));
  const status = CASE_STATUS_LABEL[input.dossierStatus] ?? input.dossierStatus;
  if (project) {
    const projectText =
      project.status === "approvato"
        ? `versione ${project.version}, approvato il ${day(project.approvedAt)}`
        : `versione ${project.version}, ${project.status === "in_corso" ? "in corso" : "da approvare"}${input.approved ? ` (approvata la ${input.approved.version})` : ""}`;
    lines.push(`Dossier: ${status}. Progetto: ${projectText}${project.framework ? `, framework ${project.framework}` : ""}.`);
  } else {
    lines.push(`Dossier: ${status}. Progetto: non ancora impostato.`);
  }
  lines.push(`Prossimo passo: ${nextStep(input)}`);
  if (input.latestPackage) lines.push(`Pacchetto: k${input.latestPackage.version} del ${day(input.latestPackage.createdAt)} («unbundle start» lo porta nel repository).`);
  // (9b) La riga del contesto, subito dopo quella del pacchetto, solo per chi conosce `--contesto`. Porta solo il codice e
  // dei numeri: come il codice e i repository non passa dai nomi da nascondere («ROSA-0001» resterebbe «una
  // persona-0001»). Non comincia con «- »: quando il brief è lungo cedono le decisioni, non lei.
  const contextLine = input.contextLayer === true ? contextBriefLine({ code: input.code, delta: input.contextDelta ?? 0, packageVersion: input.latestPackage?.version ?? null }) : null;
  if (contextLine) lines.push(cut(contextLine, 160));
  if (input.tasksLine) lines.push(cut(input.tasksLine, 200));
  if (project?.newTools.length) {
    lines.push(cut(`Strumenti nuovi: ${project.newTools.map((t) => hide(t.nome)).join(", ")}${project.aiBoardOkAt ? ` (ok AI Board ${day(project.aiBoardOkAt)})` : " (manca l'ok dell'AI Board)"}.`, 160));
  }
  const decisions = currentDecisions(input.decisions)
    .slice()
    .sort((a, b) => (a.decidedOn === b.decidedOn ? (a.createdAt < b.createdAt ? 1 : -1) : a.decidedOn < b.decidedOn ? 1 : -1))
    .slice(0, BRIEF_DECISIONS);
  if (decisions.length) {
    lines.push("Decisioni recenti:");
    for (const d of decisions) lines.push(cut(`- ${shortDay(d.decidedOn)} · ${hide(oneLine(d.topic))} · ${hide(oneLine(d.choice))}`, 120));
  }
  const questions = [
    input.openNeeds === null ? null : `${input.openNeeds} ${input.openNeeds === 1 ? "aperta" : "aperte"} in «Cosa serve»`,
    input.proposedQuestions ? `${input.proposedQuestions} ${input.proposedQuestions === 1 ? "proposta" : "proposte"} da un coding agent` : null,
  ].filter(Boolean);
  if (questions.length) lines.push(`Domande: ${questions.join(", ")}.`);
  if (input.repos.length) lines.push(cut(`Repository: ${input.repos.map((r) => `${r.repo} (${r.folder})`).join(", ")}.`, 160));
  if (input.since) {
    const since = input.since;
    const fresh = input.decisions.filter((d) => d.createdAt > since).length;
    const changes = [
      fresh ? (fresh === 1 ? "1 decisione nuova" : `${fresh} decisioni nuove`) : null,
      input.latestPackage && input.latestPackage.createdAt > since ? `pacchetto k${input.latestPackage.version}` : null,
      project && project.updatedAt > since ? "progetto cambiato" : null,
    ].filter(Boolean);
    lines.push(`Dal ${day(since)}: ${changes.length ? changes.join(", ") : "niente di nuovo"}.`);
  }
  lines.push(`Strati: ${CONTEXT_LAYERS.filter((layer) => layer !== "contesto" || input.contextLayer === true).map((layer) => `--${layer}`).join(", ")}.`);
  let text = lines.join("\n");
  // Le righe delle decisioni sono le prime a cedere, se il brief è lungo.
  while (text.length > BRIEF_MAX_CHARS) {
    const at = text.lastIndexOf("\n- ");
    if (at < 0) {
      text = cut(text, BRIEF_MAX_CHARS);
      break;
    }
    const end = text.indexOf("\n", at + 1);
    text = text.slice(0, at) + (end < 0 ? "" : text.slice(end));
  }
  return text;
}

/** Lo strato «progetto»: i 10 argomenti con scelta, perché e alternativa, gli strumenti nuovi e la stima. */
export function composeProjectLayer(input: Pick<BriefInput, "code" | "open" | "approved" | "namesToHide">): string {
  const hide = hider(input.namesToHide);
  const project = input.open ?? input.approved;
  if (!project) return `${input.code}: il progetto non è ancora impostato.`;
  const lines = [`${input.code} · progetto versione ${project.version} (${project.status === "approvato" ? `approvato il ${day(project.approvedAt)}` : project.status === "in_corso" ? "in corso" : "da approvare"}, revisione ${project.revision})`];
  for (const topic of SETUP_TOPICS) {
    const choice = project.topics[topic];
    lines.push(`## ${SETUP_TOPIC_LABELS[topic]}`);
    if (!choice) {
      lines.push("Da scegliere.");
      continue;
    }
    lines.push(hide(oneLine(choice.scelta)));
    if (choice.perche) lines.push(`Perché: ${hide(oneLine(choice.perche))}`);
    if (choice.alternativa) lines.push(`Scartata: ${hide(oneLine(choice.alternativa))}`);
  }
  lines.push("## Strumenti nuovi e stima");
  lines.push(project.newTools.length ? project.newTools.map((t) => `- ${hide(t.nome)}${t.perche ? `: ${hide(t.perche)}` : ""}`).join("\n") : "Nessuno strumento nuovo per il cliente.");
  lines.push(
    `Costruzione: ${project.estimateHours === null ? "non stimata" : `circa ${project.estimateHours} ore`}. Costo al mese: ${project.monthlyCostEur === null ? "non stimato" : `circa ${project.monthlyCostEur} €`}.`,
  );
  if (project.changeRequest) lines.push(`L'AI Board chiede una modifica: ${hide(oneLine(project.changeRequest))}`);
  return lines.join("\n");
}

/** Lo strato «decisioni»: tutte quelle che valgono, dalla più recente. */
export function composeDecisionsLayer(input: Pick<BriefInput, "code" | "decisions" | "namesToHide">): string {
  const hide = hider(input.namesToHide);
  const current = currentDecisions(input.decisions).sort((a, b) => (a.decidedOn === b.decidedOn ? (a.createdAt < b.createdAt ? 1 : -1) : a.decidedOn < b.decidedOn ? 1 : -1));
  if (!current.length) return `${input.code}: nessuna decisione ancora.`;
  const lines = [`${input.code} · decisioni che valgono (${current.length})`];
  for (const d of current) {
    lines.push(`- ${day(d.decidedOn)} · ${hide(oneLine(d.topic))} · ${hide(oneLine(d.choice))}${d.reason ? ` (perché: ${hide(oneLine(d.reason))})` : ""}`);
  }
  return lines.join("\n");
}

/** La guida di un argomento dell'impostazione: la domanda da fare al team, in una frase. */
export const SETUP_GUIDE: Readonly<Record<SetupTopic, string>> = Object.freeze({
  funzionalita: "Che cosa fa l'agente, in una frase, e che cosa non fa mai? Parti dal «Come cambia» della scheda.",
  journey: "Come arriva il lavoro all'agente e come ne esce: chi vede cosa, e da quale gradino di autonomia si parte (0 in ombra, 1 con un tocco umano, 2 da solo con controlli a campione).",
  dati: "Quali dati legge e scrive, dove stanno e in quale regione; che cosa non esce mai dal flusso.",
  framework: "Il più semplice che regge le regole del caso: codice (predefinito per gli agenti autonomi), LangGraph/LangChain, Claude Agent SDK, Claude Cowork, n8n, altro.",
  backend: "Dove gira (funzioni Vercel, istanza del cliente, n8n), con quali tempi e limiti.",
  frontend: "Quale interfaccia serve, se serve: il pannello comune, uno strumento che il cliente usa già, nessuna.",
  integrazioni: "Quali sistemi tocca, in lettura o in scrittura, con gli accessi minimi.",
  modelli: "Quali ruoli (lettura, scrittura, giudizio) e per ognuno il modello più piccolo che basta tra quelli approvati dal cliente, con la riserva.",
  osservabilita: "Dove vanno le tracce (Langfuse in UE se non c'è una preferenza) e che cosa si misura.",
  evals_autonomia: "Le regole fisse al 100 %, i casi d'oro e le soglie per salire di gradino.",
});

/** Lo strato «domande»: le esigenze aperte di «Cosa serve» (se chi chiede le vede) e le domande proposte da decidere. */
export function composeQuestionsLayer(input: {
  code: string;
  openNeeds: { title: string; status: string }[] | null;
  /** null: chi chiede non vede «Cosa serve», e nemmeno le proposte (come nella scheda). */
  proposals: { question: string; reason: string | null; createdAt: string }[] | null;
  namesToHide: readonly string[];
}): string {
  const hide = hider(input.namesToHide);
  const lines = [`${input.code} · domande`];
  // (Rilascio 10, §4.2) Nella CLI si dice «caso», mai «use case» né «caso d'uso»; ciò che serve è un'«informazione».
  if (input.openNeeds === null) lines.push("«Cosa serve»: le informazioni le vede chi valuta il caso.");
  else if (!input.openNeeds.length) lines.push("«Cosa serve»: nessuna informazione aperta.");
  else {
    lines.push(`«Cosa serve», aperte (${input.openNeeds.length}):`);
    for (const n of input.openNeeds) lines.push(`- ${hide(oneLine(n.title))} (${n.status})`);
  }
  if (input.proposals === null) {
    lines.push("Proposte dei coding agent: le vede chi valuta il caso.");
    return lines.join("\n");
  }
  if (!input.proposals.length) lines.push("Proposte dei coding agent: nessuna da decidere.");
  else {
    lines.push(`Proposte dei coding agent da decidere (${input.proposals.length}):`);
    for (const p of input.proposals) lines.push(`- ${day(p.createdAt)} · ${hide(oneLine(p.question))}${p.reason ? ` (perché: ${hide(oneLine(p.reason))})` : ""}`);
  }
  lines.push(`Per proporne un'altra: «unbundle ask ${input.code} "…"». Non parte da sola: la decide una persona.`);
  return lines.join("\n");
}

/** Lo strato «pacchetto»: le versioni, dalla più recente; i file li porta «unbundle start». */
export function composePackageLayer(input: { code: string; packages: { version: number; createdAt: string; source: "generato" | "importato"; contentHash: string }[] }): string {
  if (!input.packages.length) return `${input.code}: nessun pacchetto ancora. Si genera dalla pagina «Progetto dell'agente».`;
  const lines = [`${input.code} · pacchetto (${input.packages.length} versioni)`];
  for (const p of input.packages.slice(0, 10)) {
    lines.push(`- k${p.version} · ${day(p.createdAt)} · ${p.source === "importato" ? "preparato a mano" : "generato dalla scheda"} · impronta ${p.contentHash.slice(0, 12)}`);
  }
  lines.push(`I file dell'ultima versione: «unbundle start ${input.code}» li scrive in casi/<id>/unbundle/.`);
  return lines.join("\n");
}
