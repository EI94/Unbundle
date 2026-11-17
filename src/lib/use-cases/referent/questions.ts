/**
 * Quali esigenze di «Cosa serve» si possono chiedere al referente e quali accettano una risposta o
 * un file del team (SPEC §2.1 `questions.ts`, §3.9).
 *
 * - **Da chiedere**: requisiti (non passi), non archiviati, collegati alla scheda, dalla parte del
 *   cliente o di nessuno o «Insieme», in stato «Non ancora chiesta», «Manca il dato» o «Risposta
 *   parziale»; (Parte 2) anche «Chiesta» quando l'ultima richiesta è senza risposta (`silentNeedIds`,
 *   calcolato sul server, mai preso dal client).
 * - **Con risposta del team**: requisiti non archiviati collegati alla scheda, in qualunque stato e
 *   da qualunque parte.
 *
 * Modulo puro.
 */
import { compareNeeds, type NeedStatus, type NeedView } from "../needs.ts";

export const ASKABLE_STATUSES = ["da_chiedere", "mancante", "parziale"] as const satisfies readonly NeedStatus[];
export const ASKABLE_SIDES = [null, "cliente", "insieme"] as const;

function linkedTo(need: Pick<NeedView, "useCaseIds">, useCaseId: string): boolean {
  const id = useCaseId.toLowerCase();
  return need.useCaseIds.some((linked) => linked.toLowerCase() === id);
}

/** Le esigenze della scheda da chiedere, nell'ordine della scheda (`compareNeeds`). */
export function askableNeeds(needs: readonly NeedView[], useCaseId: string, opts: { silentNeedIds?: ReadonlySet<string> } = {}): NeedView[] {
  const silent = opts.silentNeedIds ?? new Set<string>();
  return needs
    .filter(
      (need) =>
        need.type === "requisito" &&
        !need.archivedAt &&
        linkedTo(need, useCaseId) &&
        (ASKABLE_SIDES as readonly (string | null)[]).includes(need.ownerSide ?? null) &&
        ((ASKABLE_STATUSES as readonly string[]).includes(need.status) || (need.status === "chiesta" && silent.has(need.id.toLowerCase()))),
    )
    .slice()
    .sort(compareNeeds);
}

/** Le esigenze della scheda che accettano una risposta o un file del team. */
export function answerableNeeds(needs: readonly NeedView[], useCaseId: string): NeedView[] {
  return needs
    .filter((need) => need.type === "requisito" && !need.archivedAt && linkedTo(need, useCaseId))
    .slice()
    .sort(compareNeeds);
}

/**
 * («File da compilare») Gli stati in cui un'esigenza accetta un file da compilare: ancora da chiedere, chiesta,
 * mancante o parziale. Il file non cambia lo stato: resta «Da chiedere» o «Chiesta».
 */
export const TEMPLATE_NEED_STATUSES = ["da_chiedere", "chiesta", "mancante", "parziale"] as const satisfies readonly NeedStatus[];

/**
 * («File da compilare») Le esigenze della scheda a cui legare un file da compilare, nell'ordine della scheda:
 * requisiti collegati e non archiviati, dalla parte del cliente, «Insieme» o di nessuno, in `TEMPLATE_NEED_STATUSES`.
 * Il server ricontrolla le stesse regole (`templateNeedSql` in `queries/use-case-template-files.ts`).
 */
export function templateNeeds(needs: readonly NeedView[], useCaseId: string): NeedView[] {
  return needs
    .filter(
      (need) =>
        need.type === "requisito" &&
        !need.archivedAt &&
        linkedTo(need, useCaseId) &&
        (ASKABLE_SIDES as readonly (string | null)[]).includes(need.ownerSide ?? null) &&
        (TEMPLATE_NEED_STATUSES as readonly string[]).includes(need.status),
    )
    .slice()
    .sort(compareNeeds);
}
