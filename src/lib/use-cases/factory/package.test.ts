// Il pacchetto dell'Agent Factory (rilascio 8.0a): tre file, niente nomi né e-mail, la stessa impronta per lo
// stesso contenuto, e un brief che sta nel contesto dei coding agent. (9b) `CONTESTO.md` facoltativo, con i fatti «Per
// tutti» che porta `loadAgentContext`: senza contesto i file e l'impronta di prima.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  contextFileDelta,
  contextFileFacts,
  contextSectionsFor,
  givenNames,
  nameTokens,
  packageContent,
  packageContextDelta,
  packageFiles,
  packageHash,
  PACKAGE_OPTIONAL_FILES,
  redact,
  redactAgentContext,
  type PackageSource,
} from "./package.ts";
import { PACKAGE_FILES } from "../../db/use-case-hub-factory-ddl.ts";
import type { AgentContext, AgentFact } from "../../context/work/agent-text.ts";

const source = (over: Partial<PackageSource> = {}): PackageSource => ({
  code: "PX-0049",
  title: "LUNA · Risposta automatica alle richieste di preventivo dal portale",
  kindLabel: "use case AI",
  origin: "adoption",
  targetQuarter: "T1 2027",
  texts: {
    oggi: "Per ogni richiesta un commerciale controlla a mano prezzo, equipaggi e aeroporti.",
    comeCambia: "L'AI incrocia il gestionale, aperture e limitazioni, calcola il prezzo e prepara la quotazione.",
    persone: "Il team commerciale gestisce le richieste che l'AI non quota.",
    limiti: "Non conferma voli e non assegna equipaggi.",
    dati: "Richieste dal portale, turni dal gestionale, aperture e limitazioni.",
  },
  benefits: [
    { label: "Voli in più presi rispondendo prima", lever: "ricavi", eurYear: 230000, confidence: "ipotesi" },
    { label: "Errori evitati", lever: "rischio", eurYear: null, confidence: "ipotesi" },
  ],
  costText: null,
  answers: [{ question: "Come si calcola il prezzo", answer: "Dal profilo prezzi del portale, rivisto di poco.", on: "2026-11-06", status: "in verifica" }],
  openNeeds: [{ title: "Accesso di prova al portale", status: "da chiedere" }],
  namesToHide: ["Mario Rossi", "Giulia Bianchi"],
  ...over,
});

