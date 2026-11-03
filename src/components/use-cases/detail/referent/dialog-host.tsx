"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { ReferentMemberOption, UseCaseReferentPanel } from "@/lib/use-cases/referent/contract";
import type { AskNeedInfo, AskSession } from "./ask-steps-state";
import type { AssignContext } from "./assign-dialog";
import { ReferentDialogs, type ReferentDialog } from "./dialogs";

/** Apre una finestra di «Chiedi al referente»; null fuori dalla scheda o senza la funzione. */
type OpenReferentDialog = (dialog: ReferentDialog) => void;

const ReferentDialogContext = createContext<OpenReferentDialog | null>(null);

/** La funzione che apre le finestre di «Chiedi al referente» della scheda; null senza. */
export function useReferentDialog(): OpenReferentDialog | null {
  return useContext(ReferentDialogContext);
}

/** Il titolo di «Cosa serve» (`section-needs.tsx`, tabIndex -1): il fuoco ci va quando il pulsante di partenza non c'è più. */
export const COSA_SERVE_HEADING_ID = "cosa-serve-titolo";
/** (Rilascio 5) Il titolo del blocco «Referente»: il fuoco ci va quando il pulsante di partenza non c'è più. */
export const REFERENT_HEADING_ID = "referente-titolo";

export interface ReferentDialogHostProps {
  workspaceId: string;
  useCaseId: string;
  /** `loadUseCaseReferentPanel`: le finestre ci sono solo con la funzione accesa. */
  panel: UseCaseReferentPanel | null;
  /** `canEditNeeds`: chi non modifica non apre finestre. */
  canEdit: boolean;
  /** Id dell'esigenza in minuscolo → titolo, «Chi» come lo mostra la scheda e testo libero «Chi». */
  needInfo: Readonly<Record<string, AskNeedInfo>>;
  /** Lo use case della scheda: codice e titolo, per l'anteprima dell'email. */
  card: { code: string | null; title: string };
  /** Il nome del workspace. */
  companyName: string | null;
  /** Il nome del cliente del connettore, per le parole dell'azienda della proposta delle domande. */
  companyDisplayName: string | null;
  /** (Rilascio 5) La descrizione e la stima del team come le vede il referente, per «Cosa riceve {Nome}». */
  assign?: AssignContext;
  children: ReactNode;
}

/**
 * Le finestre di «Chiedi al referente» della scheda, una alla volta, per tutta la pagina: le apre
 * il riquadro «Prossimo passo» («Chiedi al referente»), le righe e le richieste di «Cosa serve».
 * Chiusa la finestra, il fuoco torna al controllo che l'ha aperta; se non c'è più (dopo l'ok sui
 * fornitori la riga perde il pulsante), al titolo di «Cosa serve». (Rilascio 4) La bozza di «Chiedi al
 * referente» chiusa senza inviare resta per la vita della pagina (solo qui, mai nel browser) e
 * l'ultimo elenco delle persone del workspace serve mentre arriva di nuovo.
 */
const NO_ASSIGN: AssignContext = Object.freeze({ description: Object.freeze({ text: null, dropped: 0 }), team: null });

export function ReferentDialogHost({ workspaceId, useCaseId, panel, canEdit, needInfo, card, companyName, companyDisplayName, assign = NO_ASSIGN, children }: ReferentDialogHostProps) {
  const [dialog, setDialog] = useState<ReferentDialog | null>(null);
  const [saved, setSaved] = useState<AskSession | null>(null);
  const [peopleCache, setPeopleCache] = useState<readonly ReferentMemberOption[] | null>(null);
  const trigger = useRef<{ element: HTMLElement | null; ask: boolean }>({ element: null, ask: false });
  const feature = canEdit && panel?.available ? panel : null;
  const open = useCallback<OpenReferentDialog>((next) => {
    trigger.current = { element: document.activeElement instanceof HTMLElement ? document.activeElement : null, ask: next.kind === "ask" || next.kind === "again" || next.kind === "assign" || next.kind === "other" };
    setDialog(next);
  }, []);
  const close = useCallback(() => {
    setDialog(null);
    const { element: back, ask } = trigger.current;
    trigger.current = { element: null, ask: false };
    // Dopo la chiusura della finestra (che rimette il fuoco dove vuole), al controllo di partenza; per
    // «Chiedi al referente», se il pulsante non c'è più, al titolo di «Cosa serve» (mai sul fondo della pagina).
    requestAnimationFrame(() => {
      if (back?.isConnected) back.focus({ preventScroll: true });
      else if (ask) (document.getElementById(REFERENT_HEADING_ID) ?? document.getElementById(COSA_SERVE_HEADING_ID))?.focus({ preventScroll: true });
    });
  }, []);
  const onPeople = useCallback((members: readonly ReferentMemberOption[]) => setPeopleCache(members), []);
  const value = useMemo(() => (feature ? open : null), [feature, open]);
  const titles = useMemo(() => new Map(Object.entries(needInfo).map(([id, info]) => [id, info.title])), [needInfo]);
  const ask = { needInfo, card, companyName, companyDisplayName, saved, peopleCache, onPeople, onKeep: setSaved, assign };
  return (
    <ReferentDialogContext value={value}>
      {children}
      {feature ? <ReferentDialogs dialog={dialog} workspaceId={workspaceId} useCaseId={useCaseId} panel={feature} needTitles={titles} ask={ask} onClose={close} /> : null}
    </ReferentDialogContext>
  );
}
