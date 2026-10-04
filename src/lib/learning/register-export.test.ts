import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import type { TrainingRegister } from "./register";
import { registerFileName, registerPdf, registerXlsx } from "./register-export.ts";

const EXPORT = { exportId: "5b7d0c1e-8a4f-4c2b-9f3e-2d1a6b8c9e01", generatedBy: "Formatrice Prova" };
const session = { programId: "p1", programTitle: "Percorso AI · Città & Co.", moduleId: "m1", moduleTitle: "Modulo 1 — Perché è utile", cohortId: "turno-a",
  startsAt: "2026-10-05T12:30:00.000Z", endsAt: "2026-10-05T14:00:00.000Z", timezone: "Europe/Rome", durationMinutes: 90,
  state: "svolta" as const, participants: 2, manualParticipants: 1, allExercises: 1, undocumented: 0, enrolled: 2, article4: "modificato" as const };
const base = { programId: "p1", programTitle: session.programTitle, moduleId: "m1", moduleTitle: session.moduleTitle, cohortId: "turno-a",
  sessionStartsAt: session.startsAt, sessionHeld: true, manualEntryId: null, manualNote: null, recordedBy: null, recordedAt: null };

const register: TrainingRegister = {
  generatedAt: "2026-10-05T15:00:00.000Z",
  organization: { name: "Città Srl", legalName: "Città S.r.l.", workspaceLegalName: "Città S.r.l.", workspaceName: "Città",
    companyNames: { "esempio.it": "Esempio S.p.A." }, aiActRole: "deployer", registerOwner: "Anna Bianchi, HR", aiSystems: ["ChatGPT Enterprise", "Copilot"],
    useContext: "Uffici amministrativi; nessun uso su clienti finali.", trainers: "Pierpaolo Laurito (Lateral Space)", otherInitiatives: null,
    settingsUpdatedAt: "2026-10-04T10:00:00.000Z", settingsUpdatedBy: "Anna Bianchi" },
  provider: { name: "Lateral Space", platform: "Unbundle" },
  scoped: false,
  domain: null,
  companies: [{ domain: "esempio.it", people: 1, legalName: "Esempio S.p.A." }, { domain: "esempio-lungo-dominio-aziendale.it", people: 1, legalName: null }],
  withoutCompany: 0,
  needsAssessments: [{ name: "Rilevazione competenze", status: "active", completed: 19, createdAt: "2026-09-20T08:00:00.000Z" }],
  programs: [{ id: "p1", title: session.programTitle, contentVersion: "1.0.0", packHash: "a".repeat(64), sourceSnapshotSha: "b".repeat(40),
    publishedAt: "2026-10-01T08:00:00.000Z", status: "published", closedAt: null, retentionDays: 365,
    modules: [{ id: "m1", title: session.moduleTitle, subtitle: "Dal dubbio all'uso", objective: "Capire dove l'IA aiuta e dove no.", durationMinutes: 90,
      agenda: [{ from: 0, to: 15, title: "Apertura" }], competencies: ["Verifica delle fonti"], exercises: ["Caso pratico", "Verifica finale"] }],
    materials: [{ title: "Cartella esercizi", fileName: "esercizi.zip", sha256: "c".repeat(64), audience: "learners", moduleId: "m1", createdAt: "2026-10-02T08:00:00.000Z" }] }],
  sessions: [session],
  participants: [
    { ...base, key: "u:1", userId: "u1", name: "Mario Rossi", email: "mario.rossi@esempio-lungo-dominio-aziendale.it", source: "piattaforma",
      joinedAt: "2026-10-05T12:31:00.000Z", joinTiming: "durante_la_lezione", joinLabel: "Ingresso alla lezione",
      required: 2, submitted: 2, status: "esercitazioni_completate", statusLabel: "Ha consegnato tutte le esercitazioni" },
    { ...base, key: "u:2", userId: "u2", name: "Lucia Verdi", email: "lucia@esempio.it", source: "piattaforma",
      joinedAt: "2026-10-05T12:40:00.000Z", joinTiming: "durante_la_lezione", joinLabel: "Ingresso alla lezione",
      required: 2, submitted: 1, status: "esercitazioni_in_parte", statusLabel: "Ha consegnato parte delle esercitazioni" },
    { ...base, key: "m:1", userId: null, name: "Giorgio Neri", email: null, source: "registrazione_manuale", joinedAt: null, joinTiming: null,
      joinLabel: "Registrata dal formatore", required: 0, submitted: 0, status: "presenza_manuale", statusLabel: "Presenza registrata dal formatore",
      manualEntryId: "e1", manualNote: "Telefono scarico", recordedBy: "Formatrice Prova", recordedAt: "2026-10-05T14:05:00.000Z" },
  ],
  corrections: [{ id: "e0", personName: "Nome Sbagliato", personEmail: null, moduleTitle: session.moduleTitle, cohortId: "turno-a",
    recordedAt: "2026-10-05T14:01:00.000Z", recordedBy: "Formatrice Prova", voidedAt: "2026-10-05T14:02:00.000Z", voidedBy: "Formatrice Prova", voidReason: "Nome scritto male" }],
  totals: { people: 3, peopleAttended: 3, peopleUpcoming: 0, participations: 3, allExercises: 1, manualEntries: 1, undocumented: 0, sessionsHeld: 1, hoursDelivered: 1.5, sessionsScheduled: 0 },
};

