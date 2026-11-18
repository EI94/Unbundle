import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { enableTsxImports } from "../use-cases/detail/referent/tsx-test-loader.ts";

// I pezzi comuni del rilascio 10 (docs/ui-10/PROPOSTA-10.md §5.4), resi in HTML con react-dom/server: NextStep,
// BigNumber, Fold, SideSheet (con l'indirizzo), FilterChips, EmptyState, Row e gli avvisi. Senza database.

type Mod<T> = T;
let nextStep: Mod<typeof import("./next-step.tsx")>;
let bigNumber: Mod<typeof import("./big-number.tsx")>;
let fold: Mod<typeof import("./fold.tsx")>;
let sheet: Mod<typeof import("./side-sheet.tsx")>;
let filters: Mod<typeof import("./filter-chips.tsx")>;
let empty: Mod<typeof import("./empty-state.tsx")>;
let row: Mod<typeof import("./row.tsx")>;
let toast: Mod<typeof import("./toast.ts")>;
let text: Mod<typeof import("./text.ts")>;
let icons: { Check: unknown; Plus: unknown };
let render: (element: unknown) => string;
let h: (type: unknown, props: unknown, ...children: unknown[]) => unknown;

before(async () => {
  await enableTsxImports();
  nextStep = await import("./next-step.tsx");
  bigNumber = await import("./big-number.tsx");
  fold = await import("./fold.tsx");
  sheet = await import("./side-sheet.tsx");
  filters = await import("./filter-chips.tsx");
  empty = await import("./empty-state.tsx");
  row = await import("./row.tsx");
  toast = await import("./toast.ts");
  text = await import("./text.ts");
  icons = (await import("lucide-react")) as unknown as { Check: unknown; Plus: unknown };
  const react = await import("react");
  h = (type, props, ...children) => react.createElement(type as never, props as never, ...(children as never[]));
  ({ renderToStaticMarkup: render } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string });
});

