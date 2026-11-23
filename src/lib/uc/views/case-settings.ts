/**
 * Impostazioni della realizzazione (rilascio 10, §3.5; §3.21 dell'audit): tre sezioni, «La realizzazione» (nome,
 * frase e perimetro; codice e schema in «Dettagli tecnici»), «Pausa» e «Zona pericolosa» (revoca dei link e chiusura,
 * una volta sola). Gli account sono in Persone › «Nella realizzazione», le leve in Valore. A schermo «realizzazione»,
 * mai «caso» (§4); il titolo della pagina è un H2, sotto quello della testata.
 *
 * Modulo puro, senza dipendenze di Node: lo usano la pagina, i suoi componenti client e i test.
 */
import type { CaseStatus } from "../vocab.ts";
import { formatCountIt } from "./format.ts";
import { START_TEMPLATE_TEXT, needsLargeTemplateConfirm } from "./start-templates.ts";

export const SETTINGS_TEXT = {
  title: "Impostazioni",
  realization: "La realizzazione",
  pause: "Pausa",
  danger: "Zona pericolosa",
  dangerNote: "Non si annullano. Le risposte già arrivate restano.",
  name: "Nome",
  oneLiner: "In una frase",
  perimeter: "Perimetro",
  perimeterPlaceholder: "Es. Richieste dei clienti business, da maggio",
  save: "Salva",
  notSet: "Non ancora indicato.",
  closed: "La realizzazione è chiusa: si può solo leggere.",
  noChange: "Nessun cambio da qui, adesso.",
  /** In «Dettagli tecnici». */
  code: (code: string) => `Codice: ${code}`,
  template: (name: string, version: string) => `Schema di partenza: ${name} · versione ${version}`,
  previousCode: (code: string) => `Codice precedente: ${code}`,
  /** «Revoca i link» (zona pericolosa). */
  revoke: "Revoca i link…",
  revokeTitle: "Revocare tutti i link?",
  revokeBody: "Smettono di funzionare subito i link dei referenti, quelli per firmare e gli accessi di Claude alla realizzazione. Le risposte arrivate restano.",
  revokeConfirm: "Revoca tutti i link",
  reason: "Motivo",
  reasonOptional: "Motivo (facoltativo)",
  reasonPlaceholder: "Scrivilo in poche parole, senza nomi di persone.",
} as const;

// ── «Cambia schema di partenza» (R3 di docs/dossier/SCHEMA-DI-PARTENZA.md) ──

/** Perché una domanda impedisce il cambio di schema (`ReschemaBlockReason` di `uc-reschema.ts`). */
export type SchemaBlockReason = "risposte" | "file" | "richieste" | "assegnazione" | "commenti";

/** Quante domande che bloccano si elencano nel dialogo; le altre diventano «e altre N». */
export const SCHEMA_BLOCKERS_SHOWN = 20;

/**
 * I testi del cambio dello schema di partenza, in «La realizzazione»: solo in «Bozza», solo per chi modifica le
 * impostazioni. Fuori da `SETTINGS_TEXT` perché ha funzioni con numeri e un elenco di motivi.
 */
export const SCHEMA_CHANGE_TEXT = {
  /** La riga sempre visibile: «Schema di partenza: Dal caso d'uso». */
  label: "Schema di partenza",
  open: "Cambia schema di partenza…",
  dialogTitle: "Cambiare lo schema di partenza?",
  dialogBody: "Le domande della realizzazione ripartono dallo schema che scegli.",
  choose: "Schema",
  rebuilt: "Si rifanno da capo: domande, regole, mappa ed entità.",
  kept: "Restano come sono: codice, nome, persone, Progetto dell'agente, pacchetti, compiti, collegamento al repository e storico.",
  same: "È già lo schema di partenza.",
  confirm: "Cambia schema",
  cancel: "Annulla",
  /** La riga muta sotto il pulsante, senza aprire il dialogo. */
  blockedLine: (n: number) =>
    `Non si può cambiare: ${n === 1 ? "1 domanda ha" : `${formatCountIt(n)} domande hanno`} già risposte, file, richieste o assegnazioni.`,
  blockedTitle: (n: number) => (n === 1 ? "Questa domanda lo impedisce" : "Queste domande lo impediscono"),
  blockedMore: (n: number) => (n === 1 ? "e un'altra" : `e altre ${formatCountIt(n)}`),
  untitled: "Domanda senza titolo",
  reasons: {
    risposte: "ha risposte",
    file: "ha file",
    richieste: "è in una richiesta al referente",
    assegnazione: "è assegnata",
    commenti: "ha commenti",
  } satisfies Record<SchemaBlockReason, string>,
  /** Dopo il comando (toast). */
  changed: (name: string) => `Lo schema di partenza ora è «${name}».`,
  unchanged: "Lo schema di partenza era già questo: non è cambiato nulla.",
  invalid: "Scegli lo schema di partenza.",
  /** Esiti di `reschemaCase`, in italiano semplice. */
  failures: {
    non_in_bozza: "Lo schema di partenza si cambia solo con la realizzazione in «Bozza».",
    bloccato: "Alcune domande hanno già risposte, file, richieste o assegnazioni: lo schema non si cambia.",
    template_non_trovato: "Schema di partenza non trovato: scegline un altro.",
    caso_non_trovato: "Realizzazione non trovata.",
  } as Readonly<Record<string, string>>,
} as const;

