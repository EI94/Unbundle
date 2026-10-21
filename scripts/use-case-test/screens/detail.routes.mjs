// Pages of the use case card /use-cases/[id] for the hub screen driver (docs/use-case/PIANO-LAVORI.md
// H4b, §5.7; docs/use-case/DESIGN.md §6). Workspace «a» has the area on, «b» has it off.
//
//   node scripts/use-case-test/screens-hub.mjs --routes scripts/use-case-test/screens/detail.routes.mjs \
//     --as ls-lead,function-lead,osservatore,sponsor-cliente --widths 1440,400 --label h4b
//
// Cards of scripts/use-case-test/seed-hub.mjs, by key: one per chapter shape (to decide, from the
// connector with Claude's estimate and risk chips, approved with «Avvia la realizzazione» for
// Lateral Space, with a dossier, a diffused best practice, a closed one, a hidden one). For
// `osservatore` (contributor, D4 and D13): their own proposals show code and public note, also when
// hidden from search; other people's show neither; a hidden card of someone else is «Use case non
// trovato». The driver checks every page for horizontal scroll, one filled button, figures and «€»
// for contributors, costs with their source, and the hub copy guard.

import { DEFAULT_REVIEW_TEAM_NAME } from "../../../src/lib/review-team.ts";
import { ANSWER_TEXT, questionLabel } from "../../../src/lib/use-cases/answers.ts";

const REVIEWERS = ["ls-lead", "function-lead", "sponsor-cliente"];
/** Workspace «a» has no team name of its own: the texts use the default one (DESIGN §14.2). */
const TEAM = DEFAULT_REVIEW_TEAM_NAME;
const CONTRIBUTOR = ["osservatore"];
const card = (key, query = "") => `/dashboard/{ws:a}/use-cases/{uc:${key}}${query}`;

const routes = [
  // Reviewers: every chapter; the contributor: title and phase, no code of someone else.
  // H4p: il titolo una volta sola (nessun campo «Titolo» chiuso), «Cos'è», i campi vuoti dietro «Aggiungi altri campi» (H7: non si confonde con «Dettagli»).
  { name: "scheda-da-valutare", path: card("r01"), as: REVIEWERS, present: ["{code:r01}", "Cos'è", "Valutazione", "Decisione", "Storia", "Aggiungi altri campi"], absent: ["Cosa è", "+ Aggiungi", "Aggiungi dettagli"] },
  // H7: on someone else's card one line says why only title and phase.
  { name: "scheda-da-valutare", path: card("r01"), as: CONTRIBUTOR, present: [`Vedi titolo e fase: i dettagli li vedono chi l'ha proposto e ${TEAM}.`], absent: ["{code:r01}", "Cos'è", "Storia"] },
  // H7: the public note is optional next to «Approva»; no empty «Stime non ufficiali» box.
  { name: "scheda-nota-facoltativa", path: card("r06"), as: REVIEWERS, present: ["Nota pubblica (facoltativa)", "Approva"], absent: ["Stime non ufficiali"] },
  // Un solo riquadro di stime, parole semplici (H4p).
  { name: "scheda-connettore", path: card("r03"), as: REVIEWERS, present: ["Stime non ufficiali", "Conta la valutazione del team.", "Suggerimento AI", "Dati personali"], absent: ["semaforo", "da sforzo", "Stima di Claude"] },
  { name: "scheda-approvata", path: card("r09"), as: REVIEWERS, present: ["Realizzazione"] },
  { name: "scheda-approvata", path: card("r09"), as: CONTRIBUTOR, absent: ["{code:r09}", "Realizzazione"] },
  { name: "scheda-capitolo", path: card("r09", "?capitolo=realizzazione"), as: ["ls-lead"], present: ["Avvia la realizzazione"] },
  { name: "scheda-capitolo", path: card("r09", "?capitolo=realizzazione"), as: ["function-lead", "sponsor-cliente"], present: ["La realizzazione la avvia Lateral Space."], absent: ["Avvia la realizzazione"] },
  { name: "scheda-dossier", path: card("r12"), as: REVIEWERS, present: ["Dossier"] },
  { name: "scheda-diffusa", path: card("r16"), as: REVIEWERS },
  { name: "scheda-chiusa", path: card("r17", "?capitolo=storia"), as: REVIEWERS, present: ["Riapri"] },
  { name: "scheda-nascosta", path: card("nascosta"), as: REVIEWERS, present: ["Questa scheda è nascosta alla ricerca: tramite Claude chi conosce il codice vede solo la fase."] },
  { name: "scheda-nascosta", path: card("nascosta"), as: CONTRIBUTOR, absent: ["Previsione della domanda", "{code:nascosta}", "Nota pubblica di una scheda nascosta."] },
  // The contributor's own proposals (D13): code and public note, also hidden from search.
  // Reviewers read the public note in its field (a textarea, not page text): the code is enough.
  { name: "scheda-propria", path: card("osservatore-email"), as: REVIEWERS, present: ["{code:osservatore-email}"] },
  // D17: in «Serve info» chi ha proposto risponde dalla scheda.
  { name: "scheda-propria", path: card("osservatore-email"), as: CONTRIBUTOR, present: ["{code:osservatore-email}", "Proposto da te", "Quante richieste arrivano a settimana?", "Invia la risposta"] },
  { name: "scheda-propria-nascosta", path: card("osservatore-id"), present: ["{code:osservatore-id}", "Glossario dei termini tecnici"] },
  // D17: the reviewers read the proposer's answer in «Decisione», after the question; the Story
  // reads Creato → Serve info → answer, and says only that there was one.
  {
    name: "scheda-risposta",
    path: card("risposta", "?capitolo=storia"),
    as: REVIEWERS,
    present: ["Risposte di chi ha proposto", "Circa 40 visite al mese, con un verbale ciascuna.", "Decisione: Serve info", "Risposta di chi ha proposto"],
  },
  { name: "scheda-risposta", path: card("risposta"), as: CONTRIBUTOR, absent: ["Circa 40 visite al mese", "Risposte di chi ha proposto"] },
  // D17 (H7): the proposer reads the own answer under the question until someone decides.
  {
    name: "scheda-propria-risposta",
    path: card("osservatore-risposta"),
    as: CONTRIBUTOR,
    present: ["{code:osservatore-risposta}", questionLabel(TEAM), "Quanti contratti scadono ogni anno?", ANSWER_TEXT.label, "Una trentina, quasi tutti a dicembre."],
    absent: ["Invia la risposta"],
  },
  // Area off in workspace «b»: today's card, unchanged (D4 for contributors from H2e).
  { name: "scheda-area-spenta", path: "/dashboard/{ws:b}/use-cases/{uc:b-visibile}" },
];

export default routes;
