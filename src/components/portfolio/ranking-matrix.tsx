import Link from "next/link";
import type { UseCase } from "@/lib/db/schema";

type MatrixItem = Pick<
  UseCase,
  | "id"
  | "title"
  | "overallImpactScore"
  | "overallFeasibilityScore"
  | "overallScore"
  | "portfolioKind"
  | "portfolioReviewStatus"
>;

/**
 * Visualizzazione semplice Impatto (Y) vs Fattibilità (X) 0–5.
 * Render server-side senza librerie esterne.
 */
export function RankingMatrix({
  workspaceId,
  items,
  thresholds,
}: {
  workspaceId: string;
  items: MatrixItem[];
  thresholds: { highImpact: number; highFeasibility: number; midImpact: number };
}) {
  const width = 420;
  const height = 320;
  const padL = 44;
  const padR = 14;
  const padT = 14;
  const padB = 32;

  const toX = (v: number) =>
    padL + ((Math.max(0, Math.min(5, v)) / 5) * (width - padL - padR));
  const toY = (v: number) =>
    height - padB - ((Math.max(0, Math.min(5, v)) / 5) * (height - padT - padB));

  const hiX = toX(thresholds.highFeasibility);
  const hiY = toY(thresholds.highImpact);

  const positioned = items
    .filter(
      (it) =>
        typeof it.overallImpactScore === "number" &&
        typeof it.overallFeasibilityScore === "number"
    )
    .map((it) => ({
      ...it,
      x: toX(it.overallFeasibilityScore ?? 0),
      y: toY(it.overallImpactScore ?? 0),
    }));

  if (positioned.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">
        Appena ci saranno contributi valutati, li vedrai qui sulla matrice.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto rounded-md border bg-background"
      >
        {/* griglia quadranti */}
        <rect
          x={hiX}
          y={padT}
          width={width - padR - hiX}
          height={hiY - padT}
          fill="currentColor"
          className="text-green-500/10"
        />
        <rect
          x={padL}
          y={padT}
          width={hiX - padL}
          height={hiY - padT}
          fill="currentColor"
          className="text-violet-500/10"
        />
        <rect
          x={hiX}
          y={hiY}
          width={width - padR - hiX}
          height={height - padB - hiY}
          fill="currentColor"
          className="text-amber-500/10"
        />
        {/* assi */}
        <line
          x1={padL}
          y1={padT}
          x2={padL}
          y2={height - padB}
          stroke="currentColor"
          className="text-border"
        />
        <line
          x1={padL}
          y1={height - padB}
          x2={width - padR}
          y2={height - padB}
          stroke="currentColor"
          className="text-border"
        />
        {/* soglie */}
        <line
          x1={hiX}
          y1={padT}
          x2={hiX}
          y2={height - padB}
          strokeDasharray="4 3"
          stroke="currentColor"
          className="text-border"
        />
        <line
          x1={padL}
          y1={hiY}
          x2={width - padR}
          y2={hiY}
          strokeDasharray="4 3"
          stroke="currentColor"
          className="text-border"
        />
        {/* labels */}
        <text
          x={padL + 4}
          y={padT + 12}
          className="fill-muted-foreground text-[10px]"
        >
          Strategic Bet
        </text>
        <text
          x={hiX + 4}
          y={padT + 12}
          className="fill-muted-foreground text-[10px]"
        >
          Quick Win
        </text>
        <text
          x={padL + 4}
          y={height - padB - 4}
          className="fill-muted-foreground text-[10px]"
        >
          Not Yet
        </text>
        <text
          x={hiX + 4}
          y={height - padB - 4}
          className="fill-muted-foreground text-[10px]"
        >
          Capability Builder
        </text>
        {/* assi label */}
        <text
          x={padL - 6}
          y={padT + 4}
          textAnchor="end"
          className="fill-muted-foreground text-[10px]"
        >
          Impatto
        </text>
        <text
          x={width - padR}
          y={height - 6}
          textAnchor="end"
          className="fill-muted-foreground text-[10px]"
        >
          Fattibilità →
        </text>
        {/* punti */}
        {positioned.map((it) => (
          <g key={it.id}>
            <circle
              cx={it.x}
              cy={it.y}
              r={7}
              className="fill-primary/80 stroke-background"
              strokeWidth={2}
            />
            <title>{it.title}</title>
          </g>
        ))}
      </svg>
      <ol className="text-xs text-muted-foreground space-y-1">
        {positioned.map((it) => (
          <li key={it.id} className="flex items-center justify-between gap-2">
            <Link
              href={`/dashboard/${workspaceId}/portfolio/review/${it.id}`}
              className="truncate hover:text-foreground"
            >
              • {it.title}
            </Link>
            <span className="tabular-nums">
              {it.overallImpactScore?.toFixed(1)} / {it.overallFeasibilityScore?.toFixed(1)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
