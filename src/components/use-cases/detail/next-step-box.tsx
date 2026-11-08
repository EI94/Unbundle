"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Archive,
  BellRing,
  CalendarDays,
  Check,
  CheckCheck,
  CircleHelp,
  CirclePause,
  FolderOpen,
  Hourglass,
  ListChecks,
  MessageCircleReply,
  Rocket,
  Send,
  ShieldCheck,
  UserRoundPlus,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { decisionLayout, type DecisionItem, type DuplicateCandidate } from "@/lib/use-cases/decision-ui";
import { GUIDED_TEXT, type NextStep, type NextStepIcon } from "@/lib/use-cases/guided";
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

const STEP_ICON: Readonly<Record<NextStepIcon, LucideIcon>> = Object.freeze({
  referente: UserRoundPlus,
  chiedi: Send,
  verifica: ListChecks,
  sollecita: BellRing,
  trimestre: CalendarDays,
  fornitori: ShieldCheck,
  attesa: Hourglass,
  ferme: CirclePause,
  avvia: Rocket,
  dossier: FolderOpen,
  decidi: Check,
  fatto: CheckCheck,
  chiuso: Archive,
  rispondi: MessageCircleReply,
});

/** L'icona del passo: decorativa, la parola sta sempre accanto (B.1.1). */
export function NextStepIconView({ icon, className }: { icon: NextStepIcon; className?: string }) {
  const Icon = STEP_ICON[icon];
  return <Icon aria-hidden data-icon="inline-start" className={className} />;
}

/**
 * Il «?» accanto al pulsante del passo (rilascio 6, B.1): la spiegazione si apre con un tocco, con
 * Invio o al passaggio del mouse; il pulsante del passo la fa leggere anche ai lettori di schermo
 * (`aria-describedby` sulla copia nascosta, `id`).
 */
export function NextStepWhy({ id, text }: { id: string; text: string }) {
  if (!text) return null;
  return (
    <>
      <span id={id} className="sr-only">
        {text}
      </span>
      <Popover>
        <PopoverTrigger
          openOnHover
          delay={250}
          data-slot="next-step-why"
          render={<Button type="button" variant="ghost" size="icon" className="size-11 shrink-0 text-muted-foreground sm:size-8" aria-label={GUIDED_TEXT.cta.why} />}
        >
          <CircleHelp aria-hidden />
        </PopoverTrigger>
        <PopoverContent align="start" data-next-step-why="" className="w-[min(20rem,calc(100vw-2rem))] text-sm">
          <p className="break-words">{text}</p>
        </PopoverContent>
      </Popover>
    </>
  );
}

/** Dove porta un «vai» del passo: un'ancora della stessa pagina (la scheda) o un link (il pannello, alla scheda). */
export type NextStepTarget = { kind: "page"; id: string } | { kind: "link"; href: string };

export interface NextStepRowProps {
  workspaceId: string;
  step: NextStep;
  item: DecisionItem;
  today: string;
  canDecide: boolean;
  candidates?: readonly DuplicateCandidate[];
  canMarkInProgress: boolean;
  /** Il pulsante del passo è pieno (il passo è di chi guarda e nessun altro pezzo della pagina ha il pieno). */
  filled: boolean;
  /** Dove porta un «vai» (e il link tranquillo del passo); senza, un'ancora della pagina. */
  targetOf?: (id: string) => NextStepTarget | null;
  /** L'id della spiegazione nascosta (`aria-describedby`). */
  whyId: string;
}

/**
 * (Rilascio 6, B.1) La riga del passo, nella scheda e nel pannello: un pulsante con l'icona e un verbo
 * di due o tre parole che fa il passo da dove si è (per esempio «Indica il referente» apre subito
 * «Scegli il referente»), pieno solo quando il passo è di chi guarda; senza un pulsante, l'icona e le
 * parole dello stato. Accanto il «?» con la spiegazione, «Tocca a …» piccolo solo quando non tocca a
 * chi guarda, il link tranquillo del passo e le altre decisioni nel menu «⋯».
 */
