import test from "node:test";
import assert from "node:assert/strict";
import {
  compareQuarters,
  currentQuarter,
  isIsoDate,
  isPastQuarter,
  isQuarterCode,
  nextQuarter,
  parseIsoDate,
  quarterLabel,
  quarterOfDate,
  quarterStart,
  resolveWhen,
  romeToday,
  TIME_ZONE,
  WHEN_LATER_LABEL,
  whenChoiceLabel,
  whenChoiceToQuarter,
  whenLabel,
} from "./quarter.ts";
import { WHEN_CHOICES } from "./types.ts";

// «Quando» e data di revisione: docs/use-case/DESIGN.md §3.6 e §1.2 punto 1.
// Le date sono istanti UTC: il fuso è sempre Europe/Rome, qualunque sia quello della macchina.

const at = (iso: string) => new Date(iso);
const OCT_14_2026 = at("2026-10-14T10:00:00Z");

test("il fuso è Europe/Rome", () => {
  assert.equal(TIME_ZONE, "Europe/Rome");
  // Inverno (UTC+1): le 23:30 UTC del 31 dicembre sono già il 1° gennaio a Roma.
  assert.equal(romeToday(at("2026-12-31T22:59:59Z")), "2026-12-31");
  assert.equal(romeToday(at("2026-12-31T23:00:00Z")), "2027-01-01");
  // Estate (UTC+2): le 22:00 UTC del 30 giugno sono già il 1° luglio a Roma.
  assert.equal(romeToday(at("2026-06-30T21:59:59Z")), "2026-06-30");
  assert.equal(romeToday(at("2026-06-30T22:00:00Z")), "2026-07-01");
});

test("il trimestre di oggi si calcola a Roma, anche a cavallo dei trimestri", () => {
  assert.equal(currentQuarter(OCT_14_2026), "2026-Q4");
  assert.equal(currentQuarter(at("2026-06-30T21:59:59Z")), "2026-Q2");
  assert.equal(currentQuarter(at("2026-06-30T22:00:00Z")), "2026-Q3");
  assert.equal(currentQuarter(at("2026-03-31T21:59:59Z")), "2026-Q1");
  assert.equal(currentQuarter(at("2026-03-31T22:00:00Z")), "2026-Q2");
  assert.equal(currentQuarter(at("2026-09-30T22:00:00Z")), "2026-Q4");
});

test("cambio d'anno: dopo il T4 viene il T1 dell'anno dopo", () => {
  assert.equal(currentQuarter(at("2026-12-31T22:59:59Z")), "2026-Q4");
  assert.equal(currentQuarter(at("2026-12-31T23:00:00Z")), "2027-Q1");
  assert.equal(nextQuarter("2026-Q4"), "2027-Q1");
  assert.equal(nextQuarter("2026-Q1"), "2026-Q2");
  assert.equal(nextQuarter("2026-Q3"), "2026-Q4");
  // «Prossimo trimestre» scelto a dicembre è il T1 dell'anno dopo.
  assert.equal(whenChoiceToQuarter("prossimo_trimestre", at("2026-12-15T12:00:00Z")), "2027-Q1");
  assert.equal(whenChoiceLabel("prossimo_trimestre", at("2026-12-15T12:00:00Z")), "Prossimo trimestre (T1 2027)");
  // Ultima ora del 31 dicembre a Roma: «Questo trimestre» è ancora il T4.
  assert.equal(whenChoiceToQuarter("questo_trimestre", at("2026-12-31T22:30:00Z")), "2026-Q4");
  assert.equal(whenChoiceToQuarter("questo_trimestre", at("2026-12-31T23:30:00Z")), "2027-Q1");
});

test("etichetta «T1 2027»: mai la «Q» a schermo", () => {
  assert.equal(quarterLabel("2027-Q1"), "T1 2027");
  assert.equal(quarterLabel("2026-Q4"), "T4 2026");
  for (const q of ["2026-Q1", "2026-Q2", "2026-Q3", "2026-Q4"]) assert.doesNotMatch(quarterLabel(q), /Q/);
  // Un dato rovinato non rompe la pagina: torna com'è.
  assert.equal(quarterLabel("prossimo"), "prossimo");
});

test("le tre scelte di «Quando»: cosa si salva e l'etichetta (tabella di §3.6)", () => {
  assert.deepEqual(WHEN_CHOICES, ["questo_trimestre", "prossimo_trimestre", "piu_avanti"]);
  assert.equal(whenChoiceToQuarter("questo_trimestre", OCT_14_2026), "2026-Q4");
  assert.equal(whenChoiceToQuarter("prossimo_trimestre", OCT_14_2026), "2027-Q1");
  assert.equal(whenChoiceToQuarter("piu_avanti", OCT_14_2026), null);
  assert.equal(whenChoiceLabel("questo_trimestre", OCT_14_2026), "Questo trimestre (T4 2026)");
  assert.equal(whenChoiceLabel("prossimo_trimestre", OCT_14_2026), "Prossimo trimestre (T1 2027)");
  assert.equal(whenChoiceLabel("piu_avanti", OCT_14_2026), "Più avanti");
  assert.equal(WHEN_LATER_LABEL, "Più avanti");
});

