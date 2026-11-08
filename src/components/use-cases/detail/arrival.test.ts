import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { enableTsxImports } from "./referent/tsx-test-loader.ts";

// L'arrivo sulla scheda da un `#ancora` dell'indirizzo (rilascio 3): un link copiato a metà o
// storpiato («#%», «#100%») apriva il confine d'errore «Non riusciamo a caricare gli use case.» al
// posto della scheda, perché `decodeURIComponent` lanciava `URIError` nell'effetto di `Arrival`, e
// «Riprova» non serviva: l'ancora restava nell'indirizzo. Ora l'ancora si legge con `knownAnchorOf`.
//
// L'arrivo una volta per navigazione: sulla scheda pronta aperta da «Pronto da avviare»
// (`?capitolo=realizzazione`, che resta nell'indirizzo per tutta la visita) un clic su «Più avanti»
// in «Quando» rileggeva la pagina, il passo passava da G9 a G3, `?capitolo=realizzazione` si
// risolveva nella piega invece che nel riquadro, e la piega si apriva da sola, il fuoco lasciava la
// scelta e la pagina scorreva; «Questo trimestre» la richiudeva e riportava la pagina al riquadro.
let arrival: typeof import("./arrival.tsx");
let fold: typeof import("./fold.tsx");
let renderToStaticMarkup: (element: unknown) => string;
let createElement: (type: unknown, props: unknown, ...children: unknown[]) => unknown;
before(async () => {
  await enableTsxImports();
  arrival = await import("./arrival.tsx");
  fold = await import("./fold.tsx");
  const react = await import("react");
  createElement = (type, props, ...children) => react.createElement(type as never, props as never, ...(children as never[]));
  ({ renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string });
});

const IDS = ["decisione", "impatto", "cosa-e", "cosa-serve", "storia"] as const;
/** Una scheda approvata con la piega «Realizzazione» e le richieste ai referenti. */
const READY_IDS = ["decisione", "impatto", "cosa-e", "cosa-serve", "richieste", "quando", "nota-pubblica", "valutazione", "dettagli", "realizzazione", "storia"] as const;

test("knownAnchorOf: un'ancora della scheda arriva; una malformata non lancia e non arriva da nessuna parte", () => {
  assert.equal(arrival.knownAnchorOf("#storia", IDS), "storia");
  assert.equal(arrival.knownAnchorOf("#cosa-serve", IDS), "cosa-serve");
  assert.equal(arrival.knownAnchorOf("#%63osa-e", IDS), "cosa-e", "decodificata come fa il browser");
  for (const hash of ["#%", "#100%", "#%E0%A4%A", "#%E0"]) {
    assert.doesNotThrow(() => arrival.knownAnchorOf(hash, IDS), hash);
    assert.equal(arrival.knownAnchorOf(hash, IDS), null, hash);
  }
  assert.equal(arrival.knownAnchorOf("", IDS), null, "senza ancora");
  assert.equal(arrival.knownAnchorOf("#", IDS), null, "un # da solo");
  assert.equal(arrival.knownAnchorOf("#quando", IDS), null, "un'ancora che questa scheda non ha");
});

test("knownAnchorOf: un `#ancora` segue la regola di `?capitolo=`; «#realizzazione» su una scheda pronta arriva al riquadro", () => {
  // Un vecchio link copiato «…#realizzazione»: con «Avvia la realizzazione» nel riquadro (G9) la piega non ha il pulsante.
  assert.equal(arrival.knownAnchorOf("#realizzazione", READY_IDS, true), "decisione");
  assert.equal(arrival.knownAnchorOf("#realizzazione", READY_IDS, false), "realizzazione", "non più pronta, o il revisore del cliente: la piega");
  assert.equal(arrival.knownAnchorOf("#realizzazione", READY_IDS), "realizzazione", "senza dire dove sta l'avvio, la piega come prima");
  assert.equal(arrival.knownAnchorOf("#realizzazione", IDS, false), "decisione", "senza la piega: il riquadro, come `?capitolo=realizzazione`");
  assert.equal(arrival.knownAnchorOf("#richieste", IDS), "cosa-serve", "senza richieste a vista: «Cosa serve», come `?capitolo=richieste`");
  assert.equal(arrival.knownAnchorOf("#storia", READY_IDS, true), "storia", "le altre ancore non cambiano");
});

