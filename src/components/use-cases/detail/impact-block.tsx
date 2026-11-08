import type { ReactNode } from "react";
import type { CostBandInfo } from "@/lib/use-cases/cost-bands";
import { FIGURE_SEPARATOR, formatEuro } from "@/lib/use-cases/format";
import { GUIDED_TEXT, type ImpactItems, type ImpactView } from "@/lib/use-cases/guided";
import type { RiskChip } from "@/lib/use-cases/labels";
import { keepTogether } from "@/lib/use-cases/line-breaks";
import type { UseCaseDetail } from "@/lib/use-cases/views";
import { cn } from "@/lib/utils";
import { CostFigure } from "../cost-figure";
import { Disclosure } from "../disclosure";
import { SourceTag } from "../source-tag";
import { ValueFigure } from "../value-figure";
import { InPageLink } from "./arrival";
import { RiskChips } from "./risk-chips";
import { VALUE_MODEL_EDITOR_TEXT } from "./value-model-draft";

const BIG = "text-5xl font-semibold tracking-tight tabular-nums";
const UNIT = "text-base font-normal text-muted-foreground";

/** Gli euro all'anno con la loro fonte («dal dossier», «team»), accanto o sotto la cifra grande. */
function PerYear({ perYear, big = false }: { perYear: NonNullable<UseCaseDetail["value"]["perYear"]>; big?: boolean }) {
  return big ? (
    <div data-figure="valore" className="min-w-0 space-y-1">
      <p className={BIG}>
        {formatEuro(perYear.amount)} <span className={UNIT}>{GUIDED_TEXT.impact.perYear}</span>
      </p>
      <SourceTag figure="valore_anno" source={perYear.source} form="lunga" className="text-sm" />
    </div>
  ) : (
    <p className="text-sm">
      <span className="text-xl font-semibold tracking-tight tabular-nums">{formatEuro(perYear.amount)}</span> <span className="text-muted-foreground">{GUIDED_TEXT.impact.perYear}</span>
      <span className="text-muted-foreground">{FIGURE_SEPARATOR}</span>
      <SourceTag figure="valore_anno" source={perYear.source} form="lunga" className="text-sm" />
    </p>
  );
}

