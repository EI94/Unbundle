import test from "node:test";
import assert from "node:assert/strict";
import { romeLocalToUtc } from "../../uc/calendar.ts";
import { RATE_LIMIT_CODE, type MailResult, type OutgoingEmail, type UcMailer } from "../../uc/notify/dispatch.ts";
import {
  planReferentDelivery,
  runReferentDispatch,
  type ClaimedReferentEmail,
  type ReferentDeliveryFacts,
  type ReferentDispatchStore,
  type ReferentRequestFacts,
  type ReferentSendEffect,
} from "./dispatch.ts";
import { recipientHash } from "./tokens.ts";

// L'invio delle email di «Chiedi al referente» con uno store e un mailer finti (SPEC §3.6).
const ENV = { RESEND_API_KEY: "re_test", UC_EMAIL_FROM: "Lateral Space via Unbundle <test@example.test>", NEXT_PUBLIC_APP_URL: "http://localhost:3000" };
const LS = ["lateralspace.example"];
const NOW = romeLocalToUtc("2026-11-05", 10);
const WS = "3f2a9c1e-0000-4000-8000-0000000000a1";
const R1 = "3f2a9c1e-0000-4000-8000-0000000000d1";
const R2 = "3f2a9c1e-0000-4000-8000-0000000000d2";
const R3 = "3f2a9c1e-0000-4000-8000-0000000000d3";
const USER_A = "3f2a9c1e-0000-4000-8000-0000000000aa";
const USER_B = "3f2a9c1e-0000-4000-8000-0000000000ab";

function email(over: Partial<ClaimedReferentEmail> = {}): ClaimedReferentEmail {
  return { id: "e1", workspaceId: WS, contactId: "c1", requestId: R1, template: "richiesta", attempts: 0, dedupeKey: `ric:${R1}:1`, dueAt: NOW, ...over };
}

function request(over: Partial<ReferentRequestFacts> = {}): ReferentRequestFacts {
  return {
    id: R1,
    useCase: { code: "TJ-0004", title: "Fatture fornitori" },
    status: "inviata",
    live: true,
    expiresAt: new Date(NOW.getTime() + 20 * 86_400_000),
    sentAt: romeLocalToUtc("2026-11-02", 10),
    reminderCount: 0,
    lastEmailAt: romeLocalToUtc("2026-11-02", 10),
    message: null,
    requesterName: "Giulia Neri",
    requesterUserId: USER_A,
    openItems: 2,
    newQuestions: 0,
    item: null,
    ...over,
  };
}

function facts(over: Partial<ReferentDeliveryFacts> = {}): ReferentDeliveryFacts {
  return {
    company: "TopJet",
    featureOn: true,
    subprocessorsAuthorized: true,
    recipient: { email: " Mario.Rossi@TopJet.it ", active: true, anonymized: false, linkedUserIsLateralSpace: false },
    replyTo: "Giulia.Neri@TopJet.it",
    requests: [request()],
    contactRemindedToday: false,
    ...over,
  };
}

const plan = (e: ClaimedReferentEmail, f: ReferentDeliveryFacts) => planReferentDelivery(e, f, { lsDomains: LS, now: NOW });

test("piano: senza autorizzazione ai fornitori ogni email aspetta; funzione spenta aspetta", () => {
  for (const template of ["richiesta", "promemoria", "conferma"] as const) {
    assert.deepEqual(plan(email({ template }), facts({ subprocessorsAuthorized: false })), { action: "hold", reason: "sub_responsabili_mancanti" });
  }
  assert.deepEqual(plan(email(), facts({ featureOn: false })), { action: "hold", reason: "funzione_spenta" });
});

