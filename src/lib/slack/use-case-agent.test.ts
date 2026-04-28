import test from "node:test";
import assert from "node:assert/strict";
import {
  detectContributionKind,
  normalizeDraftFieldValue,
  questionForSlackDraftField,
  requiredSlackDraftFields,
  resolveSlackDraftThreadTs,
  slackDraftFieldLabel,
  sanitizeSlackBotText,
  validateSlackDraftAnswer,
  type SlackDraftField,
  type SlackPortfolioKind,
} from "./use-case-agent-utils.ts";

test("non espone markdown bold con doppio asterisco nei messaggi Slack", () => {
  assert.equal(
    sanitizeSlackBotText("Perfetto, **titolo** registrato."),
    "Perfetto, titolo registrato."
  );
});

test("classifica una segnalazione di idea come use case AI", () => {
  assert.equal(
    detectContributionKind("voglio segnalare un'idea"),
    "use_case_ai"
  );
});

test("classifica un processo gia migliorato come best practice", () => {
  assert.equal(
    detectContributionKind("abbiamo gia migliorato questo processo con l'AI"),
    "best_practice"
  );
});

test("normalizza l'urgenza senza superare il limite DB", () => {
  const value = "quick win ".repeat(80);
  const normalized = normalizeDraftFieldValue("urgency", value);
  assert.equal(normalized.length <= 255, true);
});

test("per le best practice non chiama controllo umano il campo beneficiari", () => {
  assert.equal(
    slackDraftFieldLabel("humanInTheLoop", "best_practice"),
    "beneficiari e adozione"
  );
});

test("per gli use case AI mantiene controllo umano come label corretta", () => {
  assert.equal(
    slackDraftFieldLabel("humanInTheLoop", "use_case_ai"),
    "controllo umano"
  );
});

test("accetta 'tutta nativa' come risposta beneficiari per best practice", () => {
  assert.deepEqual(
    validateSlackDraftAnswer("humanInTheLoop", "best_practice", "tutta nativa"),
    { ok: true }
  );
});

test("rifiuta 'tutta nativa' come controllo umano per use case AI", () => {
  const result = validateSlackDraftAnswer(
    "humanInTheLoop",
    "use_case_ai",
    "tutta nativa"
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.message, /chi mantiene il controllo umano/i);
});

test("accetta una risposta concreta sul controllo umano per use case AI", () => {
  assert.deepEqual(
    validateSlackDraftAnswer(
      "humanInTheLoop",
      "use_case_ai",
      "Il responsabile del progetto rilegge e approva l'output prima della consegna."
    ),
    { ok: true }
  );
});

test("rifiuta risposte a basso contenuto informativo", () => {
  assert.equal(
    validateSlackDraftAnswer("expectedImpact", "use_case_ai", "ok").ok,
    false
  );
});

test("accetta un impatto ESG neutro dichiarato esplicitamente", () => {
  assert.deepEqual(
    validateSlackDraftAnswer(
      "sustainabilityImpact",
      "best_practice",
      "nessuno"
    ),
    { ok: true }
  );
});

test("rifiuta 'tutta nativa' quando chiede dati o requisiti", () => {
  assert.equal(
    validateSlackDraftAnswer("dataRequirements", "best_practice", "tutta nativa")
      .ok,
    false
  );
});

test("adatta la domanda di replicabilita se il beneficiario e tutta l'organizzazione", () => {
  const question = questionForSlackDraftField("dataRequirements", "best_practice", {
    humanInTheLoop: "tutta nativa",
  });
  assert.match(question, /replicarla bene/i);
  assert.doesNotMatch(question, /Altri team/i);
});

test("la domanda beneficiari per best practice non parla di controllo umano", () => {
  const question = questionForSlackDraftField("humanInTheLoop", "best_practice");
  assert.match(question, /Chi la usa o ne beneficia/i);
  assert.doesNotMatch(question, /revisiona|approva|controlla/i);
});

test("la domanda controllo umano per use case AI chiede revisione o approvazione", () => {
  const question = questionForSlackDraftField("humanInTheLoop", "use_case_ai");
  assert.match(question, /revisiona|approva|controlla/i);
});

