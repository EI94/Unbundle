"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TechDetails } from "@/components/uc/ui/tech-details";
import { cn } from "@/lib/utils";
import type { ApprovalStep as ApprovalStepView } from "@/lib/uc/views/approvals";
import type { CaseRole } from "@/lib/uc/vocab";
import { APPROVAL_TEXT, approvalDocumentTitle, notRejectableText, otherSideText, stepCounter, type ApprovalDecision, type ApprovalVariant } from "./approval-texts";

/**
 * Una decisione alla volta (DESIGN §4.5, A2), la stessa sul link di
 * approvazione e su `/firme`: titolo, testo canonico su sfondo tenue,
 * «Dettagli», la riga sull'altra firma, poi «Ho letto e approvo» e, solo dove
 * si può, «Non approvo» con il motivo. Dopo la scelta restano l'esito
 * (`role=status`) e il seguito. Niente portali: su `/r` non ci sono.
 *
 * Il server riceve sempre `read: true` e l'impronta del testo mostrato: il
 * pulsante dice già «Ho letto».
 */

export type { ApprovalVariant };

export interface StepResult {
  ok: boolean;
  message: string;
  decision: ApprovalDecision;
}

/** Classi dei pulsanti: 48 px per il cliente (§4.5, §4.7), 44 px per Lateral Space; al telefono tutta la larghezza. */
export function approvalButtonClass(variant: ApprovalVariant, kind: "primary" | "secondary" | "text"): string {
  if (kind === "text") return variant === "cliente" ? "h-auto min-h-11 px-2 text-base" : "h-auto min-h-11 px-2";
  const height = variant === "cliente" ? "h-12 text-base" : "h-11";
  return kind === "primary" ? `${height} w-full sm:w-auto sm:min-w-48` : `${height} w-full sm:w-auto`;
}

/** Corpo del testo: 16 px per il cliente (§4.7), 14 px per Lateral Space. */
export function approvalBodyClass(variant: ApprovalVariant): string {
  return variant === "cliente" ? "text-base leading-7" : "text-sm leading-6";
}

export interface ApprovalStepProps {
  approval: ApprovalStepView;
  index: number;
  total: number;
  variant: ApprovalVariant;
  headingLevel: 2 | 3;
  disabled: boolean;
  /** Esito dell'ultima scelta su questa decisione; con `ok` restano solo l'esito e il seguito. */
  result: StepResult | null;
  onDecide: (decision: ApprovalDecision, reason?: string) => Promise<void>;
  onBack: () => void;
  /** Dopo l'esito: il pulsante «Avanti · 2 di 3», oppure la chiusura. */
  after: React.ReactNode;
  /** Ruoli di chi guarda in `/firme`, per «Dettagli tecnici» (solo Lateral Space). */
  technicalRoles?: readonly CaseRole[];
}

