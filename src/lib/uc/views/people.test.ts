import test from "node:test";
import assert from "node:assert/strict";
import { CASE_ROLES, CLIENT_CASE_ROLES, REQUEST_STATUSES, type RequestStatus } from "../vocab.ts";
import { findForbiddenIn } from "./copy-guard.ts";
import { ROLE_LABEL } from "./labels.ts";
import {
  CASE_ROLE_HINT,
  CASE_ROLE_LABEL,
  CLIENT_PERSON_STATUS,
  DESIGNATION_LABEL,
  DESIGNATION_SUFFIX,
  EMAIL_NOT_CONFIGURED_TEXT,
  EMAIL_OFF_TEXT,
  LS_PERSON_STATUS,
  PAUSED_LINK_TEXT,
  REQUEST_STATUS_TONE,
  assignOutcomeText,
  clientPeopleRows,
  clientPersonStatus,
  groupMembers,
  lsPeopleRows,
  lsPersonStatus,
  peopleHaveSendWork,
  personCountsText,
  personPendingText,
  personRoleText,
  requestDetailLines,
  requestTimeline,
  rolesAssignableTo,
  sendButtonText,
  sendGroupText,
  sendOutcomeText,
  sideLabel,
  signerCandidates,
  unassignedRoleRows,
  type PersonContactLike,
  type PersonRequestLike,
  type RequestDetailLike,
} from "./people.ts";

test("role labels are the vocabulary of §2.6, one source", () => {
  for (const r of CASE_ROLES) assert.equal(CASE_ROLE_LABEL[r], ROLE_LABEL[r], r);
  assert.equal(CASE_ROLE_LABEL.ls_lead, "Responsabile Lateral Space");
  assert.equal(CASE_ROLE_LABEL.owner_cliente, "Responsabile del cliente");
  assert.deepEqual(DESIGNATION_LABEL, { owner: "Via allo sviluppo", privacy: "Privacy" });
  assert.deepEqual(DESIGNATION_SUFFIX, { owner: "firma il via", privacy: "firma la privacy" });
});

test("Lateral Space and client roles are never offered to the wrong side", () => {
  assert.deepEqual(rolesAssignableTo(true), ["ls_lead", "ls_analista", "ls_sviluppatore", "osservatore"]);
  assert.deepEqual(rolesAssignableTo(false), ["owner_cliente", "approvatore_privacy", "ai_board", "osservatore"]);
  assert.equal(sideLabel(true), "Lateral Space");
});

test("members are grouped per person, Lateral Space first, emails only when allowed", () => {
  const rows = [
    { userId: "u2", role: "owner_cliente" as const, name: "Bruna", email: "b@cliente.test", isLateralSpace: false, personalZoneAccess: false, personalZoneGrant: null },
    { userId: "u1", role: "ls_analista" as const, name: "Aldo", email: "a@ls.test", isLateralSpace: true, personalZoneAccess: false, personalZoneGrant: { proposed_by_user_id: "u3", at: "x", approvals: [] } },
    { userId: "u3", role: "osservatore" as const, name: null, email: "c@ls.test", isLateralSpace: true, personalZoneAccess: false, personalZoneGrant: null },
    { userId: "u3", role: "ls_lead" as const, name: null, email: "c@ls.test", isLateralSpace: true, personalZoneAccess: true, personalZoneGrant: null },
  ];
  const ls = groupMembers(rows, { withEmail: true });
  assert.deepEqual(
    ls.map((m) => [m.userId, m.name, m.roles, m.personalZone, m.email]),
    [
      ["u1", "Aldo", ["ls_analista"], "in_attesa", "a@ls.test"],
      ["u3", "c@ls.test", ["ls_lead", "osservatore"], "attiva", "c@ls.test"],
      ["u2", "Bruna", ["owner_cliente"], "no", "b@cliente.test"],
    ],
  );
  assert.equal(ls[0].grantProposedBy, "u3");
  const client = groupMembers(rows, { withEmail: false });
  assert.ok(client.every((m) => m.email === null));
});

test("every request status has a tone", () => {
  for (const s of REQUEST_STATUSES) assert.ok(REQUEST_STATUS_TONE[s], s);
});

