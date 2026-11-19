"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import { ActionMenu, type ActionMenuItem } from "@/components/uc/ui/action-menu";
import { titleAgent, type AgentTone } from "@/lib/use-cases/agents";
import { DECISION_LABEL, type DecisionItem, type DecisionKey, type DuplicateCandidate } from "@/lib/use-cases/decision-ui";
import { GUIDED_TEXT } from "@/lib/use-cases/guided";
import type { Phase, SubState } from "@/lib/use-cases/types";
import { cn } from "@/lib/utils";
import { AgentTag } from "../agent-tag";
import { useDecisionDialogs } from "../decision-buttons";
import { PhasePill } from "../phase-pill";
import { InPageLink } from "./arrival";
import { useVisibilityToggle } from "./hide-from-search-item";
import { InlineTextField } from "./inline-text-field";
import { REDACT_TEXT, RedactDialog, type RedactOption } from "./redact-dialog";
import { SchedaMenu, type SchedaMenuGroup, type SchedaMenuItem } from "./scheda-menu";

/** I testi della testata (§6.1, §14.3). */
export const DETAIL_HEADER_TEXT = Object.freeze({
  back: "Use case",
  moreActions: "Altre azioni",
  copyLink: "Copia link",
  linkCopied: "Link copiato.",
  copyFailed: "Non riusciamo a copiare il link.",
});

/** (Rilascio 10, §3.4) Le decisioni del gruppo «Decisione» del «⋯» e quello che serve ai loro dialoghi. */
export interface HeaderDecisions {
  /** Le parti delle decisioni (`toDecisionItem`), non la scheda intera. */
  item: DecisionItem;
  today: string;
  /** Solo id, codice e titolo (`toDuplicateCandidates`), per «Doppione di…». */
  candidates?: readonly DuplicateCandidate[];
  /** `menuDecisions(...)`: le decisioni della fase tranne quella che è già il pulsante del passo; vuoto per chi non decide. */
  keys: readonly DecisionKey[];
}

export interface DetailHeaderProps {
  workspaceId: string;
  card: {
    id: string;
    title: string;
    /** Il codice: ai revisori sempre; al contributore solo delle sue proposte (D13). */
    code: string | null;
    phase: Phase;
    /** null: proposta altrui in «Da valutare», di cui il contributore vede solo la fase. */
    subState: SubState | null;
    phaseLabel: string;
  };
  /**
   * La testata dei revisori (rilascio 3; rilascio 10, §3.4): il tag dell'agente e il codice sopra il titolo, il solo
   * «⋯» accanto al titolo, con il gruppo «Decisione» (Rimanda, Serve info, Non avviare, Doppione di…, Archivia,
   * Riapri: quelle della fase che non sono già il pulsante del passo) e il gruppo «Scheda» («Copia link», l'interruttore
   * «Visibile in azienda», «Oscura testo»), poi la pillola della fase. Il prossimo passo lo dice il riquadro sotto; tipo
   * e origine stanno in «Dettagli». Senza, la testata del contributore.
   */
  reviewer?: {
    item: Pick<DecisionItem, "id" | "code" | "version" | "hiddenFromSearch">;
    /** Il tono dell'agente del titolo, come sulle card della Panoramica (`workspaceAgentToneOf`); null: il tag neutro. */
    agentTone?: AgentTone | null;
    /** `canSetHiddenFromSearch`. */
    canSetHidden: boolean;
    /** «Oscura testo»: Lateral Space con ruolo da revisore e chi gestisce il workspace (§1.2 punto 10). */
    canRedact: boolean;
    redactOptions: readonly RedactOption[];
    /** (Rilascio 5, §9.1) «Referente: {Nome} · {stato}», un link al blocco «Referente»; null senza referente. */
    referentLine?: string | null;
    /** (Rilascio 10) Il gruppo «Decisione» del «⋯»; null o senza voci: il gruppo non c'è. */
    decisions?: HeaderDecisions | null;
  } | null;
  /**
   * Il titolo si modifica qui, nella testata (`canEditWhat`): una volta sola (H4p). Senza, il
   * titolo si legge e basta.
   */
  titleEdit?: { item: Pick<DecisionItem, "id" | "version">; label: string; max: number } | null;
  /** Accanto alla pillola: «Proposto da te» (D13), per il contributore. */
  marker?: ReactNode;
  /** (Rilascio 5, §9.1) Il contributore: la parola dello stato del referente dopo la pillola (niente nomi). */
  referentState?: ReactNode;
  className?: string;
}

/** «Copia link»: l'indirizzo della scheda negli appunti, con l'avviso. */
function copyLinkOf(workspaceId: string, useCaseId: string): () => void {
  return () => {
    void (async () => {
      const url = `${window.location.origin}/dashboard/${workspaceId}/use-cases/${useCaseId}`;
      try {
        await navigator.clipboard.writeText(url);
        toast.success(DETAIL_HEADER_TEXT.linkCopied);
      } catch {
        toast.error(DETAIL_HEADER_TEXT.copyFailed);
      }
    })();
  };
}

