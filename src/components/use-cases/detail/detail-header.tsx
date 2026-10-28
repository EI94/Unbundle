"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import { ActionMenu, type ActionMenuItem } from "@/components/uc/ui/action-menu";
import { decideUseCaseAction } from "@/lib/actions/use-case-decisions";
import { DECISION_LABEL, type DecisionActionResult, type DecisionItem, type PageDecision } from "@/lib/use-cases/decision-ui";
import type { InfoProgressView } from "@/lib/use-cases/info-progress";
import type { Origin, Phase, PhaseTone, SubState, UseCaseKind } from "@/lib/use-cases/types";
import { cn } from "@/lib/utils";
import { ArchiveDialog } from "../archive-dialog";
import { useDecisionRunner } from "../decision-buttons";
import { InfoChip } from "../info-chip";
import { KindLabel } from "../kind-label";
import { OriginChip } from "../origin-chip";
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
    tone?: PhaseTone;
    /** Solo per i revisori: i contributori non vedono origine e tipo. */
    origin?: Origin | null;
    kind?: UseCaseKind | null;
  };
  /** Le voci del menu «⋯» dei revisori; senza, il menu ha solo «Copia link». */
  reviewer?: {
    item: Pick<DecisionItem, "id" | "code" | "version" | "hiddenFromSearch">;
    /** `canSetHiddenFromSearch`. */
    canSetHidden: boolean;
    /** «Archivia» ammesso in questa fase (§3.7, `decisionLayout`). */
    canArchive: boolean;
    /** «Oscura testo»: Lateral Space con ruolo da revisore e chi gestisce il workspace (§1.2 punto 10). */
    canRedact: boolean;
    redactOptions: readonly RedactOption[];
  } | null;
  /**
   * Il titolo si modifica qui, nella testata (`canEditWhat`): una volta sola, senza un campo
   * «Titolo» in «Cos'è» (H4p). Senza, il titolo si legge e basta.
   */
  titleEdit?: { item: Pick<DecisionItem, "id" | "version">; label: string; max: number } | null;
  /** Accanto alla pillola: «Proposto da te» (D13), per il contributore. */
  marker?: ReactNode;
  /**
   * «Raccolta informazioni» (SPEC §P2.10.3): solo ai revisori, subito dopo la pillola della fase: solo
   * lo stato a parole («Informazioni: in attesa»), senza date né conteggi, che stanno in cima a «Cosa
   * serve». Non è una fase e non cambia mai la fase: la fase la decidono le persone.
   */
  infoProgress?: InfoProgressView | null;
  className?: string;
}

/**
 * La testata della scheda (docs/use-case/DESIGN.md §6.1, §6.9): «‹ Use case», il codice in
 * monospazio sopra il titolo, il titolo, chip d'origine e di tipo, la pillola della fase, e il
 * menu «⋯» («Altre azioni»): «Copia link» per tutti; «Nascondi dalla ricerca» o «Mostra ai
 * colleghi» e «Archivia» (se ammesso) per i revisori; «Oscura testo» per Lateral Space e chi
 * gestisce il workspace. Al contributore titolo e fase, e il codice solo delle sue proposte.
 */
export function DetailHeader({ workspaceId, card, reviewer, titleEdit, marker, infoProgress = null, className }: DetailHeaderProps) {
  const [dialog, setDialog] = useState<"archivia" | "oscura" | null>(null);
  const { run, pending } = useDecisionRunner();
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

  async function archive(decision: PageDecision): Promise<DecisionActionResult> {
    const target = reviewer!.item;
    const result = await run(target, (version) => decideUseCaseAction(workspaceId, target.id, version, decision));
    if (result.ok) setDialog(null);
    return result;
  }

  const items: ActionMenuItem[] = [{ label: DETAIL_HEADER_TEXT.copyLink, onSelect: () => void copyLink() }];
  if (hideItem) items.push(hideItem);
  if (reviewer?.canArchive) items.push({ label: DECISION_LABEL.archivia, onSelect: () => setDialog("archivia") });
  if (reviewer?.canRedact && reviewer.redactOptions.length) items.push({ label: REDACT_TEXT.menu, destructive: true, onSelect: () => setDialog("oscura") });

  return (
    <header data-slot="detail-header" className={cn("space-y-2", className)}>
      <Link
        href={`/dashboard/${workspaceId}/use-cases`}
        className="-ml-1 inline-flex min-h-11 items-center gap-0.5 rounded-md px-1 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-8"
      >
        <ChevronLeft aria-hidden className="size-4" />
        {DETAIL_HEADER_TEXT.back}
      </Link>
      {card.code ? <p className="font-mono text-sm text-muted-foreground">{card.code}</p> : null}
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
            className="min-w-0 flex-1"
          />
        ) : (
          <h1 className="min-w-0 text-2xl font-semibold tracking-tight break-words">{card.title}</h1>
        )}
        <ActionMenu items={items} label={DETAIL_HEADER_TEXT.moreActions} className="shrink-0" />
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {marker}
        {card.origin ? <OriginChip origin={card.origin} /> : null}
        {card.kind ? <KindLabel kind={card.kind} /> : null}
        <PhasePill label={card.phaseLabel} tone={card.tone} phase={card.phase} subState={card.subState} />
        <InfoChip view={infoProgress} variant="long" />
      </div>
      {reviewer && dialog === "archivia" ? (
        <ArchiveDialog
          open
          onOpenChange={(next) => {
            if (!next) setDialog(null);
          }}
          code={reviewer.item.code}
          pending={pending}
          onSubmit={archive}
        />
      ) : null}
      {reviewer && dialog === "oscura" ? (
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
