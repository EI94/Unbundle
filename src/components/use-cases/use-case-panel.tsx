"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { questionLabel, type InfoAnswer } from "@/lib/use-cases/answers";
import type { CostBandInfo } from "@/lib/use-cases/cost-bands";
import { DIALOG_COMMON_TEXT, PUBLIC_NOTE_TEXT, toDecisionItem, type DuplicateCandidate } from "@/lib/use-cases/decision-ui";
import { ESTIMATES_TEXT } from "@/lib/use-cases/estimates";
import type { PanelNeeds } from "@/lib/use-cases/needs";
import { RISK_LABEL } from "@/lib/use-cases/labels";
import { StatusDot } from "@/components/uc/ui/status-dot";
import type { ContributorUseCase } from "@/lib/use-cases/permissions";
import type { HubItem } from "@/lib/use-cases/views";
import { AnswerForm } from "./answer-form";
import { CostFigure } from "./cost-figure";
import { DecisionButtons } from "./decision-buttons";
import { KindLabel } from "./kind-label";
import { OriginChip } from "./origin-chip";
import { PhasePill } from "./phase-pill";
import { ProposerAnswers } from "./proposer-answers";
import { OwnAnswer } from "./proposer-answers";
import { OwnMarker, othersCardNote, shownPhaseLabel } from "./use-case-row";
import { ValueFigure } from "./value-figure";
import { WhenControl } from "./when-control";

/** Testi del pannello (docs/use-case/DESIGN.md §4.8, §7.5, §14.3). */
export const PANEL_TEXT = Object.freeze({
  openDetail: "Apri la scheda",
  close: "Chiudi",
  problem: "Problema",
  needs: "Cosa serve",
});

/** «Altre 2 nella scheda»: le esigenze aperte oltre le tre del pannello. */
export function moreNeedsText(count: number): string {
  return count === 1 ? "Un'altra nella scheda" : `Altre ${count} nella scheda`;
}

export type UseCasePanelData =
  | {
      projection: "revisore";
      item: HubItem;
      candidates: DuplicateCandidate[];
      /** Le righe delle «Stime non ufficiali» (§7.5), già scritte sul server; vuoto senza dati raccolti. */
      estimate: string[];
      /** Le risposte di chi ha proposto a «Serve info» (D17, `intake.risposte`), dalla più vecchia. */
      answers: InfoAnswer[];
      /** «Cosa serve»: al massimo tre esigenze aperte dello use case (`panelNeeds`); null senza. */
      needs?: PanelNeeds | null;
    }
  | {
      projection: "contributore";
      item: ContributorUseCase;
      /** La sua risposta a «Serve info», se è una sua proposta non ancora decisa (D17); null altrimenti. */
      answer: InfoAnswer | null;
    };

export interface UseCasePanelProps {
  workspaceId: string;
  data: UseCasePanelData;
  /** La pagina senza `?apri=`: chiudere il pannello torna qui. */
  closeHref: string;
  /** La scheda dello use case (§6). */
  detailHref: string;
  /** Oggi a Roma (`AAAA-MM-GG`), letto sul server: «Quando» e i dialoghi. */
  today: string;
  /** `abilitiesForUseCase(viewer).canDecide`. */
  canDecide: boolean;
  /** Le fasce del costo del workspace (D15). */
  bands?: readonly CostBandInfo[];
  /** La lettura del dossier è in errore (§4.9): «In realizzazione» senza sotto-stato. */
  dossierDown?: boolean;
  /** Il nome del team che valuta, da solo (§14.2): «La domanda di AI Builder». */
  teamName: string;
}

/**
 * Il pannello laterale della pagina (`?apri=<id>`, docs/use-case/DESIGN.md §4.8), un `Sheet` di
 * circa 480 px. Revisori: codice, titolo, origine, tipo e fase; il problema in due righe; Valore
 * e Costo con la loro fonte; il riquadro «Stima di Claude, non ufficiale» se ci sono dati
 * raccolti; i chip di rischio; dopo una risposta a «Serve info» la domanda del team e l'ultima
 * risposta di chi ha proposto (D17: è la risposta che l'ha riportato in «Da decidere», con la
 * pillola «Nuova»); le decisioni per fase (un solo pulsante pieno, §6.4) e, se approvato,
 * «Quando»; «Apri la scheda ›». Contributori: titolo e fase con «Quando» nella stessa
 * pillola («Approvato · T1 2027», come nella riga e nella card); delle proprie proposte anche
 * codice, «Proposto da te», nota pubblica in sola lettura, in «Serve info» «Rispondi» (D17) e
 * «Apri la scheda ›». Delle proposte altrui niente link alla scheda: direbbe le stesse cose
 * (D4, D13).
 */
