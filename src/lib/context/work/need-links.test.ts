import test from "node:test";
import assert from "node:assert/strict";
import { NEED_TRANSITIONS } from "../../use-cases/referent/state.ts";
import { ITEM_STATUSES } from "../../uc/vocab.ts";
import { OPEN_NEED_STATUSES, isOpenNeedStatus, needLinkAfterConfirm } from "./need-links.ts";

// Un fatto che risponde a una richiesta di «Cosa serve» (RILASCIO-9b-COSTRUZIONE.md §2.2, §3.2).

test("alla conferma: «Per tutti» e richiesta aperta → aperta; «Solo Lateral Space» o richiesta chiusa → scartata", () => {
  assert.equal(needLinkAfterConfirm({ factVisibility: "tutti", needOpen: true }), "aperta");
  assert.equal(needLinkAfterConfirm({ factVisibility: "ls", needOpen: true }), "scartata", "il testo di un fatto «Solo Lateral Space» non arriva al cliente");
  assert.equal(needLinkAfterConfirm({ factVisibility: "tutti", needOpen: false }), "scartata");
  assert.equal(needLinkAfterConfirm({ factVisibility: "ls", needOpen: false }), "scartata");
});

test("gli stati aperti sono quelli da cui parte `reviewer_answer_validated`; gli altri no", () => {
  assert.deepEqual([...OPEN_NEED_STATUSES], [...NEED_TRANSITIONS.reviewer_answer_validated.from]);
  assert.deepEqual([...OPEN_NEED_STATUSES], ["da_chiedere", "chiesta", "mancante", "parziale", "in_verifica"]);
  for (const status of ITEM_STATUSES) assert.equal(isOpenNeedStatus(status), OPEN_NEED_STATUSES.includes(status), status);
  for (const closed of ["validata", "non_applicabile", "bloccata", "proposta", ""]) assert.equal(isOpenNeedStatus(closed), false, closed);
});
