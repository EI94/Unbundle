import test from "node:test";
import assert from "node:assert/strict";
import { staleBefore } from "./freshness.ts";

// «Da verificare» dopo 6 mesi (RILASCIO-9b-COSTRUZIONE.md §2.10): la mezzanotte di Roma dello stesso giorno, sei mesi
// prima. Un fatto è da verificare se l'ultima conferma è prima di quell'istante.

const stale = (confirmedAt: string, now: string) => new Date(confirmedAt).getTime() < staleBefore(new Date(now)).getTime();

test("sei mesi esatti no, il giorno prima sì, il giorno dopo no (ora solare oggi, ora legale sei mesi fa)", () => {
  const now = "2026-11-18T09:00:00Z"; // 18 nov, 10:00 a Roma
  assert.equal(staleBefore(new Date(now)).toISOString(), "2026-05-17T22:00:00.000Z", "mezzanotte del 18 maggio a Roma (UTC+2)");
  assert.equal(stale("2026-05-18T08:00:00Z", now), false, "sei mesi esatti");
  assert.equal(stale("2026-05-17T08:00:00Z", now), true, "sei mesi e un giorno");
  assert.equal(stale("2026-05-19T08:00:00Z", now), false, "sei mesi meno un giorno");
  // Il confine è la mezzanotte di Roma, non quella di UTC.
  assert.equal(stale("2026-05-17T21:59:59Z", now), true, "le 23:59 del 17 maggio a Roma");
  assert.equal(stale("2026-05-17T22:00:00Z", now), false, "la mezzanotte del 18 maggio a Roma");
});

test("ora legale oggi e ora solare sei mesi fa, e il giorno del cambio d'ora", () => {
  // 18 maggio 2027, 12:00 a Roma (UTC+2): il confine è la mezzanotte del 18 novembre 2026 (UTC+1).
  assert.equal(staleBefore(new Date("2027-05-18T10:00:00Z")).toISOString(), "2026-11-17T23:00:00.000Z");
  assert.equal(stale("2026-11-17T22:59:59Z", "2027-05-18T10:00:00Z"), true);
  assert.equal(stale("2026-11-17T23:00:00Z", "2027-05-18T10:00:00Z"), false);
  // 28 marzo 2027, il giorno in cui torna l'ora legale: il confine è il 28 settembre 2026, ora legale.
  assert.equal(staleBefore(new Date("2027-03-28T12:00:00Z")).toISOString(), "2026-09-27T22:00:00.000Z");
  // 31 ottobre 2027, il giorno in cui torna l'ora solare: il 30 aprile non ha il 31, si prende l'ultimo giorno.
  assert.equal(staleBefore(new Date("2027-10-31T12:00:00Z")).toISOString(), "2027-04-29T22:00:00.000Z");
});

test("il giorno è quello di Roma: alle 00:30 di Roma è già il giorno dopo", () => {
  // 18 nov 23:30 UTC = 19 nov 00:30 a Roma: il confine è la mezzanotte del 19 maggio.
  assert.equal(staleBefore(new Date("2026-11-18T23:30:00Z")).toISOString(), "2026-05-18T22:00:00.000Z");
  assert.equal(staleBefore(new Date("2026-11-18T22:30:00Z")).toISOString(), "2026-05-17T22:00:00.000Z");
});

test("fine mese e cambio d'anno: il 31 agosto vale il 28 febbraio; marzo torna a settembre dell'anno prima", () => {
  assert.equal(staleBefore(new Date("2026-08-31T10:00:00Z")).toISOString(), "2026-02-27T23:00:00.000Z");
  assert.equal(staleBefore(new Date("2028-08-31T10:00:00Z")).toISOString(), "2028-02-28T23:00:00.000Z", "bisestile: il 29 febbraio");
  assert.equal(staleBefore(new Date("2027-03-15T10:00:00Z")).toISOString(), "2026-09-14T22:00:00.000Z");
  assert.equal(staleBefore(new Date("2027-01-10T10:00:00Z")).toISOString(), "2026-07-09T22:00:00.000Z");
});
