import test from "node:test";
import assert from "node:assert/strict";
import { UC_PAGE_ROLES, canOpenItem, canOpenPage, isClientViewer, seesInternalComments, seesPersonalZoneMetadata, seesValidatedOnly } from "./page-access.ts";

test("catalog pages follow the role matrix: case viewers plus the developer", () => {
  for (const page of ["voci", "voce", "regole", "modello_dati", "documenti"] as const) {
    assert.ok(canOpenPage(page, ["ls_lead"]));
    assert.ok(canOpenPage(page, ["ls_analista"]));
    assert.ok(canOpenPage(page, ["owner_cliente"]));
    assert.ok(canOpenPage(page, ["ls_sviluppatore"]));
    assert.equal(canOpenPage(page, ["osservatore"]), false);
    assert.equal(canOpenPage(page, ["ai_board"]), false);
    assert.equal(canOpenPage(page, ["approvatore_privacy"]), false);
  }
});

test("the verification queue is only for validators", () => {
  assert.deepEqual([...UC_PAGE_ROLES.verifica].sort(), ["ls_analista", "ls_lead"]);
  assert.equal(canOpenPage("verifica", ["owner_cliente"]), false);
  assert.equal(canOpenPage("verifica", ["ls_sviluppatore"]), false);
});

test("synthesis pages: observers and the AI board see KPI, map and ROI; the developer sees KPI and map", () => {
  for (const page of ["kpi", "mappa", "roi"] as const) {
    assert.ok(canOpenPage(page, ["osservatore"]));
    assert.ok(canOpenPage(page, ["ai_board"]));
    assert.ok(canOpenPage(page, ["owner_cliente"]));
    assert.equal(canOpenPage(page, ["approvatore_privacy"]), false);
  }
  assert.ok(canOpenPage("kpi", ["ls_sviluppatore"]));
  assert.ok(canOpenPage("mappa", ["ls_sviluppatore"]));
  assert.equal(canOpenPage("roi", ["ls_sviluppatore"]), false);
});

test("the developer alone sees only green or blue items", () => {
  assert.equal(seesValidatedOnly(["ls_sviluppatore"]), true);
  assert.equal(seesValidatedOnly(["ls_sviluppatore", "ls_analista"]), false);
  assert.equal(seesValidatedOnly(["ls_lead"]), false);
  assert.equal(canOpenItem(["ls_sviluppatore"], "in_verifica"), false);
  assert.equal(canOpenItem(["ls_sviluppatore"], "validata"), true);
  assert.equal(canOpenItem(["ls_sviluppatore"], "non_applicabile"), true);
  assert.equal(canOpenItem(["owner_cliente"], "da_chiedere"), true);
  assert.equal(canOpenItem(["osservatore"], "validata"), false);
});

test("client viewers, internal comments and personal zone metadata", () => {
  assert.equal(isClientViewer(["owner_cliente"]), true);
  assert.equal(isClientViewer(["osservatore"]), true);
  assert.equal(isClientViewer(["ai_board"]), true);
  assert.equal(isClientViewer(["ls_lead"]), false);
  assert.equal(isClientViewer(["ls_sviluppatore", "osservatore"]), false);
  assert.equal(seesInternalComments(["ls_lead"]), true);
  assert.equal(seesInternalComments(["ls_sviluppatore"]), false);
  assert.equal(seesInternalComments(["owner_cliente"]), false);
  assert.equal(seesPersonalZoneMetadata(["ls_analista"]), true);
  assert.equal(seesPersonalZoneMetadata(["approvatore_privacy"]), true);
  assert.equal(seesPersonalZoneMetadata(["owner_cliente"]), false);
});
