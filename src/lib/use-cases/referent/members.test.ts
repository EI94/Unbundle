import test from "node:test";
import assert from "node:assert/strict";
import { romeLocalToUtc } from "../../uc/calendar.ts";
import { findHubForbidden } from "../copy-guard.ts";
import { planReferentDelivery, type ClaimedReferentEmail, type ReferentDeliveryFacts, type ReferentRequestFacts } from "./dispatch.ts";
import { ACCOUNT_NOTICE_LINE, ACCOUNT_NOTICE_LINE_MANY, TEAM_ACCESS_LINE, renderReferentEmail, type ReminderEntry } from "./email.ts";
import { REFERENT_UI_TEXT } from "./labels.ts";
import {
  NO_PERSON,
  canSeeWorkspacePeople,
  isPickableMemberRole,
  linkNewContactUserSql,
  memberDisplayName,
  memberFactsOf,
  pickerMembersOf,
  referentPersonOf,
  relinkCorrectedContactSql,
  workspaceMembersSql,
  type WorkspaceMemberFacts,
} from "./people.ts";

// Referente già iscritto (27/10): il referente può avere già un account Unbundle (per esempio ha
// partecipato a una formazione). Risponde sempre dal link, senza entrare; il selettore propone le
// persone del workspace che chi guarda vede già; l'email dice che è stato indicato come referente.
const WS = "5e1a0000-0000-4000-8000-0000000000a1";
const UC = "5e1a0000-0000-4000-8000-0000000000b1";
const R1 = "5e1a0000-0000-4000-8000-0000000000d1";
const R2 = "5e1a0000-0000-4000-8000-0000000000d2";
const ME = "5e1a0000-0000-4000-8000-0000000000e1";
const ANNA = "5e1a0000-0000-4000-8000-0000000000e2";
const BRUNO = "5e1a0000-0000-4000-8000-0000000000e3";
const CARLA = "5e1a0000-0000-4000-8000-0000000000e4";
const LS = "5e1a0000-0000-4000-8000-0000000000e5";
const NOW = romeLocalToUtc("2026-11-05", 10);
const ORIGIN = "https://app.example.test";
const LINK = `${ORIGIN}/rispondi/ucq_${"A".repeat(32)}`;
const LINK2 = `${ORIGIN}/rispondi/ucq_${"B".repeat(32)}`;
const EXPIRES = new Date("2026-11-26T10:00:00Z");
const UCREF = { code: "TJ-0004", title: "Fatture fornitori" };

// ── Chi ha già un account ────────────────────────────────────────────

test("persona: «Hai già un account» solo per un membro che non è revisore, con l'email verificata uguale", () => {
  for (const role of ["learner", "contributor"]) {
    assert.deepEqual(referentPersonOf({ userId: ANNA, role, verifiedEmailMatch: true }), { userId: ANNA, reviewer: false, teamAccess: false, member: true, accountNotice: true }, role);
    assert.equal(referentPersonOf({ userId: ANNA, role, verifiedEmailMatch: false }).accountNotice, false, `${role}: email diversa`);
  }
  for (const role of ["exec_sponsor", "transformation_lead", "function_lead", "analyst"]) {
    const p = referentPersonOf({ userId: ANNA, role, verifiedEmailMatch: true });
    assert.deepEqual([p.teamAccess, p.accountNotice], [true, false], `${role}: la riga del team, non quella dell'account`);
  }
  assert.equal(referentPersonOf({ userId: ANNA, role: null, verifiedEmailMatch: true }).accountNotice, false, "un account fuori dal workspace non è un membro");
  assert.deepEqual(NO_PERSON, { userId: null, reviewer: false, teamAccess: false, member: false, accountNotice: false });
});

test("chi vede le persone del workspace: ogni ruolo tranne i partecipanti ai corsi (come Impostazioni › Persone)", () => {
  for (const role of ["exec_sponsor", "transformation_lead", "function_lead", "analyst", "contributor"]) assert.equal(canSeeWorkspacePeople(role), true, role);
  for (const role of ["learner", null, undefined, ""]) assert.equal(canSeeWorkspacePeople(role), false, String(role));
});

// ── Le persone del selettore ─────────────────────────────────────────

