import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Participation } from "@/lib/portfolio/participation";

/**
 * «Partecipazione per area»: proposte per area, dalla più alta, con una barra in
 * proporzione alla prima e, sotto, la riga delle società. Componente del server: riceve
 * solo etichette e numeri già aggregati (`getPortfolioParticipation`), mai chi propone.
 * Le etichette sono uniche (`summarizeParticipation` unisce quelle uguali) e vanno a capo.
 */
export function ParticipationCard({ participation }: { participation: Participation }) {
  const { rows, companies } = participation;
  const top = Math.max(1, ...rows.map((row) => row.count));

  return (
    <Card className="max-w-2xl" data-testid="participation-by-area">
      <CardHeader>
        <CardTitle>Partecipazione per area</CardTitle>
        <CardDescription>Quante proposte arrivano da ogni area. Non conta chi le scrive.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.length === 0 ? (
          <p className="text-muted-foreground">Ancora nessuna proposta dai colleghi.</p>
        ) : (
          <ol className="space-y-3" aria-label="Proposte per area">
            {rows.map((row) => (
              <li key={row.label} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 break-words font-medium">{row.label}</span>
                  <span className="shrink-0 tabular-nums">
                    {row.count}
                    <span className="sr-only">{row.count === 1 ? " proposta" : " proposte"}</span>
                    {row.bestPractices > 0 && (
                      <>
                        {" "}
                        <span className="ml-1 text-xs text-muted-foreground">di cui {row.bestPractices} best practice</span>
                      </>
                    )}
                  </span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${(row.count / top) * 100}%` }} />
                </div>
              </li>
            ))}
          </ol>
        )}
        {companies.length > 0 && (
          <p className="text-xs text-muted-foreground tabular-nums">
            Per società: {companies.map((company) => `${company.label} ${company.count}`).join(" · ")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
