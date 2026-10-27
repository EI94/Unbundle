import test from "node:test";
import assert from "node:assert/strict";
import { romeLocalToUtc } from "../../uc/calendar.ts";
import { findHubForbidden } from "../copy-guard.ts";
import { planReferentDelivery, type ClaimedReferentEmail, type ReferentDeliveryFacts, type ReferentRequestFacts } from "./dispatch.ts";
import { TEAM_ACCESS_LINE, TEAM_ACCESS_LINE_MANY, TEAM_ACCESS_LINK_LABEL, renderReferentEmail, type ReferentEmailInput } from "./email.ts";
import { REFERENT_ERROR_MESSAGES, REFERENT_PUBLIC_TEXT, REFERENT_UI_TEXT } from "./labels.ts";
import { cardLink, checkCardLink } from "./links.ts";
import { toStatement, ucSql } from "../../uc/sql/statement.ts";
import { NO_PERSON, contactPeopleSql, emailPersonSql, isSelfRequest, personFactsOf, referentPersonOf, requestReferentUserSql } from "./people.ts";
import { HANDLED_NEED_STATUSES, itemHandledByTeam, itemIsOpen } from "./state.ts";
import { toPublicView, type PublicItemRow, type PublicRows } from "./view.ts";

// Ruoli che si sovrappongono (SPEC Parte 3): chi è il referente in Unbundle, la riga per un referente
// revisore nelle email, la domanda «gestita» dal team sulla pagina pubblica, i testi.
const WS = "3f2a9c1e-0000-4000-8000-0000000000a1";
const UC = "3f2a9c1e-0000-4000-8000-0000000000b1";
const R1 = "3f2a9c1e-0000-4000-8000-0000000000d1";
const R2 = "3f2a9c1e-0000-4000-8000-0000000000d2";
const USER = "3f2a9c1e-0000-4000-8000-0000000000aa";
const OTHER = "3f2a9c1e-0000-4000-8000-0000000000ab";
const NOW = romeLocalToUtc("2026-11-05", 10);
const ORIGIN = "https://app.example.test";
const LINK = `${ORIGIN}/rispondi/ucq_${"A".repeat(32)}`;
const CARD = `${ORIGIN}/dashboard/${WS}/use-cases/${UC}?capitolo=cosa-serve`;

// ── Chi è il referente ──────────────────────────────────────────────

test("persona: solo un ruolo da revisore conta; il link alla scheda vuole anche l'email verificata uguale", () => {
  assert.deepEqual(referentPersonOf(null), NO_PERSON);
  assert.deepEqual(referentPersonOf({ userId: null, role: "function_lead", verifiedEmailMatch: true }), NO_PERSON, "senza account");
  for (const role of ["learner", "contributor", null, "qualcosa"]) {
    const p = referentPersonOf({ userId: USER, role, verifiedEmailMatch: true });
    assert.equal(p.userId, USER, String(role));
    assert.equal(p.reviewer, false, String(role));
    assert.equal(p.teamAccess, false, `${role}: mai link alla dashboard`);
  }
  for (const role of ["exec_sponsor", "transformation_lead", "function_lead", "analyst"]) {
    assert.deepEqual(referentPersonOf({ userId: USER.toUpperCase(), role, verifiedEmailMatch: true }), { userId: USER, reviewer: true, teamAccess: true, member: true, accountNotice: false }, role);
    assert.deepEqual(referentPersonOf({ userId: USER, role, verifiedEmailMatch: false }), { userId: USER, reviewer: true, teamAccess: false, member: true, accountNotice: false }, `${role} senza email uguale`);
  }
});

test("persona: chi chiede a se stesso", () => {
  const me = referentPersonOf({ userId: USER, role: "function_lead", verifiedEmailMatch: true });
  assert.equal(isSelfRequest(me, USER), true);
  assert.equal(isSelfRequest(me, USER.toUpperCase()), true);
  assert.equal(isSelfRequest(me, OTHER), false, "chiedere a un altro revisore si può");
  assert.equal(isSelfRequest(NO_PERSON, USER), false, "un referente senza account non è mai chi chiede");
  assert.equal(isSelfRequest(me, null), false);
});