const base: RequestDetailLike = {
  channel: "email",
  sentAt: "2026-10-03T08:00:00.000Z",
  expiresAt: "2026-11-02T08:00:00.000Z",
  reminderCount: 1,
  nextReminderAt: "2026-10-10T07:00:00.000Z",
  escalated: false,
  activeLinks: 1,
  live: true,
  emailQueued: false,
  emailHoldReason: null,
  contactHasEmail: true,
  delegatedFromRequestId: null,
  delegationDepth: 0,
  needsApproval: false,
  visible: true,
};
const day = (iso: string | null) => (iso ? `${Number(iso.slice(8, 10))} ${{ "10": "ott", "11": "nov" }[iso.slice(5, 7)] ?? "?"}` : null);

test("the request line says sent, expiry and reminders in one row (§3.9.1)", () => {
  assert.equal(requestTimeline(base, day), "Inviata il 3 ott · scade il 2 nov · promemoria 1 di 2 (il prossimo il 10 ott)");
  assert.equal(requestTimeline({ ...base, sentAt: "2026-10-08T08:00:00.000Z", reminderCount: 2 }, day), "Inviata l'8 ott · scade il 2 nov · promemoria 2 di 2");
  assert.equal(requestTimeline({ ...base, live: false, visible: false }, day), "Inviata il 3 ott · scaduta il 2 nov · promemoria 1 di 2");
  // Dossier in pausa: il link non è vivo ma si apre ancora, quindi «scade»; niente prossimo promemoria.
  assert.equal(requestTimeline({ ...base, live: false, visible: true }, day), "Inviata il 3 ott · scade il 2 nov · promemoria 1 di 2");
  assert.equal(requestTimeline({ ...base, sentAt: null, expiresAt: null }, day), "Bozza: non ancora inviata.");
  assert.match(requestTimeline({ ...base, sentAt: null, needsApproval: true }, day), /^Delega da approvare/);
  assert.match(requestTimeline({ ...base, channel: "link_manuale" }, day), /con un link copiato a mano/);
});

test("request detail lines: escalation, delegation, link and email in plain words", () => {
  assert.deepEqual(requestDetailLines(base, day), ["Inviata il 3 ott · scade il 2 nov · promemoria 1 di 2 (il prossimo il 10 ott)", "Link attivo"]);
  const busy = requestDetailLines({ ...base, escalated: true, delegatedFromRequestId: "r0", delegationDepth: 1, emailQueued: true }, day);
  assert.ok(busy.includes("Segnalata al responsabile del cliente."));
  assert.ok(busy.includes("Delega da un collega."));
  assert.ok(busy.includes("In partenza"));
  const held = requestDetailLines({ ...base, emailQueued: true, emailHoldReason: "email_non_configurata" }, day);
  assert.ok(held.includes(EMAIL_NOT_CONFIGURED_TEXT));
  const manual = requestDetailLines({ ...base, channel: "link_manuale", contactHasEmail: false }, day);
  assert.ok(manual.some((l) => l.startsWith("Senza email")));
  const paused = requestDetailLines({ ...base, live: false, visible: true }, day);
  assert.deepEqual(paused, ["Inviata il 3 ott · scade il 2 nov · promemoria 1 di 2", PAUSED_LINK_TEXT]);
  assert.ok(!requestDetailLines({ ...base, live: false, visible: false }, day).includes(PAUSED_LINK_TEXT));
  for (const lines of [busy, held, manual]) assert.ok(lines.every((l) => !/\b(voce|voci|Owner|gate)\b/i.test(l)), lines.join(" | "));
});

test("signers are active, not anonymized contacts with an email", () => {
  const list = [
    { id: "a", isActive: true, anonymized: false, hasEmail: true },
    { id: "b", isActive: false, anonymized: false, hasEmail: true },
    { id: "c", isActive: true, anonymized: true, hasEmail: false },
    { id: "d", isActive: true, anonymized: false, hasEmail: false },
  ];
  assert.deepEqual(signerCandidates(list).map((c) => c.id), ["a"]);
});

// ── Lista unica ───────────────────────────────────────────────────────

const ACTIONS = { send: false, copyLink: false, remind: false, revoke: false, extend: false, approveDelegation: false };

