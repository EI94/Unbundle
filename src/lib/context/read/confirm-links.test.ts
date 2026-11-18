import test from "node:test";
import assert from "node:assert/strict";
import { planNeedLinks, type ConfirmedFact, type ProposedNeedLink } from "./confirm-links.ts";

// Alla conferma, i legami con «Cosa serve» (RILASCIO-9b-COSTRUZIONE.md §2.2, §3.2). Id inventati.

const link = (id: string, proposalId: string, needId = "n1", needOpen = true): ProposedNeedLink => ({ id, proposalId, needId, needOpen });
const facts = (map: Record<string, ConfirmedFact | null>) => (proposalId: string) => map[proposalId] ?? null;

test("un fatto «Per tutti» attivo e la richiesta aperta: il legame si apre con il fatto", () => {
  assert.deepEqual(planNeedLinks([link("l1", "p1")], facts({ p1: { factId: "f1", visibility: "tutti", active: true } })), [{ id: "l1", status: "aperta", fact_id: "f1" }]);
});

test("«Solo Lateral Space», una richiesta chiusa, un fatto già sostituito o una proposta non confermata: il legame si scarta, senza fatto", () => {
  const plan = planNeedLinks(
    [link("l1", "p1"), link("l2", "p2", "n2", false), link("l3", "p3"), link("l4", "p4")],
    facts({
      p1: { factId: "f1", visibility: "ls", active: true },
      p2: { factId: "f2", visibility: "tutti", active: true },
      p3: { factId: "f3", visibility: "tutti", active: false },
    }),
  );
  assert.deepEqual(plan, [
    { id: "l1", status: "scartata", fact_id: null },
    { id: "l2", status: "scartata", fact_id: null },
    { id: "l3", status: "scartata", fact_id: null },
    { id: "l4", status: "scartata", fact_id: null },
  ]);
});

test("una richiesta e un fatto si legano una volta sola; lo stesso fatto può rispondere a due richieste", () => {
  const same: ConfirmedFact = { factId: "f1", visibility: "tutti", active: true };
  const plan = planNeedLinks([link("l1", "p1", "n1"), link("l2", "p2", "n1"), link("l3", "p3", "n2")], facts({ p1: same, p2: same, p3: same }));
  assert.deepEqual(
    plan.map((x) => [x.id, x.status, x.fact_id]),
    [
      ["l1", "aperta", "f1"],
      ["l2", "scartata", null],
      ["l3", "aperta", "f1"],
    ],
  );
  assert.deepEqual(planNeedLinks([], facts({})), []);
});

test("la conferma usa queste regole dopo i fatti, avvisa i revisori dopo il batch; scartare una proposta scarta il suo legame", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../../db/queries/context-proposals.ts", import.meta.url), "utf8");
  const body = (signature: string) => source.slice(source.indexOf(signature), source.indexOf("\n}\n", source.indexOf(signature)));
  const confirm = body("export async function confirmProposals(");
  assert.match(confirm, /const linksReady = await contextWorkReady\(\);/, "solo con la 0041");
  assert.match(confirm, /const linkPlan = planNeedLinks\(/);
  // Un legame che apre una richiesta già legata allo stesso fatto si scarta anche nel database.
  assert.match(confirm, /CASE WHEN x\.status = 'aperta' AND NOT EXISTS \(\s+SELECT 1 FROM context_need_links o WHERE o\.need_id = l\.need_id AND o\.fact_id = x\.fact_id AND o\.id <> l\.id/);
  assert.match(confirm, /INSERT INTO context_events \(workspace_id, action, channel, fact_id, detail\)\s+SELECT \$\{ws\}::uuid, 'richiesta_dalla_call'/);
  const batch = confirm.indexOf("results = await db.batch(statements");
  const notify = confirm.indexOf("if (answeredNeeds.length > 0) await notifyNeedAnswered({ workspaceId: ws, actorUserId: actor.userId, needIds: answeredNeeds });");
  assert.ok(batch > 0 && notify > batch, "la campanella dopo il batch riuscito");
  const discard = body("export async function discardProposals(");
  assert.match(discard, /UPDATE context_need_links l SET status = 'scartata', decided_at = now\(\), decided_by_user_id = \$\{actor\.userId\}::uuid/);
  assert.match(discard, /p\.status = 'scartata' AND p\.decided_at = now\(\)/, "solo le proposte scartate adesso");
});
