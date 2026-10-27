import test from "node:test";
import assert from "node:assert/strict";
import { BELL_READ_WAIT_MS, BELL_TEXT, bellAriaLabel, bellBadgeText, type BellEntry, type BellPayload, type BellWriteResult } from "../../lib/notifications/bell.ts";
import {
  bellMenuModel,
  bellReducer,
  initialBellState,
  runRowClick,
  visibleEntries,
  visibleNewCount,
  type BellEvent,
  type BellState,
  type RowClickDeps,
} from "./notifications-bell-state.ts";

// La campanella per persona nel browser (SPEC §P2.5.2, §P2.12.3): «se clicco sulla notifica poi non
// si toglie il numerino e rimane sempre lì». Il numero si azzera aprendola, una riga cliccata resta
// letta, e un payload letto un attimo prima non riporta indietro niente.

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 27, 9, minutes)).toISOString();
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function entry(n: number, minute: number, over: Partial<BellEntry> = {}): BellEntry {
  return {
    key: `s:${id(n)}`,
    source: "segnale",
    ref: { source: "segnale", id: id(n) },
    context: null,
    title: `Riga ${n}`,
    description: null,
    href: `/dashboard/ws/use-cases/${id(n)}`,
    activityAt: at(minute),
    when: "27 ott, 10:00",
    unread: true,
    ...over,
  };
}

function payload(entries: BellEntry[], o: { seenAt?: string | null; generatedAt?: string; emailShown?: boolean } = {}): BellPayload {
  const sorted = [...entries].sort((a, b) => Date.parse(b.activityAt) - Date.parse(a.activityAt));
  const seenAt = o.seenAt ?? null;
  return {
    workspaceId: "ws",
    entries: sorted,
    newCount: sorted.filter((e) => e.unread && (seenAt === null || Date.parse(e.activityAt) > Date.parse(seenAt))).length,
    unreadCount: sorted.filter((e) => e.unread).length,
    seenAt,
    latestAt: sorted[0]?.activityAt ?? null,
    emailAlerts: { shown: o.emailShown ?? false, on: true },
    generatedAt: o.generatedAt ?? at(30),
  };
}

const run = (s: BellState, ...events: BellEvent[]) => events.reduce(bellReducer, s);

test("il numero rosso: le righe non lette più nuove dell'ultima apertura; «9+» da 10", () => {
  const twelve = Array.from({ length: 12 }, (_, i) => entry(i + 1, i + 1));
  const s = initialBellState(payload(twelve, { seenAt: null }));
  assert.equal(visibleNewCount(s), 12);
  assert.equal(bellBadgeText(visibleNewCount(s)), "9+");
  assert.equal(bellAriaLabel(3), "Notifiche, 3 nuove");
  const seen = initialBellState(payload(twelve, { seenAt: at(10) }));
  assert.equal(visibleNewCount(seen), 2, "solo quelle dopo l'ultima apertura");
});

test("aprire azzera il numero subito; chiudere non lo riporta; le righe restano evidenziate", () => {
  const s0 = initialBellState(payload([entry(1, 1), entry(2, 2)], { seenAt: null }));
  const opened = bellReducer(s0, { type: "open" });
  assert.equal(visibleNewCount(opened), 0, "aperta");
  const closed = bellReducer(opened, { type: "close" });
  assert.equal(visibleNewCount(closed), 0, "chiusa: niente numero per le righe già mostrate");
  assert.deepEqual(bellMenuModel(closed).rows.map((r) => r.unread), [true, true], "ma ancora non lette");
  // «seen» dal server: il «visto fino a» non torna mai indietro.
  const seen = bellReducer(closed, { type: "seen", seenAt: at(5) });
  assert.equal(seen.seenOverride, at(5));
  assert.equal(bellReducer(seen, { type: "seen", seenAt: at(1) }).seenOverride, at(5));
});

test("gara: aperta con un payload vecchio, poi uno con una riga nuova → alla chiusura conta solo dopo il «visto» del server", () => {
  let s = initialBellState(payload([entry(1, 1)], { seenAt: null, generatedAt: at(10) }));
  s = run(s, { type: "open" }, { type: "seen", seenAt: at(20) });
  // La rilettura porta una riga arrivata mentre la pagina era ferma (prima del «visto»): si vede, non conta.
  s = run(s, { type: "payload", payload: payload([entry(1, 1), entry(2, 15)], { seenAt: at(20), generatedAt: at(21) }) }, { type: "close" });
  assert.equal(visibleNewCount(s), 0);
  assert.equal(bellMenuModel(s).rows.length, 2);
  // Una riga dopo il «visto» del server conta.
  s = bellReducer(s, { type: "payload", payload: payload([entry(1, 1), entry(2, 15), entry(3, 25)], { seenAt: at(20), generatedAt: at(26) }) });
  assert.equal(visibleNewCount(s), 1);
});

