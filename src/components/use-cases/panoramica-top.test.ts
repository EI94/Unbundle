import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { workspaceStepView, type StepView } from "../../lib/home/next-step.ts";
import { findHubForbiddenIn } from "../../lib/use-cases/copy-guard.ts";
import type { OverviewNumber, WorkspaceStep } from "../../lib/use-cases/panoramica.ts";
import { enableTsxImports } from "./detail/referent/tsx-test-loader.ts";

// La testa della Panoramica resa in HTML (rilascio 10, docs/ui-10/PROPOSTA-10.md §3.4, prototipo S2): il prossimo
// passo del workspace (D3) con il solo pulsante pieno, lo stesso della Home (`workspaceStepView`), poi un numero
// grande, «Valore all'anno · su N use case», con «Tutti i numeri ›» verso la Home.
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
const NEEDS = `${BASE}?vista=cosa-serve&trimestre=2026-Q4&stato=da-chiedere`;

const NUMBER: OverviewNumber = { amountEur: 412_000, count: 20 };
const NUMBERS = "/dashboard/ws?apri=numeri";
const LINKS = { workspaceId: "ws", companyName: "Cliente Demo", salHref: "/dashboard/ws?apri=sal" };
const view = (...steps: WorkspaceStep[]): StepView | null => workspaceStepView(steps, LINKS);
const ASK: WorkspaceStep = { key: "chiedere", mine: true, count: 60, quarter: "2026-Q4" };
const VERIFY: WorkspaceStep = { key: "verificare", mine: true, count: 2 };
const REQUIREMENTS = view(ASK, VERIFY);

function render(props: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    createElement(top.PanoramicaTop, {
      nextStep: { step: REQUIREMENTS },
      number: NUMBER,
      numbersHref: NUMBERS,
      ...props,
    }),
  );
}

const textOf = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

/** I pulsanti pieni: `[data-slot=button]` con la classe `bg-primary`, come nelle prove della pagina. */
function filledButtons(html: string): string[] {
  return [...html.matchAll(/<(?:a|button)\b[^>]*>/g)]
    .map(([tag]) => tag)
    .filter((tag) => tag.includes('data-slot="button"') && (/class="([^"]*)"/.exec(tag)?.[1].split(/\s+/) ?? []).includes("bg-primary"));
}

test("(rilascio 10, §3.4) in cima il prossimo passo, poi il numero grande; niente fasi, niente altre cifre, niente «Su tutto il portafoglio»", () => {
  const html = render();
  const step = html.indexOf('data-slot="next-step"');
  const big = html.indexOf('data-slot="big-number"');
  assert.ok(step >= 0 && big > step, "prima il passo, poi il numero");
  for (const gone of ["phase-strip", "overview-figures", "portfolio-line", "Su tutto il portafoglio", "Approvati", "costo di realizzazione", "use case in questo trimestre"]) {
    assert.ok(!html.includes(gone), gone);
  }
  assert.equal((html.match(/data-slot="big-number"/g) ?? []).length, 1, "un solo numero grande");
  assert.equal(filledButtons(html).length, 1, "un solo pulsante pieno, il passo");
});

