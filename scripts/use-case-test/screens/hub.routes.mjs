// Pages of the use case page /use-cases with the area on (docs/use-case/PIANO-LAVORI.md H4a,
// §5.7; docs/use-case/DESIGN.md §4), for scripts/use-case-test/screens-hub.mjs:
//
//   node scripts/use-case-test/screens-hub.mjs --routes scripts/use-case-test/screens/hub.routes.mjs \
//     --as ls-lead,function-lead,osservatore,sponsor-cliente --widths 1440,400 --label h4a
//
// Workspace «a» has the area on (start-app.mjs --flag USE_CASE_HUB_WORKSPACES=<id of «a»>) and the
// cards of scripts/use-case-test/seed-hub.mjs. The four views for the four accounts, the list of
// «Priorità» (the list by default; the matrix and the bubbles from the «⋯» menu,
// ?mostra=matrice|benefici, with «Torna alla lista»), «Da diffondere», the side panel (reviewers on a card with a cost, osservatore on an own proposal with
// code and public note and on someone else's without them), the quick panel of Lateral Space and
// filters without results. The driver checks every page: no horizontal scroll (also at the tablet
// widths 768, 900 and 1024), at most one filled button outside dialogs, every cost with its source,
// no figure and no «€» for the contributor.
//
// Empty states of a workspace with no use case: set HUB_EMPTY_WORKSPACE_ID to an extra workspace
// that is in USE_CASE_HUB_WORKSPACES, has no use case and gives the four accounts their roles of «a».

import { DEFAULT_REVIEW_TEAM_NAME } from "../../../src/lib/review-team.ts";
import { ANSWER_TEXT, askedTitle, questionLabel } from "../../../src/lib/use-cases/answers.ts";

const DECIDE = "/dashboard/{ws:a}/use-cases?vista=da-decidere";
/** Workspace «a» has no team name of its own: the texts use the default one (DESIGN §14.2). */
const TEAM = DEFAULT_REVIEW_TEAM_NAME;
const REVIEWERS = ["ls-lead", "function-lead", "sponsor-cliente"];
const CONTRIBUTOR = ["osservatore"];

/** The public notes of other people's proposals that a contributor sees (r05 and r23 of seed-hub.mjs). */
const OTHERS_NOTES = ["Quante note spese arrivano ogni mese?", "Servono esempi di richieste."];

/** What a contributor never gets on these pages: the codes and notes of other people's proposals (D4, D13). */
const NOT_FOR_CONTRIBUTOR = ["{code:r05}", "{code:r06}", "{code:r09}", "{code:r12}", ...OTHERS_NOTES, "Previsione della domanda", "Altri filtri", "Cerca per titolo o codice"];

