import type { ReactNode } from "react";
import Link from "next/link";
import { Pencil } from "lucide-react";
import { BigNumber } from "@/components/ui-10/big-number";
import { Button } from "@/components/ui/button";
import { REALIZATION_TEXT } from "@/lib/uc/views/realization";
import type { CostBandInfo } from "@/lib/use-cases/cost-bands";
import { FIGURE_SEPARATOR, costTextParts, formatEuro, lowerFirst } from "@/lib/use-cases/format";
import { GUIDED_TEXT, type ImpactItems, type ImpactView, type RealizationAccount } from "@/lib/use-cases/guided";
import type { RiskChip } from "@/lib/use-cases/labels";
import { keepTogether } from "@/lib/use-cases/line-breaks";
import type { UseCaseDetail } from "@/lib/use-cases/views";
import { cn } from "@/lib/utils";
import { Disclosure } from "../disclosure";
import { ValueFigure } from "../value-figure";
import { InPageLink } from "./arrival";
import { RiskChips } from "./risk-chips";
import { VALUE_MODEL_EDITOR_TEXT } from "./value-model-draft";

const NOTE = "text-sm text-muted-foreground";

/** Il simbolo della fascia in testa alla cifra lunga del costo («€€ · 30.000 €»). */
const BAND_SYMBOL = new RegExp(`^€+${FIGURE_SEPARATOR}`);

/** `{x}` → il valore. */
const fill = (template: string, values: Readonly<Record<string, string>>): string => template.replace(/\{([a-z]+)\}/g, (whole, key: string) => values[key] ?? whole);

/** «Pareggio in circa 8 mesi a regime.» → «pareggio in circa 8 mesi a regime»: un pezzo della riga del costo. */
function paybackPiece(payback: string | null): string | null {
  return payback ? lowerFirst(payback).replace(/\.$/, "") : null;
}

