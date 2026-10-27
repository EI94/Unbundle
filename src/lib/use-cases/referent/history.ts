/**
 * «Chiedi al referente» nella Storia dello use case (SPEC §5.6, §P2.10.6). Le righe non hanno
 * testi: azione `modificato`, campo `richiesta_referente` (drizzle/0024), un codice in
 * `phase_after`. Mai il nome del referente, mai i testi delle domande o delle risposte, mai i nomi
 * dei file. Le leggono solo i revisori, come «Cosa serve» (`withNeeds`).
 *
 * Modulo puro.
 */
import { REFERENT_EVENT_FIELD } from "../../db/use-case-hub-referents-ddl.ts";

export const REFERENT_HISTORY_FIELD = REFERENT_EVENT_FIELD;

export const REFERENT_HISTORY_CODES = [
  "inviata",
  "domande_aggiunte",
  "promemoria",
  "promemoria_1",
  "promemoria_2",
  "risposte",
  "completata",
  "scaduta",
  "revocata",
  "revocata_sistema",
  "risposta_team",
  "risposta_tolta",
  "file_team",
  "file_tolto",
  "file_accettato",
  "file_rifiutato",
  "email_corretta",
  "dati_cancellati",
  "conservazione",
] as const;
export type ReferentHistoryCode = (typeof REFERENT_HISTORY_CODES)[number];

export const REFERENT_HISTORY_PREFIX = "Chiedi al referente";

export const REFERENT_HISTORY_TEXT: Readonly<Record<ReferentHistoryCode, string>> = Object.freeze({
  inviata: "richiesta inviata",
  domande_aggiunte: "domande aggiunte alla richiesta",
  promemoria: "promemoria inviato",
  promemoria_1: "promemoria automatico inviato",
  promemoria_2: "ultimo promemoria inviato",
  risposte: "risposte ricevute",
  completata: "tutte le risposte ricevute",
  scaduta: "link scaduto",
  revocata: "link revocato",
  revocata_sistema: "link revocato: il referente non è più attivo",
  risposta_team: "risposta aggiunta dal team",
  risposta_tolta: "risposta eliminata",
  file_team: "file aggiunto dal team",
  file_tolto: "file eliminato",
  file_accettato: "file accettato dopo il controllo",
  file_rifiutato: "file rifiutato dopo il controllo",
  email_corretta: "email del referente corretta",
  dati_cancellati: "dati del referente cancellati",
  conservazione: "risposte e file cancellati dopo 12 mesi",
});

/** (Parte 2) Chi ha agito, per le righe automatiche di «Cosa serve» e di questa funzione. */
export const HISTORY_ACTOR_TEXT = Object.freeze({ referente: "Referente", sistema: "Unbundle" });

/** È una riga di «Chiedi al referente»? */
export function isReferentHistoryEvent(e: { fields: readonly string[] }): boolean {
  return e.fields.includes(REFERENT_HISTORY_FIELD);
}

export function isReferentHistoryCode(code: unknown): code is ReferentHistoryCode {
  return typeof code === "string" && (REFERENT_HISTORY_CODES as readonly string[]).includes(code);
}

/** «Chiedi al referente: richiesta inviata»; con un codice sconosciuto, «Chiedi al referente». */
export function referentHistoryText(e: { phaseAfter: string | null }): string {
  return isReferentHistoryCode(e.phaseAfter) ? `${REFERENT_HISTORY_PREFIX}: ${REFERENT_HISTORY_TEXT[e.phaseAfter]}` : REFERENT_HISTORY_PREFIX;
}

/**
 * (Parte 2) La parte «chi» di una riga automatica: «Referente» per il canale `web` (la pagina
 * pubblica), «Unbundle» per gli altri canali di sistema (cron, invio delle email); null per le
 * persone (la Storia mostra il loro nome).
 */
export function historyActorText(e: { actorKind: string; channel: string }): string | null {
  if (e.actorKind !== "sistema") return null;
  return e.channel === "web" ? HISTORY_ACTOR_TEXT.referente : HISTORY_ACTOR_TEXT.sistema;
}
