/**
 * Impostazioni della realizzazione (rilascio 10, §3.5; §3.21 dell'audit): tre sezioni, «La realizzazione» (nome,
 * frase e perimetro; codice e schema in «Dettagli tecnici»), «Pausa» e «Zona pericolosa» (revoca dei link e chiusura,
 * una volta sola). Gli account sono in Persone › «Nella realizzazione», le leve in Valore. A schermo «realizzazione»,
 * mai «caso» (§4); il titolo della pagina è un H2, sotto quello della testata.
 *
 * Modulo puro, senza dipendenze di Node: lo usano la pagina, i suoi componenti client e i test.
 */
import type { CaseStatus } from "../vocab.ts";

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
