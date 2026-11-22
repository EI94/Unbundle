/**
 * «Mappatura board»: che cosa può fare chi guarda (docs/mappatura/MAPPATURA-BOARD-PIANO.md §6).
 *
 * I ruoli sono quelli di sempre: ogni collaboratore del workspace legge e modifica la mappatura e la completa; chi
 * segue solo un corso (`learner`) resta fuori; i revisori (`canReviewWorkspacePortfolio`) possono anche correggere lo
 * stream di un passo. Il ruolo arriva già riletto in questa richiesta: niente si salva in un token o in una sessione.
 *
 * Modulo puro: lo usano il server (`board-store.ts`, `board-access.ts`) e i test con Node.
 */
import { canReviewWorkspacePortfolio, isCollaboratorRole } from "../workspace-permissions.ts";

export interface BoardAbilities {
  /** Modificare processi, passi e note, e votare. */
  edit: boolean;
  /** Correggere lo stream di un passo, e riportare gli stream alla proposta. */
  setStream: boolean;
  /** «Completa la mappatura» e «Classifica N passi». */
  complete: boolean;
}

export const NO_BOARD_ABILITIES: BoardAbilities = Object.freeze({ edit: false, setStream: false, complete: false });

export function boardAbilities(role: string | null | undefined): BoardAbilities {
  // (8.0d) Per elenco: i cinque collaboratori. Chi segue un corso, «Solo questo use case» e un ruolo sconosciuto no.
  if (!isCollaboratorRole(role)) return NO_BOARD_ABILITIES;
  return { edit: true, setStream: canReviewWorkspacePortfolio(role), complete: true };
}
