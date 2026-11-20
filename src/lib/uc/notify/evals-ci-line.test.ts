// L'e-mail `evals_in_calo` delle evals arrivate dalla CI di main (rilascio 8.2b, RILASCIO-8.2b-SPEC.md §2.6): una riga in
// più, «Le ha mandate la CI di main, commit a1b2c3d.», con il commit controllato in ogni passo (la coda, il motore, il
// modello). Senza la CI l'e-mail resta quella della 8.2a. Il modello del rilascio 10: il corpo entro 60 parole, nessuna
// parola vietata fuori dalla dashboard. Dati inventati.
import test from "node:test";
import assert from "node:assert/strict";
import { NOBODY, notifyTask } from "../../db/queries/use-case-tasks-notices.ts";
import { findHubForbidden } from "../../use-cases/copy-guard.ts";
import { formatQuality } from "../../use-cases/factory/benchmark.ts";
import { planDelivery, type ClaimedNotification, type DeliveryFacts } from "./dispatch.ts";
import { EMAIL_BODY_MAX_WORDS, emailBodyWords, emailBrand } from "./email-render.ts";
import { evalsFromCiLine, renderEmail } from "./email-templates.ts";

const WS = "11111111-1111-4111-8111-111111111111";
const CASE = "22222222-2222-4222-8222-222222222222";
const UC = "33333333-3333-4333-8333-333333333333";
const USER = "77777777-7777-4777-8777-777777777777";
const COMMIT = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const OPTS = { origin: "https://app.unbundle.test", lsDomains: ["ls.test"], now: new Date("2026-11-18T09:30:00Z") };
const LINE = "Le ha mandate la CI di main, commit a1b2c3d.";

const claimed = (payload: Record<string, unknown>): ClaimedNotification => ({
  id: "88888888-8888-4888-8888-888888888888",
  workspaceId: WS,
  caseId: CASE,
  requestId: null,
  recipientContactId: null,
  recipientUserId: USER,
  templateKey: "evals_in_calo",
  payload: payload as Record<string, string | boolean>,
  attempts: 0,
  dedupeKey: `evals_in_calo:${CASE}:${USER}:2026-11-18`,
});

const facts = (title = "Smistamento di prova"): DeliveryFacts => ({
  clientName: "Cliente prova",
  case: { id: CASE, code: "XX-0012", title, status: "pronto_sviluppo", ownerContactId: null, designated: { owner: null, privacy: null } },
  recipient: { kind: "user", id: USER, email: "persona@ls.test", reachable: true, digestOptOut: false, lateralSpace: true },
  request: null,
});

function emailOf(payload: Record<string, unknown>, title?: string) {
  const plan = planDelivery(claimed(payload), facts(title), OPTS);
  assert.equal(plan.action, "send", JSON.stringify(payload));
  if (plan.action !== "send") throw new Error("non parte");
  return renderEmail(plan.build(null), emailBrand(OPTS.origin));
}

const DOWN = { useCase: UC, alert: "in_calo", qualityText: formatQuality(0.91), drop: 0.064 };
const BELOW = { useCase: UC, alert: "sotto_soglia", qualityText: formatQuality(0.8) };

test("la riga: il commit corto di 7 cifre; un commit che non è esadecimale non entra mai in un'e-mail", () => {
  assert.equal(evalsFromCiLine(COMMIT), LINE);
  assert.equal(evalsFromCiLine("A1B2C3D"), LINE, "già corto, in maiuscolo");
  for (const bad of ["", "a1b2c3", "zzzzzzz", `${COMMIT}0`, "a1b2c3d <a href=x>", "https://example.test"]) assert.throws(() => evalsFromCiLine(bad), /Commit/, bad);
});

test("le evals dalla CI: la riga in più dopo la frase delle evals, nel testo e nell'HTML; senza la CI, l'e-mail di prima", () => {
  for (const payload of [DOWN, BELOW]) {
    const ci = emailOf({ ...payload, source: "ci", commit: COMMIT });
    assert.ok(ci.text.includes(LINE), ci.text);
    assert.ok(ci.html.includes(LINE), "anche nell'HTML");
    assert.ok(ci.text.indexOf(LINE) > ci.text.indexOf("le evals di main"), "dopo la frase delle evals");
    assert.ok(ci.text.indexOf(LINE) < ci.text.indexOf("Prima di cambiare altro"), "prima del passo da fare");
    const cli = emailOf(payload);
    assert.ok(!cli.text.includes("Le ha mandate"), "dalla CLI: niente riga in più");
    assert.equal(ci.subject, cli.subject, "l'oggetto non cambia");
    assert.equal(ci.text.replace(`${LINE}\n\n`, ""), cli.text, "l'unica differenza è la riga");
  }
  // La coda dice «ci» solo con il commit intero: altrimenti l'e-mail parte, senza la riga.
  for (const extra of [{ source: "ci" }, { source: "ci", commit: "a1b2c3d" }, { source: "ci", commit: `${COMMIT.slice(0, 39)}g` }, { source: "cli", commit: COMMIT }, { commit: COMMIT }]) {
    assert.ok(!emailOf({ ...DOWN, ...extra }).text.includes("Le ha mandate"), JSON.stringify(extra));
  }
});

// Il corpo con la riga della specifica (9 parole) resta entro 60 parole con i titoli del test del modello
// (email-model.test.ts) e fino a cinque parole; con un titolo di otto parole l'e-mail della 8.2a ne ha già 54.
test("il modello del rilascio 10: con la riga il corpo resta entro 60 parole; nessuna parola vietata", () => {
  for (const title of ["Smistamento di prova", "Smistamento delle richieste", "Registrazione delle fatture dei fornitori"]) {
    for (const payload of [DOWN, BELOW]) {
      const m = emailOf({ ...payload, source: "ci", commit: COMMIT }, title);
      const words = emailBodyWords(m.text);
      assert.ok(words <= EMAIL_BODY_MAX_WORDS, `${words} parole\n${m.text}`);
      assert.deepEqual(findHubForbidden(`${m.subject}\n${m.text}`.replace(/https?:\/\/\S+/g, ""), "esterno"), [], m.text);
    }
  }
});

test("la coda: «ci» e il commit nel carico dell'e-mail solo con le 40 cifre; mai nella campanella", () => {
  const target = { workspaceId: WS, useCaseId: UC };
  const payloadOf = (extra: Parameters<typeof notifyTask>[7]) => {
    const [bell, email] = notifyTask(target, "evals_in_calo", { roles: ["ls_lead"] }, NOBODY, OPTS.now, null, undefined, extra);
    return { bell: JSON.stringify(bell.params), email: JSON.stringify(email.params) };
  };
  const withCi = payloadOf({ alert: "in_calo", qualityText: "91%", drop: 0.064, fromCi: { commit: COMMIT } });
  assert.ok(withCi.email.includes(`\\"source\\":\\"ci\\"`) && withCi.email.includes(COMMIT), withCi.email);
  assert.ok(!withCi.bell.includes(COMMIT), "la campanella non porta il commit");
  for (const commit of ["a1b2c3d", "x".repeat(40), `${COMMIT} `]) {
    const p = payloadOf({ alert: "in_calo", qualityText: "91%", drop: 0.064, fromCi: { commit } });
    assert.ok(!p.email.includes("source"), commit);
  }
  assert.ok(!payloadOf({ alert: "sotto_soglia", qualityText: "80%" }).email.includes("source"));
});
