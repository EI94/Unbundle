"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { questionLabel, type InfoAnswer } from "@/lib/use-cases/answers";
import type { CostBandInfo } from "@/lib/use-cases/cost-bands";
import { DIALOG_COMMON_TEXT, PUBLIC_NOTE_TEXT, toDecisionItem, type DuplicateCandidate } from "@/lib/use-cases/decision-ui";
import { ESTIMATES_TEXT } from "@/lib/use-cases/estimates";
import { needsCountBar, needsCountPieces, type PanelNeeds } from "@/lib/use-cases/needs";
import { keepTogether } from "@/lib/use-cases/line-breaks";
import { FIGURE_SEPARATOR, PANEL_FIGURE_TEXT, panelCostParts, panelValueText } from "@/lib/use-cases/format";
import type { NextStep } from "@/lib/use-cases/guided";
import { SEMAFORO_TONE } from "@/components/uc/common/semaforo-tone";
import type { ContributorUseCase } from "@/lib/use-cases/permissions";
import type { HubItem } from "@/lib/use-cases/views";
import { AnswerForm } from "./answer-form";
import { RiskChips } from "./detail/risk-chips";
import { NextStepRow, type NextStepTarget } from "./detail/next-step-box";
import { ReferentDialogHost } from "./detail/referent/dialog-host";
import type { PanelReferent } from "./hub";
import { SourceTag } from "./source-tag";
import { PhasePill } from "./phase-pill";
import { ReferentChip } from "./referent-chip";
import type { ReferentStateKey } from "@/lib/use-cases/referent/use-case-state";
import { ProposerAnswers } from "./proposer-answers";
import { OwnAnswer } from "./proposer-answers";
import { OwnMarker, othersCardNote, shownPhaseLabel } from "./use-case-row";
import { focusPanelStart } from "./panel-focus";
import { WhenControl } from "./when-control";

/** Testi del pannello (docs/use-case/DESIGN.md §4.8, §7.5, §14.3). */
export const PANEL_TEXT = Object.freeze({
  openDetail: "Apri la scheda",
  close: "Chiudi",
  problem: "Problema",
  needs: "Cosa serve",
  nextStep: "Prossimo passo",
});

/** (Rilascio 6, B.1.5) «Cosa serve · 9»: il conteggio al posto delle voci; il tocco apre «Cosa serve» nella scheda. */
export function needsCountTitle(open: number): string {
  return `${PANEL_TEXT.needs}${FIGURE_SEPARATOR}${open}`;
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
      /** «Cosa serve»: il conteggio delle esigenze dello use case (`panelNeeds`); null senza. */
      needs?: PanelNeeds | null;
      /** «Prossimo passo» (`panelNextStep`): la regola della scheda; null senza. */
      nextStep?: NextStep | null;
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
  /** (Rilascio 5, §10.3) Lo stato del referente dello use case (tutti i ruoli; solo la parola): ai contributori. */
  referentState?: ReferentStateKey | null;
  /** (Rilascio 6) `canEditNeeds`: le finestre del referente si aprono solo per chi modifica le esigenze. */
  canEditNeeds?: boolean;
  /** (Rilascio 6) «Segna come in realizzazione» (solo Lateral Space, sezione Casi d'uso spenta). */
  canMarkInProgress?: boolean;
  /** (Rilascio 6) Il nome del workspace, per le finestre del referente. */
  companyName?: string | null;
  /** (Rilascio 6, B.2) Il referente dello use case aperto (`loadUseCaseHub`), per le sue finestre; null senza. */
  referent?: PanelReferent | null;
}

const NO_ASSIGN = Object.freeze({ description: Object.freeze({ text: null, dropped: 0 }), benefits: null });

