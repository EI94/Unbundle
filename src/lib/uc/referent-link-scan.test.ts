import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { scanNote, scanPersonalData, scanStatement } from "../context/scan.ts";
import { checkQuestionTitle, checkSubmitText } from "../use-cases/referent/text.ts";
import { referentCapabilities, referentLinkScan, REFERENT_PRIVACY_NOTICE, type ReferentItemView } from "./public-view.ts";
import { scanText } from "./text/scan.ts";
import { checkDelegate, checkSubmit, draftHardBlock, initialForm } from "./views/referente-form.ts";
import type { Json } from "./types.ts";

// (Ondata 0, privacy calma del 04/11) La pagina del referente `/r` come `/rispondi` dal rilascio 5.1: nomi, email e
// telefoni passano; dati sanitari e preferenze discriminatorie si fermano sempre, codici fiscali e date di nascita
// all'invio. Gli altri chiamanti della scansione («Contesto», i testi del team, i casi di prova, il seed) restano
// com'erano. Dati inventati.

const NOW = new Date("2026-11-18T10:00:00Z");
const ITEM = "66666666-6666-4666-8666-666666666666";

function item(over: Partial<ReferentItemView> = {}): ReferentItemView {
  const can = referentCapabilities({ status: "chiesta", requestItemState: "da_fare", assignedToMe: true, privacyClass: "riservato_azienda", personalZoneOpen: false, writable: true, delegationDepth: 0 });
  return {
    id: ITEM,
    key: "q.servizio.01",
    title: "Chi decide le priorità del servizio?",
    explanation: null,
    why: null,
    example: null,
    help: null,
    attachmentHint: null,
    responseType: "testo",
    config: {} as Record<string, Json>,
    status: "chiesta",
    statusReason: null,
    requestItemState: "da_fare",
    label: "Da rispondere",
    tone: "da_fare",
    done: false,
    personal: false,
    requiresValidFrom: false,
    healthRuleQuestion: false,
    currentAnswerId: null,
    toConfirm: null,
    ownAnswer: null,
    clarification: null,
    draft: null,
    files: [],
    can,
    ...over,
  };
}

const answer = (i: ReferentItemView, text: string, note = "") => checkSubmit(i, { ...initialForm(i), value: { text }, note }, "invia", [], NOW);
const codes = (list: { code: string }[]) => list.map((x) => x.code);

test("referentLinkScan: the answer context with names and contacts allowed; the health rule question only when the item has it", () => {
  assert.deepEqual(referentLinkScan(), { context: "risposta", allowNamesAndContacts: true });
  assert.deepEqual(referentLinkScan({ healthRuleQuestion: false, title: "Domanda" }), { context: "risposta", allowNamesAndContacts: true });
  assert.deepEqual(referentLinkScan({ healthRuleQuestion: true, title: "Quali dati sanitari escludete?" }), {
    context: "risposta",
    allowNamesAndContacts: true,
    healthRuleQuestion: { questionText: "Quali dati sanitari escludete?" },
  });
});

test("/r before sending: a colleague's name, an email and a phone pass, in the answer and in the note", () => {
  const ok = answer(item(), "Decide Anna Bianchi, la responsabile del servizio: anna.bianchi@cliente.test", "Oppure il 333 1234567");
  assert.deepEqual([ok.ok, ok.errors, ok.warnings], [true, [], []]);
  const notKnown = checkSubmit(item(), { ...initialForm(item()), whoMightKnow: "Anna Bianchi" }, "non_so", [], NOW);
  assert.equal(notKnown.ok, true);
  const delegate = checkDelegate({ nome: "Anna Bianchi", email: "anna@cliente.test", messaggio: "Ciao Anna, mi chiami al 333 1234567?", voci: [ITEM] }, [ITEM]);
  assert.equal(delegate.ok, true, JSON.stringify(delegate.errors));
});