test("«Quando» a schermo: il trimestre, oppure «Più avanti» per NULL (anche le schede di prima della 0020)", () => {
  assert.equal(whenLabel("2027-Q1"), "T1 2027");
  assert.equal(whenLabel(null), "Più avanti");
  assert.equal(whenLabel(undefined), "Più avanti");
});

test("trimestre passato: il dato non invecchia, a gennaio il T4 dell'anno prima è scaduto", () => {
  // Approvato «Questo trimestre» il 14 ottobre 2026: si salva il T4 2026.
  const saved = whenChoiceToQuarter("questo_trimestre", OCT_14_2026);
  assert.equal(saved, "2026-Q4");
  assert.equal(isPastQuarter(saved!, OCT_14_2026), false);
  // A gennaio 2027 mostra ancora «T4 2026» ed è passato («Scaduto» in Roadmap se non è partito).
  const january = at("2027-01-10T09:00:00Z");
  assert.equal(quarterLabel(saved!), "T4 2026");
  assert.equal(isPastQuarter(saved!, january), true);
  // Il passaggio avviene alla mezzanotte di Roma, non a quella di UTC.
  assert.equal(isPastQuarter("2026-Q4", at("2026-12-31T22:59:59Z")), false);
  assert.equal(isPastQuarter("2026-Q4", at("2026-12-31T23:00:00Z")), true);
  // Trimestri di altri anni e quelli futuri.
  assert.equal(isPastQuarter("2025-Q4", OCT_14_2026), true);
  assert.equal(isPastQuarter("2026-Q3", OCT_14_2026), true);
  assert.equal(isPastQuarter("2027-Q1", OCT_14_2026), false);
  assert.equal(isPastQuarter("2030-Q1", OCT_14_2026), false);
});

test("confronto tra trimestri", () => {
  assert.ok(compareQuarters("2026-Q4", "2027-Q1") < 0);
  assert.ok(compareQuarters("2027-Q1", "2026-Q4") > 0);
  assert.equal(compareQuarters("2027-Q2", "2027-Q2"), 0);
  assert.ok(compareQuarters("2025-Q4", "2026-Q1") < 0);
});

test("formato del trimestre: come il CHECK ^[0-9]{4}-Q[1-4]$", () => {
  for (const q of ["2026-Q1", "2027-Q4", "1999-Q2"]) assert.equal(isQuarterCode(q), true, q);
  for (const q of ["2026-Q0", "2026-Q5", "2026Q1", "26-Q1", "2026-q1", "T1 2027", " 2026-Q1", "2026-Q1 ", "", null, 2026]) {
    assert.equal(isQuarterCode(q), false, String(q));
  }
  assert.throws(() => nextQuarter("2026-Q5"), RangeError);
});

test("«Quando» dal MCP del team: una scelta oppure un trimestre esplicito", () => {
  assert.deepEqual(resolveWhen("questo_trimestre", OCT_14_2026), { ok: true, quarter: "2026-Q4" });
  assert.deepEqual(resolveWhen("prossimo_trimestre", OCT_14_2026), { ok: true, quarter: "2027-Q1" });
  assert.deepEqual(resolveWhen("piu_avanti", OCT_14_2026), { ok: true, quarter: null });
  assert.deepEqual(resolveWhen("2027-Q3", OCT_14_2026), { ok: true, quarter: "2027-Q3" });
  for (const bad of ["2027-Q5", "T3 2027", "questo trimestre", "", null, undefined, 3]) {
    assert.deepEqual(resolveWhen(bad, OCT_14_2026), { ok: false }, String(bad));
  }
});

test("inizio del trimestre (per «All'inizio del prossimo trimestre» di Rimanda)", () => {
  assert.equal(quarterStart("2027-Q1"), "2027-01-01");
  assert.equal(quarterStart("2026-Q2"), "2026-04-01");
  assert.equal(quarterStart("2026-Q3"), "2026-07-01");
  assert.equal(quarterStart("2026-Q4"), "2026-10-01");
  assert.equal(quarterStart(nextQuarter(currentQuarter(OCT_14_2026))), "2027-01-01");
});

test("date AAAA-MM-GG: solo giorni che esistono", () => {
  assert.deepEqual(parseIsoDate("2027-01-14"), { year: 2027, month: 1, day: 14 });
  assert.equal(isIsoDate("2028-02-29"), true);
  for (const bad of ["2027-02-29", "2026-13-01", "2026-00-10", "2026-04-31", "2026-4-1", "14/01/2027", "2027-01-14T00:00:00Z", "", null]) {
    assert.equal(isIsoDate(bad), false, String(bad));
  }
  assert.equal(quarterOfDate("2026-10-01"), "2026-Q4");
  assert.equal(quarterOfDate("2026-09-30"), "2026-Q3");
  assert.equal(quarterOfDate("2027-01-01"), "2027-Q1");
});
