import { Check } from "lucide-react";
import type { GroupItem } from "@/lib/learning/results";
import { cn } from "@/lib/utils";
import { percent } from "./results-format";

/**
 * Le barre di una domanda: quante persone hanno scelto ciascuna risposta.
 * Le stesse barre servono nella pagina e, più grandi, in aula. La risposta
 * giusta si colora solo quando chi presenta decide di mostrarla.
 */

export function ImportantTag({ large = false }: { large?: boolean }) {
  return <span className={cn(
    "inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 font-medium text-amber-200",
    large ? "px-3 py-1 text-sm sm:text-base" : "px-2 py-0.5 text-xs",
  )}>importante</span>;
}

export function ItemBars({ item, showAnswer, large = false }: { item: GroupItem; showAnswer: boolean; large?: boolean }) {
  return <ul className={large ? "space-y-3 [@media(min-height:760px)_and_(max-height:999px)]:space-y-4 [@media(min-height:1000px)]:space-y-6" : "space-y-3"}>
    {item.options.map((option) => {
      const share = percent(option.count, item.answered);
      const right = showAnswer && option.correct;
      const unsure = option.id === "unsure";
      return <li key={option.id} className={large ? "space-y-1.5 [@media(min-height:760px)_and_(max-height:999px)]:space-y-2 [@media(min-height:1000px)]:space-y-2" : "space-y-1.5"}>
        <div className={cn("flex items-start justify-between gap-3", large ? "text-lg sm:text-xl [@media(min-height:760px)_and_(max-height:999px)]:lg:text-2xl [@media(min-height:1000px)]:lg:text-3xl" : "text-sm")}>
          <span className={cn(
            "flex min-w-0 items-start gap-2",
            right && "font-semibold text-emerald-300",
            unsure && !right && "italic text-muted-foreground",
            showAnswer && !option.correct && "text-muted-foreground",
          )}>
            {right && <Check aria-hidden className={cn("shrink-0", large ? "mt-0.5 size-6 lg:size-7" : "mt-0.5 size-4")} />}
            <span className="min-w-0 break-words">{option.text}</span>
            {right && <span className="sr-only">(risposta giusta)</span>}
          </span>
          <span className={cn("shrink-0 tabular-nums", right ? "font-semibold text-emerald-300" : "text-muted-foreground")}>
            {option.count} · {share}%
          </span>
        </div>
        <div aria-hidden className={cn("overflow-hidden rounded-full bg-muted", large ? "h-3.5 sm:h-4 [@media(min-height:760px)_and_(max-height:999px)]:sm:h-5 [@media(min-height:1000px)]:lg:h-7" : "h-2.5")}>
          <div
            className={cn(
              "h-full rounded-full transition-[width,background-color] duration-700 ease-out",
              !showAnswer ? "bg-sky-400/80" : option.correct ? "bg-emerald-500" : "bg-muted-foreground/40",
            )}
            style={{ width: `${share}%` }}
          />
        </div>
      </li>;
    })}
  </ul>;
}

/** Una barra di avanzamento con la sua frase: "Hanno consegnato 12 su 20". */
export function ShareBar({ label, value, total, tone = "sky" }: { label: string; value: number; total: number; tone?: "sky" | "emerald" }) {
  const share = percent(value, total);
  return <div className="space-y-1.5">
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span>{label}</span>
      <span className="tabular-nums text-muted-foreground">{share}%</span>
    </div>
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={value}
      className="h-2 overflow-hidden rounded-full bg-muted"
    >
      <div className={cn("h-full rounded-full transition-[width] duration-700 ease-out", tone === "emerald" ? "bg-emerald-500" : "bg-sky-400/80")} style={{ width: `${share}%` }} />
    </div>
  </div>;
}
