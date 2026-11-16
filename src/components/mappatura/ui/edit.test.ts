import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { enableTsxImports } from "../../use-cases/detail/referent/tsx-test-loader.ts";
import { fixtureBoard } from "../../../lib/mappatura/board-fixture.ts";
import type { BoardNote } from "../../../lib/mappatura/board-model.ts";

// I controlli per modificare la board (docs/mappatura/MAPPATURA-BOARD-PIANO.md §4.9; P44, P51–P57, P65, P67, P78, P85,
// F1, F9): il testo sul posto, la nota con i suoi tre stati, i chip con «+ ruolo», i voti, i livelli, i segmenti, i
// campi, il toast, la conferma in linea, il blocco vuoto. Markup statico; le funzioni pure a parte; i clic dagli
// elementi che i componenti senza hook restituiscono.

await enableTsxImports();
const edit = await import("./edit.tsx");
const { BoardToastView, ChipInput, EmptyBlock, Field, InlineConfirm, LevelButtons, NoteItem, NumberInput, Segmented, TextInPlace, Votes } = edit;
const { toastLift } = edit;
const { addedChip, committedText, fieldHolder, keepFocusAfter, leaveFieldKey, nextVotes, noteToggleLabel, parsedNumber } = edit;
const { BoardProvider, useBoardClient } = await import("../store/use-board.tsx");

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);
/** `createElement` con i figli dopo le props: il tipo di React li vuole tra le props quando un componente li chiede. */
const h = <P extends object>(type: (props: P) => ReactNode, props: Omit<P, "children"> | null = null, ...children: ReactNode[]) =>
  createElement(type as unknown as FunctionComponent<Omit<P, "children">>, props, ...children);
type Props = Record<string, unknown>;
function* elements(node: unknown): Generator<ReactElement<Props>> {
  if (Array.isArray(node)) {
    for (const item of node) yield* elements(item);
  } else if (node && typeof node === "object" && "props" in node) {
    const element = node as ReactElement<Props>;
    yield element;
    yield* elements(element.props.children);
  }
}
const buttonsOf = (node: unknown) => [...elements(node)].filter((element) => element.type === "button");
const note = (status: BoardNote["status"], origin: BoardNote["origin"]): BoardNote => ({ id: "n1", lane: "attriti", title: null, text: "Richieste incomplete", status, origin });

test("il testo sul posto: una riga o più righe, con la sua etichetta, il limite, il segnaposto; spento in sola lettura", () => {
  const line = html(h(TextInPlace, { value: "Ordini", onCommit() {}, label: "Nome del processo", placeholder: "Nome del processo", maxLength: 120 }));
  assert.equal(line, '<input class="b-textin" aria-label="Nome del processo" placeholder="Nome del processo" maxLength="120" spellCheck="true" data-b="text" type="text" value="Ordini"/>');
  const area = html(h(TextInPlace, { value: "Prima riga\nseconda", onCommit() {}, label: "Descrizione", multiline: true, maxLength: 2000, disabled: true, className: "b-extra" }));
  assert.equal(area, '<textarea class="b-textin b-extra" aria-label="Descrizione" maxLength="2000" disabled="" spellCheck="true" data-b="text" rows="1">Prima riga\nseconda</textarea>');
});

test("si salva lasciando il campo: il testo rifinito, solo se è cambiato rispetto a quando la persona ci è entrata (P52)", () => {
  assert.equal(committedText({ base: "Ordini", text: "Ordini" }, false), null);
  assert.equal(committedText({ base: "Ordini", text: "  Ordini  " }, false), null, "uno spazio in più non è una modifica");
  assert.equal(committedText({ base: "Ordini", text: "Ordini  e resi" }, false), "Ordini e resi");
  assert.equal(committedText({ base: "Ordini", text: "" }, false), "", "svuotato: chi lo usa decide (una nota vuota sparisce, P55)");
  assert.equal(committedText({ base: "uno", text: "uno\n\n\n\ndue  \n" }, true), "uno\n\ndue", "più righe: a capo puliti");
  // Il confronto è con il valore di quando la persona è entrata, non con quello di adesso.
  assert.equal(committedText({ base: "vecchio", text: "vecchio" }, false), null);
  // I numeri: vuoto è null, la virgola vale il punto, fuori dai limiti si porta dentro.
  assert.deepEqual([parsedNumber(""), parsedNumber("12,5"), parsedNumber(" 3 "), parsedNumber("abc"), parsedNumber("200", 0, 168), parsedNumber("-1", 0, 168)], [null, 12.5, 3, null, 168, 0]);
  assert.match(html(h(NumberInput, { value: 6.5, onCommit() {}, label: "Ore a settimana", min: 0, max: 168 })), /^<input class="b-input" type="number" inputMode="decimal" aria-label="Ore a settimana" min="0" max="168" step="any" data-b="number" value="6.5"\/>$/);
});

