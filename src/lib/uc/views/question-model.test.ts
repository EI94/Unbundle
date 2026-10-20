import test from "node:test";
import assert from "node:assert/strict";
import nodeModule from "node:module";
import type { ItemDetailData } from "../../db/queries/uc-views.ts";
import { rowToLoadedItem } from "../sql/transitions.ts";
import type { CaseRole } from "../vocab.ts";
import { findForbiddenIn } from "./copy-guard.ts";
import { CASE_ID, CONTACT, WS_ID, snapshotRow } from "./view.fixtures.ts";

// The model lives with the Domande pages: resolve "@/…" as tsconfig does and
// "server-only" as an empty module, in this test process only.
const root = new URL("../../../../", import.meta.url);
type Next = (specifier: string, context: unknown) => unknown;
const { registerHooks } = nodeModule as unknown as {
  registerHooks: (hooks: { resolve: (s: string, c: unknown, next: Next) => unknown }) => unknown;
};
registerHooks({
  resolve: (specifier, context, next) =>
    specifier === "server-only"
      ? { url: "data:text/javascript,", shortCircuit: true }
      : next(specifier.startsWith("@/") ? new URL(`src/${specifier.slice(2)}.ts`, root).href : specifier, context),
});
const MODEL = new URL("src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/domande/question-model.ts", root);
const { questionDetailModel } = (await import(MODEL.href)) as typeof import("../../../app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/domande/question-model.ts");

const COLLEAGUE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

// Invented labels, shaped like the template's: an article and a privacy sheet code.
function detail(): ItemDetailData {
  const loaded = rowToLoadedItem(snapshotRow({ title: "Turni del personale (q.turni.01)" }));
  return {
    core: { status: "raccolta", designated: { owner: null } },
    loaded,
    header: { sourceRefs: [], validatedAt: null, validatedBy: null },
    spec: [],
    notes: [],
    moduleTitle: "Organizzazione del lavoro (art. 7.2)",
    ownerRoleLabel: "Approvatore privacy (A.8)",
    assigneeName: "Referente",
    blockers: [],
    answers: [],
    files: [],
    validations: [],
    comments: [],
    links: [],
    events: [],
    actions: { commentVisibilities: [], resolveClarification: false },
    contacts: [
      { id: CONTACT, name: "Referente servizio", roleLabel: "IT (art. 7.2)", assignable: true },
      { id: COLLEAGUE, name: "Collega", roleLabel: "Scheda A.8", assignable: true },
    ],
    clientViewer: true,
  } as unknown as ItemDetailData;
}

const model = (roles: CaseRole[]) => questionDetailModel(detail(), { workspaceId: WS_ID, caseId: CASE_ID, roles, readOnly: false, now: new Date("2026-10-10T10:00:00Z") });

test("question page: the client reads topic, roles and colleagues' roles without codes", () => {
  const client = model(["owner_cliente"]);
  const reassign = client.actions?.reassign;
  assert.ok(reassign, "the client can hand the question to a colleague");
  const texts = [client.title, client.topic ?? "", client.side.roleLabel ?? "", ...reassign.contacts.map((c) => `${c.name} · ${c.roleLabel ?? ""}`)];
  assert.deepEqual(findForbiddenIn(texts, "cliente"), []);
  assert.equal(client.side.roleLabel, "Approvatore privacy");
  assert.equal(client.topic, "Organizzazione del lavoro");
  assert.deepEqual(
    reassign.contacts.map((c) => c.roleLabel),
    ["IT", "Scheda privacy"],
  );
});

test("question page: Lateral Space keeps the template's labels as they are", () => {
  const ls = model(["ls_lead"]);
  assert.equal(ls.side.roleLabel, "Approvatore privacy (A.8)");
  assert.equal(ls.topic, "Organizzazione del lavoro (art. 7.2)");
});