export function ApprovalStep({ approval, index, total, variant, headingLevel, disabled, result, onDecide, onBack, after, technicalRoles }: ApprovalStepProps) {
  const id = useId();
  const titleId = `${id}-titolo`;
  const reasonId = `${id}-motivo`;
  const hintId = `${id}-motivo-aiuto`;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState(false);
  const [busy, setBusy] = useState(false);
  const done = result?.ok === true;
  const rejected = done && result.decision === "non_approvo";
  const body = approvalBodyClass(variant);
  const Heading = headingLevel === 2 ? "h2" : "h3";

  // A ogni passo il focus va al titolo e la scheda dice il passo (§4.7); dopo la scelta il focus va all'esito.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: false });
  }, []);
  useEffect(() => {
    const previous = document.title;
    document.title = approvalDocumentTitle(index, total, approval.title);
    return () => {
      document.title = previous;
    };
  }, [index, total, approval.title]);
  useEffect(() => {
    if (done) statusRef.current?.focus({ preventScroll: false });
  }, [done]);
  useEffect(() => {
    if (rejecting) reasonRef.current?.focus();
  }, [rejecting]);

  async function decide(decision: ApprovalDecision) {
    if (decision === "non_approvo" && reason.trim().length < 3) {
      setReasonError(true);
      reasonRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      await onDecide(decision, decision === "non_approvo" ? reason.trim() : undefined);
    } finally {
      setBusy(false);
    }
  }

  const locked = disabled || busy;

  return (
    <section data-slot="approval-step" aria-labelledby={titleId} aria-busy={busy || undefined} className={cn("min-w-0 space-y-4", body)}>
      <div className="flex min-w-0 items-center justify-between gap-3">
        <Button type="button" variant="ghost" className={cn(approvalButtonClass(variant, "text"), "-ml-2 text-muted-foreground")} onClick={onBack}>
          <ChevronLeft aria-hidden />
          {APPROVAL_TEXT.backToList}
        </Button>
        <p className="shrink-0 text-sm text-muted-foreground tabular-nums">{stepCounter(index, total)}</p>
      </div>

      <Heading
        id={titleId}
        ref={headingRef}
        tabIndex={-1}
        className={cn("break-words outline-none", variant === "cliente" ? "text-xl leading-7 font-semibold" : "text-lg font-semibold")}
      >
        {approval.title}
      </Heading>
      {approval.intro ? <p className="break-words">{approval.intro}</p> : null}

      <div className="min-w-0 space-y-1.5 rounded-lg bg-muted/60 px-3 py-2.5 break-words">
        {approval.lines.map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </div>

      {approval.details.length > 0 ? (
        <details className="group min-w-0">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-muted-foreground select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden />
            {APPROVAL_TEXT.details}
          </summary>
          <ul className="space-y-1 pb-1 pl-6 break-words text-muted-foreground">
            {approval.details.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {technicalRoles && approval.technical.length > 0 ? (
        <TechDetails roles={technicalRoles}>
          {approval.technical.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </TechDetails>
      ) : null}

      {/* Dopo la scelta l'esito dice già a che punto è la decisione: la riga sull'altra firma la ripeterebbe. */}
      {done ? null : <p className="break-words text-muted-foreground">{otherSideText(approval)}</p>}

      {done ? (
        <div className="space-y-4">
          <div
            ref={statusRef}
            tabIndex={-1}
            role="status"
            data-outcome={result.decision}
            className={cn("flex min-w-0 items-start gap-2 rounded-lg px-3 py-2.5 break-words outline-none", rejected ? "bg-muted" : "bg-uc-verde-bg")}
          >
            {/* Un «Non approvo» non è un successo: niente spunta verde, solo la frase. */}
            {rejected ? null : <CheckCircle2 className="mt-1 size-4 shrink-0 text-uc-verde" aria-hidden />}
            <span>{result.message}</span>
          </div>
          {after}
        </div>
      ) : (
        <div className="space-y-3">
          {result && !result.ok ? (
            <p role="alert" className="rounded-lg bg-uc-rosso-bg px-3 py-2.5 break-words text-uc-rosso">
              {result.message}
            </p>
          ) : null}
          {rejecting ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label htmlFor={reasonId} className="block font-medium">
                  {APPROVAL_TEXT.rejectReason}
                </label>
                <textarea
                  id={reasonId}
                  ref={reasonRef}
                  value={reason}
                  rows={3}
                  maxLength={500}
                  disabled={locked}
                  aria-invalid={reasonError || undefined}
                  aria-describedby={hintId}
                  onChange={(e) => {
                    setReason(e.target.value);
                    if (reasonError && e.target.value.trim().length >= 3) setReasonError(false);
                  }}
                  className="min-h-24 w-full min-w-0 rounded-lg border border-input bg-background px-3 py-2.5 text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-destructive"
                />
                <p id={hintId} className={cn("text-sm", reasonError ? "text-uc-rosso" : "text-muted-foreground")}>
                  {reasonError ? APPROVAL_TEXT.reasonTooShort : APPROVAL_TEXT.rejectHint}
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                <Button type="button" variant="destructive" className={approvalButtonClass(variant, "secondary")} disabled={locked} onClick={() => void decide("non_approvo")}>
                  {APPROVAL_TEXT.confirmReject}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className={approvalButtonClass(variant, "secondary")}
                  disabled={busy}
                  onClick={() => {
                    setRejecting(false);
                    setReasonError(false);
                  }}
                >
                  {APPROVAL_TEXT.cancel}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <Button type="button" className={approvalButtonClass(variant, "primary")} disabled={locked} onClick={() => void decide("approvo")}>
                {APPROVAL_TEXT.approve}
              </Button>
              {approval.canReject ? (
                <Button type="button" variant="ghost" className={approvalButtonClass(variant, "secondary")} disabled={locked} onClick={() => setRejecting(true)}>
                  {APPROVAL_TEXT.reject}
                </Button>
              ) : null}
            </div>
          )}
          {!approval.canReject ? <p className="break-words text-muted-foreground">{notRejectableText(approval.side)}</p> : null}
        </div>
      )}
    </section>
  );
}
