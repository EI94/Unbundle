import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { referentCapabilities, referentItemDone, referentStatusLabel, type ReferentItemView, type ReferentModuleView } from "../public-view.ts";
import type { Json } from "../types.ts";
import type { ItemStatus, PrivacyClass, RequestItemState, ResponseType } from "../vocab.ts";
import { findForbiddenIn } from "./copy-guard.ts";
import {
  OTHER_TOPIC,
  QUICK,
  decodeIdList,
  decodeLast,
  encodeIdList,
  encodeLast,
  expiryNotice,
  homeProgressText,
  isOneTap,
  minutesWords,
  nextTopic,
  parseReferentHash,
  planReferentHome,
  progressValueText,
  questionsAndMinutes,
  quickRound,
  quickSteps,
  referentHash,
  stepDocumentTitle,
  storageKey,
  topicEntryHash,
  topicId,
  topicMinutes,
  topicSteps,
  type ReferentRoute,
} from "./referente-plan.ts";

const NOW = new Date("2026-10-12T10:00:00Z");
const TOKEN = "ucr_ABCDEFGHabcdefgh0123456789_-xyZ";
let seq = 0;

function uuid(): string {
  seq++;
  return `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
}

interface ItemOptions {
  type?: ResponseType | null;
  status?: ItemStatus;
  riState?: RequestItemState;
  privacy?: PrivacyClass;
  zoneOpen?: boolean;
  writable?: boolean;
  declared?: { display: string | null; canConfirm: boolean } | null;
  clarification?: string | null;
  validFrom?: boolean;
  title?: string;
}

function item(o: ItemOptions = {}): ReferentItemView {
  const status = o.status ?? "chiesta";
  const riState = o.riState ?? "da_fare";
  const privacyClass = o.privacy ?? "riservato_azienda";
  const personal = privacyClass === "personale" || privacyClass === "personale_equipaggio";
  const can = referentCapabilities({ status, requestItemState: riState, assignedToMe: true, privacyClass, personalZoneOpen: o.zoneOpen === true, writable: o.writable ?? true, delegationDepth: 0 });
  const label = referentStatusLabel({ status, requestItemState: riState, clarification: Boolean(o.clarification), hasDraft: false });
  const id = uuid();
  return {
    id,
    key: `q.prova.${seq}`,
    title: o.title ?? `Domanda ${seq}`,
    explanation: null,
    why: null,
    example: null,
    help: null,
    attachmentHint: null,
    responseType: o.type === undefined ? "numero" : o.type,
    config: {} as Record<string, Json>,
    status,
    statusReason: null,
    requestItemState: riState,
    label: label.label,
    tone: label.tone,
    done: referentItemDone({ status, requestItemState: riState }),
    personal,
    requiresValidFrom: o.validFrom === true,
    healthRuleQuestion: false,
    currentAnswerId: o.declared ? uuid() : null,
    toConfirm: o.declared ? { answerId: id, value: null, display: o.declared.display, sourceLabel: "In una call con Lateral Space", declaredInCall: true, canConfirm: o.declared.canConfirm, prefill: null, missing: [] } : null,
    ownAnswer: null,
    clarification: o.clarification ?? null,
    draft: null,
    files: [],
    can,
  };
}

function mod(key: string | null, title: string, items: ReferentItemView[], over: Partial<ReferentModuleView> = {}): ReferentModuleView {
  return { key, title, why: null, instructions: null, estimatedMinutes: null, estimatedLabel: null, questionCount: null, items, ...over };
}

test("one-tap answers: visible typed declared value, yes/no, single choice; never with «valido dal», personal, clarifications", () => {
  assert.equal(isOneTap(item({ declared: { display: "1.200", canConfirm: true } })), true);
  assert.equal(isOneTap(item({ declared: { display: "circa 1.200", canConfirm: false } })), false, "prose is retyped, not tapped");
  assert.equal(isOneTap(item({ type: "si_no" })), true);
  assert.equal(isOneTap(item({ type: "scelta" })), true);
  assert.equal(isOneTap(item({ type: "scelta_multipla" })), false);
  assert.equal(isOneTap(item({ declared: { display: "1.200", canConfirm: true }, validFrom: true })), false);
  assert.equal(isOneTap(item({ type: "si_no", privacy: "personale", zoneOpen: true })), false, "personal answers never wait in a draft");
  assert.equal(isOneTap(item({ type: "si_no", clarification: "Anche il sabato?" })), false);
  assert.equal(isOneTap(item({ type: "si_no", status: "in_verifica", riState: "inviata" })), false, "already sent");
  assert.equal(isOneTap(item({ type: "si_no", writable: false })), false, "paused case");
});

test("steps of a topic: schema order, heavy types at the end; sent and closed questions are not steps", () => {
  const a = item({ type: "tabella" });
  const b = item({ type: "numero" });
  const c = item({ type: "file" });
  const d = item({ type: "testo" });
  const sent = item({ status: "in_verifica", riState: "inviata" });
  const locked = item({ privacy: "personale" });
  const m = mod("m.prova", "Prezzi e sconti", [a, b, sent, c, d, locked]);
  assert.deepEqual(
    topicSteps(m).map((i) => i.id),
    [b.id, d.id, a.id, c.id],
  );
});

test("quick round crosses topics in schema order; ready answers stay in the round so step numbers do not move", () => {
  const t1 = item({ type: "si_no" });
  const t2 = item({ type: "numero" });
  const t3 = item({ declared: { display: "Sì", canConfirm: true }, type: "testo" });
  const t4 = item({ type: "scelta" });
  const view = { modules: [mod("m.a", "A", [t1, t2]), mod("m.b", "B", [t3, t4])] };
  assert.deepEqual(quickRound(view).map((i) => i.id), [t1.id, t3.id, t4.id]);
  assert.deepEqual(quickSteps(view, new Set([t3.id])).map((i) => i.id), [t1.id, t4.id]);
});

test("home: one primary card, chosen by state (clarification > send > resume > quick > first topic)", () => {
  const clar = item({ type: "testo", clarification: "Vale anche nel weekend?" });
  const q1 = item({ type: "si_no" });
  const q2 = item({ type: "si_no" });
  const q3 = item({ type: "scelta" });
  const n1 = item({ type: "numero" });
  const n2 = item({ type: "testo" });
  const topicA = mod("m.a", "Prezzi e sconti", [q1, q2, q3, n1]);
  const topicB = mod("m.b", "Costi del servizio", [n2]);

  const withClar = planReferentHome({ modules: [mod("m.c", "Chiarimenti", [clar]), topicA, topicB] }, { narrow: false });
  assert.deepEqual([withClar.primary?.kind, withClar.primary?.title, withClar.primary?.text, withClar.primary?.button], ["chiarimento", "Ti chiediamo un chiarimento", "Su una risposta che ci hai dato.", "Rispondi"]);
  assert.equal(withClar.primary?.hash, `#/chiarimento/${clar.id}`);

  const view = { modules: [topicA, topicB] };
  const ready = planReferentHome(view, { narrow: false, ready: new Set([q1.id, q2.id]) });
  assert.deepEqual([ready.primary?.kind, ready.primary?.title, ready.primary?.text, ready.primary?.button], ["invio", "Manca solo l'invio", "2 risposte pronte in «Prezzi e sconti».", "Controlla e invia"]);
  assert.equal(ready.primary?.hash, "#/a/m.a/invia");
  const spread = planReferentHome(view, { narrow: false, ready: new Set([q1.id, n2.id]) });
  assert.equal(spread.primary?.text, "2 risposte pronte in 2 argomenti.");
  assert.equal(spread.primary?.hash, "#/veloci/invia");

  // «Riprendi» only for a topic half done: opening a step and going back is not enough.
  const peeked = planReferentHome(view, { narrow: false, last: { topic: "m.b", n: 1 } });
  assert.equal(peeked.primary?.kind, "veloci", "an untouched topic in uc-last does not win");
  const peekedPlain = planReferentHome({ modules: [topicB, mod("m.d", "Sistemi", [item({ type: "numero" })])] }, { narrow: false, last: { topic: "m.d", n: 1 } });
  assert.deepEqual([peekedPlain.primary?.kind, peekedPlain.primary?.title], ["inizia", "Iniziamo da Costi del servizio"]);
  const resume = planReferentHome(view, { narrow: false, touched: new Set([n1.id]), last: { topic: "m.a", n: 4 } });
  assert.deepEqual([resume.primary?.kind, resume.primary?.title, resume.primary?.text, resume.primary?.hash], ["riprendi", "Riprendi da dove eri", "Prezzi e sconti · 0 di 4", "#/a/m.a/4"]);
  const elsewhere = planReferentHome(view, { narrow: false, touched: new Set([n2.id]), last: { topic: "m.a", n: 2 } });
  assert.deepEqual([elsewhere.primary?.kind, elsewhere.primary?.hash], ["riprendi", "#/a/m.b/1"], "the started topic, from its first step, when uc-last points elsewhere");

  const quick = planReferentHome(view, { narrow: false });
  assert.deepEqual([quick.primary?.kind, quick.primary?.title, quick.primary?.text, quick.primary?.hash], ["veloci", "Inizia dalle più veloci", "3 risposte con un tocco · circa 2 minuti", "#/veloci/1"]);

  const plain = planReferentHome({ modules: [mod("m.b", "Costi del servizio", [item({ type: "testo" }), item({ type: "numero" })], { why: "Ci serve per il ROI." })] }, { narrow: false });
  assert.deepEqual([plain.primary?.kind, plain.primary?.title, plain.primary?.text, plain.primary?.button], ["inizia", "Iniziamo da Costi del servizio", "2 domande · circa 3 minuti", "Inizia"]);
  assert.equal(plain.primary?.hash, "#/a/m.b", "the topic intro the first time");
  const seen = planReferentHome({ modules: plain.topics.length ? [mod("m.b", "Costi del servizio", [item({ type: "testo" })], { why: "Ci serve." })] : [] }, { narrow: false, introSeen: new Set(["m.b"]) });
  assert.equal(seen.primary?.hash, "#/a/m.b/1", "then straight to the first question");
});

