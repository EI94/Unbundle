// Il pacchetto dell'Agent Factory (rilascio 8.0a): tre file, niente nomi né e-mail, la stessa impronta per lo
// stesso contenuto, e un brief che sta nel contesto dei coding agent.
import test from "node:test";
import assert from "node:assert/strict";
import { givenNames, nameTokens, packageContent, packageFiles, packageHash, redact, type PackageSource } from "./package.ts";
import { PACKAGE_FILES } from "../../db/use-case-hub-factory-ddl.ts";

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
