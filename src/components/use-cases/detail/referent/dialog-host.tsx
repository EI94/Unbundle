"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { UseCaseReferentPanel } from "@/lib/use-cases/referent/contract";
import { ReferentDialogs, type ReferentDialog } from "./dialogs";

/** Apre una finestra di «Chiedi al referente»; null fuori dalla scheda o senza la funzione. */
type OpenReferentDialog = (dialog: ReferentDialog) => void;

const ReferentDialogContext = createContext<OpenReferentDialog | null>(null);

/** La funzione che apre le finestre di «Chiedi al referente» della scheda; null senza. */
export function useReferentDialog(): OpenReferentDialog | null {
  return useContext(ReferentDialogContext);
}

export interface ReferentDialogHostProps {
  workspaceId: string;
  useCaseId: string;
  /** `loadUseCaseReferentPanel`: le finestre ci sono solo con la funzione accesa. */
  panel: UseCaseReferentPanel | null;
  /** `canEditNeeds`: chi non modifica non apre finestre. */
  canEdit: boolean;
  /** Id dell'esigenza in minuscolo → titolo, per le finestre. */
  needTitles: Readonly<Record<string, string>>;
  children: ReactNode;
}

/**
 * Le finestre di «Chiedi al referente» della scheda, una alla volta, per tutta la pagina: le apre
 * il riquadro «Prossimo passo» («Chiedi al referente»), le righe e le richieste di «Cosa serve».
 * Chiusa la finestra, il fuoco torna al controllo che l'ha aperta.
 */
export function ReferentDialogHost({ workspaceId, useCaseId, panel, canEdit, needTitles, children }: ReferentDialogHostProps) {
  const [dialog, setDialog] = useState<ReferentDialog | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const feature = canEdit && panel?.available ? panel : null;
  const open = useCallback<OpenReferentDialog>((next) => {
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDialog(next);
  }, []);
  const close = useCallback(() => {
    setDialog(null);
    const back = trigger.current;
    trigger.current = null;
    // Dopo la chiusura della finestra (che rimette il fuoco dove vuole), al controllo di partenza.
    if (back) requestAnimationFrame(() => (back.isConnected ? back.focus({ preventScroll: true }) : undefined));
  }, []);
  const value = useMemo(() => (feature ? open : null), [feature, open]);
  const titles = useMemo(() => new Map(Object.entries(needTitles)), [needTitles]);
  return (
    <ReferentDialogContext value={value}>
      {children}
      {feature ? <ReferentDialogs dialog={dialog} workspaceId={workspaceId} useCaseId={useCaseId} panel={feature} needTitles={titles} onClose={close} /> : null}
    </ReferentDialogContext>
  );
}
