// I compiti di un caso (rilascio 8.1a): compiti.md avanti e indietro, l'importazione che va solo avanti, le aree che
// si sovrappongono, il compito fermo con il calendario dei giorni lavorativi, la riga del brief senza nomi.
import test from "node:test";
import assert from "node:assert/strict";
import {
  areasOverlap,
  normalizeArea,
  overlappingTasks,
  parseTasksMarkdown,
  planTaskImport,
  renderTasksMarkdown,
  staleStep,
  taskRefFromBranch,
  tasksBriefLine,
  type TaskRow,
} from "./tasks.ts";

const FOLDER = "casi/px-0042";
const FILE = `# PX-0042 · Compiti

Nascono dal progetto.

- [ ] T-1 Ingresso e richiesta normalizzata (webhook, coda, validazione) · 8 h · aree: casi/px-0042/src/ingresso.ts, src/richiesta.ts, src/api.ts · prove: evals/avversari
- [x] T-2 Equipaggio dal gestionale, sola lettura · 16 h · aree: componenti/gestionale/, casi/px-0042/src/equipaggio.ts · prove: evals/regole (equipaggio, riposi)
- [ ] T-3 Casi d'oro dallo storico · 10 h · aree: casi/px-0042/evals/casi/ · prove: —
- [ ] T-1 Riga ripetuta che non vale
- [ ] compito senza riferimento
- [ ] T-4 Vecchia idea · 2 h · annullato

Quando tutti i compiti sono fatti, la versione passa a 1.0.0.
`;

const row = (over: Partial<TaskRow> & { ref: string }): TaskRow => ({
  id: `id-${over.ref}`,
  title: `Titolo ${over.ref}`,
  areas: [],
  estimateHours: null,
  evidence: null,
  status: "da_fare",
  holderUserId: null,
  takenAt: null,
  lastActivityAt: null,
  staleAskedAt: null,
  staleEscalatedAt: null,
  ...over,
});

test("compiti.md: le righe dei compiti, con ore, aree dentro il caso e prove; il resto si salta", () => {
  const tasks = parseTasksMarkdown(FILE, FOLDER);
  assert.deepEqual(tasks.map((t) => t.ref), ["T-1", "T-2", "T-3", "T-4"]);
  assert.deepEqual(tasks[0], {
    ref: "T-1",
    title: "Ingresso e richiesta normalizzata (webhook, coda, validazione)",
    areas: ["casi/px-0042/src/ingresso.ts", "casi/px-0042/src/richiesta.ts", "casi/px-0042/src/api.ts"],
    estimateHours: 8,
    evidence: "evals/avversari",
    done: false,
    cancelled: false,
  });
  assert.deepEqual(tasks[1].areas, ["componenti/gestionale/", "casi/px-0042/src/equipaggio.ts"]);
  assert.equal(tasks[1].done, true);
  assert.equal(tasks[1].evidence, "evals/regole (equipaggio, riposi)", "le virgole delle prove restano");
  assert.equal(tasks[2].evidence, null, "«—» vuol dire nessuna prova");
  assert.equal(tasks[3].cancelled, true);
  assert.equal(normalizeArea("../fuori", FOLDER), null);
  assert.equal(normalizeArea("/assoluto", FOLDER), null);
});

