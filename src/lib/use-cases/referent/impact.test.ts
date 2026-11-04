import test from "node:test";
import assert from "node:assert/strict";
import { LEVERS } from "../../uc/vocab.ts";
import { LEVER_LABELS } from "../value-model.ts";
import { REFERENT_IMPACT_TEXT } from "./labels.ts";
import { benefitAnswered, benefitChoices, benefitFormOf, benefitQuestion, benefitSentLine, euroText } from "./impact-text.ts";
import {
  BENEFIT_DIFFERS_SQL,
  BENEFIT_REVIEW_SQL,
  BENEFIT_UNKNOWN_SQL,
  adoptedTeamOf,
  benefitAdoptionPatch,
  benefitAnswerOf,
  benefitDiffers,
  benefitNeedsReview,
  benefitUnknown,
  benefitTeamFromBody,
  impactRowByKey,
  impactRowsOf,
  sameBenefitTeam,
  storedBenefitAnswered,
} from "./impact.ts";

// Rilascio 5.1: una riga del passo «L'impatto» per ogni voce di «Benefici e costi». Modelli sintetici,
// di prova (3.000 volte l'anno, 12 minuti; 4.000 € l'anno; una voce qualitativa).

const ore = (key: string, volumeYear: number, minutesPerUnit: number, extra: Record<string, unknown> = {}) => ({
  kind: "ore",
  key,
  lever: "tempo",
  label: "Controllo delle fatture",
  confidence: "ipotesi",
  volumeYear,
  minutesPerUnit,
  automatablePct: 50,
  basis: "FONTE-RISERVATA",
  ...extra,
});
const euro = (key: string, eurYear: number, extra: Record<string, unknown> = {}) => ({ kind: "euro", key, lever: "costi", label: "Meno solleciti", confidence: "ipotesi", eurYear, ...extra });
const fatto = (key: string, extra: Record<string, unknown> = {}) => ({ kind: "qualitativo", key, lever: "qualita", label: "Meno errori nelle registrazioni", confidence: "da_misurare", ...extra });
const model = (...components: unknown[]) => ({ v: 1, primary: "tempo", components });
const draft = (d: Partial<{ answer: string | null; timesPerMonth: number | null; minutesEach: number | null; eurYear: number | null }> = {}) =>
  ({ answer: null, timesPerMonth: null, minutesEach: null, eurYear: null, ...d }) as Parameters<typeof benefitAnswered>[1];

test("le righe: una per voce, nell'ordine del modello, con l'istantanea della cifra del team e niente altro", () => {
  assert.equal(impactRowsOf(null), null);
  assert.equal(impactRowsOf({}), null);
  assert.equal(impactRowsOf(model()), null, "senza voci resta la stima del tempo del rilascio 5");
  const rows = impactRowsOf(model(ore("tempo-1", 3000, 12), euro("costi-1", 4000), fatto("qualita-1")));
  assert.deepEqual(rows, [
    { key: "tempo-1", position: 1, form: "ore", label: "Controllo delle fatture", team: { kind: "ore", volumeYear: 3000, minutes: 12, eurYear: null } },
    { key: "costi-1", position: 2, form: "euro", label: "Meno solleciti", team: { kind: "euro", volumeYear: null, minutes: null, eurYear: 4000 } },
    { key: "qualita-1", position: 3, form: "fatto", label: "Meno errori nelle registrazioni", team: { kind: "qualitativo", volumeYear: null, minutes: null, eurYear: null } },
  ]);
  const json = JSON.stringify(rows);
  for (const secret of ["automatable", "50", "FONTE-RISERVATA", "ipotesi", "da_misurare", "confidence"]) assert.ok(!json.includes(secret), `mai «${secret}»`);
  // Al massimo 6, chiavi doppie e tipi sconosciuti fuori, i numeri a due decimali.
  const many = impactRowsOf(model(...Array.from({ length: 8 }, (_, i) => fatto(`q-${i}`)), fatto("q-0"), { kind: "altro", key: "x" }));
  assert.equal(many?.length, 6);
  assert.deepEqual(impactRowsOf(model(ore("t", 1000.005, 7.333)))?.[0].team, { kind: "ore", volumeYear: 1000.01, minutes: 7.33, eurYear: null });
  assert.equal(impactRowByKey(model(ore("t", 10, 1), euro("e", 5)), "e")?.position, 2);
  assert.equal(impactRowByKey(model(ore("t", 10, 1)), "assente"), null);
});

