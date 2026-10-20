import test from "node:test";
import assert from "node:assert/strict";
import { NA_REASON_MIN_LENGTH, normalizeDelega, normalizeEmail, normalizeNonSo, normalizePropostaNa, normalizeUniversalAction } from "./universal.ts";

const codes = (r: { ok: boolean; errors?: { code: string }[] }) => (r.ok ? [] : (r as { errors: { code: string }[] }).errors.map((e) => e.code));

test("normalizeEmail lowercases valid addresses and rejects the rest", () => {
  assert.equal(normalizeEmail(" Collega@Esempio.IT "), "collega@esempio.it");
  for (const bad of ["collega", "a@b", "a b@esempio.it", "<a@esempio.it>", "", null, 3]) assert.equal(normalizeEmail(bad), null, String(bad));
});

test("«Non lo so» is a valid answer, with who might know (optional)", () => {
  assert.deepEqual(normalizeNonSo(undefined), { ok: true, value: {} });
  assert.deepEqual(normalizeNonSo({ who_might_know: " l'amministrazione " }), { ok: true, value: { who_might_know: "l'amministrazione" } });
  assert.deepEqual(codes(normalizeNonSo({ who_might_know: "x".repeat(301) })), ["testo_troppo_lungo"]);
});

test("delega: name, valid email, items within the active ones", () => {
  const ctx = { activeItemIds: ["i1", "i2", "i3"] };
  assert.deepEqual(normalizeDelega({ nome: "Collega", email: "C@esempio.it", voci: ["i1", "i2", "i1"], messaggio: "  grazie " }, ctx), {
    ok: true,
    value: { nome: "Collega", email: "c@esempio.it", voci: ["i1", "i2"], messaggio: "grazie" },
  });
  assert.deepEqual(codes(normalizeDelega({ nome: "", email: "x", voci: [] }, ctx)), ["nome_mancante", "email_non_valida", "voci_mancanti"]);
  assert.deepEqual(codes(normalizeDelega({ nome: "C", email: "c@esempio.it", voci: ["i9"] }, ctx)), ["voce_non_delegabile"]);
  assert.deepEqual(codes(normalizeDelega({ nome: "C", email: "c@esempio.it", voci: ["i1"], messaggio: "x".repeat(1001) }, ctx)), [
    "messaggio_troppo_lungo",
  ]);
  assert.deepEqual(codes(normalizeDelega("x", ctx)), ["delega_mancante"]);
});

test("proposta_na: reason of at least 10 characters", () => {
  assert.equal(NA_REASON_MIN_LENGTH, 10);
  assert.deepEqual(normalizePropostaNa({ reason: "  Non facciamo voli cargo  " }), { ok: true, value: { reason: "Non facciamo voli cargo" } });
  assert.deepEqual(codes(normalizePropostaNa({ reason: "no" })), ["motivo_troppo_corto"]);
  assert.deepEqual(codes(normalizePropostaNa("123456789")), ["motivo_troppo_corto"]);
  assert.deepEqual(codes(normalizePropostaNa("x".repeat(2001))), ["motivo_troppo_lungo"]);
});

test("normalizeUniversalAction dispatches", () => {
  const ctx = { activeItemIds: ["i1"] };
  assert.ok(normalizeUniversalAction("non_so", {}, ctx).ok);
  assert.ok(!normalizeUniversalAction("delega", {}, ctx).ok);
  assert.ok(normalizeUniversalAction("proposta_na", { reason: "motivo abbastanza lungo" }, ctx).ok);
});
