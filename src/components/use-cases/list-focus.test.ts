import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { enableTsxImports } from "./detail/referent/tsx-test-loader.ts";

// «‹ Torna alla Panoramica» (prima «‹ Torna alla lista», rilascio «Pulizia»), sopra i grafici del menu
// «⋯»: il pulsante sparisce con il grafico; il fuoco va al titolo della Panoramica, non sul <body>, e
// solo dopo quel clic. Lo stesso per «Vedi cosa serve», «Vedi le proposte» e «Da decidere» delle fasi
// (rilascio «Panoramica»): il fuoco va al titolo di «Cosa serve» o di «Da decidere».
let focus: typeof import("./list-focus.tsx");
let renderToStaticMarkup: (element: unknown) => string;
let createElement: (type: unknown, props: unknown, ...children: unknown[]) => unknown;
before(async () => {
  await enableTsxImports();
  focus = await import("./list-focus.tsx");
  const react = await import("react");
  createElement = (type, props, ...children) => react.createElement(type as never, props as never, ...(children as never[]));
  ({ renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string });
});

const CLICK = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };

test("il segno di «‹ Torna alla Panoramica» vale una volta, e solo per il clic che resta nella pagina", () => {
  assert.equal(focus.takeListFocus(), false, "senza clic il fuoco resta dov'è");
  focus.markListFocus();
  assert.equal(focus.takeListFocus(), true);
  assert.equal(focus.takeListFocus(), false, "una volta sola");
  assert.equal(focus.staysInPage(CLICK), true);
  for (const key of ["metaKey", "ctrlKey", "shiftKey", "altKey"] as const) assert.equal(focus.staysInPage({ ...CLICK, [key]: true }), false, key);
  assert.equal(focus.staysInPage({ ...CLICK, button: 1 }), false, "clic centrale: nuova scheda");
});

test("il titolo della lista: solo per i lettori di schermo, raggiungibile dal codice e non dal Tab", () => {
  const html = renderToStaticMarkup(createElement(focus.ListFocusTarget, { title: "Da costruire" }));
  assert.equal(html, '<h2 tabindex="-1" data-slot="list-focus" class="sr-only">Da costruire</h2>');
  const link = renderToStaticMarkup(createElement(focus.BackToListLink, { href: "/dashboard/x/use-cases?vista=panoramica" }, "Torna alla Panoramica"));
  assert.match(link, /^<a [^>]*href="\/dashboard\/x\/use-cases\?vista=panoramica"/);
  assert.ok(link.includes("Torna alla Panoramica"));
});

test("un link della Panoramica verso un'altra vista lascia il segno, solo con il clic che resta nella pagina", () => {
  const link = renderToStaticMarkup(createElement(focus.ViewFocusLink, { href: "/dashboard/x/use-cases?vista=cosa-serve&trimestre=2026-Q4", className: "c" }, "Vedi cosa serve"));
  assert.equal(link, '<a class="c" href="/dashboard/x/use-cases?vista=cosa-serve&amp;trimestre=2026-Q4">Vedi cosa serve</a>');
  // Il clic: prima l'onClick di chi lo usa (il `Button` di «Prossimo passo»), poi il segno.
  const calls: string[] = [];
  const rendered = focus.ViewFocusLink({ href: "/x", onClick: () => calls.push("proprio") }) as unknown as { props: { onClick: (event: unknown) => void } };
  const onClick = rendered.props.onClick;
  const event = (extra: Partial<typeof CLICK> = {}) => ({ ...CLICK, ...extra, defaultPrevented: true, preventDefault() {} });
  focus.takeListFocus();
  onClick(event({ metaKey: true }));
  assert.deepEqual([calls, focus.takeListFocus()], [["proprio"], false], "una nuova scheda: nessun segno");
  onClick(event());
  assert.deepEqual([calls, focus.takeListFocus()], [["proprio", "proprio"], true]);
});