test("in canale Slack senza thread riusa il draft attivo invece del ts del nuovo messaggio", () => {
  assert.equal(
    resolveSlackDraftThreadTs({
      raw: { channel: "D0AV2S6D84S", ts: "1777384591.933679" },
      activeDraftThreadTs: "1777384538.981859",
    }),
    "1777384538.981859"
  );
});

test("in un thread Slack esplicito il thread_ts vince sempre", () => {
  assert.equal(
    resolveSlackDraftThreadTs({
      raw: {
        channel: "C0ARWFNFFLL",
        thread_ts: "1777364597.475579",
        ts: "1777364601.000000",
      },
      activeDraftThreadTs: "old-active-draft",
    }),
    "1777364597.475579"
  );
});

test("senza draft attivo usa il ts del messaggio come nuova radice", () => {
  assert.equal(
    resolveSlackDraftThreadTs({
      raw: { channel: "D0AV2S6D84S", ts: "1777384591.933679" },
    }),
    "1777384591.933679"
  );
});

test("rifiuta divagazioni evidenti e mantiene lo stesso campo", () => {
  const result = validateSlackDraftAnswer(
    "problem",
    "use_case_ai",
    "bella la piattaforma comunque"
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.message, /fuori contesto/i);
});

type Scenario = {
  name: string;
  channel: "slack" | "webapp";
  initial: string;
  kind: SlackPortfolioKind;
  esgEnabled: boolean;
  answers: string[];
};