/** «ha risposte, ha file»: i motivi di una domanda che blocca, nell'ordine dato, senza ripetizioni. */
export function schemaBlockReasons(reasons: readonly SchemaBlockReason[]): string {
  return [...new Set(reasons)].map((r) => SCHEMA_CHANGE_TEXT.reasons[r] ?? r).join(", ");
}

/** Le domande che bloccano da mostrare (al massimo `SCHEMA_BLOCKERS_SHOWN`) e quante restano fuori. */
export function schemaBlockersShown<T>(blockers: readonly T[], max = SCHEMA_BLOCKERS_SHOWN): { shown: T[]; more: number } {
  const shown = blockers.slice(0, Math.max(0, max));
  return { shown, more: Math.max(0, blockers.length - shown.length) };
}

/** Il pulsante di ogni cambio di stato: «Metti in pausa…», «Riprendi», «Torna allo sviluppo…», «Chiudi la realizzazione…». */
export function statusActionLabel(from: CaseStatus, to: CaseStatus): string {
  if (to === "sospeso") return "Metti in pausa…";
  if (to === "chiuso") return "Chiudi la realizzazione…";
  if (from === "sospeso") return "Riprendi";
  if (to === "in_sviluppo") return "Torna allo sviluppo…";
  return "Cambia stato…";
}

/** Il titolo del dialogo di conferma. */
export function statusDialogTitle(from: CaseStatus, to: CaseStatus): string {
  if (to === "sospeso") return "Mettere in pausa la realizzazione?";
  if (to === "chiuso") return "Chiudere la realizzazione?";
  if (from === "sospeso") return "Riprendere la realizzazione?";
  if (to === "in_sviluppo") return "Tornare allo sviluppo?";
  return "Cambiare lo stato della realizzazione?";
}

/** Il verbo del dialogo. */
export function statusConfirmLabel(from: CaseStatus, to: CaseStatus): string {
  if (to === "sospeso") return "Metti in pausa";
  if (to === "chiuso") return "Chiudi la realizzazione";
  if (from === "sospeso") return "Riprendi";
  if (to === "in_sviluppo") return "Torna allo sviluppo";
  return "Conferma";
}

/** Cosa succede, in una frase, nel dialogo di conferma (come `transitionHint`, con «realizzazione»). */
export function statusHint(from: CaseStatus, to: CaseStatus): string {
  if (to === "chiuso") return "La realizzazione si chiude per sempre: i link dei referenti e gli accessi di Claude si revocano. Si può solo duplicare.";
  if (to === "sospeso") return "La realizzazione si ferma: niente invii né promemoria, i link restano in sola lettura.";
  if (from === "sospeso") return "La realizzazione riprende dallo stato in cui era.";
  if (to === "in_sviluppo") return from === "pronto_sviluppo" ? "Il team parte con lo sviluppo sul catalogo validato." : "Si torna allo sviluppo per correggere.";
  return "";
}

/** L'avviso dopo un cambio: «La realizzazione ora è «In pausa».». */
export function statusDoneText(label: string): string {
  return `La realizzazione ora è «${label}».`;
}

/**
 * «Cambia schema di partenza»: la stessa conferma dello wizard sopra le 50 domande
 * («Questo schema porta N domande: è quello giusto per questo caso?»), con gli stessi testi.
 * Null quando lo schema scelto non la chiede.
 */
export function schemaChangeLargeConfirm(option: { questions: number } | null): { title: string; body: string; confirm: string; cancel: string } | null {
  if (!option || !needsLargeTemplateConfirm(option.questions)) return null;
  return {
    title: START_TEMPLATE_TEXT.largeTitle(option.questions),
    body: START_TEMPLATE_TEXT.largeBody,
    confirm: START_TEMPLATE_TEXT.largeConfirm,
    cancel: START_TEMPLATE_TEXT.largeCancel,
  };
}
