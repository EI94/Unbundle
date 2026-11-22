import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { announceLearningIdea, type IdeaAnnounceDeps } from "./idea-notify.ts";
import type { UseCase } from "../db/schema.ts";

// (Rilascio 10, ondata 7b; audit «Fuori» §6.7, riga 30) L'idea di un corso diventata use case parte con gli avvisi di
// ogni proposta nuova (`dispatchNewPortfolioNotifications`, come «Claude per l'organizzazione»): una volta sola, solo per
// la proposta nata dal corso in quel workspace, mai un errore per chi l'ha inviata. Dipendenze finte, nessun invio vero.

const WS = "11111111-2222-4333-8444-555555555555";
const UC = "cccccccc-dddd-4eee-8fff-000000000000";

function harness(o: { useCase?: Partial<UseCase> | null; announced?: boolean; failNotify?: boolean } = {}) {
  const calls: { notify: unknown[]; wasAnnounced: unknown[]; errors: string[] } = { notify: [], wasAnnounced: [], errors: [] };
  const useCase =
    o.useCase === null ? null : ({ id: UC, workspaceId: WS, source: "learning", title: "Riordinare le fatture", portfolioKind: "use_case_ai", ...o.useCase } as UseCase);
  const deps: IdeaAnnounceDeps = {
    getUseCase: async (id) => (useCase && useCase.id === id ? useCase : null),
    wasAnnounced: async (params) => {
      calls.wasAnnounced.push(params);
      return o.announced === true;
    },
    notify: async (params) => {
      if (o.failNotify) throw new Error("Slack non risponde");
      calls.notify.push(params);
    },
    logError: (event) => calls.errors.push(event),
  };
  return { deps, calls, useCase };
}

test("a course idea that became a use case is announced like every new proposal, once", async () => {
  const h = harness();
  assert.equal(await announceLearningIdea(h.deps, { workspaceId: WS, useCaseId: UC }), "annunciata");
  assert.deepEqual(h.calls.wasAnnounced, [{ workspaceId: WS, useCaseId: UC }]);
  assert.deepEqual(h.calls.notify, [{ useCase: h.useCase, workspaceId: WS, source: "web" }]);
  const again = harness({ announced: true });
  assert.equal(await announceLearningIdea(again.deps, { workspaceId: WS, useCaseId: UC }), "gia_annunciata");
  assert.deepEqual(again.calls.notify, []);
});

test("only the proposal born from the course, in its workspace", async () => {
  for (const useCase of [null, { workspaceId: "22222222-3333-4444-8555-666666666666" }, { source: "web" }]) {
    const h = harness({ useCase });
    assert.equal(await announceLearningIdea(h.deps, { workspaceId: WS, useCaseId: UC }), "assente", JSON.stringify(useCase));
    assert.deepEqual(h.calls.notify, []);
  }
});

test("an error never reaches whoever sent the idea: it goes to the log", async () => {
  const h = harness({ failNotify: true });
  assert.equal(await announceLearningIdea(h.deps, { workspaceId: WS, useCaseId: UC }), "errore");
  assert.deepEqual(h.calls.errors, ["idea_notify_failed"]);
});

test("the hook in ideas.ts: after the idea is submitted, after the answer, with today's «proposta nuova» dispatch", () => {
  const source = readFileSync(new URL("./ideas.ts", import.meta.url), "utf8");
  const submitted = source.indexOf('if (existing?.status !== "submitted") throw new Error("technical");');
  const hook = source.indexOf("after(() => announceLearningIdea(IDEA_ANNOUNCE_DEPS, { workspaceId, useCaseId }));");
  assert.ok(submitted > 0 && hook > submitted, "l'avviso parte solo dopo che l'idea è diventata uno use case");
  assert.match(source, /notify: \(params\) => dispatchNewPortfolioNotifications\(params\),/);
  assert.match(source, /wasAnnounced: wasPortfolioItemAnnounced,/);
  // Un nuovo invio di un'idea già inviata non riparte: esce prima.
  assert.ok(source.indexOf('if (before.status === "submitted") return dto(before);') < hook);
});
