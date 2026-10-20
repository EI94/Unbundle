/**
 * Azioni in blocco del catalogo (PIANO §5.1, «Voci e risposte»): per ogni
 * azione gli stati da cui parte, la dimensione dei lotti per chiamata e il
 * riepilogo delle voci saltate.
 *
 * - Gli stati servono solo a dire prima «si applica a N delle M voci» e a non
 *   mandare voci che il comando rifiuterebbe comunque: il comando ricontrolla
 *   ogni voce (permessi, transizione, CAS) e dice quali ha saltato e perché.
 * - I lotti seguono i limiti dei comandi: 500 voci per assegnazione, scadenza
 *   ed esiti; 2.000 per «Invia» e «Chiedi conferma», che fanno una richiesta per
 *   referente a ogni chiamata (lotti grandi = meno link per la stessa persona).
 *
 * Modulo puro, usato anche nel browser.
 */
import type { ItemStatus } from "../vocab.ts";
import { formatCountIt } from "./format.ts";

export const BULK_ACTIONS = ["assign", "due", "missing", "partial", "na", "send", "confirm"] as const;
export type BulkActionKey = (typeof BULK_ACTIONS)[number];

/** Stati da cui parte ogni azione; `null` = ogni stato. */
export const BULK_FROM: Readonly<Record<BulkActionKey, readonly ItemStatus[] | null>> = {
  assign: null,
  due: null,
  missing: ["chiesta", "parziale", "in_verifica"],
  partial: ["in_verifica"],
  na: ["da_chiedere", "chiesta", "mancante", "bloccata", "in_verifica"],
  send: ["da_chiedere", "mancante", "parziale", "bloccata"],
  confirm: ["in_verifica"],
};

/** Voci per chiamata del comando. «Proponi non applicabile» è una chiamata per voce. */
export const BULK_CHUNK: Readonly<Record<BulkActionKey, number>> = {
  assign: 500,
  due: 500,
  missing: 500,
  partial: 500,
  na: 1,
  send: 2000,
  confirm: 2000,
};

/** «Non applicabile» si propone al massimo su 50 voci alla volta: ognuna chiede poi due firme. */
export const MAX_NA_AT_ONCE = 50;

/** Voci selezionate, per stato. */
export type SelectionByStatus = Partial<Record<ItemStatus, readonly string[]>>;

/** Id delle voci selezionate da cui l'azione può partire, senza doppioni. */
export function eligibleIds(selection: SelectionByStatus, action: BulkActionKey): string[] {
  const from = BULK_FROM[action];
  const out = new Set<string>();
  for (const [status, ids] of Object.entries(selection) as [ItemStatus, readonly string[]][]) {
    if (from && !from.includes(status)) continue;
    for (const id of ids) out.add(id);
  }
  const list = [...out];
  return action === "na" ? list.slice(0, MAX_NA_AT_ONCE) : list;
}

/** Elenco diviso in lotti di `size` (almeno 1). */
export function chunks<T>(list: readonly T[], size: number): T[][] {
  const step = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += step) out.push(list.slice(i, i + step));
  return out;
}

export interface SkippedLike {
  key: string;
  message: string;
}

export interface SkipGroup {
  message: string;
  count: number;
  /** Le prime chiavi del gruppo, per ritrovare le voci. */
  keys: string[];
}

/** Voci saltate raggruppate per motivo, dal motivo più frequente. */
export function groupSkipped(skipped: readonly SkippedLike[], maxKeys = 5): SkipGroup[] {
  const groups = new Map<string, SkipGroup>();
  for (const s of skipped) {
    const g = groups.get(s.message) ?? { message: s.message, count: 0, keys: [] };
    g.count++;
    if (s.key && g.keys.length < maxKeys) g.keys.push(s.key);
    groups.set(s.message, g);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.message.localeCompare(b.message, "it"));
}


/** «1 domanda», «140 domande» (Domande parla di domande, §2.6). */
export function questionsText(n: number): string {
  return `${formatCountIt(n)} ${n === 1 ? "domanda" : "domande"}`;
}

/** «1 risposta», «95 risposte». */
export function answersText(n: number): string {
  return `${formatCountIt(n)} ${n === 1 ? "risposta" : "risposte"}`;
}

/**
 * Le domande saltate in una riga, per la descrizione del toast: «3 saltate:
 * senza referente (2), già in un'altra richiesta (1).» Al massimo tre motivi;
 * le chiavi restano fuori (§1, principio 3). Stringa vuota se nessuna.
 */
export function skippedText(groups: readonly SkipGroup[], unlisted = 0): string {
  const total = groups.reduce((n, g) => n + g.count, 0) + unlisted;
  if (total === 0) return "";
  const reasons = groups.slice(0, 3).map((g) => `${g.message.replace(/[.\s]+$/, "").replace(/^./, (c) => c.toLowerCase())} (${formatCountIt(g.count)})`);
  const more = groups.length > 3 || unlisted > 0 ? ", altre per gli stessi motivi" : "";
  return `${formatCountIt(total)} ${total === 1 ? "saltata" : "saltate"}: ${reasons.join(", ")}${more}.`;
}

/** Le azioni della selezione in Domande: con quale parola si chiamano (§3.6.2). */
export const BULK_ACTION_LABEL: Readonly<Record<BulkActionKey, string>> = {
  assign: "Assegna a…",
  send: "Invia",
  confirm: "Chiedi conferma",
  due: "Imposta la scadenza",
  missing: "Segna: manca il dato",
  partial: "Segna: risposta parziale",
  na: "Proponi “non si applica”",
};

/**
 * L'esito di un'azione della selezione, per il toast: «12 domande assegnate a
 * Mario Rossi.», «3 domande inviate: 2 richieste.».
 */
export function bulkOutcomeText(action: BulkActionKey, done: number, extra: { contactName?: string | null; requests?: number; cleared?: boolean } = {}): string {
  const n = questionsText(done);
  const verb = (one: string, many: string) => (done === 1 ? one : many);
  switch (action) {
    case "assign":
      return `${n} ${verb("assegnata", "assegnate")}${extra.contactName ? ` a ${extra.contactName}` : ""}.`;
    case "send":
    case "confirm": {
      const requests = extra.requests ?? 0;
      const what = action === "send" ? verb("inviata", "inviate") : verb("rimandata per conferma", "rimandate per conferma");
      return `${n} ${what}${requests > 0 ? `: ${formatCountIt(requests)} ${requests === 1 ? "richiesta" : "richieste"}` : ""}.`;
    }
    case "due":
      return extra.cleared ? `Scadenza tolta da ${n}.` : `Scadenza proposta su ${n}.`;
    case "missing":
      return `${n} ${verb("segnata", "segnate")}: manca il dato.`;
    case "partial":
      return `${n} ${verb("segnata", "segnate")}: risposta parziale.`;
    case "na":
      return `«Non si applica» proposta su ${n}: servono le due firme.`;
  }
}
