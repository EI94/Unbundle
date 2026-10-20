import test from "node:test";
import assert from "node:assert/strict";
import { hashRequestToken, newRequestToken } from "../tokens.ts";
import {
  answerValueSql,
  clarificationReplySql,
  delegationItemsInsertSql,
  delegationRequestInsertSql,
  delegationsPerDayGuardSql,
  draftItemGuardSql,
  draftSaveSql,
  linkGuardSql,
  linkOpenedSql,
  privacyAckSql,
  publicAnswerInsertSql,
  rateLimitHitSql,
  referentItemsSql,
  requestProgressSql,
  resolveTokenSql,
  type PublicAnswerInsert,
} from "./public.ts";

const WS = "11111111-1111-4111-8111-111111111111";
const CASE = "22222222-2222-4222-8222-222222222222";
const CONTACT = "44444444-4444-4444-8444-444444444444";
const REQ = "66666666-6666-4666-8666-666666666666";
const ITEM = "77777777-7777-4777-8777-777777777777";
const TOKEN = "88888888-8888-4888-8888-888888888888";
const ANSWER = "99999999-9999-4999-8999-999999999999";
const IP_HASH = "ab".repeat(16);

const flat = (s: string) => s.replace(/\s+/g, " ");

test("link lookup: one statement on the token hash, live/visible predicates, active referent", () => {
  const { token } = newRequestToken();
  const hash = hashRequestToken(token);
  const st = resolveTokenSql(hash);
  assert.deepEqual(st.params, [hash], "only the hash travels: never the token");
  const text = flat(st.text);
  assert.match(text, /WHERE t\.token_hash = \$1 AND t\.revoked_at IS NULL AND ct\.is_active AND ct\.anonymized_at IS NULL/);
  assert.match(text, /r\.expires_at > now\(\)/, "expiry on the database clock");
  assert.match(text, /r\.share_epoch = c\.share_epoch/, "bulk revocation by epoch");
  assert.match(text, /c\.status <> 'chiuso'/, "visible: a paused case opens read-only");
  assert.match(text, /c\.status NOT IN \('chiuso', 'sospeso'\)\) AS live/, "live: writes only outside the pause");
  assert.match(text, /r\.status IN \('inviata', 'aperta', 'in_corso', 'completata'\)/, "a draft request is never a link");
  assert.throws(() => resolveTokenSql(token), /Impronta del token non valida/);
  assert.throws(() => resolveTokenSql("AB".repeat(32)), /Impronta/);
});

