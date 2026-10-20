import test from "node:test";
import assert from "node:assert/strict";
import {
  DESCRIPTION_BLOCKS,
  DESCRIPTION_MAIN,
  DESCRIPTION_MORE,
  DESCRIPTION_PREVIEW,
  askedVersion,
  blockRaw,
  blockValueForEditor,
  changedBlocks,
  descriptionAtVersion,
  descriptionBlockDef,
  descriptionVersions,
  descriptionView,
  extraBlocks,
  normalizeBlockInput,
  parseDescriptionHistory,
  readBlock,
  readableContent,
  readableText,
  readableTitle,
  showAllLabel,
  stableJson,
  stripItemKeys,
  withBlock,
} from "./description.ts";
import { findForbidden } from "./copy-guard.ts";

// Invented sample shaped like a seeded description (no client values).
const sample = {
  version: 1,
  titolo: "Titolo inventato",
  sottotitolo: "Una riga di prova",
  in_breve: "Propone a quale team assegnare una richiesta.",
  problema: "Oggi si decide a memoria.",
  soluzione: "Una proposta spiegata; decide la persona.",
  come_funziona: ["Arriva la richiesta", "Il motore propone", "La persona sceglie"],
  cosa_non_fa: ["Non invia nulla da solo"],
  per_chi: [{ ruolo: "Servizio clienti", cosa_cambia: "Meno tempo per smistare" }],
  leve: [{ leva: "tempo", come: "Smistamento più rapido", kpi: "minuti per richiesta" }],
  perimetro: { caso_commerciale: ["Proposta del team"], evoluzione: ["Risposta automatica"] },
  fasi: [{ fase: "Specifiche", quando: "settimana 1", cosa: "Raccolta dati", uscita: "Catalogo v1" }],
  prerequisiti: ["Export delle richieste"],
  rischi: [{ rischio: "Dati incompleti", mitigazione: "Controlli di qualità" }],
  domande_aperte: [],
  uso_previsto: null,
  decisioni: [],
  riferimenti: ["art. 5"],
};

/** Blocks outside the Description: the one-liner is edited in Impostazioni, levers go to Valore, phases to the overview's Tappe. */
const DESCRIPTION_ELSEWHERE = ["sottotitolo", "leve", "fasi"];

test("every known block is in view, in «Altro» or somewhere else, exactly once", () => {
  const placed = [...DESCRIPTION_MAIN, ...DESCRIPTION_MORE, ...DESCRIPTION_ELSEWHERE];
  assert.equal(new Set(placed).size, placed.length, "no block placed twice");
  for (const k of placed) assert.ok(descriptionBlockDef(k), k);
  for (const b of DESCRIPTION_BLOCKS) assert.ok(placed.includes(b.key), b.key);
  assert.deepEqual(DESCRIPTION_MAIN, ["in_breve", "problema", "soluzione", "come_funziona", "cosa_non_fa", "esempio"], "the order of DESIGN §3.7.1");
  assert.deepEqual(DESCRIPTION_MORE, ["per_chi", "perimetro", "prerequisiti", "rischi", "uso_previsto", "decisioni", "domande_aperte", "riferimenti"]);
  for (const k of [...DESCRIPTION_MAIN, ...DESCRIPTION_MORE]) assert.ok(descriptionBlockDef(k)!.add, `${k} has an «Aggiungi» label for editors`);
  assert.equal(descriptionBlockDef("esempio")!.add, "Aggiungi un esempio concreto");
  assert.equal(descriptionBlockDef("uso_previsto")!.title, "Uso previsto e supervisione umana");
});

test("the reading page shows filled blocks only; levers and phases live elsewhere", () => {
  const view = descriptionView(sample, { audience: "ls" });
  assert.deepEqual(
    view.main.map((b) => b.def.key),
    ["in_breve", "problema", "soluzione", "come_funziona", "cosa_non_fa"],
    "no «Un esempio concreto» when there is none",
  );
  assert.deepEqual(view.more.map((b) => b.def.key), ["per_chi", "perimetro", "prerequisiti", "rischi", "riferimenti"]);
  const all = [...view.main, ...view.more].map((b) => b.def.key);
  for (const k of ["leve", "fasi", "sottotitolo"]) assert.ok(!all.includes(k), `${k} is not in the description`);
  assert.ok(view.main.every((b) => !b.empty) && view.more.every((b) => !b.empty), "never an empty block outside editing");
  assert.equal(view.empty, false);
});

