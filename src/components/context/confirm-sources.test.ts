import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CONTEXT_TEXT as T } from "../../lib/context/text.ts";
import type { OpenProposals } from "../../lib/db/queries/context-proposals.ts";
import { confirmHeading, workSourceHeading, workSourceLabel } from "./confirm-sources.ts";

// «Da confermare» con le fonti nate dal lavoro (RILASCIO-9b-COSTRUZIONE.md §2.2, §2.5, §2.11): la testata, la fonte di
// «Ora: …», la riga che dice a quale richiesta di «Cosa serve» risponde una proposta, il pannello delle risposte. Codici
// e titoli inventati.

const TODAY = "2026-11-18";
type Source = OpenProposals["sources"][number];
const source = (over: Partial<Source> & Pick<Source, "id">): Source => ({ kind: "appunti", origin: "web", title: "Call di avvio", occurredOn: "2026-11-14", skipped: {}, learned: false, ...over });

const answers = source({ id: "s-risposte", kind: "risposta", origin: "rispondi", title: T.notes.answersTitle("XX-0012"), occurredOn: "2026-11-14" });
const learned = source({ id: "s-impara", kind: "appunti", origin: "cli", title: T.notes.learnedTitle("XX-0013"), occurredOn: "2026-11-18", learned: true });
const call = source({ id: "s-call" });
const doc = source({ id: "s-doc", kind: "documento", origin: "web", title: "Listino.pdf" });

test("la testata: «Dalle risposte del referente per XX-0012, 14 nov», «Da chi costruisce XX-0013, 18 nov»; appunti e documenti come sempre", () => {
  assert.equal(workSourceHeading(answers, TODAY), "Dalle risposte del referente per XX-0012, 14 nov");
  assert.equal(workSourceHeading(learned, TODAY), "Da chi costruisce XX-0013, 18 nov");
  assert.equal(workSourceHeading(call, TODAY), null);
  assert.equal(workSourceHeading(doc, TODAY), null);
  // Un titolo che non è quello di Unbundle resta intero.
  assert.equal(workSourceHeading({ ...answers, title: "Risposte" }, TODAY), "Dalle risposte del referente per Risposte, 14 nov");
  // Con una fonte sola nata dal lavoro vale la sua; con più fonti, o con un appunto, la testata di sempre.
  assert.equal(confirmHeading([answers], TODAY, "Dagli appunti"), "Dalle risposte del referente per XX-0012, 14 nov");
  assert.equal(confirmHeading([answers, call], TODAY, "Da 2 appunti"), "Da 2 appunti");
  assert.equal(confirmHeading([call], TODAY, "Dagli appunti «Call di avvio» del 14 nov"), "Dagli appunti «Call di avvio» del 14 nov");
  assert.equal(confirmHeading([], TODAY, null), null);
});

test("la fonte di «Ora: …»: «Referente 14 nov» e «Costruzione 18 nov», mai «Call»; per appunti e documenti niente (quella di sempre)", () => {
  const sources = [answers, learned, call, doc];
  assert.equal(workSourceLabel({ sourceId: "s-risposte" }, sources, TODAY), "Referente 14 nov");
  assert.equal(workSourceLabel({ sourceId: "s-impara" }, sources, TODAY), "Costruzione 18 nov");
  assert.equal(workSourceLabel({ sourceId: "s-call" }, sources, TODAY), null);
  assert.equal(workSourceLabel({ sourceId: "s-doc" }, sources, TODAY), null);
  assert.equal(workSourceLabel({ sourceId: "sconosciuta" }, sources, TODAY), null);
});

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("la riga di una proposta dice a quale richiesta di «Cosa serve» risponde; la pagina usa le testate e le fonti nuove", () => {
  assert.equal(T.confirm.answersNeed("L'elenco dei fornitori", "XX-0012"), "Risponde a «Cosa serve»: L'elenco dei fornitori (XX-0012)");
  const row = read("./proposal-row.tsx");
  assert.match(row, /\{proposal\.answersNeed \? <p className="[^"]*">\{T\.confirm\.answersNeed\(proposal\.answersNeed\.title, proposal\.answersNeed\.code\)\}<\/p> : null\}/);
  const view = read("./confirm-view.tsx");
  assert.match(view, /const subtitle = confirmHeading\(sources, today, confirmSubtitle\(sources, today\)\);/);
  assert.match(view, /sourceLabel=\{workSourceLabel\(proposal, sources, today\) \?\? proposalSource\(proposal, sources, today\)\}/);
});

test("il pannello delle risposte di un referente: niente testo, la frase e «Apri lo use case» su «Cosa serve»", () => {
  const sheet = read("./source-sheet.tsx");
  assert.match(sheet, /const isAnswers = source\?\.kind === "risposta";/);
  const branch = sheet.slice(sheet.indexOf(") : isAnswers ? ("), sheet.indexOf(") : purged ? ("));
  assert.match(branch, /<p className="text-muted-foreground">\{T\.notes\.answerSource\}<\/p>/);
  assert.match(branch, /href=\{`\/dashboard\/\$\{workspaceId\}\/use-cases\/\$\{encodeURIComponent\(source\.useCaseId\)\}\?capitolo=cosa-serve`\}/);
  assert.match(branch, /min-h-11/, "sul telefono si tocca in 44 px");
  assert.doesNotMatch(branch, /source\.body/, "il testo delle risposte non si mostra qui");
  assert.equal(T.notes.answerSource, "Le risposte stanno nella scheda dello use case, in «Cosa serve».");
  assert.equal(T.notes.openUseCase, "Apri lo use case");
});
