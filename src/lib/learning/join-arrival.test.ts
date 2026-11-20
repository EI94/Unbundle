import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JOIN_ARRIVAL_TEXT, KEPT_OTHER_COHORT_TEXT, joinArrival } from "./join-arrival.ts";

// (Ondata 0, docs/ui-10/PROPOSTA-10.md §6.3 voce 0.16) Formazione: dopo l'iscrizione da un link la lezione dice com'è
// andata (`?joined=1&outcome=…`, che prima nessuno leggeva), e con `kept_other_cohort` la pagina del link offre
// «Chiedi di riaprire il turno», l'azione del server che nessun pulsante chiamava.

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

test("the arrival line: one per outcome, nothing without joined=1 or with an outcome nobody sends", () => {
  assert.equal(joinArrival("1", "enrolled"), JOIN_ARRIVAL_TEXT.enrolled);
  assert.equal(joinArrival("1", "already_enrolled"), JOIN_ARRIVAL_TEXT.already_enrolled);
  assert.equal(joinArrival("1", "moved"), JOIN_ARRIVAL_TEXT.moved);
  assert.equal(joinArrival("1", "kept_other_cohort"), "Resti nel turno di prima, dove hai già delle risposte salvate.");
  assert.equal(joinArrival(["1", "0"], ["moved"]), JOIN_ARRIVAL_TEXT.moved, "parametri ripetuti: vale il primo");
  for (const [joined, outcome] of [[undefined, "enrolled"], ["0", "enrolled"], ["1", undefined], ["1", "altro"], ["1", "toString"]]) {
    assert.equal(joinArrival(joined, outcome), null, `${joined}/${outcome}`);
  }
});

test("the texts speak to anyone: no gendered «iscritto», «iscritta»", () => {
  for (const text of [...Object.values(JOIN_ARRIVAL_TEXT), ...Object.values(KEPT_OTHER_COHORT_TEXT)]) {
    assert.doesNotMatch(text, /\biscritt[oa]\b|\bbenvenut[oa]\b|\bsei spostat[oa]\b/i, text);
  }
});

test("the lesson reads the arrival parameters the join action sends", () => {
  assert.match(read("src/lib/actions/learning-join.ts"), /\?joined=1&outcome=\$\{result\.outcome\}/);
  const page = read("src/app/(dashboard)/dashboard/[workspaceId]/learning/[programId]/[moduleId]/page.tsx");
  assert.match(page, /<ProgramOverview \{\.\.\.values\} arrival=\{joinArrival\(sp\.joined, sp\.outcome\)\} \/>/);
  const overview = read("src/components/learning/program-overview.tsx");
  // (Ondata 7a) La riga d'arrivo sta in cima alla pagina del corso nuova; la prova resa è in course-page.test.ts.
  assert.match(overview, /\{arrival \? \(\s*<p role="status"[^>]*>\s*\{arrival\}\s*<\/p>/);
});

test("kept_other_cohort stops on the link page with «Chiedi di riaprire il turno», wired to the server action", () => {
  const form = read("src/components/learning/join-course-form.tsx");
  assert.match(form, /import \{ joinCourseByLinkAction, requestCohortReopenAction \} from "@\/lib\/actions\/learning-join";/);
  assert.match(form, /if \(result\.outcome === "kept_other_cohort"\) \{\s*setDone\(\[\]\);\s*setKept\(result\.path\);\s*return;\s*\}/, "non apre il corso da solo");
  assert.match(form, /await requestCohortReopenAction\(token\)/);
  assert.match(form, /\{T\.reopen\}/);
  assert.match(form, /onClick=\{\(\) => router\.replace\(kept\)\}/, "«Apri il corso» porta alla lezione");
  assert.equal(KEPT_OTHER_COHORT_TEXT.reopen, "Chiedi di riaprire il turno");
});
