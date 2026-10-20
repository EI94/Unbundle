import test from "node:test";
import assert from "node:assert/strict";
import {
  CONNECTOR_STATUS_LABEL,
  CONNECTOR_STATUS_PRECEDENCE,
  connectorStatus,
  connectorStatusLabel,
  type ConnectorStatusCode,
  type UseCaseStatusInput,
} from "./status.ts";
import { STATUS_TABLE_FUTURE, STATUS_TABLE_PAST, STATUS_TABLE_ROWS, STATUS_TABLE_TODAY } from "./status.fixtures.ts";

// docs/use-case/DESIGN.md §3.5 (D10). Dati sintetici.

const ALL_CODES: ConnectorStatusCode[] = [
  "RICEVUTA",
  "IN_VALUTAZIONE",
  "POSSIBILE_DOPPIONE",
  "SERVONO_INFORMAZIONI",
  "VALUTATA",
  "APPROVATA",
  "AVVIATA_COME_CASO",
  "IN_SVILUPPO",
  "REALIZZATA",
  "NON_AVVIATA",
  "DOPPIONE",
  "ARCHIVIATA",
];

const PERSON = "00000000-0000-4000-8000-0000000000b1";

function input(overrides: Partial<UseCaseStatusInput> = {}): UseCaseStatusInput {
  return {
    status: "proposed",
    portfolioReviewStatus: "needs_inputs",
    reviewedBy: null,
    publicNote: null,
    intake: null,
    ...overrides,
  };
}

const codeOf = (overrides: Partial<UseCaseStatusInput>) => connectorStatus(input(overrides)).statusCode;

test("tabella: le 23 righe obbligatorie di DESIGN §3.5, nell'ordine", () => {
  assert.deepEqual(
    STATUS_TABLE_ROWS.map((r) => r.n),
    Array.from({ length: 23 }, (_, i) => i + 1)
  );
  for (const r of STATUS_TABLE_ROWS) {
    assert.equal(connectorStatus(r.input).statusCode, r.statusCode, `riga ${r.n}: ${r.label}`);
  }
});

test("tabella: un giorno di riferimento fisso, coerente con le date e i trimestri delle righe", () => {
  assert.match(STATUS_TABLE_TODAY, /^\d{4}-\d{2}-\d{2}$/);
  for (const r of STATUS_TABLE_ROWS) assert.equal(r.context.today, STATUS_TABLE_TODAY, `riga ${r.n}`);
  const row = (n: number) => STATUS_TABLE_ROWS.find((r) => r.n === n)!;
  // Riga 7: data di revisione futura; riga 8: passata.
  assert.equal(row(7).input.reviewBy, STATUS_TABLE_FUTURE);
  assert.equal(row(8).input.reviewBy, STATUS_TABLE_PAST);
  assert.ok(STATUS_TABLE_PAST < STATUS_TABLE_TODAY && STATUS_TABLE_TODAY < STATUS_TABLE_FUTURE);
  // Righe 9 e 11: trimestre dopo e prima di quello di oggi.
  const [year, month] = STATUS_TABLE_TODAY.split("-").map(Number);
  const current = `${year}-Q${Math.ceil(month / 3)}`;
  assert.ok(row(9).context.targetQuarter! > current);
  assert.ok(row(11).context.targetQuarter! < current);
});

test("tabella: compaiono tutti i 12 stati del contratto", () => {
  const seen = new Set(STATUS_TABLE_ROWS.map((r) => r.statusCode));
  assert.deepEqual([...seen].sort(), [...ALL_CODES].sort());
});

test("precedenza: l'ordine di D10, i 12 codici una volta sola", () => {
  assert.deepEqual(CONNECTOR_STATUS_PRECEDENCE, [
    "DOPPIONE",
    "ARCHIVIATA",
    "REALIZZATA",
    "NON_AVVIATA",
    "AVVIATA_COME_CASO",
    "IN_SVILUPPO",
    "APPROVATA",
    "VALUTATA",
    "SERVONO_INFORMAZIONI",
    "POSSIBILE_DOPPIONE",
    "IN_VALUTAZIONE",
    "RICEVUTA",
  ]);
  assert.equal(new Set(CONNECTOR_STATUS_PRECEDENCE).size, 12);
  assert.ok(Object.isFrozen(CONNECTOR_STATUS_PRECEDENCE));
});

