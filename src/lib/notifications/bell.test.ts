import test from "node:test";
import assert from "node:assert/strict";
import type { UcBellItem } from "../uc/notify/bell.ts";
import {
  BELL_MAX_ENTRIES,
  BELL_TEXT,
  bellAriaLabel,
  bellBadgeText,
  dossierEntry,
  emptyBellPayload,
  isNewEntry,
  laterIso,
  mergeBell,
  noticeEntry,
  parseBellReadRef,
  parseBellWriteBody,
  parseUpTo,
  signalEntry,
  signalHref,
  type BellEntry,
} from "./bell.ts";

// La campanella per persona (SPEC §P2.3.2, §P2.5). Dati inventati.
const WS = "3f2a9c1e-0000-4000-8000-0000000000a1";
const UC = "3f2a9c1e-0000-4000-8000-0000000000b1";
const ID = (n: number) => `3f2a9c1e-0000-4000-8000-${String(n).padStart(12, "0")}`;
const NOW = new Date("2026-10-27T12:00:00.000Z");

function entry(n: number, activityAt: string, unread = true): BellEntry {
  return { key: `s:${ID(n)}`, source: "segnale", ref: { source: "segnale", id: ID(n) }, context: null, title: `t${n}`, description: null, href: null, activityAt, when: "", unread };
}

test("numero rosso: «9+» da 10; nome accessibile verbatim", () => {
  assert.equal(bellBadgeText(0), null);
  assert.equal(bellBadgeText(1), "1");
  assert.equal(bellBadgeText(9), "9");
  assert.equal(bellBadgeText(10), "9+");
  assert.equal(bellBadgeText(25), "9+");
  assert.equal(bellBadgeText(Number.NaN), null);
  assert.equal(bellAriaLabel(0), "Notifiche");
  assert.equal(bellAriaLabel(1), "Notifiche, 1 nuova");
  assert.equal(bellAriaLabel(3), "Notifiche, 3 nuove");
  assert.equal(BELL_TEXT.readAll, "Segna tutte come lette");
});

test("nuove: non lette e dopo «visto fino a»; lo stesso istante non è nuovo; senza seenAt ogni non letta è nuova", () => {
  const e = entry(1, "2026-10-27T10:00:00.000Z");
  assert.equal(isNewEntry(e, null), true);
  assert.equal(isNewEntry(e, "2026-10-27T10:00:00.000Z"), false);
  assert.equal(isNewEntry(e, "2026-10-27T09:59:59.999Z"), true);
  assert.equal(isNewEntry({ ...e, unread: false }, null), false);
});

test("mergeBell: ordine per attività poi chiave, taglio a 40 prima di contare", () => {
  const signals = Array.from({ length: 30 }, (_, i) => entry(i + 1, new Date(Date.UTC(2026, 9, 27, 10, i)).toISOString()));
  const useCase = Array.from({ length: 30 }, (_, i) => ({ ...entry(100 + i, new Date(Date.UTC(2026, 9, 26, 10, i)).toISOString()), key: `n:${ID(100 + i)}` }));
  const tie = [entry(500, "2026-10-27T10:29:00.000Z", false)];
  const p = mergeBell({ workspaceId: WS, signals: [...signals, ...tie], dossier: [], useCase, seenAt: new Date("2026-10-27T10:15:00.000Z"), emailAlerts: { shown: false, on: true }, now: NOW });
  assert.equal(p.entries.length, BELL_MAX_ENTRIES);
  assert.equal(p.entries[0].activityAt, "2026-10-27T10:29:00.000Z");
  assert.ok(p.entries[0].key < p.entries[1].key, "a parità di istante, la chiave");
  for (let i = 1; i < p.entries.length; i++) assert.ok(Date.parse(p.entries[i - 1].activityAt) >= Date.parse(p.entries[i].activityAt));
  assert.equal(p.unreadCount, p.entries.filter((e) => e.unread).length);
  assert.equal(p.unreadCount, 39, "conta solo le righe che si vedono");
  assert.equal(p.newCount, 14, "le 14 dopo le 10:15");
  assert.equal(p.latestAt, "2026-10-27T10:29:00.000Z");
  assert.equal(p.seenAt, "2026-10-27T10:15:00.000Z");
  assert.equal(p.generatedAt, NOW.toISOString());
  const dup = mergeBell({ workspaceId: WS, signals: [entry(1, "2026-10-27T10:00:00.000Z"), entry(1, "2026-10-27T10:00:00.000Z")], dossier: [], useCase: [], seenAt: null, emailAlerts: { shown: true, on: false }, now: NOW });
  assert.equal(dup.entries.length, 1);
  assert.deepEqual(dup.emailAlerts, { shown: true, on: false });
  const empty = emptyBellPayload(WS, NOW);
  assert.deepEqual([empty.entries.length, empty.newCount, empty.unreadCount, empty.latestAt, empty.seenAt], [0, 0, 0, null, null]);
});

test("laterIso", () => {
  assert.equal(laterIso(null, null), null);
  assert.equal(laterIso("2026-10-27T10:00:00.000Z", null), "2026-10-27T10:00:00.000Z");
  assert.equal(laterIso("2026-10-27T10:00:00.000Z", "2026-10-27T11:00:00.000Z"), "2026-10-27T11:00:00.000Z");
  assert.equal(laterIso("x", "2026-10-27T11:00:00.000Z"), "2026-10-27T11:00:00.000Z");
});

