import test from "node:test";
import assert from "node:assert/strict";
import { romeLocalToUtc } from "../../uc/calendar.ts";
import {
  REFERENT_REMINDER_DAYS,
  isStaleEmail,
  manualReminderCheck,
  nextReminderOn,
  referentExpiresAt,
  referentReminderDue,
  retentionDue,
  sameRomeDay,
  type ReminderState,
} from "./schedule.ts";

// Il calendario di «Chiedi al referente» (SPEC §3.6). Ore di Roma.
const at = (date: string, hour: number, minute = 0) => romeLocalToUtc(date, hour, minute);
const SENT = at("2026-11-02", 10); // lunedì

function state(over: Partial<ReminderState> = {}): ReminderState {
  return {
    status: "inviata",
    sentAt: SENT,
    expiresAt: referentExpiresAt(SENT),
    revokedAt: null,
    reminderCount: 0,
    lastEmailAt: SENT,
    openItems: 2,
    ...over,
  };
}

test("soglie: 3 e 7 giorni lavorativi", () => {
  assert.deepEqual(REFERENT_REMINDER_DAYS, { primo: 3, ultimo: 7 });
});

test("primo promemoria al terzo giorno lavorativo, nella finestra 9-18", () => {
  assert.equal(referentReminderDue(state(), at("2026-11-04", 10)), null, "giorno 2");
  assert.equal(referentReminderDue(state(), at("2026-11-05", 10)), "primo", "giorno 3");
  assert.equal(referentReminderDue(state(), at("2026-11-05", 8, 59)), null, "prima delle 9");
  assert.equal(referentReminderDue(state(), at("2026-11-05", 18)), null, "dalle 18");
  assert.equal(referentReminderDue(state(), at("2026-11-07", 10)), null, "sabato");
  assert.equal(referentReminderDue(state(), at("2026-11-08", 10)), null, "domenica");
});

test("ultimo promemoria al settimo giorno lavorativo; mai un terzo", () => {
  const after = state({ reminderCount: 1, lastEmailAt: at("2026-11-05", 10) });
  assert.equal(referentReminderDue(after, at("2026-11-10", 10)), null, "giorno 6");
  assert.equal(referentReminderDue(after, at("2026-11-11", 10)), "ultimo", "giorno 7");
  assert.equal(referentReminderDue(state({ reminderCount: 2, lastEmailAt: at("2026-11-11", 10) }), at("2026-11-20", 10)), null);
});

test("Pasqua e Pasquetta non contano", () => {
  const sent = at("2026-04-02", 10); // giovedì
  const s = state({ sentAt: sent, lastEmailAt: sent, expiresAt: referentExpiresAt(sent) });
  assert.equal(referentReminderDue(s, at("2026-04-06", 10)), null, "Pasquetta");
  assert.equal(referentReminderDue(s, at("2026-04-07", 10)), null, "giorno 2");
  assert.equal(referentReminderDue(s, at("2026-04-08", 10)), "primo", "giorno 3");
});

test("mai due email lo stesso giorno; un promemoria a mano il giorno 2 sposta il primo al giorno 4", () => {
  assert.equal(referentReminderDue(state({ lastEmailAt: at("2026-11-05", 9, 30) }), at("2026-11-05", 10)), null);
  const manual = state({ lastEmailAt: at("2026-11-04", 11) });
  assert.equal(referentReminderDue(manual, at("2026-11-05", 10)), null, "giorno 3, un giorno dopo l'email a mano");
  assert.equal(referentReminderDue(manual, at("2026-11-06", 10)), "primo", "giorno 4");
  assert.equal(nextReminderOn(manual, at("2026-11-04", 12)), "2026-11-06");
});

test("niente promemoria su richieste chiuse, scadute, revocate, senza domande aperte o non partite", () => {
  const now = at("2026-11-05", 10);
  assert.equal(referentReminderDue(state({ status: "completata" }), now), null);
  assert.equal(referentReminderDue(state({ status: "revocata", revokedAt: SENT }), now), null);
  assert.equal(referentReminderDue(state({ expiresAt: at("2026-11-05", 9) }), now), null);
  assert.equal(referentReminderDue(state({ openItems: 0 }), now), null);
  assert.equal(referentReminderDue(state({ sentAt: null, lastEmailAt: null }), now), null);
});

