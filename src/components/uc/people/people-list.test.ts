import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { enableTsxImports } from "../../use-cases/detail/referent/tsx-test-loader.ts";
import { lsPeopleRows, clientPeopleRows, type PersonContactLike, type PersonRequestLike, type RequestDetailLike } from "../../../lib/uc/views/people.ts";
import type { RequestStatus } from "../../../lib/uc/vocab.ts";

// Rilascio 10, §3.5 (Persone): «Rispondono per il cliente» con i firmatari come chip, al massimo tre righe e poi «Vedi
// tutti (N)», sulla riga solo «Copia link» o «Approva la delega», una riga sola se manca chi firma; il nuovo referente
// con tre campi più «Altro»; un solo «Invia le domande», con i passi e l'email vera di «Chiedi al referente».

type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve?(specifier: string, context: object, nextResolve: (specifier: string, context: object) => ResolveResult): ResolveResult }): void;
};

const stub = (names: string[]) => `data:text/javascript,${encodeURIComponent(names.map((n) => `export async function ${n}() { return { ok: true, data: null }; }`).join("\n"))}`;
const PEOPLE_ACTIONS = [
  "anonymizeContactAction",
  "approveDelegationAction",
  "assignRoleQuestionsAction",
  "copyRequestLinkAction",
  "extendExpiryAction",
  "reassignContactQuestionsAction",
  "revokeRequestAction",
  "sendRequestAction",
  "sendRequestsAction",
  "createContactAction",
  "updateContactAction",
  "previewRequestsAction",
];

let renderList: (props: Record<string, unknown>) => string;

before(async () => {
  await enableTsxImports();
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "@/lib/actions/uc-people") return { url: stub(PEOPLE_ACTIONS), shortCircuit: true };
      if (specifier === "@/lib/actions/uc-cases") return { url: stub(["setOwnerContactAction", "setPrivacyApproverContactAction", "addMemberAction", "removeMemberAction"]), shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
  const react = await import("react");
  const { renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string };
  const { PeopleList } = await import("./people-list.tsx");
  renderList = (props) => renderToStaticMarkup(react.createElement(PeopleList, props as never));
});

const DETAIL: RequestDetailLike = {
  channel: "email",
  sentAt: "2026-10-03T08:00:00Z",
  expiresAt: "2026-11-02T08:00:00Z",
  reminderCount: 0,
  nextReminderAt: null,
  escalated: false,
  activeLinks: 1,
  live: true,
  emailQueued: false,
  emailHoldReason: null,
  contactHasEmail: true,
  delegatedFromRequestId: null,
  delegationDepth: 0,
  needsApproval: false,
  visible: true,
};
const ALL_ACTIONS = { send: true, copyLink: true, remind: true, revoke: true, extend: true, approveDelegation: true };

function contact(id: string, name: string, o: Partial<PersonContactLike> = {}): PersonContactLike {
  return { id, displayName: name, roleLabel: "Amministrazione", templateRoleKey: null, email: `${id}@cliente.test`, phone: null, preferredChannel: "email", hasEmail: true, isActive: true, anonymized: false, involved: true, counts: { assigned: 8, open: 8, unsent: 0 }, ...o };
}
function req(contactId: string, status: RequestStatus): PersonRequestLike & { statusLabel: string } {
  return { id: `${contactId}-${status}`, contactId, purpose: "raccolta", status, detail: { ...DETAIL, openItems: 8 }, actions: ALL_ACTIONS, statusLabel: "Aperta" };
}

const contacts = [contact("a", "Anna Bianchi"), contact("b", "Bruno Neri", { counts: { assigned: 4, open: 4, unsent: 4 } }), contact("c", "Carla Rossi"), contact("d", "Dario Verdi"), contact("e", "Elena Gialli")];
const requests = [req("a", "aperta"), req("c", "aperta"), req("d", "aperta"), req("e", "aperta")];
const designated = { owner: "a", privacy: null };
const CAN = { manage: true, send: true, clientAssign: false, designate: true, clearSigner: true };

function props(over: Record<string, unknown> = {}) {
  const rows = lsPeopleRows({ contacts, requests, roleLabels: {}, designated });
  return {
    workspaceId: "ws",
    caseId: "caso",
    view: { audience: "lateral_space", rows },
    unassigned: [],
    contactOptions: contacts.map((c) => ({ id: c.id, name: c.displayName, roleLabel: c.roleLabel })),
    signerOptions: contacts.map((c) => ({ id: c.id, name: c.displayName, roleLabel: c.roleLabel })),
    signers: [
      { designation: "owner", current: { id: "a", name: "Anna Bianchi", roleLabel: null }, evidenceText: "Prova: email.pdf · indicato il 3 ott" },
      { designation: "privacy", current: null, evidenceText: null },
    ],
    files: [],
    templateRoles: [],
    can: CAN,
    emailConfigured: true,
    today: "2026-11-20",
    maxExpiry: "2026-12-20",
    catalogBase: null,
    documentsHref: null,
    sendHref: "/persone?invia=1",
    ...over,
  };
}

test("tre righe in vista, poi «Vedi tutti (5)»; i firmatari come chip; la riga dice il ruolo e «8 aperte»", () => {
  const html = renderList(props());
  for (const name of ["Anna Bianchi", "Bruno Neri", "Carla Rossi"]) assert.ok(html.includes(name), name);
  for (const name of ["Dario Verdi", "Elena Gialli"]) assert.ok(!html.includes(name), `${name} sta dietro «Vedi tutti»`);
  assert.ok(html.includes("Vedi tutti (5)"));
  assert.match(html, /data-slot="signer-chip"[^>]*>firma il via</);
  assert.ok(html.includes("Amministrazione · 8 aperte"));
  assert.ok(!html.includes("8 domande · 8 aperte"), "niente fila di cinque fatti");
});

