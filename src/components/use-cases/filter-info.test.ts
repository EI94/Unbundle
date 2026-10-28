import test, { before } from "node:test";
import assert from "node:assert/strict";
import { INFO_PROGRESS_STATES, infoProgressView, type InfoProgressState, type InfoProgressView } from "../../lib/use-cases/info-progress.ts";
import { enableTsxImports } from "./detail/referent/tsx-test-loader.ts";

// Il filtro «Informazioni» della pagina «Use case» (SPEC §P2.10.5, §P2.12.3): lo stato delle schede,
// mai una persona.
let chip: typeof import("./info-chip.tsx");
before(async () => {
  await enableTsxImports();
  chip = await import("./info-chip.tsx");
});

const view = (state: InfoProgressState): InfoProgressView =>
  infoProgressView({
    state,
    since: state === "in_attesa" ? "2026-10-27" : null,
    reminded: false,
    until: null,
    silentReason: state === "senza_risposta" ? "scaduta" : null,
    blocked: false,
    received: 1,
    total: 3,
    toAsk: 1,
    toVerify: state === "da_verificare" ? 1 : 0,
    waiting: state === "in_attesa" ? 1 : 0,
    unanswered: state === "senza_risposta" ? 1 : 0,
    blockedCount: 0,
  })!;

test("le voci: gli stati che hanno una scheda, nell'ordine fisso, con il testo dell'opzione e il valore dell'indirizzo", () => {
  const info = { a: view("complete"), b: view("da_verificare"), c: view("da_verificare"), d: view("da_chiedere") };
  assert.deepEqual(chip.infoFilterOptions(info, null), [
    { value: "da-chiedere", label: "Da chiedere" },
    { value: "da-verificare", label: "Da verificare" },
    { value: "complete", label: "Complete" },
  ]);
});

test("lo stato scelto resta tra le voci anche se nessuna scheda lo ha più", () => {
  assert.deepEqual(chip.infoFilterOptions({ a: view("complete") }, "senza_risposta"), [
    { value: "senza-risposta", label: "Senza risposta" },
    { value: "complete", label: "Complete" },
  ]);
});

test("cinque stati, cinque voci; senza schede (o per i contributori) nessuna voce e il campo non c'è", () => {
  const all = Object.fromEntries(INFO_PROGRESS_STATES.map((state) => [state, view(state)]));
  assert.deepEqual(chip.infoFilterOptions(all, null).map((o) => o.label), ["Da chiedere", "In attesa", "Da verificare", "Senza risposta", "Complete"]);
  assert.deepEqual(chip.infoFilterOptions({}, null), []);
  assert.deepEqual(chip.infoFilterOptions(null, null), []);
});