const SCENARIOS: Scenario[] = [
  {
    name: "Slack DM use case NATIVA non-account: project tracking",
    channel: "slack",
    initial: "Idea per migliorare processo",
    kind: "use_case_ai",
    esgEnabled: true,
    answers: [
      "Automated project tracking",
      "Oggi i PM aggiornano manualmente avanzamento, rischi e prossimi step in fogli e messaggi sparsi.",
      "L'AI legge note meeting, task e ticket, genera una dashboard aggiornata e notifica gli owner sui blocchi.",
      "Il project owner controlla e approva aggiornamenti critici prima che siano condivisi al cliente.",
      "Non deve cambiare budget, date o responsabilita senza approvazione umana esplicita.",
      "Risparmia circa 3 ore a settimana e migliora qualita e tempestivita degli aggiornamenti.",
      "Servono accesso a Jira, note meeting, lista owner e template del report di progetto.",
      "Quick win se partiamo con un team pilota, poi estensione in 3 mesi.",
      "Riduce riunioni di allineamento e stress operativo, impatto ambientale indiretto basso.",
    ],
  },
  {
    name: "Slack channel mention use case: title with natural phrase",
    channel: "slack",
    initial: "voglio segnalare un'idea",
    kind: "use_case_ai",
    esgEnabled: true,
    answers: [
      "La chiamerei Automated project tracking",
      "Oggi il processo di tracking progetti dipende da aggiornamenti manuali e spesso incompleti.",
      "Un agent AI analizza documenti, ticket e meeting notes e genera lo stato progetto con alert.",
      "Il responsabile delivery revisiona e approva lo stato prima dell'invio.",
      "Il sistema deve evitare modifiche automatiche a scope, budget e responsabilita.",
      "Migliora qualita del reporting e riduce almeno 2 ore per progetto ogni settimana.",
      "Servono dati da project board, documenti di progetto, accessi e template reporting.",
      "Quick win per un pilota di 4 settimane.",
      "Impatto sociale positivo per meno lavoro ripetitivo; ambientale neutro.",
    ],
  },
  {
    name: "Slack use case: beneficiary given as human control is rejected",
    channel: "slack",
    initial: "ho un use case AI da proporre",
    kind: "use_case_ai",
    esgEnabled: false,
    answers: [
      "Proposal quality assistant",
      "Oggi le proposte commerciali sono scritte manualmente e la qualita varia tra team.",
      "L'AI legge brief cliente e materiali aziendali, genera una bozza personalizzata e checklist.",
      "tutta nativa",
      "Il responsabile commerciale rilegge, corregge e approva la proposta prima dell'invio.",
      "Non deve inventare referenze, prezzi o promesse contrattuali non approvate.",
      "Risparmia 4 ore per proposta e migliora qualita e personalizzazione per il cliente.",
      "Servono CRM, template offerte, case study approvati e linee guida commerciali.",
      "Da fare entro 3 mesi con un pilota sales.",
    ],
  },
  {
    name: "Slack use case: data answer unknown then recovered",
    channel: "slack",
    initial: "segnalo una idea AI",
    kind: "use_case_ai",
    esgEnabled: false,
    answers: [
      "Customer ticket clustering",
      "Oggi il team support legge manualmente ticket ripetitivi e fatica a trovare pattern.",
      "Il modello AI raggruppa ticket simili, suggerisce cause ricorrenti e crea una sintesi.",
      "Il customer care manager valida cluster e priorita prima di aprire iniziative.",
      "Non deve esporre dati personali o suggerire risposte senza revisione.",
      "Riduce tempi di analisi e migliora qualita delle decisioni sui problemi ricorrenti.",
      "boh",
      "Servono ticket storici, tassonomie, accessi helpdesk e policy privacy.",
      "Quick win con dati gia disponibili.",
    ],
  },
  {
    name: "Slack use case: too short title then valid title",
    channel: "slack",
    initial: "idea",
    kind: "use_case_ai",
    esgEnabled: false,
    answers: [
      "AI",
      "Analisi ticket clienti",
      "Oggi il team analizza manualmente i ticket clienti e perde tempo su segnalazioni ripetute.",
      "L'AI analizza i ticket, estrae temi e genera insight operativi per il team.",
      "Un team lead controlla e approva insight prima della condivisione.",
      "Non deve usare dati sensibili nei riepiloghi o creare decisioni automatiche.",
      "Risparmia ore di analisi e migliora qualita delle priorita operative.",
      "Servono export ticket, categorie, storico risoluzioni e accessi sicuri.",
      "Quick win.",
    ],
  },
  {
    name: "Slack use case: digression on problem then valid",
    channel: "slack",
    initial: "potremmo applicare AI a un servizio",
    kind: "use_case_ai",
    esgEnabled: true,
    answers: [
      "Meeting insight generator",
      "bella la piattaforma comunque",
      "Oggi dopo le riunioni il team scrive manualmente follow up, owner e decisioni.",
      "Un agent AI legge transcript e crea azioni, rischi e decisioni in una dashboard.",
      "Il meeting owner approva le azioni prima che siano inviate.",
      "Non deve assegnare task a persone non presenti o inventare decisioni.",
      "Riduce 30 minuti per riunione e migliora qualita dei follow up.",
      "Servono transcript, calendario, lista partecipanti e template follow up.",
      "Quick win in 2 settimane.",
      "Riduce riunioni extra e quindi trasferte marginali; impatto sociale positivo.",
    ],
  },
  {
    name: "Slack use case: guardrail too short then concrete",
    channel: "slack",
    initial: "use case AI per HR",
    kind: "use_case_ai",
    esgEnabled: true,
    answers: [
      "HR policy assistant",
      "Oggi HR risponde manualmente a domande ripetitive su policy e procedure interne.",
      "L'AI cerca nelle policy approvate e genera risposte con link alla fonte.",
      "Il team HR controlla le risposte nuove o ambigue prima della pubblicazione.",
      "privacy",
      "Non deve dare consulenza legale, usare dati personali o rispondere senza fonte.",
      "Riduce tempi di risposta e migliora qualita e coerenza delle informazioni.",
      "Servono policy aggiornate, fonte documentale e owner HR per validazione.",
      "Pilota in 1 mese.",
      "Impatto sociale positivo per accesso piu rapido alle informazioni; ambientale neutro.",
    ],
  },
  {
    name: "Slack use case: problem too generic then valid",
    channel: "slack",
    initial: "vorrei proporre un'applicazione AI",
    kind: "use_case_ai",
    esgEnabled: false,
    answers: [
      "Invoice anomaly checker",
      "si perde tempo",
      "Oggi finance controlla manualmente fatture e anomalie confrontando email, ordini e fogli.",
      "L'AI analizza fatture, ordini e storico, segnala anomalie e prepara motivazione.",
      "Il finance manager approva blocchi e pagamenti prima di ogni azione.",
      "Non deve approvare pagamenti o modificare dati contabili automaticamente.",
      "Riduce errori e tempi di controllo, migliorando qualita della compliance.",
      "Servono fatture, ordini, storico fornitori e accessi ERP in lettura.",
      "Progetto medio di 2 mesi.",
    ],
  },
  {
    name: "Slack best practice: org-wide beneficiary",
    channel: "slack",
    initial: "abbiamo gia migliorato questo processo con l'AI",
    kind: "best_practice",
    esgEnabled: true,
    answers: [
      "Brainstorming proposte tailor made",
      "Prima le proposte erano molto standardizzate e richiedevano molte iterazioni manuali.",
      "L'AI legge meeting notes e materiali cliente, genera idee e struttura una proposta personalizzata.",
      "Migliora qualita dell'output e aumenta personalizzazione delle proposte per i clienti.",
      "tutta nativa",
      "Per replicarla servono template proposta, meeting notes, casi studio e una skill AI condivisa.",
      "Impatto sociale neutro, con attenzione a non ridurre troppo il contributo creativo umano.",
    ],
  },
  {
    name: "Slack best practice: invalid requirements then valid",
    channel: "slack",
    initial: "best practice gia in uso",
    kind: "best_practice",
    esgEnabled: false,
    answers: [
      "Sintesi automatica workshop",
      "Prima il team sintetizzava manualmente note workshop e decisioni in documenti lunghi.",
      "L'AI analizza transcript e appunti, crea sintesi, decisioni e azioni ordinate.",
      "Risparmia 2 ore per workshop e migliora qualita della memoria condivisa.",
      "Team consulenza e project manager la usano dopo ogni workshop.",
      "tutta nativa",
      "Servono transcript, template sintesi, owner del workshop e regole privacy.",
    ],
  },
  {
    name: "Slack best practice ESG neutral",
    channel: "slack",
    initial: "abbiamo implementato una best practice AI",
    kind: "best_practice",
    esgEnabled: true,
    answers: [
      "Knowledge base assistant",
      "Prima le persone cercavano manualmente documenti e risposte nella knowledge base.",
      "L'AI interroga documenti approvati e restituisce risposte con fonte verificabile.",
      "Risparmia tempo di ricerca e migliora qualita delle risposte interne.",
      "Tutti i team aziendali possono usarla come primo livello di ricerca.",
      "Servono documenti aggiornati, permessi, owner contenuti e policy di accesso.",
      "Impatto ambientale neutro, sociale positivo per accesso piu equo alla conoscenza.",
    ],
  },
  {
    name: "Webapp use case: complete ESG submission",
    channel: "webapp",
    initial: "idea per applicare AI a operations",
    kind: "use_case_ai",
    esgEnabled: true,
    answers: [
      "Operations capacity planner",
      "Oggi operations pianifica capacita manualmente con fogli e dati incompleti.",
      "L'AI analizza backlog, disponibilita e vincoli, genera scenari di capacita.",
      "L'operations lead valida lo scenario prima di condividerlo.",
      "Non deve cambiare assegnazioni senza consenso o ignorare vincoli contrattuali.",
      "Migliora qualita della pianificazione e riduce ore di allineamento.",
      "Servono backlog, calendari, capacita team e storico delivery.",
      "Wave di 3 mesi.",
      "Impatto sociale positivo per carichi piu sostenibili; ambientale neutro.",
    ],
  },
  {
    name: "Webapp use case: procurement assistant",
    channel: "webapp",
    initial: "segnalo un use case AI",
    kind: "use_case_ai",
    esgEnabled: false,
    answers: [
      "Procurement supplier scan",
      "Oggi procurement confronta manualmente fornitori, certificazioni e documenti.",
      "L'AI analizza documenti fornitori, estrae rischi e prepara una scheda comparativa.",
      "Il procurement manager approva shortlist e decisioni finali.",
      "Non deve scartare fornitori automaticamente o usare fonti non verificate.",
      "Riduce tempi di scouting e migliora qualita della valutazione fornitori.",
      "Servono documenti fornitori, criteri scoring, policy acquisti e accessi.",
      "Progetto strutturato di 2 mesi.",
    ],
  },
  {
    name: "Webapp best practice: finance close",
    channel: "webapp",
    initial: "abbiamo fatto una best practice con AI",
    kind: "best_practice",
    esgEnabled: false,
    answers: [
      "Monthly close checklist",
      "Prima finance controllava manualmente checklist e anomalie di chiusura mensile.",
      "L'AI legge dati contabili e checklist, segnala eccezioni e prepara commenti.",
      "Risparmia tempo e migliora qualita dei controlli di chiusura.",
      "Finance e controllo di gestione la usano ogni mese.",
      "Servono dati contabili, checklist aggiornata, regole di materialita e owner finance.",
    ],
  },
  {
    name: "Webapp best practice: marketing content reuse",
    channel: "webapp",
    initial: "processo gia migliorato con AI",
    kind: "best_practice",
    esgEnabled: true,
    answers: [
      "Content atomization",
      "Prima il marketing riadattava manualmente contenuti lunghi in post e newsletter.",
      "L'AI analizza contenuti approvati e genera varianti per canali diversi.",
      "Aumenta velocita di produzione e migliora coerenza del tono.",
      "Marketing e comunicazione la usano per campagne e contenuti editoriali.",
      "Servono brand guidelines, contenuti approvati, calendario editoriale e owner.",
      "Impatto sociale neutro; attenzione a mantenere supervisione creativa umana.",
    ],
  },
  {
    name: "Webapp use case: legal review with digression",
    channel: "webapp",
    initial: "idea AI per legal",
    kind: "use_case_ai",
    esgEnabled: false,
    answers: [
      "Contract clause reviewer",
      "che tempo fa oggi?",
      "Oggi legal rilegge manualmente contratti e clausole standard con molto lavoro ripetitivo.",
      "L'AI analizza contratti, evidenzia clausole rischiose e suggerisce commenti basati su playbook.",
      "Un avvocato interno approva ogni commento prima di inviarlo.",
      "Non deve fornire pareri legali definitivi o modificare clausole senza approvazione.",
      "Riduce tempi di review e migliora qualita e coerenza dei controlli.",
      "Servono playbook legale, template contratti, storico commenti e accessi sicuri.",
      "Progetto di 3 mesi.",
    ],
  },
  {
    name: "Webapp use case: recruiting screening",
    channel: "webapp",
    initial: "potremmo usare AI nel recruiting",
    kind: "use_case_ai",
    esgEnabled: true,
    answers: [
      "Recruiting shortlist assistant",
      "Oggi HR legge manualmente CV e note colloqui con rischio di bias e tempi lunghi.",
      "L'AI estrae competenze dai CV e prepara una shortlist spiegabile per ruolo.",
      "Recruiter e hiring manager revisionano e approvano ogni shortlist.",
      "Deve evitare discriminazioni, dati sensibili e decisioni automatiche sui candidati.",
      "Riduce tempi di screening e migliora qualita e tracciabilita della valutazione.",
      "Servono CV, criteri ruolo, policy DEI e storico processi selettivi.",
      "Progetto strutturato per compliance, almeno 3 mesi.",
      "Impatto sociale alto: va progettato per ridurre bias e garantire equita.",
    ],
  },
  {
    name: "Webapp best practice: customer onboarding",
    channel: "webapp",
    initial: "utilizziamo gia AI per onboarding clienti",
    kind: "best_practice",
    esgEnabled: true,
    answers: [
      "Customer onboarding copilot",
      "Prima i customer success preparavano manualmente checklist e materiali per ogni cliente.",
      "L'AI legge contratto e note sales, genera piano onboarding e materiali iniziali.",
      "Risparmia tempo e migliora qualita e personalizzazione dell'esperienza cliente.",
      "Customer success e clienti ne beneficiano durante l'avvio del progetto.",
      "Servono contratto, note sales, template onboarding e owner customer success.",
      "Impatto sociale positivo per maggiore accessibilita alle informazioni; ambientale neutro.",
    ],
  },
  {
    name: "Webapp use case: reporting graphics, Luca-like",
    channel: "webapp",
    initial: "voglio segnalare un'idea per migliorare report",
    kind: "use_case_ai",
    esgEnabled: true,
    answers: [
      "Sostituzione supporto grafiche",
      "Oggi NATIVA dipende da fornitori esterni per fare grafiche di report e relazioni di impatto.",
      "L'AI trasforma documenti Word finalizzati in output graficamente coerenti con le brand guidelines.",
      "Il responsabile progetto rilegge e approva il documento prima della consegna al cliente.",
      "Il contenuto del report non deve essere modificato: l'AI lavora solo sulla parte grafica.",
      "Risparmia 5-10 ore per progetto e migliora qualita e velocita della consegna.",
      "Servono report finale, brand guidelines del cliente, template grafici e owner di progetto.",
      "Quick win se integrato su template ricorrenti.",
      "Impatto sociale da valutare per possibile riduzione del lavoro dei fornitori grafici.",
    ],
  },
  {
    name: "Slack best practice: no account employee in company workspace",
    channel: "slack",
    initial: "abbiamo gia usato AI per migliorare un processo",
    kind: "best_practice",
    esgEnabled: true,
    answers: [
      "Internal FAQ assistant",
      "Prima le persone chiedevano informazioni ripetitive su Slack e il team operations rispondeva manualmente.",
      "L'AI cerca nelle FAQ approvate e risponde con fonte, riducendo domande ripetitive.",
      "Risparmia tempo operativo e migliora qualita e velocita delle risposte interne.",
      "Tutta l'azienda puo usarla per trovare informazioni operative.",
      "Servono FAQ aggiornate, owner contenuti, permessi e processo di revisione.",
      "Impatto sociale positivo per accesso piu rapido alle informazioni; ambientale neutro.",
    ],
  },
];