test("piano: destinatario non raggiungibile o di Lateral Space → annullata", () => {
  assert.deepEqual(plan(email(), facts({ recipient: null })), { action: "cancel", reason: "destinatario_non_raggiungibile" });
  assert.deepEqual(plan(email(), facts({ recipient: { email: "x@topjet.it", active: false, anonymized: false, linkedUserIsLateralSpace: false } })), { action: "cancel", reason: "destinatario_non_raggiungibile" });
  assert.deepEqual(plan(email(), facts({ recipient: { email: "x@topjet.it", active: true, anonymized: true, linkedUserIsLateralSpace: false } })), { action: "cancel", reason: "destinatario_non_raggiungibile" });
  assert.deepEqual(plan(email(), facts({ recipient: { email: "Mario <x@topjet.it>", active: true, anonymized: false, linkedUserIsLateralSpace: false } })), { action: "cancel", reason: "destinatario_non_raggiungibile" });
  assert.deepEqual(plan(email(), facts({ recipient: { email: "x@lateralspace.example", active: true, anonymized: false, linkedUserIsLateralSpace: false } })), { action: "cancel", reason: "destinatario_lateral_space" });
  assert.deepEqual(plan(email(), facts({ recipient: { email: "x@topjet.it", active: true, anonymized: false, linkedUserIsLateralSpace: true } })), { action: "cancel", reason: "destinatario_lateral_space" });
});

test("piano: richiesta viva con domande aperte; indirizzi in minuscolo; replyTo solo se c'è", () => {
  const p = plan(email(), facts());
  assert.equal(p.action, "send");
  if (p.action !== "send") return;
  assert.equal(p.to, "mario.rossi@topjet.it");
  assert.equal(p.replyTo, "giulia.neri@topjet.it");
  assert.deepEqual(p.links, [{ requestId: R1, issuedFor: "richiesta" }]);
  assert.deepEqual(p.after, [{ requestId: R1, reminder: null, first: true, manual: false }]);
  const input = p.build({ [R1]: "http://localhost:3000/rispondi/ucq_" + "A".repeat(32) });
  assert.equal(input.template, "richiesta");
  if (input.template === "richiesta") assert.equal(input.replyToKnown, true);
  const none = plan(email(), facts({ replyTo: null }));
  assert.ok(none.action === "send" && none.replyTo === null);
  assert.deepEqual(plan(email(), facts({ requests: [request({ live: false })] })), { action: "cancel", reason: "richiesta_non_viva" });
  assert.deepEqual(plan(email(), facts({ requests: [request({ openItems: 0 })] })), { action: "cancel", reason: "nessuna_domanda_aperta" });
});

test("piano: conferma per richieste inviate o completate non scadute, senza link", () => {
  const p = plan(email({ template: "conferma" }), facts({ requests: [request({ status: "completata", live: false, answeredToday: 3 })] }));
  assert.equal(p.action, "send");
  if (p.action === "send") {
    assert.deepEqual(p.links, []);
    const input = p.build({});
    assert.ok(input.template === "conferma" && input.submitted === 3 && input.openQuestions === 0);
  }
  assert.deepEqual(plan(email({ template: "conferma" }), facts({ requests: [request({ status: "revocata", live: false })] })), { action: "cancel", reason: "richiesta_non_viva" });
  assert.deepEqual(plan(email({ template: "conferma" }), facts({ requests: [request({ expiresAt: new Date(NOW.getTime() - 1) })] })), { action: "cancel", reason: "richiesta_non_viva" });
});

