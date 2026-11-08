"use client";

import { RotateCcw, Send, UserRound } from "lucide-react";
import { ActionMenu, type ActionMenuItem } from "@/components/uc/ui/action-menu";
import { Button } from "@/components/ui/button";
import {
  adoptReferentBenefitAction,
  adoptReferentEstimateAction,
  keepReferentBenefitAction,
  keepTeamEstimateAction,
  markCorrectionDoneAction,
  remindReferentRequestAction,
  retryReferentRequestEmailAction,
} from "@/lib/actions/use-case-referents";
import { formatDayInYear } from "@/lib/use-cases/format";
import type { UseCaseReferentPanel } from "@/lib/use-cases/referent/contract";
import { REFERENT_BLOCK_TEXT, fillText } from "@/lib/use-cases/referent/labels";
import { arriveAt } from "../arrival";
import { VALUATION_PREFILL_EVENT, type ValuationPrefill } from "../value-model-draft";
import { REFERENT_STATE_TEXT, REFERENT_STATE_TONE } from "@/lib/use-cases/referent/use-case-state";
import { SEMAFORO_TONE } from "@/components/uc/common/semaforo-tone";
import { cn } from "@/lib/utils";
import { assignEntry, assignModeOf, referentRequestOf } from "./assign-dialog-state";
import type { ReferentDialog } from "./dialogs";
import { referentBlockModel, type BenefitLines, type BlockButton, type BlockMenuKey } from "./referent-block-view";
import { useReferentRunner } from "./referent-actions";

const T = REFERENT_BLOCK_TEXT;
const ACTION = "min-h-11 sm:min-h-8";

/** L'ancora del blocco e il titolo che prende il fuoco quando la finestra si chiude. */
export const REFERENT_BLOCK_IDS = Object.freeze({ section: "referente", heading: "referente-titolo" });

export interface ReferentBlockProps {
  workspaceId: string;
  useCaseId: string;
  panel: UseCaseReferentPanel;
  canEdit: boolean;
  /** Il riquadro «Prossimo passo» ha il pulsante pieno «Scegli il referente»: qui non si ripete. */
  boxOwnsChoose: boolean;
  /** `canEditValuation`. */
  canEditValuation: boolean;
  today: string;
  onOpen: (dialog: ReferentDialog) => void;
  /** La versione dello use case letta (per «Usa la stima di {Nome}»). */
  useCaseVersion?: number;
  /** (§9.2, §9.3) Le azioni del team sulla risposta. */
  withReview?: boolean;
}

/**
 * Il blocco «Referente» in cima a «Cosa serve» (rilascio 5, §9.2): chi è il referente e a che punto
 * è, la sua conferma e la sua stima quando arrivano, le azioni sulla sua richiesta. Mai un pulsante
 * pieno: quello della pagina sta nel riquadro «Prossimo passo».
 */
