"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { DecisionItem, DuplicateCandidate } from "@/lib/use-cases/decision-ui";
import type { NextStep } from "@/lib/use-cases/guided";
import { cn } from "@/lib/utils";
import { DecisionButtons, MarkInProgressButton } from "../decision-buttons";
import { InPageLink } from "./arrival";
import { useReferentDialog } from "./referent/dialog-host";

// ─── Un solo pulsante pieno per pagina ───────────────────────────────

interface PagePrimary {
  /** Un altro pezzo della pagina ha adesso il pulsante pieno (il modulo «Modifica valutazione»). */
  claimed: boolean;
  /** Lo prende; la funzione restituita lo lascia. */
  claim: () => () => void;
}

const PagePrimaryContext = createContext<PagePrimary | null>(null);

/**
 * Il pulsante pieno della scheda: uno solo. Il riquadro «Prossimo passo» lo ha finché un altro
 * pezzo della pagina non lo prende (il modulo «Modifica valutazione», con il suo «Salva la
 * valutazione»): allora il pulsante del riquadro si mostra `outline`.
 */
export function PagePrimaryProvider({ children }: { children: ReactNode }) {
  const [claims, setClaims] = useState(0);
  const claim = useCallback(() => {
    setClaims((n) => n + 1);
    return () => setClaims((n) => Math.max(0, n - 1));
  }, []);
  const value = useMemo(() => ({ claimed: claims > 0, claim }), [claims, claim]);
  return <PagePrimaryContext value={value}>{children}</PagePrimaryContext>;
}

/** Il pezzo che lo chiama prende il pulsante pieno della pagina finché è montato. */
export function usePagePrimaryClaim(): void {
  const claim = useContext(PagePrimaryContext)?.claim;
  useEffect(() => claim?.(), [claim]);
}

function usePagePrimaryClaimed(): boolean {
  return useContext(PagePrimaryContext)?.claimed ?? false;
}

// ─── Il riquadro ─────────────────────────────────────────────────────

/** Gli id del riquadro: il titolo (per le ancore) e la riga (per «Prepara le domande» quando la riga è il motivo). */
export const NEXT_STEP_IDS = Object.freeze({ section: "decisione", heading: "prossimo-passo-titolo", line: "prossimo-passo-riga" });

export interface NextStepBoxProps {
  workspaceId: string;
  /** `nextStepOf(...)`, sul server. */
  step: NextStep;
  /** Le parti delle decisioni (`toDecisionItem`), non la scheda intera. */
  item: DecisionItem;
  today: string;
  canDecide: boolean;
  candidates?: readonly DuplicateCandidate[];
  /** «Segna come in realizzazione»: solo Lateral Space con la sezione Casi d'uso spenta. */
  canMarkInProgress: boolean;
  className?: string;
}

/**
 * «Prossimo passo» (rilascio 3): sotto il percorso, il passo da fare, chi lo fa e l'azione. Il
 * pulsante principale è pieno solo quando il passo è di chi guarda (`step.mine`) e nessun altro
 * pezzo della pagina ha il pulsante pieno; altrimenti `outline`. Le decisioni seguono
 * `decisionLayout`: in «Da valutare» le principali in riga, altrimenti nel menu «⋯ Altre
 * decisioni». Con al massimo due controlli il riquadro sta su una riga dai 42rem della scheda.
 */
export function NextStepBox({ workspaceId, step, item, today, canDecide, candidates, canMarkInProgress, className }: NextStepBoxProps) {
  const claimed = usePagePrimaryClaimed();
  const openReferent = useReferentDialog();
  const filled = step.mine && !claimed;
  const variant = filled ? "default" : "outline";
  const action = step.action;
  const touch = "min-h-11 sm:min-h-8";
  let primary: ReactNode = null;
  switch (action.type) {
    case "chiedi":
      primary = openReferent ? (
        <Button type="button" variant={variant} className={touch} onClick={() => openReferent({ kind: "ask" })}>
          {action.label}
        </Button>
      ) : null;
      break;
    case "impostazioni":
    case "avvia":
      primary = (
        <Button render={<Link href={action.href} />} nativeButton={false} variant={variant} className={touch}>
          {action.label}
        </Button>
      );
      break;
    case "vai":
      primary = (
        <Button render={<InPageLink id={action.id} />} nativeButton={false} variant={variant} className={touch}>
          {action.label}
        </Button>
      );
      break;
    case "segna_in_realizzazione":
      primary = (
        <MarkInProgressButton
          workspaceId={workspaceId}
          item={{ id: item.id, code: item.code, version: item.version, phase: item.phase, kind: item.kind, dossier: item.dossier }}
          canMarkInProgress={canMarkInProgress}
          dossiersEnabled={false}
          variant={variant}
        />
      );
      break;
    case "dossier":
      primary = (
        <Button render={<Link href={action.href} />} nativeButton={false} variant={action.variant === "default" && filled ? "default" : "outline"} className={touch}>
          {action.label}
        </Button>
      );
      break;
    default:
      primary = null;
  }
  const decisions =
    step.decisions === "none" ? null : (
      <DecisionButtons
        workspaceId={workspaceId}
        item={item}
        today={today}
        canDecide={canDecide}
        candidates={candidates}
        primaryVariant={action.type === "decisione" && filled ? "default" : "outline"}
        outlineInMenu={step.decisions === "compact"}
      />
    );
  // In riga solo con al massimo due controlli (il pulsante principale e «⋯»): le decisioni «full» vanno sotto il testo.
  const inRow = step.decisions !== "full";
  return (
    <section
      id={NEXT_STEP_IDS.section}
      aria-labelledby={NEXT_STEP_IDS.heading}
      data-slot="next-step"
      data-key={step.key}
      className={cn("flex scroll-mt-20 flex-col gap-3 rounded-xl border bg-card p-4", inRow && "@2xl/scheda:flex-row @2xl/scheda:items-center @2xl/scheda:justify-between", className)}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <h2 id={NEXT_STEP_IDS.heading} tabIndex={-1} className="text-sm font-semibold outline-none">
          {step.heading}
        </h2>
        <p className="text-base font-medium break-words">{step.title}</p>
        {step.line ? (
          <p id={NEXT_STEP_IDS.line} role={step.gate ? "status" : undefined} data-gate={step.gate ?? undefined} className="text-sm break-words text-muted-foreground">
            {step.line}
          </p>
        ) : null}
        {step.link ? <InPageLink id={step.link.id}>{step.link.label}</InPageLink> : null}
      </div>
      {primary || decisions ? (
        <div data-slot="next-step-actions" className="flex shrink-0 flex-wrap items-center gap-2 self-start">
          {primary}
          {decisions}
        </div>
      ) : null}
    </section>
  );
}
