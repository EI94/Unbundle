/**
 * I testi delle notifiche degli use case nella campanella (SPEC §P2.6.5): risposte arrivate, nuovi
 * documenti, nessuna risposta, informazioni complete e (0025) «Pronto da avviare» per Lateral Space,
 * «Autorizza i fornitori» per chi può dare l'ok del cliente. Una riga dice per quale use case (codice e
 * titolo, nella prima riga), che cosa è successo e quante risposte o documenti: mai il testo delle
 * risposte, mai i nomi dei file, mai il nome o l'email del referente, mai una persona.
 *
 * Modulo puro: import relativi `.ts`.
 */
import type { FollowUpReason } from "../db/use-case-hub-referents-ddl.ts";
import type { UseCaseNoticeKind0041 as UseCaseNoticeKind } from "../db/context-work-ddl.ts";

export const USE_CASE_NOTICE_TEXT = Object.freeze({
  titles: Object.freeze({
    risposte: "Risposte arrivate",
    documenti: "Nuovi documenti",
    senza_risposta: "Nessuna risposta",
    complete: "Informazioni complete",
    pronto: "Pronto da avviare",
    fornitori: "Autorizza i fornitori",
    // (Rilascio 6) Una domanda del referente al team («Ho un dubbio»).
    domanda: "Il referente ha chiesto qualcosa",
    // (Rilascio 7) Uno use case in uso che rende poco più di quanto costa tenerlo acceso («Programma»).
    da_rivedere: "Da rivedere",
    // (Rilascio 8.0a) L'Agent Factory: il progetto da approvare, l'ok dell'AI Board agli strumenti nuovi, il
    // pacchetto cambiato, il progetto approvato, la modifica chiesta dall'AI Board, l'ok da rifare.
    progetto_appr: "Progetto da approvare",
    strumento_nuovo: "Serve l'ok dell'AI Board",
    pacchetto_nuovo: "Il pacchetto è cambiato",
    progetto_ok: "Progetto approvato",
    modifica_chiesta: "L'AI Board chiede una modifica",
    ok_decaduto: "L'ok dell'AI Board è da rifare",
    // (Rilascio 8.0b) Un coding agent propone una domanda per il referente: la decide una persona.
    // (Rilascio 10, §3.12) Senza «coding agent» dove non serve: la domanda è per il referente.
    domanda_agente: "Una domanda proposta per il referente",
    // (Rilascio 8.1a) I compiti: qualcuno chiede il tuo, te ne hanno passato uno, uno è fermo, ce ne sono da prendere.
    compito_chiesto: "Qualcuno del team chiede il tuo compito",
    compito_passato: "Ti hanno passato un compito",
    compito_fermo: "Un compito è fermo",
    compiti_pronti: "Ci sono compiti da prendere",
    // (Rilascio 8.1b) Una pull request di un caso è pronta da rivedere.
    pr_da_rivedere: "Una pull request da rivedere",
    // (Rilascio 8.1b) Da GitHub è arrivata una proposta di compito: la decide qualcuno del team.
    compito_proposto: "Una proposta di compito",
    // (Rilascio 8.2a) Il banco di prova consiglia un altro modello per un ruolo; le evals di main sono sotto soglia, o
    // giù di 5 punti: il titolo vale per tutti e due gli avvisi.
    banco_consiglio: "Il banco di prova consiglia un altro modello",
    evals_in_calo: "Le evals di main sono sotto soglia o in calo",
    // (Rilascio 9b) «Contesto nel lavoro»: i fatti sul cliente che toccano lo use case sono cambiati (a chi costruisce);
    // un fatto appena confermato può chiudere una richiesta di «Cosa serve» (ai revisori).
    contesto_nuovo: "Il contesto è cambiato",
    dalla_call: "Una risposta per «Cosa serve»",
  } satisfies Record<UseCaseNoticeKind, string>),
  answers: Object.freeze({ one: "1 risposta", many: "{n} risposte" }),
  documents: Object.freeze({ one: "1 documento", many: "{n} documenti" }),
  unknowns: Object.freeze({ one: "1 «Non lo so»", many: "{n} «Non lo so»" }),
  join: " e ",
  toVerify: "{A} da verificare in «Cosa serve».",
  askSomeoneElse: "{u}: serve chiedere a qualcun altro.",
  toVerifyBare: "Da verificare in «Cosa serve».",
  newDocuments: "{d} in «Cosa serve».",
  followUp: Object.freeze({
    ultimo_promemoria: "È partito l'ultimo promemoria e restano domande senza risposta.",
    scaduta: "Il link è scaduto e restano domande senza risposta.",
  } satisfies Record<FollowUpReason, string>),
  complete: "Ci sono tutte le informazioni che servono dal cliente.",
  ready: "Non manca niente dal cliente: si può avviare la realizzazione.",
  suppliers: "Serve il tuo ok sui fornitori, in Impostazioni, per chiedere le informazioni di questo use case.",
  question: "Rispondi dalla scheda, in «Cosa serve».",
  review: "In uso, rende meno di 2 € per ogni euro che costa tenerlo acceso. Guardalo in «Programma».",
  projectToApprove: "L'impostazione è pronta: guarda il progetto e approvalo in «Costruzione», nella realizzazione.",
  newToolToApprove: "Il progetto usa strumenti nuovi: guardali e dai l'ok, o chiedi una modifica, in «Costruzione», nella realizzazione.",
  newPackage: "C'è una nuova versione del pacchetto: «unbundle start» la porta nel repository.",
  projectApproved: "Le scelte approvate sono in «Costruzione», nella realizzazione: da qui si costruisce.",
  changeRequested: "Che cosa cambiare è in «Costruzione», nella realizzazione: il responsabile riapre il progetto.",
  boardOkDropped: "Il progetto è cambiato: quando torna da approvare serve di nuovo il tuo ok, in «Costruzione».",
  agentQuestion: "Guardala in «Cosa serve»: la aggiungi alle domande per il referente, oppure la lasci stare. Da sola non parte.",
  taskRequested: "Passaglielo con «unbundle passa», o diglielo tu: finché non lo passi, resta tuo.",
  taskPassed: "La nota di passaggio è in «unbundle compiti»: fatto, da fare, dubbi, come riprendere.",
  // La stessa riga a chi ha il compito e al responsabile del caso: generica.
  taskStale: "Da giorni lavorativi non ci sono segnali: chi lo ha lo riprende con «unbundle take», o lo lascia con una nota. Nessuno lo riassegna da solo.",
  tasksReady: "Il progetto è approvato: «unbundle compiti» li elenca, «unbundle take» ne prende uno.",
  prToReview: "La trovi su GitHub: la rivede qualcuno del team che non l'ha scritta. Quando si unisce, il compito è fatto.",
  taskProposed: "Accettala come compito o scartala, nei compiti del progetto. Da sola non diventa un compito.",
  benchAdvice: "Per un ruolo dell'agente c'è un modello che conviene di più. Il confronto e la PR di una riga sono in «Qualità», nel progetto.",
  evalsDown: "Le evals di main sono sotto soglia, o giù di almeno 5 punti rispetto alle precedenti. Guarda quali gruppi non passano in «Qualità», nel progetto.",
  contextChanged: "Sono cambiati i fatti sul cliente che toccano questo use case.",
  answerFromCall: "Una richiesta si può chiudere con un fatto appena confermato.",
  contextSeparator: " · ",
});