function req(contactId: string, status: RequestStatus, o: { live?: boolean; visible?: boolean; needsApproval?: boolean; purpose?: "raccolta" | "approvazioni"; id?: string } = {}): PersonRequestLike {
  const live = o.live ?? (status === "inviata" || status === "aperta" || status === "in_corso" || status === "completata");
  return {
    id: o.id ?? `${contactId}-${status}`,
    contactId,
    purpose: o.purpose ?? "raccolta",
    status,
    detail: { ...base, live, needsApproval: o.needsApproval ?? false, openItems: 3, expiresAt: base.expiresAt, visible: o.visible ?? live },
    actions: ACTIONS,
  };
}

test("person status for Lateral Space, rule by rule", () => {
  assert.equal(lsPersonStatus([], 0), "nessuno");
  assert.equal(lsPersonStatus([], 5), "da_inviare");
  assert.equal(lsPersonStatus([req("a", "bozza", { live: false })], 0), "da_inviare");
  assert.equal(lsPersonStatus([req("a", "bozza", { live: false, needsApproval: true }), req("a", "inviata")], 0), "delega");
  assert.equal(lsPersonStatus([req("a", "aperta")], 4), "link_attivo");
  assert.equal(lsPersonStatus([req("a", "scaduta", { live: false })], 4), "link_scaduto");
  // Oltre la scadenza ma prima del giro notturno: non più apribile.
  assert.equal(lsPersonStatus([req("a", "inviata", { live: false, visible: false })], 4), "link_scaduto");
  // In pausa il link non è vivo ma resta apribile: non è scaduto, resta «Link attivo» (anche con domande da inviare).
  assert.equal(lsPersonStatus([req("a", "inviata", { live: false, visible: true })], 0), "link_attivo");
  assert.equal(lsPersonStatus([req("a", "aperta", { live: false, visible: true })], 3), "link_attivo");
  assert.equal(lsPersonStatus([req("a", "completata")], 0), "ha_finito");
  assert.equal(lsPersonStatus([req("a", "completata")], 2), "da_inviare");
  assert.equal(lsPersonStatus([req("a", "revocata", { live: false })], 0), "nessuno");
  assert.equal(lsPersonStatus([req("a", "aperta", { purpose: "approvazioni" })], 0), "nessuno");
});

test("person status for the client: four words, never «In corso» (art. 15.4)", () => {
  assert.equal(clientPersonStatus([]), "da_invitare");
  assert.equal(clientPersonStatus([req("a", "bozza"), req("a", "revocata")]), "da_invitare");
  assert.equal(clientPersonStatus([req("a", "in_corso")]), "invitato");
  assert.equal(clientPersonStatus([req("a", "completata"), req("a", "aperta")]), "invitato");
  assert.equal(clientPersonStatus([req("a", "completata"), req("a", "scaduta")]), "ha_finito");
  assert.equal(clientPersonStatus([req("a", "scaduta"), req("a", "completata")]), "link_scaduto");
  assert.equal(clientPersonStatus([req("a", "aperta", { purpose: "approvazioni" })]), "da_invitare");
  assert.deepEqual(
    Object.values(CLIENT_PERSON_STATUS).map((s) => s.label),
    ["Da invitare", "Invitato", "Ha finito", "Link scaduto"],
  );
});

function contact(id: string, name: string, o: Partial<PersonContactLike> = {}): PersonContactLike {
  return {
    id,
    displayName: name,
    roleLabel: null,
    templateRoleKey: null,
    email: `${id}@cliente.test`,
    phone: null,
    preferredChannel: "email",
    hasEmail: true,
    isActive: true,
    anonymized: false,
    involved: true,
    counts: { assigned: 8, open: 3, unsent: 0 },
    ...o,
  };
}

const roleLabels = { sistemi: "Sistemi", amministrazione: "Amministrazione" };
const contacts = [
  contact("z", "Zeno Verdi", { templateRoleKey: "sistemi", counts: { assigned: 40, open: 40, unsent: 40 } }),
  contact("m", "mario Rossi", { roleLabel: "Commerciale", counts: { assigned: 12, open: 3, unsent: 0 } }),
  contact("a", "Anna Bianchi", { roleLabel: "Sistemi", templateRoleKey: "sistemi", counts: { assigned: 1, open: 1, unsent: 1 } }),
  contact("x", "Controllo di gestione", { anonymized: true, isActive: false, counts: { assigned: 2, open: 0, unsent: 0 } }),
  contact("o", "Altro dossier", { involved: false, isActive: false, counts: { assigned: 0, open: 0, unsent: 0 } }),
  contact("n", "Nuova Collega", { involved: false, counts: { assigned: 0, open: 0, unsent: 0 } }),
];
const requests = [req("m", "aperta"), req("z", "scaduta", { live: false }), req("a", "completata")];