/** Il «⋯» con il gruppo «Decisione»: i dialoghi delle decisioni stanno qui, accanto alle voci che li aprono. */
function MenuWithDecisions({ workspaceId, decisions, card }: { workspaceId: string; decisions: HeaderDecisions; card: readonly SchedaMenuItem[] }) {
  const { openDialog, dialogs } = useDecisionDialogs({ workspaceId, item: decisions.item, today: decisions.today, candidates: decisions.candidates });
  const t = GUIDED_TEXT.scheda;
  const groups: SchedaMenuGroup[] = [
    { label: t.decisionGroup, items: decisions.keys.map((key) => ({ kind: "azione", label: DECISION_LABEL[key], onSelect: () => openDialog(key) })) },
    { label: t.cardGroup, items: card },
  ];
  return (
    <>
      <SchedaMenu groups={groups} label={DETAIL_HEADER_TEXT.moreActions} className="shrink-0" />
      {dialogs}
    </>
  );
}

/**
 * La testata della scheda (docs/use-case/DESIGN.md §6.1, §6.9; rilascio 3; rilascio 10, §3.4). Ai revisori: «‹ Use
 * case», il tag dell'agente del titolo («LIBRA L1», che ripete il prefisso del titolo e i lettori di schermo saltano) e
 * il codice in monospazio, il titolo senza il prefisso (nascosto per i lettori di schermo) con il solo «⋯» accanto, poi
 * la pillola della fase; il titolo intero si modifica con la matita. Al contributore la testata di prima: titolo e
 * fase, e il codice solo delle sue proposte, con «Copia link».
 */
export function DetailHeader({ workspaceId, card, reviewer, titleEdit, marker, referentState, className }: DetailHeaderProps) {
  const [dialog, setDialog] = useState<"oscura" | null>(null);
  const copyLink = copyLinkOf(workspaceId, card.id);
  const visibility = useVisibilityToggle({
    workspaceId,
    item: reviewer?.item ?? { id: card.id, version: 0, hiddenFromSearch: false },
    canSet: reviewer?.canSetHidden === true,
  });

  const back = (
    <Link
      href={`/dashboard/${workspaceId}/use-cases`}
      className="-ml-1 inline-flex min-h-11 items-center gap-0.5 rounded-md px-1 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-8"
    >
      <ChevronLeft aria-hidden className="size-4" />
      {DETAIL_HEADER_TEXT.back}
    </Link>
  );
  const phase = <PhasePill label={card.phaseLabel} phase={card.phase} subState={card.subState} />;

  if (!reviewer) {
    const items: ActionMenuItem[] = [{ label: DETAIL_HEADER_TEXT.copyLink, onSelect: copyLink }];
    return (
      <header data-slot="detail-header" className={cn("space-y-2", className)}>
        {back}
        {card.code ? <p className="font-mono text-sm text-muted-foreground">{card.code}</p> : null}
        <div className="flex min-w-0 items-start justify-between gap-3">
          <h1 className="min-w-0 text-2xl font-semibold tracking-tight break-words">{card.title}</h1>
          <ActionMenu items={items} label={DETAIL_HEADER_TEXT.moreActions} className="shrink-0" />
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {marker}
          {phase}
          {referentState}
        </div>
      </header>
    );
  }

  const agent = titleAgent(card.title);
  const cardItems: SchedaMenuItem[] = [{ kind: "azione", label: DETAIL_HEADER_TEXT.copyLink, onSelect: copyLink }];
  if (visibility) cardItems.push(visibility);
  if (reviewer.canRedact && reviewer.redactOptions.length) cardItems.push({ kind: "azione", label: REDACT_TEXT.menu, destructive: true, onSelect: () => setDialog("oscura") });
  const decisions = reviewer.decisions && reviewer.decisions.keys.length ? reviewer.decisions : null;
  const menu = decisions ? (
    <MenuWithDecisions workspaceId={workspaceId} decisions={decisions} card={cardItems} />
  ) : (
    <SchedaMenu groups={[{ label: GUIDED_TEXT.scheda.cardGroup, items: cardItems }]} label={DETAIL_HEADER_TEXT.moreActions} className="shrink-0" />
  );
  return (
    <header data-slot="detail-header" className={cn("space-y-2", className)}>
      {back}
      {agent || card.code ? (
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {agent ? <AgentTag label={agent.label} tone={reviewer.agentTone ?? null} decorative /> : null}
          {card.code ? <p className="font-mono text-sm text-muted-foreground">{card.code}</p> : null}
        </div>
      ) : null}
      <div className="flex min-w-0 items-start justify-between gap-3">
        {titleEdit ? (
          <InlineTextField
            workspaceId={workspaceId}
            item={titleEdit.item}
            field="title"
            label={titleEdit.label}
            value={card.title}
            max={titleEdit.max}
            canEdit
            variant="titolo"
            displayValue={agent ? { prefix: agent.prefix, rest: agent.rest } : null}
            className="min-w-0 flex-1"
          />
        ) : (
          <h1 className="min-w-0 text-2xl font-semibold tracking-tight break-words">
            {agent ? (
              <>
                <span className="sr-only">{agent.prefix}</span>
                {agent.rest}
              </>
            ) : (
              card.title
            )}
          </h1>
        )}
        {menu}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">{phase}</div>
      {reviewer.referentLine ? (
        <p data-slot="referent-line" className="text-sm break-words text-muted-foreground">
          <InPageLink id="referente" className="rounded-sm underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
            {reviewer.referentLine}
          </InPageLink>
        </p>
      ) : null}
      {dialog === "oscura" ? (
        <RedactDialog
          open
          onOpenChange={(next) => {
            if (!next) setDialog(null);
          }}
          workspaceId={workspaceId}
          item={reviewer.item}
          options={reviewer.redactOptions}
        />
      ) : null}
    </header>
  );
}