test("le forme: con i numeri del team, senza, in euro, qualitativa (anche in euro senza cifra)", () => {
  const forms = impactRowsOf(model(ore("a", 3000, 12), ore("b", 0, 12), ore("c", 100, 0), ore("d", Number.NaN, 5), euro("e", 4000), euro("f", 0)))?.map((r) => r.form);
  assert.deepEqual(forms, ["ore", "ore_numeri", "ore_numeri", "ore_numeri", "euro", "fatto"]);
  assert.deepEqual(impactRowsOf(model(fatto("g")))?.map((r) => r.form), ["fatto"]);
  assert.equal(benefitFormOf({ kind: "euro", volumeYear: null, minutes: null, eurYear: 0.004 }), "fatto");
  // (Decisione del titolare del 04/11/2026) «Non so» su ogni forma, per ultimo; da solo accanto ai due numeri.
  assert.deepEqual(benefitChoices("ore").map((c) => c.label), ["Sì", "È di meno", "È di più", "Non so"]);
  assert.deepEqual(benefitChoices("euro").map((c) => c.answer), ["si", "meno", "piu", "non_so"]);
  assert.deepEqual(benefitChoices("fatto").map((c) => c.label), ["Sì", "No", "Non so"]);
  assert.deepEqual(benefitChoices("ore_numeri"), [{ answer: "non_so", label: "Non so" }]);
});

test("le domande: ore al mese o l'anno, singolare e plurale, i decimali, gli euro, il qualitativo", () => {
  const q = (component: unknown) => benefitQuestion(impactRowsOf(model(component))![0]);
  assert.equal(q(ore("t", 3000, 12)), "Controllo delle fatture: circa 250 volte al mese, 12 minuti ogni volta. Ti torna?");
  assert.equal(q(ore("t", 12, 1)), "Controllo delle fatture: circa 1 volta al mese, 1 minuto ogni volta. Ti torna?");
  assert.equal(q(ore("t", 18, 1.5)), "Controllo delle fatture: circa 2 volte al mese, 1,5 minuti ogni volta. Ti torna?");
  assert.equal(q(ore("t", 6, 30)), "Controllo delle fatture: circa 6 volte l'anno, 30 minuti ogni volta. Ti torna?");
  assert.equal(q(ore("t", 1, 90)), "Controllo delle fatture: circa 1 volta l'anno, 90 minuti ogni volta. Ti torna?");
  assert.equal(q(ore("t", 144000, 2)), "Controllo delle fatture: circa 12.000 volte al mese, 2 minuti ogni volta. Ti torna?");
  assert.equal(q(ore("t", 0, 12)), "Controllo delle fatture: quante volte al mese, e quanti minuti ogni volta?");
  assert.equal(q(euro("e", 4000)), "Meno solleciti: circa 4.000 € l'anno. Ti torna?");
  assert.equal(q(euro("e", 1234.56)), "Meno solleciti: circa 1.235 € l'anno. Ti torna?");
  assert.equal(q(euro("e", 0)), "Meno solleciti. Ti torna?", "senza cifra il referente non inventa euro");
  assert.equal(q(fatto("q")), "Meno errori nelle registrazioni. Ti torna?");
  assert.equal(q(fatto("q", { label: "Meno errori." })), "Meno errori. Ti torna?", "niente doppio punto");
  assert.equal(q(fatto("q", { label: "Clienti più contenti!" })), "Clienti più contenti! Ti torna?");
  assert.equal(q(ore("t", 3000, 12, { label: "Lettura:" })), "Lettura: circa 250 volte al mese, 12 minuti ogni volta. Ti torna?");
  assert.equal(euroText(0.2), "meno di 1 €");
});