test("la Panoramica, «Cosa serve» e «Da decidere» hanno il loro titolo; «‹ Torna alla Panoramica» sta sopra i grafici", () => {
  const hub = readFileSync(new URL("./hub.tsx", import.meta.url), "utf8");
  assert.ok(hub.includes("<ListFocusTarget title={HUB_TEXT.overviewView} />"), "il titolo della Panoramica, per il ritorno");
  // Le due viste dei link della Panoramica: il titolo monta con la vista, prima di lei.
  assert.match(hub, /<ListFocusTarget key="cosa-serve" title="Cosa serve" \/>\s*<NeedsBoardView\b/);
  assert.match(hub, /<ListFocusTarget key="da-decidere" title=\{reviewer \? HUB_TEXT\.decideView : HUB_TEXT\.contributorDecideView\} \/>\s*<DecideView\b/);
  assert.equal(hub.split("<ListFocusTarget").length - 1, 3, "un titolo per vista");
  // «Vedi cosa serve» / «Vedi le proposte» e «Da decidere» delle fasi lasciano il segno.
  const top = readFileSync(new URL("./panoramica-top.tsx", import.meta.url), "utf8");
  assert.ok(top.includes("render={<ViewFocusLink href={nextStep.href} />}"), "il pulsante di «Prossimo passo»");
  assert.ok(top.includes("<ViewFocusLink href={decideHref} className={STEP_LINK}>"), "«Da decidere» delle fasi");
  assert.ok(!/from "next\/link"/.test(top), "nessun altro link che cambia vista");
  // I grafici del menu «⋯» stanno in chart-view.tsx: il ritorno sopra, mai un titolo da mettere a fuoco.
  const source = readFileSync(new URL("./chart-view.tsx", import.meta.url), "utf8");
  assert.ok(source.includes("<BackToListLink href={backHref}>{CHART_TEXT.back}</BackToListLink>"));
  assert.ok(!source.includes("<ListFocusTarget"), "il titolo è della Panoramica");
  assert.match(hub, /<HubChartView\b/, "il grafico al posto delle corsie");
  const own = readFileSync(new URL("./list-focus.tsx", import.meta.url), "utf8");
  assert.match(own, /useEffect\(\(\) => \{\s*if \(takeListFocus\(\)\) ref\.current\?\.focus\(\);\s*\}, \[\]\);/);
});

// I link con un'ancora che cambiano vista (rilascio «Panoramica»): da Next 16.3 Next scorre all'ancora
// ma non le dà più il fuoco. Il clic lascia l'ancora come segno, l'hub la mette a fuoco a navigazione
// confermata: una card di «Per agente», «‹ Tutti gli agenti» e «Vai alla Panoramica» di «Cosa serve».
test("l'ancora di un link: decodificata come fa Next, e nessuna senza `#`", () => {
  assert.equal(focus.hashTargetOf("/dashboard/x/use-cases?vista=panoramica&agente=LIBRA#panoramica-approvati"), "panoramica-approvati");
  assert.equal(focus.hashTargetOf("?mostra=agenti#agente-LIBRA"), "agente-LIBRA");
  assert.equal(focus.hashTargetOf("#a%20b"), "a b");
  assert.equal(focus.hashTargetOf("#%E0"), "%E0", "un'ancora che non si decodifica resta com'è");
  assert.equal(focus.hashTargetOf("/dashboard/x/use-cases?vista=panoramica"), null);
  assert.equal(focus.hashTargetOf("/dashboard/x/use-cases#"), null);
});

test("il segno dell'ancora vale una volta, e solo se l'indirizzo arrivato ha quell'ancora", () => {
  assert.equal(focus.takeHashFocus("#agente-LIBRA"), null, "senza clic il fuoco resta dov'è");
  focus.markHashFocus("agente-LIBRA");
  assert.equal(focus.takeHashFocus("#agente-LIBRA"), "agente-LIBRA");
  assert.equal(focus.takeHashFocus("#agente-LIBRA"), null, "una volta sola");
  // Un clic che non ha navigato (o un'altra navigazione arrivata prima): il segno se ne va senza fuoco.
  focus.markHashFocus("agente-LIBRA");
  assert.equal(focus.takeHashFocus(""), null);
  assert.equal(focus.takeHashFocus("#agente-LIBRA"), null, "il segno vecchio non vale per la navigazione dopo");
  focus.markHashFocus("panoramica-approvati");
  assert.equal(focus.takeHashFocus("#panoramica-in-realizzazione"), null);
});