test("persona: le righe del database", () => {
  assert.equal(personFactsOf(undefined), null);
  assert.deepEqual(personFactsOf({ user_id: USER.toUpperCase(), role: "analyst", email_match: true }), { userId: USER, role: "analyst", verifiedEmailMatch: true });
  assert.deepEqual(personFactsOf({ user_id: null, role: null, email_match: false }), { userId: null, role: null, verifiedEmailMatch: false });
  assert.deepEqual(personFactsOf({ user_id: "non-un-uuid", role: "", email_match: "f" }), { userId: null, role: null, verifiedEmailMatch: false });
});

test("persona: la SQL legge solo account, appartenenze e contatti; niente corsi, niente ordinamenti o conteggi per persona", () => {
  const people = contactPeopleSql(WS, [R1, R2]);
  const byEmail = emailPersonSql(WS, "Federico@TopJet.it");
  for (const s of [people, byEmail]) {
    assert.doesNotMatch(s.text, /learning_/i, "nessun dato dei corsi");
    assert.doesNotMatch(s.text, /\bORDER\s+BY\b|\bGROUP\s+BY\b|count\(/i);
    assert.match(s.text, /email_verified IS NOT NULL/);
    assert.match(s.text, /FROM memberships pm[\s\S]*workspace_memberships pwm/, "prima l'organizzazione, poi il workspace");
  }
  assert.match(people.text, /c\.user_id IS NOT NULL AND pu\.id = c\.user_id/, "il collegamento vince sull'email");
  assert.ok(byEmail.params.includes("Federico@TopJet.it"));
  assert.throws(() => contactPeopleSql("x", [R1]));
  assert.throws(() => contactPeopleSql(WS, ["x"]));
});

test("persona del referente di una richiesta (D-B21): la stessa regola di contactPeopleSql, letta nella SQL dell'evento", () => {
  const text = toStatement(ucSql`SELECT ${requestReferentUserSql("r")}`).text;
  assert.match(text, /rpc\.user_id IS NOT NULL AND rpu\.id = rpc\.user_id/, "il collegamento vince sull'email");
  assert.match(text, /rpc\.user_id IS NULL AND rpc\.email IS NOT NULL AND rpu\.email_verified IS NOT NULL/, "altrimenti la stessa email verificata");
  assert.match(text, /rpc\.id = r\.contact_id AND rpc\.workspace_id = r\.workspace_id/, "solo il contatto della richiesta, nel suo workspace");
  assert.doesNotMatch(text, /learning_|\bORDER\s+BY\b|\bGROUP\s+BY\b|count\(/i);
  for (const bad of ["r; DROP TABLE x", "R", "1r", ""]) assert.throws(() => requestReferentUserSql(bad), bad);
});

// ── Il link alla scheda ──────────────────────────────────────────────

test("link alla scheda: solo la forma di cardLink", () => {
  assert.equal(cardLink(ORIGIN, WS.toUpperCase(), UC), CARD);
  assert.equal(checkCardLink(CARD), CARD);
  assert.equal(checkCardLink(`http://localhost:3000/dashboard/${WS}/use-cases/${UC}?capitolo=cosa-serve`).startsWith("http://localhost:3000/"), true);
  for (const bad of [
    `http://app.example.test/dashboard/${WS}/use-cases/${UC}?capitolo=cosa-serve`,
    `${CARD}#x`,
    `${CARD}&utm=1`,
    `${ORIGIN}/dashboard/${WS}/use-cases/${UC}`,
    `${ORIGIN}/dashboard/${WS}/formazione?capitolo=cosa-serve`,
    `https://u:p@app.example.test/dashboard/${WS}/use-cases/${UC}?capitolo=cosa-serve`,
    LINK,
  ]) {
    assert.throws(() => checkCardLink(bad), bad);
  }
});

// ── Le email al referente ────────────────────────────────────────────

const EXPIRES = new Date("2026-11-26T10:00:00Z");
const richiesta = (cardLinkValue: string | null): ReferentEmailInput => ({
  template: "richiesta",
  company: "TopJet",
  useCase: { code: "TJ-0004", title: "Fatture fornitori" },
  requesterName: "Claudio Magnani",
  questions: 2,
  message: null,
  expiresAt: EXPIRES,
  link: LINK,
  replyToKnown: true,
  cardLink: cardLinkValue,
});

test("email: un referente revisore ha il link personale e in più la riga con il link alla scheda", () => {
  const withCard = renderReferentEmail(richiesta(CARD));
  assert.ok(withCard.text.includes(LINK), "il link personale resta");
  assert.ok(withCard.text.includes(TEAM_ACCESS_LINE));
  assert.ok(withCard.text.includes(CARD));
  assert.ok(withCard.html.includes(TEAM_ACCESS_LINK_LABEL));
  assert.ok(withCard.text.indexOf(LINK) < withCard.text.indexOf(CARD), "prima le domande, poi la scheda");
  const plain = renderReferentEmail(richiesta(null));
  assert.ok(!plain.text.includes("/dashboard/"), "nessun link alla dashboard per chi non è revisore");
  assert.ok(!plain.text.includes(TEAM_ACCESS_LINE));
  assert.throws(() => renderReferentEmail(richiesta(`${ORIGIN}/dashboard/${WS}/formazione`)), "un link diverso non entra nell'email");
});

test("email: promemoria a un referente revisore, uno e più use case", () => {
  const entry = (kind: "primo" | "ultimo" | "manuale" | "nuove", card: string | null) => ({
    useCase: { code: "TJ-0004", title: "Fatture fornitori" },
    requesterName: "Claudio Magnani",
    kind,
    openQuestions: 2,
    newQuestions: kind === "nuove" ? 1 : 0,
    expiresAt: EXPIRES,
    link: LINK,
    cardLink: card,
  });
  for (const kind of ["primo", "ultimo", "manuale", "nuove"] as const) {
    const one = renderReferentEmail({ template: "promemoria", company: "TopJet", entries: [entry(kind, CARD)], replyToKnown: true, replyName: "Claudio Magnani" });
    assert.ok(one.text.includes(TEAM_ACCESS_LINE) && one.text.includes(CARD), kind);
    const none = renderReferentEmail({ template: "promemoria", company: "TopJet", entries: [entry(kind, null)], replyToKnown: true, replyName: "Claudio Magnani" });
    assert.ok(!none.text.includes("/dashboard/"), kind);
  }
  const many = renderReferentEmail({ template: "promemoria", company: "TopJet", entries: [entry("primo", CARD), entry("ultimo", CARD)], replyToKnown: false, replyName: null });
  assert.ok(many.text.includes(TEAM_ACCESS_LINE_MANY));
  assert.equal(many.text.split(CARD).length - 1 >= 2, true, "un link alla scheda per voce");
});

// ── Il piano dell'invio ──────────────────────────────────────────────

function claimed(over: Partial<ClaimedReferentEmail> = {}): ClaimedReferentEmail {
  return { id: "e1", workspaceId: WS, contactId: "c1", requestId: R1, template: "richiesta", attempts: 0, dedupeKey: `ric:${R1}:1`, dueAt: NOW, ...over };
}
function req(over: Partial<ReferentRequestFacts> = {}): ReferentRequestFacts {
  return {
    id: R1,
    useCaseId: UC,
    useCase: { code: "TJ-0004", title: "Fatture fornitori" },
    status: "inviata",
    live: true,
    expiresAt: new Date(NOW.getTime() + 20 * 86_400_000),
    sentAt: romeLocalToUtc("2026-11-02", 10),
    reminderCount: 0,
    lastEmailAt: romeLocalToUtc("2026-11-02", 10),
    message: null,
    requesterName: "Claudio Magnani",
    requesterUserId: OTHER,
    openItems: 2,
    newQuestions: 0,
    item: null,
    ...over,
  };
}
function facts(teamAccess: boolean | undefined, requests = [req()]): ReferentDeliveryFacts {
  return {
    company: "TopJet",
    featureOn: true,
    subprocessorsAuthorized: true,
    recipient: { email: "federico@topjet.test", active: true, anonymized: false, linkedUserIsLateralSpace: false, teamAccess },
    replyTo: "claudio@topjet.test",
    requests,
    contactRemindedToday: false,
  };
}
const links = { [R1]: LINK, [R2]: LINK };

test("piano: il link alla scheda solo con teamAccess, l'origine pubblica e lo use case", () => {
  const send = (f: ReferentDeliveryFacts, origin: string | null = ORIGIN, e = claimed()) => {
    const plan = planReferentDelivery(e, f, { lsDomains: [], now: NOW, origin: origin ?? undefined });
    assert.equal(plan.action, "send");
    return plan.action === "send" ? plan.build(links) : null;
  };
  const yes = send(facts(true));
  assert.equal(yes?.template === "richiesta" ? yes.cardLink : "x", CARD);
  for (const [label, input] of [
    ["senza teamAccess", send(facts(false))],
    ["teamAccess assente", send(facts(undefined))],
    ["senza origine", send(facts(true), null)],
    ["senza use case", send(facts(true, [req({ useCaseId: undefined })]))],
  ] as const) {
    assert.equal(input?.template === "richiesta" ? (input.cardLink ?? null) : "x", null, label);
  }
  const reminder = send(
    facts(true, [req({ item: { kind: "primo", alreadySent: false } }), req({ id: R2, useCaseId: UC, item: { kind: "primo", alreadySent: false } })]),
    ORIGIN,
    claimed({ template: "promemoria", requestId: null, dedupeKey: "pa:c1:2026-11-05" }),
  );
  assert.ok(reminder?.template === "promemoria" && reminder.entries.every((e) => e.cardLink === CARD));
});

// ── La domanda «gestita» dal team ────────────────────────────────────

test("stato: una domanda aperta su un'esigenza già data da altri è «gestita», non aperta", () => {
  const base = { state: "aperta" as const, needArchived: false, linked: true };
  for (const needStatus of HANDLED_NEED_STATUSES) {
    assert.equal(itemHandledByTeam({ ...base, needStatus }), true, needStatus);
    assert.equal(itemIsOpen({ ...base, needStatus }), false, needStatus);
  }
  assert.deepEqual([...HANDLED_NEED_STATUSES], ["in_verifica", "validata"]);
  // Portata a mano a un altro stato: la domanda è ritirata, non «gestita» (come nella Parte 1).
  for (const needStatus of ["da_chiedere", "chiesta", "mancante", "parziale", "bloccata", "non_applicabile"] as const) assert.equal(itemHandledByTeam({ ...base, needStatus }), false, needStatus);
  assert.equal(itemHandledByTeam({ ...base, needStatus: "validata", state: "risposta" }), false, "una risposta del referente resta sua");
  assert.equal(itemHandledByTeam({ ...base, needStatus: "validata", needArchived: true }), false);
  assert.equal(itemHandledByTeam({ ...base, needStatus: "validata", linked: false }), false);
});

function item(over: Partial<PublicItemRow>): PublicItemRow {
  return { needId: R1, position: 1, question: "Ogni quanto fate questo lavoro?", state: "aperta", open: true, visible: true, draft: null, answer: null, files: [], ...over };
}
function rows(items: PublicItemRow[], status: PublicRows["request"]["status"] = "inviata"): PublicRows {
  return {
    request: { status, expiresAt: EXPIRES, privacyAcceptedAt: NOW, privacyNoticeVersion: "x", requesterName: "Claudio Magnani", message: null },
    company: "TopJet",
    useCase: { code: "TJ-0004", title: "Fatture fornitori" },
    items,
    privacyContact: "privacy@example.test",
    clientMode: false,
  };
}

test("pagina pubblica: «gestita» si vede senza bozza, risposta o file; mai cosa hanno scritto gli altri", () => {
  const handled = item({
    needId: R2,
    position: 2,
    open: false,
    handled: true,
    draft: { body: "BOZZA-DEL-REFERENTE", dontKnow: false, updatedAt: NOW },
    files: [{ id: "f1", fileName: "bozza.pdf", sizeBytes: 10, scanStatus: "pulito", message: null, personalWarning: false, warningConfirmed: false, submitted: false }],
  });
  const view = toPublicView(rows([item({}), handled]));
  assert.equal(view.state, "aperta");
  const q = view.questions.find((x) => x.needId === R2)!;
  assert.deepEqual(q, { needId: R2, position: 2, title: "Ogni quanto fate questo lavoro?", state: "gestita", draft: null, answer: null, files: [] });
  assert.ok(!JSON.stringify(view).includes("BOZZA-DEL-REFERENTE"));
  // Un'esigenza tornata indietro a mano è ritirata: non si vede.
  const withdrawn = toPublicView(rows([item({}), item({ needId: R2, position: 2, open: false, handled: false })]));
  assert.equal(withdrawn.questions.length, 1);
});

test("pagina pubblica: tutto fatto dal team → «vuota», mai «Hai risposto a tutte le domande»", () => {
  const allTeam = [item({ open: false, handled: true }), item({ needId: R2, position: 2, open: false, handled: true })];
  assert.equal(toPublicView(rows(allTeam, "completata")).state, "vuota");
  assert.equal(toPublicView(rows(allTeam, "inviata")).state, "vuota");
  const mixed = [item({ open: false, state: "risposta", answer: { body: "20 al giorno", dontKnow: false, submittedAt: NOW } }), item({ needId: R2, position: 2, open: false, handled: true })];
  assert.equal(toPublicView(rows(mixed, "completata")).state, "completata");
  // Come prima della Parte 3: una richiesta completata senza domande da mostrare resta «completata».
  assert.equal(toPublicView(rows([], "completata")).state, "completata");
  assert.equal(toPublicView(rows([], "inviata")).state, "vuota");
});

// ── I testi ──────────────────────────────────────────────────────────

test("testi della Parte 3: italiano semplice, «use case», nessuna parola tecnica, nessun corso", () => {
  const texts = [
    REFERENT_UI_TEXT.askDialog.suffix.sei_tu,
    REFERENT_UI_TEXT.askDialog.teamTag,
    REFERENT_UI_TEXT.askDialog.selfHint,
    REFERENT_PUBLIC_TEXT.handledByTeam,
    REFERENT_ERROR_MESSAGES.referente_sei_tu,
    TEAM_ACCESS_LINE,
    TEAM_ACCESS_LINE_MANY,
    TEAM_ACCESS_LINK_LABEL,
  ];
  assert.deepEqual(
    [REFERENT_UI_TEXT.askDialog.suffix.sei_tu, REFERENT_UI_TEXT.askDialog.teamTag, REFERENT_PUBLIC_TEXT.handledByTeam, TEAM_ACCESS_LINE],
    ["(sei tu)", "Fa parte del team", "Non serve più: ci ha già pensato il team.", "Hai già accesso a Unbundle: puoi rispondere anche dalla scheda."],
  );
  for (const t of texts) {
    assert.deepEqual(findHubForbidden(t, "area"), [], t);
    assert.doesNotMatch(t, /\b(token|MCP|workflow)\b/i, t);
    assert.doesNotMatch(t, /cors[oi]|formazione|partecipant/i, `${t}: nessun riferimento ai corsi`);
  }
});
