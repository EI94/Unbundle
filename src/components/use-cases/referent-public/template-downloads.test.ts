import test, { before } from "node:test";
import assert from "node:assert/strict";
import type { ReferentAskView, ReferentQuestionView } from "../../../lib/use-cases/referent/contract.ts";
import { REFERENT_PUBLIC_TEXT } from "../../../lib/use-cases/referent/labels.ts";
import { enableTsxImports } from "../detail/referent/tsx-test-loader.ts";
import { attachLabel, questionSections, templateLinks } from "./public-view-render.ts";

// («File da compilare») La pagina del referente: sotto il titolo della domanda, senza aprire niente, «Scarica il file da
// compilare» con nome e dimensione; il caricamento dice «Allega il file compilato». Resa in HTML, senza database. Dati
// inventati (codici XX-00NN).

const T = REFERENT_PUBLIC_TEXT;
const TOKEN = "ucq_abcdefghijklmnopqrstuvwxyz012345";
const FILE_ID = "66666666-0000-4000-8000-000000000001";
const NEED_A = "55555555-0000-4000-8000-00000000000a";
const NEED_B = "55555555-0000-4000-8000-00000000000b";

let card: typeof import("./question-card.tsx");
let renderToStaticMarkup: (element: unknown) => string;
let h: (type: unknown, props: unknown) => unknown;

before(async () => {
  await enableTsxImports();
  card = await import("./question-card.tsx");
  const react = await import("react");
  h = (type, props) => react.createElement(type as never, props as never);
  ({ renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string });
});

const readable = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

function question(over: Partial<ReferentQuestionView> & { needId: string }): ReferentQuestionView {
  return { position: 1, title: "Compila il foglio dei fornitori di prova", state: "aperta", fileRequired: false, draft: null, answer: null, files: [], ...over };
}

function sectionOf(q: ReferentQuestionView) {
  const view = { questions: [q] } as unknown as ReferentAskView;
  return questionSections(view)[0];
}

function render(q: ReferentQuestionView, o: { downloads?: boolean } = {}): string {
  const noop = () => undefined;
  return readable(
    renderToStaticMarkup(
      h(card.QuestionCard, {
        token: TOKEN,
        section: sectionOf(q),
        ...(o.downloads === undefined ? {} : { downloads: o.downloads }),
        today: "2026-11-17",
        clientMode: false,
        issues: [],
        disabled: false,
        registerFlush: noop,
        onStale: noop,
        onEdit: noop,
        onClosure: noop,
      }),
    ),
  );
}

const TEMPLATE = { id: FILE_ID, name: "modello-XX-0001.xlsx", sizeBytes: 49_152 };

test("il link compare nella scheda della domanda, subito sotto il titolo, con nome e dimensione", () => {
  const html = render(question({ needId: NEED_A, templates: [TEMPLATE] }));
  const title = html.indexOf("Compila il foglio dei fornitori di prova</h3>");
  const link = html.indexOf(`href="/api/rispondi/${TOKEN}/da-compilare?file=${FILE_ID}"`);
  const answer = html.indexOf(T.answerLabel);
  assert.ok(title > 0, "il titolo");
  assert.ok(link > title, "il link dopo il titolo");
  assert.ok(answer > link, "il link prima della risposta: si vede senza aprire niente");
  const anchor = html.slice(html.lastIndexOf("<a", link), html.indexOf("</a>", link));
  assert.match(anchor, /\sdownload(=""|\s|>)/, "sempre come allegato");
  assert.match(anchor, new RegExp(`aria-label="${T.aria.templateDownload.replace("{file}", "modello-XX-0001.xlsx")}"`));
  assert.ok(anchor.includes(T.templateDownload));
  assert.ok(html.includes("modello-XX-0001.xlsx · 48 KB"), "nome e dimensione");
  // Il caricamento di sempre, con l'etichetta del file compilato.
  assert.ok(html.includes(T.attachFilled));
  assert.equal(html.includes(`>${T.attach}<`), false);
});

test("senza file da compilare: nessun link, il caricamento dice «Allega un file»", () => {
  const html = render(question({ needId: NEED_A }));
  assert.equal(html.includes("/da-compilare"), false);
  assert.equal(html.includes(T.templateDownload), false);
  assert.ok(html.includes(T.attach));
  assert.equal(html.includes(T.attachFilled), false);
});

test("una domanda già inviata ha ancora il link; una «gestita» no", () => {
  const sent = render(
    question({
      needId: NEED_A,
      state: "inviata",
      answer: { text: null, dontKnow: false, alreadyAttached: true, comment: null, submittedAt: "2026-11-15T10:00:00.000Z" },
      templates: [TEMPLATE],
    }),
  );
  assert.ok(sent.includes(`/api/rispondi/${TOKEN}/da-compilare?file=${FILE_ID}`));
  const handled = render(question({ needId: NEED_B, state: "gestita", templates: [TEMPLATE] }));
  assert.equal(handled.includes("/da-compilare"), false);
  assert.deepEqual(templateLinks(TOKEN, { state: "gestita", templates: [TEMPLATE] }), []);
});

test("senza l'informativa di adesso letta, nessun link: il download risponderebbe 404", () => {
  for (const state of ["aperta", "inviata"] as const) {
    const answer = state === "inviata" ? { text: "Testo di prova", dontKnow: false, alreadyAttached: false, comment: null, submittedAt: "2026-11-15T10:00:00.000Z" } : null;
    const html = render(question({ needId: NEED_A, state, answer, templates: [TEMPLATE] }), { downloads: false });
    assert.equal(html.includes("/da-compilare"), false, state);
    assert.equal(html.includes(T.templateDownload), false, state);
  }
});

test("i link e l'etichetta, puri: un link per file, ogni link con il suo nome", () => {
  const links = templateLinks(TOKEN, { state: "aperta", templates: [TEMPLATE, { id: "66666666-0000-4000-8000-000000000002", name: "istruzioni-XX-0001.pdf", sizeBytes: null }] });
  assert.deepEqual(
    links.map((l) => [l.label, l.detail, l.href]),
    [
      [T.templateDownload, "modello-XX-0001.xlsx · 48 KB", `/api/rispondi/${TOKEN}/da-compilare?file=${FILE_ID}`],
      [T.templateDownload, "istruzioni-XX-0001.pdf", `/api/rispondi/${TOKEN}/da-compilare?file=66666666-0000-4000-8000-000000000002`],
    ],
  );
  assert.equal(attachLabel({ templates: [TEMPLATE] }), "Allega il file compilato");
  assert.equal(attachLabel({}), "Allega un file");
  assert.equal(T.templateDownload, "Scarica il file da compilare");
});