test("il numero grande: «412.000 €», «Valore all'anno», «su 20 use case» e «Tutti i numeri ›» verso la Home", () => {
  const html = render();
  const big = html.slice(html.indexOf('data-figure="totale-valore"'));
  assert.match(big, /<p data-slot="big-number-value"[^>]*>412\.000 €<\/p>/);
  assert.match(big, /<p data-slot="big-number-label"[^>]*>Valore all&#x27;anno<\/p>/);
  assert.ok(textOf(big).includes("su 20\u00a0use\u00a0case"), textOf(big));
  assert.match(big, /<a [^>]*data-slot="text-action"[^>]*href="\/dashboard\/ws\?apri=numeri"|<a [^>]*href="\/dashboard\/ws\?apri=numeri"[^>]*data-slot="text-action"/);
  assert.ok(textOf(big).includes("Tutti i numeri"));
  // Il valore da misurare sta nella Home («Tutti i numeri»): qui la riga grigia dice solo su quanti use case.
  assert.ok(!html.includes("da misurare") && !html.includes("fino a"));
  // Senza cifre: niente numero; senza numero e senza passo (un filtro senza cifre): niente.
  assert.ok(!render({ number: null }).includes("big-number"));
  assert.equal(render({ number: null, nextStep: null }), "");
  assert.equal(top.overviewNumberView(null), null);
  assert.deepEqual(top.overviewNumberView({ amountEur: 1_204, count: 1 }), { value: "1.204 €", label: "Valore all'anno", note: "su 1 use case" });
});

test("(rilascio 10) la riga sull'ok ai fornitori: senza pulsante, le parole del passo e «Impostazioni ›»", () => {
  const html = renderToStaticMarkup(createElement(top.SuppliersLine, { href: "/dashboard/ws/settings#sub-responsabili" }));
  assert.match(html, /^<p data-slot="suppliers-line" class="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">/);
  assert.equal(textOf(html).trim(), "Manca l'ok sui fornitori·Impostazioni");
  assert.match(html, /<a data-slot="text-action" class="[^"]*\bmin-h-11\b[^"]*" href="\/dashboard\/ws\/settings#sub-responsabili">Impostazioni<svg/);
  assert.equal(filledButtons(html).length, 0, "non è un pulsante pieno");
  // Le parole del passo «Autorizza i fornitori» quando non tocca a chi guarda: una sola voce per la stessa cosa.
  assert.equal(top.OVERVIEW_TEXT.suppliers, "Manca l'ok sui fornitori");
  // La pagina la mostra a Lateral Space quando manca l'ok e il passo non lo dice già.
  const hub = readFileSync(new URL("./hub.tsx", import.meta.url), "utf8").replace(/\s+/g, " ");
  assert.ok(hub.includes('const suppliersHref = data.suppliersPending && overview?.nextStep?.step?.key !== "fornitori" ? `/dashboard/${workspaceId}/settings#sub-responsabili` : null;'));
  assert.ok(hub.includes('{view === "panoramica" && !chart && suppliersHref ? <SuppliersLine href={suppliersHref} /> : null}'));
  assert.ok(hub.includes("reviewer && abilities.isLateralSpace && lanes ? subprocessorsPendingForLs(workspaceId, session.user.id) : false"), "le stesse persone dell'avviso di prima");
});

test("i testi della testa passano la guardia delle parole", () => {
  const t = top.OVERVIEW_TEXT;
  assert.deepEqual(findHubForbiddenIn([t.value, t.onUseCases(20), t.allNumbers, t.suppliers, t.suppliersLink], "area"), []);
  // Il numero grande: etichetta di 4 parole al massimo (BigNumber).
  assert.ok(t.value.split(/\s+/).length <= 4, t.value);
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

test("il sorgente: solo forme sulla larghezza del riquadro, niente testo sbiadito, il componente del server", () => {
  const source = readFileSync(new URL("./panoramica-top.tsx", import.meta.url), "utf8");
  const classes = [...source.matchAll(/["`]([^"`\n]*)["`]/g)].map((match) => match[1]).join(" ");
  assert.doesNotMatch(classes, /(?<![@\w/-])(?:max-)?(?:md|lg|xl|2xl):/, "nessuna forma sulla larghezza della finestra");
  assert.doesNotMatch(source, /\btext-[a-z-]+\/\d+/, "niente testo con l'opacità");
  assert.ok(!source.includes('"use client"'), "un componente del server");
  // (Rilascio 10) Il pulsante pieno è quello del prossimo passo (`NextStep`): qui nessun altro pulsante.
  assert.equal((source.match(/<Button\b/g) ?? []).length, 0);
  assert.ok(source.includes("<NextStep "), "il passo con il pezzo comune");
  assert.ok(source.includes("<BigNumber"), "il numero grande con il pezzo comune");
  assert.doesNotMatch(source, /variant=/);
});