test("piano: promemoria — voci tolte una per una, una persona al giorno, replyTo solo con lo stesso richiedente", () => {
  const e = email({ template: "promemoria", requestId: null, dedupeKey: "pro:c1:2026-11-05" });
  const kept1 = request({ id: R1, item: { kind: "primo", alreadySent: false } });
  const kept2 = request({ id: R2, item: { kind: "manuale", alreadySent: false }, requesterUserId: USER_B, requesterName: "Luca Verdi" });
  const gone = request({ id: R3, item: { kind: "primo", alreadySent: true } });
  const p = plan(e, facts({ requests: [kept1, kept2, gone] }));
  assert.equal(p.action, "send");
  if (p.action !== "send") return;
  assert.deepEqual(p.links.map((l) => l.requestId), [R1, R2]);
  assert.deepEqual(p.drop, [{ requestId: R3, reason: "promemoria_gia_fatto" }]);
  assert.equal(p.replyTo, null, "due richiedenti diversi");
  assert.deepEqual(p.after, [
    { requestId: R1, reminder: 1, first: false, manual: false },
    { requestId: R2, reminder: null, first: false, manual: true },
  ]);
  const same = plan(e, facts({ requests: [kept1, request({ id: R2, item: { kind: "ultimo", alreadySent: false }, reminderCount: 1 })] }));
  assert.ok(same.action === "send" && same.replyTo === "giulia.neri@topjet.it");
  if (same.action === "send") {
    const input = same.build({ [R1]: "http://localhost:3000/rispondi/ucq_" + "A".repeat(32), [R2]: "http://localhost:3000/rispondi/ucq_" + "B".repeat(32) });
    assert.ok(input.template === "promemoria" && input.replyName === "Giulia Neri");
  }
  assert.deepEqual(plan(e, facts({ contactRemindedToday: true, requests: [kept1] })), { action: "hold", reason: "gia_scritto_oggi" });
  assert.deepEqual(plan(e, facts({ requests: [gone] })), { action: "cancel", reason: "nessuna_voce" });
  assert.deepEqual(plan(e, facts({ requests: [request({ item: { kind: "primo", alreadySent: false }, lastEmailAt: romeLocalToUtc("2026-11-05", 9) })] })), { action: "cancel", reason: "nessuna_voce" });
});

test("piano: dopo «Correggi l'email» il promemoria parte anche il giorno dell'email al vecchio indirizzo", () => {
  const e = email({ template: "promemoria", requestId: null, dedupeKey: "pm:x:2026-11-05:v3" });
  const today = romeLocalToUtc("2026-11-05", 9);
  const changed = request({ item: { kind: "manuale", alreadySent: false }, lastEmailAt: today, addressChanged: true });
  const p = plan(e, facts({ contactRemindedToday: true, requests: [changed] }));
  assert.equal(p.action, "send");
  if (p.action === "send") assert.deepEqual(p.links, [{ requestId: R1, issuedFor: "promemoria" }]);
  // Senza il cambio d'indirizzo: «un'email al giorno».
  assert.deepEqual(plan(e, facts({ contactRemindedToday: true, requests: [{ ...changed, addressChanged: false }] })), { action: "hold", reason: "gia_scritto_oggi" });
  assert.deepEqual(plan(e, facts({ requests: [{ ...changed, addressChanged: false }] })), { action: "cancel", reason: "nessuna_voce" });
});

test("piano: mai un'email a chi ha chiesto (referente = richiedente), né la richiesta né i promemoria", () => {
  assert.deepEqual(plan(email(), facts({ requests: [request({ selfRequest: true })] })), { action: "cancel", reason: "referente_sei_tu" });
  const e = email({ template: "promemoria", requestId: null, dedupeKey: "pro:c1:2026-11-05" });
  const self = request({ id: R1, item: { kind: "primo", alreadySent: false }, selfRequest: true });
  const other = request({ id: R2, item: { kind: "primo", alreadySent: false }, requesterUserId: USER_B });
  const p = plan(e, facts({ requests: [self, other] }));
  assert.equal(p.action, "send");
  if (p.action === "send") {
    assert.deepEqual(p.links.map((l) => l.requestId), [R2]);
    assert.deepEqual(p.drop, [{ requestId: R1, reason: "referente_sei_tu" }]);
  }
  assert.deepEqual(plan(e, facts({ requests: [self] })), { action: "cancel", reason: "nessuna_voce" });
});