test("i tre file, con la versione e il giorno; il pacchetto dice che è di sola lettura", () => {
  const files = packageFiles(source(), { version: 2, day: "2026-11-11" });
  assert.deepEqual(Object.keys(files).sort(), [...PACKAGE_FILES].sort());
  assert.equal(files.VERSIONE, "k2 · PX-0049 · 2026-11-11 · generato da Unbundle\n");
  assert.match(files["PACCHETTO.md"], /^# Pacchetto del caso PX-0049 \(k2\)\n\nSola lettura\. Generato da Unbundle il 11\/11\/2026/);
  assert.match(files["PACCHETTO.md"], /- \*\*Tipo:\*\* use case AI · origine «adoption» · approvato per il \*\*T1 2027\*\*/);
  assert.match(files["PACCHETTO.md"], /\| Voli in più presi rispondendo prima \| ricavi \| 230\.000 \|/);
  assert.match(files["PACCHETTO.md"], /\| Errori evitati \| rischio \| da misurare \|/);
  assert.match(files["PACCHETTO.md"], /1\. \*\*Come si calcola il prezzo\*\* \(06\/11\/2026, in verifica\) Dal profilo prezzi/);
  assert.match(files["PACCHETTO.md"], /- Accesso di prova al portale \(da chiedere\)/);
  assert.match(files["BRIEF.md"], /^# PX-0049 · LUNA · Risposta automatica/);
});

test("la stessa impronta per lo stesso contenuto, qualunque versione e giorno; un testo cambiato la cambia", () => {
  const a = packageHash(packageContent(source()));
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(packageHash(packageContent(source())), a);
  const changed = source({ openNeeds: [] });
  assert.notEqual(packageHash(packageContent(changed)), a);
  const one = packageFiles(source(), { version: 1, day: "2026-11-09" });
  const two = packageFiles(source(), { version: 7, day: "2027-01-01" });
  assert.notEqual(one.VERSIONE, two.VERSIONE);
});

test("niente nomi, e-mail né telefoni: diventano «una persona» e «[numero]»; LUNA in maiuscolo e gli importi restano", () => {
  const leaky = source({
    texts: {
      oggi: "Oggi Mario Rossi (mario.rossi@cliente.example) controlla tutto; per urgenze chiamare +39 333 123 4567.",
      comeCambia: "Giulia approva le eccezioni; il valore stimato è 1.200.000 € e il 12 % delle richieste.",
      persone: null,
      limiti: null,
      dati: null,
    },
    answers: [{ question: "Chi decide?", answer: "Decide Bianchi, il responsabile.", on: null, status: "verificata" }],
  });
  const files = packageFiles(leaky, { version: 1, day: "2026-11-11" });
  const all = Object.values(files).join("\n");
  for (const leak of ["Mario", "Rossi", "Giulia", "Bianchi", "@", "333 123 4567"]) assert.ok(!all.includes(leak), `trapela: ${leak}`);
  assert.match(all, /Oggi una persona \(una persona\) controlla tutto; per urgenze chiamare \[numero\]\./);
  assert.match(all, /1\.200\.000 €/);
  assert.match(all, /LUNA · Risposta automatica/);
  assert.match(all, /Decide una persona, il responsabile\./);
});

test("i nomi da coprire: interi e per parti, qualunque maiuscola; un nome di battesimo tutto maiuscolo resta; mai le e-mail né i pezzi corti", () => {
  assert.deepEqual(nameTokens(["Mario Rossi", "Al Bo", "x@y.it", "Luna", "giulia bianchi"]), ["giulia bianchi", "Mario Rossi", "bianchi", "giulia", "Mario", "Rossi", "Al Bo", "Luna"]);
  const names = ["Luna", "Mario Rossi", "giulia bianchi"];
  const t = nameTokens(names);
  const g = givenNames(names);
  assert.equal(redact("LUNA · famiglia di Luna", t, g), "LUNA · famiglia di una persona");
  assert.equal(redact("mario rossi e ROSSI; Giulia e BIANCHI", t, g), "una persona e una persona; una persona e una persona");
  assert.equal(redact("Marione e Mario", t, g), "Marione e una persona");
  assert.equal(redact("LUNA senza i nomi di battesimo", t), "una persona senza i nomi di battesimo", "senza l'elenco dei nomi di battesimo, nessuna eccezione");
});

test("i telefoni: con virgole, barre, parentesi, trattini, il prefisso; mai gli importi né le date", () => {
  const cases: Array<[string, string]> = [
    ["Chiama 333 1234567, poi", "Chiama [numero], poi"],
    ["+39 333-123-4567, ufficio", "[numero], ufficio"],
    ["333/1234567", "[numero]"],
    ["(02) 1234 5678", "[numero]"],
    ["tel.3331234567", "tel.[numero]"],
    ["valore 1.200.000 €", "valore 1.200.000 €"],
    ["il 2026-11-09 alle 9", "il 2026-11-09 alle 9"],
    ["10 ore, 25 €", "10 ore, 25 €"],
  ];
  for (const [input, expected] of cases) assert.equal(redact(input, []), expected, input);
});

test("senza benefici, costi, risposte o esigenze il pacchetto lo dice; i testi lunghi si tagliano; il brief resta corto", () => {
  const empty = source({ benefits: [], answers: [], openNeeds: [], texts: { oggi: null, comeCambia: "x".repeat(5000), persone: null, limiti: null, dati: null } });
  const files = packageFiles(empty, { version: 1, day: "2026-11-11" });
  assert.match(files["PACCHETTO.md"], /Benefici non ancora stimati nella scheda\./);
  assert.match(files["PACCHETTO.md"], /Costi di avvio e ricorrenti: non ancora stimati/);
  assert.match(files["PACCHETTO.md"], /Nessuna risposta ancora\./);
  assert.match(files["PACCHETTO.md"], /Nessuna esigenza aperta in «Cosa serve» della scheda\./);
  assert.ok(!files["PACCHETTO.md"].includes("x".repeat(2001)));
  assert.ok(files["BRIEF.md"].length < 1200, "il brief entra nel contesto da 300 token");
  assert.ok(Buffer.byteLength(Object.values(files).join(""), "utf8") < 200_000, "entra nel limite della tabella");
});

test("una barra verticale in una voce non rompe la tabella", () => {
  const files = packageFiles(source({ benefits: [{ label: "Prezzo | IVA", lever: "ricavi", eurYear: 10, confidence: null }] }), { version: 1, day: "2026-11-11" });
  assert.match(files["PACCHETTO.md"], /\| Prezzo \/ IVA \| ricavi \| 10 \|/);
});

test("chi non vede «Cosa serve» genera un pacchetto senza risposte né esigenze, e il pacchetto lo dice", () => {
  const files = packageFiles(source({ needsHidden: true }), { version: 1, day: "2026-11-11" });
  assert.ok(!files["PACCHETTO.md"].includes("Dal profilo prezzi"), "nessuna risposta del referente");
  assert.ok(!files["PACCHETTO.md"].includes("Accesso di prova al portale"), "nessuna esigenza");
  assert.match(files["PACCHETTO.md"], /Le porta nel pacchetto chi vede «Cosa serve» sulla scheda/);
  assert.notEqual(packageHash(packageContent(source({ needsHidden: true }))), packageHash(packageContent(source())), "è un contenuto diverso");
});

// ─── (9b) CONTESTO.md (RILASCIO-9b-COSTRUZIONE.md §2.4, D8) ───────────

const agentFact = (statement: string, over: Partial<AgentFact> = {}): AgentFact => ({ statement, section: "sistemi", source: "call", on: "2026-11-14", ...over });
const EMPTY_CONTEXT: AgentContext = { brief: [], caseFacts: [], rules: [], words: [], commitments: [], questions: [], since: null };
const CONTEXT: AgentContext = {
  ...EMPTY_CONTEXT,
  brief: ["Azienda di trasporto aereo con una flotta di sei velivoli."],
  caseFacts: [agentFact("Il gestionale esporta i preventivi solo in CSV, ogni notte.")],
  rules: [agentFact("I dati dei passeggeri restano in Italia.", { section: "regole", source: "referente", on: "2026-11-12" })],
};
/** L'impronta di prima della 9b: SHA-256 di `body\n\0\nbrief`. */
const oldHash = (content: { body: string; brief: string }) => createHash("sha256").update(`${content.body}\n\u0000\n${content.brief}`, "utf8").digest("hex");

test("(9b) senza contesto: i tre file e l'impronta di prima della 9b, anche con «In breve» ma senza fatti", () => {
  assert.deepEqual([...PACKAGE_OPTIONAL_FILES], ["CONTESTO.md"]);
  for (const context of [undefined, null, EMPTY_CONTEXT, { ...EMPTY_CONTEXT, brief: ["Una riga di «In breve»."] }]) {
    const content = packageContent(source({ context }));
    assert.equal(content.contesto, null);
    assert.equal(packageHash(content), oldHash(content), "la stessa impronta: nessuna versione nuova senza contesto");
    assert.equal(packageHash(content), packageHash(packageContent(source())));
    const files = packageFiles(source({ context }), { version: 2, day: "2026-11-18" });
    assert.deepEqual(Object.keys(files).sort(), [...PACKAGE_FILES].sort(), "nessun CONTESTO.md");
  }
});

test("(9b) con il contesto: CONTESTO.md con codice, versione e giorno; un'impronta diversa, che non cambia con versione e giorno", () => {
  const withContext = source({ context: CONTEXT });
  const content = packageContent(withContext);
  assert.ok(content.contesto);
  const hash = packageHash(content);
  assert.notEqual(hash, packageHash(packageContent(source())), "il contesto entra nell'impronta");
  assert.notEqual(hash, oldHash(content));
  assert.equal(hash, createHash("sha256").update(`${content.body}\n\u0000\n${content.brief}\n\u0000\n${content.contesto}`, "utf8").digest("hex"));
  const files = packageFiles(withContext, { version: 3, day: "2026-11-18" }, content);
  assert.deepEqual(Object.keys(files).sort(), [...PACKAGE_FILES, ...PACKAGE_OPTIONAL_FILES].sort());
  const file = files["CONTESTO.md"] ?? "";
  assert.match(file, /^# Contesto del cliente per PX-0049 \(k3\)\n\nSola lettura: lo scrive Unbundle con i fatti che Lateral Space ha confermato\. Le persone sono indicate per ruolo\. Aggiornato il 2026-11-18\.\n\n## In breve\n/);
  assert.match(file, /\n## Che cosa tocca questo caso\n- Il gestionale esporta i preventivi solo in CSV, ogni notte\. \(call del 14\/11\/2026\)\n/);
  assert.match(file, /\n## Regole e vincoli\n- I dati dei passeggeri restano in Italia\. \(risposta del referente del 12\/11\/2026\)\n$/);
  assert.ok(file.endsWith(`\n\n${content.contesto}\n`), "l'impronta è sulle sezioni del file, senza l'intestazione");
  // Un altro giorno, un'altra versione: lo stesso contenuto, la stessa impronta; il file dice la sua versione.
  assert.equal(packageHash(packageContent(source({ context: CONTEXT }))), hash);
  assert.match(packageFiles(withContext, { version: 9, day: "2027-01-04" })["CONTESTO.md"] ?? "", /^# Contesto del cliente per PX-0049 \(k9\)\n[\s\S]*Aggiornato il 2027-01-04\./);
  // Un fatto nuovo cambia l'impronta (la versione dopo nasce al prossimo «Aggiorna il pacchetto»).
  const more = source({ context: { ...CONTEXT, words: [agentFact("«Tratta» vuol dire un volo con andata e ritorno.", { section: "parole" })] } });
  assert.notEqual(packageHash(packageContent(more)), hash);
});

test("(9b) un nome noto diventa «una persona» in CONTESTO.md: frasi dei fatti e righe di «In breve»; fonti e codice restano", () => {
  const named = source({
    code: "ROSA-0001",
    namesToHide: ["Mario Rossi", "Maria Rosa"],
    context: {
      ...CONTEXT,
      brief: ["Le quotazioni le firma Mario Rossi."],
      caseFacts: [agentFact("Rossi controlla i preventivi oltre 50.000 € (mario.rossi@cliente.example)."), agentFact("Il turno di Rosa copre il sabato.", { source: "costruzione", on: "2026-11-18" })],
    },
  });
  const file = packageFiles(named, { version: 1, day: "2026-11-18" })["CONTESTO.md"] ?? "";
  assert.match(file, /^# Contesto del cliente per ROSA-0001 \(k1\)\n/, "il codice resta intero");
  assert.match(file, /\n- Le quotazioni le firma una persona\.\n/);
  assert.match(file, /\n- una persona controlla i preventivi oltre 50\.000 € \(una persona\)\. \(call del 14\/11\/2026\)\n/);
  assert.match(file, /\n- Il turno di una persona copre il sabato\. \(imparato costruendo il 18\/11\/2026\)\n/);
  assert.doesNotMatch(file.replace(/ROSA-0001/g, ""), /Mario|Rossi|Rosa|@/);
  // Lo stesso per lo strato della CLI: impegni con il ruolo e domande con a chi chiedere.
  const hidden = redactAgentContext(
    { ...EMPTY_CONTEXT, commitments: [{ statement: "Mario manda l'export", party: "cliente", role: "Ufficio di Rossi", dueOn: "2026-11-25" }], questions: [{ question: "Chi sostituisce Rossi?", askWhom: "Segreteria di Mario" }] },
    ["Mario Rossi"],
  );
  assert.deepEqual(hidden.commitments, [{ statement: "una persona manda l'export", party: "cliente", role: "Ufficio di una persona", dueOn: "2026-11-25" }]);
  assert.deepEqual(hidden.questions, [{ question: "Chi sostituisce una persona?", askWhom: "Segreteria di una persona" }]);
});

test("(9b) chi genera il pacchetto prende il contesto solo da loadAgentContext, che legge solo «Per tutti»; un contesto non letto non fa una versione", () => {
  const factory = readFileSync(new URL("../../db/queries/use-case-factory.ts", import.meta.url), "utf8");
  const body = (signature: string) => {
    const start = factory.indexOf(signature);
    assert.notEqual(start, -1, signature);
    return factory.slice(start, factory.indexOf("\n}\n", start) + 2);
  };
  // Dal modulo delle letture del lavoro solo `loadAgentContext`: mai la lettura per chi guarda della scheda e del dossier.
  assert.match(factory, /^import \{ loadAgentContext \} from "@\/lib\/db\/queries\/context-work";$/m);
  assert.doesNotMatch(factory, /loadUseCaseContext|contextActorFor|contextAbilities|loadContextMemory|from "@\/lib\/db\/queries\/context-(?!work"|store")/);
  const context = body("async function packageContextFor(");
  assert.match(context, /const context = await loadAgentContext\(\{ workspaceId: target\.workspaceId, useCaseId: target\.useCaseId \}\);/);
  assert.match(context, /if \(state === "sconosciuto"\) return \{ context: null, unavailable: true \};/, "una sonda che non risponde non fa un pacchetto senza contesto");
  assert.match(context, /return \{ context, unavailable: context === null \};/);
  assert.doesNotMatch(context, /isLateralSpace|seesLateralSpace|visibility|context_facts/, "non dipende da chi genera");
  const source = body("export async function packageSourceFor(");
  assert.match(source, /packageContextFor\(target\)/);
  assert.match(source, /context: context\.context,\s+contextUnavailable: context\.unavailable,/);
  assert.match(body("export async function savePackageVersion("), /if \("generated" in input && input\.generated\.contextUnavailable === true\) return fail\("non_disponibile", AGENT_CONTEXT_TEXT\.unavailable\);/);
  // E `loadAgentContext` legge i fatti, gli impegni e le domande solo «Per tutti» (la prova sul database è di F).
  const work = readFileSync(new URL("../../db/queries/context-work.ts", import.meta.url), "utf8");
  const load = work.slice(work.indexOf("export async function loadAgentContext("), work.indexOf("\n}\n", work.indexOf("export async function loadAgentContext(")));
  assert.match(load, /status = 'aperto' AND visibility = 'tutti'/);
  assert.match(load, /status = 'aperta' AND visibility = 'tutti'/);
  assert.match(work, /f\.status = 'attivo' AND f\.visibility = 'tutti' AND \$\{where\}/);
});

test("(9b) le novità del pacchetto si contano sul file: le righe di CONTESTO.md aggiunte più quelle tolte, senza l'intestazione", () => {
  const stored = packageFiles(source({ context: CONTEXT }), { version: 2, day: "2026-11-10" })["CONTESTO.md"] ?? "";
  const fresh = (context: AgentContext, names: readonly string[] = ["Mario Rossi", "Giulia Bianchi"]) => contextSectionsFor(context, names, "PX-0049");
  assert.equal(fresh(CONTEXT), packageContent(source({ context: CONTEXT })).contesto, "la stessa strada dell'impronta");
  // Lo stesso contesto in un altro giorno e con un'altra versione: zero, come l'impronta (nessuna versione nuova).
  assert.equal(contextFileDelta(stored, fresh(CONTEXT)), 0);
  assert.equal(contextFileDelta(packageFiles(source({ context: CONTEXT }), { version: 7, day: "2027-02-01" })["CONTESTO.md"], stored), 0, "l'intestazione con versione e giorno non conta");
  // Un fatto in più: 1; uno tolto: 1; un testo corretto: una riga tolta e una aggiunta, 2.
  const one = agentFact("Le quotazioni partono dal portale.");
  assert.equal(contextFileDelta(stored, fresh({ ...CONTEXT, caseFacts: [...CONTEXT.caseFacts, one] })), 1);
  assert.equal(contextFileDelta(stored, fresh({ ...CONTEXT, caseFacts: [] })), 1);
  assert.equal(contextFileDelta(stored, fresh({ ...CONTEXT, caseFacts: [agentFact("Il gestionale esporta i preventivi in CSV e in PDF.")] })), 2);
  // La stessa frase spostata in un'altra sezione è un'altra riga (tolta di là, aggiunta di qua); una riga di «In breve» conta.
  assert.equal(contextFileDelta(stored, fresh({ ...CONTEXT, caseFacts: [], words: [agentFact("Il gestionale esporta i preventivi solo in CSV, ogni notte.", { section: "parole" })] })), 2);
  assert.equal(contextFileDelta(stored, fresh({ ...CONTEXT, brief: [...CONTEXT.brief, "Vola soprattutto in Europa."] })), 1);
  // Un nome che diventa noto cambia la riga, come cambia il file.
  const named = { ...CONTEXT, caseFacts: [agentFact("Le eccezioni le approva Anna Neri.")] };
  const namedStored = packageFiles(source({ context: named }), { version: 3, day: "2026-11-10" })["CONTESTO.md"];
  assert.equal(contextFileDelta(namedStored, fresh(named)), 0);
  assert.equal(contextFileDelta(namedStored, fresh(named, ["Mario Rossi", "Giulia Bianchi", "Anna Neri"])), 2);
  // Senza CONTESTO.md nell'ultima versione contano tutte le righe di adesso; senza fatti adesso, tutte quelle salvate.
  assert.equal(contextFileDelta(null, fresh(CONTEXT)), 3, "In breve, un fatto, una regola");
  assert.equal(contextFileDelta(stored, fresh({ ...CONTEXT, caseFacts: [], rules: [] })), 3, "niente fatti: il file se ne va, con «In breve»");
  assert.equal(contextFileDelta(null, null), 0);
  // I fatti del file, per il brief senza pacchetto: «In breve» non conta.
  assert.equal(contextFileFacts(stored), 2);
  assert.equal(contextFileFacts(null), 0);
});

test("(9b) packageContextDelta: con un pacchetto le righe che cambierebbero, senza pacchetto quanti fatti; senza archivio zero", () => {
  const names = ["Mario Rossi", "Giulia Bianchi"];
  const files = packageFiles(source({ context: CONTEXT }), { version: 2, day: "2026-11-10" });
  const delta = (context: AgentContext | null, latest: { files: Record<string, unknown> } | null) => packageContextDelta({ context, namesToHide: names, code: "PX-0049", latest });
  assert.equal(delta(CONTEXT, { files }), 0, "subito dopo il pacchetto");
  assert.equal(delta({ ...CONTEXT, caseFacts: [...CONTEXT.caseFacts, agentFact("Le quotazioni partono dal portale.")] }, { files }), 1);
  // Un pacchetto di prima della 9b (o fatto a mano), senza CONTESTO.md: tutte le righe del file di adesso.
  const { "CONTESTO.md": _dropped, ...withoutContext } = files;
  assert.equal(typeof _dropped, "string");
  assert.equal(delta(CONTEXT, { files: withoutContext }), 3);
  // Senza pacchetto: quanti fatti, per «Contesto: 2 fatti sul cliente».
  assert.equal(delta(CONTEXT, null), 2);
  assert.equal(delta(EMPTY_CONTEXT, null), 0);
  // L'archivio che non risponde non è una novità: zero, anche se il pacchetto ha CONTESTO.md.
  assert.equal(delta(null, { files }), 0);
  assert.equal(delta(null, null), 0);
});