test("Arrival legge l'ancora dell'indirizzo solo con knownAnchorOf, mai con un decodeURIComponent nudo", () => {
  const source = readFileSync(new URL("./arrival.tsx", import.meta.url), "utf8");
  assert.match(source, /knownAnchorOf\(window\.location\.hash, known, inBox\)/);
  assert.doesNotMatch(source, /decodeURIComponent\(/, "la decodifica sta in hashTargetOf, che non lancia");
});

test("l'arrivo vale per la navigazione: una rilettura sullo stesso indirizzo lo tiene anche se il passo cambia, un link nuovo arriva di nuovo", () => {
  const card = "/dashboard/w/use-cases/u";
  const landing = arrival.navigationKey(card, "realizzazione");
  // La scheda pronta (G9): `?capitolo=realizzazione` arriva al riquadro.
  const first = arrival.landingFor(null, landing, "decisione");
  assert.deepEqual(first, { navigation: landing, target: "decisione" });
  // «Più avanti» in «Quando»: la pagina si rilegge sullo stesso indirizzo, la scheda passa a G3 e lo
  // stesso `?capitolo=` oggi si risolverebbe nella piega. L'arrivo resta quello di prima: niente si apre.
  assert.equal(arrival.navigationKey(card, "realizzazione"), landing, "una rilettura non cambia la navigazione");
  const afterLater = arrival.landingFor(first, landing, "realizzazione");
  assert.equal(afterLater, first, "la stessa navigazione tiene il suo arrivo");
  // «Questo trimestre»: di nuovo G9, lo stesso arrivo.
  assert.equal(arrival.landingFor(afterLater, landing, "decisione"), first);
  // Un link a un altro capitolo (la campanella, un'email, un link della pagina): arriva di nuovo.
  const storia = arrival.landingFor(first, arrival.navigationKey(card, "storia"), "storia");
  assert.deepEqual(storia, { navigation: arrival.navigationKey(card, "storia"), target: "storia" });
  // Tornare al link di prima è una navigazione anche lei: l'ancora di adesso.
  assert.deepEqual(arrival.landingFor(storia, landing, "realizzazione"), { navigation: landing, target: "realizzazione" });
  // Un'altra scheda, lo stesso capitolo: una navigazione nuova; senza capitolo, un'altra ancora.
  assert.notEqual(arrival.navigationKey("/dashboard/w/use-cases/v", "realizzazione"), landing);
  assert.notEqual(arrival.navigationKey(card, null), landing);
  assert.equal(arrival.navigationKey(card, null), arrival.navigationKey(card, null));
});

test("Arrival: l'effetto dell'arrivo riparte solo con la navigazione, non con l'ancora risolta né con le ancore della scheda", () => {
  const source = readFileSync(new URL("./arrival.tsx", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("export function Arrival("), source.indexOf("/** Il link tranquillo"));
  assert.ok(body.length > 0, "Arrival c'è");
  // Le dipendenze degli effetti: la navigazione per l'arrivo, nessuna per `hashchange`; l'ancora risolta si legge da `latest`.
  const deps = [...body.matchAll(/\}, (\[[^\]]*\])\);/g)].map((m) => m[1]);
  assert.deepEqual(deps, ["[navigation]", "[]"], "l'arrivo non riparte con `initial`, `ids` o `startInBox`");
  assert.match(body, /const \{ target, ids: known, startInBox: inBox \} = latest\.current;/, "l'ancora risolta e le ancore della scheda dall'ultima resa");
  assert.match(body, /navigationKey\(usePathname\(\), chapter\)/, "la navigazione: il percorso e il `?capitolo=` della pagina resa");
});

