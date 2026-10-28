import test from "node:test";
import assert from "node:assert/strict";
import { groupLabelTexts, groupNearPoints, placeMatrixLabels } from "./matrix-labels.ts";

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

test("da 320 a 600 px: due etichette non si incrociano quando i punti si allontanano", () => {
  // XX-0003 e XX-0006 nella colonna «€», a Valore 1,4 e 1,25: a 320 px una sotto e l'altra sopra
  // stavano libere, a 600 px si coprivano.
  const points = [
    { id: "a", left: 3, top: 82, text: "XX-0003" },
    { id: "b", left: 3, top: 85.1, text: "XX-0006" },
  ];
  const placed = placeMatrixLabels(points, { maxBoxPx: 600 });
  for (const box of [320, 400, 460, 520, 600]) {
    const rect = (point: (typeof points)[number]) => {
      const p = placed.get(point.id)!;
      return { x: (point.left / 100) * box + p.dx, y: (point.top / 100) * box + p.dy, w: W(point.text), h: 13 };
    };
    assert.ok(!overlaps(rect(points[0]), rect(points[1])), `a ${box} px le etichette si coprono`);
  }
});

test("bolle: il raggio di ogni punto conta, e un riquadro 4:3", () => {
  // Due bolle a facilità 3 e beneficio 0, una grande: l'etichetta della piccola non va sulla grande.
  const points = [
    { id: "small", left: 48, top: 96, text: "XX-0011", radiusPx: 9 },
    { id: "big", left: 53, top: 96, text: "XX-0010", radiusPx: 13 },
  ];
  const placed = placeMatrixLabels(points, { boxPx: 560, maxBoxPx: 640, aspect: 0.75 });
  for (const box of [560, 640]) {
    const h = box * 0.75;
    const at = (point: (typeof points)[number]) => ({ x: (point.left / 100) * box, y: (point.top / 100) * h });
    const label = (point: (typeof points)[number]) => {
      const p = placed.get(point.id)!;
      return { x: at(point).x + p.dx, y: at(point).y + p.dy, w: W(point.text), h: 13 };
    };
    const bubble = (point: (typeof points)[number]) => ({ x: at(point).x - point.radiusPx, y: at(point).y - point.radiusPx, w: 2 * point.radiusPx, h: 2 * point.radiusPx });
    assert.ok(!overlaps(label(points[0]), bubble(points[1])), `a ${box} px l'etichetta della piccola copre la grande`);
    assert.ok(!overlaps(label(points[1]), bubble(points[0])), `a ${box} px l'etichetta della grande copre la piccola`);
    assert.ok(!overlaps(label(points[0]), label(points[1])), `a ${box} px le etichette si coprono`);
  }
});

test("due punti quasi nello stesso posto: un gruppo, un'etichetta con i due codici, nessun codice che sparisce", () => {
  // TJ-0001 e TJ-0004 della prova di TopJet: stesso Valore, costo quasi uguale.
  const points = [
    { left: 14.2, top: 54.9 },
    { left: 30, top: 50 },
    { left: 15.1, top: 54.9 },
    { left: 18.5, top: 54.9 },
  ];
  assert.deepEqual(groupNearPoints(points), [[0, 2], [1], [3]], "entro 3 punti percentuali dal primo del gruppo");
  assert.deepEqual(groupLabelTexts(["TJ-0001", "TJ-0007", "TJ-0004", null], groupNearPoints(points)), ["TJ-0001, TJ-0004", "TJ-0007", "", ""]);
  // Il primo del gruppo senza codice: l'etichetta va al primo che ne ha uno.
  assert.deepEqual(groupLabelTexts([null, "XX-0002"], [[0, 1]]), ["", "XX-0002"]);
});

test("un punto senza testo non ha etichetta ma resta un ostacolo per le altre", () => {
  const placed = placeMatrixLabels([
    { id: "a", left: 30, top: 50, text: "XX-0001, XX-0004" },
    { id: "b", left: 33, top: 50, text: "" },
  ]);
  assert.equal(placed.has("b"), false);
  const a = placed.get("a")!;
  const rect = rectOf({ left: 30, top: 50, text: "XX-0001, XX-0004" }, a);
  const dot = { x: 0.33 * BOX - 6, y: 0.5 * BOX - 6, w: 12, h: 12 };
  assert.ok(!(Math.min(rect.x + rect.w, dot.x + dot.w) > Math.max(rect.x, dot.x) && Math.min(rect.y + rect.h, dot.y + dot.h) > Math.max(rect.y, dot.y)), `non copre il punto b: ${JSON.stringify(a)}`);
});