test("/r before sending: health data, discrimination, tax codes and birth dates are still refused", () => {
  assert.deepEqual(codes(answer(item(), "Decide Anna Bianchi dopo la visita medica").errors), ["testo_sanitario"]);
  assert.deepEqual(codes(answer(item(), "Solo piloti donne").errors), ["testo_discriminatorio"]);
  assert.deepEqual(codes(answer(item(), "Il codice è RSSMRA80A01H501U").errors), ["testo_codice_fiscale"]);
  assert.deepEqual(codes(answer(item(), "È nata il 12/03/1980").errors), ["testo_data_nascita"]);
  assert.equal(draftHardBlock(item(), { payload: { text: "Anna Bianchi è in malattia" } })?.code, "testo_sanitario");
  assert.equal(draftHardBlock(item(), { payload: { text: "Anna Bianchi, anna.bianchi@cliente.test" } }), null);
  const health = checkDelegate({ nome: "Anna Bianchi", email: "anna@cliente.test", messaggio: "Chiedi dopo la visita medica", voci: [ITEM] }, [ITEM]);
  assert.equal(health.ok, false);
});

test("the other callers keep their rules: «Contesto», the titles of the questions, the referent texts of /rispondi", () => {
  // «Contesto»: un fatto con un nome o un contatto non passa; un appunto sì (lo vede solo Lateral Space).
  assert.equal(!scanPersonalData("Anna Bianchi decide gli acquisti.").ok && "nome_persona", "nome_persona");
  assert.deepEqual(scanStatement("Per gli ordini si scrive a ordini@cliente.test."), { ok: false, issue: "contatto", message: "Non scrivere email o numeri di telefono: indica il ruolo della persona." });
  assert.deepEqual(scanNote("Anna Bianchi dice che il gestionale è nuovo."), { ok: true });
  // Il titolo di una domanda di «Chiedi al referente»: un nome si rifiuta ancora.
  assert.equal(!checkQuestionTitle("Chiedi ad Anna Bianchi i turni").ok && "rifiutato", "rifiutato");
  // Il referente di /rispondi: nomi e contatti passavano già, il codice fiscale no.
  assert.deepEqual(checkSubmitText("Anna Bianchi, anna.bianchi@cliente.test", "testo"), { ok: true });
  assert.equal(checkSubmitText("RSSMRA80A01H501U", "testo").ok, false);
  // La scansione senza l'opzione, in ogni contesto: il nome si trova.
  for (const context of ["risposta", "commento", "caso_prova", "seed", "testo_ls"] as const) {
    assert.ok(scanText("Anna Bianchi", { context }).blocking.some((f) => f.category === "nome_persona"), context);
  }
});

/** I sorgenti dell'app (senza i test). */
function sources(dir: URL): string[] {
  return (readdirSync(dir, { recursive: true }) as string[]).filter((f) => /\.(ts|tsx|mjs)$/.test(f) && !/\.test\.(ts|tsx|mjs)$/.test(f));
}

test("only /r opts in: the option is set by referentLinkScan and read by the scan, nowhere else", () => {
  const src = new URL("../../", import.meta.url);
  const users = sources(src).filter((f) => readFileSync(new URL(f, src), "utf8").includes("allowNamesAndContacts"));
  assert.deepEqual(users.sort(), ["lib/uc/answers/prepare.ts", "lib/uc/public-view.ts", "lib/uc/text/scan.ts"]);
  for (const file of ["lib/db/queries/uc-public.ts", "lib/uc/views/referente-form.ts"]) {
    const source = readFileSync(new URL(file, src), "utf8");
    assert.match(source, /referentLinkScan\(/, `${file}: le regole di /r`);
    assert.doesNotMatch(source, /context: "risposta"/, `${file}: nessuna scansione con le regole di prima`);
  }
});

test("the /r notice is a new version and says it calmly: names are used for this use case only, files are checked, nothing «blocks»", () => {
  const n = REFERENT_PRIVACY_NOTICE;
  assert.equal(n.version, "uc-2026-11-1");
  const all = [n.lead, ...n.summary, ...n.paragraphs].join(" ");
  assert.doesNotMatch(all, /blocca/i);
  assert.doesNotMatch(all, /Non scrivere/);
  assert.match(all, /Se scrivi il nome di un collega, un'email o un telefono, li usiamo solo per questo caso d'uso\./);
  assert.match(all, /se ne troviamo, ti chiediamo di toglierli/);
  assert.ok(n.paragraphs.includes("Ogni file passa da un controllo automatico prima di essere usato."));
  assert.doesNotMatch(all.replace(/caso d'uso/g, ""), /\bcaso\b/, "fuori dalla dashboard «caso d'uso»");
});
