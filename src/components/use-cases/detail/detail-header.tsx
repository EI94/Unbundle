"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import { ActionMenu, type ActionMenuItem } from "@/components/uc/ui/action-menu";
import { titleAgent, type AgentTone } from "@/lib/use-cases/agents";
import type { DecisionItem } from "@/lib/use-cases/decision-ui";
import type { Phase, SubState } from "@/lib/use-cases/types";
import { cn } from "@/lib/utils";
import { AgentTag } from "../agent-tag";
import { PhasePill } from "../phase-pill";
import { useHideFromSearchItem } from "./hide-from-search-item";
import { InlineTextField } from "./inline-text-field";
import { REDACT_TEXT, RedactDialog, type RedactOption } from "./redact-dialog";

/** I testi della testata (§6.1, §14.3). */
export const DETAIL_HEADER_TEXT = Object.freeze({
  back: "Use case",
  moreActions: "Altre azioni",
  copyLink: "Copia link",
  linkCopied: "Link copiato.",
  copyFailed: "Non riusciamo a copiare il link.",
});

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
   * La testata dei revisori (rilascio 3): il tag dell'agente e il codice sopra il titolo, e il menu
   * «⋯» con «Copia link», «Nascondi dalla ricerca» o «Mostra ai colleghi» e «Oscura testo». La fase
   * e il prossimo passo li dicono il percorso e il riquadro «Prossimo passo»; tipo e origine stanno
   * in «Dettagli»; «Archivia» nelle decisioni del riquadro. Senza, la testata del contributore.
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
  } | null;
  /**
   * Il titolo si modifica qui, nella testata (`canEditWhat`): una volta sola (H4p). Senza, il
   * titolo si legge e basta.
   */
  titleEdit?: { item: Pick<DecisionItem, "id" | "version">; label: string; max: number } | null;
  /** Accanto alla pillola: «Proposto da te» (D13), per il contributore. */
  marker?: ReactNode;
  className?: string;
}

/**
 * La testata della scheda (docs/use-case/DESIGN.md §6.1, §6.9; rilascio 3). Ai revisori: «‹ Use
 * case», il tag dell'agente del titolo («LIBRA L1», che ripete il prefisso del titolo e i lettori
 * di schermo saltano) e il codice in monospazio, il menu «⋯» («Altre azioni») a destra, poi il
 * titolo senza il prefisso, che resta nascosto per i lettori di schermo; si modifica con la matita
 * il titolo intero. Al contributore la testata di prima: titolo e fase, e il codice solo delle sue
 * proposte, con «Copia link».
 */
export function DetailHeader({ workspaceId, card, reviewer, titleEdit, marker, className }: DetailHeaderProps) {
  const [dialog, setDialog] = useState<"oscura" | null>(null);
  const hideItem = useHideFromSearchItem({
    workspaceId,
    item: reviewer?.item ?? { id: card.id, version: 0, hiddenFromSearch: false },
    canSet: reviewer?.canSetHidden === true,
  });

  async function copyLink() {
    const url = `${window.location.origin}/dashboard/${workspaceId}/use-cases/${card.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(DETAIL_HEADER_TEXT.linkCopied);
    } catch {
      toast.error(DETAIL_HEADER_TEXT.copyFailed);
    }
  }

  const items: ActionMenuItem[] = [{ label: DETAIL_HEADER_TEXT.copyLink, onSelect: () => void copyLink() }];
  if (hideItem) items.push(hideItem);
  if (reviewer?.canRedact && reviewer.redactOptions.length) items.push({ label: REDACT_TEXT.menu, destructive: true, onSelect: () => setDialog("oscura") });

  const back = (
    <Link
      href={`/dashboard/${workspaceId}/use-cases`}
      className="-ml-1 inline-flex min-h-11 items-center gap-0.5 rounded-md px-1 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-8"
    >
      <ChevronLeft aria-hidden className="size-4" />
      {DETAIL_HEADER_TEXT.back}
    </Link>
  );

  if (!reviewer) {
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
          <PhasePill label={card.phaseLabel} phase={card.phase} subState={card.subState} />
        </div>
      </header>
    );
  }

  const agent = titleAgent(card.title);
  return (
    <header data-slot="detail-header" className={cn("space-y-2", className)}>
      {back}
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {agent ? <AgentTag label={agent.label} tone={reviewer.agentTone ?? null} decorative /> : null}
          {card.code ? <p className="font-mono text-sm text-muted-foreground">{card.code}</p> : null}
        </div>
        <ActionMenu items={items} label={DETAIL_HEADER_TEXT.moreActions} className="shrink-0" />
      </div>
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
          className="min-w-0"
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