test("precedenza: con due condizioni vere vince quella più in alto", () => {
  const cases: Array<[string, Partial<UseCaseStatusInput>, ConnectorStatusCode]> = [
    ["doppione realizzato", { status: "implemented", portfolioReviewStatus: "archived", intake: { archiveReason: "duplicato" } }, "DOPPIONE"],
    ["archiviata con dossier", { status: "accepted", portfolioReviewStatus: "archived", linkedCaseCode: "XX-CASO-01" }, "ARCHIVIATA"],
    ["realizzata con dossier", { status: "implemented", linkedCaseCode: "XX-CASO-01" }, "REALIZZATA"],
    ["non avviata con dossier chiuso", { status: "rejected", linkedCaseCode: "XX-CASO-01" }, "NON_AVVIATA"],
    ["in sviluppo con dossier", { status: "in_progress", linkedCaseCode: "XX-CASO-01" }, "AVVIATA_COME_CASO"],
    ["dossier senza approvazione", { status: "proposed", portfolioReviewStatus: "scored", linkedCaseCode: "XX-CASO-01" }, "AVVIATA_COME_CASO"],
    ["approvata con review_by rimasto", { status: "accepted", reviewBy: "2027-01-14" }, "APPROVATA"],
    ["approvata con richiesta di info", { status: "accepted", reviewedBy: PERSON, publicNote: "Serve il volume." }, "APPROVATA"],
    [
      "valutata con possibile doppione",
      { portfolioReviewStatus: "scored", intake: { possibleDuplicateOf: "XX-0007" } },
      "VALUTATA",
    ],
    [
      "rimandata con richiesta di info",
      { reviewBy: "2027-01-14", reviewedBy: PERSON, publicNote: "Serve il volume." },
      "VALUTATA",
    ],
    [
      "serve info con possibile doppione",
      { reviewedBy: PERSON, publicNote: "Serve il volume.", intake: { possibleDuplicateOf: "XX-0007" } },
      "SERVONO_INFORMAZIONI",
    ],
    ["possibile doppione in revisione", { portfolioReviewStatus: "in_review", intake: { possibleDuplicateOf: "XX-0007" } }, "POSSIBILE_DOPPIONE"],
  ];
  for (const [name, overrides, expected] of cases) assert.equal(codeOf(overrides), expected, name);
});

test("APPROVATA qualunque sia il trimestre e qualunque sia la revisione non archiviata (D10)", () => {
  for (const review of ["needs_inputs", "in_review", "scored"] as const) {
    assert.equal(codeOf({ status: "accepted", portfolioReviewStatus: review }), "APPROVATA", review);
  }
});

test("VALUTATA: scored oppure review_by, solo per draft e proposed; rimandata letta «Valutata» (D10)", () => {
  assert.equal(codeOf({ status: "draft", reviewBy: "2027-01-14" }), "VALUTATA");
  assert.equal(codeOf({ status: "draft", portfolioReviewStatus: "scored" }), "VALUTATA");
  assert.equal(codeOf({ portfolioReviewStatus: "needs_inputs", reviewBy: "2026-01-01" }), "VALUTATA");
  assert.equal(codeOf({ portfolioReviewStatus: "in_review", reviewBy: "   " }), "IN_VALUTAZIONE", "data vuota = assente");
  assert.equal(codeOf({ portfolioReviewStatus: "in_review", reviewBy: undefined }), "IN_VALUTAZIONE", "prima della 0020");
});

test("SERVONO_INFORMAZIONI solo con needs_inputs, una persona e una nota pubblica non vuota", () => {
  assert.equal(codeOf({ reviewedBy: PERSON, publicNote: "Serve il volume." }), "SERVONO_INFORMAZIONI");
  assert.equal(codeOf({ reviewedBy: PERSON, publicNote: "   " }), "RICEVUTA", "nota di soli spazi");
  assert.equal(codeOf({ reviewedBy: PERSON, publicNote: null }), "RICEVUTA");
  assert.equal(codeOf({ reviewedBy: null, publicNote: "Serve il volume." }), "RICEVUTA", "nota senza persona");
  assert.equal(
    codeOf({ portfolioReviewStatus: "in_review", reviewedBy: PERSON, publicNote: "Serve il volume." }),
    "IN_VALUTAZIONE",
    "dopo «Riapri» la nota vecchia non riporta a SERVONO_INFORMAZIONI"
  );
});

test("POSSIBILE_DOPPIONE: in_review, oppure needs_inputs senza persona", () => {
  const dup = { intake: { possibleDuplicateOf: "XX-0007" } };
  assert.equal(codeOf({ ...dup, portfolioReviewStatus: "in_review" }), "POSSIBILE_DOPPIONE");
  assert.equal(codeOf({ ...dup, portfolioReviewStatus: "needs_inputs" }), "POSSIBILE_DOPPIONE", "appena arrivata con «integra»");
  assert.equal(codeOf({ ...dup, reviewedBy: PERSON }), "RICEVUTA", "needs_inputs con persona e senza nota");
  assert.equal(codeOf({ intake: { possibleDuplicateOf: "  " }, portfolioReviewStatus: "in_review" }), "IN_VALUTAZIONE");
});

