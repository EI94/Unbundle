import * as XLSX from "xlsx";
import { ACCENT, CONTENT_W, GRAY, INK, LIGHT, MARGIN, PdfBuilder } from "../documents/pdf.ts";
import type { TrainingRegister } from "./register";
import { dateTime, isoDay, longDate, sessionLabel, sessionStateLabel as sessionState } from "./register-format.ts";
import { companyDomain } from "./register-model.ts";
import {
  criteriaMap,
  integrity,
  legalFramework,
  limits,
  notIncluded,
  presenceDefinition,
  registerSubtitle,
  registerTitle,
} from "./register-legal.ts";

/**
 * Le due copie esportabili del registro: PDF da mostrare o stampare, Excel da
 * filtrare. Stesso contenuto, stessa fonte; entrambe portano il codice
 * dell'esportazione, con cui la piattaforma ne conserva l'impronta.
 */

export type ExportMeta = { exportId: string; generatedBy: string };

const hours = (n: number) => `${String(n).replace(".", ",")} ${n === 1 ? "ora" : "ore"}`;
const minutes = (n: number | null) => (n ? `${n} minuti` : "");
const audienceLabel = (a: string) => (a === "trainers" ? "Solo formatori" : "Partecipanti");
const missing = "Non indicato";
const roleLabel: Record<string, string> = { deployer: "Deployer (utilizza sistemi di IA)", provider: "Fornitore (sviluppa o immette sistemi di IA)", both: "Deployer e fornitore" };
const article4Label = { originario: "Testo originario", modificato: "Testo modificato dal Reg. (UE) 2026/1744" } as const;
const declared = (value: string | null | undefined) => (value ? `${value} (dichiarato dall'azienda)` : missing);

const scopeNote = (n: number) => `${n === 1 ? "Una presenza" : `${n} presenze`} senza email aziendale ${n === 1 ? "non è inclusa" : "non sono incluse"} in questa copia: ${n === 1 ? "compare" : "compaiono"} nel registro completo del corso.`;
const companyOf = (register: TrainingRegister, email: string | null) => {
  const domain = companyDomain(email);
  return domain ? register.organization.companyNames[domain] ?? domain : "";
};

export function registerFileName(register: TrainingRegister, format: "pdf" | "xlsx") {
  const slug = (register.domain ? register.organization.legalName ?? register.domain : register.organization.name).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "azienda";
  return `registro-formazione-ia-${slug}-${isoDay(register.generatedAt)}.${format}`;
}

function sessionKey(p: { programId: string; moduleId: string; cohortId: string }) {
  return `${p.programId}|${p.moduleId}|${p.cohortId}`;
}

// ─── PDF ───────────────────────────────────────────────────────────────