/**
 * Il pannello laterale della pagina (`?apri=<id>`, docs/use-case/DESIGN.md §4.8), un `Sheet` di
 * circa 480 px. Revisori (rilascio 6, B.2): codice e titolo; una sola pillola, la fase con «Quando»
 * («Approvato · T4 2026»: origine e tipo stanno nella scheda); sotto, il passo come un pulsante con
 * l'icona e il verbo che lo fa da qui («Indica il referente» apre subito «Scegli il referente»), il
 * «?» con la spiegazione e «Tocca a …» solo quando non tocca a chi guarda; le altre decisioni nel
 * menu «⋯» («Non avviare»); niente descrizione (sta nella scheda); Valore e Costo una riga ciascuno;
 * il riquadro «Stima di Claude, non ufficiale» se ci sono dati raccolti; i chip di rischio; dopo una
 * risposta a «Serve info» la domanda del team e l'ultima risposta di chi ha proposto (D17); «Cosa
 * serve · 9» con i conteggi per stato e una barra sottile, che apre «Cosa serve» nella scheda; se
 * approvato, «Quando»; «Apri la scheda ›». Contributori: titolo e fase con «Quando» nella stessa
 * pillola, lo stato del referente in parola; delle proprie proposte anche codice, «Proposto da te»,
 * nota pubblica in sola lettura, in «Serve info» «Rispondi» (D17) e «Apri la scheda ›». Delle
 * proposte altrui niente link alla scheda (D4, D13). All'apertura il fuoco va a «Chiudi» senza far
 * scorrere il pannello (`focusPanelStart`).
 */