/** Le voci di «Benefici e costi» fuori dall'editor: conti, chip, come si misura e da dove vengono i numeri. */
function Items({ items }: { items: ImpactItems }) {
  const t = GUIDED_TEXT.impact;
  const term = (row: ImpactItems["origin"][number]) => ("key" in row.term ? VALUE_MODEL_EDITOR_TEXT[row.term.key] : row.term.text);
  const chips = [...items.qualitative.map((label) => ({ label, strong: false })), ...(items.toConfirm ? [{ label: t.toConfirm, strong: true }] : [])];
  if (!items.lines.length && !chips.length && !items.measuredBy && !items.origin.length) return null;
  // (Rilascio 10, §3.4) Una piega sola, «Come si calcola»: le voci con il loro conto, i chip, come si misura e, sotto un
  // titolo, da dove vengono i numeri. Niente piega dentro la piega.
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
        {items.measuredBy ? <p className="min-w-0 text-sm break-words">{items.measuredBy}</p> : null}
        {items.origin.length ? (
          <div data-slot="impatto-origine" className="min-w-0 space-y-2">
            <h3 className="text-sm font-medium">{t.origin}</h3>
            <dl className="grid gap-2 text-sm">
              {items.origin.map((row, index) => (
                <div key={index} className="grid min-w-0 gap-0.5">
                  <dt className="text-muted-foreground">{term(row)}</dt>
                  <dd className="min-w-0 break-words whitespace-pre-line">{row.detail}</dd>
                </div>
              ))}
            </dl>
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
  /**
   * (Rilascio 10, D10) Il conto della realizzazione (`realizationAccountOf`): con la realizzazione avviata, e solo per
   * chi la legge, la cifra è la sua. null: la stima del team.
   */
  account?: RealizationAccount | null;
  /** `canEditValuation`: «Modifica» accanto al titolo apre «Valutazione del team». */
  canEdit?: boolean;
  className?: string;
}

/**
 * «Valore» in testa alla scheda dei revisori (rilascio 3; rilascio 10, §3.4 e D10): il numero grande (gli euro
 * all'anno, le ore contate, «fino a …» da misurare, «Qualitativo», la parola del punteggio o «Da stimare»), sotto una
 * riga grigia con il costo di realizzazione, la sua fonte e il pareggio, poi una piega sola, «Come si calcola», con le
 * voci di «Benefici e costi» e da dove vengono i numeri, e i chip di rischio. «Modifica» accanto al titolo apre
 * «Valutazione del team». Con la realizzazione avviata (D10) la cifra, il costo e il pareggio sono quelli del suo
 * conto, e «Come si calcola» porta alla realizzazione: lo stesso use case non ha due valori. Le stime non ufficiali
 * restano in «Valutazione del team». Reso sul server, solo per i revisori.
 */
export function ImpactBlock({ view, value, cost, costBands, risks, account = null, canEdit = false, className }: ImpactBlockProps) {
  const t = GUIDED_TEXT.impact;
  let figure: ReactNode = null;
  let notes: ReactNode = null;
  let pieces: Array<ReactNode | null> = [];
  let how: ReactNode = null;

  if (account) {
    figure = (
      <div data-figure="valore" data-source="dossier" className="min-w-0">
        <BigNumber value={account.benefit} label={REALIZATION_TEXT.benefit} />
      </div>
    );
    pieces = [
      <span key="costo" data-figure="costo" data-cost-source="dossier">
        {keepTogether(fill(t.costLine, { costo: account.cost ?? REALIZATION_TEXT.toCompute }))}
      </span>,
      t.fromRealization,
      account.breakEven ? keepTogether(fill(t.breakEven, { mesi: account.breakEven })) : null,
    ];
    how = (
      <Disclosure summary={t.howCounted} slot="impatto-come">
        <p className="text-sm">
          {t.realizationAccount}{" "}
          {account.href ? (
            <Link href={account.href} className="underline underline-offset-4 outline-none hover:decoration-2 focus-visible:ring-3 focus-visible:ring-ring/50">
              {REALIZATION_TEXT.open}
            </Link>
          ) : null}
        </p>
      </Disclosure>
    );
  } else {
    const parts = costTextParts(cost, "lunga", costBands);
    const source = cost && !parts.estimated ? cost.source : null;
    // Senza valore e senza costo basta «Da stimare»: niente riga «Costo di realizzazione da stimare».
    pieces =
      view.variant === "G" && parts.estimated
        ? []
        : [
            // Con «Benefici e costi» la cifra dice già «Costo 560 € · costo all'anno 600 €»: niente «Costo di realizzazione» davanti.
            // Il simbolo della fascia («€€») resta per la matrice: qui l'importo, o la fascia a parole.
            <span key="costo" data-figure="costo" data-estimated={parts.estimated ? "true" : undefined} data-cost-source={source ?? undefined}>
              {parts.figureParts.length > 1
                ? parts.figureParts.map((part, index) => (
                    <span key={part}>
                      {index > 0 ? FIGURE_SEPARATOR : null}
                      <span className="whitespace-nowrap">{part}</span>
                    </span>
                  ))
                : keepTogether(fill(t.costLine, { costo: parts.figure.replace(BAND_SYMBOL, "") }))}
            </span>,
            source ? parts.source : null,
          ];
    const perYearFigure = (perYear: NonNullable<UseCaseDetail["value"]["perYear"]>) => (
      <div data-figure="valore" data-source={perYear.source} className="min-w-0">
        <BigNumber value={formatEuro(perYear.amount)} label={REALIZATION_TEXT.benefit} />
      </div>
    );
    switch (view.variant) {
      case "A":
        figure = view.perYear ? (
          perYearFigure(view.perYear)
        ) : (
          <div data-figure="valore" className="min-w-0">
            <BigNumber value={view.hoursText} label={view.unit} />
          </div>
        );
        notes = (
          <>
            <p className={NOTE}>{keepTogether(view.perYear ? `${view.hoursText} ${view.unit} ${view.hourly}` : view.hourly)}</p>
            {view.pending ? <p className={NOTE}>{keepTogether(view.pending)}</p> : null}
          </>
        );
        pieces.push(paybackPiece(view.payback));
        how = <Items items={view.items} />;
        break;
      case "B":
        figure = perYearFigure(view.perYear);
        pieces.push(paybackPiece(view.payback));
        how = <Items items={view.items} />;
        break;
      case "C":
        figure = (
          <div data-figure="valore" className="min-w-0">
            <BigNumber value={view.big} label={view.unit} note={view.note} />
          </div>
        );
        how = <Items items={view.items} />;
        break;
      case "D":
        figure = (
          <div data-figure="valore" className="min-w-0 space-y-0.5">
            <p className="text-base font-semibold">{view.big}</p>
            <p className={NOTE}>{view.note}</p>
          </div>
        );
        how = <Items items={view.items} />;
        break;
      case "E":
        figure = perYearFigure(view.perYear);
        break;
      case "F":
        figure = <ValueFigure value={value} form="lunga" />;
        break;
      case "G":
        figure = (
          <div data-figure="valore" data-estimated="true" className="min-w-0 space-y-1">
            <p className="text-base font-semibold text-muted-foreground">{view.big}</p>
            <p className={NOTE}>
              {view.note} <InPageLink id={view.link.id}>{view.link.label}</InPageLink>
            </p>
            {view.unofficial ? <p className={NOTE}>{view.unofficial}</p> : null}
          </div>
        );
        break;
    }
  }

  const line = pieces.filter((piece): piece is NonNullable<ReactNode> => piece !== null && piece !== "");
  // «Modifica» quando la cifra è la stima del team e c'è qualcosa da modificare; «Da stimare» ha già il suo link.
  const edit = canEdit && !account && view.variant !== "G";
  return (
    <section id="valore" aria-labelledby="valore-titolo" data-slot="valore" data-variant={account ? "conto" : view.variant} className={cn("scroll-mt-20 space-y-3", className)}>
      <div className="flex min-w-0 items-center justify-between gap-3">
        <h2 id="valore-titolo" tabIndex={-1} className="text-base font-semibold outline-none">
          {t.title}
        </h2>
        {edit ? (
          <Button
            render={<InPageLink id="valutazione" aria-label={t.editLabel} />}
            nativeButton={false}
            variant="ghost"
            size="sm"
            data-slot="valore-modifica"
            className="min-h-11 shrink-0 text-muted-foreground sm:min-h-8"
          >
            <Pencil aria-hidden />
            {t.edit}
          </Button>
        ) : null}
      </div>
      {figure}
      {notes}
      {line.length ? (
        <p data-slot="valore-riga" className={NOTE}>
          {line.map((piece, index) => (
            <span key={index}>
              {index > 0 ? FIGURE_SEPARATOR : null}
              {piece}
            </span>
          ))}
        </p>
      ) : null}
      {how}
      <RiskChips risks={risks} />
    </section>
  );
}
