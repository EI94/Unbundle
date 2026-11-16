"use client";

/**
 * «Mappatura board»: la scheda «Classificazione», S2b (docs/mappatura/MAPPATURA-BOARD-PIANO.md §1.4, §4.10).
 *
 * Nasce con le fondamenta come stub, con le props del contratto (`ClassificationViewProps`): non disegna niente. Da qui
 * il file è del pacchetto del compagno (§9.3): la stessa mappa colorata per stream, il drawer che confronta, il
 * selettore dello stream per chi rivede, gli use case nati dalla mappatura.
 */
import type { JSX } from "react";
import type { ClassificationViewProps } from "../contracts.ts";

export function ClassificationView(props: ClassificationViewProps): JSX.Element | null {
  void props;
  return null;
}
