import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AGENT_TONES, type AgentTone } from "../../lib/use-cases/agents.ts";
import { enableTsxImports } from "./detail/referent/tsx-test-loader.ts";

// Il tag dell'agente (rilascio «Panoramica»): il colore dell'agente o il neutro, mai una pillola.
let tag: typeof import("./agent-tag.tsx");
let renderToStaticMarkup: (element: unknown) => string;
let createElement: (type: unknown, props: unknown) => unknown;
before(async () => {
  await enableTsxImports();
  tag = await import("./agent-tag.tsx");
  const react = await import("react");
  createElement = (type, props) => react.createElement(type as never, props as never);
  ({ renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string });
});

const TONES = Array.from({ length: AGENT_TONES }, (_, index) => (index + 1) as AgentTone);
const render = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(tag.AgentTag, props));
const classesOf = (html: string) => /<span[^>]*class="([^"]*)"/.exec(html)?.[1].split(" ") ?? [];

test("il tag: «LIBRA L1» nel colore del suo tono, angoli arrotondati e non una pillola", () => {
  for (const tone of TONES) {
    const html = render({ label: "LIBRA L1", tone });
    assert.match(html, /^<span data-slot="agent-tag" data-tone="\d+"/, String(tone));
    assert.ok(html.includes(`data-tone="${tone}"`), String(tone));
    const classes = classesOf(html);
    for (const cls of [`border-uc-agente-${tone}/55`, `bg-uc-agente-${tone}/16`, `text-uc-agente-${tone}`, "rounded-md", "border", "text-xs", "whitespace-nowrap"]) {
      assert.ok(classes.includes(cls), `${tone}: ${cls}`);
    }
    assert.ok(!classes.includes("rounded-full"), "non sembra una fase");
    assert.ok(!html.includes("aria-hidden"), "si legge, se non è decorativo");
    assert.ok(!html.includes("data-figure"), "non è una cifra");
    assert.ok(html.includes('<span class="truncate">LIBRA L1</span>'));
  }
});

test("il tag senza tono è neutro: il bordo dei campi e il testo pieno", () => {
  const html = render({ label: "VEGA V1", tone: null });
  assert.ok(html.includes('data-tone="neutro"'));
  const classes = classesOf(html);
  for (const cls of ["border-input", "text-foreground"]) assert.ok(classes.includes(cls), cls);
  assert.ok(!classes.some((cls) => cls.includes("uc-agente")), "nessun colore");
  assert.equal(tag.NEUTRAL_TAG_CLASS, "border-input text-foreground");
  assert.equal(tag.NEUTRAL_TEXT_CLASS, "text-foreground");
  assert.deepEqual(tag.NEUTRAL_BAR_CLASS, { fill: "bg-muted-foreground", dashed: "border-muted-foreground" });
});

test("decorativo: nascosto ai lettori di schermo, che leggono il titolo intero", () => {
  assert.ok(render({ label: "LIBRA L1", tone: 4, decorative: true }).includes('aria-hidden="true"'));
  assert.ok(!render({ label: "LIBRA L1", tone: 4, decorative: false }).includes("aria-hidden"));
  assert.ok(classesOf(render({ label: "LIBRA", tone: 1, className: "shrink-0" })).includes("shrink-0"));
});

test("le classi dei toni, scritte per intero per Tailwind", () => {
  assert.deepEqual(Object.keys(tag.AGENT_TAG_CLASS).map(Number), TONES);
  for (const tone of TONES) {
    assert.equal(tag.AGENT_TAG_CLASS[tone], `border-uc-agente-${tone}/55 bg-uc-agente-${tone}/16 text-uc-agente-${tone}`);
    assert.equal(tag.AGENT_TEXT_CLASS[tone], `text-uc-agente-${tone}`);
    assert.deepEqual(tag.AGENT_BAR_CLASS[tone], { fill: `bg-uc-agente-${tone}`, dashed: `border-uc-agente-${tone}` });
  }
  // Nel sorgente, non composte: Tailwind trova solo le classi scritte.
  const source = readFileSync(new URL("./agent-tag.tsx", import.meta.url), "utf8");
  for (const tone of TONES) {
    for (const cls of [`"border-uc-agente-${tone}/55 bg-uc-agente-${tone}/16 text-uc-agente-${tone}"`, `"text-uc-agente-${tone}"`, `fill: "bg-uc-agente-${tone}"`, `dashed: "border-uc-agente-${tone}"`]) {
      assert.ok(source.includes(cls), cls);
    }
  }
  assert.doesNotMatch(source, /rounded-full|"use client"/);
});
