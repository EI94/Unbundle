/**
 * Le due regole pure delle notifiche «Pronto da avviare» e «Autorizza i fornitori» (release
 * «notifiche», docs del rilascio 3).
 *
 * - `isReadyToStart`: uno use case «Da costruire», approvato e pianificato per un trimestre che non
 *   è «Più avanti» e non è passato, senza dossier né «in realizzazione», con ogni informazione del
 *   cliente «A posto» o «Non si applica» (oppure senza informazioni da chiedere al cliente), si può
 *   avviare: lo dice la campanella di Lateral Space, la fase resta una decisione di una persona.
 * - `waitsForSubprocessorsOk`: lo stesso use case approvato e pianificato (di qualunque tipo) ha
 *   ancora qualcosa da chiedere al cliente, ma senza l'«ok sui sub-responsabili» del cliente non si
 *   può chiedere niente: lo sanno le persone del cliente che possono darlo.
 * - `readinessInputsChanged`: una scrittura della scheda tocca una colonna che può cambiare la
 *   prima regola (stato, revisione, trimestre, tipo): solo allora il servizio rifà il controllo.
 *
 * La stessa regola in SQL è `readyNowSql` (`case-alerts/sql.ts`); la prova di parità sul database
 * le confronta su una matrice di schede.
 *
 * Modulo puro: import relativi `.ts`.
 */
import { INFO_DONE_STATUSES } from "../db/use-case-hub-referents-ddl.ts";
import type { NeedStatus } from "./needs.ts";
import { compareQuarters, isQuarterCode, nextQuarter, quarterOfDate } from "./quarter.ts";
import { ASKABLE_STATUSES } from "./referent/questions.ts";
import type { IsoDate, Phase, UseCaseKind } from "./types.ts";

/**
 * Che cosa vuol dire «Più avanti» per la regola: `trimestre_assente` è `target_quarter = NULL`, come
 * la pillola e `whenLabel`; `oltre_il_prossimo` conterebbe «Più avanti» anche i trimestri dopo il
 * prossimo, come le corsie della Panoramica (`lanes.ts`). Una sola costante, letta anche da
 * `readyNowSql`: se G9 del rilascio 3 sceglie le corsie, si cambia qui e la prova di parità resta.
 */
export const READINESS_LATER_RULE: "trimestre_assente" | "oltre_il_prossimo" = "trimestre_assente";

/** Gli stati che chiudono un'informazione del cliente: «A posto» e «Non si applica». */
export const READY_NEED_STATUSES: readonly NeedStatus[] = INFO_DONE_STATUSES;

export interface ReadinessInput {
  /** `kindOf(portfolio_kind)`. */
  kind: UseCaseKind;
  /** `phaseOfUseCase(...).phase`: «approvato» esclude già un dossier collegato e «in realizzazione». */
  phase: Phase;
  /** `use_cases.target_quarter` (`AAAA-Qn`) oppure null («Più avanti»). */
  targetQuarter: string | null;
  /** `clientSideNeeds(...)`: i requisiti del cliente collegati e non archiviati. */
  clientNeeds: readonly { status: NeedStatus | string }[];
  /** `romeToday(now)`. */
  today: IsoDate | string;
}

/** Il trimestre è pianificato: un codice valido, non passato e (con le corsie) non oltre il prossimo. */
export function isScheduledQuarter(targetQuarter: string | null, today: string): boolean {
  if (!isQuarterCode(targetQuarter)) return false;
  let current: string;
  try {
    current = quarterOfDate(today);
  } catch {
    return false;
  }
  if (compareQuarters(targetQuarter, current) < 0) return false;
  if (READINESS_LATER_RULE === "oltre_il_prossimo" && compareQuarters(targetQuarter, nextQuarter(current)) > 0) return false;
  return true;
}

const isDone = (status: string) => (READY_NEED_STATUSES as readonly string[]).includes(status);

/**
 * Pronto da avviare. Mirrors release 3's G9 (`isReadyToStart` in `src/lib/use-cases/guided.ts`,
 * stream unbundle-rifiniture): same inputs, same answer. At merge keep one and keep the parity test
 * (`readiness.integration.test.ts`, SQL against TypeScript). Nessuna informazione del cliente vuol
 * dire pronto; uno stato sconosciuto conta come non fatto.
 */
export function isReadyToStart(i: ReadinessInput): boolean {
  if (i.kind !== "da_costruire" || i.phase !== "approvato") return false;
  if (!isScheduledQuarter(i.targetQuarter, i.today)) return false;
  return i.clientNeeds.every((need) => isDone(need.status));
}

export interface SubprocessorsWaitInput {
  phase: Phase;
  targetQuarter: string | null;
  clientNeeds: readonly { status: NeedStatus | string }[];
  today: IsoDate | string;
  /** C'è l'«ok sui sub-responsabili» per la versione di adesso dell'elenco. */
  acknowledged: boolean;
}

/**
 * Il lavoro aspetta l'«ok sui sub-responsabili»: manca l'ok, lo use case è approvato e pianificato
 * (come sopra, di qualunque tipo) e almeno un'informazione del cliente è ancora da chiedere
 * («Non ancora chiesta», «Manca il dato», «Risposta parziale»).
 */
export function waitsForSubprocessorsOk(i: SubprocessorsWaitInput): boolean {
  if (i.acknowledged || i.phase !== "approvato") return false;
  if (!isScheduledQuarter(i.targetQuarter, i.today)) return false;
  return i.clientNeeds.some((need) => (ASKABLE_STATUSES as readonly string[]).includes(need.status));
}

/** Le colonne della scheda che la regola guarda (oltre a «Cosa serve» e al dossier). */
export interface ReadinessColumns {
  status: string | null;
  portfolioReviewStatus: string | null;
  targetQuarter: string | null;
  portfolioKind: string | null;
}

/** Una scrittura della scheda cambia almeno una colonna che la regola guarda. */
export function readinessInputsChanged(before: ReadinessColumns, after: ReadinessColumns): boolean {
  return (
    (before.status ?? null) !== (after.status ?? null) ||
    (before.portfolioReviewStatus ?? null) !== (after.portfolioReviewStatus ?? null) ||
    (before.targetQuarter ?? null) !== (after.targetQuarter ?? null) ||
    (before.portfolioKind ?? null) !== (after.portfolioKind ?? null)
  );
}
