// Pages of the dossier link (docs/use-case/PIANO-LAVORI.md H6a, §5.7; docs/use-case/DESIGN.md §4.5,
// §6.5; docs/casi-duso/DESIGN.md §3.1, §3.2) for the hub screen driver, workspace «a» (area on):
//
//   node scripts/use-case-test/screens-hub.mjs --routes scripts/use-case-test/screens/realization.routes.mjs \
//     --as ls-lead,ls-analista,function-lead,osservatore,sponsor-cliente --widths 1440,400 --label h6a
//
// Cards of scripts/use-case-test/seed-hub.mjs: r09 approved «Da costruire» without a dossier
// («Avvia la realizzazione» only for Lateral Space), r12 with a dossier (the summary: status, the
// one progress number, the three ROI figures, «Apri il dossier» only for who opens it). The
// Roadmap's «In realizzazione» column has the dossier cards for reviewers. Contributors
// (`osservatore`) never see the chapter, the dossier cards or figures.

const LS = ["ls-lead", "ls-analista"];
const CLIENT_REVIEWERS = ["function-lead", "sponsor-cliente"];
const REVIEWERS = [...LS, ...CLIENT_REVIEWERS];
const CONTRIBUTOR = ["osservatore"];
const card = (key, query = "") => `/dashboard/{ws:a}/use-cases/{uc:${key}}${query}`;

const routes = [
  { name: "realizzazione-da-avviare", path: card("r09", "?capitolo=realizzazione"), as: LS, present: ["La realizzazione non è ancora partita.", "Avvia la realizzazione"] },
  {
    name: "realizzazione-da-avviare",
    path: card("r09", "?capitolo=realizzazione"),
    as: CLIENT_REVIEWERS,
    present: ["La realizzazione la avvia Lateral Space."],
    absent: ["Avvia la realizzazione"],
  },
  {
    name: "realizzazione-avviata",
    path: card("r12", "?capitolo=realizzazione"),
    as: REVIEWERS,
    present: ["Dossier", "Costo di realizzazione", "Beneficio all'anno", "Pareggio"],
  },
  { name: "realizzazione-avviata", path: card("r12"), as: CONTRIBUTOR, absent: ["Costo di realizzazione", "Apri il dossier", "Realizzazione"] },
  { name: "roadmap-in-realizzazione", path: "/dashboard/{ws:a}/use-cases?vista=roadmap", as: REVIEWERS, present: ["In realizzazione", "{code:r12}"] },
  { name: "roadmap-in-realizzazione", path: "/dashboard/{ws:a}/use-cases?vista=roadmap", as: CONTRIBUTOR, absent: ["indispensabili", "Tocca a te", "Prossima tappa"] },
  // «Avvia la realizzazione» (Lateral Space only): the form starts from the use case.
  { name: "avvia-realizzazione", path: "/dashboard/{ws:a}/casi-duso/nuovo?useCaseId={uc:r09}", as: ["ls-lead"], present: ["Avvia la realizzazione", "{code:r09}"], copyGuard: false },
];

export default routes;
