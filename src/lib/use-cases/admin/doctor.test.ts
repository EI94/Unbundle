import test from "node:test";
import assert from "node:assert/strict";
import { CONNECTOR_PROBE_SQL } from "../../db/connector-ddl.ts";
import { USE_CASE_HUB_PROBE_SQL } from "../../db/use-case-hub-ddl.ts";
import { evaluateDoctor, scoringVersionOf, type DoctorFacts, type DoctorWorkspace } from "./doctor.ts";
import { DOSSIER_UNIQUE_INDEX, SCHEMA_FACTS_SQL, schemaFactsFrom } from "./schema.ts";

// use-case-admin doctor (docs/use-case/DESIGN.md §10.5 e §12.2). Workspace inventati.

const ws = (over: Partial<DoctorWorkspace> = {}): DoctorWorkspace => ({
  id: "00000000-0000-4000-8000-000000000901",
  name: "Acme",
  config: true,
  missingCodes: 0,
  originPending: 0,
  dossierLinksReady: true,
  scoringVersion: 2,
  ...over,
});

const facts = (over: Partial<DoctorFacts> = {}): DoctorFacts => ({
  m0019: true,
  m0020: true,
  uc: true,
  duplicateCards: 0,
  lsDomainsSet: true,
  workspaces: [ws()],
  ...over,
});

const failing = (f: DoctorFacts) => evaluateDoctor(f).checks.filter((c) => !c.ok).map((c) => c.controllo);

test("verde solo se passano tutti gli 8 controlli", () => {
  const result = evaluateDoctor(facts());
  assert.equal(result.green, true);
  assert.deepEqual(
    result.checks.map((c) => c.controllo),
    ["migrazione_0020", "doppioni", "righe_config", "codici", "origine", "dossier_links", "scoring_v2", "uc_ls_email_domains"],
  );
});

test("ogni controllo che non passa rende rosso", () => {
  assert.deepEqual(failing(facts({ m0020: false, workspaces: [ws({ originPending: null })] })), ["migrazione_0020", "origine"]);
  assert.deepEqual(failing(facts({ duplicateCards: 2 })), ["doppioni"]);
  assert.deepEqual(failing(facts({ workspaces: [ws({ config: false })] })), ["righe_config"]);
  assert.deepEqual(failing(facts({ workspaces: [ws({ missingCodes: 3 })] })), ["codici"]);
  assert.deepEqual(failing(facts({ workspaces: [ws({ originPending: 1 })] })), ["origine"]);
  assert.deepEqual(failing(facts({ workspaces: [ws({ dossierLinksReady: false })] })), ["dossier_links"]);
  assert.deepEqual(failing(facts({ workspaces: [ws({ scoringVersion: 1 })] })), ["scoring_v2"]);
  assert.deepEqual(failing(facts({ lsDomainsSet: false })), ["uc_ls_email_domains"]);
  assert.deepEqual(
    failing(facts({ m0019: false, workspaces: [ws({ config: null, missingCodes: null })] })),
    ["righe_config", "codici"],
    "senza la 0019 i due controlli non si possono fare",
  );
});

test("senza tabelle uc: niente doppioni né dossier da collegare", () => {
  const result = evaluateDoctor(facts({ uc: false, workspaces: [ws({ dossierLinksReady: null })] }));
  assert.equal(result.green, true);
  assert.equal(result.checks.find((c) => c.controllo === "doppioni")?.dettaglio, "tabelle uc assenti");
});

test("i dettagli dicono il comando che sistema, senza valori delle variabili", () => {
  const result = evaluateDoctor(facts({ duplicateCards: 1, lsDomainsSet: false, workspaces: [ws({ missingCodes: 2, originPending: 1 })] }));
  const detail = Object.fromEntries(result.checks.map((c) => [c.controllo, c.dettaglio]));
  assert.equal(detail.doppioni, "1 scheda con più dossier: dossier-dups");
  assert.equal(detail.codici, "2 schede senza codice: codes");
  assert.equal(detail.origine, "1 scheda da decidere: origin");
  assert.doesNotMatch(detail.uc_ls_email_domains, /@|\.test/);
});

test("scoringVersion: 2 solo se il modello lo dice", () => {
  assert.equal(scoringVersionOf(2), 2);
  assert.equal(scoringVersionOf("2"), 2);
  for (const value of [undefined, null, 1, "1", 3, {}, "v2"]) assert.equal(scoringVersionOf(value), 1, JSON.stringify(value));
});

test("lo schema: le stesse sonde del self-heal e l'indice unico della 0020", () => {
  assert.ok(SCHEMA_FACTS_SQL.includes(CONNECTOR_PROBE_SQL));
  assert.ok(SCHEMA_FACTS_SQL.includes(USE_CASE_HUB_PROBE_SQL));
  assert.ok(SCHEMA_FACTS_SQL.includes(`to_regclass('public.${DOSSIER_UNIQUE_INDEX}')`));
  assert.equal(DOSSIER_UNIQUE_INDEX, "uc_cases_portfolio_use_case_unique_idx");
  assert.deepEqual(schemaFactsFrom({ uc: true, m0019: true, m0020: "true", dossier_unique_index: false, team_name: true, slack_drafts: true, scoring_models: true }), {
    uc: true,
    m0019: true,
    m0020: false,
    dossierUniqueIndex: false,
    teamName: true,
    slackDrafts: true,
    scoringModels: true,
  });
  assert.equal(schemaFactsFrom(undefined).uc, false);
});
