"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * (Ondata 0) Chi guarda il dossier è di Lateral Space? Lo dice il guscio del caso
 * (`casi-duso/[caseId]/layout.tsx`) ai componenti client sotto di sé, compresa la pagina d'errore del caso: il
 * codice di un errore lo vede solo Lateral Space. Fuori dal guscio vale «no».
 */
const LateralSpaceViewer = createContext(false);

export function LateralSpaceViewerProvider({ value, children }: { value: boolean; children: ReactNode }) {
  return <LateralSpaceViewer value={value}>{children}</LateralSpaceViewer>;
}

export function useLateralSpaceViewer(): boolean {
  return useContext(LateralSpaceViewer);
}