test("editors see every block, empty ones included, to fill them", () => {
  const view = descriptionView(sample, { audience: "ls", includeEmpty: true });
  assert.deepEqual(view.main.map((b) => b.def.key), DESCRIPTION_MAIN);
  assert.deepEqual(view.more.map((b) => b.def.key), DESCRIPTION_MORE);
  assert.deepEqual(
    [...view.main, ...view.more].filter((b) => b.empty).map((b) => b.def.key),
    ["esempio", "uso_previsto", "decisioni", "domande_aperte"],
  );
});

test("an empty description says so; unknown blocks alone are something to read", () => {
  assert.equal(descriptionView({}, { audience: "ls" }).empty, true);
  assert.equal(descriptionView({ version: 1, titolo: "x", leve: [{ leva: "tempo" }] }, { audience: "ls" }).empty, true, "levers alone are not a description");
  const extra = descriptionView({ nota_extra: ["uno"] }, { audience: "ls" });
  assert.equal(extra.empty, false);
  assert.deepEqual(extra.extras, [{ key: "nota_extra", title: "Nota extra", lines: ["uno"] }]);
});

test("texts lose fact codes and KPI keys for everyone, contract articles for the client", () => {
  assert.equal(readableText("Oggi si decide a memoria (F014).", "ls"), "Oggi si decide a memoria.");
  assert.equal(readableText("Si misura con il tempo medio (kpi.servizio.tempo).", "ls"), "Si misura con il tempo medio.");
  assert.equal(readableText("Si misura con: kpi.servizio.tempo", "cliente"), "Si misura con");
  assert.equal(readableText("Vedi art. 5", "ls"), "Vedi art. 5", "Lateral Space keeps the reference it wrote");
  assert.equal(readableText("Costi da autorizzare (art. 8.4)", "cliente"), "Costi da autorizzare");
  const client = descriptionView({ ...sample, problema: "Oggi a memoria (F010, F011).", riferimenti: ["art. 5", "Verbale del 3 ott"] }, { audience: "cliente" });
  const texts = JSON.stringify([...client.main, ...client.more].map((b) => b.content));
  assert.deepEqual(findForbidden(texts, "cliente"), [], "nothing the copy guard forbids reaches the client");
  const refs = client.more.find((b) => b.def.key === "riferimenti")!.content;
  assert.deepEqual(refs, { kind: "elenco", items: ["Verbale del 3 ott"] }, "a line left empty disappears");
  const onlyArticles = descriptionView({ riferimenti: ["art. 5"] }, { audience: "cliente" });
  assert.equal(onlyArticles.empty, true, "a block left empty for the client is not shown");
  assert.deepEqual(readableContent({ kind: "schede", records: [{ rischio: "(F001)" }, { rischio: "Dati incompleti", mitigazione: "Controlli" }] }, "ls"), {
    kind: "schede",
    records: [{ rischio: "Dati incompleti", mitigazione: "Controlli" }],
  });
});

test("item keys leave the client's texts, with the brackets that cite them; Lateral Space keeps them", () => {
  // Invented titles shaped like the seeded ones: a key in brackets, a list of keys, a key in the sentence.
  assert.equal(readableText("Fatture del fornitore (Alfa Srl) o registro (da compilare, q.fonti.28) · Elenco mensile", "cliente"), "Fatture del fornitore (Alfa Srl) o registro · Elenco mensile");
  assert.equal(readableText("Registro dei pagamenti (estratti di src.banca.movimenti e src.banca.estratti_pdf) · Mensile", "cliente"), "Registro dei pagamenti · Mensile");
  assert.equal(readableText("Le urgenti seguono rule.servizio.urgenti_prima per gli ordini.", "cliente"), "Le urgenti seguono per gli ordini.");
  assert.equal(readableText("Il margine minimo (art. 15.2) si conferma; Scheda A.8 firmata.", "cliente"), "Il margine minimo si conferma; Scheda privacy firmata.");
  assert.equal(readableText("Si misura con: q.servizio.12", "cliente"), "Si misura con");
  assert.equal(stripItemKeys("Allegato verbale.doc.pdf, par.2 e f.to"), "Allegato verbale.doc.pdf, par.2 e f.to", "file names and abbreviations are not keys");
  assert.equal(readableText("Le urgenti seguono rule.servizio.urgenti_prima.", "ls"), "Le urgenti seguono rule.servizio.urgenti_prima.");
  for (const t of ["Vedi ent.richiesta, ent.cliente e src.crm.richieste.", "Conferma (art. 15.2, rule.x.y)", "q.servizio.12"]) {
    assert.deepEqual(findForbidden(readableText(t, "cliente"), "cliente"), [], t);
  }
  assert.equal(readableTitle("rule.servizio.urgenti", "cliente", "Regola"), "Regola", "a title that is only a key falls back, never shows the key");
  assert.equal(readableTitle("(art. 8.4)", "cliente", "Campo"), "Campo");
  assert.equal(readableTitle(null, "ls", "Fonte"), "Fonte");
  assert.equal(readableTitle("Soglia minima (F012)", "ls", "Regola"), "Soglia minima");
});

