"use client";

/**
 * «Mappatura board»: l'assistente accanto alla board, S2d (docs/mappatura/MAPPATURA-BOARD-PIANO.md §1.5, §4.10, §5).
 *
 * Nasce con le fondamenta come stub, con le props del contratto (`CompanionProps`): non disegna niente. Da qui il file
 * è del pacchetto del compagno (§9.3): la chat sulla board, i documenti, i passi proposti dai documenti, la rilettura
 * della board dopo ogni tool che ha salvato.
 */
import type { JSX } from "react";
import type { CompanionProps } from "../contracts.ts";

export function Companion(props: CompanionProps): JSX.Element | null {
  void props;
  return null;
}
