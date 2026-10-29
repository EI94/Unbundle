import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import type { OverviewFigures, OverviewNextStep, OverviewStep, PortfolioLine } from "../../lib/use-cases/panoramica.ts";
import type { RoadmapTile } from "../../lib/use-cases/views.ts";
import { enableTsxImports } from "./detail/referent/tsx-test-loader.ts";

// La testa della Panoramica resa in HTML (rilascio «Panoramica»): la striscia delle fasi, le cifre,
// «Su tutto il portafoglio» e «Prossimo passo» con il solo pulsante pieno; i testi delle frasi.
//
// HUB_TEXT viene da hub-header.tsx, che porta con sé il menu «⋯» con le sue azioni del server (e il
// database): qui il menu è un componente vuoto, il resto è quello vero.
type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve?(specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: object) => ResolveResult): ResolveResult }): void;
};
let top: typeof import("./panoramica-top.tsx");
let renderToStaticMarkup: (element: unknown) => string;
let createElement: (type: unknown, props: unknown) => unknown;
before(async () => {
  await enableTsxImports();
  const menu = `data:text/javascript,${encodeURIComponent("export function HubMenu() { return null; }")}`;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "./hub-menu" && context.parentURL?.endsWith("/hub-header.tsx")) return { url: menu, shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
  top = await import("./panoramica-top.tsx");
  const react = await import("react");
  createElement = (type, props) => react.createElement(type as never, props as never);
  ({ renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string });
});

const BASE = "/dashboard/ws/use-cases";
const DECIDE = `${BASE}?vista=da-decidere`;
const NEEDS = `${BASE}?vista=cosa-serve&trimestre=2026-Q4`;

const STEPS: OverviewStep[] = [
  { key: "da_decidere", count: 4 },
  { key: "approvati", count: 45 },
  { key: "in_realizzazione", count: 1 },
  { key: "realizzati", count: 0 },
];
const tile = (amountEur: number, note: string): RoadmapTile => ({ amountEur, count: 0, fromBand: 0, share: { adoption: 100, transformation: 0 }, note });
const FIGURES: OverviewFigures = {
  value: tile(50_366, "su 17 use case"),
  cost: tile(75_000, "su 9 use case · 2 da fascia"),
  quarter: { count: 12, quarter: "2026-Q4" },
  pending: { amountEur: 23_400, count: 9, note: "su 9 use case" },
};
const LINE: PortfolioLine = { hours: 1_404, breakeven: { kind: "mese", month: "2027-08" } };
const REQUIREMENTS: OverviewNextStep = { kind: "requisiti", quarter: "2026-Q4", toAsk: 60, toVerify: 0, blocked: 10 };

function render(props: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    createElement(top.PanoramicaTop, {
      steps: STEPS,
      reviewer: true,
      decideHref: DECIDE,
      figures: FIGURES,
      line: LINE,
      nextStep: { step: REQUIREMENTS, href: NEEDS },
      ...props,
    }),
  );
}

const textOf = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

/** Il pezzo di HTML di una fase, dal suo `<li>` alla chiusura. */
function stepOf(html: string, key: string): string {
  const start = html.indexOf(`<li data-step="${key}"`);
  assert.ok(start >= 0, `fase ${key}`);
  return html.slice(start, html.indexOf("</li>", start));
}

/** I pulsanti pieni: `[data-slot=button]` con la classe `bg-primary`, come nelle prove della pagina. */
function filledButtons(html: string): string[] {
  return [...html.matchAll(/<(?:a|button)\b[^>]*>/g)]
    .map(([tag]) => tag)
    .filter((tag) => tag.includes('data-slot="button"') && (/class="([^"]*)"/.exec(tag)?.[1].split(/\s+/) ?? []).includes("bg-primary"));
}