test("la nota: i tre stati del riferimento (P51), la spunta che dice dove torna (P56), la «×» (P57); in sola lettura niente controlli (F9)", () => {
  const hypothesis = html(h(NoteItem, { note: note("ipotesi", "board"), label: "Nota: Attriti", onText() {}, onToggle() {}, onRemove() {} }));
  assert.match(hypothesis, /^<div class="b-note-w" data-status="ipotesi" data-origin="board" data-b="note"><div class="b-note"><textarea class="b-textin" aria-label="Nota: Attriti" maxLength="2000"/);
  assert.match(hypothesis, /<span class="b-note-cap">ipotesi<\/span><div class="b-note-ctl"><button type="button" aria-label="Segna come validata" title="Segna come validata">/);
  assert.match(hypothesis, /<button type="button" aria-label="Elimina nota" title="Elimina">/);
  const source = html(h(NoteItem, { note: note("fonte", "chat"), label: "Nota: Attriti", onText() {}, onToggle() {}, onRemove() {} }));
  assert.match(source, /data-status="fonte" data-origin="chat"/);
  assert.match(source, /<span class="b-note-cap">da fonti · chat<\/span>/);
  assert.match(html(h(NoteItem, { note: note("fonte", "prima"), label: "Nota", onText() {}, onToggle() {}, onRemove() {} })), /da fonti · prima della board/);
  const validated = html(h(NoteItem, { note: note("validato", "documenti"), label: "Nota: Attriti", onText() {}, onToggle() {}, onRemove() {} }));
  assert.match(validated, /data-status="validato"/);
  assert.match(validated, /<span class="b-sr">validata<\/span>/, "la spunta è un segno: per gli screen reader c'è la parola");
  assert.doesNotMatch(validated, /b-note-cap/);
  // La spunta: validare, oppure toglierla; tolta, una nota della board torna «ipotesi», una da fuori torna «da fonti».
  assert.equal(noteToggleLabel({ status: "ipotesi", origin: "board" }), "Segna come validata");
  assert.equal(noteToggleLabel({ status: "fonte", origin: "chat" }), "Segna come validata");
  assert.equal(noteToggleLabel({ status: "validato", origin: "board" }), "Segna come ipotesi");
  assert.equal(noteToggleLabel({ status: "validato", origin: "documenti" }), "Togli la spunta");
  assert.match(validated, /aria-label="Togli la spunta"/);
  // In sola lettura: il testo spento, nessun controllo.
  const readonly = html(h(NoteItem, { note: note("ipotesi", "board"), label: "Nota", disabled: true, onText() {}, onToggle() {}, onRemove() {} }));
  assert.match(readonly, /disabled=""/);
  assert.doesNotMatch(readonly, /b-note-ctl|<button/);
});

test("i chip di ruoli e strumenti: ognuno con la sua «×», «+ ruolo» finché c'è posto; niente in sola lettura", () => {
  const chips = html(h(ChipInput, { values: ["Buyer", "Segreteria"], addLabel: "+ ruolo", placeholder: "Ruolo o persona", max: 12, maxLength: 80, onChange() {} }));
  assert.match(chips, /^<div class="b-chipin" data-b="chip-input"><span class="b-chip" data-b="chip">Buyer<button type="button" aria-label="Togli Buyer"/);
  assert.match(chips, /<button type="button" class="b-add" data-b="add">\+ ruolo<\/button><\/div>$/);
  assert.match(html(h(ChipInput, { values: ["Gestionale"], tool: true, addLabel: "+ strumento", placeholder: "Strumento o sistema", max: 20, maxLength: 80, onChange() {} })), /class="b-chip b-tool"/);
  assert.doesNotMatch(html(h(ChipInput, { values: ["A", "B"], addLabel: "+ ruolo", placeholder: "Ruolo", max: 2, maxLength: 80, onChange() {} })), /b-add/, "piena: niente «+ ruolo»");
  const readonly = html(h(ChipInput, { values: ["Buyer"], addLabel: "+ ruolo", placeholder: "Ruolo", max: 12, maxLength: 80, disabled: true, onChange() {} }));
  assert.doesNotMatch(readonly, /<button/);
  // Il valore scritto: rifinito, tagliato, senza doppioni a meno di maiuscole, mai oltre il massimo.
  assert.deepEqual(addedChip(["Buyer"], "  Segreteria   acquisti ", 12, 80), ["Buyer", "Segreteria acquisti"]);
  assert.equal(addedChip(["Buyer"], "BUYER", 12, 80), null);
  assert.equal(addedChip(["Buyer"], "   ", 12, 80), null);
  assert.equal(addedChip(["A", "B"], "C", 2, 80), null);
  assert.deepEqual(addedChip([], "x".repeat(100), 12, 80), ["x".repeat(80)]);
});

