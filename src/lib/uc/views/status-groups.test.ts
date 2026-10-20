import test from "node:test";
import assert from "node:assert/strict";
import { ITEM_STATUSES, type ItemStatus } from "../vocab.ts";
import { STATUS_GROUPS, audienceFor, groupCountText, groupCounts, groupFromSlug, isLsViewer, statusView, type StatusView } from "./status-groups.ts";

/** DESIGN §2.6, «Stati delle domande»: one row per status, both audiences. */
const TABLE: Record<ItemStatus, { ls: StatusView; cliente: StatusView }> = {
  da_chiedere: {
    ls: { label: "Da fare", sublabel: "Non ancora chiesta", tone: "grigio", group: "da_fare" },
    cliente: { label: "Da rispondere", sublabel: null, tone: "grigio", group: "da_fare" },
  },
  chiesta: {
    ls: { label: "Da fare", sublabel: "Chiesta, in attesa", tone: "grigio", group: "da_fare" },
    cliente: { label: "Da rispondere", sublabel: null, tone: "grigio", group: "da_fare" },
  },
  mancante: {
    ls: { label: "Da fare", sublabel: "Manca il dato", tone: "rosso", group: "da_fare" },
    cliente: { label: "Da rispondere", sublabel: "Ci manca ancora questo dato.", tone: "rosso", group: "da_fare" },
  },
  parziale: {
    ls: { label: "Da fare", sublabel: "Risposta parziale", tone: "giallo", group: "da_fare" },
    cliente: { label: "Da completare", sublabel: null, tone: "giallo", group: "da_fare" },
  },
  in_verifica: {
    ls: { label: "Da verificare", sublabel: null, tone: "giallo", group: "da_verificare" },
    cliente: { label: "In verifica", sublabel: null, tone: "giallo", group: "da_verificare" },
  },
  validata: {
    ls: { label: "A posto", sublabel: null, tone: "verde", group: "a_posto" },
    cliente: { label: "A posto", sublabel: null, tone: "verde", group: "a_posto" },
  },
  non_applicabile: {
    ls: { label: "A posto", sublabel: "Non si applica", tone: "blu", group: "a_posto" },
    cliente: { label: "Non si applica", sublabel: null, tone: "blu", group: "a_posto" },
  },
  bloccata: {
    ls: { label: "Bloccate", sublabel: null, tone: "lucchetto", group: "bloccate" },
    cliente: { label: "In attesa", sublabel: null, tone: "lucchetto", group: "bloccate" },
  },
};

test("statusView: 8 statuses for 2 audiences, as in the table", () => {
  for (const status of ITEM_STATUSES) {
    assert.deepEqual(statusView(status, "ls"), TABLE[status].ls, `${status} for Lateral Space`);
    assert.deepEqual(statusView(status, "cliente"), TABLE[status].cliente, `${status} for the client`);
  }
});

test("the client never sees a Lateral Space sub-state", () => {
  for (const status of ITEM_STATUSES) {
    const v = statusView(status, "cliente");
    assert.ok(v.sublabel === null || v.sublabel === "Ci manca ancora questo dato.", status);
    assert.ok(!["Da fare", "Da verificare", "Bloccate", "Chiesta, in attesa", "Non ancora chiesta"].includes(v.label), status);
  }
});

test("group counts from statuses or from cached counts, in segment order", () => {
  const statuses: ItemStatus[] = ["da_chiedere", "chiesta", "mancante", "parziale", "in_verifica", "in_verifica", "validata", "non_applicabile", "bloccata"];
  assert.deepEqual(
    groupCounts(statuses, "ls").map((g) => [g.slug, g.label, g.count]),
    [
      ["da-fare", "Da fare", 4],
      ["da-verificare", "Da verificare", 2],
      ["bloccate", "Bloccate", 1],
      ["a-posto", "A posto", 2],
    ],
  );
  assert.deepEqual(
    groupCounts({ da_chiedere: 80, in_verifica: 40, bloccata: 5, validata: 0 }, "cliente", { hideZero: true }).map((g) => `${g.count} ${g.label.toLowerCase()}`),
    ["80 da rispondere", "40 in verifica", "5 in attesa"],
  );
  assert.deepEqual(groupCounts([], "ls", { hideZero: true }), []);
  assert.deepEqual(groupCounts({ chiesta: Number.NaN, mancante: -3 }, "ls").map((g) => g.count), [0, 0, 0, 0]);
});

test("segment slugs round trip", () => {
  for (const g of STATUS_GROUPS) assert.equal(groupFromSlug(groupCounts([], "ls").find((x) => x.group === g)!.slug), g);
  assert.equal(groupFromSlug("tutte"), null);
  assert.equal(groupFromSlug(null), null);
});

test("audience from case roles", () => {
  assert.equal(isLsViewer(["ls_sviluppatore"]), true);
  assert.equal(isLsViewer(["osservatore"]), false);
  assert.equal(isLsViewer(["osservatore", "ls_analista"]), true);
  assert.equal(audienceFor(["owner_cliente"]), "cliente");
  assert.equal(audienceFor(["ls_lead"]), "ls");
  assert.equal(audienceFor([]), "cliente");
});

test("counts read as Italian after a number, singular and plural, per audience", () => {
  assert.equal(groupCountText("da_fare", 140, "ls"), "140 da fare");
  assert.equal(groupCountText("da_fare", 80, "cliente"), "80 da rispondere");
  assert.equal(groupCountText("da_verificare", 40, "cliente"), "40 in verifica");
  assert.equal(groupCountText("a_posto", 1, "ls"), "1 a posto");
  assert.equal(groupCountText("bloccate", 2812, "ls"), "2.812 bloccate");
  assert.equal(groupCountText("bloccate", 1, "cliente"), "1 in attesa");
});