/** Le voci di «Benefici e costi» fuori dall'editor: conti, chip, come si misura e da dove vengono i numeri. */
function Items({ items }: { items: ImpactItems }) {
  const t = GUIDED_TEXT.impact;
  const term = (row: ImpactItems["origin"][number]) => ("key" in row.term ? VALUE_MODEL_EDITOR_TEXT[row.term.key] : row.term.text);
  const chips = [...items.qualitative.map((label) => ({ label, strong: false })), ...(items.toConfirm ? [{ label: t.toConfirm, strong: true }] : [])];
  if (!items.lines.length && !chips.length && !items.measuredBy && !items.origin.length) return null;
  // (Rilascio 6, B.1.6) In vista la cifra, il costo e il rientro; le voci con il loro conto, i chip e da dove vengono i numeri a un tocco.
  return (
    <Disclosure summary={t.howCounted} slot="impatto-come">
      <div data-slot="impatto-voci-blocco" className="space-y-3">
        {items.lines.length ? (
          <ul data-slot="impatto-voci" className="space-y-1.5 text-sm">
            {items.lines.map((line, index) => (
              <li key={`${line.label}-${index}`} data-slot="impatto-voce" className="break-words">
                <span className="font-medium">{line.label}</span>
                <span className="text-muted-foreground">{FIGURE_SEPARATOR}</span>
                {keepTogether(line.formula)}
                <span className="text-muted-foreground">
                  {FIGURE_SEPARATOR}
                  {line.confidence}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {chips.length ? (
          <ul data-slot="impatto-chip" className="flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <li key={chip.label} className={cn("inline-flex max-w-full items-center rounded-full border border-input px-2 py-0.5 text-xs break-words text-foreground", chip.strong && "font-medium")}>
                {chip.label}
              </li>
            ))}
          </ul>
        ) : null}
        {items.measuredBy || items.origin.length ? (
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-1">
            {items.measuredBy ? <p className="min-w-0 text-sm break-words">{items.measuredBy}</p> : null}
            {items.origin.length ? (
              <Disclosure summary={t.origin} slot="impatto-origine" className="min-w-0">
                <dl className="grid gap-2 text-sm">
                  {items.origin.map((row, index) => (
                    <div key={index} className="grid min-w-0 gap-0.5">
                      <dt className="text-muted-foreground">{term(row)}</dt>
                      <dd className="min-w-0 break-words whitespace-pre-line">{row.detail}</dd>
                    </div>
                  ))}
                </dl>
              </Disclosure>
            ) : null}
          </div>
        ) : null}
      </div>
    </Disclosure>
  );
}

export interface ImpactBlockProps {
  /** `impactView(...)`, sul server. */
  view: ImpactView;
  value: UseCaseDetail["value"];
  cost: UseCaseDetail["cost"];
  costBands: readonly CostBandInfo[];
  risks: readonly RiskChip[];
  className?: string;
}

/**
 * «Impatto» in testa alla scheda dei revisori (rilascio 3): la cifra grande (le ore contate, gli
 * euro all'anno, «fino a …» da misurare, «Qualitativo», la parola del punteggio o «Da stimare»), il
 * costo con la sua fonte, quando rientra l'avvio, i chip di rischio e, con «Benefici e costi», le
 * voci con il loro conto e da dove vengono i numeri. Le stime non ufficiali restano nella piega
 * «Valutazione del team»: qui al massimo una riga che lo dice. Reso sul server, solo per i revisori.
 */
export function ImpactBlock({ view, value, cost, costBands, risks, className }: ImpactBlockProps) {
  const t = GUIDED_TEXT.impact;
  const costLine = <CostFigure cost={cost} bands={costBands} form="lunga" withLabel />;
  let figures: ReactNode;
  let after: ReactNode = null;
  switch (view.variant) {
    case "A":
      figures = (
        <>
          <p data-figure="valore" className={BIG}>
            {view.hoursText} <span className={UNIT}>{view.unit}</span>
          </p>
          <div className="min-w-0 space-y-0.5">
            {view.perYear ? <PerYear perYear={view.perYear} /> : null}
            <p className="text-sm text-muted-foreground">{view.hourly}</p>
          </div>
        </>
      );
      after = (
        <>
          {view.payback ? <p className="text-sm">{view.payback}</p> : null}
          {view.pending ? <p className="text-sm text-muted-foreground">{view.pending}</p> : null}
          <Items items={view.items} />
        </>
      );
      break;
    case "B":
      figures = <PerYear perYear={view.perYear} big />;
      after = (
        <>
          {view.payback ? <p className="text-sm">{view.payback}</p> : null}
          <Items items={view.items} />
        </>
      );
      break;
    case "C":
      figures = (
        <div data-figure="valore" className="min-w-0 space-y-1">
          <p className={BIG}>
            {view.big} <span className={UNIT}>{view.unit}</span>
          </p>
          <p className="text-sm text-muted-foreground">{view.note}</p>
        </div>
      );
      after = <Items items={view.items} />;
      break;
    case "D":
      figures = (
        <div data-figure="valore" className="min-w-0 space-y-1">
          <p className="text-3xl font-semibold tracking-tight">{view.big}</p>
          <p className="text-sm text-muted-foreground">{view.note}</p>
        </div>
      );
      after = <Items items={view.items} />;
      break;
    case "E":
      figures = <PerYear perYear={view.perYear} big />;
      break;
    case "F":
      figures = <ValueFigure value={value} form="lunga" />;
      break;
    case "G":
      figures = (
        <div data-figure="valore" data-estimated="true" className="min-w-0 space-y-1">
          <p className="text-3xl font-semibold tracking-tight text-muted-foreground">{view.big}</p>
          <p className="text-sm text-muted-foreground">
            {view.note} <InPageLink id={view.link.id}>{view.link.label}</InPageLink>
          </p>
          {view.unofficial ? <p className="text-sm text-muted-foreground">{view.unofficial}</p> : null}
        </div>
      );
      break;
  }
  return (
    <section id="impatto" aria-labelledby="impatto-titolo" data-slot="impatto" data-variant={view.variant} className={cn("scroll-mt-20 space-y-4", className)}>
      <h2 id="impatto-titolo" tabIndex={-1} className="text-base font-semibold outline-none">
        {t.title}
      </h2>
      <div className="grid gap-x-8 gap-y-2 @md/scheda:grid-cols-[auto_minmax(0,1fr)] @md/scheda:items-end">{figures}</div>
      {costLine}
      {after}
      <RiskChips risks={risks} />
    </section>
  );
}