test("Indietro e Avanti tra due `?capitolo=` della stessa scheda: la chiave viene dalla resa di `initial`, non dall'indirizzo", () => {
  const card = "/dashboard/w/use-cases/u";
  const key = (chapter: string | null) => arrival.navigationKey(card, chapter);
  // Il caricamento con ?capitolo=dettagli, poi un link a ?capitolo=storia.
  const loaded = arrival.landingFor(null, key("dettagli"), "dettagli");
  const pushed = arrival.landingFor(loaded, key("storia"), "storia");
  assert.deepEqual(pushed, { navigation: key("storia"), target: "storia" });
  // Indietro: Next rende prima la pagina di ?capitolo=storia (il `useDeferredValue` di layout-router)
  // con l'indirizzo già a ?capitolo=dettagli, poi quella di ?capitolo=dettagli. Con la chiave e
  // l'ancora dalla stessa resa la prima resa non cambia nulla e la seconda arriva a «Dettagli».
  const stale = arrival.landingFor(pushed, key("storia"), "storia");
  assert.equal(stale, pushed, "la resa di prima tiene il suo arrivo");
  const back = arrival.landingFor(stale, key("dettagli"), "dettagli");
  assert.deepEqual(back, { navigation: key("dettagli"), target: "dettagli" }, "Indietro: «Dettagli»");
  // Avanti, allo stesso modo: «Storia».
  const forward = arrival.landingFor(arrival.landingFor(back, key("dettagli"), "dettagli"), key("storia"), "storia");
  assert.deepEqual(forward, { navigation: key("storia"), target: "storia" }, "Avanti: «Storia»");
  // Con la chiave dall'indirizzo (?capitolo=dettagli) e l'ancora della resa di prima («storia») l'arrivo
  // nuovo nasceva con l'ancora sbagliata e la teneva per tutta la navigazione: questo non deve tornare.
  const fromAddress = arrival.landingFor(pushed, key("dettagli"), "storia");
  assert.equal(arrival.landingFor(fromAddress, key("dettagli"), "dettagli"), fromAddress);
  assert.equal(fromAddress.target, "storia");
  // Il sorgente: nessun `useSearchParams` nell'arrivo; la scheda gli passa lo stesso `chapter` che risolve in `initial`.
  const source = readFileSync(new URL("./arrival.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /useSearchParams\(/, "la chiave non viene dall'indirizzo");
  const detail = readFileSync(new URL("./detail.tsx", import.meta.url), "utf8");
  assert.match(detail, /const arrival = arrivalTarget\(chapter \?\? null, targets, step\);/);
  assert.match(detail, /<Arrival initial=\{arrival\} chapter=\{chapter \?\? null\} /, "`initial` e `chapter` dalla stessa resa");
});

test("le pieghe nascono aperte dall'arrivo della navigazione, non da una prop del passo di adesso", () => {
  const html = (initial: string | null, ...folds: Array<{ id: string; open?: boolean }>) =>
    renderToStaticMarkup(
      createElement(
        arrival.Arrival,
        { initial, ids: READY_IDS, startInBox: false },
        ...folds.map((f) => createElement(fold.Fold, { key: f.id, id: f.id, title: f.id, open: f.open }, "contenuto")),
      ),
    );
  const opened = (markup: string) => [...markup.matchAll(/<details id="([a-z-]+)"[^>]*\sopen=""/g)].map((m) => m[1]);
  // L'HTML del server, come al caricamento: la piega dell'arrivo aperta, le altre chiuse.
  assert.deepEqual(opened(html("realizzazione", { id: "valutazione" }, { id: "realizzazione" }, { id: "storia" })), ["realizzazione"]);
  assert.match(html("valutazione", { id: "valutazione" }), /^<details id="valutazione" open="" data-slot="fold"/);
  assert.deepEqual(opened(html("decisione", { id: "valutazione" }, { id: "realizzazione" })), [], "al riquadro: nessuna piega aperta");
  assert.deepEqual(opened(html(null, { id: "storia", open: true })), ["storia"], "«Mostra tutto» della Storia");
  // Fuori da Arrival nessun arrivo: la piega è chiusa.
  assert.deepEqual(opened(renderToStaticMarkup(createElement(fold.Fold, { id: "realizzazione", title: "Realizzazione" }, "x"))), []);
  // La scheda non passa alle pieghe né a «Cosa serve» l'ancora risolta di adesso, che cambia con il passo.
  const detail = readFileSync(new URL("./detail.tsx", import.meta.url), "utf8");
  const foldTags = [...detail.matchAll(/<Fold\b[^>]*>/g)].map((m) => m[0]);
  assert.equal(foldTags.length, 4, "valutazione, dettagli, realizzazione, storia");
  assert.deepEqual(foldTags.filter((tag) => /\sopen=/.test(tag)), ['<Fold id="storia" title={t.storia} summary={summaries.storia} open={historyAll}>'], "solo «Mostra tutto», che sta nell'indirizzo");
  assert.doesNotMatch(detail, /requestsOpen=|opens\(/, "«Richieste inviate» legge l'arrivo da sé");
  const needs = readFileSync(new URL("./section-needs.tsx", import.meta.url), "utf8");
  assert.match(needs, /const landing = useLanding\(\);\n  const requestsOpen = landing === "richieste";/);
  // (Rilascio 6) I requisiti dietro il loro conteggio: aperti dall'arrivo a «Cosa serve», mai dal passo di adesso.
  assert.match(needs, /const requirementsOpen = landing === id;/);
  assert.match(needs, /defaultOpen=\{requirementsOpen\}\n\s+arrivalOpen/);
  assert.match(needs, /<Disclosure id="richieste" defaultOpen=\{requestsOpen\}/);
});
