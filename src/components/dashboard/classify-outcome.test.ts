import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CLASSIFY_BUTTON_LABEL, CLASSIFY_FAILED, classifyOutcome } from "./classify-outcome.ts";

// (Migrazione a Claude Sonnet 5.5) Il bottone «Classifica attività»: l'avviso dopo /api/ai/classify e se la pagina si
// aggiorna. Le attività che il modello rifiuta o non classifica restano da fare, e il bottone dice quante.

const result = (classified: number, skipped: number, total: number, skippedText = "") => ({ classified, skipped, skippedText, total });

test("tutte classificate: successo e pagina aggiornata, al singolare e al plurale", () => {
  assert.deepEqual(classifyOutcome(result(1, 0, 1)), { level: "success", text: "1 attività classificata su 1 totale", refresh: true });
  assert.deepEqual(classifyOutcome(result(3, 0, 5)), { level: "success", text: "3 attività classificate su 5 totali", refresh: true });
  assert.deepEqual(classifyOutcome(result(1, 0, 4)), { level: "success", text: "1 attività classificata su 4 totali", refresh: true });
});

test("alcune rimaste da classificare: avviso con quante, pagina aggiornata per le riuscite", () => {
  assert.deepEqual(classifyOutcome(result(2, 1, 4, "1 attività è rimasta da classificare.")), {
    level: "warning",
    text: "2 attività classificate su 4 totali. 1 attività è rimasta da classificare. Riprova più tardi.",
    refresh: true,
  });
  assert.deepEqual(classifyOutcome(result(1, 2, 3, "2 attività sono rimaste da classificare.")), {
    level: "warning",
    text: "1 attività classificata su 3 totali. 2 attività sono rimaste da classificare. Riprova più tardi.",
    refresh: true,
  });
});

test("nessuna classificata: errore con quante restano, niente da aggiornare", () => {
  assert.deepEqual(classifyOutcome(result(0, 2, 2, "2 attività sono rimaste da classificare.")), {
    level: "error",
    text: "2 attività sono rimaste da classificare. Riprova più tardi.",
    refresh: false,
  });
});

test("niente da classificare: informazione, niente da aggiornare", () => {
  assert.deepEqual(classifyOutcome(result(0, 0, 6)), { level: "info", text: "Tutte le attività sono già classificate", refresh: false });
});

test("richiesta non riuscita o risposta che non è un esito: errore, niente da aggiornare", () => {
  assert.deepEqual(CLASSIFY_FAILED, { level: "error", text: "Errore durante la classificazione", refresh: false });
  // `null`: rete, risposta non 2xx o illeggibile. Un 400 con { error } non diventa «già classificate».
  for (const data of [null, undefined, "Unauthorized", { error: "workspaceId è richiesto" }, result(-1, 0, 2), { ...result(1, 0, 1), skippedText: undefined }]) {
    assert.deepEqual(classifyOutcome(data), CLASSIFY_FAILED, JSON.stringify(data));
  }
});

test("«attività» sempre con l'accento, e così «già» e «più»", () => {
  const texts = [
    CLASSIFY_BUTTON_LABEL.idle,
    CLASSIFY_BUTTON_LABEL.busy,
    CLASSIFY_FAILED.text,
    ...[result(1, 0, 1), result(2, 1, 3, "1 attività è rimasta da classificare."), result(0, 1, 1, "1 attività è rimasta da classificare."), result(0, 0, 1)].map(
      (data) => classifyOutcome(data).text,
    ),
  ];
  assert.equal(CLASSIFY_BUTTON_LABEL.idle, "Classifica attività");
  for (const text of texts) assert.doesNotMatch(text, /attivita|gia'|piu'/, text);
});

test("il bottone mostra l'esito di classifyOutcome e aggiorna la pagina solo quando dice di farlo", () => {
  // Il componente è una traduzione dell'esito in toast: nessun testo o decisione sua, nessun ricaricamento.
  const source = readFileSync(new URL("./classify-button.tsx", import.meta.url), "utf8");
  assert.match(source, /outcome = classifyOutcome\(res\.ok \? await res\.json\(\) : null\);/);
  assert.match(source, /toast\[outcome\.level\]\(outcome\.text\);\n\s*if \(outcome\.refresh\) router\.refresh\(\);/);
  assert.equal(source.match(/router\.refresh\(\)/g)?.length, 1);
  assert.doesNotMatch(source, /window\.location|toast\.(success|info|warning|error)\(|attivita'/);
});
