import test from "node:test";
import assert from "node:assert/strict";
import { NEED_REQUIREMENT_STATUSES, NEED_STEP_STATUSES, NEED_TYPES, needStatusesOf } from "./needs.ts";
import {
  NEED_HISTORY_CHANGES,
  NEED_HISTORY_FIELD,
  isNeedHistoryEvent,
  needHistoryCode,
  needHistoryText,
  needStateCode,
  parseNeedHistory,
} from "./needs-history.ts";

// «Cosa serve» nella Storia (drizzle/0023): codici senza testi e le righe come si leggono. Le righe
// scritte dal servizio sono in needs.integration.test.ts, la pagina in needs-render.integration.test.ts.

test("codici: entrano nelle colonne della Storia (varchar 40) e si rileggono uguali", () => {
  for (const type of NEED_TYPES) {
    for (const status of needStatusesOf(type)) {
      for (const change of NEED_HISTORY_CHANGES) {
        const code = needHistoryCode(change, type, status);
        assert.ok(code.length <= 40, code);
        assert.deepEqual(parseNeedHistory(null, code), { change, type, status, before: null });
      }
      assert.ok(needStateCode(type, status).length <= 40);
    }
  }
  assert.equal(needHistoryCode("archiviata", "passo", "fatta"), "archiviata.passo.fatta");
  assert.equal(needStateCode("requisito", "da_chiedere"), "requisito.da_chiedere");
  assert.equal(NEED_HISTORY_FIELD, "cosa_serve");
  assert.equal(NEED_REQUIREMENT_STATUSES.length + NEED_STEP_STATUSES.length, 11);
});

test("codici: lo stato di prima solo per una modifica che lo cambia; codici estranei, null", () => {
  assert.deepEqual(parseNeedHistory("requisito.chiesta", "modificata.requisito.validata"), {
    change: "modificata",
    type: "requisito",
    status: "validata",
    before: { type: "requisito", status: "chiesta" },
  });
  assert.equal(parseNeedHistory("requisito.validata", "modificata.requisito.validata")?.before, null, "uguale: nessun prima");
  assert.equal(parseNeedHistory("requisito.chiesta", "aggiunta.requisito.validata")?.before, null, "solo le modifiche");
  assert.equal(parseNeedHistory("requisito.fatta", "modificata.requisito.validata")?.before, null, "stato di un altro tipo");
  for (const after of [null, "", "approvato.trimestre", "da_valutare.nuova", "aggiunta.requisito", "aggiunta.passo.validata", "aggiunta.requisito.da_chiedere.x", "rimossa.requisito.chiesta"]) {
    assert.equal(parseNeedHistory(null, after), null, String(after));
  }
});

test("righe: «Cosa serve: …», con il tipo e gli stati della pagina, mai un testo dell'esigenza", () => {
  assert.equal(needHistoryText({ phaseBefore: null, phaseAfter: "aggiunta.requisito.da_chiedere" }), "Cosa serve: aggiunto un requisito");
  assert.equal(needHistoryText({ phaseBefore: null, phaseAfter: "aggiunta.passo.proposta" }), "Cosa serve: aggiunto un prossimo passo");
  assert.equal(needHistoryText({ phaseBefore: null, phaseAfter: "modificata.requisito.chiesta" }), "Cosa serve: modificato un requisito");
  assert.equal(needHistoryText({ phaseBefore: null, phaseAfter: "collegata.requisito.chiesta" }), "Cosa serve: collegato un requisito");
  assert.equal(needHistoryText({ phaseBefore: null, phaseAfter: "scollegata.passo.confermata" }), "Cosa serve: scollegato un prossimo passo");
  assert.equal(needHistoryText({ phaseBefore: null, phaseAfter: "archiviata.requisito.mancante" }), "Cosa serve: archiviato un requisito");
  assert.equal(
    needHistoryText({ phaseBefore: "requisito.da_chiedere", phaseAfter: "modificata.requisito.validata" }),
    "Cosa serve: stato di un requisito, «Non ancora chiesta» → «A posto»",
  );
  assert.equal(needHistoryText({ phaseBefore: "passo.proposta", phaseAfter: "modificata.passo.fatta" }), "Cosa serve: stato di un prossimo passo, «Proposto» → «Fatto»");
  assert.equal(needHistoryText({ phaseBefore: "requisito.chiesta", phaseAfter: "modificata.passo.proposta" }), "Cosa serve: un requisito diventa un prossimo passo");
  assert.equal(needHistoryText({ phaseBefore: null, phaseAfter: "approvato.trimestre" }), "Cosa serve", "codici sconosciuti");
  assert.ok(isNeedHistoryEvent({ fields: ["cosa_serve"] }));
  assert.ok(!isNeedHistoryEvent({ fields: ["titolo", "problema"] }));
});