test("un link con un'ancora: senza `scroll={false}`, il clic lascia il segno; se cambia solo l'ancora il fuoco va subito", () => {
  const html = renderToStaticMarkup(createElement(focus.HashFocusLink, { id: "agente-LIBRA", href: "/dashboard/x/use-cases?vista=panoramica&agente=LIBRA#panoramica-approvati", className: "c" }, "LIBRA"));
  assert.equal(html, '<a id="agente-LIBRA" class="c" href="/dashboard/x/use-cases?vista=panoramica&amp;agente=LIBRA#panoramica-approvati">LIBRA</a>');
  const href = "/dashboard/x/use-cases?vista=panoramica&mostra=agenti#agente-LIBRA";
  const calls: string[] = [];
  const onClickOf = (to: string) =>
    (focus.HashFocusLink({ href: to, onClick: () => calls.push("proprio") }) as unknown as { props: { onClick: (event: unknown) => void; scroll?: boolean } }).props;
  assert.equal(onClickOf(href).scroll, undefined, "Next scorre all'ancora");
  const focused: unknown[] = [];
  const page = globalThis as { window?: unknown; document?: unknown };
  page.window = { location: new URL("http://localhost/dashboard/x/use-cases?vista=panoramica&agente=LIBRA") };
  page.document = { getElementById: (id: string) => ({ focus: (options: unknown) => focused.push([id, options]) }) };
  const event = (extra: Partial<typeof CLICK> = {}) => ({ ...CLICK, ...extra, defaultPrevented: false, preventDefault() {} });
  try {
    focus.takeHashFocus("");
    onClickOf(href).onClick(event({ ctrlKey: true }));
    assert.deepEqual([calls, focus.takeHashFocus("#agente-LIBRA")], [["proprio"], null], "una nuova scheda: nessun segno");
    onClickOf(href).onClick({ ...event(), defaultPrevented: true });
    assert.equal(focus.takeHashFocus("#agente-LIBRA"), null, "un clic fermato da chi usa il link non naviga");
    // Un'altra vista (cambiano i parametri): il fuoco aspetta la navigazione confermata.
    onClickOf(href).onClick(event());
    assert.deepEqual([focused, focus.takeHashFocus("#agente-LIBRA")], [[], "agente-LIBRA"]);
    // Cambia solo l'ancora: la pagina resta, il bersaglio c'è già e prende il fuoco subito, senza scorrere.
    onClickOf("/dashboard/x/use-cases?vista=panoramica&agente=LIBRA#panoramica-approvati").onClick(event());
    assert.deepEqual(focused, [["panoramica-approvati", { preventScroll: true }]]);
    assert.equal(focus.takeHashFocus("#panoramica-approvati"), null, "nessun segno da aspettare");
  } finally {
    delete page.window;
    delete page.document;
  }
});

test("le ancore che cambiano vista usano `HashFocusLink`, e l'hub monta `HashFocusOnCommit` una volta", () => {
  const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");
  const grid = read("./agent-grid.tsx");
  assert.match(grid, /<HashFocusLink\s+id=\{agentCardId\(group\.param\)\}\s+href=\{href\}/, "la card di «Per agente»");
  const lanesSource = read("./panorama-lanes.tsx");
  assert.match(lanesSource, /<HashFocusLink\s+href=\{agentLine\.backHref\}/, "«‹ Tutti gli agenti»");
  const board = read("./needs-board.tsx");
  assert.ok(board.includes("render={<HashFocusLink href={toRealization} />}"), "«Vai alla Panoramica» del vuoto");
  assert.match(board, /<HashFocusLink\s+href=\{toRealization\}/, "«Vai alla Panoramica» sotto le tabelle");
  // Nessun `<Link>` semplice per queste ancore: il fuoco andrebbe sul <body>.
  assert.ok(!/from "next\/link"/.test(grid) && !/from "next\/link"/.test(lanesSource), "agent-grid e panorama-lanes non hanno altri link");
  assert.ok(!/<Link\s+href=\{toRealization\}/.test(board) && !board.includes("<Link href={toRealization}"), "needs-board");
  const hub = read("./hub.tsx");
  assert.equal(hub.split("<HashFocusOnCommit />").length - 1, 1);
  const own = read("./list-focus.tsx");
  // Dopo ogni navigazione confermata (percorso o parametri), dopo lo scorrimento di Next: senza scorrere ancora.
  assert.match(own, /useEffect\(\(\) => \{\s*const id = takeHashFocus\(window\.location\.hash\);\s*if \(id\) focusHashTarget\(id\);\s*\}, \[pathname, search\]\);/);
  assert.match(own, /getElementById\(id\)\?\.focus\(\{ preventScroll: true \}\)/);
});