test("la scadenza: 30 giorni dalla creazione", () => {
  assert.equal(referentExpiresAt(SENT).getTime() - SENT.getTime(), 30 * 86_400_000);
});

test("nextReminderOn: il giorno del prossimo promemoria, oppure null", () => {
  assert.equal(nextReminderOn(state(), at("2026-11-02", 12)), "2026-11-05");
  assert.equal(nextReminderOn(state({ reminderCount: 1, lastEmailAt: at("2026-11-05", 10) }), at("2026-11-05", 12)), "2026-11-11");
  assert.equal(nextReminderOn(state({ reminderCount: 2 }), at("2026-11-05", 12)), null);
  // Il giorno è oggi ma è già sera: il prossimo giorno lavorativo.
  assert.equal(nextReminderOn(state(), at("2026-11-06", 19)), "2026-11-09");
});

test("promemoria a mano: adesso nella finestra, altrimenti alle 9 del prossimo giorno lavorativo", () => {
  const none = { remindedOn: new Set<string>() };
  const inside = manualReminderCheck(state(), at("2026-11-04", 15), none);
  assert.deepEqual(inside, { ok: true, scheduledAt: at("2026-11-04", 15) });
  // Venerdì alle 21: lunedì alle 9.
  const friday = manualReminderCheck(state(), at("2026-11-06", 21), none);
  assert.deepEqual(friday, { ok: true, scheduledAt: at("2026-11-09", 9) });
  // La persona ha già un promemoria quel giorno, su qualunque richiesta.
  assert.deepEqual(manualReminderCheck(state(), at("2026-11-06", 21), { remindedOn: new Set(["2026-11-09"]) }), { ok: false, code: "promemoria_gia_inviato" });
  // La stessa richiesta ha già avuto un'email quel giorno.
  assert.deepEqual(manualReminderCheck(state({ lastEmailAt: at("2026-11-04", 9, 5) }), at("2026-11-04", 15), none), { ok: false, code: "promemoria_gia_inviato" });
  assert.deepEqual(manualReminderCheck(state({ status: "completata" }), at("2026-11-04", 15), none), { ok: false, code: "richiesta_chiusa" });
  assert.deepEqual(manualReminderCheck(state({ sentAt: null, lastEmailAt: null }), at("2026-11-04", 15), none), { ok: false, code: "non_ancora_inviata" });
  assert.deepEqual(manualReminderCheck(state({ openItems: 0 }), at("2026-11-04", 15), none), { ok: false, code: "nessuna_domanda_aperta" });
  // Il prossimo inizio della finestra cade dopo la scadenza.
  assert.deepEqual(manualReminderCheck(state({ expiresAt: at("2026-11-09", 8) }), at("2026-11-06", 21), none), { ok: false, code: "richiesta_chiusa" });
});

test("sameRomeDay", () => {
  assert.equal(sameRomeDay(null, SENT), false);
  assert.equal(sameRomeDay(at("2026-11-02", 0, 30), at("2026-11-02", 23, 30)), true);
  assert.equal(sameRomeDay(at("2026-11-02", 23, 30), at("2026-11-03", 0, 30)), false);
});

test("isStaleEmail: più di 2 giorni lavorativi dopo due_at (venerdì → lunedì non è vecchia)", () => {
  const due = at("2026-11-06", 10);
  assert.equal(isStaleEmail(due, at("2026-11-09", 10)), false);
  assert.equal(isStaleEmail(due, at("2026-11-10", 10)), false);
  assert.equal(isStaleEmail(due, at("2026-11-11", 10)), true);
});

test("retentionDue: 12 mesi di calendario, a Roma, anche a fine mese", () => {
  assert.equal(retentionDue(at("2026-01-31", 12), at("2027-01-30", 12)), false);
  assert.equal(retentionDue(at("2026-01-31", 12), at("2027-01-31", 0, 30)), true);
  assert.equal(retentionDue(at("2028-02-29", 12), at("2029-02-27", 12)), false);
  assert.equal(retentionDue(at("2028-02-29", 12), at("2029-02-28", 12)), true);
});
