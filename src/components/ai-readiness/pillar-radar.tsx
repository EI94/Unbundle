/**
 * Radar (spider) delle aree, 0–5. SVG server-side: niente librerie, si adatta al tema tramite currentColor e variabili.
 * (Rilascio 10, ondata 7b; audit «Fuori» AD-6) Le etichette stanno fuori dall'ultimo anello, non sul vertice, e la
 * cornice ha margine ai lati: i nomi lunghi non escono dal bordo. Un'area senza punteggio non scrive niente sotto il nome.
 */
export function PillarRadar({
  pillars,
  size = 280,
  label = "Punteggio per area, da 0 a 5",
}: {
  pillars: Array<{ title: string; score: number | null }>;
  size?: number;
  label?: string;
}) {
  const n = pillars.length;
  if (n < 3) return null;
  const pad = 48;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 44;
  const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const point = (i: number, value: number) => {
    const r = (Math.max(0, Math.min(5, value)) / 5) * radius;
    return [cx + r * Math.cos(angle(i)), cy + r * Math.sin(angle(i))] as const;
  };
  /** Il posto dell'etichetta: appena fuori dall'ultimo anello. */
  const labelAt = (i: number) => [cx + (radius + 16) * Math.cos(angle(i)), cy + (radius + 16) * Math.sin(angle(i))] as const;

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
      viewBox={`${-pad} 0 ${size + pad * 2} ${size}`}
      className="mx-auto w-full max-w-[360px]"
      role="img"
      aria-label={label}
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
          fill="var(--viz-readiness)"
          fillOpacity={0.25}
          stroke="var(--viz-readiness)"
          strokeWidth={2}
        />
      )}
      {pillars.map((pillar, i) => {
        const [px, py] = point(i, pillar.score ?? 0);
        const [lx, ly] = labelAt(i);
        const anchor =
          Math.abs(lx - cx) < 12 ? "middle" : lx > cx ? "start" : "end";
        // In alto il nome sale sopra il punto; in basso scende sotto.
        const top = ly < cy - radius / 2 ? -14 : ly > cy + radius / 2 ? 8 : 0;
        return (
          <g key={pillar.title}>
            {hasData && pillar.score != null && (
              <circle cx={px} cy={py} r={3.5} fill="var(--viz-readiness)" />
            )}
            <text
              x={lx}
              y={ly + top}
              textAnchor={anchor}
              className="fill-current"
              fontSize={11}
              opacity={0.85}
            >
              {pillar.title}
            </text>
            <text
              x={lx}
              y={ly + top + 13}
              textAnchor={anchor}
              className="fill-current"
              fontSize={10}
              opacity={0.55}
              data-slot="pillar-radar-score"
            >
              {pillar.score != null ? pillar.score.toFixed(1).replace(".", ",") : ""}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