test("home: topics, secondary lists, progress without the closed personal questions; finished when nothing is left", () => {
  const sent = item({ status: "in_verifica", riState: "inviata", title: "Tariffa oraria" });
  const ok = item({ status: "validata", riState: "inviata", title: "Penali" });
  const open = item({ type: "numero" });
  const heavy = item({ type: "tabella", title: "Tariffe per stagione" });
  const locked = item({ privacy: "personale", title: "Turni" });
  const skipped = item({ type: "testo", title: "Orari" });
  const topic = mod("m.a", "Prezzi e sconti", [sent, ok, open, heavy, locked, skipped], { estimatedMinutes: 12, questionCount: 6 });
  const plan = planReferentHome({ modules: [topic] }, { narrow: true, ready: new Set([open.id]), skipped: new Set([skipped.id]) });
  assert.deepEqual(plan.progress, { done: 2, total: 5 }, "the closed personal question is not counted");
  assert.deepEqual(plan.topics.map((t) => [t.title, t.line, t.status]), [["Prezzi e sconti", "3 di 5 · 1 pronta da inviare", "iniziato"]]);
  assert.deepEqual(plan.computer.map((r) => r.title), ["Tariffe per stagione"]);
  assert.deepEqual(plan.locked.map((r) => r.title), ["Turni"]);
  assert.deepEqual(plan.skipped.map((r) => [r.title, r.hash]), [["Orari", "#/a/m.a/2"]]);
  assert.deepEqual(plan.sent.map((r) => [r.title, r.label]), [["Tariffa oraria", "In verifica"], ["Penali", "A posto"]]);
  assert.equal(plan.sent[1].canUpdate, true, "a validated answer can still be updated");
  assert.equal(planReferentHome({ modules: [topic] }, { narrow: false }).computer.length, 0, "«Meglio dal computer» only on a phone");

  const fresh = planReferentHome({ modules: [mod("m.n", "Costi del servizio", [item({ type: "testo" }), item({ type: "numero" }), item({ type: "si_no" })])] }, { narrow: false });
  assert.equal(fresh.topics[0].line, "3 domande · circa 4 minuti");

  const done = planReferentHome({ modules: [mod("m.d", "Sistemi ed export", [sent])] }, { narrow: false });
  assert.deepEqual([done.primary, done.finished, done.topics[0].status, done.topics[0].line], [null, true, "inviato", "1 domanda inviata"]);
});

