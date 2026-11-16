/**
 * «Mappatura board»: le props dei cinque componenti d'ingresso (docs/mappatura/MAPPATURA-BOARD-PIANO.md §4.10).
 *
 * Le due pagine della mappatura (delle fondamenta) leggono i dati e montano questi componenti; ognuno appartiene al suo
 * pacchetto (§9): `UnitBoard` e `UnitsView` alle viste della board, `Companion`, `ClassificationView` e
 * `CompleteButton` al compagno. I due pacchetti si incontrano solo qui, nei file delle fondamenta e negli slot di
 * `UnitBoardProps`: una firma cambia solo passando dall'integratore.
 *
 * Solo tipi.
 */
import type { ReactNode } from "react";
import type { UnitBoardSummary } from "../../lib/mappatura/board-model.ts";
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
}

/** L'elenco delle unità (S1): una riga per unità, i numeri prima. */
export interface UnitsViewProps {
  workspaceId: string;
  workspaceName: string;
  unitTerm: UnitTerm;
  units: UnitBoardSummary[];
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

/** La scheda «Classificazione»: legge la board con `useBoard`. `useCaseHub`: l'area «Use case» è accesa nel workspace. */
export interface ClassificationViewProps {
  workspaceId: string;
  useCaseHub: boolean;
}

/** «Completa la mappatura» e «Classifica {n} passi»: legge la board con `useBoard`, scrive con `replace`. */
export interface CompleteButtonProps {
  workspaceId: string;
  departmentId: string;
}
