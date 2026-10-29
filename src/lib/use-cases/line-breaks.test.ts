import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { findHubForbidden } from "./copy-guard.ts";
import { formatEuro, perYearText } from "./format.ts";
import { laneSummaryText } from "./lanes.ts";
import { NBSP, QUOTED_NAME_MAX, SCREEN_SEPARATOR, joinPieces, keepTogether, wholePiece } from "./line-breaks.ts";
import { needsSummaryPieces } from "./needs.ts";
import { quarterLabel } from "./quarter.ts";
import { totalsNote } from "./views.ts";

// Dove il testo a schermo non va a capo (rilascio «Panoramica», rifiniture): U+00A0 al posto degli
// spazi tra un numero e la sua parola, dentro un nome tra «…», prima del «·». Solo la pagina: i testi
// condivisi con il MCP del team e l'export restano con i loro spazi. Le attese scrivono ` ` a mano.

const N = " ";

test("keepTogether: numeri con la loro parola, nomi tra «…» interi, il «·» con il pezzo prima", () => {
  const cases: Array<[string, string]> = [
    ["Qui trovi gli use case approvati visibili a tutti. Le proposte sono in «In valutazione».", `Qui trovi gli use case approvati visibili a tutti. Le proposte sono in «In${N}valutazione».`],
    ["Conferma a Intesa dell'attivazione di FileGate (12 €/mese)", `Conferma a Intesa dell'attivazione di FileGate (12${N}€/mese)`],
    ["Per partire con il T4 2026: 40 requisiti da chiedere, 2 da verificare e 8 bloccati.", `Per partire con il T4${N}2026: 40${N}requisiti da chiedere, 2${N}da verificare e 8${N}bloccati.`],
    ["4 use case aspettano una decisione.", `4${N}use${N}case aspettano una decisione.`],
    ["Su tutto il portafoglio: 1.404 ore liberate all'anno, pareggio previsto ad agosto 2027.", `Su tutto il portafoglio: 1.404${N}ore liberate all'anno, pareggio previsto ad agosto${N}2027.`],
    ["su 9 use case · 2 da fascia", `su 9${N}use${N}case${N}· 2${N}da fascia`],
    ["3 use case · 24.500 € contati all'anno", `3${N}use${N}case${N}· 24.500${N}€ contati all'anno`],
    ["12.250 € all'anno", `12.250${N}€${N}all'anno`],
    ["da misurare · fino a 5.840 €", `da misurare${N}· fino a 5.840${N}€`],
    ["Questo trimestre · T4 2026", `Questo trimestre${N}· T4${N}2026`],
    ["Già a posto · 2", `Già a posto${N}·${N}2`],
    ["Fatti · 4", `Fatti${N}·${N}4`],
    ["Più avanti · 14 passi", `Più avanti${N}· 14${N}passi`],
    ["Cosa vi chiediamo questo trimestre · 17 use case", `Cosa vi chiediamo questo trimestre${N}· 17${N}use${N}case`],
    ["Sistemi informativi · Cliente", `Sistemi informativi${N}· Cliente`],
    ["6.600 all'anno × 1,5 min × 70% ≈ 116 h · 4.043 €", `6.600${N}all'anno × 1,5${N}min × 70% ≈ 116${N}h${N}· 4.043${N}€`],
    ["Da nov 26, per 24 mesi: prima l'avvio, poi benefici e costi ricorrenti.", `Da nov${N}26, per 24${N}mesi: prima l'avvio, poi benefici e costi ricorrenti.`],
    ["Realizzato · set 2026", `Realizzato${N}· set${N}2026`],
    ["15 nov (proposta)", `15${N}nov (proposta)`],
    ["Valuta Valore e Costo in «Da decidere».", `Valuta Valore e Costo in «Da${N}decidere».`],
    ["Proponi il primo use case.", "Proponi il primo use case."],
    ["Nessuno use case con questi filtri.", "Nessuno use case con questi filtri."],
    ["Mostra gli altri 3", "Mostra gli altri 3"],
    ["5.000 € all'anno", `5.000${N}€${N}all'anno`],
    ["il mese corrente (nov 2026)", `il mese corrente (nov${N}2026)`],
    ["Il codice è TJ-0012. Il team lo valuta: la fase la trovi qui.", "Il codice è TJ-0012. Il team lo valuta: la fase la trovi qui."],
    ["TJ-0007 · LIBRA L1 · Lettura", `TJ-0007${N}· LIBRA L1${N}· Lettura`],
    ["Più avanti", "Più avanti"],
  ];
  for (const [input, expected] of cases) {
    const out = keepTogether(input);
    assert.equal(out, expected, input);
    // Lo stesso testo, a meno degli spazi; applicato due volte non cambia.
    assert.equal(out.replace(/ /g, " "), input, input);
    assert.equal(keepTogether(out), out, input);
  }
  // Un nome tra «…» più lungo di 30 caratteri va a capo come il resto: un telefono stretto non scorre di lato.
  const long = "Usa «un nome molto lungo che non sta su una riga stretta»";
  assert.ok("un nome molto lungo che non sta su una riga stretta".length > QUOTED_NAME_MAX);
  assert.equal(keepTogether(long), long);
  assert.equal(keepTogether(null), null);
  assert.equal(keepTogether(undefined), undefined);
  assert.equal(keepTogether(""), "");
  assert.equal(NBSP, " ");
  assert.equal(SCREEN_SEPARATOR, `${N}· `);
});