test("the Lateral Space list is alphabetical, never by open questions, with counts and signer suffix", () => {
  const rows = lsPeopleRows({ contacts, requests, roleLabels, designated: { owner: "m", privacy: "a" } });
  assert.deepEqual(
    rows.map((r) => [r.name, r.status]),
    [
      ["Anna Bianchi", "da_inviare"],
      ["mario Rossi", "link_attivo"],
      ["Nuova Collega", "nessuno"],
      ["Zeno Verdi", "link_scaduto"],
      ["Controllo di gestione", "nessuno"],
    ],
  );
  const anna = rows[0];
  assert.equal(anna.roleText, "Sistemi");
  assert.deepEqual(anna.signs, ["privacy"]);
  assert.equal(anna.countsText, "1 domanda · 1 aperta");
  assert.equal(rows[1].countsText, "12 domande · 3 aperte");
  assert.equal(rows[2].countsText, null);
  assert.ok(!rows.some((r) => r.id === "o"), "an inactive referent of another dossier is not listed");
});

test("the client list carries exactly name, role, signer and status: no counts, no dates (art. 15.4)", () => {
  const rows = clientPeopleRows({ contacts, requests, roleLabels, designated: { owner: "m", privacy: null } });
  assert.deepEqual(
    rows.map((r) => [r.name, r.status]),
    [
      ["Anna Bianchi", "ha_finito"],
      ["mario Rossi", "invitato"],
      ["Nuova Collega", "da_invitare"],
      ["Zeno Verdi", "link_scaduto"],
    ],
  );
  for (const r of rows) {
    assert.deepEqual(Object.keys(r).sort(), ["id", "kind", "name", "roleText", "signs", "status"]);
    const visible = [r.name, r.roleText ?? "", CLIENT_PERSON_STATUS[r.status].label, ...r.signs.map((s) => DESIGNATION_SUFFIX[s])].join(" ");
    assert.doesNotMatch(visible, /\d/, `no number or date in «${visible}»`);
  }
  assert.ok(!rows.some((r) => r.id === "x"), "anonymized people are not shown to the client");
  // Lo stesso elenco con conteggi diversi dà lo stesso ordine: niente ordinamenti per persona.
  const shuffled = contacts.map((c) => ({ ...c, counts: { assigned: 999, open: 999, unsent: 999 } }));
  assert.deepEqual(clientPeopleRows({ contacts: shuffled, requests, roleLabels, designated: { owner: null, privacy: null } }).map((r) => r.id), rows.map((r) => r.id));
});

test("role text drops duplicates; counts text hides zero", () => {
  assert.equal(personRoleText({ roleLabel: "sistemi", templateRoleKey: "sistemi" }, roleLabels), "sistemi");
  assert.equal(personRoleText({ roleLabel: "Responsabile IT", templateRoleKey: "sistemi" }, roleLabels), "Responsabile IT · Sistemi");
  assert.equal(personRoleText({ roleLabel: null, templateRoleKey: null }, roleLabels), null);
  assert.equal(personCountsText({ assigned: 0, open: 0 }), null);
  assert.equal(personCountsText({ assigned: 1200, open: 1 }), "1.200 domande · 1 aperta");
});

test("rows «Senza referente»: only roles with unassigned questions, by name, with the referents of that role first", () => {
  const rows = unassignedRoleRows(
    [
      { roleKey: "sistemi", unassigned: 36 },
      { roleKey: "amministrazione", unassigned: 115 },
      { roleKey: "vendite", unassigned: 0 },
    ],
    roleLabels,
    contacts,
  );
  assert.deepEqual(
    rows.map((r) => [r.roleLabel, r.questions, r.suggestedContactIds]),
    [
      ["Amministrazione", 115, []],
      ["Sistemi", 36, ["z", "a"]],
    ],
  );
});

