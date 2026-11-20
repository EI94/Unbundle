"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { SURVEY_TEXT } from "@/lib/public/survey";
import { cn } from "@/lib/utils";
import { PUBLIC_SECONDARY } from "@/components/public/classes";
import { Button } from "@/components/ui/button";

/**
 * Le azioni di «I tuoi dati» sul link personale del questionario (`/privacy/ai-readiness/<token>`). (Rilascio 10, ondata
 * 4, PROPOSTA-10 §3.11, audit Fuori §3.8 AR-19) «Scarica una copia»; «Ritira il consenso al confronto», con quello che
 * cambia, solo se il consenso è stato dato; «Cancella le mie risposte» con una conferma nella pagina (mai
 * `window.confirm`, niente parola da scrivere): la conferma manda alla rotta di sempre il valore che prima si scriveva a
 * mano. Aperta la conferma il fuoco va alla domanda; con «Annulla» torna a «Cancella le mie risposte». Le rotte non
 * cambiano.
 */
export function RespondentPrivacyControls({ token, benchmarkGiven }: { token: string; benchmarkGiven: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const questionRef = useRef<HTMLParagraphElement>(null);
  const eraseRef = useRef<HTMLButtonElement>(null);
  // Il fuoco segue la conferma, ma non al primo disegno della pagina.
  const moved = useRef(false);
  useEffect(() => {
    if (!moved.current) return;
    (confirming ? questionRef.current : eraseRef.current)?.focus();
  }, [confirming]);
  const toggle = (next: boolean) => {
    moved.current = true;
    setConfirming(next);
  };
  return (
    <RespondentPrivacyActions
      token={token}
      benchmarkGiven={benchmarkGiven}
      confirming={confirming}
      onAsk={() => toggle(true)}
      onCancel={() => toggle(false)}
      questionRef={questionRef}
      eraseRef={eraseRef}
    />
  );
}

/** Le azioni, senza stato: `confirming` dice se la conferma della cancellazione è aperta. */
export function RespondentPrivacyActions({
  token,
  benchmarkGiven,
  confirming,
  onAsk,
  onCancel,
  questionRef,
  eraseRef,
}: {
  token: string;
  benchmarkGiven: boolean;
  confirming: boolean;
  onAsk: () => void;
  onCancel: () => void;
  questionRef?: RefObject<HTMLParagraphElement | null>;
  eraseRef?: RefObject<HTMLButtonElement | null>;
}) {
  const D = SURVEY_TEXT.data;
  const base = `/api/ai-readiness/respondents/${token}`;
  return (
    <div className="space-y-3" data-testid="privacy-actions">
      <Button variant="outline" className={PUBLIC_SECONDARY} render={<a href={`${base}/export`} />} nativeButton={false}>
        {D.download}
      </Button>
      {benchmarkGiven ? (
        <form action={`${base}/benchmark-consent`} method="post" className="space-y-1.5">
          <Button type="submit" variant="outline" className={PUBLIC_SECONDARY} aria-describedby="confronto-nota">
            {D.withdraw}
          </Button>
          <p id="confronto-nota" className="text-sm text-muted-foreground">
            {D.withdrawNote}
          </p>
        </form>
      ) : null}
      {confirming ? (
        <div className="space-y-3 rounded-xl bg-destructive/10 p-4" role="group" aria-labelledby="cancella-domanda">
          <p id="cancella-domanda" ref={questionRef} tabIndex={-1} className="outline-none">
            {D.eraseAsk}
          </p>
          <form action={`${base}/anonymize`} method="post" className="space-y-2">
            {/* La rotta vuole la conferma che prima si scriveva a mano: la dà questo tocco. */}
            <input type="hidden" name="confirmation" value="ANONIMIZZA" />
            <Button type="submit" variant="destructive" className={PUBLIC_SECONDARY}>
              {D.eraseConfirm}
            </Button>
            <Button type="button" variant="ghost" className={PUBLIC_SECONDARY} onClick={onCancel}>
              {D.cancel}
            </Button>
          </form>
        </div>
      ) : (
        <Button ref={eraseRef} type="button" variant="ghost" className={cn(PUBLIC_SECONDARY, "text-destructive")} onClick={onAsk} data-testid="privacy-erase">
          {D.erase}
        </Button>
      )}
    </div>
  );
}
