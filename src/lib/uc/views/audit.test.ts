import test from "node:test";
import assert from "node:assert/strict";
import { UC_EVENT_TYPES } from "../../db/queries/uc-events.ts";
import { toStatement } from "../sql/statement.ts";
import { findForbidden } from "./copy-guard.ts";
import {
  ACTIVITY_PAGE_SIZE,
  AUDIT_EVENT_LABEL,
  AUDIT_FAMILIES,
  EMPTY_AUDIT_FILTER,
  activeAuditFilters,
  activityDayLabel,
  activityDays,
  activityText,
  activityWho,
  auditCsv,
  auditDetail,
  auditFamiliesFor,
  auditQuery,
  auditWhereSql,
  auditWhoFor,
  auditHasPeriod,
  dailyAnswerBars,
  dailyCountsAboveThreshold,
  parseAuditFilter,
  referentAnswersWhereSql,
  type ActivityRow,
} from "./audit.ts";
import { periodDateInput } from "./activity-period.ts";

const WS = "11111111-1111-4111-8111-111111111111";
const CASE = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-10-14T10:00:00Z");

let seq = 0;
function row(over: Partial<ActivityRow> & Pick<ActivityRow, "type">): ActivityRow {
  seq += 1;
  return {
    id: `e${seq}`,
    at: "2026-10-14T08:42:00Z",
    actorType: "utente",
    actorName: "Luca Verdi",
    targetType: null,
    fromState: null,
    toState: null,
    payload: {},
    actorKey: "utente:u1",
    actorIsLs: true,
    itemTitle: null,
    ...over,
  };
}

test("every event type has an Italian label and a filter family", () => {
  for (const type of UC_EVENT_TYPES) {
    if (type === "template.caricato") continue; // template events have no case
    assert.ok(AUDIT_EVENT_LABEL[type], type);
    assert.ok(type.split(".")[0] in AUDIT_FAMILIES, type);
  }
});

test("client viewers never filter by referent or by hidden families", () => {
  const f = parseAuditFilter({ tipo: "link", attore: "referente", dal: "2026-10-01", al: "2026-02-30", pagina: "3" }, true);
  assert.deepEqual(f, { famiglia: null, attore: null, chi: null, dal: "2026-10-01", al: null, pagina: 3 });
  const ls = parseAuditFilter(new URLSearchParams("tipo=link&attore=referente&pagina=0"), false);
  assert.deepEqual(ls, { famiglia: "link", attore: "referente", chi: null, dal: null, al: null, pagina: 1 });
  assert.equal(parseAuditFilter({ chi: "referenti" }, true).chi, null);
  assert.ok(!auditWhoFor(true).some((x) => x.key === "referenti"));
  assert.ok(auditWhoFor(false).some((x) => x.key === "referenti"));
  assert.ok(!auditFamiliesFor(true).some((x) => x.key === "link" || x.key === "informativa"));
  assert.equal(auditQuery(EMPTY_AUDIT_FILTER), "");
  assert.equal(auditQuery({ ...EMPTY_AUDIT_FILTER, famiglia: "voce" }, { pagina: 2 }), "?tipo=voce&pagina=2");
});

test("the client filter is in the SQL: no referent events, no link opens, no privacy notice views", () => {
  const client = toStatement(auditWhereSql({ workspaceId: WS, caseId: CASE, filter: EMPTY_AUDIT_FILTER, clientView: true }));
  assert.match(client.text, /e\.actor_type <> 'referente'/);
  assert.match(client.text, /NOT \(e\.event_type = ANY\(\$3::text\[\]\)\)/);
  assert.deepEqual(client.params, [CASE, WS, ["link.aperto", "informativa.vista"]]);
  const lead = toStatement(auditWhereSql({ workspaceId: WS, caseId: CASE, filter: { ...EMPTY_AUDIT_FILTER, famiglia: "voce", dal: "2026-10-01" }, clientView: false }));
  assert.doesNotMatch(lead.text, /referente/);
  assert.deepEqual(lead.params, [CASE, WS, "voce.%", "2026-10-01"]);
});