test("piano: reply-to — chi ha chiesto finché è revisore, altrimenti UC_EMAIL_REPLY_TO; il testo dice «arriva a» solo per chi ha chiesto", () => {
  const LS_REPLY = "risposte@lateralspace.example";
  const withFallback = (e: ClaimedReferentEmail, f: ReferentDeliveryFacts, fallbackReplyTo: string | null) =>
    planReferentDelivery(e, f, { lsDomains: LS, now: NOW, fallbackReplyTo });
  // Chi ha chiesto è ancora revisore con l'email verificata: resta lui, anche con il ripiego configurato.
  const own = withFallback(email(), facts(), LS_REPLY);
  assert.ok(own.action === "send" && own.replyTo === "giulia.neri@topjet.it");
  // Non più revisore (o email non verificata): chi legge i fatti dà null → il ripiego, e il testo non promette che arriva a lui.
  const fallback = withFallback(email(), facts({ replyTo: null }), LS_REPLY);
  assert.ok(fallback.action === "send");
  if (fallback.action === "send") {
    assert.equal(fallback.replyTo, LS_REPLY);
    const input = fallback.build({ [R1]: "http://localhost:3000/rispondi/ucq_" + "A".repeat(32) });
    assert.ok(input.template === "richiesta" && input.replyToKnown === false);
  }
  // Un valore sporco come ripiego non vale mai (nome, virgola, a capo): nessun reply-to.
  for (const bad of ["Nome <risposte@lateralspace.example>", "a@b.test, c@d.test", "a@b.test\r\nBcc: c@d.test", ""]) {
    const p = withFallback(email(), facts({ replyTo: null }), bad);
    assert.ok(p.action === "send" && p.replyTo === null, JSON.stringify(bad));
  }
  // Un indirizzo di chi ha chiesto non semplice non passa: il ripiego.
  const dirty = withFallback(email(), facts({ replyTo: "Giulia <giulia@topjet.it>" }), LS_REPLY);
  assert.ok(dirty.action === "send" && dirty.replyTo === LS_REPLY);
  // La conferma come la richiesta.
  const conf = withFallback(email({ template: "conferma" }), facts({ replyTo: null, requests: [request({ status: "completata", live: false })] }), LS_REPLY);
  assert.ok(conf.action === "send" && conf.replyTo === LS_REPLY);
  // Un promemoria con due richiedenti diversi: il ripiego, senza «arriva a».
  const e = email({ template: "promemoria", requestId: null, dedupeKey: "pro:c1:2026-11-05" });
  const two = withFallback(e, facts({ requests: [request({ id: R1, item: { kind: "primo", alreadySent: false } }), request({ id: R2, item: { kind: "primo", alreadySent: false }, requesterUserId: USER_B })] }), LS_REPLY);
  assert.ok(two.action === "send" && two.replyTo === LS_REPLY);
  if (two.action === "send") {
    const input = two.build({ [R1]: "http://localhost:3000/rispondi/ucq_" + "A".repeat(32), [R2]: "http://localhost:3000/rispondi/ucq_" + "B".repeat(32) });
    assert.ok(input.template === "promemoria" && input.replyToKnown === false && input.replyName === null);
  }
});

test("piano: D-B24 — nemmeno la conferma parte se il referente è chi ha chiesto", () => {
  const e = email({ template: "conferma" });
  assert.deepEqual(plan(e, facts({ requests: [request({ status: "completata", live: false, selfRequest: true })] })), { action: "cancel", reason: "referente_sei_tu" });
});

// ── Motore ────────────────────────────────────────────────────────────

interface Log {
  issued: { requestId: string; recipientHash: string; issuedFor: string }[];
  revoked: string[];
  sent: { effects: readonly ReferentSendEffect[]; tokenIds: Readonly<Record<string, string>>; dropped: readonly unknown[] }[];
  failed: string[];
  held: string[];
  cancelled: string[];
  notConfigured: number;
}