export function registerPdf(register: TrainingRegister, meta: ExportMeta) {
  const doc = new PdfBuilder();
  doc.precise = true;
  const org = register.organization;
  const t = register.totals;

  doc.text("UNBUNDLE · REGISTRO DELLA FORMAZIONE IA", { size: 8, font: "B", color: ACCENT, after: 10 });
  doc.text(registerTitle, { size: 19, font: "B", lineGap: 5, after: 4 });
  doc.text(registerSubtitle, { size: 10, color: GRAY, after: 16 });
  doc.pairs([
    ["Organizzazione", org.name],
    ...(register.domain ? [["Partecipanti inclusi", `Persone con indirizzo email @${register.domain}`] as [string, string]] : []),
    ["Referente del registro", org.registerOwner ?? missing],
    ["Formazione erogata da", `${register.provider.name}, sulla piattaforma ${register.provider.platform}`],
    ["Docenti", org.trainers ?? missing],
    ["Generato il", dateTime(register.generatedAt)],
    ["Generato da", meta.generatedBy],
    ["Codice esportazione", meta.exportId],
  ]);
  if (register.scoped) doc.text("Copia limitata ai percorsi gestiti da chi l'ha generata.", { size: 8.5, font: "O", color: GRAY });
  if (register.domain && register.withoutCompany > 0) doc.text(scopeNote(register.withoutCompany), { size: 8.5, font: "O", color: GRAY });
  doc.spacer(10);

  // Quattro numeri in riquadri.
  const stats: [string, string][] = [
    [String(t.peopleAttended), t.peopleAttended === 1 ? "persona ha partecipato" : "persone hanno partecipato"],
    [String(t.sessionsHeld), t.sessionsHeld === 1 ? "sessione svolta" : "sessioni svolte"],
    [hours(t.hoursDelivered).split(" ")[0], t.hoursDelivered === 1 ? "ora di aula" : "ore di aula"],
    [String(t.sessionsScheduled), t.sessionsScheduled === 1 ? "sessione in programma" : "sessioni in programma"],
  ];
  const gap = 8;
  const boxW = (CONTENT_W - gap * 3) / 4;
  doc.ensure(62);
  stats.forEach(([value, label], i) => {
    const x = MARGIN + i * (boxW + gap);
    doc.rect(x, boxW, 56, LIGHT);
    doc.line(value, x + 10, doc.y - 26, { size: 18, font: "B", color: ACCENT });
    doc.line(label, x + 10, doc.y - 44, { size: 8, color: GRAY });
  });
  doc.spacer(68);
  const notes = [
    t.peopleUpcoming > 0 ? `${t.peopleUpcoming} ${t.peopleUpcoming === 1 ? "persona è iscritta" : "persone sono iscritte"} solo a sessioni in programma.` : null,
    t.undocumented > 0 ? `${t.undocumented} ${t.undocumented === 1 ? "iscrizione" : "iscrizioni"} a sessioni concluse senza partecipazione documentata: non ${t.undocumented === 1 ? "è contata" : "sono contate"}.` : null,
  ].filter(Boolean) as string[];
  notes.forEach((note) => doc.text(note, { size: 9, color: GRAY, after: 3 }));
  if (notes.length) doc.spacer(4);

  doc.text("Quadro di riferimento", { size: 11, font: "B", after: 4 });
  legalFramework.forEach((p) => doc.text(p, { size: 9, after: 5 }));
  doc.spacer(4);
  doc.text("Come il registro risponde ai criteri dell'art. 4", { size: 11, font: "B", after: 4 });
  doc.pairs(criteriaMap, { labelWidth: 170, size: 9 });

  // 1 · Organizzazione e contesto d'uso
  doc.newPage();
  doc.bandText("1 · Organizzazione e contesto d'uso", { bg: ACCENT });
  doc.text("Dati dichiarati dall'azienda, non verificati da Lateral Space.", { size: 8.5, font: "O", color: GRAY, after: 4 });
  doc.pairs([
    ["Ragione sociale", org.legalName ?? `${missing} (nome in piattaforma: ${org.name})`],
    ["Ruolo ai sensi dell'AI Act", org.aiActRole ? roleLabel[org.aiActRole] : missing],
    ["Sistemi di IA in uso", org.aiSystems.length ? org.aiSystems.join("; ") : missing],
    ["Contesto d'uso e persone interessate", org.useContext ?? missing],
    ["Altre iniziative di alfabetizzazione", org.otherInitiatives ?? "Nessuna indicata"],
  ]);
  if (org.settingsUpdatedAt) doc.text(`Dati indicati dall'azienda, aggiornati il ${dateTime(org.settingsUpdatedAt)} da ${org.settingsUpdatedBy ?? "—"}.`, { size: 8, color: GRAY, after: 8 });
  else doc.text("Dati non ancora indicati dall'azienda.", { size: 8, color: GRAY, after: 8 });

  // 2 · Rilevazione dei bisogni
  doc.bandText("2 · Rilevazione dei bisogni", { bg: ACCENT });
  if (!register.needsAssessments.length) doc.text("Nessuna rilevazione svolta sulla piattaforma.", { size: 9, after: 8 });
  else {
    doc.text("Questionari sulle competenze e sull'uso dell'IA compilati prima della formazione. Si riporta solo il numero di risposte: i risultati sono consultabili in forma aggregata nella piattaforma.", { size: 9, after: 6 });
    doc.table([{ title: "Rilevazione", width: 50 }, { title: "Avviata il", width: 22 }, { title: "Risposte complete", width: 28 }],
      register.needsAssessments.map((a) => [a.name, longDate(a.createdAt), String(a.completed)]));
  }

  // 3 · Percorsi e contenuti
  doc.bandText("3 · Percorsi e contenuti", { bg: ACCENT });
  if (!register.programs.length) doc.text("Nessun percorso pubblicato.", { size: 9, after: 8 });
  for (const program of register.programs) {
    doc.text(program.title, { size: 11, font: "B", after: 3 });
    doc.pairs([
      ["Versione del contenuto", program.contentVersion],
      ["Impronta del contenuto", program.packHash],
      ["Pubblicato il", longDate(program.publishedAt)],
    ], { size: 8.5, labelWidth: 150 });
    for (const m of program.modules) {
      doc.spacer(2);
      doc.text(`${m.title}${m.subtitle ? ` — ${m.subtitle}` : ""}`, { size: 9.5, font: "B", after: 2 });
      const items: [string, string][] = [];
      if (m.objective) items.push(["Obiettivo", m.objective]);
      if (m.durationMinutes) items.push(["Durata", minutes(m.durationMinutes)]);
      if (m.agenda.length) items.push(["Programma", m.agenda.map((b) => `${b.from}–${b.to}' ${b.title}`).join("; ")]);
      if (m.competencies.length) items.push(["Competenze trattate", m.competencies.join("; ")]);
      if (m.exercises.length) items.push(["Esercitazioni", m.exercises.join("; ")]);
      doc.pairs(items, { size: 8.5, labelWidth: 150 });
    }
    if (program.materials.length) {
      doc.spacer(2);
      doc.text("Materiali consegnati", { size: 9.5, font: "B", after: 3 });
      doc.table([{ title: "Materiale", width: 30 }, { title: "File", width: 22 }, { title: "Per", width: 12 }, { title: "Impronta SHA-256", width: 36 }],
        program.materials.map((mat) => [mat.title, mat.fileName, audienceLabel(mat.audience), mat.sha256]), { size: 7.5 });
    }
    doc.spacer(6);
  }

  // 4 · Sessioni
  doc.bandText("4 · Sessioni", { bg: ACCENT });
  if (!register.sessions.length) doc.text("Nessuna sessione.", { size: 9, after: 8 });
  else doc.table(
    [{ title: "Sessione", width: 26 }, { title: "Modulo", width: 22 }, { title: "Durata", width: 8 }, { title: "Stato", width: 14 }, { title: "Partecipanti", width: 16 }, { title: "Art. 4 in vigore", width: 14 }],
    register.sessions.map((s) => [
      sessionLabel(s), s.moduleTitle, `${s.durationMinutes}'`, sessionState[s.state],
      [s.state === "in_programma" ? `${s.enrolled} iscritti` : String(s.participants + s.manualParticipants),
        s.manualParticipants ? `di cui ${s.manualParticipants} registrati dal formatore` : "",
        s.undocumented ? `+ ${s.undocumented} iscritti senza partecipazione documentata` : ""].filter(Boolean).join("\n"),
      article4Label[s.article4],
    ]), { size: 7.5 });

  // 5 · Partecipanti
  doc.bandText("5 · Partecipanti", { bg: ACCENT });
  const sessionByKey = new Map(register.sessions.map((s) => [sessionKey(s), s]));
  if (!register.participants.length) doc.text("Nessun partecipante.", { size: 9, after: 8 });
  else {
    doc.text("«Accesso» è il primo ingresso dal link del proprio turno. «Esercitazioni» conta le esercitazioni consegnate sul totale richiesto dal modulo, non il loro esito.", { size: 8.5, color: GRAY, after: 3 });
    doc.text(presenceDefinition, { size: 8.5, color: GRAY, after: 6 });
    doc.table(
      [{ title: "Partecipante", width: 30 }, { title: "Sessione", width: 24 }, { title: "Accesso", width: 18 }, { title: "Esercitazioni", width: 12 }, { title: "Stato", width: 20 }],
      register.participants.map((p) => {
        const s = sessionByKey.get(sessionKey(p));
        return [
          p.email ? `${p.name}\n${p.email}` : p.name,
          s ? `${s.moduleTitle}\n${sessionLabel(s)}` : p.moduleTitle,
          p.joinedAt ? `${dateTime(p.joinedAt)}\n${p.joinLabel}` : p.source === "registrazione_manuale" ? `Registrata il ${dateTime(p.recordedAt)}${p.recordedBy ? `\nda ${p.recordedBy}` : ""}` : p.joinLabel,
          p.source === "registrazione_manuale" ? "—" : `${p.submitted} di ${p.required}`,
          p.manualNote ? `${p.statusLabel}\nNota: ${p.manualNote}` : p.statusLabel,
        ];
      }), { size: 7.5 });
  }

  // 6 · Correzioni
  doc.bandText("6 · Correzioni", { bg: ACCENT });
  if (!register.corrections.length) doc.text("Nessuna presenza annullata.", { size: 9, after: 8 });
  else doc.table(
    [{ title: "Persona", width: 24 }, { title: "Registrata", width: 24 }, { title: "Annullata", width: 24 }, { title: "Motivo", width: 28 }],
    register.corrections.map((c) => [
      `${c.personName}${c.personEmail ? `\n${c.personEmail}` : ""}\n${c.moduleTitle}`,
      `${dateTime(c.recordedAt)}\n${c.recordedBy}`, `${dateTime(c.voidedAt)}\n${c.voidedBy}`, c.voidReason,
    ]), { size: 7.5 });

  // 7 · Metodo, integrità e limiti
  doc.bandText("7 · Metodo, integrità e limiti", { bg: ACCENT });
  doc.text("Come sono raccolti i dati", { size: 9.5, font: "B", after: 3 });
  doc.text("Il registro non è compilato a mano: si ricava da ciò che la piattaforma registra mentre la formazione avviene — sessioni, iscrizioni, accessi dal link del turno, esercitazioni consegnate, contenuti e materiali con la loro impronta. L'azienda aggiunge solo i propri dati (sezione 1) e il formatore le presenze di chi ha partecipato senza usare la piattaforma.", { size: 8.5, after: 6 });
  doc.text("Cosa non contiene", { size: 9.5, font: "B", after: 3 });
  notIncluded.forEach((p) => doc.text(p, { size: 8.5, after: 4 }));
  doc.text("Integrità", { size: 9.5, font: "B", after: 3 });
  integrity.forEach((p) => doc.text(p, { size: 8.5, after: 4 }));
  doc.text("Limiti", { size: 9.5, font: "B", after: 3 });
  limits.forEach((p) => doc.text(p, { size: 8.5, after: 4 }));

  // Visto del referente, per la copia stampata.
  doc.spacer(14);
  doc.ensure(90);
  doc.rect(MARGIN, CONTENT_W, 84, LIGHT);
  doc.line("Visto del referente del registro", MARGIN + 12, doc.y - 20, { size: 9.5, font: "B" });
  doc.line("Nome e ruolo ____________________________________", MARGIN + 12, doc.y - 42, { size: 9, color: INK });
  doc.line("Data ______________          Firma ______________________________", MARGIN + 12, doc.y - 64, { size: 9, color: INK });
  doc.spacer(90);

  return doc.finalize(`Registro formazione IA · ${org.name} · esportazione ${meta.exportId.slice(0, 8)} · ${dateTime(register.generatedAt)}`,
    { title: `${registerTitle} — ${org.name}`, author: register.provider.platform, subject: registerSubtitle });
}