const count = (n: number, forms: { one: string; many: string }) => (n === 1 ? forms.one : forms.many.replace("{n}", String(n)));

const safe = (n: number) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/** Titolo e descrizione di una riga, dai soli conteggi e dal codice del seguito. */
export function noticeTextOf(n: {
  kind: UseCaseNoticeKind;
  answers: number;
  unknowns: number;
  documents: number;
  followUp: FollowUpReason | null;
}): { title: string; description: string } {
  const t = USE_CASE_NOTICE_TEXT;
  const title = t.titles[n.kind];
  if (n.kind === "complete") return { title, description: t.complete };
  if (n.kind === "pronto") return { title, description: t.ready };
  if (n.kind === "fornitori") return { title, description: t.suppliers };
  if (n.kind === "domanda") return { title, description: t.question };
  if (n.kind === "da_rivedere") return { title, description: t.review };
  if (n.kind === "progetto_appr") return { title, description: t.projectToApprove };
  if (n.kind === "strumento_nuovo") return { title, description: t.newToolToApprove };
  if (n.kind === "pacchetto_nuovo") return { title, description: t.newPackage };
  if (n.kind === "progetto_ok") return { title, description: t.projectApproved };
  if (n.kind === "modifica_chiesta") return { title, description: t.changeRequested };
  if (n.kind === "ok_decaduto") return { title, description: t.boardOkDropped };
  if (n.kind === "domanda_agente") return { title, description: t.agentQuestion };
  if (n.kind === "compito_chiesto") return { title, description: t.taskRequested };
  if (n.kind === "compito_passato") return { title, description: t.taskPassed };
  if (n.kind === "compito_fermo") return { title, description: t.taskStale };
  if (n.kind === "compiti_pronti") return { title, description: t.tasksReady };
  if (n.kind === "pr_da_rivedere") return { title, description: t.prToReview };
  if (n.kind === "compito_proposto") return { title, description: t.taskProposed };
  if (n.kind === "banco_consiglio") return { title, description: t.benchAdvice };
  if (n.kind === "evals_in_calo") return { title, description: t.evalsDown };
  if (n.kind === "contesto_nuovo") return { title, description: t.contextChanged };
  if (n.kind === "dalla_call") return { title, description: t.answerFromCall };
  if (n.kind === "senza_risposta") return { title, description: t.followUp[n.followUp ?? "scaduta"] };
  const answers = safe(n.answers);
  const documents = safe(n.documents);
  if (n.kind === "documenti") return { title, description: t.newDocuments.replace("{d}", count(Math.max(1, documents), t.documents)) };
  const unknowns = safe(n.unknowns);
  const parts = [answers > 0 ? count(answers, t.answers) : null, documents > 0 ? count(documents, t.documents) : null].filter((p): p is string => p !== null);
  const verify = parts.length ? t.toVerify.replace("{A}", parts.join(t.join)) : null;
  const ask = unknowns > 0 ? t.askSomeoneElse.replace("{u}", count(unknowns, t.unknowns)) : null;
  if (verify && ask) return { title, description: `${verify} ${ask}` };
  if (verify) return { title, description: verify };
  if (ask) return { title, description: ask };
  return { title, description: t.toVerifyBare };
}

const CONTEXT_MAX = 120;

/** «RD-0004 · Fatture fornitori», o il solo titolo; al massimo 120 caratteri, con «…». */
export function noticeContextOf(code: string | null, title: string): string {
  const cleanTitle = (title ?? "").replace(/\s+/g, " ").trim();
  const cleanCode = (code ?? "").replace(/\s+/g, " ").trim();
  const text = cleanCode ? `${cleanCode}${USE_CASE_NOTICE_TEXT.contextSeparator}${cleanTitle}` : cleanTitle;
  return text.length > CONTEXT_MAX ? `${text.slice(0, CONTEXT_MAX - 1).trimEnd()}…` : text;
}