test("write guard: the token row and the live request are checked again inside every batch", () => {
  const st = linkGuardSql({ workspaceId: WS, caseId: CASE, requestId: REQ, tokenId: TOKEN });
  const text = flat(st.text);
  assert.match(text, /^SELECT uc_require\(EXISTS \(/);
  assert.match(text, /t\.revoked_at IS NULL/);
  assert.match(text, /c\.status NOT IN \('chiuso', 'sospeso'\)/);
  assert.match(text, /'link_non_valido'\) AS ok$/);
  assert.deepEqual(st.params, [TOKEN, REQ, CASE, WS]);
  assert.throws(() => linkGuardSql({ workspaceId: WS, caseId: CASE, requestId: REQ, tokenId: "ucr_x" }), /Id non valido/);
});

test("rate limits: one upsert per call, buckets validated, never raw addresses", () => {
  const st = rateLimitHitSql([
    { bucket: `ip:${IP_HASH}`, unit: "minute" },
    { bucket: `tok:${TOKEN}:invio`, unit: "minute" },
  ]);
  assert.match(flat(st.text), /ON CONFLICT \(bucket, window_start\) DO UPDATE SET count = uc_rate_limits\.count \+ 1 RETURNING bucket, count$/);
  assert.match(flat(st.text), /date_trunc\(x\.unit, now\(\)\)/);
  assert.throws(() => rateLimitHitSql([]), /Nessun secchio/);
  assert.throws(() => rateLimitHitSql([{ bucket: "ip:203.0.113.7 x", unit: "minute" }]), /Secchio non valido/);
  assert.throws(() => rateLimitHitSql([{ bucket: "ip:abc", unit: "day" as "minute" }]), /Finestra non valida/);
  assert.throws(() => rateLimitHitSql([{ bucket: "ip:abc", unit: "minute" }, { bucket: "ip:abc", unit: "minute" }]), /Secchio ripetuto/);
});

test("referent items: only his items in visible rows; personal and health values are NULL already in SQL", () => {
  const st = referentItemsSql({ caseId: CASE, requestId: REQ, contactId: CONTACT });
  const text = flat(st.text);
  assert.match(text, /ri\.state IN \('da_fare', 'bozza', 'inviata', 'non_so'\)/);
  assert.match(text, /i\.assignee_contact_id = \$\d+::uuid/);
  assert.match(text, /i\.deleted_at IS NULL/);
  assert.match(text, /CASE WHEN i\.privacy_class IN \('personale', 'personale_equipaggio', 'escluso_sanitario'\) THEN NULL ELSE ri\.draft END AS draft/);
  assert.match(text, /CASE WHEN i\.privacy_class IN \('personale', 'personale_equipaggio', 'escluso_sanitario'\) OR a\.erased_at IS NOT NULL THEN NULL ELSE a\.value END AS a_value/);
  assert.match(text, /f\.request_id = ri\.request_id/, "only files uploaded from this link");
  assert.match(text, /cm\.visibility = 'condiviso'/, "internal comments never reach the referent");
  assert.ok(!/value_encrypted AS|encode\(/.test(text), "no ciphertext leaves the database");
  const value = flat(answerValueSql({ caseId: CASE, itemId: ITEM, answerId: ANSWER }).text);
  assert.match(value, /CASE WHEN i\.privacy_class IN \('personale', 'personale_equipaggio', 'escluso_sanitario'\) OR a\.erased_at IS NOT NULL THEN NULL ELSE a\.value END AS value/);
});

test("drafts: guard on the item, CAS on the request row, never for personal classes", () => {
  const guard = flat(draftItemGuardSql({ caseId: CASE, itemId: ITEM, contactId: CONTACT }).text);
  assert.match(guard, /i\.status IN \('chiesta', 'mancante', 'parziale', 'validata'\)/);
  assert.match(guard, /AND NOT \(i\.privacy_class IN \('personale', 'personale_equipaggio', 'escluso_sanitario'\)\)/);
  assert.match(guard, /'voce_non_disponibile'\) AS ok$/);
  const save = flat(draftSaveSql({ caseId: CASE, requestId: REQ, itemId: ITEM, draft: { v: 1, payload: "x" } }).text);
  assert.match(save, /^WITH uc_cas AS \(UPDATE uc_request_items SET draft = \$1::jsonb/);
  assert.match(save, /state = CASE WHEN state = 'da_fare' THEN 'bozza' ELSE state END/);
  assert.match(save, /uc_require\(count\(\*\) = \$\d+::int, 'voce_non_disponibile'\)/);
  const progress = flat(requestProgressSql({ caseId: CASE, requestId: REQ }).text);
  assert.match(progress, /THEN 'in_corso' ELSE 'completata' END/);
  assert.match(progress, /r\.status IN \('inviata', 'aperta', 'in_corso', 'completata'\)/, "revoked or expired requests do not move");
});

test("open and privacy notice: one statement each, no write outside a live request, IP only as a hash", () => {
  const opened = linkOpenedSql({ workspaceId: WS, caseId: CASE, requestId: REQ, contactId: CONTACT, since: new Date("2026-10-11T22:00:00Z"), ipHash: IP_HASH, userAgent: "UA" });
  const text = flat(opened.text);
  assert.match(text, /first_opened_at = coalesce\(r\.first_opened_at, now\(\)\)/, "first opening recorded once");
  assert.match(text, /CASE WHEN r\.status = 'inviata' THEN 'aperta' ELSE r\.status END/);
  assert.match(text, /e\.event_type = 'link\.aperto'/, "at most one event a day");
  assert.match(text, /c\.status NOT IN \('chiuso', 'sospeso'\)/);
  assert.ok(opened.params.includes(IP_HASH));
  assert.ok(!opened.params.some((p) => typeof p === "string" && /\d+\.\d+\.\d+\.\d+/.test(p)), "no raw address");
  const ack = privacyAckSql({ workspaceId: WS, caseId: CASE, requestId: REQ, contactId: CONTACT, version: "uc-2026-10-1", ipHash: null, userAgent: null });
  assert.match(flat(ack.text), /privacy_ack_at = CASE WHEN r\.privacy_ack_at IS NULL OR r\.privacy_notice_version IS DISTINCT FROM \$\d+::text THEN now\(\)/);
  assert.match(flat(ack.text), /UPDATE uc_contacts SET privacy_notice_version = \$\d+::text, privacy_notice_seen_at = now\(\)/);
  assert.throws(() => privacyAckSql({ workspaceId: WS, caseId: CASE, requestId: REQ, contactId: CONTACT, version: "una versione lunghissima", ipHash: null, userAgent: null }), /Versione/);
});

function answer(over: Partial<PublicAnswerInsert> = {}): PublicAnswerInsert {
  return {
    id: ANSWER,
    workspaceId: WS,
    caseId: CASE,
    itemId: ITEM,
    requestId: REQ,
    contactId: CONTACT,
    kind: "valore",
    value: { value: 1200, unit: "€" },
    valueNormalized: { value_si: 1200 },
    valueEncryptedB64: null,
    validFrom: null,
    confidence: "stima",
    note: null,
    sourceBasis: "stima_a_memoria",
    supersedesAnswerId: null,
    fileIds: [],
    textHash: null,
    responseType: "numero",
    ipHash: IP_HASH,
    userAgent: "x".repeat(400),
    device: "mobile",
    ...over,
  };
}

test("answers: append-only insert from the referent with the next version; the event carries no value", () => {
  const st = publicAnswerInsertSql(answer());
  const text = flat(st.text);
  assert.match(text, /^WITH ins AS \( INSERT INTO uc_answers/);
  assert.match(text, /coalesce\(\(SELECT max\(x\.version\) FROM uc_answers x WHERE x\.item_id = i\.id\), 0\) \+ 1/);
  assert.match(text, /'referente', \$\d+::text, \$\d+::uuid, \$\d+::uuid/, "source kind is always the referent");
  assert.match(text, /SELECT uc_require\(count\(\*\) = 1, 'conflitto'\) AS ok FROM ins$/);
  assert.ok(st.params.includes("x".repeat(300)), "user agent truncated to 300");
  const eventPayload = st.params.find((p) => typeof p === "string" && p.includes('"source_kind"'));
  assert.ok(eventPayload, "event payload present");
  assert.ok(!String(eventPayload).includes("1200"), "the audit never carries the value");
  assert.match(flat(publicAnswerInsertSql(answer({ value: null, valueNormalized: null, valueEncryptedB64: "VUNaMQ==" })).text), /decode\(\$\d+::text, 'base64'\)/);
  assert.throws(() => publicAnswerInsertSql(answer({ valueEncryptedB64: "VUNaMQ==" })), /cifrato/, "an encrypted value has no plaintext copy");
  assert.throws(() => publicAnswerInsertSql(answer({ value: null, valueNormalized: null, valueEncryptedB64: "not base64!" })), /Busta/);
  assert.throws(() => publicAnswerInsertSql(answer({ textHash: "abc" })), /Impronta/);
  assert.throws(() => publicAnswerInsertSql(answer({ fileIds: ["../x"] })), /Id non valido/);
});

test("clarification reply: a shared comment under the open question, text checked for length", () => {
  const st = clarificationReplySql({ id: ANSWER, workspaceId: WS, caseId: CASE, itemId: ITEM, contactId: CONTACT, body: "Sì, giorni lavorativi.", ipHash: null, userAgent: null });
  const text = flat(st.text);
  assert.match(text, /cm\.kind = 'chiarimento_richiesto' AND cm\.visibility = 'condiviso' AND cm\.resolved_at IS NULL/);
  assert.match(text, /'condiviso', 'risposta_chiarimento'/);
  assert.ok(!st.params.some((p) => typeof p === "string" && p.includes('"body"')), "the event has no text");
  assert.throws(() => clarificationReplySql({ id: ANSWER, workspaceId: WS, caseId: CASE, itemId: ITEM, contactId: CONTACT, body: "x".repeat(4001), ipHash: null, userAgent: null }), /lungo/);
});

test("delegations: child request inherits the role, depth ≤ 2, live parent, items moved only while asked, five a day", () => {
  const send = flat(delegationRequestInsertSql({ id: REQ, workspaceId: WS, caseId: CASE, parentRequestId: TOKEN, contactId: CONTACT, message: null, send: true, nextReminderAt: null }).text);
  assert.match(send, /p\.acting_role_key, 'inviata'/, "the delegate answers for the same template role");
  assert.match(send, /p\.delegation_depth \+ 1/);
  assert.match(send, /p\.purpose = 'raccolta' AND p\.delegation_depth < 2/);
  assert.match(send, /now\(\) \+ interval '720 hours'/, "30 days from the send, in hours");
  assert.match(send, /c\.status NOT IN \('chiuso', 'sospeso'\)/);
  const draft = flat(delegationRequestInsertSql({ id: REQ, workspaceId: WS, caseId: CASE, parentRequestId: TOKEN, contactId: CONTACT, message: "Ci pensi tu?", send: false, nextReminderAt: new Date() }).text);
  assert.match(draft, /'bozza'/);
  assert.match(draft, /NULL::timestamptz, NULL::timestamptz/, "a draft has no send date and no expiry");
  const items = flat(delegationItemsInsertSql({ caseId: CASE, requestId: REQ, itemIds: [ITEM, ITEM] }).text);
  assert.match(items, /i\.status = 'chiesta'/);
  assert.match(items, /NOT EXISTS \(SELECT 1 FROM uc_request_items x WHERE x\.item_id = i\.id AND x\.state IN \('da_fare', 'bozza', 'inviata'\)\)/);
  assert.ok(delegationItemsInsertSql({ caseId: CASE, requestId: REQ, itemIds: [ITEM, ITEM] }).params.includes(1), "duplicates count once");
  assert.throws(() => delegationItemsInsertSql({ caseId: CASE, requestId: REQ, itemIds: [] }), /Nessuna voce/);
  const perDay = delegationsPerDayGuardSql({ caseId: CASE, parentRequestId: REQ, since: new Date("2026-10-11T22:00:00Z"), max: 5 });
  assert.match(flat(perDay.text), /status <> 'revocata'/);
  assert.match(flat(perDay.text), /'troppe_deleghe'\) AS ok$/);
  assert.ok(perDay.params.includes(5));
  assert.throws(() => delegationsPerDayGuardSql({ caseId: CASE, parentRequestId: REQ, since: new Date(), max: 0 }), /Limite/);
});
