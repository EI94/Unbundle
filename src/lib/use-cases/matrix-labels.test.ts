import test from "node:test";
import assert from "node:assert/strict";
import { labelWidthPx, placeMatrixLabels, placeZoneLabels, zoneLabelRect, type LabelRect, type ZoneLabelInput } from "./matrix-labels.ts";

// Le etichette accanto ai punti della matrice e alle bolle: solo accanto ai punti isolati, solo dove
// stanno libere a ogni larghezza; e i nomi delle zone della matrice. Punti e codici sintetici.

const BOX = 320;
const W = (text: string) => labelWidthPx(text);

function rectOf(point: { left: number; top: number; text: string }, placement: { dx: number; dy: number }, box = BOX, h = box) {
  return { x: (point.left / 100) * box + placement.dx, y: (point.top / 100) * h + placement.dy, w: W(point.text), h: 13 };
}

function overlaps(a: LabelRect, b: LabelRect): boolean {
  return Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x) && Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y);
}

/** Il punto `point` con il suo margine, come lo vede chi mette le etichette. */
function dotOf(point: { left: number; top: number }, r: number, box = BOX, h = box): LabelRect {
  return { x: (point.left / 100) * box - r, y: (point.top / 100) * h - r, w: 2 * r, h: 2 * r };
}

test("un punto da solo: l'etichetta a destra, centrata", () => {
  const placed = placeMatrixLabels([{ id: "a", left: 30, top: 50, text: "XX-0012" }]);
  assert.equal(placed.size, 1);
  const a = placed.get("a")!;
  assert.ok(a.dx > 0 && Math.abs(a.dy + 6.5) <= 1, `a destra, centrata: ${JSON.stringify(a)}`);
});

test("vicino al bordo destro l'etichetta passa a sinistra, dentro il quadrato", () => {
  const point = { id: "b", left: 97, top: 50, text: "XX-0031" };
  const b = placeMatrixLabels([point]).get("b")!;
  const rect = rectOf(point, b);
  assert.ok(rect.x >= 0 && rect.x + rect.w <= BOX, `dentro: ${JSON.stringify(rect)}`);
  assert.ok(b.dx < 0, "a sinistra");
});

test("un gruppo fitto non ha etichette; un punto isolato sì, lontano dagli altri", () => {
  // Quattro punti a meno di 12 px l'uno dall'altro (bordo a bordo): si leggono nell'elenco.
  const points = [
    { id: "p1", left: 30, top: 30, text: "XX-0001" },
    { id: "p2", left: 34, top: 30, text: "XX-0002" },
    { id: "p3", left: 32, top: 34, text: "XX-0003" },
    { id: "p4", left: 36, top: 33, text: "XX-0004" },
    { id: "far", left: 70, top: 70, text: "XX-0009" },
  ];
  const placed = placeMatrixLabels(points);
  assert.deepEqual([...placed.keys()], ["far"]);
  const rect = rectOf(points[4], placed.get("far")!);
  for (const point of points.slice(0, 4)) assert.ok(!overlaps(rect, dotOf(point, 6 + 6)), `lontano da ${point.id}`);
});

test("troppi punti nello stesso posto: nessuna etichetta, e nessuna che copre", () => {
  const points = Array.from({ length: 30 }, (_, i) => ({ id: `q${i}`, left: 50 + (i % 3), top: 50 + Math.floor(i / 3) * 0.5, text: `XX-${String(i).padStart(4, "0")}` }));
  assert.equal(placeMatrixLabels(points).size, 0);
});

test("l'etichetta resta a distanza dai punti degli altri: non sembra di un altro agente", () => {
  // Due punti isolati a 30 px: a destra di «a» l'etichetta toccherebbe il margine di «b», quindi va altrove.
  const points = [
    { id: "a", left: 30, top: 50, text: "LIBRA L1" },
    { id: "b", left: 50, top: 50, text: "ORSA O1" },
  ];
  const placed = placeMatrixLabels(points, { clearancePx: 6 });
  for (const [index, point] of points.entries()) {
    const placement = placed.get(point.id);
    if (!placement) continue;
    const other = points[1 - index];
    assert.ok(!overlaps(rectOf(point, placement), dotOf(other, 6 + 6)), `${point.id} accanto al punto di ${other.id}`);
  }
  assert.equal(placed.size, 2, "c'è posto per tutti e due");
});

