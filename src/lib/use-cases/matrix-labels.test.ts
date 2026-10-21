import test from "node:test";
import assert from "node:assert/strict";
import { placeMatrixLabels } from "./matrix-labels.ts";

// Le etichette dei codici accanto ai punti della matrice (H4p): ogni punto la sua, senza
// coprirsi finché c'è posto. Punti e codici sintetici.

const BOX = 320;
const W = (text: string) => Math.ceil(text.length * 6.2) + 4;

function rectOf(point: { left: number; top: number; text: string }, placement: { dx: number; dy: number }) {
  return { x: (point.left / 100) * BOX + placement.dx, y: (point.top / 100) * BOX + placement.dy, w: W(point.text), h: 13 };
}

function overlaps(a: ReturnType<typeof rectOf>, b: ReturnType<typeof rectOf>): boolean {
  return Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x) && Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y);
}

test("ogni punto ha la sua etichetta; un punto da solo la tiene a destra", () => {
  const placed = placeMatrixLabels([{ id: "a", left: 30, top: 50, text: "XX-0012" }]);
  assert.equal(placed.size, 1);
  const a = placed.get("a")!;
  assert.ok(a.dx > 0 && Math.abs(a.dy + 6.5) <= 1, `a destra, centrata: ${JSON.stringify(a)}`);
  assert.equal(a.crowded, false);
});

test("vicino al bordo destro l'etichetta passa a sinistra, dentro il quadrato", () => {
  const point = { id: "b", left: 97, top: 50, text: "XX-0031" };
  const b = placeMatrixLabels([point]).get("b")!;
  const rect = rectOf(point, b);
  assert.ok(rect.x >= 0 && rect.x + rect.w <= BOX, `dentro: ${JSON.stringify(rect)}`);
  assert.ok(b.dx < 0, "a sinistra");
});

test("punti vicini: le etichette non si coprono tra loro né coprono gli altri punti", () => {
  const points = [
    { id: "p1", left: 30, top: 30, text: "XX-0001" },
    { id: "p2", left: 33, top: 30, text: "XX-0002" },
    { id: "p3", left: 31.5, top: 33, text: "XX-0003" },
    { id: "p4", left: 36, top: 31, text: "XX-0004" },
  ];
  const placed = placeMatrixLabels(points);
  assert.equal(placed.size, points.length);
  const rects = points.map((point) => rectOf(point, placed.get(point.id)!));
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) assert.ok(!overlaps(rects[i], rects[j]), `${points[i].id} e ${points[j].id}`);
    for (const [k, point] of points.entries()) {
      if (k === i) continue;
      const dot = { x: (point.left / 100) * BOX - 6, y: (point.top / 100) * BOX - 6, w: 12, h: 12, };
      assert.ok(!overlaps(rects[i], dot as ReturnType<typeof rectOf>), `${points[i].id} copre il punto ${point.id}`);
    }
  }
  for (const placement of placed.values()) assert.equal(placement.crowded, false);
});

test("troppi punti nello stesso posto: tutti hanno un'etichetta, quelle senza posto sono segnate", () => {
  const points = Array.from({ length: 30 }, (_, i) => ({ id: `q${i}`, left: 50 + (i % 3), top: 50 + Math.floor(i / 3) * 0.5, text: `XX-${String(i).padStart(4, "0")}` }));
  const placed = placeMatrixLabels(points);
  assert.equal(placed.size, 30);
  assert.ok([...placed.values()].some((p) => p.crowded), "qualcuna resta affollata");
  assert.ok([...placed.values()].every((p) => Number.isFinite(p.dx) && Number.isFinite(p.dy)));
});