test("gara: una GET più nuova con il «visto» di prima, adottata dopo l'apertura → il numero resta 0", () => {
  let s = initialBellState(payload([entry(1, 1), entry(2, 2)], { seenAt: null, generatedAt: at(10) }));
  s = run(s, { type: "open" }, { type: "payload", payload: payload([entry(1, 1), entry(2, 2)], { seenAt: null, generatedAt: at(11) }) }, { type: "close" });
  assert.equal(visibleNewCount(s), 0);
  assert.equal(s.seenOverride, at(2), "il «visto» locale resta finché il server non lo raggiunge");
  s = bellReducer(s, { type: "payload", payload: payload([entry(1, 1), entry(2, 2)], { seenAt: at(12), generatedAt: at(13) }) });
  assert.equal(s.seenOverride, null, "il server lo ha raggiunto");
  assert.equal(visibleNewCount(s), 0);
});

test("un payload più vecchio di quello a schermo non si adotta", () => {
  const s = initialBellState(payload([entry(1, 1)], { generatedAt: at(20) }));
  const older = bellReducer(s, { type: "payload", payload: payload([], { generatedAt: at(19) }) });
  assert.equal(older, s);
});

test("clic: la riga resta letta anche con una GET vecchia che la dà ancora non letta; il server che la dà letta la libera", () => {
  const e1 = entry(1, 1);
  let s = initialBellState(payload([e1, entry(2, 2)], { generatedAt: at(10) }));
  s = bellReducer(s, { type: "optimisticRead", key: e1.key, at: e1.activityAt });
  assert.equal(visibleEntries(s).find((e) => e.key === e1.key)?.unread, false);
  s = bellReducer(s, { type: "payload", payload: payload([e1, entry(2, 2)], { generatedAt: at(11) }) });
  assert.equal(visibleEntries(s).find((e) => e.key === e1.key)?.unread, false, "GET letta prima della scrittura");
  assert.ok(s.readKeys.has(e1.key));
  s = bellReducer(s, { type: "payload", payload: payload([{ ...e1, unread: false }, entry(2, 2)], { generatedAt: at(12) }) });
  assert.equal(s.readKeys.has(e1.key), false, "chiave liberata");
  assert.equal(visibleEntries(s).find((e) => e.key === e1.key)?.unread, false);
  // Una riga raggruppata cresciuta dopo il clic (una risposta nuova) torna non letta.
  const bumped = bellReducer(bellReducer(initialBellState(payload([e1], { generatedAt: at(10) })), { type: "optimisticRead", key: e1.key, at: e1.activityAt }), {
    type: "payload",
    payload: payload([{ ...e1, activityAt: at(9) }], { generatedAt: at(11) }),
  });
  assert.equal(visibleEntries(bumped)[0].unread, true);
  assert.equal(bellReducer(bellReducer(s, { type: "optimisticRead", key: "x" }), { type: "revertRead", key: "x" }).readKeys.has("x"), false);
});

test("«Segna tutte come lette»: subito tutte lette fino all'ultima mostrata; con un errore torna com'era", () => {
  const s0 = initialBellState(payload([entry(1, 1), entry(2, 2)], { generatedAt: at(10) }));
  const all = bellReducer(s0, { type: "optimisticReadAll" });
  assert.equal(bellMenuModel(all).showReadAll, false);
  assert.equal(visibleNewCount(all), 0);
  // Una GET vecchia non le riporta; una riga arrivata dopo resta non letta.
  const stale = bellReducer(all, { type: "payload", payload: payload([entry(1, 1), entry(2, 2), entry(3, 5)], { generatedAt: at(11) }) });
  assert.deepEqual(visibleEntries(stale).map((e) => e.unread), [true, false, false]);
  assert.equal(stale.readAllUpTo, at(2));
  const confirmed = bellReducer(stale, { type: "payload", payload: payload([entry(1, 1, { unread: false }), entry(2, 2, { unread: false }), entry(3, 5)], { generatedAt: at(12) }) });
  assert.equal(confirmed.readAllUpTo, null);
  const reverted = bellReducer(all, { type: "revertReadAll", previous: s0 });
  assert.deepEqual(visibleEntries(reverted).map((e) => e.unread), [true, true]);
});

test("errore di rilettura: il testo sopra le righe, le righe restano; un payload nuovo lo toglie", () => {
  const s = bellReducer(initialBellState(payload([entry(1, 1)])), { type: "refreshFailed" });
  assert.equal(bellMenuModel(s).refreshText, BELL_TEXT.refreshFailed);
  assert.equal(bellMenuModel(s).rows.length, 1);
  assert.equal(bellMenuModel(bellReducer(s, { type: "payload", payload: payload([entry(1, 1)], { generatedAt: at(31) }) })).refreshText, null);
});