test("gli ostacoli (i nomi delle zone, le linee tratteggiate) non si coprono, a ogni larghezza", () => {
  const point = { id: "a", left: 10, top: 80, text: "ORSA O4, ORSA O3" };
  // Una linea verticale a 20 % e il nome di una zona sotto il punto.
  const obstacles = (box: { w: number; h: number }) => [
    { x: 0.2 * box.w - 2, y: 0, w: 4, h: box.h },
    { x: 8, y: box.h - 6 - 45, w: 40, h: 45 },
  ];
  const placed = placeMatrixLabels([point], { boxPx: 304, maxBoxPx: 576, obstacles });
  const placement = placed.get("a");
  if (placement) {
    for (const box of [304, 440, 576]) {
      const rect = rectOf(point, placement, box);
      for (const obstacle of obstacles({ w: box, h: box })) assert.ok(!overlaps(rect, obstacle), `a ${box} px copre ${JSON.stringify(obstacle)}`);
    }
  }
  // Senza un posto libero a ogni larghezza, nessuna etichetta: mai una sopra la linea.
  const blocked = placeMatrixLabels([point], { boxPx: 304, maxBoxPx: 576, obstacles: (box) => [{ x: 0, y: 0, w: box.w, h: box.h }] });
  assert.equal(blocked.size, 0);
});

test("da 304 a 576 px: due etichette non si incrociano quando i punti si allontanano", () => {
  const points = [
    { id: "a", left: 10, top: 60, text: "XX-0003" },
    { id: "b", left: 10, top: 68, text: "XX-0006" },
  ];
  const placed = placeMatrixLabels(points, { boxPx: 304, maxBoxPx: 576 });
  assert.equal(placed.size, 2);
  for (const box of [304, 360, 440, 520, 576]) {
    const rect = (point: (typeof points)[number]) => rectOf(point, placed.get(point.id)!, box);
    assert.ok(!overlaps(rect(points[0]), rect(points[1])), `a ${box} px le etichette si coprono`);
  }
});

test("bolle: il raggio di ogni punto conta, e un riquadro 4:3", () => {
  const points = [
    { id: "small", left: 30, top: 50, text: "XX-0011", radiusPx: 9 },
    { id: "big", left: 60, top: 50, text: "XX-0010", radiusPx: 13 },
  ];
  const placed = placeMatrixLabels(points, { boxPx: 480, maxBoxPx: 640, aspect: 0.75 });
  assert.equal(placed.size, 2);
  for (const box of [480, 640]) {
    const h = box * 0.75;
    const label = (point: (typeof points)[number]) => rectOf(point, placed.get(point.id)!, box, h);
    assert.ok(!overlaps(label(points[0]), dotOf(points[1], points[1].radiusPx, box, h)), `a ${box} px l'etichetta della piccola copre la grande`);
    assert.ok(!overlaps(label(points[1]), dotOf(points[0], points[0].radiusPx, box, h)), `a ${box} px l'etichetta della grande copre la piccola`);
    assert.ok(!overlaps(label(points[0]), label(points[1])), `a ${box} px le etichette si coprono`);
    // Il proprio punto non è coperto: l'etichetta parte dal suo bordo.
    assert.ok(!overlaps(label(points[1]), dotOf(points[1], points[1].radiusPx, box, h)));
  }
});

test("un punto senza testo non ha etichetta ma resta un ostacolo per le altre", () => {
  const placed = placeMatrixLabels([
    { id: "a", left: 30, top: 50, text: "XX-0001" },
    { id: "b", left: 50, top: 50, text: "" },
  ]);
  assert.equal(placed.has("b"), false);
  const rect = rectOf({ left: 30, top: 50, text: "XX-0001" }, placed.get("a")!);
  assert.ok(!overlaps(rect, dotOf({ left: 50, top: 50 }, 6 + 6)), "non va accanto al punto b");
});

// ─── I nomi delle zone ───────────────────────────────────────────────