const routes = [
  // The starting view of each role (§4.2): reviewers «Da decidere», the client's sponsor and contributors «Roadmap».
  { name: "partenza", path: "/dashboard/{ws:a}/use-cases", as: ["ls-lead", "function-lead"], present: ["Use case", "Nuovo use case", "In attesa di risposta"] },
  { name: "partenza", path: "/dashboard/{ws:a}/use-cases", as: ["sponsor-cliente"], present: ["Prossimi", "In realizzazione", "Fatti", "Costo impegnato"] },
  { name: "partenza", path: "/dashboard/{ws:a}/use-cases", as: CONTRIBUTOR, present: ["Prossimi", "Fatti"], absent: [...NOT_FOR_CONTRIBUTOR, "Costo impegnato", "Cosa serve"] },

  // The four views.
  // H4p: un solo «da stimare» quando mancano Valore e Costo; il tipo solo per «Da diffondere».
  // H7: an answered «Serve info» reads «Risposta ricevuta», not «Nuova»; one wording for the valued phase.
  {
    name: "da-decidere",
    path: DECIDE,
    as: REVIEWERS,
    present: ["In attesa di risposta", "{code:r06}", "da stimare", ANSWER_TEXT.received, "Valutata, da decidere"],
    absent: ["Da costruire", "Valore: da stimare · Costo: da stimare"],
  },
  // H4p: per i contributori «In valutazione», senza contatore; «Proposto da te» e «Rispondi» sulle proprie,
  // con l'avviso «AI Builder ti chiede informazioni» sopra la lista (D17, il nome del team da solo).
  {
    name: "da-decidere",
    path: DECIDE,
    as: CONTRIBUTOR,
    present: ["In valutazione", "{code:osservatore-email}", "Riepilogo delle chiamate di assistenza", "Proposto da te", "Rispondi", `${askedTitle(TEAM)}:`],
    absent: [...NOT_FOR_CONTRIBUTOR, "Da decidere", "In attesa di risposta", "Possibile doppione", "Valutata, da decidere"],
  },
  // Without ?mostra= the list, at every width.
  { name: "priorita", path: "/dashboard/{ws:a}/use-cases?vista=priorita", as: REVIEWERS, present: ["{code:r06}", "Quando"] },
  // H4p: ogni punto con il suo codice; i scaduti marcati; legenda corta. Opened from the «⋯» menu,
  // in place of the list, with «Torna alla lista» above.
  {
    name: "priorita-matrice",
    path: "/dashboard/{ws:a}/use-cases?vista=priorita&mostra=matrice",
    as: REVIEWERS,
    present: ["Torna alla lista", "Subito", "Da pianificare", "Se avanza tempo", "Non ora", "Le zone sono un suggerimento, non la decisione.", "{code:r06}", "{code:r09}", "da decidere"],
  },
  // §4.4: il menu «Quando» parte da «Scegli…» sulle schede da decidere (la scelta apre «Approva»);
  // il trimestre per intero e «Scaduto» sulle approvate.
  // H7: the rows without Value or Cost in one chip «N da stimare», as in the matrix.
  { name: "priorita-lista", path: "/dashboard/{ws:a}/use-cases?vista=priorita&mostra=lista", as: REVIEWERS, present: ["Quando", "{code:r06}", "Scegli…", "Scaduto", "da stimare"], absent: ["Approva…", "{code:r04}"] },
  { name: "priorita-diffondere", path: "/dashboard/{ws:a}/use-cases?vista=priorita&tipo=diffondere", as: REVIEWERS, present: ["Segna come diffusa", "ore all'anno"] },
  // «Matrice Facilità × Beneficio» from the «⋯» menu (the bubbles, only with a «Benefici e costi»
  // model in the workspace; otherwise the page falls back to the matrix), with «Torna alla lista».
  // The needs are no longer at the foot of «Priorità»: they have their own view.
  {
    name: "priorita-benefici",
    path: "/dashboard/{ws:a}/use-cases?vista=priorita&mostra=benefici",
    as: REVIEWERS,
    present: ["Torna alla lista"],
    absent: ["Cosa serve per far avanzare", "Requisiti"],
  },
  // «Priorità» is not for contributors: the page falls back to the Roadmap.
  { name: "priorita", path: "/dashboard/{ws:a}/use-cases?vista=priorita", as: CONTRIBUTOR, present: ["Prossimi"], absent: [...NOT_FOR_CONTRIBUTOR, "Matrice", "Cosa serve"] },
  { name: "roadmap", path: "/dashboard/{ws:a}/use-cases?vista=roadmap", as: REVIEWERS, present: ["Valore atteso all'anno", "Costo impegnato", "use case", "Scaduti", "In realizzazione", "Fatti"] },
  { name: "roadmap", path: "/dashboard/{ws:a}/use-cases?vista=roadmap", as: CONTRIBUTOR, present: ["Prossimi", "Fatti"], absent: [...NOT_FOR_CONTRIBUTOR, "Costo impegnato", "Valore atteso"] },
  // «Cosa serve»: requirements and next steps, reviewers only, last in the switcher. seed-hub.mjs
  // writes no needs, so the reviewers get the empty view, which points to the Roadmap (the seed has
  // use cases in realization); with needs in the workspace it shows «Requisiti» and «Prossimi passi».
  { name: "cosa-serve", path: "/dashboard/{ws:a}/use-cases?vista=cosa-serve", as: REVIEWERS, present: ["Niente da chiedere per ora", "Vai alla Roadmap"], absent: ["Cosa serve per far avanzare"] },
  // Not for contributors: the page falls back to the Roadmap.
  { name: "cosa-serve", path: "/dashboard/{ws:a}/use-cases?vista=cosa-serve", as: CONTRIBUTOR, present: ["Prossimi"], absent: [...NOT_FOR_CONTRIBUTOR, "Cosa serve", "Requisiti"] },

  // The side panel (§4.8).
  { name: "pannello", path: `${DECIDE}&apri={uc:r06}`, as: REVIEWERS, present: ["Smistamento richieste", "Apri la scheda", "Approva", "{code:r06}"] },
  // D17: an answered «Serve info» is back in «Da decidere» as «Nuova»; the reviewers' panel shows the question and the answer.
  {
    name: "pannello-risposta",
    path: `${DECIDE}&apri={uc:risposta}`,
    as: REVIEWERS,
    present: ["{code:risposta}", questionLabel(TEAM), "Quante visite fate al mese?", "Risposta di chi ha proposto", "Circa 40 visite al mese, con un verbale ciascuna.", "Approva"],
    absent: ["La domanda del team"],
  },
  { name: "pannello-approvato", path: "/dashboard/{ws:a}/use-cases?vista=roadmap&apri={uc:r09}", as: REVIEWERS, present: ["Quando", "Prossimo trimestre", "Apri la scheda"] },
  {
    name: "pannello-proprio",
    path: "/dashboard/{ws:a}/use-cases?vista=da-decidere&apri={uc:osservatore-email}",
    as: CONTRIBUTOR,
    // D17: la domanda di {teamName} e «Rispondi».
    present: ["{code:osservatore-email}", "Proposto da te", questionLabel(TEAM), "Quante richieste arrivano a settimana?", "Invia la risposta", "Apri la scheda"],
  },
  // D17 (H7): dopo la risposta, finché nessuno decide, la domanda e sotto la propria risposta.
  {
    name: "pannello-proprio-risposto",
    path: "/dashboard/{ws:a}/use-cases?vista=da-decidere&apri={uc:osservatore-risposta}",
    as: CONTRIBUTOR,
    present: ["{code:osservatore-risposta}", "Proposto da te", questionLabel(TEAM), "Quanti contratti scadono ogni anno?", ANSWER_TEXT.label, "Una trentina, quasi tutti a dicembre."],
    absent: ["Invia la risposta"],
  },
  // Someone else's proposal that has a public note: neither code nor note.
  {
    name: "pannello-altrui",
    path: "/dashboard/{ws:a}/use-cases?vista=da-decidere&apri={uc:r05}",
    as: CONTRIBUTOR,
    // H4p: solo la fase, senza lo smistamento del team, e niente «Apri la scheda»: il pannello basta.
    // H7: una riga dice perché.
    present: ["Archivio dei contratti fornitori", "Da valutare", `Vedi titolo e fase: i dettagli li vedono chi l'ha proposto e ${TEAM}.`],
    // (Le proprie proposte nella lista sotto hanno «Serve info» e «Proposto da te»: qui non si controllano.)
    absent: [...NOT_FOR_CONTRIBUTOR, "Nota pubblica", "Apri la scheda"],
  },

  // The quick panel of «Nuovo use case» (§5.2): only Lateral Space.
  { name: "pannello-rapido", path: "/dashboard/{ws:a}/use-cases?nuovo=1", as: ["ls-lead"], present: ["Problema in una riga", "Salva e aggiungi un altro", "Usa il modulo completo"] },

  // Filters without results (§4.9).
  { name: "filtri-vuoti", path: `${DECIDE}&q=nessun-risultato-zz`, present: ["Nessuno use case con questi filtri.", "Togli i filtri"] },

  // H7, Settings › Integrazioni with the area on and no v1 token: one Claude card for the team,
  // no old name; the «registra-ai-lab» skill only for Lateral Space, which runs the AI Labs.
  {
    name: "impostazioni-claude",
    path: "/dashboard/{ws:a}/settings",
    as: ["ls-lead"],
    copyGuard: "vecchio_nome",
    present: ["Claude per il team", "Crea il tuo token", "registra-ai-lab"],
    absent: ["Claude per Unbundle", "Crea setup Claude per il team"],
  },
  {
    name: "impostazioni-claude",
    path: "/dashboard/{ws:a}/settings",
    as: ["function-lead", "sponsor-cliente"],
    copyGuard: "vecchio_nome",
    present: ["Claude per il team", "Crea il tuo token"],
    absent: ["Claude per Unbundle", "Crea setup Claude per il team", "registra-ai-lab"],
  },
  { name: "impostazioni-claude", path: "/dashboard/{ws:a}/settings", as: CONTRIBUTOR, copyGuard: "vecchio_nome", absent: ["Claude per il team", "Claude per Unbundle"] },
];

const emptyWorkspace = process.env.HUB_EMPTY_WORKSPACE_ID?.trim();
if (emptyWorkspace) {
  if (!/^[0-9a-f-]{36}$/i.test(emptyWorkspace)) throw new Error("HUB_EMPTY_WORKSPACE_ID must be a workspace UUID");
  const base = `/dashboard/${emptyWorkspace}/use-cases`;
  // The roles of «a» (the route's workspace for the role checks); the copy guard as on every area page.
  routes.push(
    { name: "vuoto", path: base, workspace: "a", copyGuard: "area", as: [...REVIEWERS], present: ["Nessuno use case, per ora", "Aggiungine uno o proponili da Activity mapping."] },
    { name: "vuoto", path: base, workspace: "a", copyGuard: "area", as: CONTRIBUTOR, present: ["Nessuno use case, per ora", "Proponi il primo use case."] },
  );
}

export default routes;
