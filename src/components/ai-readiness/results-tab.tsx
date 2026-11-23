import Link from "next/link";
import { UserPlus } from "lucide-react";
import { READINESS_TEXT, formatScore } from "@/lib/ai-readiness/dashboard-text";
import { READINESS_ANCHORS } from "@/lib/ai-readiness/dashboard-view";
import { BigNumber } from "@/components/ui-10/big-number";
import { EmptyState } from "@/components/ui-10/empty-state";
import { Fold } from "@/components/ui-10/fold";
import { Button } from "@/components/ui/button";
import { PillarRadar } from "./pillar-radar";

const R = READINESS_TEXT.results;

export interface ResultsTabProps {
  /** I questionari inviati. */
  responses: number;
  threshold: number;
  thresholdMet: boolean;
  /** Il numero grande: l'indice di prontezza, con la maturità e l'area più debole. */
  index: { value: string; note: string } | null;
  /** Le aree, con il nome in italiano. */
  areas: ReadonlyArray<{ id: string; title: string; description: string; score: number | null }>;
  strengths: ReadonlyArray<{ title: string; score: number }>;
  attention: ReadonlyArray<{ title: string; score: number }>;
  /** Le aree che solo la scheda dei referenti misura, e che nessun referente ha ancora compilato. */
  missingInternal: readonly string[];
  /** «Invita un referente» (a chi gestisce): il pannello dell'invito in «Raccolta». */
  inviteHref: string | null;
  teams: ReadonlyArray<{ unit: string; responses: number; thresholdMet: boolean; score: number | null; weakest: string | null }>;
}

function ScoreRows({ title, rows }: { title: string; rows: ReadonlyArray<{ title: string; score: number }> }) {
  if (!rows.length) return null;
  return (
    <section className="space-y-1" aria-label={title}>
      <h2 className="text-base font-semibold">{title}</h2>
      <ul className="divide-y rounded-xl border bg-card">
        {rows.map((row) => (
          <li key={row.title} className="flex min-h-11 items-center justify-between gap-3 px-4 py-2 text-sm sm:min-h-10">
            <span className="min-w-0 break-words">{row.title}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{formatScore(row.score)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * «Risultati» (rilascio 10, ondata 7b, §3.9; audit «Fuori» §8.4): il numero grande (l'indice di prontezza), il radar,
 * i punti di forza e di attenzione, l'avviso sulle schede dei referenti; i punteggi per area e per team in due pieghe
 * chiuse. A zero risposte una frase sola. I gruppi sotto la soglia non mostrano punteggi.
 */
export function ResultsTab(p: ResultsTabProps) {
  if (p.responses <= 0) return <EmptyState text={R.empty} />;
  const scoredTeams = p.teams.length;
  return (
    <div className="space-y-8" data-slot="readiness-results">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
        <div className="space-y-6">
          {p.index ? <BigNumber value={p.index.value} label={R.indexLabel} note={p.index.note} /> : null}
          <ScoreRows title={R.strengths} rows={p.strengths} />
          <ScoreRows title={R.attention} rows={p.attention} />
        </div>
        <div data-slot="readiness-radar" className="rounded-xl border bg-card p-4 text-foreground">
          <PillarRadar label={R.radarLabel} pillars={p.areas.map((area) => ({ title: area.title, score: area.score }))} />
          {!p.thresholdMet ? <p className="mt-2 text-center text-xs text-muted-foreground">{R.belowThreshold(p.threshold)}</p> : null}
        </div>
      </div>

      {p.missingInternal.length ? (
        <section className="space-y-2 rounded-xl border p-4" aria-label={R.missingInternal(p.missingInternal.join(" e "))} data-testid="missing-internal-pillars-notice">
          <p className="text-sm font-medium">{R.missingInternal(p.missingInternal.join(" e "))}</p>
          <p className="text-sm text-muted-foreground">{R.missingInternalWhy}</p>
          {p.inviteHref ? (
            <Button variant="outline" className="min-h-11 sm:min-h-9" render={<Link href={p.inviteHref} scroll={false} />} nativeButton={false}>
              <UserPlus aria-hidden data-icon="inline-start" />
              {R.inviteReferent}
            </Button>
          ) : null}
        </section>
      ) : null}

      <div>
        <Fold id={READINESS_ANCHORS.byArea} title={R.byArea} summary={R.byAreaSummary(p.areas.length)}>
          <ul className="space-y-4 pb-4">
            {p.areas.map((area) => {
              const score = formatScore(area.score);
              return (
                <li key={area.id} className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="font-medium">{area.title}</span>
                    {score ? <span className="tabular-nums text-muted-foreground">{score}</span> : null}
                  </div>
                  <p className="text-xs text-muted-foreground">{area.description}</p>
                  <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <div className="h-full rounded-full bg-primary" style={{ width: `${typeof area.score === "number" ? (Math.max(0, Math.min(5, area.score)) / 5) * 100 : 0}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </Fold>
        {scoredTeams ? (
          <Fold id={READINESS_ANCHORS.byTeam} title={R.byTeam} summary={R.byTeamSummary(scoredTeams)}>
            <ul className="mb-4 divide-y rounded-xl border bg-card">
              {p.teams.map((team) => {
                const score = team.thresholdMet ? formatScore(team.score) : null;
                return (
                  <li key={team.unit} className="flex min-h-11 flex-col gap-0.5 px-4 py-2 text-sm sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                    <span className="min-w-0 font-medium break-words">{team.unit}</span>
                    <span className="text-muted-foreground">
                      {[R.teamAnswers(team.responses), score ?? R.teamBelow(p.threshold), team.thresholdMet && team.weakest ? R.teamWeakest(team.weakest) : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Fold>
        ) : null}
      </div>
    </div>
  );
}
