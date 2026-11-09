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
import type { UseCaseNoticeKind0029 as UseCaseNoticeKind } from "../db/use-case-hub-program-ddl.ts";

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
  } satisfies Record<UseCaseNoticeKind, string>),
  answers: Object.freeze({ one: "1 risposta", many: "{n} risposte" }),
  documents: Object.freeze({ one: "1 documento", many: "{n} documenti" }),
  unknowns: Object.freeze({ one: "1 «Non ce l'ho»", many: "{n} «Non ce l'ho»" }),
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
  suppliers: "Serve il tuo ok sui sub-responsabili, in Impostazioni, per chiedere le informazioni di questo use case.",
  question: "Rispondi dalla scheda, in «Cosa serve».",
  review: "In uso, rende meno di 2 € per ogni euro che costa tenerlo acceso. Guardalo in «Programma».",
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

/** «TJ-0004 · Fatture fornitori», o il solo titolo; al massimo 120 caratteri, con «…». */
export function noticeContextOf(code: string | null, title: string): string {
  const cleanTitle = (title ?? "").replace(/\s+/g, " ").trim();
  const cleanCode = (code ?? "").replace(/\s+/g, " ").trim();
  const text = cleanCode ? `${cleanCode}${USE_CASE_NOTICE_TEXT.contextSeparator}${cleanTitle}` : cleanTitle;
  return text.length > CONTEXT_MAX ? `${text.slice(0, CONTEXT_MAX - 1).trimEnd()}…` : text;
}
