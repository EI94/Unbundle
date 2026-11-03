import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { infoProgressView, type InfoProgress, type InfoProgressView } from "../../lib/use-cases/info-progress.ts";
import { enableTsxImports } from "./detail/referent/tsx-test-loader.ts";

// Il chip di «Raccolta informazioni» (SPEC §P2.10.3, §P2.10.5, §P2.12.3): non sembra una fase.
let chip: typeof import("./info-chip.tsx");
before(async () => {
  await enableTsxImports();
  chip = await import("./info-chip.tsx");
});

const base: InfoProgress = {
  state: "da_verificare",
  since: null,
  reminded: false,
  until: null,
  silentReason: null,
  blocked: false,
  received: 2,
  total: 6,
  toAsk: 0,
  toVerify: 2,
  waiting: 0,
  unanswered: 0,
  blockedCount: 0,
};
const view = (over: Partial<InfoProgress> = {}): InfoProgressView => infoProgressView({ ...base, ...over })!;

test("lungo nella testata: solo lo stato a parole (rilascio 5: il chip corto delle righe non c'è più)", () => {
  const toVerify = view();
  assert.deepEqual(chip.infoChipProps(toVerify, "long")?.text, "Informazioni: da verificare");
  assert.equal(chip.infoChipProps(toVerify, "long")?.ariaLabel, "Informazioni: da verificare");
  for (const state of ["da_chiedere", "in_attesa", "complete"] as const) {
    assert.ok(chip.infoChipProps(view({ state, since: state === "in_attesa" ? "2026-10-27" : null }), "long"), state);
  }
  const waiting = view({ state: "in_attesa", since: "2026-10-27", reminded: true });
  assert.equal(chip.infoChipProps(waiting, "long")?.text, "Informazioni: in attesa", "niente data né promemoria nella testata");
  assert.equal(chip.infoChipProps(null, "long"), null);
});

test("il tono colora solo l'icona; niente pillola, bordo o puntino, nessuna classe della pillola della fase", () => {
  const props = chip.infoChipProps(view({ state: "senza_risposta" }), "long")!;
  assert.equal(props.iconClass, "text-uc-rosso");
  assert.match(props.className, /text-xs/);
  assert.match(props.className, /text-muted-foreground/);
  assert.doesNotMatch(props.className, /rounded-full|\bborder\b|bg-/);
  const pill = readFileSync(new URL("./phase-pill.tsx", import.meta.url), "utf8");
  const pillClasses = [...pill.matchAll(/"([^"]*rounded-full[^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter((c) => /rounded|border|px-|py-/.test(c));
  assert.ok(pillClasses.length > 0);
  for (const cls of pillClasses) assert.ok(!props.className.split(/\s+/).includes(cls), cls);
  const source = readFileSync(new URL("./info-chip.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /rounded-full|PhasePill|phase-pill|StatusDot/);
});

test("(rilascio 5) lo stato del referente arriva nelle card della Panoramica e nelle righe: hub → PanoramaLanes → LaneCard, DecideView → UseCaseRow", () => {
  const flat = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8").replace(/\s+/g, " ");
  const hub = flat("./hub.tsx");
  const lanes = hub.slice(hub.indexOf("<PanoramaLanes "), hub.indexOf("/>", hub.indexOf("<PanoramaLanes ")));
  assert.match(lanes, /\breferentStates=\{data\.referentStates\}/);
  const decide = hub.slice(hub.indexOf("<DecideView "), hub.indexOf("/>", hub.indexOf("<DecideView ")));
  assert.match(decide, /\breferentStates=\{data\.referentStates\}/);
  const view = flat("./panorama-lanes.tsx");
  const cards = [...view.matchAll(/<LaneCard [^>]*?\/>/g)].map((match) => match[0]);
  assert.equal(cards.length, 3, "corsie, «In realizzazione» e «Realizzati»");
  for (const card of cards) assert.match(card, /\breferentState=\{stateOf\(/, card);
  const laneCard = flat("./lane-card.tsx");
  assert.equal((laneCard.match(/<ReferentChip state=\{referentState\}/g) ?? []).length, 2, "revisori e contributori");
  assert.ok(!laneCard.includes("InfoChip") && !flat("./use-case-row.tsx").includes("InfoChip"), "il chip corto di «Raccolta informazioni» non c'è più");
});