test("send panel texts, with email and without (§3.9.2)", () => {
  assert.equal(sendButtonText(2, true), "Invia a 2 referenti");
  assert.equal(sendButtonText(1, true), "Invia a 1 referente");
  assert.equal(sendButtonText(2, false), "Prepara 2 link");
  assert.equal(sendOutcomeText({ requests: 2, manual: 0, emailConfigured: true, skipped: 0 }), "Inviate 2 richieste.");
  assert.equal(sendOutcomeText({ requests: 2, manual: 0, emailConfigured: false, skipped: 0 }), "Link pronti: copiali dalle righe di Persone.");
  assert.equal(sendOutcomeText({ requests: 1, manual: 1, emailConfigured: true, skipped: 3 }), "Link pronto: copialo dalla riga di Persone. 3 domande saltate.");
  assert.equal(sendOutcomeText({ requests: 3, manual: 3, emailConfigured: true, skipped: 0 }), "Link pronti: copiali dalle righe di Persone.");
  // Invio misto: si copiano solo i link di chi non ha l'email (copiare un link toglie la verifica delle sue risposte).
  assert.equal(sendOutcomeText({ requests: 2, manual: 1, emailConfigured: true, skipped: 0 }), "Inviate 2 richieste. 1 senza email: copia il suo link dalla riga di Persone.");
  assert.equal(sendOutcomeText({ requests: 5, manual: 2, emailConfigured: true, skipped: 1 }), "Inviate 5 richieste. 2 senza email: copia il loro link dalle righe di Persone. 1 domanda saltata.");
  assert.equal(sendGroupText({ questions: 44, minutes: 35, channel: "email" }, true), "44 domande · circa 35 minuti · link valido 30 giorni · email");
  assert.equal(sendGroupText({ questions: 44, minutes: 35, channel: "email" }, false), "44 domande · circa 35 minuti · link valido 30 giorni · link da copiare");
  // Oltre l'ora, ore e minuti come nel link del referente.
  assert.equal(sendGroupText({ questions: 1, minutes: 0.4, channel: "email" }, true), "1 domanda · circa 1 minuto · link valido 30 giorni · email");
  assert.equal(sendGroupText({ questions: 70, minutes: 60, channel: "email" }, true), "70 domande · circa 1 ora · link valido 30 giorni · email");
  assert.equal(sendGroupText({ questions: 114, minutes: 315, channel: "link_manuale" }, true), "114 domande · circa 5 ore e 15 minuti · link valido 30 giorni · link da copiare");
  assert.equal(sendGroupText({ questions: 23, minutes: 121, channel: "email" }, true), "23 domande · circa 2 ore e 1 minuto · link valido 30 giorni · email");
});

test("texts the client can read pass the copy guard", () => {
  const texts = [
    ...Object.values(CLIENT_PERSON_STATUS).map((s) => s.label),
    ...Object.values(LS_PERSON_STATUS).map((s) => s.label),
    ...Object.values(DESIGNATION_LABEL),
    ...Object.values(DESIGNATION_SUFFIX),
    ...CLIENT_CASE_ROLES.map((r) => CASE_ROLE_HINT[r]),
    ...CASE_ROLES.map((r) => CASE_ROLE_LABEL[r]),
    EMAIL_OFF_TEXT,
    EMAIL_NOT_CONFIGURED_TEXT,
    sendOutcomeText({ requests: 2, manual: 2, emailConfigured: false, skipped: 2 }),
    sendOutcomeText({ requests: 2, manual: 1, emailConfigured: true, skipped: 0 }),
    PAUSED_LINK_TEXT,
    assignOutcomeText({ assigned: 3, skipped: [{ code: "in_richiesta" }, { code: "in_richiesta" }], skippedTotal: 2, roleMismatch: 1 }),
    assignOutcomeText({ assigned: 0, skipped: [{ code: "gia_assegnata" }], skippedTotal: 1, roleMismatch: 0, truncated: true }),
  ];
  assert.deepEqual(findForbiddenIn(texts, "cliente"), []);
});

test("pending sends show next to the counts when the status does not say it", () => {
  assert.equal(personPendingText({ status: "link_attivo", unsent: 3 }), "3 da inviare");
  assert.equal(personPendingText({ status: "link_scaduto", unsent: 1200 }), "1.200 da inviare");
  assert.equal(personPendingText({ status: "da_inviare", unsent: 3 }), null, "«Da inviare» already says it");
  assert.equal(personPendingText({ status: "link_attivo", unsent: 0 }), null);
  const rows = lsPeopleRows({ contacts: [contact("b", "Bea", { counts: { assigned: 5, open: 5, unsent: 3 } })], requests: [req("b", "aperta")], roleLabels, designated: { owner: null, privacy: null } });
  assert.equal(rows[0].status, "link_attivo");
  assert.equal(personPendingText(rows[0]), "3 da inviare");
});