test("time: the topic estimate in proportion, otherwise fixed weights", () => {
  const items = [item({ type: "numero" }), item({ type: "numero" })];
  assert.equal(topicMinutes(mod("m.a", "A", items, { estimatedMinutes: 30, questionCount: 12 }), items), 5);
  assert.equal(topicMinutes(mod(null, "Altre domande", items), items), 2);
  assert.equal(topicMinutes(mod("m.a", "A", items), []), 0);
  assert.equal(minutesWords(1), "1 minuto");
  assert.equal(minutesWords(75), "1 ora e 15 minuti");
  assert.equal(questionsAndMinutes(1, 0), "1 domanda");
});

test("hashes: every step round-trips; anything else is the home", () => {
  const id = "11111111-2222-4333-8444-555555555555";
  const routes: ReferentRoute[] = [
    { screen: "home" },
    { screen: "intro", topic: "m.prezzi" },
    { screen: "passo", topic: "m.prezzi", n: 3 },
    { screen: "invia", topic: "m.prezzi" },
    { screen: "inviate", topic: OTHER_TOPIC },
    { screen: "passo", topic: OTHER_TOPIC, n: 2 },
    { screen: "passo", topic: "_extra", n: 1 },
    { screen: "intro", topic: "_extra.prezzi" },
    { screen: "invia", topic: "veloci" },
    { screen: "passo", topic: "altre", n: 1 },
    { screen: "veloci", n: 4 },
    { screen: "invia", topic: QUICK },
    { screen: "inviate", topic: QUICK },
    { screen: "collega", itemId: id },
    { screen: "collega", itemId: id, wholeTopic: true },
    { screen: "chiarimento", itemId: id },
    { screen: "voce", itemId: id },
  ];
  for (const r of routes) assert.deepEqual(parseReferentHash(referentHash(r)), r, referentHash(r));
  assert.equal(referentHash({ screen: "passo", topic: "m.prezzi", n: 3 }), "#/a/m.prezzi/3");
  assert.equal(referentHash({ screen: "veloci", n: 2 }), "#/veloci/2");
  for (const bad of ["", "#", "#/a", "#/a/m.x/0", "#/a/m.x/abc", "#/collega/not-an-id", "#/a/<script>/1", "#/%E0%A4%A", "#/chiarimento/x/y"]) {
    assert.deepEqual(parseReferentHash(bad), { screen: "home" }, bad);
  }
  assert.deepEqual(parseReferentHash(`#/chiarimento/${id.toUpperCase()}`), { screen: "chiarimento", itemId: id });
  // Reserved ids are not module keys: a module «veloci» or «altre» is a topic like the others.
  assert.notEqual(referentHash({ screen: "invia", topic: "veloci" }), referentHash({ screen: "invia", topic: QUICK }));
  assert.deepEqual(parseReferentHash("#/a/veloci/invia"), { screen: "invia", topic: "veloci" });
  assert.deepEqual(parseReferentHash("#/veloci/invia"), { screen: "invia", topic: QUICK });
  assert.equal(/^[a-z0-9_]+(\.[a-z0-9_]+)*$/.test(OTHER_TOPIC), false, "no module key can be the group without a module");
  assert.equal(/^[a-z0-9_]+(\.[a-z0-9_]+)*$/.test(QUICK), false);
  assert.deepEqual(decodeLast(encodeLast({ topic: "_extra", n: 2 })), { topic: "_extra", n: 2 });
});