test("wholePiece e joinPieces: i pezzi interi, il «·» con il pezzo prima", () => {
  assert.equal(wholePiece("66 da chiedere"), `66${N}da${N}chiedere`);
  assert.equal(
    joinPieces(["96 aperti", "66 da chiedere", "18 in attesa"]),
    `96${N}aperti${N}· 66${N}da${N}chiedere${N}· 18${N}in${N}attesa`,
  );
  assert.equal(joinPieces([]), "");
});

test("la guardia delle parole trova ancora «caso d'uso» e «wave» con gli spazi non separabili", () => {
  assert.ok(findHubForbidden(keepTogether("Valuta 3 caso d'uso"), "area").length > 0);
  assert.ok(findHubForbidden(keepTogether("La wave 2 parte"), "area").length > 0);
  assert.ok(findHubForbidden(`un caso${N}d'uso`, "area").length > 0);
});

test("solo la pagina: il MCP del team, l'export e i testi condivisi non usano line-breaks e restano con i loro spazi", () => {
  const root = new URL("../../../", import.meta.url);
  const read = (path: string) => readFileSync(new URL(path, root), "utf8");
  const mcp = new URL("src/lib/use-cases/mcp/", root);
  const files = [
    ...readdirSync(mcp, { recursive: true })
      .map(String)
      .filter((name) => name.endsWith(".ts"))
      .map((name) => `src/lib/use-cases/mcp/${name}`),
    "src/app/(dashboard)/dashboard/[workspaceId]/portfolio/export/route.ts",
    ...["format", "views", "needs", "lanes", "labels", "quarter", "panoramica", "value-charts"].map((name) => `src/lib/use-cases/${name}.ts`),
  ];
  for (const file of files) assert.ok(!read(file).includes("line-breaks"), file);
  // I testi condivisi: spazi normali, come li leggono il MCP e l'export.
  for (const text of [formatEuro(40_000), perYearText({ amount: 12_250 }), laneSummaryText(3, 24_500), ...needsSummaryPieces({ open: 4, toAsk: 3, waiting: 1, toVerify: 0, blocked: 0, done: 1 }), totalsNote(9, 2), quarterLabel("2026-Q4")]) {
    assert.ok(text && !text.includes(N), JSON.stringify(text));
  }
});
