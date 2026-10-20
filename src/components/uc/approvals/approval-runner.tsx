"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ApprovalStep as ApprovalStepView } from "@/lib/uc/views/approvals";
import type { CaseRole } from "@/lib/uc/vocab";
import { ApprovalStep, approvalBodyClass, approvalButtonClass, type StepResult } from "./approval-step";
import { APPROVAL_TEXT, approvalKey, listIntro, nextLabel, startLabel, type ApprovalDecision, type ApprovalVariant } from "./approval-texts";

/**
 * Le firme di chi guarda (DESIGN §4.5, §3.11), con lo stesso componente sul
 * link di approvazione (`/r`, tramite `referente/approvals-view.tsx`) e nella
 * pagina `/firme` del dossier: prima l'elenco (A1), poi una decisione alla volta
 * («1 di 3», A2), poi «Avanti · 2 di 3» e alla fine «Hai firmato tutto. Grazie!».
 *
 * L'elenco del giro si fissa quando si inizia: dopo ogni firma chi ospita il
 * componente ricarica le firme in attesa (quella firmata sparisce), ma il
 * conteggio del giro resta lo stesso. Senza portali e senza toast.
 */

export interface ApprovalOutcome {
  ok: boolean;
  message: string;
}

export interface ApprovalRunnerProps {
  approvals: readonly ApprovalStepView[];
  onDecide: (approval: ApprovalStepView, decision: ApprovalDecision, reason?: string) => Promise<ApprovalOutcome>;
  /** In sola lettura (caso in pausa, link non scrivibile): si legge, non si firma. */
  disabled?: boolean;
  /** Misure di chi legge: del cliente sul link e su `/firme` (`approvalVariantFor`), di Lateral Space altrimenti. */
  variant?: ApprovalVariant;
  /** Livello del titolo di ogni decisione: 2 sul link, 3 sotto il titolo della pagina `/firme`. */
  headingLevel?: 2 | 3;
  /** Testo quando non c'è nulla da firmare. */
  empty?: string;
  /** Ruoli di chi guarda in `/firme`, per «Dettagli tecnici» (solo Lateral Space). */
  technicalRoles?: readonly CaseRole[];
}

interface Walk {
  queue: ApprovalStepView[];
  index: number;
}

export function ApprovalRunner({ approvals, onDecide, disabled = false, variant = "cliente", headingLevel = 2, empty = APPROVAL_TEXT.emptyLink, technicalRoles }: ApprovalRunnerProps) {
  const [walk, setWalk] = useState<Walk | null>(null);
  const [results, setResults] = useState<Record<string, StepResult>>({});
  const introRef = useRef<HTMLDivElement>(null);
  const backToList = useRef(false);
  const body = approvalBodyClass(variant);

  const signed = (a: ApprovalStepView) => results[approvalKey(a)]?.ok === true;
  const pending = approvals.filter((a) => !signed(a));

  // Tornando all'elenco il focus va alla sua prima riga di testo.
  useEffect(() => {
    if (walk === null && backToList.current) {
      backToList.current = false;
      introRef.current?.focus();
    }
  }, [walk]);

  function start(index: number) {
    setWalk({ queue: [...pending], index });
  }

  function openList() {
    backToList.current = true;
    setWalk(null);
  }

  if (walk) {
    const snapshot = walk.queue[walk.index];
    const key = approvalKey(snapshot);
    // Testi aggiornati se la firma è ancora in attesa (un testo cambiato si rilegge); altrimenti quelli del giro.
    const current = approvals.find((a) => approvalKey(a) === key) ?? snapshot;
    const result = results[key] ?? null;
    const nextIndex = walk.queue.findIndex((a, i) => i > walk.index && !signed(a));
    const othersLeft = approvals.some((a) => approvalKey(a) !== key && !signed(a));
    const allApproved = Object.values(results).every((r) => !r.ok || r.decision === "approvo");

    async function decide(decision: ApprovalDecision, reason?: string) {
      let outcome: ApprovalOutcome;
      try {
        outcome = await onDecide(current, decision, reason);
      } catch {
        outcome = { ok: false, message: APPROVAL_TEXT.failed };
      }
      setResults((r) => ({ ...r, [key]: { ok: outcome.ok, message: outcome.message, decision } }));
    }

    const after =
      nextIndex >= 0 ? (
        <Button type="button" className={approvalButtonClass(variant, "primary")} onClick={() => setWalk({ queue: walk.queue, index: nextIndex })}>
          {nextLabel(nextIndex, walk.queue.length)}
        </Button>
      ) : othersLeft ? (
        <Button type="button" variant="outline" className={approvalButtonClass(variant, "secondary")} onClick={openList}>
          {APPROVAL_TEXT.backToListAction}
        </Button>
      ) : (
        <p className="font-medium">{allApproved ? APPROVAL_TEXT.allSigned : APPROVAL_TEXT.allDecided}</p>
      );

    return (
      <div className="min-w-0">
        <ApprovalStep
          key={key}
          approval={current}
          index={walk.index}
          total={walk.queue.length}
          variant={variant}
          headingLevel={headingLevel}
          disabled={disabled}
          result={result}
          onDecide={decide}
          onBack={openList}
          after={after}
          technicalRoles={technicalRoles}
        />
      </div>
    );
  }

  const decidedHere = Object.values(results).filter((r) => r.ok);
  if (pending.length === 0) {
    if (decidedHere.length > 0) {
      const allSigned = decidedHere.every((r) => r.decision === "approvo");
      return (
        <div ref={introRef} tabIndex={-1} role="status" className={cn("flex min-w-0 items-start gap-2 outline-none", body)}>
          {allSigned ? <CheckCircle2 className="mt-1 size-4 shrink-0 text-uc-verde" aria-hidden /> : null}
          <p className="font-medium">{allSigned ? APPROVAL_TEXT.allSigned : APPROVAL_TEXT.allDecided}</p>
        </div>
      );
    }
    return (
      <div ref={introRef} tabIndex={-1} className={cn("rounded-xl border border-dashed border-border px-4 py-5 break-words text-muted-foreground outline-none", body)}>
        {empty}
      </div>
    );
  }

  const intro = listIntro(pending.length);
  return (
    <section data-slot="approval-list" aria-label={APPROVAL_TEXT.listLabel} className={cn("min-w-0 space-y-4", body)}>
      <div ref={introRef} tabIndex={-1} className="space-y-1 outline-none">
        <p className="font-medium break-words">{intro.lead}</p>
        <p className="break-words text-muted-foreground">{intro.calm}</p>
      </div>
      <ul className="divide-y overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        {pending.map((a, i) => (
          <li key={approvalKey(a)}>
            <button
              type="button"
              onClick={() => start(i)}
              className="group flex min-h-11 w-full min-w-0 items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset"
            >
              <span className="min-w-0 flex-1">
                <span className="block font-medium break-words">{a.title}</span>
                {a.summary ? <span className="mt-0.5 block break-words text-muted-foreground">{a.summary}</span> : null}
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <Button type="button" className={approvalButtonClass(variant, "primary")} onClick={() => start(0)}>
        {startLabel(pending.length)}
      </Button>
    </section>
  );
}