test("i voti: `−` n `+`, ognuno i suoi, mai sotto zero né oltre 99; al limite il bottone resta raggiungibile (P65, F1)", () => {
  const seen: number[] = [];
  const at = (mine: number, total = 5) => buttonsOf(Votes({ total, mine, onChange: (value) => void seen.push(value) }));
  const [lessAtZero, moreAtZero] = at(0);
  assert.equal(lessAtZero.props["aria-disabled"], true);
  assert.equal(lessAtZero.props.disabled, undefined, "non spento: il fuoco resta lì");
  (lessAtZero.props.onClick as () => void)();
  (moreAtZero.props.onClick as () => void)();
  const [lessAtTwo] = at(2);
  (lessAtTwo.props.onClick as () => void)();
  const [, moreAtMax] = at(99, 120);
  assert.equal(moreAtMax.props["aria-disabled"], true);
  (moreAtMax.props.onClick as () => void)();
  assert.deepEqual(seen, [1, 1], "a zero il `−` non fa niente; al massimo il `+` nemmeno");
  assert.deepEqual([nextVotes(0, -1), nextVotes(98, 1), nextVotes(99, 1), nextVotes(3.7, 0)], [0, 99, 99, 3]);
  const out = html(h(Votes, { total: 5, mine: 2, onChange() {} }));
  assert.equal(
    out,
    '<div class="b-votes" role="group" aria-label="Voti: 5. Tuoi: 2." data-b="votes"><button type="button" aria-label="Togli un tuo voto">−</button><span class="b-vb" aria-hidden="true">5</span><button type="button" aria-label="Aggiungi un voto">+</button></div>',
  );
  const readonly = html(h(Votes, { total: 5, mine: 0, disabled: true, onChange() {} }));
  assert.equal((readonly.match(/disabled=""/g) ?? []).length, 2);
  assert.doesNotMatch(readonly, /aria-disabled/);
});