function store(rows: ClaimedReferentEmail[], f: (e: ClaimedReferentEmail) => ReferentDeliveryFacts, o: { issue?: (requestId: string) => { ok: false; code: string } | null } = {}): { store: ReferentDispatchStore; log: Log; claims: unknown[] } {
  const log: Log = { issued: [], revoked: [], sent: [], failed: [], held: [], cancelled: [], notConfigured: 0 };
  const claims: unknown[] = [];
  let n = 0;
  return {
    log,
    claims,
    store: {
      async holdUnconfigured() {
        log.notConfigured = rows.length;
        return rows.length;
      },
      async cancelStale() {
        return 0;
      },
      async claimDue(i) {
        claims.push(i);
        return rows.slice(0, i.limit);
      },
      async loadFacts(e) {
        return f(e);
      },
      async issueToken(i) {
        const refused = o.issue?.(i.requestId);
        if (refused) return refused;
        log.issued.push({ requestId: i.requestId, recipientHash: i.recipientHash, issuedFor: i.issuedFor });
        n++;
        return { ok: true, token: `ucq_${String(n).padStart(32, "x")}`, tokenId: `t${n}` };
      },
      async revokeToken(id) {
        log.revoked.push(id);
      },
      async markSent(_e, effects, tokenIds, dropped) {
        log.sent.push({ effects, tokenIds, dropped });
      },
      async markFailed(_e, code) {
        log.failed.push(code);
      },
      async markHeld(_e, reason) {
        log.held.push(reason);
      },
      async markCancelled(_e, reason) {
        log.cancelled.push(reason);
      },
    },
  };
}

function mailer(results: MailResult[] = []): UcMailer & { outbox: OutgoingEmail[]; keys: string[] } {
  const outbox: OutgoingEmail[] = [];
  const keys: string[] = [];
  return {
    outbox,
    keys,
    async send(m, options) {
      outbox.push(m);
      keys.push(options.idempotencyKey);
      return results.shift() ?? { ok: true };
    },
  };
}

test("motore: senza configurazione le righe restano in coda", async () => {
  const s = store([email()], () => facts());
  const sum = await runReferentDispatch(s.store, { env: {}, lsDomains: LS, now: NOW, mailer: mailer() });
  assert.equal(sum.notConfigured, 1);
  assert.equal(sum.sent, 0);
  assert.deepEqual(s.claims, []);
});

test("motore: un token per voce, con l'impronta dell'indirizzo; il link nell'email; replyTo", async () => {
  const rows = [email({ template: "promemoria", requestId: null, dedupeKey: "pro:c1:2026-11-05" })];
  const f = () => facts({ requests: [request({ id: R1, item: { kind: "primo", alreadySent: false } }), request({ id: R2, item: { kind: "primo", alreadySent: false } })] });
  const s = store(rows, f);
  const m = mailer();
  const sum = await runReferentDispatch(s.store, { env: ENV, lsDomains: LS, now: NOW, mailer: m, sendIntervalMs: 0 });
  assert.deepEqual(sum, { sent: 1, failed: 0, held: 0, cancelled: 0, notConfigured: 0 });
  assert.deepEqual(s.log.issued.map((x) => x.requestId), [R1, R2]);
  for (const x of s.log.issued) {
    assert.equal(x.recipientHash, recipientHash("mario.rossi@topjet.it"));
    assert.equal(x.issuedFor, "promemoria");
  }
  assert.equal(m.outbox.length, 1);
  assert.equal(m.outbox[0].to, "mario.rossi@topjet.it");
  assert.equal(m.outbox[0].replyTo, "giulia.neri@topjet.it");
  assert.ok(m.outbox[0].text.includes("http://localhost:3000/rispondi/ucq_"));
  assert.deepEqual(s.log.sent[0].tokenIds, { [R1]: "t1", [R2]: "t2" });
  assert.match(m.keys[0], /pro:c1:2026-11-05/);
});

test("motore: reply-to dalla configurazione solo quando manca chi ha chiesto; senza UC_EMAIL_REPLY_TO nessuna intestazione", async () => {
  const send = async (env: Record<string, string>, replyTo: string | null) => {
    const m = mailer();
    await runReferentDispatch(store([email()], () => facts({ replyTo })).store, { env, lsDomains: LS, now: NOW, mailer: m, sendIntervalMs: 0 });
    assert.equal(m.outbox.length, 1);
    return m.outbox[0];
  };
  const withEnv = { ...ENV, UC_EMAIL_REPLY_TO: "Risposte@LateralSpace.example" };
  assert.equal((await send(withEnv, "Giulia.Neri@TopJet.it")).replyTo, "giulia.neri@topjet.it", "chi ha chiesto vince");
  assert.equal((await send(withEnv, null)).replyTo, "risposte@lateralspace.example", "il ripiego configurato");
  assert.equal("replyTo" in (await send(ENV, null)), false, "senza configurazione: nessun reply-to");
  assert.equal("replyTo" in (await send({ ...ENV, UC_EMAIL_REPLY_TO: "x@y.test\nBcc: z@w.test" }, null)), false, "un valore sporco non passa");
});