export function UseCasePanel({ workspaceId, data, closeHref, detailHref, today, canDecide, bands, dossierDown = false, teamName }: UseCasePanelProps) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  // Ogni pagina che arriva dal server porta dati nuovi e il pannello si riapre: anche lo stesso
  // use case riaperto prima che arrivi la chiusura, che quella pagina ha sostituito.
  const [shownData, setShownData] = useState(data);
  if (shownData !== data) {
    setShownData(data);
    setOpen(true);
  }
  const [, startTransition] = useTransition();
  const item = data.item;

  function close() {
    setOpen(false);
    startTransition(() => router.replace(closeHref, { scroll: false }));
  }

  const code = data.projection === "revisore" ? data.item.code : data.item.own ? data.item.code : null;
  // La scheda di una proposta altrui, per un contributore, direbbe solo titolo e fase: il pannello basta.
  const showDetailLink = data.projection === "revisore" || data.item.own;

  return (
    <Sheet open={open} onOpenChange={(next) => (next ? undefined : close())}>
      <SheetContent
        side="right"
        showCloseButton={false}
        data-slot="use-case-panel"
        className="gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-[480px]"
      >
        <SheetHeader className="flex-row items-start justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0 space-y-1">
            {code ? <p className="font-mono text-xs text-muted-foreground">{code}</p> : null}
            <SheetTitle className="text-base leading-snug font-semibold">{item.title}</SheetTitle>
          </div>
          <SheetClose render={<Button variant="ghost" size="icon" className="size-11 shrink-0 sm:size-8" aria-label={PANEL_TEXT.close} />}>
            <X aria-hidden />
          </SheetClose>
        </SheetHeader>
        {data.projection === "revisore" ? (
          <ReviewerBody
            workspaceId={workspaceId}
            item={data.item}
            candidates={data.candidates}
            estimate={data.estimate}
            answers={data.answers}
            needs={data.needs ?? null}
            needsHref={`${detailHref}?capitolo=cosa-serve`}
            today={today}
            canDecide={canDecide}
            bands={bands}
            dossierDown={dossierDown}
            teamName={teamName}
          />
        ) : (
          <ContributorBody workspaceId={workspaceId} item={data.item} answer={data.answer} dossierDown={dossierDown} teamName={teamName} />
        )}
        {showDetailLink ? (
          <div className="border-t px-4 py-3">
            <Link
              href={detailHref}
              className="inline-flex min-h-11 items-center gap-0.5 text-sm font-medium text-primary underline underline-offset-4 outline-none hover:decoration-2 focus-visible:decoration-2 sm:min-h-8"
            >
              {PANEL_TEXT.openDetail}
              <ChevronRight aria-hidden className="size-4" />
            </Link>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Block({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={className ?? "space-y-2 px-4 py-3"}>{children}</div>;
}

function ReviewerBody({
  workspaceId,
  item,
  candidates,
  estimate,
  answers,
  needs,
  needsHref,
  today,
  canDecide,
  bands,
  dossierDown,
  teamName,
}: {
  workspaceId: string;
  item: HubItem;
  candidates: DuplicateCandidate[];
  estimate: string[];
  answers: readonly InfoAnswer[];
  needs: PanelNeeds | null;
  needsHref: string;
  today: string;
  canDecide: boolean;
  bands?: readonly CostBandInfo[];
  dossierDown: boolean;
  teamName: string;
}) {
  const decisionItem = toDecisionItem(item);
  const whenId = `pannello-quando-${item.id}`;
  // Una risposta ricevuta e non ancora decisa (`item.answered`): la domanda, poi l'ultima risposta (D17).
  // In «Serve info» di nuovo, l'ultima risposta è della domanda di prima: si legge nella scheda.
  const answered = item.answered && answers.length > 0;
  return (
    <div className="flex flex-1 flex-col divide-y">
      <Block>
        <div className="flex flex-wrap items-center gap-2">
          <OriginChip origin={item.origin} />
          <KindLabel kind={item.kind} />
          <PhasePill label={shownPhaseLabel(item, dossierDown)} tone={item.tone} />
        </div>
        {item.problemPreview ? <SheetDescription className="line-clamp-2 text-sm text-foreground">{item.problemPreview}</SheetDescription> : null}
      </Block>
      <Block className="grid gap-2 px-4 py-3 sm:grid-cols-2">
        <ValueFigure value={item.value} withLabel withSource />
        <CostFigure cost={item.cost} bands={bands} withLabel />
      </Block>
      {estimate.length || item.risks.length ? (
        <Block>
          {estimate.length ? (
            <div data-slot="claude-estimate" className="space-y-1 rounded-lg bg-muted px-3 py-2 text-sm">
              <p className="text-xs font-medium text-muted-foreground">
                {ESTIMATES_TEXT.title} · {ESTIMATES_TEXT.note}
              </p>
              {estimate.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          ) : null}
          {item.risks.length ? (
            <ul className="flex flex-wrap gap-1.5">
              {item.risks.map((risk) => (
                <li key={risk} className="rounded-full border border-amber-300/70 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-100">
                  {RISK_LABEL[risk]}
                </li>
              ))}
            </ul>
          ) : null}
        </Block>
      ) : null}
      {needs ? <PanelNeedsBlock needs={needs} href={needsHref} /> : null}
      {answered ? (
        <Block className="space-y-3 px-4 py-3">
          {item.publicNote ? (
            <div data-slot="team-question" className="space-y-1">
              <p className="text-sm font-medium">{questionLabel(teamName)}</p>
              <p className="text-sm whitespace-pre-line break-words">{item.publicNote}</p>
            </div>
          ) : null}
          <ProposerAnswers answers={answers} show="ultima" />
        </Block>
      ) : null}
      {canDecide ? (
        <Block className="space-y-3 px-4 py-3">
          {item.phase === "approvato" ? (
            <div className="space-y-1.5">
              <p id={whenId} className="text-sm font-medium">
                {DIALOG_COMMON_TEXT.when}
              </p>
              <WhenControl workspaceId={workspaceId} item={decisionItem} today={today} canDecide={canDecide} labelledBy={whenId} />
            </div>
          ) : null}
          <DecisionButtons workspaceId={workspaceId} item={decisionItem} today={today} canDecide={canDecide} candidates={candidates} />
        </Block>
      ) : null}
    </div>
  );
}

/** «Cosa serve» nel pannello: al massimo tre esigenze aperte, con stato e scadenza; le altre nella scheda. */
export function PanelNeedsBlock({ needs, href }: { needs: PanelNeeds; href: string }) {
  return (
    <Block>
      <div data-slot="panel-needs" className="space-y-2">
        <p className="text-sm font-medium">{PANEL_TEXT.needs}</p>
        <ul className="space-y-2">
          {needs.rows.map((row) => (
            <li key={row.id} data-need={row.id} className="space-y-0.5">
              <p className="text-sm break-words">{row.title}</p>
              <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <StatusDot tone={row.status.tone} label={row.status.label} />
                {row.due ? <span className="tabular-nums">{row.due}</span> : null}
              </p>
            </li>
          ))}
        </ul>
        {needs.more ? (
          <Link
            href={href}
            className="inline-flex min-h-11 items-center gap-0.5 text-sm text-primary underline-offset-4 outline-none hover:underline focus-visible:underline sm:min-h-8"
          >
            {moreNeedsText(needs.more)}
            <ChevronRight aria-hidden className="size-4" />
          </Link>
        ) : null}
      </div>
    </Block>
  );
}

function ContributorBody({
  workspaceId,
  item,
  answer,
  dossierDown,
  teamName,
}: {
  workspaceId: string;
  item: ContributorUseCase;
  answer: InfoAnswer | null;
  dossierDown: boolean;
  teamName: string;
}) {
  // «Serve info» su una propria proposta: la domanda e «Rispondi» (D17).
  const asked = item.own && item.phase === "da_valutare" && item.subState === "serve_info";
  return (
    <div className="flex flex-1 flex-col divide-y">
      <Block>
        <div className="flex flex-wrap items-center gap-2">
          {item.own ? <OwnMarker /> : null}
          <PhasePill label={shownPhaseLabel(item, dossierDown)} phase={item.phase} subState={item.subState} />
        </div>
        {/* Delle proposte altrui solo titolo e fase (D4, D13): una riga dice perché (H7). */}
        {item.own ? null : <p className="text-xs text-muted-foreground">{othersCardNote(teamName)}</p>}
      </Block>
      {asked ? (
        <Block>
          <AnswerForm workspaceId={workspaceId} useCaseId={item.id} question={item.publicNote} teamName={teamName} />
        </Block>
      ) : item.own && answer ? (
        // Dopo la risposta, finché nessuno decide: la domanda e, sotto, la sua risposta.
        <Block className="space-y-3 px-4 py-3">
          {item.publicNote ? (
            <div className="space-y-1">
              <p className="text-sm font-medium">{questionLabel(teamName)}</p>
              <p className="text-sm whitespace-pre-line break-words">{item.publicNote}</p>
            </div>
          ) : null}
          <OwnAnswer answer={answer} />
        </Block>
      ) : item.own && item.publicNote ? (
        <Block>
          <p className="text-sm font-medium">{PUBLIC_NOTE_TEXT.label}</p>
          <p className="text-sm whitespace-pre-line">{item.publicNote}</p>
        </Block>
      ) : null}
    </div>
  );
}
