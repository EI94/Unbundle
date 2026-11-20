/**
 * «Mappatura board»: le props dei cinque componenti d'ingresso (docs/mappatura/MAPPATURA-BOARD-PIANO.md §4.10).
 *
 * Le due pagine della mappatura (delle fondamenta) leggono i dati e montano questi componenti; ognuno appartiene al suo
 * pacchetto (§9): `UnitBoard` alle viste della board, `Companion`, `ClassificationView` e `CompleteButton` al
 * compagno. (Rilascio 10, §3.7) L'elenco delle unità è la vista «Processi» di «Contesto» (`ProcessesView`). I due pacchetti si incontrano solo qui, nei file delle fondamenta e negli slot di
 * `UnitBoardProps`: una firma cambia solo passando dall'integratore.
 *
 * Solo tipi.
 */
import type { ReactNode } from "react";
import type { UnitTerm } from "../../lib/utils/unit-terminology.ts";
import type { ChatConsent } from "../agent/chat-consent.ts";

/**
 * La board di un'unità (S2): testata, schede, pillola, «Processi di oggi» con il drawer del passo, posto e stato del
 * pannello dell'assistente. La board la legge da `useBoard` (dentro `BoardProvider`, che monta la pagina).
 */
export interface UnitBoardProps {
  workspaceId: string;
  workspaceName: string;
  unitTerm: UnitTerm;
  /** Il pannello dell'assistente aperto alla prima apertura: con `?mode=chat`, o finché l'unità non ha un passo. */
  assistantDefaultOpen: boolean;
  /** `<Companion … />` (compagno). */
  assistant: ReactNode;
  /** `<ClassificationView … />` (compagno): la scheda «Classificazione». */
  classification: ReactNode;
  /** `<CompleteButton … />` (compagno): l'unico bottone pieno, a destra della testa della vista. */
  headAction: ReactNode;
  /** (Rilascio 10, §8.2) `?apri=<passo>`: il drawer di quel passo, aperto all'arrivo nella scheda dell'indirizzo. */
  initialStep?: string | null;
}

/** L'assistente accanto alla board: la chat, i documenti, i passi proposti dai documenti. */
export interface CompanionProps {
  workspaceId: string;
  departmentId: string;
  unitName: string;
  teamSize: number | null;
  initialMessages: Array<{ id: string; role: "user" | "assistant"; content: string }>;
  hasDocuments: boolean;
  /**
   * (Rilascio 9a) Lo stato di partenza dell'ok ai sub-responsabili (src/components/agent/chat-consent.ts), come per la
   * chat di Discovery; poi lo chiede l'assistente al montaggio.
   */
  initialConsent?: ChatConsent;
}

/**
 * La scheda «Con l'AI» (prima «Classificazione»): legge la board con `useBoard`. `useCaseHub`: l'area «Use case» è accesa
 * nel workspace. (Rilascio 10, §3.7) `lateralSpace`: chi guarda è di Lateral Space, e vede i «Dettagli tecnici» (O*NET,
 * esposizione all'AI, affidabilità).
 */
export interface ClassificationViewProps {
  workspaceId: string;
  useCaseHub: boolean;
  lateralSpace?: boolean;
}

/** «Completa la mappatura» e «Classifica {n} passi»: legge la board con `useBoard`, scrive con `replace`. */
export interface CompleteButtonProps {
  workspaceId: string;
  departmentId: string;
}