test("motore: un fallimento certo revoca i token, uno incerto li lascia; il limite di Resend ferma il giro", async () => {
  const certain = store([email()], () => facts());
  await runReferentDispatch(certain.store, { env: ENV, lsDomains: LS, now: NOW, mailer: mailer([{ ok: false, code: "validation_error", ambiguous: false }]), sendIntervalMs: 0 });
  assert.deepEqual(certain.log.revoked, ["t1"]);
  assert.deepEqual(certain.log.failed, ["validation_error"]);
  const unsure = store([email()], () => facts());
  await runReferentDispatch(unsure.store, { env: ENV, lsDomains: LS, now: NOW, mailer: mailer([{ ok: false, code: "errore_invio", ambiguous: true }]), sendIntervalMs: 0 });
  assert.deepEqual(unsure.log.revoked, []);
  const limited = store([email({ id: "a" }), email({ id: "b" })], () => facts());
  const m = mailer([{ ok: false, code: RATE_LIMIT_CODE, ambiguous: false }]);
  const sum = await runReferentDispatch(limited.store, { env: ENV, lsDomains: LS, now: NOW, mailer: m, sendIntervalMs: 0 });
  assert.equal(m.outbox.length, 1, "il giro si ferma");
  assert.equal(sum.failed, 1);
});

test("motore: una voce la cui richiesta non è più viva all'emissione esce dall'email; senza voci, annullata", async () => {
  const rows = [email({ template: "promemoria", requestId: null, dedupeKey: "pro:c1:2026-11-05" })];
  const f = () => facts({ requests: [request({ id: R1, item: { kind: "primo", alreadySent: false } }), request({ id: R2, item: { kind: "primo", alreadySent: false } })] });
  const s = store(rows, f, { issue: (id) => (id === R1 ? { ok: false, code: "richiesta_non_viva" } : null) });
  const m = mailer();
  await runReferentDispatch(s.store, { env: ENV, lsDomains: LS, now: NOW, mailer: m, sendIntervalMs: 0 });
  assert.deepEqual(s.log.sent[0].effects.map((x) => x.requestId), [R2]);
  assert.deepEqual(s.log.sent[0].dropped, [{ requestId: R1, reason: "richiesta_non_viva" }]);
  const none = store(rows, f, { issue: () => ({ ok: false, code: "richiesta_non_viva" }) });
  await runReferentDispatch(none.store, { env: ENV, lsDomains: LS, now: NOW, mailer: mailer(), sendIntervalMs: 0 });
  assert.deepEqual(none.log.cancelled, ["nessuna_voce"]);
});

test("motore: held e cancelled contano, e i promemoria si prendono solo nella finestra", async () => {
  const s = store([email({ id: "a" }), email({ id: "b" })], (e) => (e.id === "a" ? facts({ subprocessorsAuthorized: false }) : facts({ recipient: null })));
  const sum = await runReferentDispatch(s.store, { env: ENV, lsDomains: LS, now: NOW, mailer: mailer(), sendIntervalMs: 0 });
  assert.deepEqual([sum.held, sum.cancelled], [1, 1]);
  const night = store([], () => facts());
  await runReferentDispatch(night.store, { env: ENV, lsDomains: LS, now: romeLocalToUtc("2026-11-05", 21), mailer: mailer() });
  assert.equal((night.claims[0] as { includeWindowed: boolean }).includeWindowed, false);
  await runReferentDispatch(night.store, { env: ENV, lsDomains: LS, now: NOW, mailer: mailer() });
  assert.equal((night.claims[1] as { includeWindowed: boolean }).includeWindowed, true);
});