test("lo specchio si rilegge uguale, senza nomi, con lo stato in fondo alla riga", () => {
  const rows = [
    row({ ref: "T-2", title: "Equipaggio", areas: ["componenti/gestionale/", "casi/px-0042/src/equipaggio.ts"], estimateHours: 16, status: "in_corso", holderUserId: "u1" }),
    row({ ref: "T-1", title: "Ingresso", areas: ["casi/px-0042/src/ingresso.ts"], estimateHours: 7.5, evidence: "evals/avversari", status: "fatto" }),
    row({ ref: "T-10", title: "Dopo", status: "annullato" }),
  ];
  const md = renderTasksMarkdown("PX-0042", FOLDER, rows);
  assert.match(md, /^# PX-0042 · Compiti\n/);
  assert.match(md, /non modificarlo a mano/);
  const lines = md.split("\n").filter((l) => l.startsWith("- ["));
  assert.deepEqual(lines, [
    "- [x] T-1 Ingresso · 7,5 h · aree: src/ingresso.ts · prove: evals/avversari",
    "- [ ] T-2 Equipaggio · 16 h · aree: componenti/gestionale/, src/equipaggio.ts · in corso",
    "- [ ] T-10 Dopo · annullato",
  ]);
  assert.doesNotMatch(md, /u1/);
  const again = parseTasksMarkdown(md, FOLDER);
  assert.deepEqual(again.map((t) => [t.ref, t.done, t.cancelled, t.areas, t.estimateHours]), [
    ["T-1", true, false, ["casi/px-0042/src/ingresso.ts"], 7.5],
    ["T-2", false, false, ["componenti/gestionale/", "casi/px-0042/src/equipaggio.ts"], 16],
    ["T-10", false, true, [], null],
  ]);
});

test("l'importazione crea i nuovi, aggiorna i cambiati, porta a «fatto» dalle PR unite, mai all'indietro, non cancella", () => {
  const drafts = parseTasksMarkdown(FILE, FOLDER);
  const existing = [
    row({ ref: "T-1", title: "Ingresso e richiesta normalizzata (webhook, coda, validazione)", areas: ["casi/px-0042/src/ingresso.ts", "casi/px-0042/src/richiesta.ts", "casi/px-0042/src/api.ts"], estimateHours: 8, evidence: "evals/avversari", status: "in_corso", holderUserId: "u1" }),
    row({ ref: "T-3", title: "Titolo vecchio", areas: ["casi/px-0042/evals/casi/"], estimateHours: 10, status: "fatto" }),
    row({ ref: "T-9", title: "Solo in Unbundle" }),
  ];
  const plan = planTaskImport(existing, drafts, new Set(["T-1"]));
  assert.deepEqual(plan.onlyInUnbundle, ["T-9"]);
  assert.deepEqual(plan.unchanged, []);
  const byRef = Object.fromEntries(plan.ops.map((o) => [o.kind === "nuovo" ? o.draft.ref : o.ref, o]));
  assert.deepEqual(byRef["T-1"], { kind: "aggiornato", id: "id-T-1", ref: "T-1", changes: {}, status: "fatto" }, "dalla PR unita");
  assert.equal(byRef["T-2"].kind, "nuovo");
  assert.equal((byRef["T-2"] as { status: string }).status, "fatto", "[x] nel file");
  assert.deepEqual(byRef["T-3"], { kind: "aggiornato", id: "id-T-3", ref: "T-3", changes: { title: "Casi d'oro dallo storico" }, status: null }, "fatto resta fatto");
  assert.equal((byRef["T-4"] as { status: string }).status, "annullato");
  // Rifatta sullo stato nuovo, non cambia più niente.
  const after = planTaskImport(
    [
      { ...existing[0], status: "fatto" },
      row({ ref: "T-2", title: drafts[1].title, areas: drafts[1].areas, estimateHours: 16, evidence: drafts[1].evidence, status: "fatto" }),
      { ...existing[1], title: "Casi d'oro dallo storico" },
      row({ ref: "T-4", title: "Vecchia idea", estimateHours: 2, status: "annullato" }),
      existing[2],
    ],
    drafts,
    new Set(["T-1"]),
  );
  assert.deepEqual(after.ops, []);
  assert.deepEqual(after.unchanged, ["T-1", "T-2", "T-3", "T-4"]);
});

test("il compito di una PR: solo dai rami del caso", () => {
  assert.equal(taskRefFromBranch("px-0042/t-3-aeroporti", "PX-0042"), "T-3");
  assert.equal(taskRefFromBranch("px-0042/t-12", "px-0042"), "T-12");
  assert.equal(taskRefFromBranch("px-0042/impostazione", "PX-0042"), null);
  assert.equal(taskRefFromBranch("px-0043/t-3-altro", "PX-0042"), null);
  assert.equal(taskRefFromBranch("px-0042/t-0-zero", "PX-0042"), null);
});

test("le aree si sovrappongono quando una contiene l'altra; take avvisa solo per i compiti in corso", () => {
  assert.deepEqual(areasOverlap(["componenti/gestionale/"], ["componenti/gestionale/cliente.ts"]), ["componenti/gestionale/"]);
  assert.deepEqual(areasOverlap(["casi/px-0042/src"], ["casi/px-0042/src/prezzo.ts"]), ["casi/px-0042/src"]);
  assert.deepEqual(areasOverlap(["casi/px-0042/src/prezzo.ts"], ["casi/px-0042/src/prezzo.test.ts"]), []);
  assert.deepEqual(areasOverlap(["casi/px-0042/src/a.ts"], ["casi/px-0042/src/a.ts"]), ["casi/px-0042/src/a.ts"]);
  const mine = row({ ref: "T-5", areas: ["casi/px-0042/src/agente.ts", "componenti/gestionale/"] });
  const others = [
    row({ ref: "T-2", status: "in_corso", areas: ["componenti/gestionale/cliente.ts"] }),
    row({ ref: "T-3", status: "fatto", areas: ["casi/px-0042/src/agente.ts"] }),
    row({ ref: "T-4", status: "in_revisione", areas: ["casi/px-0042/src/agente.ts"] }),
  ];
  assert.deepEqual(overlappingTasks(mine, others), [
    { ref: "T-2", areas: ["componenti/gestionale/"] },
    { ref: "T-4", areas: ["casi/px-0042/src/agente.ts"] },
  ]);
});

test("il compito fermo: si chiede dopo 2 giorni lavorativi, al responsabile dopo 4, una volta per segnale", () => {
  // Venerdì 6 novembre 2026, ultimo segnale; i giorni lavorativi dopo: 9, 10, 11, 12 (lunedì-giovedì).
  const base = { status: "in_corso" as const, holderUserId: "u1", takenAt: "2026-11-02T09:00:00Z", lastActivityAt: "2026-11-06T16:00:00Z", staleAskedAt: null, staleEscalatedAt: null };
  assert.equal(staleStep(base, new Date("2026-11-09T09:00:00Z")), "niente", "1 giorno");
  assert.equal(staleStep(base, new Date("2026-11-10T09:00:00Z")), "chiedi", "2 giorni");
  const asked = { ...base, staleAskedAt: "2026-11-10T09:00:00Z" };
  assert.equal(staleStep(asked, new Date("2026-11-11T09:00:00Z")), "niente", "già chiesto");
  assert.equal(staleStep(asked, new Date("2026-11-12T09:00:00Z")), "responsabile", "4 giorni");
  assert.equal(staleStep({ ...asked, staleEscalatedAt: "2026-11-12T09:00:00Z" }, new Date("2026-11-13T09:00:00Z")), "niente", "già detto");
  // Un segnale nuovo riparte da capo.
  assert.equal(staleStep({ ...asked, lastActivityAt: "2026-11-11T10:00:00Z" }, new Date("2026-11-12T09:00:00Z")), "niente");
  assert.equal(staleStep({ ...base, status: "da_fare" }, new Date("2026-11-20T09:00:00Z")), "niente");
  assert.equal(staleStep({ ...base, holderUserId: null }, new Date("2026-11-20T09:00:00Z")), "niente", "senza persona non si chiede a nessuno");
});

test("la riga del brief: i tuoi, quelli di altri, quanti da prendere, quanti fatti; mai un nome", () => {
  const tasks = [
    row({ ref: "T-1", status: "fatto" }),
    row({ ref: "T-2", status: "in_corso", holderUserId: "me" }),
    row({ ref: "T-3", status: "in_corso", holderUserId: "altro" }),
    row({ ref: "T-4", status: "in_revisione", holderUserId: "me" }),
    row({ ref: "T-5" }),
    row({ ref: "T-6" }),
    row({ ref: "T-7", status: "annullato" }),
  ];
  assert.equal(tasksBriefLine(tasks, "me"), "Compiti: T-2 tuo, in corso · T-4 tuo, in revisione · T-3 di altri · 2 da prendere (T-5, T-6) · 1 su 6 fatti.");
  assert.equal(tasksBriefLine([], "me"), null);
});
