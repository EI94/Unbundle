import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { workspaceStepView, type StepView } from "../../lib/home/next-step.ts";
import type { OverviewFigures, OverviewStep, PortfolioLine, WorkspaceStep } from "../../lib/use-cases/panoramica.ts";
import type { RoadmapTile } from "../../lib/use-cases/views.ts";
import { enableTsxImports } from "./detail/referent/tsx-test-loader.ts";

// La testa della Panoramica resa in HTML (rilascio «Panoramica»): la striscia delle fasi, le cifre,
// «Su tutto il portafoglio» e, dal rilascio 10 (D3), il prossimo passo del workspace con il solo pulsante pieno,
// lo stesso della Home (`workspaceStepView`).
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
const LINKS = { workspaceId: "ws", companyName: "Cliente Demo", salHref: "/dashboard/ws?apri=sal" };
const view = (...steps: WorkspaceStep[]): StepView | null => workspaceStepView(steps, LINKS);
const ASK: WorkspaceStep = { key: "chiedere", mine: true, count: 60, quarter: "2026-Q4" };
const VERIFY: WorkspaceStep = { key: "verificare", mine: true, count: 2 };
const REQUIREMENTS = view(ASK, VERIFY);

function render(props: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    createElement(top.PanoramicaTop, {
      steps: STEPS,
      reviewer: true,
      decideHref: DECIDE,
      figures: FIGURES,
      line: LINE,
      nextStep: { step: REQUIREMENTS },
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
  for (const text of ["data-figure", "overview-figures", "next-step", "portfolio-line", "€", "costo di realizzazione", "Su tutto il portafoglio", "Cosa serve", "cosa serve"]) {
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
  assert.match(tileText("totale-valore"), /<span class="whitespace-nowrap">50\.366 €<\/span><\/p><p class="text-sm">valore all&#x27;anno<\/p><p class="text-xs text-muted-foreground">su 17\u00a0use\u00a0case<\/p>/);
  assert.match(tileText("totale-costo"), />75\.000 €<\/span><\/p><p class="text-sm">costo di realizzazione<\/p><p[^>]*>su 9\u00a0use\u00a0case\u00a0· 2\u00a0da fascia</);
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

test("il prossimo passo (D3): l'etichetta, il pulsante pieno con l'icona e il verbo, il «?» con il perché", () => {
  // A schermo un numero resta con la sua parola (U+00A0): qui si leggono spazi normali.
  const html = render().replace(/\u00a0/g, " ");
  const box = html.slice(html.indexOf('data-slot="next-step"'));
  assert.match(html, /<section aria-labelledby="panoramica-prossimo-passo-etichetta" data-slot="next-step" class="space-y-2">/);
  assert.ok(box.includes('<p id="panoramica-prossimo-passo-etichetta" class="text-xs text-muted-foreground">Prossimo passo</p>'));
  const filled = filledButtons(html);
  assert.equal(filled.length, 1, "un solo pulsante pieno");
  assert.ok(filledButtons(box).length === 1, "dentro il prossimo passo");
  assert.match(filled[0], new RegExp(`href="${NEEDS.replace(/[?]/g, "\\?").replace(/&/g, "&amp;")}"`));
  assert.match(filled[0], /aria-describedby="panoramica-prossimo-passo-perche"/);
  assert.ok(textOf(box).includes("Chiedi 60 informazioni"), textOf(box));
  assert.match(box, /<svg[^>]*aria-hidden="true"[^>]*data-icon="inline-start"/, "l'icona accanto al verbo");
  // Il «?»: il perché e, dopo, il passo che viene dopo.
  assert.ok(box.includes('<span id="panoramica-prossimo-passo-perche" class="sr-only">Servono agli use case del T4 2026 per partire. Poi: 2 risposte da verificare.</span>'), box);
  assert.match(box, /data-slot="why"[^>]*aria-label="Perché questo passo"|aria-label="Perché questo passo"[^>]*data-slot="why"/);
  // Le decisioni portano a «Da decidere».
  const decisions = render({ nextStep: { step: view({ key: "decidere", mine: true, count: 4, oldestDays: 9 }, ASK) } }).replace(/\u00a0/g, " ");
  assert.ok(textOf(decisions).includes("Decidi 4 use case"));
  assert.match(filledButtons(decisions)[0], new RegExp(`href="${DECIDE.replace(/[?]/g, "\\?")}"`));
  assert.ok(decisions.includes("Il più vecchio aspetta da 9 giorni. Poi: 60 informazioni da chiedere per il T4 2026."));
  // Niente da fare: «Tutto in ordine», senza pulsante pieno e senza «?».
  const done = render({ nextStep: { step: null } });
  assert.ok(done.includes('data-slot="next-step-done"') && textOf(done).includes("Tutto in ordine"));
  assert.equal(filledButtons(done).length, 0);
  assert.ok(!done.includes('data-slot="why"'));
  // Un filtro (o un contributore): nessun passo.
  const none = render({ nextStep: null });
  assert.ok(!none.includes("next-step"));
  assert.equal(filledButtons(none).length, 0);
});

test("il prossimo passo che non tocca a chi guarda: le parole dello stato e «Tocca a …», senza pulsante", () => {
  const html = render({ nextStep: { step: view({ key: "fornitori", mine: false, waiting: 3 }) } }).replace(/\u00a0/g, " ");
  const box = html.slice(html.indexOf('data-slot="next-step"'));
  assert.equal(filledButtons(html).length, 0);
  assert.ok(box.includes('data-slot="next-step-status"') && textOf(box).includes("Manca l'ok sui fornitori"), textOf(box));
  assert.ok(box.includes('<p data-slot="next-step-turn" class="text-xs text-muted-foreground">Tocca a Cliente Demo.</p>'));
  // Chi può dare l'ok: il pulsante porta a Impostazioni › fornitori, fuori dalla pagina.
  const mine = render({ nextStep: { step: view({ key: "fornitori", mine: true, waiting: 3 }) } });
  assert.match(filledButtons(mine)[0], /href="\/dashboard\/ws\/settings#sub-responsabili"/);
  assert.ok(!mine.includes('data-slot="next-step-turn"'), "tocca a chi guarda: niente «Tocca a»");
  // «Chiudi il SAL» dalla Panoramica: il pannello del SAL della Home.
  const sal = render({ nextStep: { step: view({ key: "sal", mine: true, first: false, lastOn: "2026-10-01", days: 28 }) } });
  assert.match(filledButtons(sal)[0], /href="\/dashboard\/ws\?apri=sal"/);
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
  // (Rilascio 10) Il pulsante pieno è quello del prossimo passo (`NextStep`): qui nessun altro pulsante.
  assert.equal((source.match(/<Button\b/g) ?? []).length, 0);
  assert.ok(source.includes("<NextStep "), "il passo con il pezzo comune");
  assert.doesNotMatch(source, /variant=/);
});