export function ReferentBlock({ workspaceId, useCaseId, panel, canEdit, boxOwnsChoose, canEditValuation, today, onOpen, useCaseVersion, withReview = false }: ReferentBlockProps) {
  const { pending, run } = useReferentRunner();
  const review = useReferentRunner();
  const referent = panel.referent ?? null;
  const request = referentRequestOf(panel);
  const entry = assignEntry(panel);
  const canAsk = canEdit && panel.canAsk;
  const model = referentBlockModel({
    referent,
    request,
    canAssign: entry.canOpen,
    canAsk,
    boxOwnsChoose,
    canAskMore: entry.canOpen && assignModeOf(panel) === "chiedi",
    withReview,
    canEditValuation,
    today,
  });
  const tone = SEMAFORO_TONE[REFERENT_STATE_TONE[model.state]];
  const contact = referent ? { id: referent.contact.id, name: referent.contact.name } : null;

  const act = (key: BlockButton["key"], benefit?: string) => {
    if (key === "choose") onOpen({ kind: "assign", mode: "scegli" });
    else if (key === "askAgain") onOpen({ kind: "assign", mode: "di_nuovo" });
    else if (key === "retry" && request) {
      if (!pending) void run(() => retryReferentRequestEmailAction(workspaceId, useCaseId, request.id, request.version), { inDialog: false });
    } else if (benefit) onBenefit(key, benefit);
    else onReview(key);
  };
  // (§9.2, §9.3) La risposta del referente: un clic, mai in silenzio; la pagina si rilegge.
  const check = referent?.check ?? null;
  const starId = referent?.referentRequestId ?? null;
  function onReview(key: BlockButton["key"]) {
    if (!check || !starId || review.pending) return;
    if (key === "review") {
      arriveAt("valutazione");
      return;
    }
    if (key === "addEstimate") {
      const component: ValuationPrefill["component"] = {
        lever: "tempo",
        label: T.prefillLabel,
        kind: "ore",
        volumeYear: check.timesPerMonth !== null ? String(Math.round(check.timesPerMonth * 12 * 100) / 100).replace(".", ",") : "",
        unit: "",
        minutesPerUnit: check.minutesEach !== null ? String(check.minutesEach).replace(".", ",") : "",
        automatablePct: "",
        eurYear: "",
        confidence: "fonte",
        indicator: "",
        basis: fillText(T.prefillBasis, { data: formatDayInYear(check.submittedAt, `${today}T12:00:00Z`) ?? "" }),
      };
      arriveAt("valutazione");
      requestAnimationFrame(() => window.dispatchEvent(new CustomEvent<ValuationPrefill>(VALUATION_PREFILL_EVENT, { detail: { component } })));
      return;
    }
    if (key === "adopt") {
      void review.run(() => adoptReferentEstimateAction(workspaceId, useCaseId, starId, { requestVersion: check.version, useCaseVersion: useCaseVersion ?? -1 }), { inDialog: false, refreshOnSuccess: true });
      return;
    }
    if (key === "correctionDone") {
      void review.run(() => markCorrectionDoneAction(workspaceId, useCaseId, starId, check.version), { inDialog: false, refreshOnSuccess: true, successToast: false });
      return;
    }
    void review.run(() => keepTeamEstimateAction(workspaceId, useCaseId, starId, check.version), { inDialog: false, refreshOnSuccess: true, successToast: false });
  }
  // (Rilascio 5.1) Su una voce: «Usa la stima di {Nome}» cambia solo i suoi numeri; «Tieni la nostra», «Fatto», «Non serve» l'esito.
  function onBenefit(key: BlockButton["key"], benefit: string) {
    if (!check || !starId || review.pending) return;
    if (key === "review") {
      arriveAt("valutazione");
      return;
    }
    if (key === "adopt") {
      void review.run(() => adoptReferentBenefitAction(workspaceId, useCaseId, starId, benefit, { requestVersion: check.version, useCaseVersion: useCaseVersion ?? -1 }), { inDialog: false, refreshOnSuccess: true });
      return;
    }
    void review.run(() => keepReferentBenefitAction(workspaceId, useCaseId, starId, benefit, check.version), { inDialog: false, refreshOnSuccess: true, successToast: false });
  }
  const reviewPending = review.pending;
  const menuAct: Record<BlockMenuKey, () => void> = {
    remind: () => {
      if (request && !pending) void run(() => remindReferentRequestAction(workspaceId, useCaseId, request.id, request.version), { inDialog: false });
    },
    askMore: () => onOpen({ kind: "assign", mode: "chiedi" }),
    change: () => onOpen({ kind: "assign", mode: "cambia" }),
    revoke: () => {
      if (request) onOpen({ kind: "revoke", request, referent: true });
    },
    correct: () => {
      if (contact) onOpen({ kind: "correct", contact });
    },
    erase: () => {
      if (contact) onOpen({ kind: "erase", contact });
    },
  };
  const more: ActionMenuItem[] = model.menu.map((item) =>
    item.allowed
      ? { label: item.label, onSelect: menuAct[item.key], ...(item.key === "erase" ? { destructive: true } : {}) }
      : { label: item.label, disabled: true, ...(item.reason ? { hint: item.reason } : {}) },
  );

  const buttonOf = (button: BlockButton) => (
    <Button
      key={button.key}
      type="button"
      variant={button.variant}
      size="sm"
      className={cn(ACTION, button.variant === "link" && "px-0")}
      aria-busy={(button.key === "retry" ? pending : reviewPending) || undefined}
      data-action={`referent-${button.key}`}
      data-benefit={button.benefit}
      onClick={() => act(button.key, button.benefit)}
    >
      {button.key === "retry" ? <RotateCcw aria-hidden /> : button.key === "choose" || button.key === "askAgain" ? <Send aria-hidden /> : null}
      {button.label}
    </Button>
  );

  // (Rilascio 6, B.1.2) «Manca il referente» con «Indica il referente» nel riquadro «Prossimo passo»: lo
  // stato si dice una volta, lì; il blocco non lo ripete.
  if (model.state === "manca" && boxOwnsChoose) return null;
  // «Manca il referente»: una riga sola, il titolo, la frase e (quando chi guarda può) «Scegli il referente».
  if (model.state === "manca") {
    return (
      <section id={REFERENT_BLOCK_IDS.section} aria-labelledby={REFERENT_BLOCK_IDS.heading} data-slot="referent-block" data-state="manca" className="scroll-mt-20 rounded-xl border bg-card px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <h3 id={REFERENT_BLOCK_IDS.heading} tabIndex={-1} className="rounded-sm text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {T.heading}
            </h3>
            {model.lines.map((line, index) => (
              <p key={index} className="text-sm break-words text-muted-foreground">
                {line.text}
              </p>
            ))}
          </div>
          {model.buttons.map(buttonOf)}
        </div>
      </section>
    );
  }

  return (
    <section id={REFERENT_BLOCK_IDS.section} aria-labelledby={REFERENT_BLOCK_IDS.heading} data-slot="referent-block" data-state={model.state} className="scroll-mt-20 space-y-2 rounded-xl border bg-card px-4 py-3">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <h3 id={REFERENT_BLOCK_IDS.heading} tabIndex={-1} className="rounded-sm text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {T.heading}
          </h3>
          <p data-slot="referent-block-state" className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <UserRound aria-hidden className={cn("size-3.5 shrink-0", tone.text)} />
            <span className="break-words">{REFERENT_STATE_TEXT[model.state]}</span>
          </p>
        </div>
        {more.length ? <ActionMenu items={more} trigger="altro" label={T.more} className="shrink-0" /> : null}
      </div>
      {model.name ? (
        <p className="text-sm break-words">
          <span className="font-medium">{model.name}</span>
          {model.meta ? <span className="text-muted-foreground">{` · ${model.meta}`}</span> : null}
        </p>
      ) : null}
      {model.lines.map((line, index) =>
        line.kind === "quote" ? (
          <blockquote key={index} className="rounded-lg bg-muted/50 px-3 py-2 text-sm break-words whitespace-pre-line">
            {line.text}
          </blockquote>
        ) : (
          <p key={index} className={cn("break-words", line.kind === "muted" ? "text-xs text-muted-foreground" : "text-sm")}>
            {line.text}
          </p>
        ),
      )}
      {model.checkLines.length ? (
        <div data-slot="referent-check" className="space-y-1">
          {model.checkLines.map((line, index) =>
            line.kind === "benefit" ? (
              <BenefitAnswer key={line.benefit.key} lines={line.benefit} buttonOf={buttonOf} />
            ) : line.kind === "button" ? (
              <div key={index} className="pb-1">
                {buttonOf(line.button)}
              </div>
            ) : line.kind === "quote" ? (
              <blockquote key={index} className="rounded-lg bg-muted/50 px-3 py-2 text-sm break-words whitespace-pre-line">
                {line.text}
              </blockquote>
            ) : (
              <p key={index} className={cn("break-words", line.kind === "muted" ? "text-xs text-muted-foreground" : "text-sm")}>
                {line.text}
              </p>
            ),
          )}
        </div>
      ) : null}
      {model.buttons.length ? (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {model.buttons.map(buttonOf)}
        </div>
      ) : null}
    </section>
  );
}

/** (Rilascio 5.1) Una voce di «Benefici e costi» con la risposta del referente e i pulsanti del team su quella voce. */
function BenefitAnswer({ lines, buttonOf }: { lines: BenefitLines; buttonOf: (button: BlockButton) => React.ReactNode }) {
  return (
    <div data-slot="referent-benefit-answer" data-benefit={lines.key} className="space-y-0.5 border-t pt-2 first:border-t-0">
      <p className="text-sm font-medium break-words">{lines.head}</p>
      <p className="text-sm break-words">{lines.says}</p>
      {lines.comment ? <blockquote className="rounded-lg bg-muted/50 px-3 py-2 text-sm break-words whitespace-pre-line">{lines.comment}</blockquote> : null}
      {lines.notes.map((note, index) => (
        <p key={index} className="text-xs break-words text-muted-foreground">
          {note}
        </p>
      ))}
      {lines.buttons.length ? <div className="flex flex-wrap items-center gap-2 pt-1">{lines.buttons.map(buttonOf)}</div> : null}
    </div>
  );
}
