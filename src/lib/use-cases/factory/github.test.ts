// Gli eventi di GitHub per la fabbrica (rilascio 8.1b): la firma, il caso dal ramo, solo i campi che servono.
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { caseCodeFromBranch, githubEventName, githubPayloadText, parseGithubEvent, pullRequestUrl, taskRefOfBranch, verifyGithubSignature } from "./github.ts";

const SECRET = "segreto-di-prova";
const sign = (body: string, secret = SECRET) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

test("la firma: giusta solo con lo stesso segreto e lo stesso corpo, e nella forma di GitHub", () => {
  const body = JSON.stringify({ zen: "ok" });
  assert.equal(verifyGithubSignature(SECRET, body, sign(body)), true);
  assert.equal(verifyGithubSignature(SECRET, new TextEncoder().encode(body), sign(body)), true, "anche dai byte");
  assert.equal(verifyGithubSignature(SECRET, body + " ", sign(body)), false, "corpo cambiato");
  assert.equal(verifyGithubSignature(SECRET, body, sign(body, "altro")), false, "altro segreto");
  assert.equal(verifyGithubSignature("", body, sign(body, "")), false, "senza segreto mai");
  assert.equal(verifyGithubSignature(SECRET, body, null), false);
  assert.equal(verifyGithubSignature(SECRET, body, sign(body).replace("sha256=", "sha1=")), false);
  assert.equal(verifyGithubSignature(SECRET, body, sign(body).toUpperCase()), false);
  assert.equal(verifyGithubSignature(SECRET, body, `${sign(body)}00`), false);
});

test("il nome dell'evento ha la forma di GitHub", () => {
  assert.equal(githubEventName("pull_request"), "pull_request");
  assert.equal(githubEventName("Pull-Request"), null);
  assert.equal(githubEventName(null), null);
});

test("il caso e il compito dal ramo, come la CLI del modello", () => {
  assert.equal(caseCodeFromBranch("tj-0049/t-3-mappa-fl3xx"), "tj-0049");
  assert.equal(caseCodeFromBranch("TJ-0049/qualcosa"), "tj-0049");
  assert.equal(caseCodeFromBranch("main"), null);
  assert.equal(caseCodeFromBranch("modello/1.3.0"), null);
  assert.equal(taskRefOfBranch("tj-0049/t-3-mappa", "TJ-0049"), "T-3");
  assert.equal(taskRefOfBranch("tj-0049/t-03", "tj-0049"), "T-3");
  assert.equal(taskRefOfBranch("tj-0049/sistema", "tj-0049"), null);
  assert.equal(taskRefOfBranch("px-0101/t-3", "tj-0049"), null, "ramo di un altro caso");
});

const pr = (over: Record<string, unknown> = {}, action = "opened") => ({
  action,
  repository: { full_name: "Voltaen/topjet-rosa" },
  sender: { login: "qualcuno" },
  pull_request: {
    number: 12,
    state: "open",
    draft: false,
    merged_at: null,
    created_at: "2026-11-14T09:00:00Z",
    closed_at: null,
    user: { login: "qualcuno" },
    head: { ref: "tj-0049/t-3-mappa", repo: { full_name: "Voltaen/topjet-rosa" } },
    ...over,
  },
});

test("una PR: repository, numero, ramo, stato, bozza e date; mai chi l'ha aperta", () => {
  const e = parseGithubEvent("pull_request", pr());
  assert.equal(e.kind, "pr");
  if (e.kind !== "pr") return;
  assert.deepEqual(
    { repo: e.repo, number: e.number, branch: e.branch, state: e.state, draft: e.draft, openedAt: e.openedAt, ready: e.ready, signal: e.signal },
    { repo: "Voltaen/topjet-rosa", number: 12, branch: "tj-0049/t-3-mappa", state: "aperta", draft: false, openedAt: "2026-11-14T09:00:00.000Z", ready: true, signal: true },
  );
  assert.doesNotMatch(JSON.stringify(e), /qualcuno|login|user/, "nessuna persona");
});