test("long lists show a preview with the right «show all» label", () => {
  assert.deepEqual(DESCRIPTION_PREVIEW, { come_funziona: 5, cosa_non_fa: 3 });
  assert.equal(showAllLabel("come_funziona", 7), "Mostra tutti i 7 passi");
  assert.equal(showAllLabel("cosa_non_fa", 9), "Mostra tutto");
});

test("blocks are read tolerantly", () => {
  assert.deepEqual(readBlock(descriptionBlockDef("cosa_non_fa")!, "una sola"), { kind: "elenco", items: ["una sola"] });
  assert.deepEqual(readBlock(descriptionBlockDef("per_chi")!, ["Solo il ruolo", { ruolo: " R ", altro: "x" }, 3]), {
    kind: "schede",
    records: [{ ruolo: "Solo il ruolo" }, { ruolo: "R" }],
  });
  assert.deepEqual(readBlock(descriptionBlockDef("perimetro")!, { dentro: ["a"], evoluzione: "b" }), { kind: "perimetro", inside: ["a"], evolution: ["b"] });
  assert.deepEqual(readBlock(descriptionBlockDef("in_breve")!, { not: "text" }), { kind: "testo", text: null });
});

test("unknown blocks are shown as plain lines, technical keys never", () => {
  const extra = extraBlocks({ ...sample, nota_extra: ["uno", { a: "due", b: "tre" }], impostazioni: { colore: "blu" } });
  assert.deepEqual(extra, [
    { key: "impostazioni", title: "Impostazioni", lines: ["Colore: blu"] },
    { key: "nota_extra", title: "Nota extra", lines: ["uno", "due · tre"] },
  ]);
});

test("block input is normalized with limits and empty rows removed", () => {
  assert.deepEqual(normalizeBlockInput("in_breve", "  Testo  \r\n"), { ok: true, value: "Testo" });
  assert.deepEqual(normalizeBlockInput("in_breve", "   "), { ok: true, value: null });
  assert.deepEqual(normalizeBlockInput("cosa_non_fa", "uno\n\n due \n"), { ok: true, value: ["uno", "due"] });
  assert.deepEqual(normalizeBlockInput("rischi", [{ rischio: "R", mitigazione: "", extra: "x" }, { rischio: " " }]), { ok: true, value: [{ rischio: "R" }] });
  assert.deepEqual(normalizeBlockInput("perimetro", { inside: ["a", ""], evolution: "b\nc" }), { ok: true, value: { caso_commerciale: ["a"], evoluzione: ["b", "c"] } });
  assert.equal(normalizeBlockInput("in_breve", "x".repeat(4001)).ok, false);
  assert.equal(normalizeBlockInput("cosa_non_fa", Array.from({ length: 101 }, (_, i) => `r${i}`)).ok, false);
  assert.equal(normalizeBlockInput("titolo", "x").ok, false);
  assert.equal(normalizeBlockInput("per_chi", "non un elenco").ok, false);
});

test("editor values round-trip through normalization", () => {
  for (const def of DESCRIPTION_BLOCKS) {
    const value = blockValueForEditor(def, (sample as Record<string, unknown>)[def.key]);
    const again = normalizeBlockInput(def.key, value);
    assert.ok(again.ok, def.key);
    if (again.ok) assert.equal(stableJson(again.value), stableJson(value), def.key);
  }
});

