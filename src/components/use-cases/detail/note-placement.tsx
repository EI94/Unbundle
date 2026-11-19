"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { navigationKey } from "./arrival";

/** Dove sta «Nota pubblica»: in vista dopo il percorso, oppure dentro «Dettagli». */
export type NotePlace = "vista" | "dettagli";

/** Il posto della nota per una navigazione (`navigationKey`). */
export interface NoteLanding {
  navigation: string;
  place: NotePlace;
}

/**
 * Il posto da tenere: quello di prima per la stessa navigazione, uno nuovo per una navigazione nuova. Come `landingFor`
 * di `Arrival`: la rilettura dopo il salvataggio della prima nota (in «Dettagli», all'uscita dal campo) direbbe «in
 * vista», ma il campo resta dov'è, con il suo «Salvata.», e la pagina non salta.
 */
export function notePlaceFor(previous: NoteLanding | null, navigation: string, place: NotePlace): NoteLanding {
  return previous !== null && previous.navigation === navigation ? previous : { navigation, place };
}

const NotePlaceContext = createContext<NotePlace>("dettagli");

/**
 * (Rilascio 10, §3.4) Decide una volta per navigazione dove sta «Nota pubblica» (`publicNoteInView` sul server); i due
 * posti sono due `NoteSlot`, e solo quello giusto rende la nota.
 */
export function NotePlacement({ inView, chapter = null, children }: { inView: boolean; chapter?: string | null; children: ReactNode }) {
  const navigation = navigationKey(usePathname(), chapter);
  const place: NotePlace = inView ? "vista" : "dettagli";
  const [stored, setStored] = useState<NoteLanding>(() => notePlaceFor(null, navigation, place));
  const landing = notePlaceFor(stored, navigation, place);
  if (landing !== stored) setStored(landing);
  return <NotePlaceContext value={landing.place}>{children}</NotePlaceContext>;
}

/** Uno dei due posti della nota: la rende solo se il posto della navigazione è il suo; in vista, in un riquadro. */
export function NoteSlot({ place, children }: { place: NotePlace; children: ReactNode }) {
  if (useContext(NotePlaceContext) !== place) return null;
  return place === "vista" ? (
    <div data-slot="nota-in-vista" className="rounded-xl border bg-card p-4">
      {children}
    </div>
  ) : (
    children
  );
}
