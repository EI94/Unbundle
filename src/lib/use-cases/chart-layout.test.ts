import test from "node:test";
import assert from "node:assert/strict";
import { packStrip, swarm, type PlacedCircle } from "./chart-layout.ts";

// Lo sciame dei punti e la striscia delle bolle senza beneficio (grafici del menu «⋯»). Dati sintetici.

function noOverlap(circles: readonly PlacedCircle[], gap: number, message: string) {
  for (let i = 0; i < circles.length; i++) {
    for (let j = i + 1; j < circles.length; j++) {
      const a = circles[i];
      const b = circles[j];
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= a.r + b.r + gap - 1e-6, `${message}: ${i} e ${j} si toccano`);
    }
  }
}

test("sciame: punti nello stesso posto si aprono di lato, alla stessa altezza, dentro la colonna", () => {
  const points = Array.from({ length: 5 }, () => ({ x: 10, y: 100, r: 5, lo: 6, hi: 54 }));
  const placed = swarm(points, { gap: 1 });
  assert.equal(placed[0].x, 10, "il primo resta al suo dato");
  for (const spot of placed) {
    assert.equal(spot.y, 100, "la y è il dato");
    assert.ok(spot.x >= 6 && spot.x <= 54, `dentro la colonna: ${spot.x}`);
    assert.equal(spot.overlaps, false);
  }
  noOverlap(
    placed.map((spot) => ({ ...spot, r: 5 })),
    1,
    "stessa altezza",
  );
  // Ogni punto il più vicino possibile al suo dato: 10, 21, 32, 43, 54.
  assert.deepEqual(
    placed.map((spot) => Math.round(spot.x)),
    [10, 21, 32, 43, 54],
  );
});

test("sciame: con la colonna piena il punto sale o scende di poco, mai oltre i suoi limiti", () => {
  // Una colonna larga due punti: il terzo e il quarto cambiano altezza, entro 12 px e mai sopra 92
  // (la linea del «Valore alto», per esempio), quindi scendono.
  const points = Array.from({ length: 4 }, () => ({ x: 10, y: 100, r: 5, lo: 6, hi: 28, dy: 12, yLo: 92, yHi: 115 }));
  const placed = swarm(points, { gap: 1 });
  noOverlap(
    placed.map((spot) => ({ ...spot, r: 5 })),
    1,
    "con dy",
  );
  for (const spot of placed) {
    assert.ok(Math.abs(spot.y - 100) <= 12 && spot.y >= 92 && spot.y <= 115, `y ${spot.y}`);
    assert.equal(spot.overlaps, false);
  }
  assert.deepEqual(
    placed.map((spot) => [Math.round(spot.x), Math.round(spot.y)]),
    [
      [10, 100],
      [21, 100],
      [10, 111],
      [21, 111],
    ],
  );
});

test("sciame: senza posto il punto resta dove copre meno, e lo dice", () => {
  const placed = swarm(
    [
      { x: 10, y: 10, r: 5, lo: 10, hi: 10 },
      { x: 10, y: 10, r: 5, lo: 10, hi: 10 },
    ],
    { gap: 1 },
  );
  assert.equal(placed[1].overlaps, true);
  assert.deepEqual([placed[1].x, placed[1].y], [10, 10]);
});

test("sciame: Rondine, quindici punti nella colonna «€» con Valore tra 1,6 e 2,1, su 304 px non si toccano", () => {
  const W = 304;
  const unit = W / 5;
  // Le y della prova di Rondine (29/10/2026), in percentuale dall'alto; il costo all'inizio della fascia 1.
  const tops = [81.9, 82.6, 83.9, 84.6, 85.0, 85.0, 85.0, 85.5, 85.6, 86.1, 86.1, 88.0, 88.3, 88.7, 88.8, 89.7];
  const placed = swarm(
    tops.map((top) => ({ x: 0.01 * W, y: (top / 100) * W, r: 5, lo: 6, hi: 0.2 * W - 6, dy: 0.2 * unit, yLo: 0.4 * W + 6, yHi: W - 6 })),
    { gap: 1 },
  );
  assert.ok(placed.every((spot) => !spot.overlaps));
  noOverlap(
    placed.map((spot) => ({ ...spot, r: 5 })),
    1,
    "Rondine",
  );
  for (const [index, spot] of placed.entries()) assert.ok(Math.abs(spot.y - (tops[index] / 100) * W) <= 0.2 * unit + 1e-9, "al massimo 0,2 punti di Valore");
});

test("striscia: sotto lo zero, ognuna nella sua colonna, senza toccare le bolle di sopra", () => {
  const above: PlacedCircle[] = [{ x: 240, y: 340, r: 13 }];
  const points = Array.from({ length: 12 }, (_, i) => ({ x: i < 8 ? 240 : 144, r: 6 + (i % 3) * 3, lo: 0, hi: 0 })).map((point) => ({
    ...point,
    lo: point.x - 48 + point.r + 2,
    hi: point.x + 48 - point.r - 2,
  }));
  const { placements, bottom } = packStrip(points, { top: 355, gap: 2, placed: above });
  const circles = placements.map((spot, index) => ({ ...spot, r: points[index].r }));
  noOverlap([...above, ...circles], 2, "striscia");
  for (const [index, spot] of placements.entries()) {
    assert.ok(spot.y - points[index].r >= 355 - 1e-9, "mai sopra la striscia");
    assert.ok(spot.x >= points[index].lo - 1e-9 && spot.x <= points[index].hi + 1e-9, "nella sua colonna");
    assert.equal(spot.overlaps, false);
  }
  assert.equal(bottom, Math.max(...circles.map((circle) => circle.y + circle.r)));
  // Il più in alto possibile: la prima bolla tocca il bordo della striscia.
  assert.equal(placements[0].y - points[0].r, 355);
});

test("striscia vuota: il fondo è l'inizio", () => {
  assert.deepEqual(packStrip([], { top: 20 }), { placements: [], bottom: 20 });
});
