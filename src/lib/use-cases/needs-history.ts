/**
 * «Cosa serve» nella Storia degli use case (drizzle/0023): le righe che le scritture delle esigenze
 * (`needs-service.ts`) lasciano su ogni use case collegato, e come la Storia le legge.
 *
 * Una riga per cambio e per use case, senza testi, come le altre righe della Storia (§10.3): azione
 * `modificato`, campo `cosa_serve` (l'unico nome che la 0023 aggiunge all'elenco chiuso), chi del
 * team ha agito e il canale. Al posto delle fasi della scheda, codici dell'esigenza:
 *
 * - `phase_after`: `<cambio>.<tipo>.<stato>`, con lo stato dopo il cambio
 *   (`aggiunta.requisito.da_chiedere`, `archiviata.passo.fatta`). Al massimo 36 caratteri.
 * - `phase_before`: `<tipo>.<stato>` di prima, solo quando una modifica cambia tipo o stato.
 *
 * Mai il titolo, il dettaglio, «Chi» o il motivo dell'archiviazione: stanno nell'esigenza, che
 * la scheda mostra ai revisori nel capitolo «Cosa serve». Le righe le leggono solo i revisori,
 * come le esigenze (`canSeeNeeds`, `listUseCaseEvents`).
 *
 * Modulo puro: si usa nel servizio e nel capitolo «Storia».
 */
import { USE_CASE_NEEDS_EVENT_FIELD } from "../db/use-case-hub-ddl.ts";
import { NEED_TYPES, isNeedStatusOf, needStatusView, type NeedStatus, type NeedType } from "./needs.ts";

/** Il nome della Storia per «Cosa serve». */
export const NEED_HISTORY_FIELD = USE_CASE_NEEDS_EVENT_FIELD;

/** I cambi che lasciano una riga: aggiungere, modificare, collegare, scollegare, archiviare. */
export const NEED_HISTORY_CHANGES = ["aggiunta", "modificata", "collegata", "scollegata", "archiviata"] as const;
export type NeedHistoryChange = (typeof NEED_HISTORY_CHANGES)[number];

/** `<tipo>.<stato>`: lo stato di prima di una modifica (`phase_before`). */
export function needStateCode(type: NeedType, status: NeedStatus): string {
  return `${type}.${status}`;
}

/** `<cambio>.<tipo>.<stato>`: il cambio e lo stato dopo (`phase_after`). */
export function needHistoryCode(change: NeedHistoryChange, type: NeedType, status: NeedStatus): string {
  return `${change}.${type}.${status}`;
}

export interface NeedHistoryEntry {
  change: NeedHistoryChange;
  type: NeedType;
  status: NeedStatus;
  /** Tipo e stato di prima, solo per una modifica che li cambia. */
  before: { type: NeedType; status: NeedStatus } | null;
}

function stateOf(type: string | undefined, status: string | undefined): { type: NeedType; status: NeedStatus } | null {
  if (!type || !(NEED_TYPES as readonly string[]).includes(type)) return null;
  const needType = type as NeedType;
  return isNeedStatusOf(needType, status) ? { type: needType, status } : null;
}

/** I codici di una riga «Cosa serve»; null per codici che non sono di questo formato. */
export function parseNeedHistory(phaseBefore: string | null, phaseAfter: string | null): NeedHistoryEntry | null {
  const [change, type, status, ...rest] = (phaseAfter ?? "").split(".");
  if (rest.length || !(NEED_HISTORY_CHANGES as readonly string[]).includes(change)) return null;
  const after = stateOf(type, status);
  if (!after) return null;
  let before: NeedHistoryEntry["before"] = null;
  if (phaseBefore && change === "modificata") {
    const [beforeType, beforeStatus, ...beforeRest] = phaseBefore.split(".");
    before = beforeRest.length ? null : stateOf(beforeType, beforeStatus);
    if (before && before.type === after.type && before.status === after.status) before = null;
  }
  return { change: change as NeedHistoryChange, type: after.type, status: after.status, before };
}

/** I testi delle righe (§6.6: azione e nomi, mai i testi dell'esigenza). */
export const NEED_HISTORY_TEXT = Object.freeze({
  label: "Cosa serve",
  item: Object.freeze({ requisito: "un requisito", passo: "un prossimo passo" } satisfies Record<NeedType, string>),
  change: Object.freeze({
    aggiunta: "aggiunto",
    modificata: "modificato",
    collegata: "collegato",
    scollegata: "scollegato",
    archiviata: "archiviato",
  } satisfies Record<NeedHistoryChange, string>),
  status: "stato di",
  becomes: "diventa",
});

/** È una riga di «Cosa serve»? */
export function isNeedHistoryEvent(event: { fields: readonly string[] }): boolean {
  return event.fields.includes(NEED_HISTORY_FIELD);
}

/**
 * La riga come si legge: «Cosa serve: aggiunto un requisito», «Cosa serve: archiviato un prossimo
 * passo», «Cosa serve: stato di un requisito, «Non ancora chiesta» → «A posto»», «Cosa serve: un
 * requisito diventa un prossimo passo». Con codici sconosciuti, «Cosa serve».
 */
export function needHistoryText(event: { phaseBefore: string | null; phaseAfter: string | null }): string {
  const entry = parseNeedHistory(event.phaseBefore, event.phaseAfter);
  const { label, item, change, status, becomes } = NEED_HISTORY_TEXT;
  if (!entry) return label;
  if (entry.before && entry.before.type !== entry.type) return `${label}: ${item[entry.before.type]} ${becomes} ${item[entry.type]}`;
  if (entry.before) {
    const from = needStatusView(entry.before.type, entry.before.status).label;
    const to = needStatusView(entry.type, entry.status).label;
    return `${label}: ${status} ${item[entry.type]}, «${from}» → «${to}»`;
  }
  return `${label}: ${change[entry.change]} ${item[entry.type]}`;
}