test("il menu: righe con link e «non letta», «Segna tutte come lette» solo con righe non lette, la scelta sulle email solo se mostrata, il vuoto", () => {
  const s = initialBellState(payload([entry(1, 1), entry(2, 2, { unread: false, href: null })], { emailShown: true }));
  const model = bellMenuModel(s);
  assert.deepEqual(
    model.rows.map((r) => [r.key, r.href !== null, r.unread]),
    [
      [`s:${id(2)}`, false, false],
      [`s:${id(1)}`, true, true],
    ],
  );
  assert.deepEqual([model.showReadAll, model.showEmailToggle, model.emailChecked, model.emptyText], [true, true, true, null]);
  const read = bellMenuModel(initialBellState(payload([entry(1, 1, { unread: false })])));
  assert.deepEqual([read.showReadAll, read.showEmailToggle], [false, false]);
  assert.equal(bellMenuModel(initialBellState(payload([]))).emptyText, BELL_TEXT.empty);
});

// ─── Il clic su una riga: cinque percorsi ───────────────────────────

function fakeDeps(result: Promise<BellWriteResult> | BellWriteResult, o: { timeoutFirst?: boolean } = {}) {
  const log: string[] = [];
  const events: BellEvent[] = [];
  let release: (() => void) | null = null;
  const deps: RowClickDeps = {
    markRead: (ref) => {
      log.push(`markRead:${ref.id}`);
      return Promise.resolve(result);
    },
    push: (href) => log.push(`push:${href}`),
    toast: (message) => log.push(`toast:${message}`),
    dispatch: (e) => {
      events.push(e);
      log.push(`dispatch:${e.type}`);
    },
    timeout: (ms) => {
      log.push(`timeout:${ms}`);
      return o.timeoutFirst ? Promise.resolve("timeout" as const) : new Promise<"timeout">((resolve) => (release = () => resolve("timeout")));
    },
    refetch: () => log.push("refetch"),
  };
  return { deps, log, events, release: () => release?.() };
}

test("clic semplice su una riga non letta: chiude, segna letta, aspetta la scrittura, rilegge, poi naviga", async () => {
  const e = entry(1, 1);
  const { deps, log } = fakeDeps({ ok: true, seenAt: null });
  await runRowClick(e, { plain: true }, deps);
  assert.deepEqual(log, ["dispatch:close", "dispatch:optimisticRead", `markRead:${id(1)}`, `timeout:${BELL_READ_WAIT_MS}`, "refetch", `push:${e.href}`]);
});

test("clic semplice con ok: false: la riga torna non letta, il toast lo dice, e si naviga lo stesso", async () => {
  const e = entry(1, 1);
  const { deps, log, events } = fakeDeps({ ok: false, code: "riprova", message: BELL_TEXT.errors.readOne });
  await runRowClick(e, { plain: true }, deps);
  assert.deepEqual(log, ["dispatch:close", "dispatch:optimisticRead", `markRead:${id(1)}`, `timeout:${BELL_READ_WAIT_MS}`, "dispatch:revertRead", `toast:${BELL_TEXT.errors.readOne}`, `push:${e.href}`]);
  assert.deepEqual(events.at(-1), { type: "revertRead", key: e.key });
});

test("scrittura lenta: dopo 1200 ms si naviga senza aspettare; il risultato in ritardo vale lo stesso", async () => {
  const e = entry(1, 1);
  let resolveWrite: (r: BellWriteResult) => void = () => {};
  const slow = new Promise<BellWriteResult>((resolve) => (resolveWrite = resolve));
  const { deps, log } = fakeDeps(slow, { timeoutFirst: true });
  await runRowClick(e, { plain: true }, deps);
  assert.deepEqual(log.slice(-1), [`push:${e.href}`]);
  assert.ok(!log.includes("refetch"));
  resolveWrite({ ok: false, code: "riprova", message: "lento" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(log.slice(-2), ["dispatch:revertRead", "toast:lento"]);
});

test("clic con un modificatore (nuova scheda): nessuna navigazione dalla campanella, la lettura parte senza aspettarla", async () => {
  const e = entry(1, 1);
  const { deps, log } = fakeDeps({ ok: true, seenAt: null });
  await runRowClick(e, { plain: false }, deps);
  assert.deepEqual(log.slice(0, 2), ["dispatch:optimisticRead", `markRead:${id(1)}`]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(log.includes("refetch"));
  assert.ok(!log.some((line) => line.startsWith("push:") || line === "dispatch:close" || line.startsWith("timeout:")));
});

test("clic semplice su una riga già letta: chiude e naviga, nessuna scrittura", async () => {
  const e = entry(1, 1, { unread: false });
  const { deps, log } = fakeDeps({ ok: true, seenAt: null });
  await runRowClick(e, { plain: true }, deps);
  assert.deepEqual(log, ["dispatch:close", `push:${e.href}`]);
});

test("una scrittura che rifiuta (rete) vale «riprova», con il testo della campanella", async () => {
  const e = entry(1, 1);
  const { deps, log } = fakeDeps({ ok: true, seenAt: null });
  deps.markRead = () => Promise.reject(new Error("rete"));
  await runRowClick(e, { plain: true }, deps);
  assert.ok(log.includes(`toast:${BELL_TEXT.errors.readOne}`));
  assert.equal(log.at(-1), `push:${e.href}`);
});
