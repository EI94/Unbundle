// Pages of the use case page /use-cases with the area on (docs/use-case/PIANO-LAVORI.md H4a,
// §5.7; docs/use-case/DESIGN.md §4), for scripts/use-case-test/screens-hub.mjs:
//
//   node scripts/use-case-test/screens-hub.mjs --routes scripts/use-case-test/screens/hub.routes.mjs \
//     --as ls-lead,function-lead,osservatore,sponsor-cliente --widths 1440,400 --label h4a
//
// Workspace «a» has the area on (start-app.mjs --flag USE_CASE_HUB_WORKSPACES=<id of «a»>) and the
// cards of scripts/use-case-test/seed-hub.mjs. The three views for the four accounts, «Per agente»
// (?mostra=agenti), the charts of the «⋯» menu in the Panoramica (?mostra=matrice|benefici|curva,
// with «Torna alla Panoramica»), the old names ?vista=priorita and ?vista=roadmap, which open the
// Panoramica, the side panel (reviewers on a card with a cost,
// osservatore on an own proposal with code and public note and on someone else's without them),
// the quick panel of Lateral Space and filters without results. The driver checks every page: no horizontal scroll (also at the tablet
// widths 768, 900 and 1024), at most one filled button outside dialogs, every cost with its source,
// no figure and no «€» for the contributor.
//
// Empty states of a workspace with no use case: set HUB_EMPTY_WORKSPACE_ID to an extra workspace
// that is in USE_CASE_HUB_WORKSPACES, has no use case and gives the four accounts their roles of «a».
//
// A fuller portfolio in «a»: set HUB_PANORAMICA_SEED=1 when, on top of seed-hub.mjs, workspace «a» also
// has approved titles with an agent prefix («LIBRA L1 · …») next to titles without one, approved or
// in-progress cards with «Benefici e costi» and open requirements (a portfolio shaped like TopJet's).
// seed-hub.mjs writes none of them: without the flag «Per agente» and «Curva del valore» are not
// offered, their addresses open the lanes, and «Cosa serve» is empty.

import { DEFAULT_REVIEW_TEAM_NAME } from "../../../src/lib/review-team.ts";
import { ANSWER_TEXT, askedTitle, questionLabel } from "../../../src/lib/use-cases/answers.ts";

const DECIDE = "/dashboard/{ws:a}/use-cases?vista=da-decidere";
const OVERVIEW = "/dashboard/{ws:a}/use-cases?vista=panoramica";
/** See the header: agents in the titles, «Benefici e costi» and requirements in workspace «a». */
const FULL_SEED = process.env.HUB_PANORAMICA_SEED === "1";
/** Workspace «a» has no team name of its own: the texts use the default one (DESIGN §14.2). */
const TEAM = DEFAULT_REVIEW_TEAM_NAME;
const REVIEWERS = ["ls-lead", "function-lead", "sponsor-cliente"];
const CONTRIBUTOR = ["osservatore"];

/** The public notes of other people's proposals that a contributor sees (r05 and r23 of seed-hub.mjs). */
const OTHERS_NOTES = ["Quante note spese arrivano ogni mese?", "Servono esempi di richieste."];

/** What a contributor never gets on these pages: the codes and notes of other people's proposals (D4, D13). */
const NOT_FOR_CONTRIBUTOR = ["{code:r05}", "{code:r06}", "{code:r09}", "{code:r12}", ...OTHERS_NOTES, "Previsione della domanda", "Altri filtri", "Cerca per titolo o codice"];

/**
 * The Panoramica of the reviewers: «Approvati» in the strip «Fasi degli use case», the big numbers,
 * «Prossimo passo» (proposals wait for a decision), the three lanes, «In realizzazione» and «Realizzati».
 */
const OVERVIEW_REVIEWER = ["Panoramica", "Approvati", "valore contato all'anno", "costo di avvio", "Prossimo passo", "Questo trimestre", "In realizzazione", "Realizzati"];
/** The contributor's Panoramica: the strip with «Approvati» and the same lanes, with title and phase only. */
const OVERVIEW_CONTRIBUTOR = ["Approvati", "In valutazione"];
/** Never on the contributor's Panoramica: figures, the box, the needs, the agent filter. */
const NOT_ON_CONTRIBUTOR_OVERVIEW = [...NOT_FOR_CONTRIBUTOR, "€", "costo di avvio", "Prossimo passo", "Cosa serve", "Agente"];

