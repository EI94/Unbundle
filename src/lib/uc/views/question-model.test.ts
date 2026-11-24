import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("(release 10, §3.5) «Apri a tutta pagina» keeps the list's filters and page, so «‹ Domande» finds them again", () => {
  const plain = model(["ls_lead"]);
  assert.equal(plain.fullHref, `/dashboard/${WS_ID}/casi-duso/${CASE_ID}/domande/${plain.itemId}`);
  const withList = questionDetailModel(detail(), { workspaceId: WS_ID, caseId: CASE_ID, roles: ["ls_lead"], readOnly: false, now: new Date("2026-10-10T10:00:00Z"), listQuery: "?vista=tutte&argomento=m.volumi&pagina=2" });
  assert.equal(withList.fullHref, `/dashboard/${WS_ID}/casi-duso/${CASE_ID}/domande/${plain.itemId}?vista=tutte&argomento=m.volumi&pagina=2`);
  const page = readFileSync(new URL("src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/domande/page.tsx", root), "utf8");
  assert.match(page, /const listQuery = questionQuery\(filter, defaults, \{ pagina: filter\.pagina \}\);/);
  assert.match(page, /questionDetailModel\(detail, \{[^}]*listQuery \}\)/, "the panel of Domande passes it");
});

test("(R1) a question born from «Cosa serve» has no actions nor new comments: a line points to «Cosa serve»", () => {
  const needId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const useCaseId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const linked = (): ItemDetailData => {
    const d = detail() as unknown as { core: Record<string, unknown>; header: Record<string, unknown> };
    return {
      ...d,
      core: { ...d.core, portfolioUseCaseId: useCaseId },
      header: { ...d.header, templateItemKey: `need.${needId}` },
      actions: { commentVisibilities: ["condiviso"], resolveClarification: true },
    } as unknown as ItemDetailData;
  };
  const at = { workspaceId: WS_ID, caseId: CASE_ID, readOnly: false, now: new Date("2026-10-10T10:00:00Z") };
  const ls = questionDetailModel(linked(), { ...at, roles: ["ls_lead"] });
  assert.equal(ls.actions, null, "never a second editor");
  assert.equal(ls.notice, null);
  assert.deepEqual(ls.activity.visibilities, []);
  assert.equal(ls.activity.canResolve, false);
  assert.deepEqual(ls.cosaServe, { href: `/dashboard/${WS_ID}/use-cases/${useCaseId}?capitolo=cosa-serve` });
  // The client reads the line but does not open «Cosa serve».
  const client = questionDetailModel(linked(), { ...at, roles: ["owner_cliente"] });
  assert.equal(client.actions, null);
  assert.deepEqual(client.cosaServe, { href: null });
  // An ordinary question has no such line.
  assert.equal(model(["ls_lead"]).cosaServe, null);
});
