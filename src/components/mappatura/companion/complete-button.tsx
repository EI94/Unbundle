"use client";

/**
 * «Mappatura board»: «Completa la mappatura» e «Classifica {n} passi» (docs/mappatura/MAPPATURA-BOARD-PIANO.md §1.3,
 * §4.10, §7.3).
 *
 * Nasce con le fondamenta come stub, con le props del contratto (`CompleteButtonProps`): non disegna niente. Da qui il
 * file è del pacchetto del compagno (§9.3): l'unico bottone pieno della schermata, la chiamata a `…/complete`, la board
 * che torna e il toast.
 */
import type { JSX } from "react";
import type { CompleteButtonProps } from "../contracts.ts";

export function CompleteButton(props: CompleteButtonProps): JSX.Element | null {
  void props;
  return null;
}