test("changing a block keeps the others and is detected", () => {
  const next = withBlock(sample, "uso_previsto", "Lo usa il servizio clienti.");
  assert.deepEqual(changedBlocks(sample, next), ["uso_previsto"]);
  assert.deepEqual(changedBlocks(sample, { ...sample }), []);
  assert.deepEqual(changedBlocks({ version: 1 }, { version: 2 }), [], "technical keys are not blocks");
});

test("versions come newest first with author, date and changed blocks", () => {
  const v1 = { in_breve: "uno" };
  const v2 = { in_breve: "due" };
  const v3 = { in_breve: "due", problema: "nuovo" };
  const history = parseDescriptionHistory([
    { at: "2026-10-02T10:00:00Z", by_user_id: "u2", description: v2 },
    { at: "2026-10-01T10:00:00Z", by_user_id: "u1", description: v1 },
    "malformed",
  ]);
  assert.equal(history.length, 2);
  const versions = descriptionVersions(v3, history);
  assert.deepEqual(versions, [
    { version: 3, current: true, createdAt: "2026-10-02T10:00:00Z", createdByUserId: "u2", changed: ["problema"] },
    { version: 2, current: false, createdAt: "2026-10-01T10:00:00Z", createdByUserId: "u1", changed: ["in_breve"] },
    { version: 1, current: false, createdAt: null, createdByUserId: null, changed: [] },
  ]);
  assert.deepEqual(descriptionAtVersion(v3, history, 1), v1);
  assert.deepEqual(descriptionAtVersion(v3, history, 3), v3);
  assert.equal(descriptionAtVersion(v3, history, 4), null);
  assert.equal(descriptionAtVersion(v3, history, 0), null);
});

test("the version to read comes from ?versione= and the current one is the page itself", () => {
  assert.equal(askedVersion("2", 3), 2);
  assert.equal(askedVersion(["1", "2"], 3), 1);
  assert.equal(askedVersion("3", 3), null);
  assert.equal(askedVersion("abc", 3), null);
  assert.equal(askedVersion("1234", 3), null);
  assert.equal(askedVersion(undefined, 3), null);
});

test("the 8 specification keys read like the seed blocks and never show twice", () => {
  const spec = {
    problema: "Oggi si decide a memoria.",
    cosa_fa: "Propone il team e spiega il perché.",
    cosa_non_fa: ["Non assegna da solo"],
    chi_lo_usa: "Chi coordina il servizio, ogni mattina.",
    esempio: "Richiesta inventata di un cliente A.",
    decisioni: [{ decisione: "Si parte dal canale email", data: "2026-10-01", chi: "Owner" }],
    evoluzioni: ["Risposta automatica, dopo l'AI Board"],
    riferimenti: ["art. 5"],
  };
  const view = descriptionView(spec, { audience: "ls" });
  const blocks = new Map([...view.main, ...view.more].map((b) => [b.def.key, b]));
  assert.deepEqual(blocks.get("soluzione")!.content, { kind: "testo", text: "Propone il team e spiega il perché." });
  assert.deepEqual(blocks.get("per_chi")!.content, { kind: "schede", records: [{ ruolo: "Chi coordina il servizio, ogni mattina." }] });
  assert.deepEqual(blocks.get("perimetro")!.content, { kind: "perimetro", inside: [], evolution: ["Risposta automatica, dopo l'AI Board"] });
  for (const k of ["problema", "cosa_non_fa", "esempio", "decisioni", "riferimenti"]) assert.equal(blocks.get(k)!.empty, false, k);
  assert.deepEqual(view.extras, [], "specification keys are not extra blocks");
  // The seed key wins when both exist; the editor starts from what the page shows.
  const both = { ...spec, soluzione: "Testo del seed." };
  assert.deepEqual(readBlock(descriptionBlockDef("soluzione")!, blockRaw(descriptionBlockDef("soluzione")!, both)), { kind: "testo", text: "Testo del seed." });
  assert.deepEqual(blockValueForEditor(descriptionBlockDef("perimetro")!, blockRaw(descriptionBlockDef("perimetro")!, spec)), { caso_commerciale: [], evoluzione: ["Risposta automatica, dopo l'AI Board"] });
  const withOwn = { perimetro: { caso_commerciale: ["A"], evoluzione: ["B"] }, evoluzioni: ["C"] };
  assert.deepEqual(blockRaw(descriptionBlockDef("perimetro")!, withOwn), withOwn.perimetro);
});