test("signalHref: le regole della barra in alto, ad area accesa e spenta", () => {
  const item = { signalType: "new_portfolio_item", relatedEntityType: "use_case", relatedEntityId: UC };
  assert.equal(signalHref(WS, item, true), `/dashboard/${WS}/use-cases/${UC}`);
  assert.equal(signalHref(WS, item, false), `/dashboard/${WS}/portfolio/review/${UC}`);
  assert.equal(signalHref(WS, { ...item, relatedEntityType: null, relatedEntityId: null }, true), null);
  assert.equal(signalHref(WS, { ...item, relatedEntityType: null, relatedEntityId: null }, false), null);
  assert.equal(signalHref(WS, { signalType: "use_case_digest", relatedEntityType: null, relatedEntityId: null }, true), `/dashboard/${WS}/use-cases?vista=da-decidere`);
  assert.equal(signalHref(WS, { signalType: "use_case_quarter", relatedEntityType: null, relatedEntityId: null }, true), `/dashboard/${WS}/use-cases?vista=panoramica`);
  assert.equal(signalHref(WS, { signalType: "use_case_digest", relatedEntityType: null, relatedEntityId: null }, false), null);
  assert.equal(signalHref(WS, { signalType: "risk_alert", relatedEntityType: null, relatedEntityId: null }, true), null);
});

test("righe: segnale, dossier, use case", () => {
  const s = signalEntry(WS, { id: ID(1), title: "Nuovo use case", description: "x", signalType: "risk_alert", relatedEntityType: null, relatedEntityId: null, createdAt: "2026-10-27T09:30:00.123Z", read: false }, true);
  assert.deepEqual([s.key, s.source, s.activityAt, s.unread, s.href], [`s:${ID(1)}`, "segnale", "2026-10-27T09:30:00.123Z", true, null]);
  assert.equal(s.when, "27 ott, 10:30");
  const item: UcBellItem = { id: ID(2), ids: [ID(2)], workspaceId: WS, caseId: null, templateKey: "x", createdAt: "2026-10-27T09:00:00.000Z", when: "3 ore fa", context: null, title: "Riepilogo", description: null, href: null } as UcBellItem;
  assert.equal(dossierEntry(item, true).context, null);
  assert.equal(dossierEntry(item, false).context, "Casi d'uso");
  assert.equal(dossierEntry({ ...item, context: "XX-0012 · Smistamento" }, false).context, "XX-0012 · Smistamento");
  assert.equal(dossierEntry(item, true).unread, true);
  const n = noticeEntry(WS, { id: ID(3), useCaseId: UC, code: "TJ-0004", title: "Fatture fornitori", kind: "risposte", answers: 2, unknowns: 0, documents: 0, followUp: null, lastEventAt: new Date("2026-10-27T11:00:00.456Z"), readAt: null }, NOW);
  assert.deepEqual(n.ref, { source: "use_case", id: ID(3), at: "2026-10-27T11:00:00.456Z" });
  assert.equal(n.context, "TJ-0004 · Fatture fornitori");
  assert.equal(n.title, "Risposte arrivate");
  assert.equal(n.description, "2 risposte da verificare in «Cosa serve».");
  assert.equal(n.href, `/dashboard/${WS}/use-cases/${UC}?capitolo=cosa-serve`);
  assert.equal(n.unread, true);
});

test("dal client: riferimenti, corpi e istanti si controllano", () => {
  assert.deepEqual(parseBellReadRef({ source: "segnale", id: ID(1).toUpperCase() }), { source: "segnale", id: ID(1) });
  assert.deepEqual(parseBellReadRef({ source: "dossier", id: ID(1) }), { source: "dossier", id: ID(1) });
  assert.deepEqual(parseBellReadRef({ source: "use_case", id: ID(1), at: "2026-10-27T11:00:00.456Z" }), { source: "use_case", id: ID(1), at: "2026-10-27T11:00:00.456Z" });
  assert.equal(parseBellReadRef({ source: "use_case", id: ID(1) }), null, "senza at");
  assert.equal(parseBellReadRef({ source: "altro", id: ID(1) }), null);
  assert.equal(parseBellReadRef({ source: "segnale", id: "1" }), null);
  assert.equal(parseBellReadRef(null), null);
  assert.deepEqual(parseBellWriteBody({ op: "seen" }), { op: "seen" });
  assert.equal(parseBellWriteBody({ op: "seen", at: "x" }), null);
  assert.deepEqual(parseBellWriteBody({ op: "read", ref: { source: "segnale", id: ID(1) } }), { op: "read", ref: { source: "segnale", id: ID(1) } });
  assert.equal(parseBellWriteBody({ op: "read", ref: { source: "segnale", id: ID(1) }, extra: 1 }), null);
  assert.equal(parseBellWriteBody({ op: "read" }), null);
  assert.equal(parseBellWriteBody([]), null);
  assert.equal(parseUpTo("2026-10-27T11:00:00.456Z")?.toISOString(), "2026-10-27T11:00:00.456Z");
  assert.equal(parseUpTo("ieri"), null);
  assert.equal(parseUpTo(12), null);
  assert.equal(parseUpTo("2026-10-27"), null, "serve un istante");
});