test("DOPPIONE solo con il motivo «duplicato»; ogni altro motivo, o nessuno, è ARCHIVIATA", () => {
  assert.equal(codeOf({ portfolioReviewStatus: "archived", intake: { archiveReason: "duplicato" } }), "DOPPIONE");
  for (const reason of ["superato", "ritirato", "fuori_perimetro", "altro", "Duplicato", undefined]) {
    assert.equal(codeOf({ portfolioReviewStatus: "archived", intake: { archiveReason: reason } }), "ARCHIVIATA", String(reason));
  }
  assert.equal(codeOf({ portfolioReviewStatus: "archived", intake: null }), "ARCHIVIATA");
});

test("AVVIATA_COME_CASO solo con un codice del dossier non vuoto", () => {
  assert.equal(codeOf({ status: "accepted", linkedCaseCode: "XX-CASO-01" }), "AVVIATA_COME_CASO");
  assert.equal(codeOf({ status: "accepted", linkedCaseCode: "" }), "APPROVATA");
  assert.equal(codeOf({ status: "accepted", linkedCaseCode: null }), "APPROVATA");
  assert.equal(codeOf({ status: "accepted", linkedCaseCode: undefined }), "APPROVATA");
});

test("etichette: quelle del contratto, con il codice dell'altra segnalazione nei doppioni", () => {
  assert.deepEqual(CONNECTOR_STATUS_LABEL, {
    RICEVUTA: "Ricevuta",
    IN_VALUTAZIONE: "In valutazione",
    POSSIBILE_DOPPIONE: "In valutazione (possibile doppione)",
    SERVONO_INFORMAZIONI: "Servono informazioni da te",
    VALUTATA: "Valutata, in attesa di decisione",
    APPROVATA: "Approvata",
    AVVIATA_COME_CASO: "Avviata come caso d'uso",
    IN_SVILUPPO: "In sviluppo",
    REALIZZATA: "Realizzata",
    NON_AVVIATA: "Non avviata per ora",
    DOPPIONE: "Unita a un'altra segnalazione",
    ARCHIVIATA: "Archiviata",
  });
  assert.deepEqual(connectorStatus(input()), { statusCode: "RICEVUTA", statusLabel: "Ricevuta" });
  assert.deepEqual(
    connectorStatus(input({ portfolioReviewStatus: "in_review", intake: { possibleDuplicateOf: "XX-0007" } })),
    { statusCode: "POSSIBILE_DOPPIONE", statusLabel: "In valutazione (possibile doppione di XX-0007)" }
  );
  assert.deepEqual(
    connectorStatus(
      input({ portfolioReviewStatus: "archived", intake: { archiveReason: "duplicato", duplicateOfCode: "XX-10012" } })
    ),
    { statusCode: "DOPPIONE", statusLabel: "Unita a XX-10012" }
  );
});

test("etichette: nei doppioni solo un codice valido, mai testo libero di intake", () => {
  for (const other of ["Mario Rossi", "xx-0007", "XX-7", "<script>", "XX-0007 e altro", 7, null, undefined]) {
    assert.equal(connectorStatusLabel("POSSIBILE_DOPPIONE", { possibleDuplicateOf: other }), "In valutazione (possibile doppione)");
    assert.equal(connectorStatusLabel("DOPPIONE", { duplicateOfCode: other }), "Unita a un'altra segnalazione");
  }
  assert.equal(connectorStatusLabel("DOPPIONE", { duplicateOfCode: " XX-0007 " }), "Unita a XX-0007");
  for (const code of ALL_CODES) {
    assert.ok(connectorStatusLabel(code).length > 0, code);
  }
});

test("ogni combinazione di stato e revisione dà uno dei 12 codici, senza eccezioni", () => {
  const statuses = ["draft", "proposed", "accepted", "in_progress", "implemented", "rejected"] as const;
  const reviews = ["needs_inputs", "in_review", "scored", "archived"] as const;
  for (const status of statuses) {
    for (const portfolioReviewStatus of reviews) {
      for (const extra of [{}, { reviewedBy: PERSON, publicNote: "Nota." }, { reviewBy: "2027-01-14" }, { linkedCaseCode: "XX-CASO-01" }]) {
        const out = connectorStatus(input({ status, portfolioReviewStatus, ...extra }));
        assert.ok(ALL_CODES.includes(out.statusCode), `${status}/${portfolioReviewStatus}`);
        assert.equal(typeof out.statusLabel, "string");
      }
    }
  }
});