test("referent answers per day only when the filter can include them", () => {
  assert.equal(referentAnswersWhereSql({ workspaceId: WS, caseId: CASE, filter: { ...EMPTY_AUDIT_FILTER, famiglia: "voce" } }), null);
  assert.equal(referentAnswersWhereSql({ workspaceId: WS, caseId: CASE, filter: { ...EMPTY_AUDIT_FILTER, attore: "utente" } }), null);
  const s = toStatement(referentAnswersWhereSql({ workspaceId: WS, caseId: CASE, filter: EMPTY_AUDIT_FILTER })!);
  assert.match(s.text, /e\.actor_type = 'referente'/);
  assert.match(s.text, /risposta\.inviata/);
});

test("daily counts below 5 never show, not even summed on a narrow filter", () => {
  assert.deepEqual(
    dailyCountsAboveThreshold([
      { day: "2026-10-01", count: 7 },
      { day: "2026-10-03", count: 5 },
      { day: "2026-10-02", count: 3 },
      { day: "2026-10-04", count: 2 },
    ]),
    { days: [{ day: "2026-10-03", count: 5 }, { day: "2026-10-01", count: 7 }], below: 5 },
  );
  assert.deepEqual(dailyCountsAboveThreshold([{ day: "2026-10-02", count: 3 }]), { days: [], below: 0 });
});

test("with a period the small days are never summed: two ranges cannot be subtracted to reveal a day under 5", () => {
  const small = [
    { day: "2026-10-01", count: 3 },
    { day: "2026-10-02", count: 3 },
    { day: "2026-10-03", count: 4 },
  ];
  // Without dates the sum of the small days shows (10), as before.
  assert.deepEqual(dailyCountsAboveThreshold(small), { days: [], below: 10 });
  // From 2 October: 7 would show, and 10 − 7 = 3 would be the count of 1 October. With a period nothing is summed.
  const from2 = dailyCountsAboveThreshold(small.slice(1), { period: true });
  assert.deepEqual(from2, { days: [], below: 0 });
  assert.deepEqual(dailyCountsAboveThreshold([{ day: "2026-10-04", count: 6 }, ...small], { period: true }), { days: [{ day: "2026-10-04", count: 6 }], below: 0 });
  assert.equal(auditHasPeriod({ dal: "2026-10-02", al: null }), true);
  assert.equal(auditHasPeriod({ dal: null, al: "2026-10-02" }), true);
  assert.equal(auditHasPeriod(EMPTY_AUDIT_FILTER), false);
  assert.deepEqual(dailyCountsAboveThreshold(small, { min: 3 }), { days: [{ day: "2026-10-03", count: 4 }, { day: "2026-10-02", count: 3 }, { day: "2026-10-01", count: 3 }], below: 0 });
});

test("details show states, keys and counts, never free text", () => {
  assert.equal(
    auditDetail({ fromState: "in_verifica", toState: "validata", payload: { item_key: "q.a.01", trigger: "valida", note: "testo libero" } }),
    "in_verifica → validata · voce: q.a.01 · causa: valida",
  );
  assert.equal(auditDetail({ fromState: null, toState: null, payload: { blocker_key: "a8", ruolo: "ls_lead", complete: false } }), "blocco: a8 · firma come: ls_lead · firme in attesa");
});

test("CSV export guards formulas and adds daily answers", () => {
  const csv = auditCsv(
    [{ id: "e1", at: "2026-10-05T08:30:00Z", type: "voce.assegnata", actorType: "utente", actorName: "=SOMMA(A1)", targetType: "voce", fromState: null, toState: null, payload: { item_key: "q.a.01" } }],
    { days: [{ day: "2026-10-05", count: 6 }], below: 0 },
  );
  assert.ok(csv.startsWith("﻿"));
  const lines = csv.trim().split("\r\n");
  assert.equal(lines.length, 3);
  assert.match(lines[1], /"'=SOMMA\(A1\) \(persona con account\)"/);
  assert.match(lines[1], /"05\/10\/2026 10:30"/);
  assert.match(lines[2], /"Risposte ricevute";"Referenti";"6"/);
});