test("il nome: quello della voce se passa i controlli, altrimenti il tipo di ritorno, per ogni tipo e ogni leva", () => {
  for (const lever of LEVERS) {
    for (const kind of ["ore", "euro", "qualitativo"] as const) {
      const component = kind === "ore" ? ore("k", 3000, 12, { lever, label: "Costo 40 € a pratica" }) : kind === "euro" ? euro("k", 4000, { lever, label: "Risparmio del 30%" }) : fatto("k", { lever, label: "Lo dice mario.rossi@cliente.test" });
      const row = impactRowsOf(model(component))![0];
      assert.equal(row.label, LEVER_LABELS[lever], `${kind}/${lever}: il tipo di ritorno al posto di un nome con importi, quote o un'email`);
      const question = benefitQuestion(row);
      assert.ok(question.startsWith(`${LEVER_LABELS[lever]}`), question);
      assert.doesNotMatch(question, /@|%|FONTE/);
      if (kind === "ore") assert.match(question, /volte al mese, 12 minuti ogni volta\. Ti torna\?$/);
      if (kind === "euro") assert.match(question, /circa 4\.000 € l'anno\. Ti torna\?$/);
      if (kind === "qualitativo") assert.match(question, /\. Ti torna\?$/);
    }
  }
  assert.equal(impactRowsOf(model(fatto("k", { lever: "sconosciuta", label: "" })))![0].label, LEVER_LABELS.tempo);
});

test("la risposta di una riga: le scelte della sua forma, i numeri solo con «È di meno» / «È di più»", () => {
  assert.deepEqual(benefitAnswerOf("ore", { answer: "si", timesPerMonth: "300", minutesEach: "15" }), { ok: true, value: { answer: "si", timesPerMonth: null, minutesEach: null, eurYear: null } });
  assert.deepEqual(benefitAnswerOf("ore", { answer: "piu", timesPerMonth: "1.200,5", minutesEach: "" }), { ok: true, value: { answer: "piu", timesPerMonth: 1200.5, minutesEach: null, eurYear: null } });
  assert.deepEqual(benefitAnswerOf("ore", { answer: null }), { ok: true, value: { answer: null, timesPerMonth: null, minutesEach: null, eurYear: null } }, "una bozza senza scelta (solo il commento)");
  assert.deepEqual(benefitAnswerOf("ore", { answer: "no" }), { ok: false, code: "dati_non_validi" });
  assert.deepEqual(benefitAnswerOf("ore", { answer: "meno", timesPerMonth: "tanti" }), { ok: false, code: "numero_non_valido" });
  assert.deepEqual(benefitAnswerOf("ore", { answer: "meno", timesPerMonth: 8_333_334 }), { ok: false, code: "numero_non_valido" });
  assert.deepEqual(benefitAnswerOf("ore_numeri", { timesPerMonth: "20", minutesEach: "1,5" }), { ok: true, value: { answer: null, timesPerMonth: 20, minutesEach: 1.5, eurYear: null } });
  assert.deepEqual(benefitAnswerOf("ore_numeri", { answer: "si" }), { ok: false, code: "dati_non_validi" });
  // «Non so» su ogni forma numerica: nessun numero, anche se la pagina ne manda.
  assert.deepEqual(benefitAnswerOf("ore_numeri", { answer: "non_so", timesPerMonth: "20", minutesEach: "5" }), { ok: true, value: { answer: "non_so", timesPerMonth: null, minutesEach: null, eurYear: null } });
  assert.deepEqual(benefitAnswerOf("ore", { answer: "non_so", timesPerMonth: "300", minutesEach: "15" }), { ok: true, value: { answer: "non_so", timesPerMonth: null, minutesEach: null, eurYear: null } });
  assert.deepEqual(benefitAnswerOf("euro", { answer: "non_so", eurYear: "3.500" }), { ok: true, value: { answer: "non_so", timesPerMonth: null, minutesEach: null, eurYear: null } });
  assert.deepEqual(benefitAnswerOf("ore_numeri", { answer: "no" }), { ok: false, code: "dati_non_validi" });
  assert.deepEqual(benefitAnswerOf("euro", { answer: "no" }), { ok: false, code: "dati_non_validi" });
  assert.deepEqual(benefitAnswerOf("euro", { answer: "meno", eurYear: "3.500", timesPerMonth: "9" }), { ok: true, value: { answer: "meno", timesPerMonth: null, minutesEach: null, eurYear: 3500 } });
  assert.deepEqual(benefitAnswerOf("euro", { answer: "si", eurYear: "3.500" }), { ok: true, value: { answer: "si", timesPerMonth: null, minutesEach: null, eurYear: null } });
  assert.deepEqual(benefitAnswerOf("euro", { answer: "meno", eurYear: 1_000_000_001 }), { ok: false, code: "numero_non_valido" });
  assert.deepEqual(benefitAnswerOf("fatto", { answer: "non_so", eurYear: 5 }), { ok: true, value: { answer: "non_so", timesPerMonth: null, minutesEach: null, eurYear: null } });
  assert.deepEqual(benefitAnswerOf("fatto", { answer: "piu" }), { ok: false, code: "dati_non_validi" });
});

test("quando una riga è chiusa: una scelta della sua forma, oppure i due numeri", () => {
  assert.equal(benefitAnswered("ore", draft()), false);
  assert.equal(benefitAnswered("ore", draft({ answer: "meno" })), true, "i numeri restano facoltativi");
  assert.equal(benefitAnswered("ore", draft({ answer: "no" })), false);
  assert.equal(benefitAnswered("ore_numeri", draft({ timesPerMonth: 20 })), false);
  assert.equal(benefitAnswered("ore_numeri", draft({ timesPerMonth: 20, minutesEach: 0 })), true);
  assert.equal(benefitAnswered("euro", draft({ answer: "si" })), true);
  assert.equal(benefitAnswered("fatto", draft({ answer: "non_so" })), true);
  assert.equal(benefitAnswered("fatto", draft({ answer: "meno" })), false);
  // «Non so» chiude ogni forma, anche la voce a ore senza i numeri del team, senza numeri.
  assert.equal(benefitAnswered("ore", draft({ answer: "non_so" })), true);
  assert.equal(benefitAnswered("euro", draft({ answer: "non_so" })), true);
  assert.equal(benefitAnswered("ore_numeri", draft({ answer: "non_so" })), true);
  assert.equal(benefitAnswered("ore_numeri", draft({ answer: "si" })), false);
});

test("la cifra vista e quella di adesso: tipo e numeri a due decimali", () => {
  const a = { kind: "ore" as const, volumeYear: 3000, minutes: 12, eurYear: null };
  assert.equal(sameBenefitTeam(a, { ...a }), true);
  assert.equal(sameBenefitTeam(a, { ...a, minutes: 12.001 }), true);
  assert.equal(sameBenefitTeam(a, { ...a, minutes: 13 }), false);
  assert.equal(sameBenefitTeam(a, { kind: "euro", volumeYear: null, minutes: null, eurYear: 3000 }), false);
  assert.equal(sameBenefitTeam(null, null), true);
  assert.equal(sameBenefitTeam(a, null), false);
  assert.deepEqual(benefitTeamFromBody({ kind: "euro", eurYear: 4000 }), { kind: "euro", volumeYear: null, minutes: null, eurYear: 4000 });
  assert.equal(benefitTeamFromBody({ kind: "euro", eurYear: -1 }), null);
  assert.equal(benefitTeamFromBody({ kind: "altro" }), null);
  assert.equal(benefitTeamFromBody(null), null);
});

test("la revisione del team: «È di meno», «È di più», «No», i due numeri o «Non so» su una cifra, finché il team non decide", () => {
  const oreTeam = { kind: "ore" as const, volumeYear: 3000, minutes: 12, eurYear: null };
  const none = { kind: "ore" as const, volumeYear: 0, minutes: 12, eurYear: null };
  const q = { kind: "qualitativo" as const, volumeYear: null, minutes: null, eurYear: null };
  const b = (team: typeof oreTeam | typeof q, d: Partial<{ answer: string | null; timesPerMonth: number | null; minutesEach: number | null; eurYear: number | null; outcome: "adottata" | "tenuta" | null }>) =>
    ({ team, answer: null, timesPerMonth: null, minutesEach: null, eurYear: null, outcome: null, ...d }) as Parameters<typeof benefitNeedsReview>[0];
  assert.equal(benefitNeedsReview(b(oreTeam, { answer: "si" })), false);
  assert.equal(benefitNeedsReview(b(oreTeam, { answer: "meno" })), true);
  assert.equal(benefitNeedsReview(b(oreTeam, { answer: "piu", timesPerMonth: 300 })), true);
  assert.equal(benefitNeedsReview(b(oreTeam, { answer: "piu", outcome: "tenuta" })), false);
  assert.equal(benefitNeedsReview(b(none, { timesPerMonth: 20, minutesEach: 5 })), true);
  assert.equal(benefitNeedsReview(b(none, { timesPerMonth: 20 })), false, "non ancora chiusa");
  assert.equal(benefitNeedsReview(b(q, { answer: "no" })), true);
  assert.equal(benefitNeedsReview(b(q, { answer: "non_so" })), false, "«Non so» su un beneficio senza cifra non chiede niente");
  assert.equal(storedBenefitAnswered(b(q, { answer: "si" })), true);
  // (Decisione del titolare del 04/11/2026) «Non so» su una cifra del team (ore, euro, anche al posto dei due
  // numeri) aspetta il team, ma non è una stima diversa.
  const euroTeam = { kind: "euro" as const, volumeYear: null, minutes: null, eurYear: 4000 };
  const euroZero = { kind: "euro" as const, volumeYear: null, minutes: null, eurYear: 0 };
  for (const team of [oreTeam, none, euroTeam]) {
    const unknown = b(team as unknown as typeof oreTeam, { answer: "non_so" });
    assert.equal(benefitNeedsReview(unknown), true, `${team.kind} ${team.volumeYear}`);
    assert.equal(benefitUnknown(unknown), true);
    assert.equal(benefitDiffers(unknown), false);
    assert.equal(benefitNeedsReview(b(team as unknown as typeof oreTeam, { answer: "non_so", outcome: "tenuta" })), false, "dopo «Fatto»");
  }
  assert.equal(benefitUnknown(b(euroZero as unknown as typeof oreTeam, { answer: "non_so" })), false);
  assert.equal(benefitUnknown(b(q, { answer: "non_so" })), false);
  assert.equal(benefitDiffers(b(oreTeam, { answer: "meno" })), true);
  assert.equal(benefitDiffers(b(none, { timesPerMonth: 20, minutesEach: 5 })), true);
  assert.equal(benefitUnknown(b(oreTeam, { answer: "meno" })), false);
  assert.equal(BENEFIT_DIFFERS_SQL("b"), "(b.outcome IS NULL AND (b.answer IN ('meno', 'piu', 'no') OR (b.answer IS NULL AND b.times_per_month IS NOT NULL AND b.minutes_each IS NOT NULL)))");
  assert.equal(BENEFIT_UNKNOWN_SQL("b"), "(b.outcome IS NULL AND b.answer = 'non_so' AND (b.kind = 'ore' OR (b.kind = 'euro' AND b.team_eur_year > 0)))");
  assert.equal(BENEFIT_REVIEW_SQL("b"), `(${BENEFIT_DIFFERS_SQL("b")} OR ${BENEFIT_UNKNOWN_SQL("b")})`);
});

test("«Usa la stima di {Nome}»: solo i numeri dati, solo su quella voce", () => {
  const oreTeam = { kind: "ore" as const, volumeYear: 3000, minutes: 12, eurYear: null };
  const euroTeam = { kind: "euro" as const, volumeYear: null, minutes: null, eurYear: 4000 };
  const none = { kind: "ore" as const, volumeYear: 0, minutes: 0, eurYear: null };
  const d = (team: typeof oreTeam, x: Partial<{ answer: string | null; timesPerMonth: number | null; minutesEach: number | null; eurYear: number | null }>) =>
    ({ team, answer: null, timesPerMonth: null, minutesEach: null, eurYear: null, ...x }) as Parameters<typeof benefitAdoptionPatch>[0];
  assert.deepEqual(benefitAdoptionPatch(d(oreTeam, { answer: "piu", timesPerMonth: 300.5 })), { volumeYear: 3606 });
  assert.deepEqual(benefitAdoptionPatch(d(oreTeam, { answer: "meno", minutesEach: 9 })), { minutesPerUnit: 9 });
  assert.deepEqual(benefitAdoptionPatch(d(oreTeam, { answer: "meno" })), {}, "senza numeri non c'è niente da usare");
  assert.deepEqual(benefitAdoptionPatch(d(oreTeam, { answer: "si" })), {});
  assert.deepEqual(benefitAdoptionPatch(d(oreTeam, { answer: "non_so" })), {}, "«Non so» non ha niente da usare");
  assert.deepEqual(benefitAdoptionPatch(d(none, { answer: "non_so" })), {});
  assert.deepEqual(benefitAdoptionPatch(d(euroTeam as never, { answer: "non_so" })), {});
  assert.deepEqual(benefitAdoptionPatch(d(euroTeam as never, { answer: "piu", eurYear: 5200 })), { eurYear: 5200 });
  assert.deepEqual(benefitAdoptionPatch(d(none, { timesPerMonth: 20, minutesEach: 5 })), { volumeYear: 240, minutesPerUnit: 5 });
  assert.deepEqual(adoptedTeamOf(d(oreTeam, { answer: "piu", timesPerMonth: 300 })), { kind: "ore", volumeYear: 3600, minutes: 12, eurYear: null });
});

test("in sola lettura dopo l'invio: la risposta di ogni riga, con i numeri dati", () => {
  const rows = impactRowsOf(model(ore("t", 3000, 12), ore("n", 0, 0, { label: "Archiviazione" }), euro("e", 4000), fatto("q")))!;
  assert.equal(benefitSentLine(rows[0], draft({ answer: "si" })), "Controllo delle fatture: sì.");
  assert.equal(benefitSentLine(rows[0], draft({ answer: "piu", timesPerMonth: 300 })), "Controllo delle fatture: è di più. 300 volte al mese, 12 minuti ogni volta.");
  assert.equal(benefitSentLine(rows[1], draft({ timesPerMonth: 20, minutesEach: 1 })), "Archiviazione: 20 volte al mese, 1 minuto ogni volta.");
  assert.equal(benefitSentLine(rows[2], draft({ answer: "meno", eurYear: 3500 })), "Meno solleciti: è di meno. Circa 3.500 € l'anno.");
  assert.equal(benefitSentLine(rows[3], draft({ answer: "no" })), "Meno errori nelle registrazioni: no.");
  assert.equal(benefitSentLine(rows[3], draft({ answer: "non_so" })), "Meno errori nelle registrazioni: non so.");
  assert.equal(benefitSentLine(rows[0], draft({ answer: "non_so" })), "Controllo delle fatture: non so.");
  assert.equal(benefitSentLine(rows[1], draft({ answer: "non_so" })), "Archiviazione: non so.", "al posto dei due numeri");
  assert.equal(benefitSentLine(rows[2], draft({ answer: "non_so" })), "Meno solleciti: non so.");
  // Una riga senza risposta: «nessuna risposta», mai «sì».
  assert.equal(benefitSentLine(rows[0], draft({ answer: null })), "Controllo delle fatture: nessuna risposta.");
  assert.equal(benefitSentLine(rows[2], draft({ answer: null })), "Meno solleciti: nessuna risposta.");
  assert.equal(benefitSentLine(rows[3], draft({ answer: null })), "Meno errori nelle registrazioni: nessuna risposta.");
});

test("i testi del passo: italiano semplice, nessuna parola tecnica, «use case» e «caso d'uso» fuori", () => {
  for (const text of Object.values(REFERENT_IMPACT_TEXT)) {
    assert.doesNotMatch(text, /use case|caso d'uso|\b(token|MCP|workflow|automatable|ROI|score)\b/i, text);
  }
  assert.equal(REFERENT_IMPACT_TEXT.title, "Cosa cambia, secondo il team");
});
