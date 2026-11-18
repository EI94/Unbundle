import type { Participation } from "@/lib/portfolio/participation";
import { HOME_TEXT } from "@/lib/home/text";
import { formatInteger } from "@/lib/use-cases/format";

/**
 * «Chi propone, per area» (prototipo S1c), dentro la sua piega: quanti use case arrivano da ogni area, dalla più alta,
 * con una barra in proporzione alla prima, e sotto la riga delle società. Solo etichette e numeri già aggregati
 * (`getPortfolioParticipation`), mai chi propone (art. 15.4). Senza stato.
 */
export function ParticipationList({ participation }: { participation: Participation }) {
  const t = HOME_TEXT.contributor;
  const top = Math.max(1, ...participation.rows.map((row) => row.count));
  return (
    <div data-slot="participation" className="space-y-4">
      <ol className="space-y-3">
        {participation.rows.map((row) => (
          <li key={row.label} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 font-medium break-words">{row.label}</span>
              <span className="shrink-0 tabular-nums">
                {formatInteger(row.count)}
                <span className="sr-only">{t.areaCount}</span>
                {row.bestPractices > 0 ? <span className="ml-2 text-xs text-muted-foreground">{t.toSpread(row.bestPractices)}</span> : null}
              </span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div className="h-full rounded-full bg-primary" style={{ width: `${(row.count / top) * 100}%` }} />
            </div>
          </li>
        ))}
      </ol>
      {participation.companies.length > 0 ? (
        <p className="text-xs text-muted-foreground tabular-nums">{t.companies(participation.companies.map((company) => `${company.label} ${formatInteger(company.count)}`).join(" · "))}</p>
      ) : null}
    </div>
  );
}
