/**
 * (9b) Alla conferma, che cosa diventano i legami con «Cosa serve» (docs/contesto/RILASCIO-9b-COSTRUZIONE.md §2.2, §3.2):
 * un legame `proposta` nato con la lettura diventa `aperta`, con il fatto, solo se la proposta è stata confermata in un
 * fatto che resta attivo, il fatto è «Per tutti» e la richiesta è ancora aperta (`needLinkAfterConfirm`): il testo di un
 * fatto «Solo Lateral Space» non deve arrivare al cliente. Altrimenti `scartata`. Una richiesta e un fatto si legano una
 * volta sola: il secondo legame uguale si scarta (l'indice unico `context_need_links_fact_unique`).
 *
 * Modulo puro: la conferma (src/lib/db/queries/context-proposals.ts) gli passa i legami e i fatti che ha scritto.
 */
import { needLinkAfterConfirm } from "../work/need-links.ts";
import type { ContextVisibility } from "../vocab.ts";

/** Un legame `proposta` di una proposta che si sta confermando. `needOpen`: la richiesta è ancora aperta, adesso. */
export interface ProposedNeedLink {
  id: string;
  proposalId: string;
  needId: string;
  needOpen: boolean;
}

/** Il fatto in cui la conferma ha trasformato una proposta: chi lo vede, e se resta attivo dopo la conferma. */
export interface ConfirmedFact {
  factId: string;
  visibility: ContextVisibility;
  active: boolean;
}

export interface NeedLinkOutcome {
  id: string;
  status: "aperta" | "scartata";
  /** Solo per un legame aperto. */
  fact_id: string | null;
}

/** Lo stato di ogni legame, nell'ordine dato. `factOf`: il fatto di una proposta confermata, o null (scartata, non un fatto). */
export function planNeedLinks(links: readonly ProposedNeedLink[], factOf: (proposalId: string) => ConfirmedFact | null): NeedLinkOutcome[] {
  const linked = new Set<string>();
  return links.map((link) => {
    const fact = factOf(link.proposalId);
    let status: "aperta" | "scartata" = fact && fact.active ? needLinkAfterConfirm({ factVisibility: fact.visibility, needOpen: link.needOpen === true }) : "scartata";
    const pair = fact ? `${link.needId}:${fact.factId}` : "";
    if (status === "aperta" && linked.has(pair)) status = "scartata";
    if (status === "aperta") linked.add(pair);
    return { id: link.id, status, fact_id: status === "aperta" && fact ? fact.factId : null };
  });
}