test("gli stati: unita con la data, chiusa senza unire, bozza non pronta, riaperta", () => {
  const merged = parseGithubEvent("pull_request", pr({ state: "closed", merged_at: "2026-11-14T10:00:00Z", closed_at: "2026-11-14T10:00:00Z" }, "closed"));
  assert.ok(merged.kind === "pr" && merged.state === "unita" && merged.mergedAt === "2026-11-14T10:00:00.000Z" && !merged.ready && !merged.signal);
  const closed = parseGithubEvent("pull_request", pr({ state: "closed", closed_at: "2026-11-14T10:00:00Z" }, "closed"));
  assert.ok(closed.kind === "pr" && closed.state === "chiusa" && closed.mergedAt === null);
  const draft = parseGithubEvent("pull_request", pr({ draft: true }));
  assert.ok(draft.kind === "pr" && draft.draft && !draft.ready && draft.signal);
  const ready = parseGithubEvent("pull_request", pr({}, "ready_for_review"));
  assert.ok(ready.kind === "pr" && ready.ready);
  const reopened = parseGithubEvent("pull_request", pr({}, "reopened"));
  assert.ok(reopened.kind === "pr" && reopened.reopened && reopened.ready);
  const labeled = parseGithubEvent("pull_request", pr({}, "labeled"));
  assert.ok(labeled.kind === "pr" && !labeled.ready && !labeled.signal, "un'etichetta non è un segnale");
});

test("le PR da un fork, o con campi strani, non contano", () => {
  assert.deepEqual(parseGithubEvent("pull_request", pr({ head: { ref: "tj-0049/t-3", repo: { full_name: "Altro/topjet-rosa" } } })), { kind: "altro", repo: "Voltaen/topjet-rosa", reason: "fork" });
  assert.equal(parseGithubEvent("pull_request", pr({ number: 0 })).kind, "altro");
  assert.equal(parseGithubEvent("pull_request", pr({ number: "12" })).kind, "altro");
  assert.equal(parseGithubEvent("pull_request", pr({ head: { ref: "a b", repo: { full_name: "Voltaen/topjet-rosa" } } })).kind, "altro");
  assert.equal(parseGithubEvent("pull_request", pr({ head: { ref: "x".repeat(121), repo: { full_name: "Voltaen/topjet-rosa" } } })).kind, "altro");
  assert.equal(parseGithubEvent("pull_request", { ...pr(), repository: { full_name: "non valido" } }).kind, "altro");
  assert.equal(parseGithubEvent("pull_request", "testo").kind, "altro");
});

test("un push: solo un ramo, mai uno cancellato o un tag", () => {
  const base = { repository: { full_name: "Voltaen/topjet-rosa" }, pusher: { name: "qualcuno" } };
  assert.deepEqual(parseGithubEvent("push", { ...base, ref: "refs/heads/tj-0049/t-3-mappa" }), { kind: "push", repo: "Voltaen/topjet-rosa", branch: "tj-0049/t-3-mappa" });
  assert.equal(parseGithubEvent("push", { ...base, ref: "refs/tags/v1" }).kind, "altro");
  assert.equal(parseGithubEvent("push", { ...base, ref: "refs/heads/tj-0049/t-3", deleted: true }).kind, "altro");
  assert.deepEqual(parseGithubEvent("ping", {}), { kind: "ping" });
  assert.deepEqual(parseGithubEvent("issues", base), { kind: "altro", repo: "Voltaen/topjet-rosa", reason: "evento_non_usato" });
});

test("l'indirizzo della PR si fa da repository e numero", () => {
  assert.equal(pullRequestUrl("Voltaen/topjet-rosa", 12), "https://github.com/Voltaen/topjet-rosa/pull/12");
});

test("(revisione) l'ora di GitHub, l'unione solo nel ramo principale, il corpo come modulo", () => {
  const base = { action: "closed", repository: { full_name: "Voltaen/topjet-rosa", default_branch: "main" } };
  const prOf = (baseRef: string) => ({
    ...base,
    pull_request: { number: 5, state: "closed", draft: false, merged_at: "2026-11-14T10:00:00Z", closed_at: "2026-11-14T10:00:00Z", created_at: "2026-11-14T09:00:00Z", updated_at: "2026-11-14T10:00:01Z", head: { ref: "tj-0049/t-3", repo: { full_name: "Voltaen/topjet-rosa" } }, base: { ref: baseRef } },
  });
  const intoMain = parseGithubEvent("pull_request", prOf("main"));
  assert.ok(intoMain.kind === "pr" && intoMain.state === "unita" && intoMain.updatedAt === "2026-11-14T10:00:01.000Z");
  const stacked = parseGithubEvent("pull_request", prOf("tj-0049/t-2"));
  assert.ok(stacked.kind === "pr" && stacked.state === "chiusa" && stacked.mergedAt === null, "unita in un altro ramo: non porta il lavoro in main");
  assert.equal(githubPayloadText("application/json", "{\"a\":1}"), "{\"a\":1}");
  assert.equal(githubPayloadText("application/x-www-form-urlencoded", new URLSearchParams({ payload: "{\"a\":1}" }).toString()), "{\"a\":1}");
  assert.equal(githubPayloadText("application/x-www-form-urlencoded", "altro=1"), null);
});
