import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ReferentItemView, ReferentNoticeText } from "../../../lib/uc/public-view.ts";
import { PAUSED_CASE_MESSAGE, PRIVACY_UPDATED_MESSAGE, REFERENT_PRIVACY_NOTICE } from "../../../lib/uc/public-view.ts";
import { enableTsxImports } from "../../use-cases/detail/referent/tsx-test-loader.ts";

// (Ondata 0, privacy calma del 04/11) Niente casella di dichiarazione prima di un file: né sulla pagina del referente
// `/r` (allegati e «Carica un Excel»), né nel caricamento della Realizzazione. Il file si sceglie subito; il controllo
// automatico resta e lo dice una riga calma. Fuori dalla dashboard «caso d'uso», non «caso». Resa in HTML, senza
// database. Dati inventati.

const TOKEN = "ucr_ABCDEFGHabcdefgh0123456789_-xyZ";
const ITEM = "66666666-6666-4666-8666-666666666666";

let attachment: typeof import("./attachment-field.tsx");
let excel: typeof import("./excel-import.tsx");
let gate: typeof import("./privacy-gate.tsx");
let panel: typeof import("../documents/upload-panel-client.tsx");
let render: (element: unknown) => string;
let h: (type: unknown, props: unknown) => unknown;

before(async () => {
  await enableTsxImports();
  attachment = await import("./attachment-field.tsx");
  excel = await import("./excel-import.tsx");
  gate = await import("./privacy-gate.tsx");
  panel = await import("../documents/upload-panel-client.tsx");
  const react = await import("react");
  h = (type, props) => react.createElement(type as never, props as never);
  const server = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string };
  // Il pannello della Realizzazione rilegge la pagina con il router dell'app: qui uno che non fa niente.
  const { AppRouterContext } = (await import("next/dist/shared/lib/app-router-context.shared-runtime.js")) as unknown as { AppRouterContext: import("react").Context<object | null> };
  const router = { push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {} };
  render = (element) => server.renderToStaticMarkup(react.createElement(AppRouterContext.Provider, { value: router }, element as never));
});

const noop = () => undefined;

/** Il tag di apertura del pulsante con questo testo. */
function button(html: string, label: string): string {
  const at = html.indexOf(label);
  assert.ok(at > 0, `«${label}» c'è`);
  const start = html.lastIndexOf("<button", at);
  return html.slice(start, html.indexOf(">", start) + 1);
}

/** L'attributo `disabled` (non le classi `disabled:…`). */
const DISABLED = /\sdisabled(=""|\s|>)/;

function assertNoDeclaration(html: string, where: string) {
  assert.doesNotMatch(html, /type="checkbox"/, `${where}: nessuna casella`);
  assert.doesNotMatch(html, /Prima spunta|non contiene dati sanitari|non servono\.|Come hai confermato/, `${where}: nessuna dichiarazione`);
  const file = /<input[^>]*type="file"[^>]*>/.exec(html)?.[0] ?? "";
  assert.ok(file, `${where}: il campo del file c'è`);
  assert.doesNotMatch(file, DISABLED, `${where}: il file si sceglie subito`);
}

test("/r, an attachment: no declaration box, the file is chosen straight away, no «health data is deleted» line", () => {
  for (const personal of [false, true]) {
    const html = render(h(attachment.AttachmentField, { token: TOKEN, itemId: ITEM, value: [], onChange: noop, hint: null, personal, disabled: false }));
    assertNoDeclaration(html, personal ? "voce personale" : "allegato");
    assert.doesNotMatch(button(html, "Scegli un file"), DISABLED);
    assert.doesNotMatch(html, /dati sanitari viene cancellato/);
  }
});

test("/r, «Carica un Excel»: no declaration box either", () => {
  const item = { id: ITEM, config: {} } as unknown as ReferentItemView;
  const html = render(h(excel.ExcelImport, { token: TOKEN, item, attachments: [], disabled: false, onAttachments: noop, onImported: noop }));
  assertNoDeclaration(html, "Excel");
  assert.doesNotMatch(button(html, "Scegli il file Excel"), DISABLED);
});

test("Realizzazione, uploading a document: no box, one calm line about the automatic check", () => {
  const html = render(h(panel.UploadPanelClient, { workspaceId: "11111111-0000-4000-8000-000000000001", caseId: "22222222-0000-4000-8000-000000000001", itemId: null, personal: false, clientMode: true }));
  assertNoDeclaration(html, "Realizzazione");
  assert.doesNotMatch(button(html, "Scegli un file"), DISABLED);
  assert.ok(html.includes("Ogni file passa da un controllo automatico."));
  assert.doesNotMatch(html, /quarantena|rifiutato e cancellato/);
});

test("the upload calls still send the declaration the dossier server asks for, without a box", () => {
  const transport = readFileSync(new URL("../documents/upload-transport.ts", import.meta.url), "utf8");
  assert.match(transport, /form\.set\("declaration", "true"\);/);
  assert.match(transport, /declaration: true \}\);/);
  assert.doesNotMatch(transport, /opts\.declaration|declaration \? "true" : "false"/);
  const api = readFileSync(new URL("./api.ts", import.meta.url), "utf8");
  assert.match(api, /form\.set\("declaration", "true"\);/);
});

test("/r says «caso d'uso», not «caso»: the paused page, the paused message and «Non si applica»", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  assert.equal(PAUSED_CASE_MESSAGE, "Il caso d'uso è in pausa: per ora non serve rispondere.");
  for (const file of ["./referente-home.tsx", "./referente-page.tsx"]) {
    assert.ok(read(file).includes("Il caso d&apos;uso è in pausa. Ti scriviamo quando riparte."), file);
    assert.doesNotMatch(read(file), />\s*Il caso è in pausa/, file);
  }
  assert.ok(read("./more-options.tsx").includes("Lateral Space e chi segue il caso d'uso nella tua azienda"));
  assert.ok(read("../../../lib/uc/item-state.ts").includes(`fail("caso_sospeso", "Il caso d'uso è in pausa: per ora non serve rispondere.")`));
});

test("(Ondata 0) the notice comes back with the text of the version to accept; without it, «Ricarica la pagina» and no «Ho letto»", () => {
  const next: ReferentNoticeText = { ...REFERENT_PRIVACY_NOTICE, version: "uc-2027-01-1", lead: "Tre cose da sapere, aggiornate.", summary: ["Primo punto nuovo.", "Secondo punto nuovo.", "Terzo punto nuovo."] };
  const props = { clientLabel: "Cliente di prova", busy: false, error: null, disabled: false, onAcknowledge: noop };
  const shown = render(h(gate.PrivacyGate, { ...props, notice: next }));
  for (const text of [next.lead, ...next.summary, next.button]) assert.ok(shown.includes(text), text);
  assert.ok(!shown.includes(REFERENT_PRIVACY_NOTICE.lead), "not the page's own text");
  assert.doesNotMatch(button(shown, next.button), DISABLED);
  const stale = render(h(gate.PrivacyGate, { ...props, notice: null })).replaceAll("&#x27;", "'");
  assert.ok(stale.includes(PRIVACY_UPDATED_MESSAGE));
  assert.ok(stale.includes("Ricarica la pagina"));
  assert.ok(!stale.includes(REFERENT_PRIVACY_NOTICE.button) && !REFERENT_PRIVACY_NOTICE.summary.some((line) => stale.includes(line)), "no text to accept, no button to accept it");
  const footer = render(h(gate.PrivacyFooter, { notice: next })).replaceAll("&#x27;", "'");
  assert.ok(next.paragraphs.every((p) => footer.includes(p)) && footer.includes(next.footerLabel));
});