test("sulla riga solo «Copia link» o «Approva la delega»: l'invio di una persona sta nel suo «⋯»", () => {
  const html = renderList(props());
  assert.ok(html.includes(">Copia link<"));
  for (const label of [">Invia<", ">Reinvia<", ">Prepara il link<"]) assert.ok(!html.includes(label), label);
  const source = readFileSync(new URL("./people-list.tsx", import.meta.url), "utf8");
  assert.match(source, /if \(send\) out\.push\(send\);/, "«Invia le sue domande» nel «⋯» della riga");
});

test("una riga sola se manca chi firma, con «Indica»; nessuna riga se ci sono tutti e due", () => {
  const html = renderList(props());
  assert.match(html, /data-slot="signers-missing"[\s\S]*Manca chi firma la privacy per il cliente\.[\s\S]*Indica/);
  const both = renderList(props({ signers: [{ designation: "owner", current: { id: "a", name: "Anna Bianchi", roleLabel: null }, evidenceText: null }, { designation: "privacy", current: { id: "c", name: "Carla Rossi", roleLabel: null }, evidenceText: null }] }));
  assert.ok(!both.includes("signers-missing"));
});

test("l'analista legge la stessa lista senza azioni; il cliente legge nome, ruolo, firma e stato (art. 15.4)", () => {
  const read = renderList(props({ can: { manage: false, send: false, clientAssign: false, designate: false, clearSigner: false } }));
  assert.ok(!read.includes(">Copia link<") && !read.includes("Altre azioni per"), "niente azioni per chi legge");
  assert.ok(!read.includes(">Indica"), "senza «Indica» per chi non indica");
  const clientRows = clientPeopleRows({ contacts, requests, roleLabels: {}, designated });
  const client = renderList(props({ view: { audience: "cliente", rows: clientRows }, can: { manage: false, send: false, clientAssign: true, designate: true, clearSigner: false } }));
  assert.ok(!/\d+ apert/.test(client), "nessun conteggio per il cliente");
  assert.match(client, /firma il via/);
});

test("il nuovo referente: tre campi in vista, il resto in «Altro»; la scritta «Collega» non c'è più", () => {
  const sheet = readFileSync(new URL("./contact-sheet.tsx", import.meta.url), "utf8");
  const shown = sheet.slice(0, sheet.indexOf('id={`${id}-more`}'));
  for (const label of ["T.contactName", "T.contactEmail", "T.contactRole"]) assert.ok(shown.includes(label), label);
  const more = sheet.slice(sheet.indexOf('id={`${id}-more`}'));
  for (const label of ["T.contactLabel", "T.contactPhone", "T.contactChannel", "T.contactActive"]) assert.ok(more.includes(label), `${label} in «Altro»`);
  const list = readFileSync(new URL("./people-list.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(list, /\bColleg(?:a|he|hi)\b|\bcolleg(?:a|he|hi)\b/, "genere neutro");
});

test("un solo «Invia le domande»: i passi e l'email vera di «Chiedi al referente»", () => {
  const sheet = readFileSync(new URL("./send-sheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /const STEPS = REFERENT_UI_TEXT\.askDialog\.steps;/, "gli stessi nomi dei passi: «A chi», «Cosa chiedi», «Controlla e invia»");
  assert.match(sheet, /<EmailPreview\s/, "la stessa anteprima dell'email");
  assert.match(sheet, /renderEmail\(\{ template: "richiesta_inviata"/, "lo stesso modello dell'invio");
  assert.doesNotMatch(sheet, /Anteprima del messaggio/, "non più chiusa in una piega");
  // «Anche le altre N persone ricevono la stessa email»: solo chi ha l'email, non chi riceve il link a mano.
  assert.match(sheet, /const othersMailed = mailed \? picked\.filter\(\(g\) => g\.channel === "email" && g\.contactId !== mailed\.contactId\)\.length : 0;/);
  assert.match(sheet, /SEND_TEXT\.others\(othersMailed\)/);
  const page = readFileSync(new URL("../../../app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/persone/page.tsx", import.meta.url), "utf8");
  assert.equal(page.match(/PEOPLE_TEXT\.send\b/g)?.length, 1, "un solo «Invia le domande» sulla pagina");
  assert.doesNotMatch(page, /SettingsSection|Firme del cliente/, "le firme sono chip sulla riga, non una sezione");
  assert.match(page, /\{isLead && \(\s*<section[^>]*aria-labelledby="uc-people-case"/, "«Nella realizzazione» solo per il responsabile Lateral Space");
});

test("le righe che chiedono un'azione vengono prima: «Approva la delega» e «Affida a…» mai dietro «Vedi tutti»", () => {
  const delegated = { ...req("e", "inviata"), detail: { ...DETAIL, openItems: 8, needsApproval: true } };
  const rows = lsPeopleRows({ contacts, requests: [...requests, delegated], roleLabels: {}, designated });
  const html = renderList(
    props({ view: { audience: "lateral_space", rows }, unassigned: [{ roleKey: "sistemi", roleLabel: "Sistemi", questions: 4, suggestedContactIds: [] }] }),
  );
  assert.ok(html.includes("Elena Gialli") && html.includes(">Approva la delega<"), "la delega di Elena, ultima in ordine alfabetico, è in vista");
  assert.ok(html.includes("Senza referente") && html.includes(">Affida a…<"), "le domande senza referente sono in vista");
  assert.ok(html.indexOf("Elena Gialli") < html.indexOf("Senza referente") && html.indexOf("Senza referente") < html.indexOf("Anna Bianchi"), "prima le azioni, poi l'ordine alfabetico");
  assert.ok(!html.includes("Carla Rossi"), "le altre persone dopo, dietro «Vedi tutti»");
});