test("topic rows: the intro the first time, then the first open step, then the review", () => {
  const plan = planReferentHome({ modules: [mod("m.a", "A", [item(), item()], { instructions: "Rispondete a stima." })] }, { narrow: false });
  const t = plan.topics[0];
  assert.equal(topicEntryHash(t, new Set()), "#/a/m.a");
  assert.equal(topicEntryHash(t, new Set(["m.a"])), "#/a/m.a/1");
  assert.equal(topicEntryHash(t, new Set(["m.a"]), new Set([t.steps[0]])), "#/a/m.a/2");
  assert.equal(topicEntryHash(t, new Set(["m.a"]), new Set(t.steps)), "#/a/m.a/invia");
  assert.equal(topicId({ key: null }), OTHER_TOPIC);
  assert.equal(topicId({ key: "altre" }), "altre");
});

test("next topic after sending (R7): the next one with open questions, then from the start", () => {
  const view = { modules: [mod("m.a", "A", [item()]), mod("m.b", "B", [item({ status: "in_verifica", riState: "inviata" })]), mod("m.c", "C", [item()])] };
  const plan = planReferentHome(view, { narrow: false });
  assert.equal(nextTopic(plan.topics, "m.a")?.id, "m.c");
  assert.equal(nextTopic(plan.topics, "m.c")?.id, "m.a");
  assert.equal(nextTopic(plan.topics, null)?.id, "m.a");
});