function simulateScenario(scenario: Scenario) {
  const kind = detectContributionKind(scenario.initial);
  assert.equal(kind, scenario.kind, scenario.name);

  const draft: Partial<Record<SlackDraftField, string>> = {};
  const transcript: string[] = [
    "Unbundle: Ciao, raccolgo il tuo contributo per il portfolio Unbundle.",
    `Utente: ${scenario.initial}`,
    `Unbundle: ${questionForSlackDraftField("title", scenario.kind)}`,
  ];

  for (const answer of scenario.answers) {
    const field = requiredSlackDraftFields(
      scenario.kind,
      scenario.esgEnabled
    ).find((candidate) => !draft[candidate]);
    assert.ok(field, `${scenario.name}: risposta extra non attesa: ${answer}`);

    transcript.push(`Utente: ${answer}`);
    const validation = validateSlackDraftAnswer(field, scenario.kind, answer);
    if (!validation.ok) {
      transcript.push(
        `Unbundle: ${validation.message} ${questionForSlackDraftField(
          field,
          scenario.kind,
          draft
        )}`
      );
      continue;
    }

    draft[field] = normalizeDraftFieldValue(field, answer);
    const next = requiredSlackDraftFields(
      scenario.kind,
      scenario.esgEnabled
    ).find((candidate) => !draft[candidate]);
    transcript.push(
      next
        ? `Unbundle: registrato ${slackDraftFieldLabel(
            field,
            scenario.kind
          )}. ${questionForSlackDraftField(next, scenario.kind, draft)}`
        : "Unbundle: Grazie, ho registrato il contributo nel portfolio Unbundle."
    );
  }

  const missing = requiredSlackDraftFields(
    scenario.kind,
    scenario.esgEnabled
  ).filter((field) => !draft[field]);
  assert.deepEqual(missing, [], `${scenario.name}: campi mancanti`);
  assert.doesNotMatch(
    transcript.slice(3).join("\n"),
    /Vuoi condividere una best practice/i,
    `${scenario.name}: il bot e tornato alla domanda iniziale`
  );
  return transcript;
}

test("20 conversazioni Slack e webapp completano senza loop e senza salti di campo", () => {
  assert.equal(SCENARIOS.length, 20);
  const transcripts = SCENARIOS.map((scenario) => simulateScenario(scenario));
  assert.equal(transcripts.length, 20);
  assert.equal(SCENARIOS.filter((s) => s.channel === "slack").length, 12);
  assert.equal(SCENARIOS.filter((s) => s.channel === "webapp").length, 8);
});
