/**
 * «Referente in un tocco» (rilascio 5, SPEC §3.8, D31, D52): le domande spuntate all'apertura di
 * «Scegli il referente», «Cambia referente», «Chiedi di nuovo» e «Chiedi al referente».
 *
 * - **scegli / cambia**: prima le domande aperte delle richieste che l'invio revoca (portate dalla
 *   richiesta di prima, sempre spuntate, anche oltre 5), poi fino a 5 in tutto tra le altre da chiedere,
 *   tolte quelle a cui il referente ha già risposto «Non ce l'ho», nell'ordine di `questionsForPerson`
 *   (quelle che lo nominano e le generiche, poi le altre, nell'ordine della scheda); mai oltre 20;
 * - **di_nuovo**: le domande della richiesta di prima ancora da chiedere (la regola del rilascio 4);
 * - **chiedi**: fino a 5 tra le domande da chiedere, tolte le «Non ce l'ho» del referente.
 *
 * Il server non decide mai le spunte: le ricontrolla soltanto. Modulo puro.
 */
import { REFERENT_LIMITS } from "./contract.ts";
import { initialTicks, questionsForPerson, type MatchPerson, type MatchQuestion } from "./match.ts";

/** Le domande spuntate di default in una richiesta al referente. */
export const ASSIGN_DEFAULT_TICKS = 5;

export type AssignMode = "scegli" | "cambia" | "di_nuovo" | "chiedi";

export interface AssignTicksInput {
  mode: AssignMode;
  /** Le domande da chiedere, nell'ordine della scheda (quelle portate comprese). */
  askable: readonly MatchQuestion[];
  /** Le domande aperte delle richieste che l'invio revoca. */
  carried?: readonly string[];
  /** Le domande a cui il referente ha risposto «Non ce l'ho» (§3.7). */
  declined?: Iterable<string>;
  person: MatchPerson | null;
  orgWords: ReadonlySet<string>;
  /** «Chiedi di nuovo»: le domande della richiesta di prima. */
  previous?: readonly string[] | null;
}

/** Le spunte di default (§3.8), in ordine: le portate, poi le altre. */
export function defaultAssignTicks(i: AssignTicksInput): string[] {
  const max = REFERENT_LIMITS.questionsPerRequest;
  const order = i.askable.map((q) => q.id.toLowerCase());
  const known = new Set(order);
  const person = i.person ?? { displayName: "", roleLabel: null };
  if (i.mode === "di_nuovo") {
    const result = questionsForPerson({ person, askable: i.askable, orgWords: i.orgWords, previous: i.previous ?? [] });
    return initialTicks(result, max);
  }
  const declined = new Set([...(i.declined ?? [])].map((id) => id.toLowerCase()));
  const carriedSet = new Set(i.mode === "chiedi" ? [] : (i.carried ?? []).map((id) => id.toLowerCase()).filter((id) => known.has(id)));
  const carried = order.filter((id) => carriedSet.has(id)).slice(0, max);
  const rest = i.askable.filter((q) => !carriedSet.has(q.id.toLowerCase()) && !declined.has(q.id.toLowerCase()));
  const proposal = questionsForPerson({ person, askable: rest, orgWords: i.orgWords });
  const fill = Math.min(Math.max(0, ASSIGN_DEFAULT_TICKS - carried.length), max - carried.length);
  return [...carried, ...initialTicks({ proposed: [...proposal.proposed, ...proposal.others] }, fill)];
}