test("screen readers and the tab title", () => {
  assert.equal(stepDocumentTitle(3, 12, "Prezzi e sconti"), "Domanda 3 di 12 · Prezzi e sconti · Unbundle");
  assert.equal(homeProgressText(36, 112), "36 di 112 risposte");
  assert.equal(homeProgressText(1, 1), "1 di 1 risposta");
  assert.equal(progressValueText(36, 112), "36 risposte su 112");
  assert.equal(progressValueText(1, 12_000), "1 risposta su 12.000");
  assert.equal(homeProgressText(1_234, 2_812), "1.234 di 2.812 risposte", "the dot of thousands from 1.000, as in the dossier");
});

test("link expiry: at the bottom, then up and amber in the last 3 days", () => {
  assert.deepEqual(expiryNotice("2026-11-12T10:00:00Z", NOW), { soon: false, text: "Vale fino al 12 novembre." });
  assert.equal(expiryNotice("2026-11-08T10:00:00Z", NOW)?.text, "Vale fino all'8 novembre.");
  assert.deepEqual(expiryNotice("2026-10-14T09:00:00Z", NOW), { soon: true, text: "Il link scade tra 2 giorni. Se ti serve più tempo, scrivi a chi te l'ha mandato." });
  assert.equal(expiryNotice("2026-10-12T20:00:00Z", NOW)?.text, "Il link scade tra 1 giorno. Se ti serve più tempo, scrivi a chi te l'ha mandato.");
  assert.equal(expiryNotice("2026-10-01T10:00:00Z", NOW), null);
  assert.equal(expiryNotice("boh", NOW), null);
});