export function NextStepRow({ workspaceId, step, item, today, canDecide, candidates, canMarkInProgress, filled, targetOf, whyId }: NextStepRowProps) {
  const openReferent = useReferentDialog();
  const variant = filled ? "default" : "outline";
  const action = step.action;
  const touch = "min-h-11 sm:min-h-8";
  const icon = <NextStepIconView icon={step.icon} />;
  const describedBy = step.why ? whyId : undefined;
  const target = (id: string): NextStepTarget => targetOf?.(id) ?? { kind: "page", id };
  const linkTo = (id: string, children: ReactNode, className?: string, data?: Record<string, string>) => {
    const to = target(id);
    return to.kind === "page" ? (
      <InPageLink id={to.id} className={className} aria-describedby={describedBy} {...data}>
        {children}
      </InPageLink>
    ) : (
      <Link href={to.href} className={className} aria-describedby={describedBy} {...data}>
        {children}
      </Link>
    );
  };
  let primary: ReactNode = null;
  switch (action.type) {
    case "chiedi":
      primary = openReferent ? (
        <Button type="button" variant={variant} className={touch} aria-describedby={describedBy} data-action="next-step-ask" onClick={() => openReferent({ kind: "ask" })}>
          {icon}
          {step.cta}
        </Button>
      ) : null;
      break;
    case "referente":
      primary = openReferent ? (
        <Button
          type="button"
          variant={variant}
          className={touch}
          aria-describedby={describedBy}
          data-action="next-step-referent"
          onClick={() => openReferent(action.mode === "altra" ? { kind: "other" } : { kind: "assign", mode: action.mode })}
        >
          {icon}
          {step.cta}
        </Button>
      ) : null;
      break;
    case "impostazioni":
    case "avvia":
      primary = (
        <Button render={<Link href={action.href} aria-describedby={describedBy} />} nativeButton={false} variant={variant} className={touch}>
          {icon}
          {step.cta}
        </Button>
      );
      break;
    case "vai": {
      const to = target(action.id);
      primary = (
        <Button
          render={to.kind === "page" ? <InPageLink id={to.id} aria-describedby={describedBy} /> : <Link href={to.href} aria-describedby={describedBy} />}
          nativeButton={false}
          variant={variant}
          className={touch}
        >
          {icon}
          {step.cta}
        </Button>
      );
      break;
    }
    case "segna_in_realizzazione":
      primary = (
        <MarkInProgressButton
          workspaceId={workspaceId}
          item={{ id: item.id, code: item.code, version: item.version, phase: item.phase, kind: item.kind, dossier: item.dossier }}
          canMarkInProgress={canMarkInProgress}
          dossiersEnabled={false}
          variant={variant}
          icon={icon}
          describedBy={describedBy}
        />
      );
      break;
    case "dossier":
      primary = (
        <Button
          render={<Link href={action.href} aria-describedby={describedBy} />}
          nativeButton={false}
          variant={action.variant === "default" && filled ? "default" : "outline"}
          className={touch}
        >
          {icon}
          {step.cta}
        </Button>
      );
      break;
    default:
      primary = null;
  }
  const decisionPrimary = action.type === "decisione" && canDecide && decisionLayout(item, { canDecide }).primary !== null;
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
        primaryIcon={action.type === "decisione" ? icon : null}
        primaryDescribedBy={action.type === "decisione" ? describedBy : undefined}
        className="contents"
      />
    );
  // Senza un pulsante per chi guarda, lo stato in parole (B.1.2: detto una volta, qui).
  const status = !primary && !decisionPrimary;
  const turn = step.turn && (!step.mine || status) ? step.turn : null;
  return (
    <div data-slot="next-step-actions" className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      {status ? (
        <p data-slot="next-step-status" className="flex min-h-11 min-w-0 items-center gap-2 text-sm font-medium break-words sm:min-h-8" aria-describedby={describedBy}>
          <NextStepIconView icon={step.icon} className="size-4 shrink-0 text-muted-foreground" />
          {step.cta}
        </p>
      ) : (
        primary
      )}
      {/* Una decisione è il pulsante del passo: viene prima del «?»; altrimenti le decisioni stanno in fondo, nel «⋯». */}
      {action.type === "decisione" ? decisions : null}
      <NextStepWhy id={whyId} text={step.why} />
      {turn ? (
        <span data-slot="next-step-turn" className="text-xs text-muted-foreground">
          {turn}
        </span>
      ) : null}
      {step.link ? linkTo(step.link.id, step.link.label, QUIET_LINK_CLASS) : null}
      {action.type === "decisione" ? null : decisions}
    </div>
  );
}

/** Il link tranquillo del passo («Leggi la risposta»), accanto ai pulsanti. */
const QUIET_LINK_CLASS =
  "inline-flex min-h-11 items-center rounded-md text-sm text-foreground underline underline-offset-4 outline-none hover:decoration-2 focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-8";

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
 * «Prossimo passo» della scheda (rilascio 3; rilascio 6, B.1): sotto il percorso, una riga sola
 * (`NextStepRow`): il pulsante del passo, pieno solo quando il passo è di chi guarda (`step.mine`) e
 * nessun altro pezzo della pagina ha il pulsante pieno, il «?» con la spiegazione, «Tocca a …» solo
 * quando non tocca a chi guarda, le altre decisioni nel menu «⋯». Il titolo «Prossimo passo» resta
 * per i lettori di schermo e per le ancore. Un motivo che blocca il passo (le email spente) si legge
 * sotto, una riga (`role="status"`).
 */
export function NextStepBox({ workspaceId, step, item, today, canDecide, candidates, canMarkInProgress, className }: NextStepBoxProps) {
  const claimed = usePagePrimaryClaimed();
  const whyId = useId();
  // Un motivo che nessuno nel workspace toglie (email spente, risposte dal link spente): si dice a schermo.
  const blocking = step.gate === "email_non_configurata" || step.gate === "risposte_non_attive" ? step.line : null;
  return (
    <section
      id={NEXT_STEP_IDS.section}
      aria-labelledby={NEXT_STEP_IDS.heading}
      data-slot="next-step"
      data-key={step.key}
      data-gate={step.gate ?? undefined}
      className={cn("flex scroll-mt-20 flex-col gap-1 rounded-xl border bg-card px-3 py-2", className)}
    >
      <h2 id={NEXT_STEP_IDS.heading} tabIndex={-1} className="sr-only">
        {step.heading}
      </h2>
      <NextStepRow
        workspaceId={workspaceId}
        step={step}
        item={item}
        today={today}
        canDecide={canDecide}
        candidates={candidates}
        canMarkInProgress={canMarkInProgress}
        filled={step.mine && !claimed}
        whyId={whyId}
      />
      {blocking ? (
        <p id={NEXT_STEP_IDS.line} role="status" data-gate={step.gate ?? undefined} className="text-sm break-words text-muted-foreground">
          {blocking}
        </p>
      ) : null}
    </section>
  );
}