export function UseCasePanel({
  workspaceId,
  data,
  closeHref,
  detailHref,
  today,
  canDecide,
  bands,
  dossierDown = false,
  teamName,
  referentState = null,
  canEditNeeds = false,
  canMarkInProgress = false,
  companyName = null,
  referent = null,
}: UseCasePanelProps) {
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
  const closeRef = useRef<HTMLButtonElement>(null);
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
        initialFocus={(openType) => focusPanelStart(openType, closeRef.current, document.activeElement)}
        className="gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-[480px]"
      >
        <SheetHeader className="flex-row items-start justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0 space-y-1">
            {code ? <p className="font-mono text-xs text-muted-foreground">{code}</p> : null}
            <SheetTitle className="text-base leading-snug font-semibold">{item.title}</SheetTitle>
            <SheetDescription className="sr-only">{shownPhaseLabel(item, dossierDown)}</SheetDescription>
          </div>
          <SheetClose ref={closeRef} render={<Button variant="ghost" size="icon" className="size-11 shrink-0 sm:size-8" aria-label={PANEL_TEXT.close} />}>
            <X aria-hidden />
          </SheetClose>
        </SheetHeader>
        {data.projection === "revisore" ? (
          <ReferentDialogHost
            workspaceId={workspaceId}
            useCaseId={data.item.id}
            panel={referent?.panel ?? null}
            canEdit={canEditNeeds}
            needInfo={referent?.needInfo ?? {}}
            card={referent?.card ?? { code: data.item.code, title: data.item.title }}
            companyName={companyName}
            companyDisplayName={referent?.companyDisplayName ?? null}
            assign={referent?.assign ?? NO_ASSIGN}
          >
            <ReviewerBody
              workspaceId={workspaceId}
              item={data.item}
              candidates={data.candidates}
              estimate={data.estimate}
              answers={data.answers}
              needs={data.needs ?? null}
              nextStep={data.nextStep ?? null}
              detailHref={detailHref}
              today={today}
              canDecide={canDecide}
              canMarkInProgress={canMarkInProgress}
              bands={bands}
              dossierDown={dossierDown}
              teamName={teamName}
            />
          </ReferentDialogHost>
        ) : (
          <ContributorBody workspaceId={workspaceId} item={data.item} answer={data.answer} dossierDown={dossierDown} teamName={teamName} referentState={referentState} />
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

function Block({ children, className, id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <div id={id} tabIndex={id ? -1 : undefined} className={cn(className ?? "space-y-2 px-4 py-3", id && "scroll-mt-4 outline-none")}>
      {children}
    </div>
  );
}

/** (Rilascio 6) Gli id del pannello a cui porta il passo: «Quando» e la risposta di chi ha proposto. */
export const PANEL_IDS = Object.freeze({ when: "pannello-quando", answer: "pannello-risposta" });

function ReviewerBody({
  workspaceId,
  item,
  candidates,
  estimate,
  answers,
  needs,
  nextStep,
  detailHref,
  today,
  canDecide,
  canMarkInProgress,
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
  nextStep: NextStep | null;
  detailHref: string;
  today: string;
  canDecide: boolean;
  canMarkInProgress: boolean;
  bands?: readonly CostBandInfo[];
  dossierDown: boolean;
  teamName: string;
}) {
  const decisionItem = toDecisionItem(item);
  const whenId = `pannello-quando-${item.id}`;
  const whyId = `pannello-perche-${item.id}`;
  // Una risposta ricevuta e non ancora decisa (`item.answered`): la domanda, poi l'ultima risposta (D17).
  // In «Serve info» di nuovo, l'ultima risposta è della domanda di prima: si legge nella scheda.
  const answered = item.answered && answers.length > 0;
  const when = canDecide && item.phase === "approvato";
  const needsHref = `${detailHref}?capitolo=cosa-serve`;
  // Dove portano i passi dal pannello: «Quando» e la risposta stanno qui, il resto nella scheda.
  const targetOf = (id: string): NextStepTarget => {
    if (id === "quando") return when ? { kind: "page", id: PANEL_IDS.when } : { kind: "link", href: `${detailHref}#quando` };
    if (id === "nota-pubblica") return answered ? { kind: "page", id: PANEL_IDS.answer } : { kind: "link", href: `${detailHref}#nota-pubblica` };
    if (id === "richieste") return { kind: "link", href: `${detailHref}?capitolo=richieste` };
    return { kind: "link", href: needsHref };
  };
  return (
    <div className="flex flex-1 flex-col divide-y">
      <Block>
        <div className="flex flex-wrap items-center gap-2">
          <PhasePill label={shownPhaseLabel(item, dossierDown)} tone={item.tone} />
        </div>
        {nextStep ? (
          <div data-slot="panel-next-step" data-key={nextStep.key} aria-label={PANEL_TEXT.nextStep} role="group">
            <NextStepRow
              workspaceId={workspaceId}
              step={nextStep}
              item={decisionItem}
              today={today}
              canDecide={canDecide}
              candidates={candidates}
              canMarkInProgress={canMarkInProgress}
              filled={nextStep.mine}
              targetOf={targetOf}
              whyId={whyId}
            />
            {nextStep.gate === "email_non_configurata" || nextStep.gate === "risposte_non_attive" ? (
              <p role="status" data-gate={nextStep.gate} className="text-xs break-words text-muted-foreground">
                {nextStep.line}
              </p>
            ) : null}
          </div>
        ) : null}
      </Block>
      <Block className="space-y-1 px-4 py-3">
        <PanelValueLine value={item.value} />
        <PanelCostLine cost={item.cost} bands={bands} />
      </Block>
      {estimate.length || item.risks.length ? (
        <Block>
          {estimate.length ? (
            <div data-slot="claude-estimate" className="space-y-1 rounded-lg bg-muted px-3 py-2 text-sm">
              <p className="text-xs font-medium text-muted-foreground">{keepTogether(`${ESTIMATES_TEXT.title} · ${ESTIMATES_TEXT.note}`)}</p>
              {estimate.map((line) => (
                <p key={line}>{keepTogether(line)}</p>
              ))}
            </div>
          ) : null}
          <RiskChips risks={item.risks} />
        </Block>
      ) : null}
      {answered ? (
        <Block className="space-y-3 px-4 py-3" id={PANEL_IDS.answer}>
          {item.publicNote ? (
            <div data-slot="team-question" className="space-y-1">
              <p className="text-sm font-medium">{questionLabel(teamName)}</p>
              <p className="text-sm whitespace-pre-line break-words">{item.publicNote}</p>
            </div>
          ) : null}
          <ProposerAnswers answers={answers} show="ultima" />
        </Block>
      ) : null}
      {needs ? <PanelNeedsBlock needs={needs} href={needsHref} /> : null}
      {when ? (
        <Block className="space-y-1.5 px-4 py-3" id={PANEL_IDS.when}>
          <p id={whenId} className="text-sm font-medium">
            {DIALOG_COMMON_TEXT.when}
          </p>
          <WhenControl workspaceId={workspaceId} item={decisionItem} today={today} canDecide={canDecide} labelledBy={whenId} />
        </Block>
      ) : null}
    </div>
  );
}

/** «Valore 12.250 € l'anno»: una riga (B.1.6), mai insieme al costo. */
function PanelValueLine({ value }: { value: HubItem["value"] }) {
  const text = panelValueText(value);
  const counted = Boolean(value?.perYear && value.perYear.amount > 0);
  return (
    <p data-figure="valore" className="text-sm">
      <span className="text-muted-foreground">{PANEL_FIGURE_TEXT.value}</span> <span className={counted ? "font-medium tabular-nums" : "text-muted-foreground tabular-nums"}>{keepTogether(text.slice(PANEL_FIGURE_TEXT.value.length + 1))}</span>
    </p>
  );
}

/** «Costo 420 € + 300 € l'anno»: una riga (B.1.6), con la fonte quando non è «Benefici e costi» (D5). */
function PanelCostLine({ cost, bands }: { cost: HubItem["cost"]; bands?: readonly CostBandInfo[] }) {
  const parts = panelCostParts(cost, bands);
  return (
    <p data-figure="costo" data-estimated={parts.estimated ? "true" : undefined} data-cost-source={cost && !parts.estimated ? cost.source : undefined} className="text-sm">
      <span className="text-muted-foreground">{PANEL_FIGURE_TEXT.cost}</span>{" "}
      <span className={parts.estimated ? "text-muted-foreground" : "font-medium tabular-nums"}>{keepTogether(parts.figure)}</span>
      {parts.source && cost ? (
        <>
          <span className="text-muted-foreground">{FIGURE_SEPARATOR}</span>
          <SourceTag figure="costo" source={cost.source} />
        </>
      ) : null}
    </p>
  );
}

/**
 * «Cosa serve · 9» nel pannello (rilascio 6, B.1.5): il conteggio al posto delle voci, i gruppi per
 * stato in una riga e una barra sottile, nascosta ai lettori di schermo (i numeri li dice la riga). Il
 * tocco apre «Cosa serve» nella scheda.
 */
export function PanelNeedsBlock({ needs, href }: { needs: PanelNeeds; href: string }) {
  const summary = needs.summary;
  const pieces = needsCountPieces(summary);
  const bar = needsCountBar(summary);
  const total = bar.reduce((sum, part) => sum + part.count, 0);
  return (
    <Block>
      <Link
        href={href}
        data-slot="panel-needs"
        className="group block space-y-1.5 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium underline-offset-4 group-hover:underline">{keepTogether(needsCountTitle(summary.open))}</span>
          <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        </span>
        {pieces.length ? <span className="block text-xs text-muted-foreground tabular-nums">{keepTogether(pieces.join(FIGURE_SEPARATOR))}</span> : null}
        {total > 0 ? (
          <span aria-hidden data-slot="needs-bar" className="flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full bg-muted">
            {bar.map((part) => (
              <span key={part.group} data-group={part.group} className={cn("h-full rounded-full", SEMAFORO_TONE[part.tone].fill)} style={{ width: `${(part.count / total) * 100}%` }} />
            ))}
          </span>
        ) : null}
      </Link>
    </Block>
  );
}

function ContributorBody({
  workspaceId,
  item,
  answer,
  dossierDown,
  teamName,
  referentState,
}: {
  workspaceId: string;
  item: ContributorUseCase;
  answer: InfoAnswer | null;
  dossierDown: boolean;
  teamName: string;
  referentState: ReferentStateKey | null;
}) {
  // «Serve info» su una propria proposta: la domanda e «Rispondi» (D17).
  const asked = item.own && item.phase === "da_valutare" && item.subState === "serve_info";
  return (
    <div className="flex flex-1 flex-col divide-y">
      <Block>
        <div className="flex flex-wrap items-center gap-2">
          {item.own ? <OwnMarker /> : null}
          <PhasePill label={shownPhaseLabel(item, dossierDown)} phase={item.phase} subState={item.subState} />
          <ReferentChip state={referentState} />
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
