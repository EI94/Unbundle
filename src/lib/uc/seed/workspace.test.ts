import test from "node:test";
import assert from "node:assert/strict";
import { describeCandidates, normalizeWorkspaceName, pickWorkspace, stripParenthetical, workspaceSearch, type WorkspaceCandidate } from "./workspace.ts";

test("names are normalized: NFKC, lower case, separators become spaces", () => {
  assert.equal(normalizeWorkspaceName("  Esempio·Vendite / Nord-Est  "), "esempio vendite nord est");
  assert.equal(normalizeWorkspaceName("ＥＳＥＭＰＩＯ"), "esempio");
  assert.equal(stripParenthetical("Esempio Srl (ex Prova (vecchio)) · Vendite"), "Esempio Srl · Vendite");
});

test("the search drops the parenthetical part and keeps the tokens", () => {
  assert.deepEqual(workspaceSearch("Esempio Srl · Vendite (dopo la fusione)"), { normalized: "esempio srl vendite", tokens: ["esempio", "srl", "vendite"] });
  assert.deepEqual(workspaceSearch("A · B"), { normalized: "a b", tokens: [] });
});

const CANDIDATES: WorkspaceCandidate[] = [
  { id: "w1", name: "Vendite", organizationName: "Esempio Srl" },
  { id: "w2", name: "Esempio Srl Vendite", organizationName: null },
  { id: "w3", name: "Acquisti", organizationName: "Esempio Srl" },
  { id: "w4", name: "Vendite", organizationName: "Altra Spa" },
];

test("exactly one match: by name, by organization and name, or by tokens", () => {
  const byName = pickWorkspace(CANDIDATES, workspaceSearch("Esempio Srl Vendite"));
  // w2 per nome e w1 per «organizzazione · workspace»: due risultati esatti.
  assert.equal(byName.ok ? "" : byName.code, "workspace_ambiguo");
  const onlyFull = pickWorkspace([CANDIDATES[0], CANDIDATES[2], CANDIDATES[3]], workspaceSearch("Esempio Srl · Vendite (nota)"));
  assert.deepEqual(onlyFull.ok ? onlyFull.value : null, { id: "w1", via: "organizzazione_e_nome" });
  const onlyName = pickWorkspace([CANDIDATES[2], CANDIDATES[1]], workspaceSearch("esempio srl - vendite"));
  assert.deepEqual(onlyName.ok ? onlyName.value : null, { id: "w2", via: "nome" });
  const tokens = pickWorkspace([CANDIDATES[0], CANDIDATES[2], CANDIDATES[3]], workspaceSearch("Esempio Acquisti"));
  assert.deepEqual(tokens.ok ? tokens.value : null, { id: "w3", via: "token" });
});

test("zero or many candidates stop the script, which never creates a workspace", () => {
  const none = pickWorkspace(CANDIDATES, workspaceSearch("Nessuno Spa"));
  assert.equal(none.ok ? "" : none.code, "nessun_workspace");
  assert.match(none.ok ? "" : none.message, /non ne crea uno nuovo/);
  const many = pickWorkspace(CANDIDATES, workspaceSearch("Vendite"));
  // «vendite» è il nome esatto di w1 e w4.
  assert.equal(many.ok ? "" : many.code, "workspace_ambiguo");
  const manyTokens = pickWorkspace(CANDIDATES, workspaceSearch("Esempio"));
  assert.equal(manyTokens.ok ? "" : manyTokens.code, "workspace_ambiguo");
  const empty = pickWorkspace(CANDIDATES, workspaceSearch("(solo nota)"));
  assert.equal(empty.ok ? "" : empty.code, "suggerimento_vuoto");
  assert.deepEqual(describeCandidates(CANDIDATES.slice(0, 2)), ["w1 · Esempio Srl · Vendite", "w2 · Esempio Srl Vendite"]);
});