test("i livelli e i segmenti: uno solo premuto, aria-pressed; il punto ambra su quello proposto (P44, P67, P85)", () => {
  const options = [
    { value: 0, label: "Nessuno" },
    { value: 1, label: "Lieve" },
    { value: 2, label: "Medio" },
    { value: 3, label: "Forte" },
  ] as const;
  const levels = html(createElement(LevelButtons, { label: "Attrito: Medio", options, value: 2, onChange() {} }));
  assert.match(levels, /^<div class="b-feas" role="group" aria-label="Attrito: Medio" data-b="levels">/);
  assert.deepEqual([...levels.matchAll(/aria-pressed="(true|false)">(\w+)</g)].map((match) => [match[2], match[1]]), [["Nessuno", "false"], ["Lieve", "false"], ["Medio", "true"], ["Forte", "false"]]);
  const picked: number[] = [];
  const buttons = buttonsOf(LevelButtons({ label: "Attrito", options, value: null, onChange: (value) => void picked.push(value) }));
  (buttons[3].props.onClick as () => void)();
  assert.deepEqual(picked, [3]);
  assert.equal((html(createElement(LevelButtons, { label: "Attrito", options, value: 1, disabled: true, onChange() {} })).match(/disabled=""/g) ?? []).length, 4);

  const streams = [
    { value: "automate", label: "Automate" },
    { value: "differentiate", label: "Differentiate", recommended: true },
    { value: "innovate", label: "Innovate" },
    { value: "none", label: "—" },
  ] as const;
  const segmented = html(createElement(Segmented, { label: "Stream del passo", options: streams, value: "automate", recommendedLabel: "Proposto dall'assistente", onChange() {} }));
  assert.match(segmented, /^<div class="b-wsel" role="group" aria-label="Stream del passo" data-b="segmented"><button type="button" aria-pressed="true">Automate<\/button>/);
  assert.match(segmented, /<button type="button" class="b-rec" aria-pressed="false" title="Proposto dall&#x27;assistente">Differentiate<span class="b-sr"> Proposto dall&#x27;assistente<\/span><\/button>/);
  assert.equal((segmented.match(/aria-pressed="true"/g) ?? []).length, 1);
  // Un'opzione che si vede come un segno ha il suo nome per gli screen reader; proposta, lo dice anche.
  const named = html(
    createElement(Segmented, {
      label: "Stream del passo",
      options: [
        { value: "none", label: "—", ariaLabel: "Nessuno stream" },
        { value: "mark", label: "◆", ariaLabel: "Segno", recommended: true },
      ],
      value: "none",
      recommendedLabel: "Proposto dall'assistente",
      onChange() {},
    }),
  );
  assert.match(named, /<button type="button" aria-label="Nessuno stream" aria-pressed="true">—<\/button>/);
  assert.match(named, /<button type="button" class="b-rec" aria-label="Segno, Proposto dall&#x27;assistente" aria-pressed="false" title="Proposto dall&#x27;assistente">◆/);
});

test("il campo con l'etichetta in mono; la conferma in linea; il blocco di una vista vuota", () => {
  assert.equal(html(h(Field, { label: "Frequenza" }, createElement("select", { className: "b-input" }))), '<label class="b-field" data-b="field"><span>Frequenza</span><select class="b-input"></select></label>');
  assert.equal(
    html(h(InlineConfirm, { question: "Eliminare il processo?", yes: "Sì, elimina", no: "Annulla", onYes() {}, onNo() {} })),
    '<span class="b-confirm b-on" role="group" aria-label="Eliminare il processo?" data-b="confirm">Eliminare il processo?<button type="button" class="b-btn b-small" data-b="button" data-variant="outline">Sì, elimina</button><button type="button" class="b-btn b-ghost b-small" data-b="button" data-variant="ghost">Annulla</button></span>',
  );
  assert.equal(
    html(h(EmptyBlock, { title: "Nessun passo, per ora", text: "Racconta il lavoro all'assistente." }, "azioni")),
    '<div class="b-empty" data-b="empty"><b>Nessun passo, per ora</b><p>Racconta il lavoro all&#x27;assistente.</p><div class="b-empty-actions">azioni</div></div>',
  );
  assert.doesNotMatch(html(h(EmptyBlock, { title: "T", text: "Una frase." })), /b-empty-actions/);
});

test("il toast della board: una regione viva sempre presente; il testo e «Annulla» quando lo store ne ha uno, nel suo posto (P78)", () => {
  // Fuori da BoardProvider: la regione c'è, vuota.
  assert.equal(html(h(BoardToastView)), '<div class="b-toast-dock" data-b="toast-dock"><div class="b-toast" role="status" aria-live="polite" data-b="toast"></div></div>');
  const board = fixtureBoard();
  function Probe(props: { host?: string }) {
    useBoardClient().notify("Mappa copiata.", { label: "Apri", run() {} });
    return h(BoardToastView, props.host ? { host: props.host } : {});
  }
  // Il toast parte con il suo timer (4,2 s): qui non tiene vivo il processo.
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((run: () => void, ms?: number) => realSetTimeout(run, ms).unref()) as typeof setTimeout;
  try {
    const shown = html(h(BoardProvider, { workspaceId: board.unit.id, departmentId: board.unit.id, userId: board.unit.id, initial: board }, h(Probe, {})));
    assert.equal(shown, '<div class="b-toast-dock" data-b="toast-dock"><div class="b-toast b-on" role="status" aria-live="polite" data-b="toast"><span>Mappa copiata.</span><button type="button">Apri</button></div></div>');
    // Un posto che non ha il toast (un drawer chiuso) non lo mostra.
    const elsewhere = html(h(BoardProvider, { workspaceId: board.unit.id, departmentId: board.unit.id, userId: board.unit.id, initial: board }, h(Probe, { host: "drawer" })));
    assert.equal(elsewhere, '<div class="b-toast-dock" data-b="toast-dock"><div class="b-toast" role="status" aria-live="polite" data-b="toast"></div></div>');
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
});

test("un campo sul posto resta alto quanto il suo testo, bordo compreso, quando cambia la sua larghezza o arrivano i font", async () => {
  const { fitHeight, keepFitted } = edit;
  // Un campo con il bordo di 1 px sopra e sotto: l'altezza è quella del testo più i 2 px del bordo.
  const field = { clientWidth: 600, clientHeight: 20, offsetHeight: 22, scrollHeight: 50, style: { height: "" } };
  fitHeight(field);
  assert.equal(field.style.height, "52px", "il testo non resta 2 px più alto del campo");
  let resized: (() => void) | null = null;
  let disconnected = false;
  class FakeObserver {
    constructor(callback: () => void) {
      resized = callback;
    }
    observe() {}
    disconnect() {
      disconnected = true;
    }
  }
  let fontsReady: () => void = () => {};
  const fonts = { ready: new Promise<void>((resolve) => (fontsReady = resolve)) };
  const stop = keepFitted(field, { ResizeObserver: FakeObserver, fonts });
  assert.ok(resized, "il campo è seguito");
  const resize = resized as () => void;
  // Il pannello dell'assistente si apre accanto alla board: il campo si stringe e la scoperta va su due righe.
  field.clientWidth = 380;
  field.scrollHeight = 100;
  resize();
  assert.equal(field.style.height, "102px");
  // Cambia solo l'altezza (quella appena data): niente da rifare.
  field.scrollHeight = 120;
  resize();
  assert.equal(field.style.height, "102px");
  // Arrivano i font: il serif va a capo in un altro punto del font di riserva.
  field.scrollHeight = 110;
  fontsReady();
  await fonts.ready;
  await Promise.resolve();
  assert.equal(field.style.height, "112px");
  stop();
  assert.equal(disconnected, true);
  field.clientWidth = 900;
  field.scrollHeight = 50;
  resize();
  assert.equal(field.style.height, "112px", "smesso di seguire, il campo non cambia più");
  // Al più `max` (il campo dell'assistente, poi scorre); nascosto (dentro un `details` chiuso) torna all'altezza del foglio.
  const long = { clientWidth: 300, clientHeight: 36, offsetHeight: 38, scrollHeight: 400, style: { height: "" } };
  fitHeight(long, 200);
  assert.equal(long.style.height, "200px");
  const hidden = { clientWidth: 0, clientHeight: 0, offsetHeight: 0, scrollHeight: 0, style: { height: "40px" } };
  fitHeight(hidden);
  assert.equal(hidden.style.height, "");
  // Il testo sul posto delle fondamenta, le righe sul posto delle viste e il campo dell'assistente si misurano così.
  const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  assert.match(source("./edit.tsx"), /const area = useFittedHeight<HTMLTextAreaElement>\(shown\);/);
  assert.match(source("../board/in-place.tsx"), /const useAutoHeight = \(text: string\) => useFittedHeight<HTMLTextAreaElement>\(text\);/);
  assert.match(source("../companion/companion.tsx"), /if \(field\.current\) fitHeight\(field\.current, FIELD_MAX_HEIGHT\);/);
});

/** Un campo finto dentro un drawer, una vista o niente, e quello che gli succede quando si preme un tasto. */
function keyed(where: "drawer" | "vista" | "fuori", key: string, extra: { metaKey?: boolean; composing?: boolean } = {}) {
  const calls: string[] = [];
  const holder = (name: string) => ({ focus: (options?: { preventScroll?: boolean }) => void calls.push(`${name}.focus${options?.preventScroll ? " senza scorrere" : ""}`) });
  const dialog = holder("drawer");
  const panel = holder("vista");
  const field = {
    closest: (selector: string) => (selector === '[role="dialog"]' ? (where === "drawer" ? dialog : null) : selector === '[role="tabpanel"]' ? (where === "fuori" ? null : panel) : null) as Element | null,
    blur: () => void calls.push("blur"),
  };
  const event = {
    key,
    metaKey: extra.metaKey ?? false,
    ctrlKey: false,
    nativeEvent: { isComposing: extra.composing ?? false },
    currentTarget: field,
    preventDefault: () => void calls.push("preventDefault"),
    stopPropagation: () => void calls.push("stopPropagation"),
  };
  return { event, calls, commit: () => void calls.push("commit") };
}

test("lasciare un campo con un tasto: il fuoco non cade mai sulla pagina (F1, F2)", () => {
  // Invio su una riga: salva, e il cursore resta nel campo (il Tab dopo va al campo seguente, dentro il drawer).
  for (const where of ["drawer", "vista", "fuori"] as const) {
    const enter = keyed(where, "Enter");
    assert.equal(leaveFieldKey(enter.event, { enter: "line", stays: true, commit: enter.commit }), true);
    assert.deepEqual(enter.calls, ["preventDefault", "commit"], where);
  }
  // Escape: il campo lascia il fuoco al drawer (un secondo Escape lo chiude) e salva perdendolo; fuori dal drawer alla vista.
  const inDrawer = keyed("drawer", "Escape");
  assert.equal(leaveFieldKey(inDrawer.event, { enter: "line", stays: true, commit: inDrawer.commit }), true);
  assert.deepEqual(inDrawer.calls, ["stopPropagation", "drawer.focus senza scorrere"]);
  const inView = keyed("vista", "Escape");
  leaveFieldKey(inView.event, { enter: "line", stays: true, commit: inView.commit });
  assert.deepEqual(inView.calls, ["stopPropagation", "vista.focus senza scorrere"]);
  // Fuori dalla board (nessun drawer, nessuna vista): perde il fuoco, come prima.
  const outside = keyed("fuori", "Escape");
  leaveFieldKey(outside.event, { enter: "line", stays: true, commit: outside.commit });
  assert.deepEqual(outside.calls, ["stopPropagation", "blur"]);
  // Più righe: Invio va a capo; Cmd/Ctrl+Invio salva e resta.
  const newline = keyed("drawer", "Enter");
  assert.equal(leaveFieldKey(newline.event, { enter: "modified", stays: true, commit: newline.commit }), false);
  assert.deepEqual(newline.calls, []);
  const modified = keyed("drawer", "Enter", { metaKey: true });
  leaveFieldKey(modified.event, { enter: "modified", stays: true, commit: modified.commit });
  assert.deepEqual(modified.calls, ["preventDefault", "commit"]);
  // Un campo che sparisce quando si salva (una nota nuova): anche Cmd/Ctrl+Invio porta il fuoco al drawer.
  const draft = keyed("drawer", "Enter", { metaKey: true });
  leaveFieldKey(draft.event, { enter: "modified", stays: false, commit: draft.commit });
  assert.deepEqual(draft.calls, ["preventDefault", "drawer.focus senza scorrere"]);
  // Mentre si compone (un accento, una lingua con l'IME) nessun tasto lascia il campo; gli altri tasti non contano.
  const composing = keyed("drawer", "Enter", { composing: true });
  assert.equal(leaveFieldKey(composing.event, { enter: "line", stays: true, commit: composing.commit }), false);
  assert.equal(leaveFieldKey(keyed("drawer", "a").event, { enter: "line", stays: true, commit() {} }), false);
  // Il drawer viene prima della vista.
  const both = { closest: (selector: string) => ({ name: selector }) as unknown as Element };
  assert.deepEqual(fieldHolder(both), { name: '[role="dialog"]' });
});

test("ogni campo sul posto lascia il fuoco con leaveFieldKey: nessun blur() a mano nei tasti dei campi", () => {
  for (const file of ["./edit.tsx", "../board/in-place.tsx"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    // L'unico blur() è quello di leaveFieldKey, per un campo fuori dalla board.
    const blurs = [...source.matchAll(/\.blur\(\)/g)].length;
    assert.equal(blurs, file === "./edit.tsx" ? 1 : 0, file);
  }
  const inPlace = readFileSync(new URL("../board/in-place.tsx", import.meta.url), "utf8");
  assert.equal([...inPlace.matchAll(/leaveFieldKey\(event, \{/g)].length, 4, "la riga, la nota nuova, il titolo e il testo del punto nuovo");
  const editSource = readFileSync(new URL("./edit.tsx", import.meta.url), "utf8");
  assert.match(editSource, /leaveFieldKey\(event, \{ enter: p\.multiline \? "modified" : "line", stays: true, commit: \(\) => leave\(field\.value\) \}\)/, "il testo sul posto");
  assert.match(editSource, /leaveFieldKey\(event, \{ enter: "line", stays: true, commit: \(\) => leave\(field\.value\) \}\)/, "il numero");
  // I chip: Escape annulla e porta il fuoco al drawer, e il campo che lo perde non aggiunge niente.
  assert.match(editSource, /cancelled\.current = true;[\s\S]*?fieldHolder\(event\.currentTarget\)\?\.focus\(\{ preventScroll: true \}\);/);
  assert.match(editSource, /onBlur=\{\(\) => \{\s+if \(!cancelled\.current\) add\(text\);/);
});

test("un controllo che sparisce sotto il fuoco (il bottone del toast): il fuoco resta nel drawer o nella vista aperta, se non l'ha preso altro", () => {
  const focused: string[] = [];
  const target = (name: string) => ({ focus: () => void focused.push(name) }) as unknown as HTMLElement;
  const body = { name: "body" } as unknown as HTMLElement;
  // Il toast di un drawer: il drawer.
  const inDrawer = { closest: (selector: string) => (selector === '[role="dialog"]' ? target("drawer") : null) } as unknown as Element;
  keepFocusAfter(inDrawer, { activeElement: inDrawer, body } as unknown as Document);
  // Il toast in fondo alla pagina: la vista aperta della board.
  const root = { querySelector: (selector: string) => (selector === '[role="tabpanel"]:not([hidden])' ? target("vista aperta") : null) };
  const onPage = { closest: (selector: string) => (selector === "[data-board-root]" ? root : null) } as unknown as Element;
  keepFocusAfter(onPage, { activeElement: body, body } as unknown as Document);
  // Il fuoco è già altrove (un drawer che si è aperto e ha messo il fuoco nel suo campo): niente.
  keepFocusAfter(onPage, { activeElement: { name: "un campo" }, body } as unknown as Document);
  assert.deepEqual(focused, ["drawer", "vista aperta"]);
  const source = readFileSync(new URL("./edit.tsx", import.meta.url), "utf8");
  assert.match(source, /toast\.action\?\.run\(\);\s+\/\/ [^\n]*\n\s+keepFocusAfter\(button\);/, "il bottone del toast lascia il fuoco al suo posto");
});

test("il toast non copre gli strumenti della mappa: sale sopra il più alto che toccherebbe, e di nuovo se salendo ne tocca un altro", () => {
  const toast = { left: 400, right: 700, top: 840, bottom: 880 };
  // Niente sotto il toast, o qualcosa accanto: resta dov'è.
  assert.equal(toastLift(toast, []), 0);
  assert.equal(toastLift(toast, [{ left: 720, right: 900, top: 830, bottom: 870 }]), 0, "accanto, non sotto");
  assert.equal(toastLift(toast, [{ left: 400, right: 700, top: 700, bottom: 760 }]), 0, "sopra, non sotto");
  // Gli strumenti della mappa (con «Evidenzia attriti») sotto il toast: il toast sale sopra di loro, con 8 px d'aria.
  assert.equal(toastLift(toast, [{ left: 300, right: 1000, top: 850, bottom: 890 }]), 880 - 850 + 8);
  // Salendo ne tocca un altro (la legenda sopra): sale ancora.
  const twice = toastLift(toast, [{ left: 300, right: 1000, top: 850, bottom: 890 }, { left: 300, right: 1000, top: 800, bottom: 830 }]);
  assert.equal(twice, 38 + (880 - 38 - 800 + 8));
  assert.ok(toast.bottom - twice <= 800 - 8);
});

test("il toast del pannello sopra la pagina: c'è solo quando la board gli dà il posto (PanelToastHost), sopra il campo", () => {
  const board = fixtureBoard();
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((run: () => void, ms?: number) => realSetTimeout(run, ms).unref()) as typeof setTimeout;
  try {
    function Probe(props: { host: string | null }) {
      const client = useBoardClient();
      client.notify("Mappa copiata.");
      return h(edit.PanelToastHost, { value: props.host }, h(edit.PanelToast));
    }
    const render = (host: string | null) => html(h(BoardProvider, { workspaceId: board.unit.id, departmentId: board.unit.id, userId: board.unit.id, initial: board }, h(Probe, { host })));
    // Agganciato (nessun posto): niente, il toast sta nella colonna della board.
    assert.equal(render(null), "");
    // Sopra la pagina: il posto e il toast vuoto (il posto attuale è la pagina finché il pannello non lo prende).
    assert.equal(render("pannello"), '<div class="b-toast-dock" data-b="toast-dock"><div class="b-toast" role="status" aria-live="polite" data-b="toast"></div></div>');
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
});