test("Persone has something to send: unassigned roles, «Da inviare», or questions assigned after an open link", () => {
  const row = (status: "link_attivo" | "da_inviare" | "ha_finito" | "link_scaduto", unsent: number, o: { isActive?: boolean; anonymized?: boolean } = {}) => ({ status, unsent, isActive: o.isActive ?? true, anonymized: o.anonymized ?? false });
  assert.equal(peopleHaveSendWork([], []), false);
  assert.equal(peopleHaveSendWork([{}], []), true);
  assert.equal(peopleHaveSendWork([], [row("link_attivo", 0), row("ha_finito", 0)]), false);
  assert.equal(peopleHaveSendWork([], [row("link_attivo", 3)]), true, "new questions after an open link need their own request");
  assert.equal(peopleHaveSendWork([], [row("link_scaduto", 2)]), true);
  assert.equal(peopleHaveSendWork([], [row("da_inviare", 0)]), true, "a draft counts too");
  assert.equal(peopleHaveSendWork([], [row("link_attivo", 3, { isActive: false }), row("da_inviare", 2, { anonymized: true })]), false, "nobody to send to");
});

test("assignment outcomes speak of results, never of commands only Lateral Space can run", () => {
  const skip = (code: string, n: number) => Array.from({ length: n }, () => ({ code }));
  assert.equal(assignOutcomeText({ assigned: 12, skipped: [], skippedTotal: 0, roleMismatch: 0 }), "12 domande assegnate.");
  assert.equal(assignOutcomeText({ assigned: 1, skipped: skip("in_richiesta", 3), skippedTotal: 3, roleMismatch: 0 }), "1 domanda assegnata. 3 restano nel link ancora aperto.");
  assert.equal(assignOutcomeText({ assigned: 0, skipped: skip("in_richiesta", 1), skippedTotal: 1, roleMismatch: 0 }), "Nessuna domanda assegnata. 1 resta nel link ancora aperto.");
  assert.equal(assignOutcomeText({ assigned: 2, skipped: skip("gia_assegnata", 2), skippedTotal: 2, roleMismatch: 0 }), "2 domande assegnate. 2 hanno già un referente.");
  // Motivi misti, o un campione più corto del totale: solo il numero.
  assert.equal(assignOutcomeText({ assigned: 2, skipped: [...skip("gia_assegnata", 1), ...skip("in_richiesta", 1)], skippedTotal: 2, roleMismatch: 0 }), "2 domande assegnate. 2 saltate.");
  assert.equal(assignOutcomeText({ assigned: 0, skipped: skip("in_richiesta", 200), skippedTotal: 250, roleMismatch: 0 }), "Nessuna domanda assegnata. 250 saltate.");
  assert.match(assignOutcomeText({ assigned: 1, skipped: [], skippedTotal: 0, roleMismatch: 1 }), /servirà la conferma di chi ha il dato\.$/);
  // In blocco: dove si è fermata, o che le altre restano per un secondo giro.
  assert.equal(
    assignOutcomeText({ assigned: 2000, skipped: [], skippedTotal: 0, roleMismatch: 0, interrupted: "Qualcuno ha appena cambiato queste domande. Aggiorna la pagina e riprova." }),
    "2.000 domande assegnate. Le altre no: qualcuno ha appena cambiato queste domande. Aggiorna la pagina e riprova.",
  );
  assert.equal(assignOutcomeText({ assigned: 5000, skipped: [], skippedTotal: 0, roleMismatch: 0, truncated: true }), "5.000 domande assegnate. Erano troppe in una volta: ripeti per le altre.");
  for (const code of ["in_richiesta", "gia_assegnata", "senza_ruolo", "nessun_referente_per_ruolo", "piu_referenti_per_ruolo"]) {
    const text = assignOutcomeText({ assigned: 0, skipped: skip(code, 2), skippedTotal: 2, roleMismatch: 0 });
    assert.doesNotMatch(text, /revoca|::|\bvoc[ei]\b/i, text);
  }
});