test("le fasi: quattro passi, «Da decidere» apre la sua vista, le altre la loro sezione; lo zero è un trattino", () => {
  const html = render();
  const strip = html.slice(html.indexOf('data-slot="phase-strip"'), html.indexOf("</section>"));
  assert.match(html, /<section aria-label="Fasi degli use case" data-slot="phase-strip">/);
  assert.deepEqual([...strip.matchAll(/data-step="([a-z_]+)"/g)].map((match) => match[1]), ["da_decidere", "approvati", "in_realizzazione", "realizzati"]);
  const decide = stepOf(html, "da_decidere");
  assert.match(decide, new RegExp(`<a [^>]*href="${DECIDE.replace(/[?]/g, "\\?")}"`));
  assert.equal(textOf(decide), "Da decidere4");
  assert.ok(!decide.includes("→"), "nessuna freccia prima del primo passo");
  const approved = stepOf(html, "approvati");
  assert.ok(approved.includes('<a href="#panoramica-approvati"'), approved);
  assert.ok(approved.includes('<span class="font-semibold tabular-nums">45</span>'));
  assert.match(approved, /<span aria-hidden="true" class="hidden text-muted-foreground @2xl\/hub:inline">→<\/span>/);
  assert.ok(stepOf(html, "in_realizzazione").includes('<a href="#panoramica-in-realizzazione"'));
  // Nessuno: il trattino, «nessuno» per i lettori di schermo, e niente link.
  const done = stepOf(html, "realizzati");
  assert.ok(done.includes('<span aria-hidden="true">—</span><span class="sr-only">nessuno</span>'), done);
  assert.ok(!done.includes("<a "), "lo zero non porta da nessuna parte");
  assert.match(done, /<span class="[^"]*\bborder bg-card[^"]*text-muted-foreground/);
  // Un link ha il bordo dei campi (3:1); «Da decidere 0» non è un link.
  assert.match(approved, /<a href="[^"]*" class="[^"]*\bborder border-input\b/);
  const none = render({ steps: [{ key: "da_decidere", count: 0 }, ...STEPS.slice(1)] });
  assert.ok(!stepOf(none, "da_decidere").includes("<a "));
});

test("le fasi del contributore: «In valutazione» senza numero e sempre aperta; nessuna cifra, niente riquadro", () => {
  const html = render({
    reviewer: false,
    steps: [{ key: "da_decidere", count: null }, ...STEPS.slice(1)],
    figures: null,
    line: null,
    nextStep: null,
  });
  const decide = stepOf(html, "da_decidere");
  assert.equal(textOf(decide), "In valutazione");
  assert.match(decide, /<a [^>]*href="[^"]*vista=da-decidere"/);
  for (const text of ["data-figure", "overview-figures", "next-step", "portfolio-line", "€", "costo di avvio", "Su tutto il portafoglio", "Cosa serve", "cosa serve"]) {
    assert.ok(!html.includes(text), `contributore: «${text}»`);
  }
  assert.ok(html.includes(">45<"), "gli approvati sì: sono use case, non persone");
  assert.equal(filledButtons(html).length, 0);
});

test("le cifre: valore, costo, trimestre, da misurare; prima la cifra, poi le parole, poi «su N use case»", () => {
  const html = render();
  const figures = html.slice(html.indexOf('data-slot="overview-figures"'));
  assert.match(html, /<section aria-label="Cifre degli use case" data-slot="overview-figures" class="space-y-2">/);
  assert.deepEqual([...figures.matchAll(/data-figure="([a-z-]+)"/g)].map((match) => match[1]), ["totale-valore", "totale-costo", "totale-trimestre", "totale-da-misurare"]);
  assert.match(figures, /class="grid grid-cols-2 gap-2 @3xl\/hub:gap-3 @3xl\/hub:grid-cols-4"/);
  const tileText = (key: string) => {
    const start = figures.indexOf(`data-figure="${key}"`);
    return figures.slice(start, figures.indexOf("</div>", start));
  };
  assert.match(tileText("totale-valore"), /<span class="whitespace-nowrap">50\.366 €<\/span><\/p><p class="text-sm">valore contato all&#x27;anno<\/p><p class="text-xs text-muted-foreground">su 17\u00a0use\u00a0case<\/p>/);
  assert.match(tileText("totale-costo"), />75\.000 €<\/span><\/p><p class="text-sm">costo di avvio<\/p><p[^>]*>su 9\u00a0use\u00a0case\u00a0· 2\u00a0da fascia</);
  assert.match(tileText("totale-trimestre"), />12<\/span><\/p><p class="text-sm">use case in questo trimestre<\/p><p[^>]*>T4\u00a02026</);
  assert.match(
    tileText("totale-da-misurare"),
    /<p class="text-2xl font-semibold tracking-tight tabular-nums"><span class="text-sm font-normal text-muted-foreground">fino a<\/span> <span class="whitespace-nowrap">23\.400 €<\/span><\/p><p class="text-sm">valore da misurare all&#x27;anno<\/p><p[^>]*>su 9\u00a0use\u00a0case</,
  );
  assert.ok(!tileText("totale-valore").includes("fino a"), "«fino a» solo sul da misurare");
  assert.ok(!figures.includes("AI Adoption"), "niente quota delle origini");
  assert.match(figures, /<p data-slot="portfolio-line" class="text-sm text-muted-foreground">Su tutto il portafoglio: 1\.404\u00a0ore liberate all&#x27;anno, pareggio previsto ad agosto\u00a02027\.<\/p>/);
  // Tre e due cifre: le colonne che servono.
  const three = render({ figures: { ...FIGURES, pending: null } });
  assert.match(three, /class="grid grid-cols-2 gap-2 @3xl\/hub:gap-3 @3xl\/hub:grid-cols-3"/);
  const two = render({ figures: { ...FIGURES, quarter: null, pending: null }, line: null });
  assert.match(two, /class="grid grid-cols-2 gap-2 @3xl\/hub:gap-3"/);
  assert.ok(!two.includes("portfolio-line"));
  // Senza cifre e senza la riga: nessuna sezione.
  assert.ok(!render({ figures: null, line: null }).includes("overview-figures"));
});

test("«Prossimo passo»: una frase e il solo pulsante pieno della testa", () => {
  const html = render();
  const box = html.slice(html.indexOf('data-slot="next-step"'));
  assert.match(html, /<section aria-labelledby="panoramica-prossimo-passo" data-slot="next-step" class="[^"]*@2xl\/hub:flex-row/);
  assert.ok(box.includes('<h2 id="panoramica-prossimo-passo" class="text-sm font-semibold">Prossimo passo</h2>'));
  // A schermo il numero resta con la sua parola: «T4 2026», «60 requisiti», «10 bloccati».
  assert.ok(box.includes("Per partire con il T4\u00a02026: 60\u00a0requisiti da chiedere e 10\u00a0bloccati."), textOf(box));
  assert.ok(!box.includes("60 requisiti"), "mai «60» / «requisiti» su due righe");
  const filled = filledButtons(html);
  assert.equal(filled.length, 1, "un solo pulsante pieno");
  assert.ok(filledButtons(box).length === 1, "dentro «Prossimo passo»");
  assert.match(filled[0], new RegExp(`href="${NEEDS.replace(/[?]/g, "\\?").replace(/&/g, "&amp;")}"`));
  assert.ok(textOf(box).includes("Vedi cosa serve"));
  const decisions = render({ nextStep: { step: { kind: "decisioni", count: 4 }, href: DECIDE } });
  assert.ok(textOf(decisions).includes("4\u00a0use\u00a0case aspettano una decisione.Vedi le proposte"));
  // Senza passo: nessun riquadro e nessun pulsante pieno.
  const none = render({ nextStep: null });
  assert.ok(!none.includes("next-step"));
  assert.equal(filledButtons(none).length, 0);
});

test("le frasi di «Prossimo passo», al singolare e al plurale", () => {
  const q = "2026-Q4" as const;
  const cases: Array<[OverviewNextStep, string]> = [
    // TopJet il 29/10/2026: la riga di «Cosa serve» del trimestre dice «40 da chiedere · 17 in attesa · 2 da verificare · 8 bloccati».
    [{ kind: "requisiti", quarter: q, toAsk: 40, toVerify: 2, blocked: 8 }, "Per partire con il T4 2026: 40 requisiti da chiedere, 2 da verificare e 8 bloccati."],
    [{ kind: "requisiti", quarter: q, toAsk: 1, toVerify: 1, blocked: 1 }, "Per partire con il T4 2026: 1 requisito da chiedere, 1 da verificare e 1 bloccato."],
    [{ kind: "requisiti", quarter: q, toAsk: 60, toVerify: 0, blocked: 10 }, "Per partire con il T4 2026: 60 requisiti da chiedere e 10 bloccati."],
    [{ kind: "requisiti", quarter: q, toAsk: 1, toVerify: 0, blocked: 1 }, "Per partire con il T4 2026: 1 requisito da chiedere e 1 bloccato."],
    [{ kind: "requisiti", quarter: q, toAsk: 3, toVerify: 2, blocked: 0 }, "Per partire con il T4 2026: 3 requisiti da chiedere e 2 da verificare."],
    [{ kind: "requisiti", quarter: q, toAsk: 0, toVerify: 1, blocked: 4 }, "Per partire con il T4 2026: 1 requisito da verificare e 4 bloccati."],
    [{ kind: "requisiti", quarter: q, toAsk: 1, toVerify: 0, blocked: 0 }, "Per partire con il T4 2026 serve ancora 1 requisito da chiedere."],
    [{ kind: "requisiti", quarter: q, toAsk: 1_250, toVerify: 0, blocked: 0 }, "Per partire con il T4 2026 servono ancora 1.250 requisiti da chiedere."],
    [{ kind: "requisiti", quarter: q, toAsk: 0, toVerify: 0, blocked: 1 }, "Per partire con il T4 2026 serve ancora 1 requisito bloccato."],
    [{ kind: "requisiti", quarter: q, toAsk: 0, toVerify: 0, blocked: 10 }, "Per partire con il T4 2026 servono ancora 10 requisiti bloccati."],
    [{ kind: "requisiti", quarter: q, toAsk: 0, toVerify: 1, blocked: 0 }, "Per partire con il T4 2026 c'è 1 requisito da verificare."],
    [{ kind: "requisiti", quarter: "2027-Q1", toAsk: 0, toVerify: 5, blocked: 0 }, "Per partire con il T1 2027 ci sono 5 requisiti da verificare."],
    [{ kind: "decisioni", count: 1 }, "1 use case aspetta una decisione."],
    [{ kind: "decisioni", count: 4 }, "4 use case aspettano una decisione."],
  ];
  for (const [step, text] of cases) assert.equal(top.nextStepText(step), text);
  assert.equal(top.nextStepAction({ kind: "decisioni", count: 1 }), "Vedi le proposte");
  assert.equal(top.nextStepAction({ kind: "requisiti", quarter: q, toAsk: 1, toVerify: 0, blocked: 0 }), "Vedi cosa serve");
  assert.equal(top.nextStepAction({ kind: "requisiti", quarter: q, toAsk: 0, toVerify: 1, blocked: 0 }), "Vedi cosa serve");
});

test("«Su tutto il portafoglio»: ore e pareggio, «ad» solo davanti ad aprile e agosto, una parte sola", () => {
  const line = (hours: number | null, breakeven: PortfolioLine["breakeven"]) => top.portfolioLineText({ hours, breakeven });
  assert.equal(line(1_404, { kind: "mese", month: "2027-08" }), "Su tutto il portafoglio: 1.404 ore liberate all'anno, pareggio previsto ad agosto 2027.");
  assert.equal(line(177.9, { kind: "mese", month: "2027-04" }), "Su tutto il portafoglio: 178 ore liberate all'anno, pareggio previsto ad aprile 2027.");
  assert.equal(line(12, { kind: "mese", month: "2027-10" }), "Su tutto il portafoglio: 12 ore liberate all'anno, pareggio previsto a ottobre 2027.");
  assert.equal(line(1.2, { kind: "subito" }), "Su tutto il portafoglio: 1 ora liberata all'anno, pareggio subito.");
  assert.equal(line(null, { kind: "oltre", month: "2028-10" }), "Su tutto il portafoglio: pareggio previsto oltre ottobre 2028.");
  assert.equal(line(250, null), "Su tutto il portafoglio: 250 ore liberate all'anno.");
  assert.equal(line(null, { kind: "mese", month: "2027-05" }), "Su tutto il portafoglio: pareggio previsto a maggio 2027.");
});

test("il sorgente: solo forme sulla larghezza del riquadro, niente testo sbiadito, il componente del server", () => {
  const source = readFileSync(new URL("./panoramica-top.tsx", import.meta.url), "utf8");
  const classes = [...source.matchAll(/["`]([^"`\n]*)["`]/g)].map((match) => match[1]).join(" ");
  assert.doesNotMatch(classes, /(?<![@\w/-])(?:max-)?(?:md|lg|xl|2xl):/, "nessuna forma sulla larghezza della finestra");
  assert.doesNotMatch(source, /\btext-[a-z-]+\/\d+/, "niente testo con l'opacità");
  assert.ok(!source.includes('"use client"'), "un componente del server");
  // Il solo pulsante del file è quello pieno di «Prossimo passo».
  assert.equal((source.match(/<Button\b/g) ?? []).length, 1);
  assert.doesNotMatch(source, /variant=/);
});
