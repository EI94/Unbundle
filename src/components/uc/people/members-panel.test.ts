import test, { before } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { enableTsxImports } from "../../use-cases/detail/referent/tsx-test-loader.ts";
import { MEMBER_BUILDS_LABEL, MEMBER_BUILDS_REMOVE_TEXT, type MemberView } from "../../../lib/uc/views/people.ts";

// (8.0c) Il team del dossier: la riga «Osservatore» di chi costruisce il caso da fuori Lateral Space (una concessione di
// «Chi costruisce» che lo copre) dice «Osservatore · costruisce»; quella di un osservatore qualunque no.
// RILASCIO-8.0c-ESTERNI.md §4.4 e §11.

type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve?(specifier: string, context: object, nextResolve: (specifier: string, context: object) => ResolveResult): ResolveResult }): void;
};

let render: (members: MemberView[], builderIds: string[]) => string;

before(async () => {
  await enableTsxImports();
  // Le azioni del server non servono a disegnare il pannello.
  const actions = `data:text/javascript,${encodeURIComponent("export async function addMemberAction() {}\nexport async function removeMemberAction() {}")}`;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      return specifier === "@/lib/actions/uc-cases" ? { url: actions, shortCircuit: true } : nextResolve(specifier, context);
    },
  });
  const react = await import("react");
  const { renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string };
  const { MembersPanel } = await import("./members-panel.tsx");
  render = (members, builderIds) =>
    renderToStaticMarkup(react.createElement(MembersPanel, { workspaceId: "ws", caseId: "caso", members, candidates: [], canManage: true, builderIds }));
});

const member = (userId: string, name: string, roles: MemberView["roles"]): MemberView => ({ userId, name, email: null, isLateralSpace: false, roles, personalZone: "no", grantProposedBy: null });
const E = "11111111-1111-4111-8111-111111111111";
const P = "22222222-2222-4222-8222-222222222222";

test("«Osservatore · costruisce» solo per chi ha una concessione che copre il caso", () => {
  const html = render([member(E, "Ettore Esterno", ["osservatore"]), member(P, "Paola Prova", ["osservatore"])], [E.toUpperCase()]);
  assert.equal(html.split(MEMBER_BUILDS_LABEL).length - 1, 1, "una riga sola");
  assert.match(html, /Ettore Esterno[\s\S]*Osservatore · costruisce/);
  assert.match(html, /Paola Prova[\s\S]*>Osservatore</);
  assert.ok(!render([member(E, "Ettore Esterno", ["osservatore"])], []).includes(MEMBER_BUILDS_LABEL), "senza concessione, osservatore e basta");
});

test("i testi del pannello sono quelli della specifica", () => {
  assert.equal(MEMBER_BUILDS_LABEL, "Osservatore · costruisce");
  assert.equal(MEMBER_BUILDS_REMOVE_TEXT, "Non costruirà più questo caso. Per tutti i casi: Agent Factory › Chi costruisce.");
});