const routes = [
  // The starting view of each role (§4.2): reviewers «Da decidere», the client's sponsor and contributors the Panoramica.
  { name: "partenza", path: "/dashboard/{ws:a}/use-cases", as: ["ls-lead", "function-lead"], present: ["Use case", "Nuovo use case", "In attesa di risposta"] },
  { name: "partenza", path: "/dashboard/{ws:a}/use-cases", as: ["sponsor-cliente"], present: OVERVIEW_REVIEWER },
  { name: "partenza", path: "/dashboard/{ws:a}/use-cases", as: CONTRIBUTOR, present: OVERVIEW_CONTRIBUTOR, absent: NOT_ON_CONTRIBUTOR_OVERVIEW },

  // The three views.
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
  // The Panoramica: the strip, the big numbers and «Prossimo passo», then the three lanes per quarter.
  { name: "panoramica", path: OVERVIEW, as: REVIEWERS, present: OVERVIEW_REVIEWER },
  { name: "panoramica", path: OVERVIEW, as: CONTRIBUTOR, present: OVERVIEW_CONTRIBUTOR, absent: NOT_ON_CONTRIBUTOR_OVERVIEW },
  // «Per trimestre | Per agente»: one card per agent of the titles, «Altri use case» last; reviewers
  // only, when an approved title has an agent prefix (without one the address opens the lanes).
  FULL_SEED
    ? { name: "panoramica-agenti", path: `${OVERVIEW}&mostra=agenti`, as: REVIEWERS, present: ["Per trimestre", "Per agente", "Altri use case"] }
    : { name: "panoramica-agenti", path: `${OVERVIEW}&mostra=agenti`, as: REVIEWERS, present: ["Approvati", "Questo trimestre"], absent: ["Per agente"] },
  { name: "panoramica-agenti", path: `${OVERVIEW}&mostra=agenti`, as: CONTRIBUTOR, present: OVERVIEW_CONTRIBUTOR, absent: [...NOT_ON_CONTRIBUTOR_OVERVIEW, "Per agente"] },
  // H4p: ogni punto con il suo codice; i scaduti marcati; legenda corta. Opened from the «⋯» menu,
  // in place of the lanes, with «Torna alla Panoramica» above.
  {
    name: "panoramica-matrice",
    path: `${OVERVIEW}&mostra=matrice`,
    as: REVIEWERS,
    present: ["Torna alla Panoramica", "Subito", "Da pianificare", "Se avanza tempo", "Non ora", "Le zone sono un suggerimento, non la decisione.", "{code:r06}", "{code:r09}", "da decidere"],
  },
  // «Matrice Facilità × Beneficio» from the «⋯» menu (the bubbles, only with a «Benefici e costi»
  // model in the workspace; otherwise the page falls back to the matrix), with «Torna alla Panoramica».
  {
    name: "panoramica-benefici",
    path: `${OVERVIEW}&mostra=benefici`,
    as: REVIEWERS,
    present: ["Torna alla Panoramica"],
    absent: ["Cosa serve per far avanzare", "Requisiti"],
  },
  // «Curva del valore» from the «⋯» menu: the J-curve, «Valore per tipo di ritorno» and «Ipotesi di
  // calcolo» in place of the lanes, with «Torna alla Panoramica». The menu offers it only when an
  // approved or in-progress use case has a «Benefici e costi» model; without one ?mostra=curva opens the lanes.
  FULL_SEED
    ? {
        name: "panoramica-curva",
        path: `${OVERVIEW}&mostra=curva`,
        as: REVIEWERS,
        present: ["Curva del valore", "Torna alla Panoramica", "Ipotesi di calcolo"],
        absent: ["Cosa serve per far avanzare", "Requisiti"],
      }
    : { name: "panoramica-curva", path: `${OVERVIEW}&mostra=curva`, as: REVIEWERS, present: ["Approvati", "Questo trimestre"], absent: ["Torna alla Panoramica", "Ipotesi di calcolo"] },
  { name: "panoramica-curva", path: `${OVERVIEW}&mostra=curva`, as: CONTRIBUTOR, present: OVERVIEW_CONTRIBUTOR, absent: [...NOT_ON_CONTRIBUTOR_OVERVIEW, "Curva del valore", "Ipotesi di calcolo", "Torna alla Panoramica"] },
  // The old names of the Panoramica (bookmarks, e-mails already sent, the bell): they open it, with every other parameter.
  { name: "alias-priorita", path: "/dashboard/{ws:a}/use-cases?vista=priorita", as: REVIEWERS, present: OVERVIEW_REVIEWER, absent: ["Torna alla Panoramica"] },
  { name: "alias-priorita", path: "/dashboard/{ws:a}/use-cases?vista=priorita", as: CONTRIBUTOR, present: OVERVIEW_CONTRIBUTOR, absent: [...NOT_ON_CONTRIBUTOR_OVERVIEW, "Matrice"] },
  { name: "alias-roadmap", path: "/dashboard/{ws:a}/use-cases?vista=roadmap", as: REVIEWERS, present: OVERVIEW_REVIEWER, absent: ["Torna alla Panoramica"] },
  { name: "alias-roadmap", path: "/dashboard/{ws:a}/use-cases?vista=roadmap", as: CONTRIBUTOR, present: OVERVIEW_CONTRIBUTOR, absent: NOT_ON_CONTRIBUTOR_OVERVIEW },
  // «Cosa serve»: requirements and next steps, reviewers only, last in the switcher, with «Vai alla
  // Panoramica» under them while use cases are in realization (the seed has some). seed-hub.mjs writes
  // no needs, so the reviewers get the empty view. With needs it shows «Requisiti» with the counts
  // line («4 aperti · 3 da chiedere · 1 in attesa · 1 a posto») and one closed line per area, then
  // «Prossimi passi» open up to this month, with «Più avanti · N passi» and «Senza data · N passi» closed.
  // Without requirements «Requisiti» says «Niente da chiedere per ora.» above the other blocks.
  {
    name: "cosa-serve",
    path: "/dashboard/{ws:a}/use-cases?vista=cosa-serve",
    as: REVIEWERS,
    present: FULL_SEED ? ["Requisiti", "Vai alla Panoramica"] : ["Niente da chiedere per ora", "Vai alla Panoramica"],
    absent: ["Cosa serve per far avanzare"],
  },
  // Not for contributors: the page falls back to the Panoramica.
  { name: "cosa-serve", path: "/dashboard/{ws:a}/use-cases?vista=cosa-serve", as: CONTRIBUTOR, present: OVERVIEW_CONTRIBUTOR, absent: [...NOT_ON_CONTRIBUTOR_OVERVIEW, "Requisiti"] },

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
  { name: "pannello-approvato", path: `${OVERVIEW}&apri={uc:r09}`, as: REVIEWERS, present: ["Quando", "Prossimo trimestre", "Apri la scheda"] },
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