test("device memories: link prefix only, valid shapes only", () => {
  assert.equal(storageKey("skip", TOKEN), "uc-skip:ucr_ABCDEFGH");
  assert.equal(storageKey("last", TOKEN).length, "uc-last:".length + 12, "the prefix is not enough to rebuild the link");
  const id = "11111111-2222-4333-8444-555555555555";
  assert.deepEqual(decodeIdList(encodeIdList([id, id, "nope"]), "item"), [id]);
  assert.deepEqual(decodeIdList(encodeIdList(["m.prezzi", "<x>"]), "topic"), ["m.prezzi"]);
  assert.deepEqual(decodeIdList("not json"), []);
  assert.deepEqual(decodeIdList(null), []);
  assert.deepEqual(decodeLast(encodeLast({ topic: "m.prezzi", n: 3 })), { topic: "m.prezzi", n: 3 });
  assert.equal(decodeLast(JSON.stringify({ argomento: "m.prezzi", n: 0 })), null);
  assert.equal(decodeLast("{"), null);
});

test("every text the plan writes passes the copy-guard", () => {
  const view = {
    modules: [
      mod("m.a", "Prezzi e sconti", [item({ type: "si_no" }), item({ type: "si_no" }), item({ type: "scelta" }), item({ clarification: "Vale anche il sabato?" })]),
      mod("m.b", "Costi del servizio", [item({ status: "in_verifica", riState: "inviata" })]),
    ],
  };
  const texts: string[] = [];
  for (const state of [{ narrow: true }, { narrow: false, ready: new Set([view.modules[0].items[0].id]) }]) {
    const p = planReferentHome(view, state);
    if (p.primary) texts.push(p.primary.title, p.primary.text, p.primary.button);
    for (const t of p.topics) texts.push(t.title, t.line);
    for (const s of p.sent) texts.push(s.label);
  }
  texts.push(stepDocumentTitle(1, 2, "Prezzi e sconti"), homeProgressText(1, 2), progressValueText(1, 2), expiryNotice("2026-10-13T10:00:00Z", NOW)?.text ?? "");
  assert.deepEqual(findForbiddenIn(texts, "cliente"), []);
});

/**
 * The fixed texts written in the referent components (labels, hints, options,
 * buttons): what the static scan reads is close enough to what the page renders.
 * Paths, imports and code are left out. `approvals-view.tsx` belongs to the
 * signatures package (WP9) and is checked there.
 */
function referentComponentTexts(): { file: string; text: string }[] {
  const root = fileURLToPath(new URL("../../../components/uc/referente/", import.meta.url));
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return files(path);
      return path.endsWith(".tsx") && name !== "approvals-view.tsx" ? [path] : [];
    });
  const out: { file: string; text: string }[] = [];
  for (const path of files(root)) {
    const file = path.slice(root.length);
    const source = readFileSync(path, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
      .replace(/^\s*import .*$/gm, "");
    const add = (text: string) => {
      const t = text.replace(/\s+/g, " ").trim();
      if (!/[A-Za-zÀ-ÿ]/.test(t) || /^[./@#]/.test(t) || /^\)|\($|=>/.test(t)) return;
      out.push({ file, text: t });
    };
    for (const m of source.matchAll(/>([^<>{}]+)</g)) add(m[1]);
    for (const m of source.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)) add(m[1]);
    for (const m of source.matchAll(/`((?:[^`\\]|\\.)*)`/g)) add(m[1].replace(/\$\{[^}]*\}/g, "1"));
  }
  return out;
}

test("fixed texts of the referent components pass the copy-guard (labels, hints, options)", () => {
  const texts = referentComponentTexts();
  const all = texts.map((t) => t.text);
  // The scan reads what it should: a label, a hint and an option of the test-case input.
  assert.ok(all.includes("Regole toccate"));
  assert.ok(all.includes("Scrivi quali regole usa questo caso, separate da virgole."));
  assert.ok(all.includes("Reale, senza nomi (dopo l'approvazione della scheda privacy)"));
  assert.ok(all.includes("Gira tutto l'argomento a un collega") || all.includes("Gira tutto l&apos;argomento a un collega"));
  const found = texts.flatMap((t) => findForbiddenIn([t.text], "cliente").map((f) => `${t.file}: «${f.match}» in «${t.text}»`));
  assert.deepEqual(found, []);
});