const ZONE_INPUTS: ZoneLabelInput[] = [
  { key: "subito", text: "Subito", side: "low", half: "top" },
  { key: "da_pianificare", text: "Da pianificare", side: "high", half: "top" },
  { key: "se_avanza_tempo", text: "Se avanza tempo", side: "low", half: "bottom" },
  { key: "non_ora", text: "Non ora", side: "high", half: "bottom" },
];
/** Costo basso fino alla fascia 1 (20 %), «Valore alto» da 3,5 (40 % dall'alto). */
const GEOMETRY = { lowLeftPct: 20, highTopPct: 40 };

test("il nome di una zona va a capo prima della linea del costo basso", () => {
  const zone = ZONE_INPUTS[2];
  // 304 px: la colonna «€» è larga 61 px, il nome ha 49 px: «Se» / «avanza» / «tempo», 45 px.
  const small = zoneLabelRect(zone, "outer", GEOMETRY, { w: 304, h: 304 });
  assert.equal(small.h, 45);
  assert.ok(small.x + small.w <= 0.2 * 304 - 12 + 0.01, JSON.stringify(small));
  assert.equal(small.y, 304 - 6 - 45, "in basso a sinistra");
  // 576 px: una riga.
  assert.equal(zoneLabelRect(zone, "outer", GEOMETRY, { w: 576, h: 576 }).h, 15);
  // Accanto alla linea: sotto il «Valore alto», a 6 px.
  assert.equal(zoneLabelRect(zone, "inner", GEOMETRY, { w: 304, h: 304 }).y, 0.4 * 304 + 6);
  // A destra della linea: allineato a destra.
  const right = zoneLabelRect(ZONE_INPUTS[3], "outer", GEOMETRY, { w: 576, h: 576 });
  assert.ok(Math.abs(right.x + right.w - (576 - 8)) < 0.01);
});

test("i nomi delle zone lasciano l'angolo esterno quando è pieno di punti (TopJet: «Se avanza tempo»)", () => {
  // Quindici punti in basso a sinistra, Valore tra 1,6 e 2,1: l'angolo di «Se avanza tempo».
  const points = Array.from({ length: 15 }, (_, i) => ({ left: 3 + (i % 5) * 3.6, top: 82 + Math.floor(i / 5) * 3.5, radiusPx: 5 }));
  const spots = placeZoneLabels(ZONE_INPUTS, points, GEOMETRY, [304, 440, 576]);
  assert.deepEqual(spots, { subito: "outer", da_pianificare: "outer", se_avanza_tempo: "inner", non_ora: "outer" });
  // Senza punti tutto resta com'era: negli angoli esterni.
  assert.deepEqual(Object.values(placeZoneLabels(ZONE_INPUTS, [], GEOMETRY, [304])), ["outer", "outer", "outer", "outer"]);
});

test("con `wideFromPx`: l'etichetta che al telefono passerebbe la linea si scrive solo da 440 px in su", () => {
  // TopJet: «LIBRA L1» nella colonna «€» (fino al 20 %), al 2 %: 61 px al telefono, troppo pochi.
  const point = { id: "l1", left: 2, top: 65.5, text: "LIBRA L1" };
  const line = (box: { w: number; h: number }) => [{ x: 0.2 * box.w - 2, y: 0, w: 4, h: box.h }];
  assert.equal(placeMatrixLabels([point], { boxPx: 304, maxBoxPx: 576, obstacles: line }).size, 0, "senza il secondo livello: niente");
  const wide = placeMatrixLabels([point], { boxPx: 304, maxBoxPx: 576, wideFromPx: 440, obstacles: line }).get("l1");
  assert.ok(wide?.wide, JSON.stringify(wide));
  for (const box of [440, 508, 576]) {
    const rect = rectOf(point, wide!, box);
    assert.ok(!overlaps(rect, line({ w: box, h: box })[0]), `a ${box} px passa la linea`);
  }
  // Un punto che sta libero ovunque non è «wide».
  assert.equal(placeMatrixLabels([{ ...point, left: 50 }], { boxPx: 304, maxBoxPx: 576, wideFromPx: 440, obstacles: line }).get("l1")?.wide, false);
});