test("piano: il reply-to di un promemoria è di chi ha chiesto le voci che partono, mai della prima voce tolta", () => {
  const e = email({ template: "promemoria", requestId: null, dedupeKey: "pro:c1:2026-11-05" });
  // R1 (Giulia, più vecchia) non ha più domande aperte e si toglie; parte solo R2 (Luca).
  const dropped = request({ id: R1, openItems: 0, item: { kind: "primo", alreadySent: false } });
  const kept = request({ id: R2, item: { kind: "manuale", alreadySent: false }, requesterUserId: USER_B, requesterName: "Luca Verdi" });
  const p = plan(e, facts({ replyTo: "giulia.neri@topjet.it", replyToByRequester: { [USER_A]: "giulia.neri@topjet.it", [USER_B]: "luca.verdi@topjet.it" }, requests: [dropped, kept] }));
  assert.equal(p.action, "send");
  if (p.action !== "send") return;
  assert.deepEqual(p.drop, [{ requestId: R1, reason: "nessuna_domanda_aperta" }]);
  assert.equal(p.replyTo, "luca.verdi@topjet.it", "l'intestazione segue chi ha chiesto R2");
  const input = p.build({ [R2]: "http://localhost:3000/rispondi/ucq_" + "B".repeat(32) });
  assert.ok(input.template === "promemoria");
  if (input.template === "promemoria") {
    assert.equal(input.replyName, "Luca Verdi", "il testo e l'intestazione nominano la stessa persona");
    assert.equal(input.replyToKnown, true);
  }
  // Luca non è più revisore (nessuna email nella mappa): mai l'indirizzo di Giulia, solo il ripiego.
  const lost = planReferentDelivery(e, facts({ replyTo: "giulia.neri@topjet.it", replyToByRequester: { [USER_A]: "giulia.neri@topjet.it" }, requests: [dropped, kept] }), {
    lsDomains: LS,
    now: NOW,
    fallbackReplyTo: "team@lateralspace.example",
  });
  assert.ok(lost.action === "send" && lost.replyTo === "team@lateralspace.example");
  if (lost.action === "send") {
    const built = lost.build({ [R2]: "http://localhost:3000/rispondi/ucq_" + "C".repeat(32) });
    assert.ok(built.template === "promemoria" && built.replyName === null && built.replyToKnown === false);
  }
  // Senza la mappa (fatti vecchi): `replyTo` vale solo per la persona della prima voce.
  const legacy = plan(e, facts({ replyTo: "giulia.neri@topjet.it", requests: [dropped, kept] }));
  assert.ok(legacy.action === "send" && legacy.replyTo === null);
});

test("piano: richiesta e conferma prendono il reply-to di chi ha chiesto quella richiesta", () => {
  const byUser = { [USER_A]: "giulia.neri@topjet.it", [USER_B]: "luca.verdi@topjet.it" };
  const r = plan(email(), facts({ replyTo: null, replyToByRequester: byUser, requests: [request({ requesterUserId: USER_B, requesterName: "Luca Verdi" })] }));
  assert.ok(r.action === "send" && r.replyTo === "luca.verdi@topjet.it");
  const c = plan(email({ template: "conferma" }), facts({ replyToByRequester: byUser, requests: [request({ requesterUserId: USER_A })] }));
  assert.ok(c.action === "send" && c.replyTo === "giulia.neri@topjet.it");
});

test("piano: senza le risposte dal link (UC_SECRET mancante) richieste e promemoria aspettano, la conferma parte", () => {
  assert.deepEqual(plan(email(), facts({ publicWritesOn: false })), { action: "hold", reason: "risposte_non_attive" });
  const reminder = email({ template: "promemoria", requestId: null, dedupeKey: "pro:c1:2026-11-05" });
  assert.deepEqual(plan(reminder, facts({ publicWritesOn: false, requests: [request({ item: { kind: "primo", alreadySent: false } })] })), {
    action: "hold",
    reason: "risposte_non_attive",
  });
  const confirm = plan(email({ template: "conferma" }), facts({ publicWritesOn: false, requests: [request({ status: "completata", live: false, answeredToday: 1 })] }));
  assert.equal(confirm.action, "send");
  assert.equal(plan(email(), facts({ publicWritesOn: true })).action, "send");
});