test("la SQL delle persone: account verificati del workspace, niente partecipanti ai corsi, niente dati dei corsi, nessun ordinamento", () => {
  const all = workspaceMembersSql(WS);
  const one = workspaceMembersSql(WS, ANNA.toUpperCase());
  for (const s of [all, one]) {
    assert.doesNotMatch(s.text, /learning_/i, "nessun dato dei corsi");
    assert.doesNotMatch(s.text, /\bORDER\s+BY\b|\bGROUP\s+BY\b|count\(/i);
    assert.match(s.text, /email_verified IS NOT NULL/);
    assert.match(s.text, /m\.role <> 'learner'/);
    assert.match(s.text, /FROM memberships pm[\s\S]*workspace_memberships pwm/, "il ruolo: prima l'organizzazione, poi il workspace");
  }
  assert.ok(one.params.includes(ANNA), "una sola persona, id in minuscolo");
  assert.throws(() => workspaceMembersSql("x"));
  assert.throws(() => workspaceMembersSql(WS, "non-un-uuid"));
});

test("le righe delle persone: id e email puliti, mai un partecipante ai corsi", () => {
  assert.deepEqual(memberFactsOf({ user_id: ANNA.toUpperCase(), name: "  Anna   Verdi ", email: " Anna@TopJet.test ", role: "contributor" }), { userId: ANNA, name: "Anna Verdi", email: "anna@topjet.test", role: "contributor" });
  assert.equal(memberFactsOf({ user_id: ANNA, name: "Anna", email: "anna@topjet.test", role: "learner" }), null);
  assert.equal(memberFactsOf({ user_id: "x", name: "Anna", email: "anna@topjet.test", role: "contributor" }), null);
  assert.equal(memberFactsOf({ user_id: ANNA, name: "Anna", email: "senza-chiocciola", role: "contributor" }), null);
  assert.equal(memberFactsOf(undefined), null);
  assert.equal(memberDisplayName({ name: "Anna Verdi", email: "anna@topjet.test" }), "Anna Verdi");
  assert.equal(memberDisplayName({ name: null, email: "anna.verdi@topjet.test" }), "anna.verdi", "senza nome: la parte prima della chiocciola");
  assert.equal(memberDisplayName({ name: "A", email: "x@topjet.test" }), "x@topjet.test");
});

const member = (userId: string, name: string, email: string, role = "contributor"): WorkspaceMemberFacts => ({ userId, name, email, role });

test("selettore: una voce per persona, mai chi guarda, mai Lateral Space, in ordine alfabetico, solo «Fa parte del team» in più", () => {
  const members = [
    member(CARLA, "carla Neri", "carla@topjet.test", "function_lead"),
    member(ME, "Giulia Neri", "giulia@topjet.test", "function_lead"),
    member(BRUNO, "Bruno Bianchi", "bruno@topjet.test"),
    member(ANNA, "Anna Verdi", "anna@topjet.test", "analyst"),
    member(LS, "Pier Lateral", "pier@ls.test", "transformation_lead"),
    member(BRUNO, "Bruno Bianchi", "bruno@topjet.test"),
  ];
  const isLs = (m: WorkspaceMemberFacts) => m.email.endsWith("@ls.test");
  const none = { contactEmails: new Set<string>(), contactUserIds: new Set<string>() };
  const out = pickerMembersOf(members, { viewerUserId: ME.toUpperCase(), dedupe: none, isLateralSpace: isLs });
  assert.deepEqual(
    out.map((m) => [m.displayName, m.team]),
    [
      ["Anna Verdi", true],
      ["Bruno Bianchi", false],
      ["carla Neri", true],
    ],
  );
  // Chi è già un referente (per email o per account) non ha una seconda voce: si sceglie il referente.
  const deduped = pickerMembersOf(members, {
    viewerUserId: ME,
    dedupe: { contactEmails: new Set(["anna@topjet.test"]), contactUserIds: new Set([CARLA]) },
    isLateralSpace: isLs,
  });
  assert.deepEqual(deduped.map((m) => m.userId), [BRUNO]);
  for (const m of out) assert.deepEqual(Object.keys(m).sort(), ["displayName", "email", "team", "userId"], "nessun ruolo, nessun conteggio");
});

// ── (Rilascio 4) I partecipanti ai corsi del workspace nel selettore ──────

const OLD_LAST = "WHERE m.role IS NOT NULL AND m.role <> 'learner'";
const LEARNERS_LAST = `WHERE m.role IS NOT NULL AND (m.role <> 'learner' OR EXISTS (
  SELECT 1 FROM workspace_memberships lwm
  WHERE lwm.workspace_id = $N::uuid AND lwm.user_id = m.user_id::uuid AND lwm.role = 'learner'))`;

test("la SQL senza l'opzione è quella di prima, parola per parola; con l'opzione cambia solo l'ultima condizione", () => {
  for (const userId of [null, ANNA]) {
    const before = workspaceMembersSql(WS, userId);
    for (const o of [{}, { learners: false }]) {
      const same = workspaceMembersSql(WS, userId, o);
      assert.equal(same.text, before.text);
      assert.deepEqual(same.params, before.params);
    }
    assert.ok(before.text.endsWith(`) m\n${OLD_LAST}`), "l'ultima riga di sempre");
    const learners = workspaceMembersSql(WS, userId, { learners: true });
    const n = before.params.length + 1;
    assert.equal(learners.text, before.text.slice(0, -OLD_LAST.length) + LEARNERS_LAST.replace("$N", `$${n}`));
    assert.deepEqual(learners.params, [...before.params, WS], "il workspace è un parametro legato, non `pw0`");
  }
});

test("la SQL con i partecipanti ai corsi: solo una riga «learner» di questo workspace, niente dei corsi, nessun ordinamento", () => {
  const s = workspaceMembersSql(WS, null, { learners: true });
  assert.doesNotMatch(s.text, /learning_/i, "nessuna tabella dei corsi");
  assert.doesNotMatch(s.text, /\bORDER\s+BY\b|\bGROUP\s+BY\b|count\(/i);
  assert.match(s.text, /email_verified IS NOT NULL/);
  assert.match(s.text, /EXISTS \(\s*SELECT 1 FROM workspace_memberships lwm\s+WHERE lwm\.workspace_id = \$\d+::uuid AND lwm\.user_id = m\.user_id::uuid AND lwm\.role = 'learner'\)/);
  // `pw0` vive solo dentro la tabella derivata `m`: dopo «) m» non compare più.
  const outer = s.text.slice(s.text.lastIndexOf(") m\n"));
  assert.doesNotMatch(outer, /\bpw0\b/);
  assert.doesNotMatch(outer, /\bmemberships om\b/, "il ruolo dell'organizzazione non basta");
});

test("le righe con i partecipanti ai corsi: il ruolo «learner» entra solo con l'opzione; chi guarda resta fuori", () => {
  const row = { user_id: ANNA, name: "Anna Verdi", email: "anna@topjet.test", role: "learner" };
  assert.equal(memberFactsOf(row), null);
  assert.equal(memberFactsOf(row, { learners: false }), null);
  assert.deepEqual(memberFactsOf(row, { learners: true }), { userId: ANNA, name: "Anna Verdi", email: "anna@topjet.test", role: "learner" });
  assert.equal(memberFactsOf({ ...row, role: "" }, { learners: true }), null, "senza ruolo mai");
  assert.equal(memberFactsOf({ ...row, role: null }, { learners: true }), null);
  for (const role of ["learner", "contributor", "function_lead"]) assert.equal(isPickableMemberRole(role), true, role);
  for (const role of [null, undefined, ""]) assert.equal(isPickableMemberRole(role), false, String(role));
  // Chi guarda non diventa mai «chi vede le persone» perché partecipa a un corso.
  assert.equal(canSeeWorkspacePeople("learner"), false);
  const members = [member(ANNA, "Anna Verdi", "anna@topjet.test", "learner"), member(BRUNO, "Bruno Bianchi", "bruno@topjet.test", "function_lead"), member(CARLA, "Carla Neri", "carla@ls.test", "learner")];
  const none = { contactEmails: new Set<string>(), contactUserIds: new Set<string>() };
  const isLs = (m: WorkspaceMemberFacts) => m.email.endsWith("@ls.test");
  assert.deepEqual(pickerMembersOf(members, { viewerUserId: ME, dedupe: none, isLateralSpace: isLs }).map((m) => m.userId), [BRUNO], "senza l'opzione come prima");
  const withLearners = pickerMembersOf(members, { viewerUserId: ME, dedupe: none, isLateralSpace: isLs, learners: true });
  assert.deepEqual(withLearners.map((m) => [m.displayName, m.team]), [["Anna Verdi", false], ["Bruno Bianchi", true]], "nello stesso elenco, alfabetico; Lateral Space mai");
  for (const m of withLearners) assert.deepEqual(Object.keys(m).sort(), ["displayName", "email", "team", "userId"], "niente che distingua un partecipante");
  // Un partecipante già referente (per email o per account) non ha una seconda voce; chi guarda mai.
  assert.deepEqual(pickerMembersOf(members, { viewerUserId: ANNA, dedupe: none, isLateralSpace: isLs, learners: true }).map((m) => m.userId), [BRUNO]);
  assert.deepEqual(pickerMembersOf(members, { viewerUserId: ME, dedupe: { contactEmails: new Set(["anna@topjet.test"]), contactUserIds: new Set() }, isLateralSpace: isLs, learners: true }).map((m) => m.userId), [BRUNO]);
});

// ── Il collegamento all'account ──────────────────────────────────────

test("collegamento: solo un contatto nuovo senza account, solo con la stessa email verificata, dentro la SQL", () => {
  const link = linkNewContactUserSql(WS, R1, ANNA);
  assert.match(link.text, /c\.user_id IS NULL AND c\.anonymized_at IS NULL/);
  assert.match(link.text, /lu\.email_verified IS NOT NULL AND lower\(btrim\(lu\.email\)\) = lower\(btrim\(c\.email\)\)/);
  assert.doesNotMatch(link.text, /learning_|\bORDER\s+BY\b/i);
  const relink = relinkCorrectedContactSql(WS, R1);
  assert.match(relink.text, /ru\.email_verified IS NOT NULL/);
  assert.match(relink.text, /IS NOT NULL\s+LIMIT 1/, "solo un membro del workspace; altrimenti NULL");
  assert.throws(() => linkNewContactUserSql(WS, R1, "x"));
});

// ── Le email ─────────────────────────────────────────────────────────

const richiesta = (over: Partial<{ accountNotice: boolean; cardLink: string | null; questions: number; title: string }> = {}) =>
  renderReferentEmail({
    template: "richiesta",
    company: "TopJet",
    useCase: { code: "TJ-0004", title: over.title ?? UCREF.title },
    requesterName: "Fabio Esempio",
    questions: over.questions ?? 2,
    message: null,
    expiresAt: EXPIRES,
    link: LINK,
    replyToKnown: true,
    cardLink: over.cardLink ?? null,
    accountNotice: over.accountNotice,
  });

test("richiesta di sole domande: dice chi chiede e su quale caso d'uso; il link, i 30 giorni e il piè di pagina restano", () => {
  const m = richiesta();
  assert.equal(m.subject, "TopJet: alcune domande sul caso d'uso «TJ-0004 · Fatture fornitori»");
  const lines = m.text.split("\n").map((l) => l.trim()).filter(Boolean);
  assert.equal(lines[0], "Buongiorno,");
  assert.equal(lines[1], "Fabio Esempio ti chiede alcune informazioni sul caso d'uso «TJ-0004 · Fatture fornitori».");
  assert.ok(m.text.includes("Le domande sono 2."));
  assert.ok(richiesta({ questions: 1 }).text.includes("È una domanda sola."));
  assert.ok(m.text.includes(LINK) && m.text.includes("Il link scade il 26 novembre 2026.") && m.text.includes("Lateral Space via Unbundle."));
  assert.ok(!m.text.includes(ACCOUNT_NOTICE_LINE) && !m.text.includes(TEAM_ACCESS_LINE), "senza account nel workspace: nessuna delle due righe");
  assert.ok(richiesta({ title: "x".repeat(400) }).subject.length <= 200, "l'oggetto resta entro 200 caratteri");
  // (Rilascio 5.1) Fuori dalla dashboard «caso d'uso», mai «use case».
  for (const part of [m.subject, m.text, m.html]) assert.doesNotMatch(part, /\buse[\s-]*cases?\b|\bwave\b|\btoken\b|\bMCP\b|\bworkflow\b/i);
});

test("richiesta a chi ha già un account (corsista, contributore): la riga, mai un link alla dashboard", () => {
  const m = richiesta({ accountNotice: true });
  assert.ok(m.text.includes(ACCOUNT_NOTICE_LINE));
  assert.ok(m.text.indexOf("Il link scade il") < m.text.indexOf(ACCOUNT_NOTICE_LINE), "dopo la scadenza del link");
  assert.ok(!m.text.includes("/dashboard/") && !m.html.includes("/dashboard/"));
  assert.ok(!m.text.includes(TEAM_ACCESS_LINE));
  // Un revisore ha la sua riga con il link alla scheda, non questa.
  const card = `${ORIGIN}/dashboard/${WS}/use-cases/${UC}?capitolo=cosa-serve`;
  const reviewer = richiesta({ accountNotice: true, cardLink: card });
  assert.ok(reviewer.text.includes(TEAM_ACCESS_LINE) && !reviewer.text.includes(ACCOUNT_NOTICE_LINE));
});

const entry = (kind: ReminderEntry["kind"], link = LINK): ReminderEntry => ({
  useCase: UCREF,
  requesterName: "Fabio Esempio",
  kind,
  openQuestions: 1,
  newQuestions: 1,
  expiresAt: EXPIRES,
  link,
});

test("promemoria: la stessa riga per chi ha già un account, con una o più voci; mai un link alla dashboard", () => {
  for (const kind of ["primo", "ultimo", "manuale", "nuove"] as const) {
    const one = renderReferentEmail({ template: "promemoria", company: "TopJet", entries: [entry(kind)], replyToKnown: false, replyName: null, accountNotice: true });
    assert.ok(one.text.includes(ACCOUNT_NOTICE_LINE), kind);
    assert.ok(!one.text.includes("/dashboard/"), kind);
    const plain = renderReferentEmail({ template: "promemoria", company: "TopJet", entries: [entry(kind)], replyToKnown: false, replyName: null });
    assert.ok(!plain.text.includes(ACCOUNT_NOTICE_LINE), kind);
  }
  const many = renderReferentEmail({ template: "promemoria", company: "TopJet", entries: [entry("primo"), entry("ultimo", LINK2)], replyToKnown: false, replyName: null, accountNotice: true });
  assert.ok(many.text.includes(ACCOUNT_NOTICE_LINE_MANY));
  assert.ok(!many.text.includes("/dashboard/"));
});

// ── Il piano dell'invio ──────────────────────────────────────────────

const claimed = (over: Partial<ClaimedReferentEmail> = {}): ClaimedReferentEmail => ({
  id: "e1",
  workspaceId: WS,
  contactId: "c1",
  requestId: R1,
  template: "richiesta",
  attempts: 0,
  dedupeKey: `ric:${R1}:1`,
  dueAt: NOW,
  ...over,
});
const req = (over: Partial<ReferentRequestFacts> = {}): ReferentRequestFacts => ({
  id: R1,
  useCaseId: UC,
  useCase: UCREF,
  status: "inviata",
  live: true,
  expiresAt: new Date(NOW.getTime() + 20 * 86_400_000),
  sentAt: romeLocalToUtc("2026-11-02", 10),
  reminderCount: 0,
  lastEmailAt: romeLocalToUtc("2026-11-02", 10),
  message: null,
  requesterName: "Fabio Esempio",
  requesterUserId: ME,
  openItems: 2,
  newQuestions: 0,
  item: null,
  ...over,
});
const facts = (recipient: { accountNotice?: boolean; teamAccess?: boolean }, requests = [req()]): ReferentDeliveryFacts => ({
  company: "TopJet",
  featureOn: true,
  subprocessorsAuthorized: true,
  recipient: { email: "anna@topjet.test", active: true, anonymized: false, linkedUserIsLateralSpace: false, ...recipient },
  replyTo: "federico@topjet.test",
  requests,
  contactRemindedToday: false,
});

test("piano: la riga dell'account solo con il fatto riletto all'invio, mai insieme a quella del team", () => {
  const build = (f: ReferentDeliveryFacts, e = claimed()) => {
    const plan = planReferentDelivery(e, f, { lsDomains: [], now: NOW, origin: ORIGIN });
    assert.equal(plan.action, "send");
    return plan.action === "send" ? plan.build({ [R1]: LINK, [R2]: LINK2 }) : null;
  };
  const yes = build(facts({ accountNotice: true }));
  assert.equal(yes?.template === "richiesta" ? yes.accountNotice : "x", true);
  for (const [label, f] of [
    ["senza account", facts({})],
    ["revisore", facts({ accountNotice: true, teamAccess: true })],
    ["falso", facts({ accountNotice: false })],
  ] as const) {
    const input = build(f);
    assert.equal(input?.template === "richiesta" ? input.accountNotice : "x", false, label);
  }
  const reminder = build(
    facts({ accountNotice: true }, [req({ item: { kind: "primo", alreadySent: false } }), req({ id: R2, item: { kind: "primo", alreadySent: false } })]),
    claimed({ template: "promemoria", requestId: null, dedupeKey: "pa:c1:2026-11-05" }),
  );
  assert.ok(reminder?.template === "promemoria" && reminder.accountNotice === true && reminder.entries.every((e) => !e.cardLink));
});

// ── I testi ──────────────────────────────────────────────────────────

test("testi: italiano semplice, «use case», nessuna parola tecnica, niente dei corsi", () => {
  const texts = [ACCOUNT_NOTICE_LINE, ACCOUNT_NOTICE_LINE_MANY, REFERENT_UI_TEXT.askDialog.contactsGroup, REFERENT_UI_TEXT.askDialog.membersGroup];
  assert.equal(ACCOUNT_NOTICE_LINE, "Hai già un account Unbundle: per rispondere non serve entrare, basta questo link.");
  for (const t of texts) {
    assert.deepEqual(findHubForbidden(t, "area"), [], t);
    assert.doesNotMatch(t, /\b(token|MCP|workflow|wave)\b|caso d'uso/i, t);
    assert.doesNotMatch(t, /cors[oi]|formazione|partecipant|learner/i, `${t}: nessun riferimento ai corsi`);
  }
});
