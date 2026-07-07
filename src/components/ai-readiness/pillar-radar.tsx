/**
 * Radar (spider) dei pilastri, 0–5. SVG server-side: niente librerie,
 * si adatta al tema tramite currentColor e variabili.
 */
export function PillarRadar({
  pillars,
  size = 280,
}: {
  pillars: Array<{ title: string; score: number | null }>;
  size?: number;
}) {
  const n = pillars.length;
  if (n < 3) return null;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 44;
  const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const point = (i: number, value: number) => {
    const r = (Math.max(0, Math.min(5, value)) / 5) * radius;
    return [cx + r * Math.cos(angle(i)), cy + r * Math.sin(angle(i))] as const;
  };

  const rings = [1, 2, 3, 4, 5].map((ring) =>
    pillars
      .map((_, i) => point(i, ring).map((v) => v.toFixed(1)).join(","))
      .join(" ")
  );
  const hasData = pillars.some((pillar) => pillar.score != null);
  const scorePolygon = pillars
    .map((pillar, i) => point(i, pillar.score ?? 0).map((v) => v.toFixed(1)).join(","))
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="mx-auto w-full max-w-[320px]"
      role="img"
      aria-label="Radar dei punteggi per pilastro"
      data-testid="pillar-radar"
    >
      {rings.map((points, i) => (
        <polygon
          key={i}
          points={points}
          fill="none"
          stroke="currentColor"
          strokeOpacity={i === 4 ? 0.35 : 0.12}
          strokeWidth={1}
        />
      ))}
      {pillars.map((_, i) => {
        const [x, y] = point(i, 5);
        return (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={x}
            y2={y}
            stroke="currentColor"
            strokeOpacity={0.12}
            strokeWidth={1}
          />
        );
      })}
      {hasData && (
        <polygon
          points={scorePolygon}
          fill="oklch(0.72 0.17 160)"
          fillOpacity={0.25}
          stroke="oklch(0.72 0.17 160)"
          strokeWidth={2}
        />
      )}
      {pillars.map((pillar, i) => {
        const [px, py] = point(i, pillar.score ?? 0);
        const [lx, ly] = point(i, 6.3);
        const anchor =
          Math.abs(lx - cx) < 12 ? "middle" : lx > cx ? "start" : "end";
        return (
          <g key={pillar.title}>
            {hasData && pillar.score != null && (
              <circle cx={px} cy={py} r={3.5} fill="oklch(0.72 0.17 160)" />
            )}
            <text
              x={lx}
              y={ly}
              textAnchor={anchor}
              className="fill-current"
              fontSize={11}
              opacity={0.85}
            >
              {pillar.title}
            </text>
            <text
              x={lx}
              y={ly + 13}
              textAnchor={anchor}
              className="fill-current"
              fontSize={10}
              opacity={0.55}
            >
              {pillar.score != null ? pillar.score.toFixed(1) : "N/D"}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