const readable = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const textOf = (html: string) => readable(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** I pulsanti pieni: `[data-slot=button]` con la classe `bg-primary`, come nell'harness delle schermate. */
function filledButtons(html: string): string[] {
  return [...html.matchAll(/<(?:a|button)\b[^>]*>/g)]
    .map(([tag]) => tag)
    .filter((tag) => tag.includes('data-slot="button"') && (/class="([^"]*)"/.exec(tag)?.[1].split(/\s+/) ?? []).includes("bg-primary"));
}

// ─── NextStep ────────────────────────────────────────────────────────

test("NextStep: l'etichetta, il solo pulsante pieno con l'icona e il verbo, il «?» con il perché", () => {
  const html = readable(render(h(nextStep.NextStep, { step: { label: "Decidi 4 use case", icon: icons.Check, why: "Il più vecchio aspetta da 9 giorni.", mine: true, href: "/dashboard/ws/use-cases?vista=da-decidere" } })));
  assert.match(html, /^<section aria-labelledby="prossimo-passo-etichetta" data-slot="next-step"/);
  assert.ok(html.includes('<p id="prossimo-passo-etichetta" class="text-xs text-muted-foreground">Prossimo passo</p>'));
  const filled = filledButtons(html);
  assert.equal(filled.length, 1);
  assert.match(filled[0], /^<a /, "un link");
  assert.match(filled[0], /href="\/dashboard\/ws\/use-cases\?vista=da-decidere"/);
  assert.match(filled[0], /aria-describedby="prossimo-passo-perche"/);
  // Al telefono largo quanto la colonna, alto 44 px; da 640 px alto 36 px e largo quanto il testo.
  assert.match(filled[0], /min-h-11/);
  assert.match(filled[0], /flex-1/);
  assert.match(filled[0], /sm:min-h-9/);
  assert.match(filled[0], /sm:flex-none/);
  assert.match(html, /<svg[^>]*aria-hidden="true"[^>]*data-icon="inline-start"/);
  assert.ok(html.includes('<span id="prossimo-passo-perche" class="sr-only">Il più vecchio aspetta da 9 giorni.</span>'));
  assert.match(html, /aria-label="Perché questo passo"/);
  assert.ok(!html.includes("next-step-turn"), "tocca a chi guarda: niente «Tocca a»");
});

test("NextStep: quando non tocca a chi guarda, le parole dello stato e «Tocca a …», senza pulsante", () => {
  const html = readable(render(h(nextStep.NextStep, { step: { label: "Manca l'ok sui fornitori", why: "Senza l'ok le domande non partono.", mine: false, turn: "Tocca a Cliente Demo.", href: "/x" } })));
  assert.equal(filledButtons(html).length, 0);
  assert.match(html, /<p data-slot="next-step-status"[^>]*aria-describedby="prossimo-passo-perche"[^>]*>.*Manca l'ok sui fornitori<\/p>/);
  assert.ok(html.includes('<p data-slot="next-step-turn" class="text-xs text-muted-foreground">Tocca a Cliente Demo.</p>'));
});

test("NextStep: niente da fare è «Tutto in ordine», senza pulsante e senza «?»; un'azione della pagina è un pulsante", () => {
  const done = readable(render(h(nextStep.NextStep, { step: null })));
  assert.ok(done.includes('data-slot="next-step-done"'));
  assert.equal(textOf(done), "Prossimo passo Tutto in ordine");
  assert.equal(filledButtons(done).length, 0);
  assert.ok(!done.includes("Perché questo passo"));
  const action = render(h(nextStep.NextStep, { id: "x", step: { label: "Chiudi il SAL", mine: true, onClick: () => undefined } }));
  const [button] = filledButtons(action);
  assert.match(button, /^<button type="button"/);
  assert.ok(!action.includes("x-perche"), "senza perché niente «?»");
  // Un link fatto da chi usa il passo prende il posto di `href`.
  const custom = render(h(nextStep.NextStep, { step: { label: "Vai", mine: true, href: "/a", link: h("a", { href: "/b", "data-proprio": "" }) } }));
  assert.match(filledButtons(custom)[0], /href="\/b"/);
  assert.match(custom, /data-proprio=""/);
});

// ─── BigNumber ───────────────────────────────────────────────────────

test("BigNumber: la cifra 36/40 (30/36 al telefono) su una riga, l'etichetta, la riga grigia e l'azione", () => {
  const html = readable(render(h(bigNumber.BigNumber, { value: "412.000 €", label: "Valore all'anno", note: "su 20 use case · in uso 38.000 €", action: h("a", { href: "/n" }, "Tutti i numeri") })));
  assert.match(html, /<p data-slot="big-number-value" class="text-3xl font-semibold tracking-tight whitespace-nowrap tabular-nums sm:text-4xl">412\.000 €<\/p>/);
  assert.ok(html.includes('<p data-slot="big-number-label" class="mt-1.5 text-sm font-medium">Valore all\'anno</p>'));
  assert.ok(html.includes('<p data-slot="big-number-note" class="mt-0.5 text-sm text-muted-foreground">su 20 use case · in uso 38.000 €</p>'));
  assert.ok(html.includes('<a href="/n">Tutti i numeri</a>'));
  const bare = render(h(bigNumber.BigNumber, { value: "1", label: "x" }));
  assert.ok(!bare.includes("big-number-note") && !bare.includes("<a"));
});

// ─── Fold ────────────────────────────────────────────────────────────

test("Fold: un vero H2 con il pulsante aria-expanded e aria-controls; chiusa per default, il contenuto nascosto", () => {
  const html = readable(render(h(fold.Fold, { id: "chi-propone", title: "Chi propone, per area", summary: "3 aree" }, h("p", null, "Dentro"))));
  assert.match(html, /^<section id="chi-propone" data-slot="fold" class="scroll-mt-20 border-t last:border-b"><h2 class="text-base font-semibold"><button type="button" aria-expanded="false" aria-controls="chi-propone-contenuto"/);
  assert.ok(html.includes(">Chi propone, per area</span>"));
  assert.ok(html.includes('<span class="min-w-0 text-sm font-normal text-muted-foreground">3 aree</span>'));
  assert.match(html, /<div id="chi-propone-contenuto" data-slot="fold-content" hidden="" class="space-y-4 pb-5"><p>Dentro<\/p><\/div>/);
  assert.match(html, /min-h-11/, "44 px al telefono");
  const open = render(h(fold.Fold, { id: "f", title: "T", defaultOpen: true }, "x"));
  assert.match(open, /aria-expanded="true"/);
  assert.match(open, /data-open=""/);
  assert.ok(!/fold-content" hidden/.test(open));
});

test("Fold: l'arrivo da un link la apre, e dopo un tocco decide chi guarda finché un link nuovo non la chiede", () => {
  const at = (hash: string, toggle: { open: boolean; hash: string } | null, defaultOpen = false) => fold.foldOpen({ id: "storia", defaultOpen, hash, toggle });
  assert.equal(at("", null), false, "chiusa per default");
  assert.equal(at("", null, true), true, "aperta dal server (?capitolo=)");
  assert.equal(at("#storia", null), true, "l'ancora è la sua");
  assert.equal(at("#altro", null), false);
  assert.equal(at("#storia", { open: false, hash: "#storia" }), false, "chi guarda l'ha chiusa");
  assert.equal(at("#storia", { open: false, hash: "" }), true, "un link nuovo la chiede di nuovo");
  assert.equal(at("", { open: true, hash: "" }), true);
  assert.equal(fold.hashTarget("#agente-LIBRA%20L1"), "agente-LIBRA L1");
  assert.equal(fold.hashTarget(""), "");
  assert.equal(fold.hashTarget("#%E0%A4%A"), "%E0%A4%A", "un'ancora mal scritta resta com'è");
});

// ─── SideSheet ───────────────────────────────────────────────────────

test("SideSheet: l'indirizzo del pannello (`?apri=`), con gli altri parametri e l'ancora che restano", () => {
  assert.equal(sheet.SHEET_PARAM, "apri");
  assert.equal(sheet.sheetHref("https://x.test/dashboard/ws?vista=a#s", "sal"), "/dashboard/ws?vista=a&apri=sal#s");
  assert.equal(sheet.sheetHref("https://x.test/dashboard/ws?apri=sal&vista=a", null), "/dashboard/ws?vista=a");
  assert.equal(sheet.sheetHref("https://x.test/dashboard/ws?apri=numeri", "valore"), "/dashboard/ws?apri=valore");
  assert.equal(sheet.sheetHref("https://x.test/p", "x", "fonte"), "/p?fonte=x");
});

test("SideSheet: fino a 32 rem da 640 px, a tutto schermo al telefono, ✕ «Chiudi» da 44 px; «Indietro» lo chiude", () => {
  const source = readFileSync(new URL("./side-sheet.tsx", import.meta.url), "utf8");
  assert.match(source, /data-\[side=right\]:w-full data-\[side=right\]:sm:max-w-lg/, "max-w-lg = 32 rem, w-full al telefono");
  assert.match(source, /<SheetClose render=\{<Button variant="ghost" size="icon" className="-mr-2 size-11 shrink-0 sm:size-9" \/>\}>/);
  assert.match(source, /<span className="sr-only">\{UI10_TEXT\.sheet\.close\}<\/span>/);
  assert.equal(text.UI10_TEXT.sheet.close, "Chiudi");
  // Aprire da chiuso aggiunge un passo; chiudere dopo un'apertura torna indietro; il «popstate» rilegge l'indirizzo.
  assert.match(source, /if \(next && !wasOpen\) \{\s*window\.history\.pushState\(window\.history\.state, "", target\);/);
  assert.match(source, /window\.history\.back\(\);/);
  assert.match(source, /window\.addEventListener\("popstate", onPop\);/);
  // Il piede porta il suo pulsante pieno.
  assert.match(source, /\{footer \? <SheetFooter className="mt-0 border-t px-4 py-3 sm:px-6">\{footer\}<\/SheetFooter> : null\}/);
});

// ─── FilterChips ─────────────────────────────────────────────────────

const FIELDS = [
  { key: "area", label: "Area", value: "amministrazione", options: [{ value: "amministrazione", label: "Amministrazione" }, { value: "vendite", label: "Vendite" }] },
  { key: "referente", label: "Referente", value: null, options: [{ value: "manca", label: "Manca il referente" }] },
  { key: "trimestre", label: "Trimestre", value: "2026-Q4", options: [{ value: "2026-Q4", label: "T4 2026" }] },
];
const QUERY = { vista: "panoramica", area: "amministrazione", trimestre: "2026-Q4", q: "fatture" };
const BASE = "/dashboard/ws/use-cases";

test("FilterChips: i filtri nell'indirizzo; un chip con ✕ toglie il suo, «Togli tutti» li toglie con la ricerca", () => {
  assert.equal(filters.filterHref(BASE, QUERY, { area: null }), `${BASE}?vista=panoramica&trimestre=2026-Q4&q=fatture`);
  assert.equal(filters.filterHref(BASE, QUERY, { area: "vendite" }), `${BASE}?vista=panoramica&area=vendite&trimestre=2026-Q4&q=fatture`, "l'ordine resta");
  assert.equal(filters.filterHref(BASE, {}, { vista: "cosa-serve" }), `${BASE}?vista=cosa-serve`);
  assert.equal(filters.filterHref(BASE, { vista: "" }, {}), BASE);
  assert.deepEqual(filters.activeChips({ basePath: BASE, query: QUERY, fields: FIELDS }), [
    { key: "area", text: "Area: Amministrazione", removeHref: `${BASE}?vista=panoramica&trimestre=2026-Q4&q=fatture` },
    { key: "trimestre", text: "Trimestre: T4 2026", removeHref: `${BASE}?vista=panoramica&area=amministrazione&q=fatture` },
  ]);
  assert.equal(filters.clearAllHref({ basePath: BASE, query: QUERY, fields: FIELDS, search: { param: "q" } }), `${BASE}?vista=panoramica`);
});

test("FilterChips: «Cerca», «Filtri (n)», i chip attivi con ✕ e «Togli tutti», resi", () => {
  const html = readable(render(h(filters.FilterChips, { basePath: BASE, query: QUERY, search: { param: "q" }, fields: FIELDS })));
  const form = /<form role="search"[^>]*>/.exec(html)?.[0] ?? "";
  assert.match(form, /action="\/dashboard\/ws\/use-cases"/);
  assert.match(form, /method="get"/);
  const field = /<input type="search"[^>]*>/.exec(html)?.[0] ?? "";
  assert.match(field, /name="q"/, "il campo della ricerca");
  assert.match(field, /value="fatture"/, "con il valore di adesso");
  assert.match(field, /placeholder="Cerca"/);
  assert.match(field, /text-base/, "16 px al telefono");
  assert.ok(html.includes('<input type="hidden" name="vista" value="panoramica"/>'), "la vista resta");
  assert.ok(!html.includes('type="hidden" name="q"'), "la ricerca la scrive il campo");
  assert.match(html, /aria-label="Cerca"[^>]*class="[^"]*sm:hidden/, "al telefono un'icona");
  assert.ok(textOf(html).includes("Filtri (2)"));
  assert.match(html, /aria-haspopup="dialog"/);
  assert.ok(html.includes('aria-label="Togli Area: Amministrazione"'));
  assert.ok(html.includes(`href="${BASE}?vista=panoramica&trimestre=2026-Q4&q=fatture"`));
  assert.ok(html.includes(`href="${BASE}?vista=panoramica">Togli tutti</a>`));
  assert.equal(filledButtons(html).length, 0, "il pieno è del prossimo passo: qui nessuno");
  // Senza filtri attivi: «Filtri» senza numero, niente chip.
  const none = readable(render(h(filters.FilterChips, { basePath: BASE, query: { vista: "panoramica" }, fields: FIELDS.map((f) => ({ ...f, value: null })) })));
  assert.ok(textOf(none).includes("Filtri") && !textOf(none).includes("Filtri ("));
  assert.ok(!none.includes("filter-chips-active") && !none.includes("Togli tutti") && !none.includes('role="search"'));
  assert.equal(text.UI10_TEXT.filters.open(0), "Filtri");
});

// ─── EmptyState, Row ─────────────────────────────────────────────────

test("EmptyState: una frase e un'azione, piena solo se è il prossimo passo", () => {
  const next = readable(render(h(empty.EmptyState, { text: "Le tue idee arrivano qui: proponi il primo use case.", action: { label: "Proponi un use case", href: "/nuovo", icon: icons.Plus, nextStep: true } })));
  assert.ok(next.includes('<p class="text-sm text-muted-foreground">Le tue idee arrivano qui: proponi il primo use case.</p>'));
  assert.equal(filledButtons(next).length, 1);
  assert.match(filledButtons(next)[0], /href="\/nuovo"/);
  const other = render(h(empty.EmptyState, { text: "Niente.", action: { label: "Apri", href: "/a" } }));
  assert.equal(filledButtons(other).length, 0);
  assert.match(other, /data-slot="button"/, "bordato");
  assert.ok(!render(h(empty.EmptyState, { text: "Niente." })).includes("<a"), "senza azione, solo la frase");
});

test("Row: un link, un pulsante che apre un pannello o una riga ferma; almeno 44 px, la freccia solo dove porta", () => {
  const link = readable(render(h(row.Row, { title: "Iniziative", fact: "24 use case", href: "/i" })));
  assert.match(link, /^<a data-slot="row" class="[^"]*min-h-11[^"]*sm:min-h-12[^"]*" href="\/i">/);
  assert.ok(link.includes('<span class="min-w-0 text-muted-foreground sm:text-right">24 use case</span>'));
  assert.match(link, /<svg[^>]*aria-hidden="true"/);
  const panel = render(h(row.Row, { title: "SAL", onClick: () => undefined, opensPanel: true, "data-row": "sal" }));
  assert.match(panel, /^<button type="button" aria-haspopup="dialog" data-slot="row" data-row="sal"/);
  const still = render(h(row.Row, { title: "Fatto" }));
  assert.match(still, /^<div data-slot="row"/);
  assert.ok(!still.includes("<svg"), "niente freccia");
  const list = render(h(row.RowList, { label: "Righe" }, h("li", null, "x")));
  assert.match(list, /^<ul aria-label="Righe" data-slot="row-list" class="divide-y overflow-hidden rounded-xl border bg-card"><li>x<\/li><\/ul>$/);
  const action = render(h(row.TextAction, { onClick: () => undefined, opensPanel: true }, "Tutti i numeri"));
  assert.match(action, /^<button type="button" aria-haspopup="dialog" data-slot="text-action"/);
  assert.ok(action.includes("Tutti i numeri"));
});

// ─── Avvisi ──────────────────────────────────────────────────────────

test("gli avvisi: 4 secondi, 10 con «Annulla»; un motore solo (sonner), nessun avviso d'errore", () => {
  assert.equal(toast.TOAST_MS, 4_000);
  assert.equal(toast.TOAST_UNDO_MS, 10_000);
  assert.deepEqual(toast.toastOptions(), { duration: 4_000 });
  const undo = () => undefined;
  assert.deepEqual(toast.toastOptions(undo), { duration: 10_000, action: { label: "Annulla", onClick: undo } });
  const source = readFileSync(new URL("./toast.ts", import.meta.url), "utf8");
  assert.match(source, /^import \{ toast \} from "sonner";/m);
  assert.doesNotMatch(source, /toast\.error/, "un errore che chiede di agire sta nella pagina");
});

// ─── L'indice e i testi ──────────────────────────────────────────────

test("l'indice documenta ogni pezzo, e i pezzi client lo dicono", () => {
  const index = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  for (const name of ["NextStep", "BigNumber", "Fold", "SideSheet", "useSheetParam", "FilterChips", "EmptyState", "notifyDone", "notifyWithUndo", "Row", "TextAction"]) {
    assert.ok(index.includes(`\`${name}\``), `${name} documentato`);
    assert.match(index, new RegExp(`export \\{[^}]*\\b${name}\\b`), `${name} esportato`);
  }
  for (const file of ["fold.tsx", "side-sheet.tsx", "filter-chips.tsx", "why.tsx"]) assert.match(readFileSync(new URL(`./${file}`, import.meta.url), "utf8"), /^"use client";/, file);
  for (const file of ["next-step.tsx", "big-number.tsx", "row.tsx", "empty-state.tsx"]) assert.doesNotMatch(readFileSync(new URL(`./${file}`, import.meta.url), "utf8"), /"use client"/, file);
  assert.deepEqual(text.UI10_TEXT.nextStep, { label: "Prossimo passo", why: "Perché questo passo", done: "Tutto in ordine" });
});
