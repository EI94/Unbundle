import type { AiReadinessTemplateDefinition } from "./types";

export const AI_READINESS_SYSTEM_TEMPLATE_VERSION = "2.0.0";

/**
 * Template core v2 — sintesi del meglio da: survey Datapizza/NATIVA (quiz
 * oggettivo di conoscenza, uso reale, atteggiamento), framework sistemico
 * NATIVA (domini, ~10-15 min), questionari OPIT/Dylog (baseline ROI,
 * criteri di ammissibilita use case, policy d'uso sicuro).
 * Tutte le domande a punteggio restano su scala 0–5 per pilastro.
 * Ogni assessment puo poi personalizzare le singole domande (templateOverrides).
 */
export const AI_READINESS_SYSTEM_TEMPLATE: AiReadinessTemplateDefinition = {
  pillars: [
    {
      id: "technology",
      title: "Technology",
      description:
        "Governance degli strumenti AI, accessi, sicurezza dei dati, costi e adeguatezza dello stack.",
      weight: 1,
    },
    {
      id: "context",
      title: "Context",
      description:
        "Qualita, accessibilita e ownership della conoscenza e dei dati aziendali usati dall'AI.",
      weight: 1,
    },
    {
      id: "workflow",
      title: "Workflow",
      description:
        "Maturita dei processi, baseline di tempi e costi, automazioni esistenti e disponibilita al ridisegno.",
      weight: 1,
    },
    {
      id: "adoption",
      title: "Adoption",
      description:
        "Conoscenza reale dell'AI (non solo percepita), uso quotidiano, atteggiamento e cultura di sperimentazione.",
      weight: 1,
    },
    {
      id: "use_cases",
      title: "Use Cases",
      description:
        "Capacita di identificare, valutare e proporre use case concreti, sicuri e collegati al business.",
      weight: 1,
    },
  ],
  sections: [
    {
      id: "technology-governance",
      pillarId: "technology",
      title: "Governance e sicurezza",
      description:
        "Regole del gioco: strumenti approvati, accessi, protezione dei dati.",
    },
    {
      id: "technology-stack",
      pillarId: "technology",
      title: "Stack e strumenti",
      description: "Adeguatezza e controllo degli strumenti AI disponibili.",
    },
    {
      id: "context-knowledge",
      pillarId: "context",
      title: "Conoscenza e dati",
      description:
        "Quanto la conoscenza aziendale e pronta per essere usata (anche) da un'AI.",
    },
    {
      id: "workflow-processes",
      pillarId: "workflow",
      title: "Processi e redesign",
      description:
        "Chiarezza dei flussi, misurabilita e disponibilita a ridisegnarli.",
    },
    {
      id: "adoption-knowledge",
      pillarId: "adoption",
      title: "Conoscenza AI",
      description:
        "Cosa sai davvero dell'AI generativa: autovalutazione piu due domande di verifica.",
    },
    {
      id: "adoption-usage",
      pillarId: "adoption",
      title: "Uso quotidiano",
      description: "Quanto e come l'AI entra gia nel lavoro di tutti i giorni.",
    },
    {
      id: "adoption-attitude",
      pillarId: "adoption",
      title: "Atteggiamento e cultura",
      description: "Fiducia, formazione e clima del team rispetto all'AI.",
    },
    {
      id: "use-cases-capability",
      pillarId: "use_cases",
      title: "Qualita use case",
      description:
        "Saper riconoscere, valutare e proporre casi d'uso adatti e sicuri.",
    },
  ],
  questions: [
    // ───────────── TECHNOLOGY ─────────────
    {
      id: "tech-approved-tools",
      pillarId: "technology",
      sectionId: "technology-governance",
      label:
        "In azienda e chiaro quali strumenti AI sono approvati e per quali usi",
      description: "0 = nessuna indicazione, 5 = lista chiara e comunicata a tutti.",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
    },
    {
      id: "tech-access-controls",
      pillarId: "technology",
      sectionId: "technology-governance",
      label:
        "Gli accessi agli strumenti AI sono gestiti con account aziendali e permessi controllati",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
    },
    {
      id: "tech-data-protection",
      pillarId: "technology",
      sectionId: "technology-governance",
      label:
        "Esistono regole chiare su quali dati si possono inserire negli strumenti AI",
      description:
        "Es. dati di clienti, dati personali, informazioni riservate: cosa si puo usare e dove.",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
    },
    {
      id: "tech-monitoring",
      pillarId: "technology",
      sectionId: "technology-stack",
      label: "Uso e costi degli strumenti AI vengono monitorati regolarmente",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
    },
    {
      id: "tech-stack-fit",
      pillarId: "technology",
      sectionId: "technology-stack",
      label:
        "Gli strumenti AI a tua disposizione coprono i bisogni reali del tuo lavoro",
      description: "0 = nessuno strumento utile, 5 = ho tutto cio che serve.",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
    },
    // ───────────── CONTEXT ─────────────
    {
      id: "ctx-knowledge-access",
      pillarId: "context",
      sectionId: "context-knowledge",
      label:
        "Le informazioni che ti servono per lavorare (procedure, documenti, dati) sono facili da trovare e aggiornate",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
    },
    {
      id: "ctx-data-quality",
      pillarId: "context",
      sectionId: "context-knowledge",
      label:
        "I dati aziendali sono affidabili e utilizzabili senza rilavorazioni manuali",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
    },
    {
      id: "ctx-knowledge-ownership",
      pillarId: "context",
      sectionId: "context-knowledge",
      label:
        "E chiaro chi possiede e tiene aggiornata la conoscenza critica dei processi",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
    },
    {
      id: "ctx-documentation",
      pillarId: "context",
      sectionId: "context-knowledge",
      label:
        "I processi chiave sono documentati abbastanza bene da poterli spiegare a un'AI",
      description:
        "Se domani dovessi far eseguire il processo a un collega nuovo (o a un agente AI), la documentazione basterebbe?",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
    },
    {
      id: "ctx-missing-info",
      pillarId: "context",
      sectionId: "context-knowledge",
      label: "Quali informazioni ti mancano piu spesso per lavorare bene?",
      answerType: "text",
      required: false,
    },
    // ───────────── WORKFLOW ─────────────
    {
      id: "wf-repetitive-mapped",
      pillarId: "workflow",
      sectionId: "workflow-processes",
      label:
        "Le attivita ripetitive o a basso valore del tuo team sono state mappate",
      description: "Sapete quali sono, quanto tempo assorbono e chi le fa.",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
    },
    {
      id: "wf-process-clarity",
      pillarId: "workflow",
      sectionId: "workflow-processes",
      label:
        "I flussi di lavoro hanno passaggi e responsabilita chiari (chi fa cosa, quando)",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
    },
    {
      id: "wf-baseline-roi",
      pillarId: "workflow",
      sectionId: "workflow-processes",
      label:
        "Sapete misurare tempi e costi dei processi principali (baseline per il ROI)",
      description:
        "Senza baseline non si puo dimostrare quanto l'AI fa risparmiare davvero.",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
    },
    {
      id: "wf-automation",
      pillarId: "workflow",
      sectionId: "workflow-processes",
      label:
        "Alcune parti dei vostri processi sono gia automatizzate o assistite dall'AI",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
    },
    {
      id: "wf-redesign-readiness",
      pillarId: "workflow",
      sectionId: "workflow-processes",
      label:
        "Il team e disposto a ridisegnare i processi, non solo a renderli piu veloci",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
    },
    {
      id: "wf-time-waster",
      pillarId: "workflow",
      sectionId: "workflow-processes",
      label: "Qual e il processo che oggi vi fa perdere piu tempo?",
      answerType: "text",
      required: false,
    },
    // ───────────── ADOPTION — Conoscenza ─────────────
    {
      id: "ad-self-knowledge",
      pillarId: "adoption",
      sectionId: "adoption-knowledge",
      label:
        "Quanto conosci i concetti base dell'AI generativa (modelli, prompt, limiti, allucinazioni)?",
      description:
        "Autovalutazione onesta: 0 = per niente, 5 = li so spiegare ad altri.",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
    },
    {
      id: "ad-quiz-how-genai-works",
      pillarId: "adoption",
      sectionId: "adoption-knowledge",
      label: "Come funziona, in sintesi, un modello di AI generativa?",
      description: "Domanda di verifica: scegli la risposta che ti sembra corretta.",
      answerType: "single_choice",
      required: true,
      weight: 1,
      options: [
        {
          value: "search",
          label: "Cerca la risposta su internet in tempo reale",
          score: 1,
        },
        {
          value: "predict",
          label:
            "Genera il testo prevedendo la parola piu probabile in base ai dati di addestramento",
          score: 5,
        },
        {
          value: "faq",
          label: "Copia la risposta da un database di domande e risposte",
          score: 0,
        },
        {
          value: "rules",
          label: "Applica regole scritte una per una dai programmatori",
          score: 1,
        },
      ],
    },
    {
      id: "ad-quiz-genai-limit",
      pillarId: "adoption",
      sectionId: "adoption-knowledge",
      label: "Quale tra questi e un limite attuale dell'AI generativa?",
      answerType: "single_choice",
      required: true,
      weight: 1,
      options: [
        {
          value: "hallucination",
          label: "Puo inventare informazioni plausibili ma false",
          score: 5,
        },
        { value: "no-italian", label: "Non capisce l'italiano", score: 0 },
        { value: "offline", label: "Funziona solo senza internet", score: 0 },
        {
          value: "short-text",
          label: "Non riesce a scrivere testi piu lunghi di una pagina",
          score: 1,
        },
      ],
    },
    // ───────────── ADOPTION — Uso quotidiano ─────────────
    {
      id: "ad-usage-frequency",
      pillarId: "adoption",
      sectionId: "adoption-usage",
      label: "Con quale frequenza usi strumenti AI per lavoro?",
      answerType: "single_choice",
      required: true,
      weight: 1,
      options: [
        { value: "never", label: "Mai", score: 0 },
        { value: "monthly", label: "Qualche volta al mese", score: 1 },
        { value: "weekly", label: "Ogni settimana", score: 3 },
        { value: "daily", label: "Ogni giorno", score: 4 },
        {
          value: "integrated",
          label: "Piu volte al giorno: fa parte del mio flusso di lavoro",
          score: 5,
        },
      ],
    },
    {
      id: "ad-usage-depth",
      pillarId: "adoption",
      sectionId: "adoption-usage",
      label:
        "Usi l'AI anche per compiti fuori dal tuo dominio (analisi dati, bozze di codice, calcoli)?",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
    },
    {
      id: "ad-team-usage",
      pillarId: "adoption",
      sectionId: "adoption-usage",
      label: "Quanto i tuoi colleghi usano gia l'AI nel lavoro quotidiano?",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
    },
    {
      id: "ad-practical-case",
      pillarId: "adoption",
      sectionId: "adoption-usage",
      label:
        "Racconta un caso pratico in cui l'AI ti e stata davvero utile (se c'e stato)",
      answerType: "text",
      required: false,
    },
    // ───────────── ADOPTION — Atteggiamento ─────────────
    {
      id: "ad-attitude",
      pillarId: "adoption",
      sectionId: "adoption-attitude",
      label: "Qual e il tuo atteggiamento verso la diffusione dell'AI in azienda?",
      description: "0 = preoccupato o contrario, 5 = entusiasta e proattivo.",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
    },
    {
      id: "ad-training-fit",
      pillarId: "adoption",
      sectionId: "adoption-attitude",
      label: "L'azienda offre formazione AI adeguata al tuo ruolo",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
    },
    {
      id: "ad-productivity-belief",
      pillarId: "adoption",
      sectionId: "adoption-attitude",
      label:
        "Quanto pensi che l'AI possa aumentare la qualita e la produttivita del tuo lavoro?",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
    },
    // ───────────── USE CASES ─────────────
    {
      id: "uc-identification",
      pillarId: "use_cases",
      sectionId: "use-cases-capability",
      label:
        "Sapresti riconoscere nel tuo lavoro un caso d'uso adatto all'AI (ripetitivo, con regole chiare e dati disponibili)?",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
    },
    {
      id: "uc-pilot-history",
      pillarId: "use_cases",
      sectionId: "use-cases-capability",
      label:
        "Il tuo team ha gia provato esperimenti o pilot con l'AI (anche piccoli)",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
    },
    {
      id: "uc-prioritization",
      pillarId: "use_cases",
      sectionId: "use-cases-capability",
      label:
        "In azienda esiste un modo chiaro per proporre e prioritizzare le idee AI",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
    },
    {
      id: "uc-risk-awareness",
      pillarId: "use_cases",
      sectionId: "use-cases-capability",
      label:
        "Sai valutare quando un caso d'uso AI e rischioso (dati sensibili, decisioni sulle persone, errori costosi)?",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
    },
    {
      id: "uc-first-idea",
      pillarId: "use_cases",
      sectionId: "use-cases-capability",
      label: "Se domani potessi delegare una cosa all'AI, quale sarebbe?",
      answerType: "text",
      required: false,
    },
  ],
  scoringSchema: {
    version: "ai-readiness-core-2",
    scale: { min: 0, max: 5 },
    readinessFormula: {
      weightedAverageWeight: 0.65,
      weakestPillarWeight: 0.35,
    },
  },
};
