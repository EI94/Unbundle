/**
 * Un fatto che risponde a una richiesta di «Cosa serve» (rilascio 9b, docs/contesto/RILASCIO-9b-COSTRUZIONE.md §2.2,
 * §3.2, D3). Le regole senza database del legame (`context_need_links`).
 *
 * - Quali richieste: i requisiti del cliente (`OPEN_NEED_STATUSES`: gli stati da cui parte la transizione
 *   `reviewer_answer_validated`, src/lib/use-cases/referent/state.ts).
 * - Alla conferma un legame `proposta` diventa `aperta` solo se il fatto è «Per tutti» e la richiesta è ancora aperta: il
 *   testo di un fatto «Solo Lateral Space» non deve arrivare al cliente. Altrimenti `scartata`.
 *
 * Modulo puro: solo tipi.
 */
import type { NeedStatus } from "../../use-cases/needs.ts";
import type { ContextVisibility } from "../vocab.ts";

/** Gli stati aperti di un requisito: quelli da cui un'esigenza può passare ad «A posto» con una risposta del team. */
export const OPEN_NEED_STATUSES: readonly NeedStatus[] = Object.freeze(["da_chiedere", "chiesta", "mancante", "parziale", "in_verifica"]);

/** Vero se lo stato è uno di quelli aperti. */
export function isOpenNeedStatus(status: string): boolean {
  return (OPEN_NEED_STATUSES as readonly string[]).includes(status);
}

/** Lo stato di un legame quando la sua proposta si conferma (§2.2 punto 3). */
export function needLinkAfterConfirm(i: { factVisibility: ContextVisibility; needOpen: boolean }): "aperta" | "scartata" {
  return i.factVisibility === "tutti" && i.needOpen === true ? "aperta" : "scartata";
}
