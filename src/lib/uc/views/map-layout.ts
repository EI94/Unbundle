/**
 * Posizioni dei passi della mappa della soluzione (PIANO §5.1; la «Vista di
 * analisi» di DESIGN §3.7.2): d3-force con 300 passi sincroni, così il disegno
 * è stabile (stesso grafo, stesse posizioni, sul server e nel browser). I passi
 * si dispongono da sinistra a destra secondo la profondità nel flusso (catena
 * più lunga dagli ingressi), poi le forze evitano le sovrapposizioni. Lo stesso
 * ordine dà l'elenco dei passi (`flowOrder`).
 *
 * Modulo puro (d3-force non usa il DOM).
 */
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum } from "d3";

export const NODE_WIDTH = 168;
export const NODE_HEIGHT = 60;
const COLUMN = 230;
const PADDING = 40;
const TICKS = 300;

interface SimNode extends SimulationNodeDatum {
  id: string;
  depth: number;
}

export interface GraphLayout {
  positions: Map<string, { x: number; y: number }>;
  width: number;
  height: number;
}

/** Profondità di ogni nodo: catena più lunga dagli ingressi, con i cicli interrotti. */
export function nodeDepths(ids: readonly string[], edges: readonly { from: string; to: string }[]): Map<string, number> {
  const out = new Map<string, string[]>();
  const indeg = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const e of edges) {
    if (!indeg.has(e.from) || !indeg.has(e.to) || e.from === e.to) continue;
    out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  }
  const depth = new Map<string, number>(ids.map((id) => [id, 0]));
  // Kahn: i nodi rimasti in un ciclo tengono la profondità raggiunta.
  const queue = ids.filter((id) => (indeg.get(id) ?? 0) === 0);
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of out.get(id) ?? []) {
      depth.set(next, Math.max(depth.get(next) ?? 0, (depth.get(id) ?? 0) + 1));
      indeg.set(next, (indeg.get(next) ?? 0) - 1);
      if ((indeg.get(next) ?? 0) === 0) queue.push(next);
    }
  }
  return depth;
}

/**
 * I passi nell'ordine del flusso, per l'elenco (DESIGN §3.7.2: sotto i 768 px
 * e quando la mappa della soluzione fa da «Con l'agente»): prima la
 * profondità dagli ingressi, poi l'ordine in cui la mappa li elenca.
 */
export function flowOrder<T extends { id: string }>(nodes: readonly T[], edges: readonly { from: string; to: string }[]): T[] {
  const depths = nodeDepths(
    nodes.map((n) => n.id),
    edges,
  );
  return nodes
    .map((n, i) => ({ n, i, d: depths.get(n.id) ?? 0 }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map((x) => x.n);
}

export function layoutGraph(nodes: readonly { id: string }[], edges: readonly { from: string; to: string }[]): GraphLayout {
  if (nodes.length === 0) return { positions: new Map(), width: 2 * PADDING, height: 2 * PADDING };
  const ids = nodes.map((n) => n.id);
  const depths = nodeDepths(ids, edges);
  // Posizione di partenza per colonna (deterministica), poi le forze.
  const perColumn = new Map<number, number>();
  const simNodes: SimNode[] = ids.map((id) => {
    const depth = depths.get(id) ?? 0;
    const row = perColumn.get(depth) ?? 0;
    perColumn.set(depth, row + 1);
    return { id, depth, x: depth * COLUMN, y: row * (NODE_HEIGHT + 40) };
  });
  const known = new Set(ids);
  const simLinks: SimulationLinkDatum<SimNode>[] = edges.filter((e) => known.has(e.from) && known.has(e.to) && e.from !== e.to).map((e) => ({ source: e.from, target: e.to }));
  const sim = forceSimulation<SimNode>(simNodes)
    .force("link", forceLink<SimNode, SimulationLinkDatum<SimNode>>(simLinks).id((d) => d.id).distance(COLUMN * 0.8).strength(0.3))
    .force("charge", forceManyBody<SimNode>().strength(-420))
    .force("x", forceX<SimNode>((d) => d.depth * COLUMN).strength(0.9))
    .force("y", forceY<SimNode>(0).strength(0.06))
    .force("collide", forceCollide<SimNode>(Math.hypot(NODE_WIDTH, NODE_HEIGHT) / 2 + 6).strength(1))
    .stop();
  for (let i = 0; i < TICKS; i++) sim.tick();
  const xs = simNodes.map((n) => n.x ?? 0);
  const ys = simNodes.map((n) => n.y ?? 0);
  const minX = Math.min(...xs) - NODE_WIDTH / 2;
  const minY = Math.min(...ys) - NODE_HEIGHT / 2;
  const maxX = Math.max(...xs) + NODE_WIDTH / 2;
  const maxY = Math.max(...ys) + NODE_HEIGHT / 2;
  const positions = new Map<string, { x: number; y: number }>();
  for (const n of simNodes) positions.set(n.id, { x: Math.round((n.x ?? 0) - minX + PADDING), y: Math.round((n.y ?? 0) - minY + PADDING) });
  return { positions, width: Math.round(maxX - minX + 2 * PADDING), height: Math.round(maxY - minY + 2 * PADDING) };
}

/** Punto sul bordo del rettangolo del nodo lungo la retta verso `to` (per le frecce). */
export function edgeAnchor(from: { x: number; y: number }, to: { x: number; y: number }, w = NODE_WIDTH, h = NODE_HEIGHT): { x: number; y: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return { ...from };
  const sx = dx === 0 ? Number.POSITIVE_INFINITY : w / 2 / Math.abs(dx);
  const sy = dy === 0 ? Number.POSITIVE_INFINITY : h / 2 / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: from.x + dx * s, y: from.y + dy * s };
}

/** Etichetta su al massimo due righe di circa `max` caratteri, con i puntini se non ci sta. */
export function wrapLabel(label: string, max = 24): string[] {
  const words = label.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let i = 0;
  while (i < words.length && lines.length < 2) {
    let line = words[i];
    i++;
    while (i < words.length && `${line} ${words[i]}`.length <= max) {
      line = `${line} ${words[i]}`;
      i++;
    }
    lines.push(line.length > max ? `${line.slice(0, max - 1)}…` : line);
  }
  if (i < words.length && lines.length > 0) {
    const last = lines[lines.length - 1];
    if (!last.endsWith("…")) lines[lines.length - 1] = `${last.length >= max ? last.slice(0, max - 1) : last}…`;
  }
  return lines;
}