test("«Chi» filters Lateral Space and client people by verified email domain, and wins over the old actor filter", () => {
  const f = parseAuditFilter({ chi: "ls", attore: "sistema", tipo: "voce" }, false);
  assert.equal(f.chi, "ls");
  assert.equal(f.attore, null);
  assert.equal(auditQuery(f), "?tipo=voce&chi=ls");
  assert.equal(auditQuery({ ...EMPTY_AUDIT_FILTER, attore: "utente" }), "?attore=utente");
  assert.equal(activeAuditFilters({ ...f, dal: "2026-10-01", al: "2026-10-02" }), 3);
  assert.equal(parseAuditFilter({ chi: "tutti" }, false).chi, null);

  const ls = toStatement(auditWhereSql({ workspaceId: WS, caseId: CASE, filter: f, clientView: false, lsDomains: ["ls.test"] }));
  assert.match(ls.text, /e\.actor_type = 'utente' AND EXISTS \(SELECT 1 FROM users lu WHERE lu\.id = e\.actor_user_id AND lu\.email_verified IS NOT NULL/);
  assert.match(ls.text, /regexp_replace\(btrim\(lu\.email\), '\^\.\*@', ''\)\) = ANY\(\$4::text\[\]\)/);
  assert.deepEqual(ls.params, [CASE, WS, "voce.%", ["ls.test"]]);
  const client = toStatement(auditWhereSql({ workspaceId: WS, caseId: CASE, filter: { ...EMPTY_AUDIT_FILTER, chi: "cliente" }, clientView: true, lsDomains: ["ls.test"] }));
  assert.match(client.text, /e\.actor_type <> 'referente'/, "the art. 15.4 filter stays");
  assert.match(client.text, /AND NOT EXISTS \(SELECT 1 FROM users lu/);
  const claude = toStatement(auditWhereSql({ workspaceId: WS, caseId: CASE, filter: { ...EMPTY_AUDIT_FILTER, chi: "claude" }, clientView: false }));
  assert.match(claude.text, /e\.actor_type = 'mcp'/);
  assert.equal(referentAnswersWhereSql({ workspaceId: WS, caseId: CASE, filter: { ...EMPTY_AUDIT_FILTER, chi: "ls" } }), null, "no daily answers with a «Chi» filter");
  assert.equal(ACTIVITY_PAGE_SIZE, 50);
});

test("every event type reads as a sentence with a subject, never as a code", () => {
  for (const type of UC_EVENT_TYPES) {
    for (const audience of ["ls", "cliente"] as const) {
      const r = row({ type, itemTitle: "Quanti preventivi si perdono ogni mese", payload: { item_key: "q.vendite.01", blocker_key: "costi_art_8_4", gate: "G1", version: 2, format: "xlsx" } });
      const { who, text } = activityText(r, audience);
      assert.equal(who, "Luca Verdi (Lateral Space)");
      assert.doesNotMatch(text, /ha fatto un'azione/, type);
      assert.match(text, /^(ha|non) /, type);
      assert.deepEqual(findForbidden(`${who} ${text}`, "cliente"), [], `${type}: ${text}`);
      const auto = activityText({ ...r, actorType: "sistema", actorName: null, actorIsLs: false, actorKey: "sistema" }, audience);
      assert.equal(auto.who, null);
      assert.match(auto.text, /^[A-Z«0-9]/, type);
      assert.deepEqual(findForbidden(auto.text, "cliente"), [], `${type}: ${auto.text}`);
    }
  }
});

test("sentences use titles and plain words: states, the via, the privacy form", () => {
  const title = "Quanti preventivi si perdono ogni mese per mancanza di risposta da parte del commerciale di zona competente";
  const validated = activityText(row({ type: "voce.stato_cambiato", toState: "validata", itemTitle: title, payload: { item_key: "q.x.01" } }), "ls");
  assert.equal(validated.text, "ha validato «Quanti preventivi si perdono ogni mese per mancanza di risposta da parte del…»");
  assert.doesNotMatch(validated.text, /q\.x\.01/);
  assert.equal(activityText(row({ type: "voce.stato_cambiato", toState: "in_verifica", itemTitle: "Sconti" }), "cliente").text, "ha portato «Sconti» a «In verifica»");
  assert.equal(activityText(row({ type: "voce.stato_cambiato", toState: "in_verifica", itemTitle: "Sconti" }), "ls").text, "ha portato «Sconti» a «Da verificare»");
  assert.equal(activityText(row({ type: "caso.stato_cambiato", toState: "raccolta" }), "ls").text, "ha portato il caso a «In preparazione»");
  assert.equal(activityText(row({ type: "gate.proposto", payload: { gate: "G1" } }), "cliente").text, "ha proposto il via allo sviluppo");
  assert.equal(activityText(row({ type: "blocco.firmato", payload: { blocker_key: "a8" } }), "cliente").text, "ha firmato la scheda privacy");
  assert.equal(activityText(row({ type: "blocco.sciolto", payload: { blocker_key: "costi_art_8_4" } }), "cliente").text, "ha sciolto il blocco «Costi da approvare»");
  assert.equal(activityText(row({ type: "catalogo.esportato", payload: { format: "xlsx", version: 1 } }), "cliente").text, "ha scaricato il catalogo v1 in Excel");
  assert.equal(activityText(row({ type: "catalogo.esportato", payload: { format: "json", version: "bozza" } }), "ls").text, "ha scaricato la bozza del catalogo in JSON");
  assert.equal(activityText(row({ type: "risposta.inviata", itemTitle: null }), "ls").text, "ha registrato una risposta a una domanda");
  assert.equal(activityText(row({ type: "gate.approvato", actorType: "sistema", actorName: null, actorIsLs: false }), "ls").text, "Via allo sviluppo approvato.");
  assert.equal(activityText(row({ type: "catalogo.letto_mcp", actorType: "mcp", actorName: null, actorIsLs: false }), "ls").who, "Claude");
});

test("who acted: the name, «(Lateral Space)» for Lateral Space, never an email for the client", () => {
  assert.equal(activityWho({ actorType: "utente", actorName: "Luca Verdi", actorIsLs: true }), "Luca Verdi (Lateral Space)");
  assert.equal(activityWho({ actorType: "utente", actorName: "Anna Bianchi", actorIsLs: false }), "Anna Bianchi");
  assert.equal(activityWho({ actorType: "utente", actorName: null, actorIsLs: false }), "Una persona del cliente");
  assert.equal(activityWho({ actorType: "referente", actorName: "Mario Rossi", actorIsLs: false }), "Mario Rossi");
  assert.equal(activityWho({ actorType: "referente", actorName: null, actorIsLs: false }), "Un referente");
  assert.equal(activityWho({ actorType: "sistema", actorName: null, actorIsLs: false }), null);
});

test("the timeline groups by day of Rome and joins the same person's consecutive answers", () => {
  const ref = { actorType: "referente" as const, actorName: "Mario Rossi", actorIsLs: false, actorKey: "referente:c1" };
  const days = activityDays(
    [
      row({ type: "risposta.inviata", at: "2026-10-14T08:42:00Z", itemTitle: "A", ...ref }),
      row({ type: "risposta.inviata", at: "2026-10-14T08:41:00Z", itemTitle: "B", ...ref }),
      row({ type: "risposta.inviata", at: "2026-10-14T08:40:00Z", itemTitle: "C", ...ref }),
      row({ type: "voce.stato_cambiato", toState: "validata", at: "2026-10-14T07:15:00Z", itemTitle: "Quanti preventivi si perdono" }),
      row({ type: "risposta.inviata", at: "2026-10-14T07:10:00Z", itemTitle: "D", ...ref }),
      row({ type: "risposta.inviata", at: "2026-10-13T21:30:00Z", itemTitle: "E", ...ref }),
      row({ type: "risposta.inviata", at: "2026-10-13T21:20:00Z", itemTitle: "F", ...ref, actorKey: "referente:c2", actorName: "Paola Neri" }),
      row({ type: "caso.creato", at: "2026-10-01T09:00:00Z" }),
    ],
    { now: NOW, audience: "ls" },
  );
  assert.deepEqual(
    days.map((d) => [d.key, d.label, d.lines.map((l) => [l.time, l.who, l.text, l.count])]),
    [
      [
        "2026-10-14",
        "Oggi",
        [
          ["10:42", "Mario Rossi", "ha risposto a 3 domande", 3],
          ["09:15", "Luca Verdi (Lateral Space)", "ha validato «Quanti preventivi si perdono»", 1],
          ["09:10", "Mario Rossi", "ha risposto a «D»", 1],
        ],
      ],
      [
        "2026-10-13",
        "Ieri",
        [
          ["23:30", "Mario Rossi", "ha risposto a «E»", 1],
          ["23:20", "Paola Neri", "ha risposto a «F»", 1],
        ],
      ],
      ["2026-10-01", "1 ott", [["11:00", "Luca Verdi (Lateral Space)", "ha creato il dossier", 1]]],
    ],
  );
});

test("day labels are relative within 7 days, then absolute", () => {
  assert.equal(activityDayLabel("2026-10-14", NOW), "Oggi");
  assert.equal(activityDayLabel("2026-10-13", NOW), "Ieri");
  assert.equal(activityDayLabel("2026-10-11", NOW), "3 giorni fa");
  assert.equal(activityDayLabel("2026-10-07", NOW), "7 ott");
  assert.equal(activityDayLabel("2025-12-30", NOW), "30 dic 2025");
  assert.equal(activityDays([row({ type: "caso.creato", at: "2026-10-13T22:30:00Z" })], { now: NOW, audience: "ls" })[0].label, "Oggi", "00:30 in Rome is already the 14th");
});

test("daily bars for the client keep the same numbers as the threshold", () => {
  const bars = dailyAnswerBars({ days: [{ day: "2026-10-14", count: 12 }, { day: "2026-10-02", count: 6 }], below: 5 }, NOW);
  assert.deepEqual(
    bars.map((b) => [b.label, b.count, b.percent]),
    [
      ["Oggi", 12, 100],
      ["2 ott", 6, 50],
      ["Altri giorni, insieme", 5, 42],
    ],
  );
  assert.deepEqual(dailyAnswerBars({ days: [], below: 0 }, NOW), []);
});

test("family labels follow the vocabulary: questions, the via, activity", () => {
  assert.equal(AUDIT_FAMILIES.voce, "Domande");
  assert.equal(AUDIT_FAMILIES.gate, "Via allo sviluppo");
  for (const label of [...Object.values(AUDIT_FAMILIES), ...Object.values(AUDIT_EVENT_LABEL)]) {
    assert.deepEqual(findForbidden(label, "cliente"), [], label);
  }
});

test("«Periodo»: a date applies only when complete and from 2000, otherwise the applied one stays", () => {
  // Typing the year of 2026 digit by digit gives 0002-…, 0020-…, 0202-… before 2026-…: none of them is a filter.
  for (const partial of ["0002-10-14", "0020-10-14", "0202-10-14", "1999-12-31"]) {
    assert.equal(periodDateInput(partial, null), null, partial);
    assert.equal(periodDateInput(partial, "2026-10-01"), "2026-10-01", partial);
  }
  assert.equal(periodDateInput("2026-10-14", null), "2026-10-14");
  assert.equal(periodDateInput("2026-02-30", "2026-10-01"), "2026-10-01", "an impossible date keeps the applied one");
  assert.equal(periodDateInput("", "2026-10-01"), null, "an empty field removes the limit");
  assert.equal(periodDateInput("  ", "2026-10-01"), null);
  // The server reads the URL with the same rule.
  assert.deepEqual(parseAuditFilter({ dal: "0002-10-14", al: "2026-10-14" }, false), { ...EMPTY_AUDIT_FILTER, dal: null, al: "2026-10-14" });
});