// ─── Excel ─────────────────────────────────────────────────────────────

function sheet(rows: (string | number | null)[][], widths: number[], filter = true) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = widths.map((wch) => ({ wch }));
  if (filter && rows.length > 1) ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: rows[0].length - 1 } }) };
  return ws;
}

export function registerXlsx(register: TrainingRegister, meta: ExportMeta) {
  const org = register.organization;
  const t = register.totals;
  const book = XLSX.utils.book_new();
  book.Props = { Title: `${registerTitle} — ${org.name}`, Author: register.provider.platform, Subject: registerSubtitle };
  const sessionByKey = new Map(register.sessions.map((s) => [sessionKey(s), s]));

  const cover: (string | number)[][] = [
    [registerTitle, ""],
    [registerSubtitle, ""],
    ["", ""],
    ["Organizzazione", org.name],
    ["Partecipanti inclusi", register.domain ? `Persone con indirizzo email @${register.domain}` : "Tutti i partecipanti del corso"],
    ["Referente del registro", org.registerOwner ?? missing],
    ["Formazione erogata da", `${register.provider.name}, sulla piattaforma ${register.provider.platform}`],
    ["Docenti", org.trainers ?? missing],
    ["Generato il", dateTime(register.generatedAt)],
    ["Generato da", meta.generatedBy],
    ["Codice esportazione", meta.exportId],
    ["", ""],
    ["Persone che hanno partecipato", t.peopleAttended],
    ["Iscrizioni senza partecipazione documentata", t.undocumented],
    ["Sessioni svolte", t.sessionsHeld],
    ["Ore di aula", t.hoursDelivered],
    ["Sessioni in programma", t.sessionsScheduled],
    ["Persone iscritte solo a sessioni in programma", t.peopleUpcoming],
    ["", ""],
    ["Ragione sociale", declared(org.legalName)],
    ["Ruolo ai sensi dell'AI Act", declared(org.aiActRole ? roleLabel[org.aiActRole] : null)],
    ["Sistemi di IA in uso", declared(org.aiSystems.length ? org.aiSystems.join("; ") : null)],
    ["Contesto d'uso e persone interessate", declared(org.useContext)],
    ["Altre iniziative di alfabetizzazione", declared(org.otherInitiatives)],
  ];
  if (register.scoped) cover.push(["", ""], ["Nota", "Copia limitata ai percorsi gestiti da chi l'ha generata."]);
  if (register.domain && register.withoutCompany > 0) cover.push(["", ""], ["Nota", scopeNote(register.withoutCompany)]);
  XLSX.utils.book_append_sheet(book, sheet(cover, [42, 90], false), "Registro");

  XLSX.utils.book_append_sheet(book, sheet([
    ["Nome", "Email", "Società", "Percorso", "Modulo", "Turno", "Sessione", "Sessione svolta", "Fonte", "Accesso dal link", "Momento dell'accesso",
      "Esercitazioni richieste", "Esercitazioni consegnate", "Stato", "Nota del formatore", "Registrata da", "Registrata il"],
    ...register.participants.map((p) => {
      const s = sessionByKey.get(sessionKey(p));
      return [
        p.name, p.email ?? "", companyOf(register, p.email), p.programTitle, p.moduleTitle, p.cohortId, s ? sessionLabel(s) : "", p.sessionHeld ? "Sì" : "No",
        p.source === "piattaforma" ? "Piattaforma" : "Registrata dal formatore", dateTime(p.joinedAt), p.joinTiming ? p.joinLabel : "",
        p.source === "piattaforma" ? p.required : "", p.source === "piattaforma" ? p.submitted : "", p.statusLabel,
        p.manualNote ?? "", p.recordedBy ?? "", dateTime(p.recordedAt),
      ];
    }),
  ], [26, 30, 22, 30, 28, 12, 30, 10, 22, 18, 24, 12, 12, 36, 30, 22, 18]), "Partecipanti");

  XLSX.utils.book_append_sheet(book, sheet([
    ["Percorso", "Modulo", "Turno", "Inizio", "Fine", "Durata (minuti)", "Stato", "Iscritti", "Partecipanti dalla piattaforma", "Presenze registrate dal formatore",
      "Iscritti senza partecipazione documentata", "Con tutte le esercitazioni", "Art. 4 in vigore"],
    ...register.sessions.map((s) => [s.programTitle, s.moduleTitle, s.cohortId, dateTime(s.startsAt), dateTime(s.endsAt), s.durationMinutes,
      sessionState[s.state], s.enrolled, s.participants, s.manualParticipants, s.undocumented, s.allExercises, article4Label[s.article4]]),
  ], [30, 28, 12, 18, 18, 10, 24, 10, 14, 14, 16, 14, 30]), "Sessioni");

  XLSX.utils.book_append_sheet(book, sheet([
    ["Percorso", "Versione", "Impronta del contenuto", "Pubblicato il", "Modulo", "Obiettivo", "Durata (minuti)", "Programma", "Competenze trattate", "Esercitazioni"],
    ...register.programs.flatMap((p) => p.modules.map((m) => [p.title, p.contentVersion, p.packHash, longDate(p.publishedAt), m.title, m.objective ?? "",
      m.durationMinutes ?? "", m.agenda.map((b) => `${b.from}–${b.to}' ${b.title}`).join("; "), m.competencies.join("; "), m.exercises.join("; ")])),
  ], [30, 14, 66, 16, 28, 50, 10, 60, 40, 50]), "Contenuti");

  XLSX.utils.book_append_sheet(book, sheet([
    ["Percorso", "Materiale", "File", "Per", "Modulo", "Impronta SHA-256", "Caricato il"],
    ...register.programs.flatMap((p) => p.materials.map((m) => [p.title, m.title, m.fileName, audienceLabel(m.audience), m.moduleId ?? "Tutto il percorso", m.sha256, dateTime(m.createdAt)])),
  ], [30, 30, 30, 14, 16, 66, 18]), "Materiali");

  XLSX.utils.book_append_sheet(book, sheet([
    ["Rilevazione", "Stato", "Avviata il", "Risposte complete"],
    ...register.needsAssessments.map((a) => [a.name, a.status, longDate(a.createdAt), a.completed]),
  ], [40, 14, 18, 16]), "Rilevazione bisogni");

  XLSX.utils.book_append_sheet(book, sheet([
    ["Persona", "Email", "Modulo", "Turno", "Registrata il", "Registrata da", "Annullata il", "Annullata da", "Motivo"],
    ...register.corrections.map((c) => [c.personName, c.personEmail ?? "", c.moduleTitle, c.cohortId, dateTime(c.recordedAt), c.recordedBy, dateTime(c.voidedAt), c.voidedBy, c.voidReason]),
  ], [26, 30, 28, 12, 18, 22, 18, 22, 40]), "Correzioni");

  XLSX.utils.book_append_sheet(book, sheet([
    ["Note"],
    ["Quadro di riferimento"], ...legalFramework.map((p) => [p]),
    [""], ["Come il registro risponde ai criteri dell'art. 4"], ...criteriaMap.map(([k, v]) => [`${k}: ${v}`]),
    [""], ["Partecipazione documentata"], [presenceDefinition],
    [""], ["Cosa non contiene"], ...notIncluded.map((p) => [p]),
    [""], ["Integrità"], ...integrity.map((p) => [p]),
    [""], ["Limiti"], ...limits.map((p) => [p]),
  ], [160], false), "Note");

  return Buffer.from(XLSX.write(book, { type: "buffer", bookType: "xlsx", compression: true }) as Buffer);
}