test("il PDF è un PDF valido, con le lettere accentate codificate e i dati del registro", () => {
  const pdf = registerPdf(register, EXPORT);
  const text = pdf.toString("latin1");
  assert.ok(text.startsWith("%PDF-1.4"));
  assert.ok(text.trimEnd().endsWith("%%EOF"));
  assert.match(text, /\/Encoding \/WinAnsiEncoding/);
  assert.ok(text.includes("Città S.r.l."), "le accentate passano come byte Latin-1");
  assert.ok(text.includes("Mario Rossi"));
  assert.ok(text.includes(EXPORT.exportId));
  assert.ok(text.includes("c".repeat(30)), "l'impronta dei materiali è nel documento");
});

test("una parola più larga della colonna va a capo invece di uscire dal margine", () => {
  const text = registerPdf(register, EXPORT).toString("latin1");
  const shown = [...text.matchAll(/\(([^)]*)\) Tj/g)].map((m) => m[1]);
  assert.ok(!shown.includes("c".repeat(64)), "l'impronta da 64 caratteri non sta in una cella da sola");
  assert.ok(shown.some((s) => /^c{10,63}$/.test(s)));
});

test("il registro non riporta punteggi né risposte, in nessuno dei due formati", () => {
  const pdf = registerPdf(register, EXPORT).toString("latin1").toLowerCase();
  const book = XLSX.read(registerXlsx(register, EXPORT));
  const cells = book.SheetNames.flatMap((name) => XLSX.utils.sheet_to_json<string[]>(book.Sheets[name], { header: 1 }).flat()).join(" ").toLowerCase();
  // Diciture di esito: l'avvertenza «non che sia stata superata» è ammessa.
  for (const word of ["punteggio", "corrette", "superato", "bocciat", "voto", "livello raggiunto"]) {
    assert.ok(!pdf.includes(word), `PDF: ${word}`);
    assert.ok(!cells.includes(word), `Excel: ${word}`);
  }
});

test("l'Excel ha un foglio per ogni parte del registro e una riga per partecipante", () => {
  const book = XLSX.read(registerXlsx(register, EXPORT));
  assert.deepEqual(book.SheetNames, ["Registro", "Partecipanti", "Sessioni", "Contenuti", "Materiali", "Rilevazione bisogni", "Correzioni", "Note"]);
  const people = XLSX.utils.sheet_to_json<Record<string, string | number>>(book.Sheets.Partecipanti);
  assert.equal(people.length, 3);
  assert.equal(people[0]["Esercitazioni consegnate"], 2);
  assert.equal(people[2]["Fonte"], "Registrata dal formatore");
  assert.equal(people[0]["Accesso dal link"], "05/10/2026 14:31", "orari nel fuso di Roma");
  const cover = XLSX.utils.sheet_to_json<string[]>(book.Sheets.Registro, { header: 1 });
  assert.ok(cover.some((row) => row[0] === "Codice esportazione" && row[1] === EXPORT.exportId));
});

test("il nome del file dice cosa contiene e di chi è", () => {
  assert.equal(registerFileName(register, "pdf"), "registro-formazione-ia-citta-srl-2026-10-05.pdf");
});

test("un registro vuoto si esporta comunque, dicendo che è vuoto", () => {
  const empty: TrainingRegister = { ...register, programs: [], sessions: [], participants: [], corrections: [], needsAssessments: [],
    organization: { ...register.organization, legalName: null, registerOwner: null, aiSystems: [], useContext: null, trainers: null, settingsUpdatedAt: null },
    totals: { people: 0, peopleAttended: 0, peopleUpcoming: 0, participations: 0, allExercises: 0, manualEntries: 0, undocumented: 0, sessionsHeld: 0, hoursDelivered: 0, sessionsScheduled: 0 } };
  const text = registerPdf(empty, EXPORT).toString("latin1");
  assert.ok(text.includes("Nessun partecipante."));
  assert.ok(text.includes("Non indicato"));
  assert.equal(XLSX.utils.sheet_to_json(XLSX.read(registerXlsx(empty, EXPORT)).Sheets.Partecipanti).length, 0);
});

test("la copia di una società porta la sua ragione sociale e dice chi include", () => {
  const scoped: TrainingRegister = { ...register, domain: "esempio.it", withoutCompany: 1,
    organization: { ...register.organization, name: "Esempio S.p.A.", legalName: "Esempio S.p.A." },
    participants: register.participants.filter((p) => p.email?.endsWith("@esempio.it")) };
  const text = registerPdf(scoped, EXPORT).toString("latin1");
  assert.ok(text.includes("Persone con indirizzo email @esempio.it"));
  assert.ok(text.includes("Una presenza senza email aziendale non"));
  assert.equal(registerFileName(scoped, "xlsx"), "registro-formazione-ia-esempio-s-p-a-2026-10-05.xlsx");
  const people = XLSX.utils.sheet_to_json<Record<string, string>>(XLSX.read(registerXlsx(scoped, EXPORT)).Sheets.Partecipanti);
  assert.deepEqual(people.map((p) => p["Società"]), ["Esempio S.p.A."]);
});
