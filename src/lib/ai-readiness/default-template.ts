import type { AiReadinessTemplateDefinition } from "./types";

export const AI_READINESS_SYSTEM_TEMPLATE_VERSION = "4.0.0";

/**
 * Template core v4 — un unico assessment, due binari:
 *
 * - sezioni `audience: "internal"` → schede compilate sul tool dai referenti
 *   (IT per infrastruttura e dati, HR per ruoli e processi, business per gli
 *   use case), tramite link personali con binario "referenti";
 * - sezioni `audience: "everyone"` → la survey condivisa con tutta
 *   l'organizzazione (strumenti e regole d'uso, adoption, use case).
 *
 * Ogni domanda a scala spiega TUTTI i livelli 1..5 (`levels`) più l'opzione
 * "Non so / non applicabile" che vale 0,5 (`allowUnsure`): si sceglie in modo
 * consapevole, mai al buio. Linguaggio semplice, zero gergo, esempi concreti.
 * Score sempre 0–5 per pilastro.
 */
export const AI_READINESS_SYSTEM_TEMPLATE: AiReadinessTemplateDefinition = {
  pillars: [
    {
      id: "technology",
      title: "Technology",
      description:
        "Infrastruttura tecnologica e regole d'uso: sistemi, chi li mantiene, accessi, e gli strumenti AI nelle mani delle persone.",
      weight: 1,
    },
    {
      id: "context",
      title: "Context",
      description:
        "Dati e conoscenza aziendale: dove vivono, quanto sono affidabili e quanto sono pronti per essere usati (anche) da un'AI.",
      weight: 1,
    },
    {
      id: "workflow",
      title: "Workflow",
      description:
        "Persone, ruoli e processi: chiarezza organizzativa, apertura al cambiamento e abitudini di lavoro da rinnovare.",
      weight: 1,
    },
    {
      id: "adoption",
      title: "Adoption",
      description:
        "Le persone e l'AI: cosa conoscono davvero, quanto la usano gia, cosa ne pensano e cosa li frena.",
      weight: 1,
    },
    {
      id: "use_cases",
      title: "Use Cases",
      description:
        "La capacita di trasformare il lavoro quotidiano in casi concreti dove l'AI aiuta davvero.",
      weight: 1,
    },
  ],
  sections: [
    // ── Schede referenti interni ──
    {
      id: "technology-infrastructure",
      pillarId: "technology",
      title: "Infrastruttura e sistemi",
      description:
        "Da compilare con chi conosce i sistemi (IT o fornitore): cloud, manutenzione, accessi, collegamenti tra programmi.",
      audience: "internal",
    },
    {
      id: "context-systems",
      pillarId: "context",
      title: "Dati e conoscenza aziendale",
      description:
        "Da compilare con chi conosce i dati (IT o area tecnica): dove vivono le informazioni e quanto sono affidabili.",
      audience: "internal",
    },
    {
      id: "workflow-people",
      pillarId: "workflow",
      title: "Persone, ruoli e processi",
      description:
        "Da compilare con HR o chi conosce l'organizzazione: ruoli, competenze, formazione e storia dei cambiamenti.",
      audience: "internal",
    },
    // ── Survey per tutta l'organizzazione ──
    {
      id: "technology-rules",
      pillarId: "technology",
      title: "Strumenti e regole d'uso",
      description:
        "Gli strumenti AI che usi e le regole che conosci: rispondi pensando alla tua esperienza quotidiana.",
      audience: "everyone",
    },
    {
      id: "adoption-knowledge",
      pillarId: "adoption",
      title: "Quanto conosci l'AI",
      description:
        "Niente esame: serve a capire da dove partiamo. Rispondi con sincerita.",
      audience: "everyone",
    },
    {
      id: "adoption-usage",
      pillarId: "adoption",
      title: "L'AI nel tuo lavoro di oggi",
      description:
        "Quanto e come usi gia strumenti come ChatGPT, Copilot o Gemini nel lavoro di tutti i giorni.",
      audience: "everyone",
    },
    {
      id: "adoption-attitude",
      pillarId: "adoption",
      title: "Cosa ne pensi",
      description:
        "La tua opinione conta: entusiasmo, dubbi e cosa ti frena sono informazioni preziose quanto i numeri.",
      audience: "everyone",
    },
    {
      id: "use-cases-ideas",
      pillarId: "use_cases",
      title: "Idee e casi concreti",
      description:
        "Dove l'AI potrebbe aiutarti davvero: idee ed esperimenti gia fatti.",
      audience: "everyone",
    },
  ],
  questions: [
    // ═════════ INTERNAL — Infrastruttura e sistemi (IT) ═════════
    {
      id: "infra-cloud",
      pillarId: "technology",
      sectionId: "technology-infrastructure",
      label:
        "I sistemi e i programmi aziendali girano sul cloud o su server in azienda?",
      description:
        "Il cloud (es. Microsoft 365, Google Workspace) rende molto piu semplice collegare l'AI ai vostri strumenti.",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
      allowUnsure: true,
      levels: [
        { value: 1, label: "Tutto su server nostri e programmi installati sui singoli PC" },
        { value: 2, label: "Quasi tutto interno, con qualche servizio online" },
        { value: 3, label: "Un mix: meta cloud, meta sistemi interni" },
        { value: 4, label: "La maggior parte e su cloud" },
        { value: 5, label: "Praticamente tutto su cloud, accessibile da ovunque" },
      ],
    },
    {
      id: "infra-maintenance",
      pillarId: "technology",
      sectionId: "technology-infrastructure",
      label: "Chi tiene in piedi e fa evolvere i sistemi informatici?",
      description:
        "Risorse interne dedicate, un fornitore esterno, o ci si arrangia quando qualcosa si rompe?",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
      allowUnsure: true,
      levels: [
        { value: 1, label: "Nessuno di dedicato: ci si arrangia" },
        { value: 2, label: "Un fornitore esterno, chiamato solo quando serve" },
        { value: 3, label: "Un fornitore esterno con contratto continuativo" },
        { value: 4, label: "Persone interne dedicate, con supporto esterno" },
        { value: 5, label: "Un team interno che pianifica e fa evolvere i sistemi" },
      ],
    },
    {
      id: "infra-access-policy",
      pillarId: "technology",
      sectionId: "technology-infrastructure",
      label:
        "Esistono regole scritte su chi puo accedere a cosa (programmi, cartelle, dati)?",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
      allowUnsure: true,
      levels: [
        { value: 1, label: "Nessuna regola: tutti accedono a tutto" },
        { value: 2, label: "Qualche regola informale, niente di scritto" },
        { value: 3, label: "Regole scritte, ma applicate a macchia di leopardo" },
        { value: 4, label: "Regole scritte e applicate quasi ovunque" },
        { value: 5, label: "Regole scritte, applicate e riviste periodicamente" },
      ],
    },
    {
      id: "infra-integrations",
      pillarId: "technology",
      sectionId: "technology-infrastructure",
      label: "I vostri programmi 'si parlano' tra loro?",
      description:
        "Es. il gestionale passa i dati alla fatturazione da solo, oppure qualcuno li ricopia a mano?",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
      allowUnsure: true,
      levels: [
        { value: 1, label: "Ogni programma e un'isola: si ricopia tutto a mano" },
        { value: 2, label: "Pochi collegamenti, quasi tutto passa a mano" },
        { value: 3, label: "I sistemi principali sono collegati tra loro" },
        { value: 4, label: "La maggior parte si scambia i dati da sola" },
        { value: 5, label: "Tutto collegato: i dati fluiscono senza copia-incolla" },
      ],
    },
    {
      id: "infra-security",
      pillarId: "technology",
      sectionId: "technology-infrastructure",
      label:
        "Come siete messi con le protezioni di base (password, copie di sicurezza, antivirus)?",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
      allowUnsure: true,
      levels: [
        { value: 1, label: "Nessuna pratica particolare" },
        { value: 2, label: "Qualcosa c'e, ma senza controllo" },
        { value: 3, label: "Le basi ci sono: copie di sicurezza e password gestite" },
        { value: 4, label: "Protezioni solide, verificate ogni tanto" },
        { value: 5, label: "Protezioni solide, verificate regolarmente, con un responsabile" },
      ],
    },
    // ═════════ INTERNAL — Dati e conoscenza (IT) ═════════
    {
      id: "ctx-databases",
      pillarId: "context",
      sectionId: "context-systems",
      label:
        "I dati importanti (clienti, prodotti, ordini) vivono in sistemi centrali o in file sparsi?",
      description:
        "Sistemi centrali = gestionale, archivio clienti condiviso. File sparsi = Excel personali, email, carta.",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
      allowUnsure: true,
      levels: [
        { value: 1, label: "Ovunque: Excel personali, email, carta" },
        { value: 2, label: "Perlopiu file sparsi, con qualche sistema" },
        { value: 3, label: "Meta nei sistemi, meta nei file personali" },
        { value: 4, label: "Quasi tutto in sistemi centrali" },
        { value: 5, label: "Tutto in sistemi centrali, ordinato, senza copie sparse" },
      ],
    },
    {
      id: "ctx-knowledge-system",
      pillarId: "context",
      sectionId: "context-systems",
      label:
        "Esiste un posto unico dove trovare procedure e documenti aziendali?",
      description:
        "Un archivio condiviso e ordinato: una intranet, un'area documenti comune, un manuale aziendale.",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
      allowUnsure: true,
      levels: [
        { value: 1, label: "Non esiste: ognuno ha i suoi file" },
        { value: 2, label: "C'e una cartella condivisa, ma e un caos" },
        { value: 3, label: "C'e un archivio, ma incompleto o poco aggiornato" },
        { value: 4, label: "Archivio ordinato che copre quasi tutto" },
        { value: 5, label: "Archivio unico, ordinato, aggiornato e usato da tutti" },
      ],
    },
    {
      id: "ctx-data-quality",
      pillarId: "context",
      sectionId: "context-systems",
      label: "Quanto sono affidabili i dati che avete?",
      description:
        "Pensate a doppioni, campi vuoti, informazioni vecchie: quanto lavoro serve prima di potersi fidare?",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
      allowUnsure: true,
      levels: [
        { value: 1, label: "Molto sporchi: doppioni e buchi ovunque" },
        { value: 2, label: "Servono spesso correzioni a mano" },
        { value: 3, label: "Usabili, con qualche pulizia ogni tanto" },
        { value: 4, label: "Affidabili nella maggior parte dei casi" },
        { value: 5, label: "Puliti, controllati, con qualcuno che se ne occupa" },
      ],
    },
    {
      id: "ctx-doc-processes",
      pillarId: "context",
      sectionId: "context-systems",
      label: "I processi importanti sono scritti nero su bianco?",
      description:
        "Se domani entra una persona nuova, trova istruzioni scritte per fare il lavoro?",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
      allowUnsure: true,
      levels: [
        { value: 1, label: "Niente di scritto: tutto passa a voce" },
        { value: 2, label: "Qualche appunto sparso" },
        { value: 3, label: "I processi principali sono descritti, ma non aggiornati" },
        { value: 4, label: "Quasi tutti i processi sono scritti e usabili" },
        { value: 5, label: "Tutto documentato, aggiornato e facile da trovare" },
      ],
    },
    {
      id: "ctx-data-access",
      pillarId: "context",
      sectionId: "context-systems",
      label:
        "Chi ha bisogno di un dato per lavorare riesce ad averlo in tempi ragionevoli?",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
      allowUnsure: true,
      levels: [
        { value: 1, label: "Ottenere un dato e un'odissea" },
        { value: 2, label: "Si ottiene, ma con lunghe attese" },
        { value: 3, label: "Dipende dal dato e da chi lo chiede" },
        { value: 4, label: "Quasi sempre in giornata" },
        { value: 5, label: "In autonomia e subito, con i giusti permessi" },
      ],
    },
    // ═════════ INTERNAL — Persone, ruoli e processi (HR) ═════════
    {
      id: "wf-roles-clarity",
      pillarId: "workflow",
      sectionId: "workflow-people",
      label: "Ruoli e responsabilita sono chiari e scritti?",
      description:
        "Chi decide, chi esegue, chi controlla: e definito da qualche parte o si va a consuetudine?",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
      allowUnsure: true,
      levels: [
        { value: 1, label: "Tutto a consuetudine: nulla di definito" },
        { value: 2, label: "Ruoli chiari solo per poche figure" },
        { value: 3, label: "Definiti sulla carta, ma la pratica e diversa" },
        { value: 4, label: "Chiari e rispettati quasi ovunque" },
        { value: 5, label: "Chiari, scritti e aggiornati quando l'organizzazione cambia" },
      ],
    },
    {
      id: "wf-process-renewal",
      pillarId: "workflow",
      sectionId: "workflow-people",
      label: "I modi di lavorare vengono rivisti e aggiornati nel tempo?",
      description:
        "Oppure molti processi sono nati anni fa e nessuno li ha piu toccati, anche se oggi si potrebbe fare meglio?",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
      allowUnsure: true,
      levels: [
        { value: 1, label: "Quasi tutto si fa come dieci anni fa" },
        { value: 2, label: "Pochi processi sono stati rivisti" },
        { value: 3, label: "Alcuni rivisti di recente, altri fermi da anni" },
        { value: 4, label: "La maggior parte rivista negli ultimi anni" },
        { value: 5, label: "Li rivediamo regolarmente, con la tecnologia in mente" },
      ],
    },
    {
      id: "wf-skills-map",
      pillarId: "workflow",
      sectionId: "workflow-people",
      label: "Sapete quali competenze ci sono in azienda e quali mancano?",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
      allowUnsure: true,
      levels: [
        { value: 1, label: "Nessuna mappatura" },
        { value: 2, label: "Un'idea vaga, niente di scritto" },
        { value: 3, label: "Mappatura parziale, solo per alcune aree" },
        { value: 4, label: "Mappatura completa, ma non sempre aggiornata" },
        { value: 5, label: "Completa, aggiornata e usata per formazione e assunzioni" },
      ],
    },
    {
      id: "wf-training-culture",
      pillarId: "workflow",
      sectionId: "workflow-people",
      label: "Quanto si investe nella formazione delle persone?",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
      allowUnsure: true,
      levels: [
        { value: 1, label: "Praticamente zero" },
        { value: 2, label: "Solo la formazione obbligatoria" },
        { value: 3, label: "Corsi ogni tanto, senza un piano" },
        { value: 4, label: "Un piano di formazione annuale per quasi tutti" },
        { value: 5, label: "Formazione continua, con tempo e budget dedicati" },
      ],
    },
    {
      id: "wf-change-history",
      pillarId: "workflow",
      sectionId: "workflow-people",
      label:
        "Come sono andati i grandi cambiamenti passati (un nuovo gestionale, un nuovo modo di lavorare)?",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
      allowUnsure: true,
      levels: [
        { value: 1, label: "Malissimo: resistenze e progetti abbandonati" },
        { value: 2, label: "A fatica e con molti ritardi" },
        { value: 3, label: "Alterni: alcuni bene, altri male" },
        { value: 4, label: "Bene nella maggior parte dei casi" },
        { value: 5, label: "Bene: c'e un metodo collaudato per accompagnarli" },
      ],
    },
    {
      id: "wf-hr-notes",
      pillarId: "workflow",
      sectionId: "workflow-people",
      label:
        "C'e qualcosa su ruoli, competenze o processi che e importante sapere?",
      description:
        "Es. un'area in forte crescita, un pensionamento chiave in arrivo, un reparto gia molto digitale.",
      answerType: "text",
      required: false,
    },
    // ═════════ EVERYONE — Strumenti e regole d'uso ═════════
    {
      id: "tech-approved-tools",
      pillarId: "technology",
      sectionId: "technology-rules",
      label:
        "Sai quali strumenti di AI puoi usare per lavoro e quali invece sono vietati?",
      description:
        "Es. ChatGPT, Copilot, Gemini: l'azienda ti ha mai detto quali sono ammessi?",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
      allowUnsure: true,
      levels: [
        { value: 1, label: "Nessuno mi ha mai detto nulla" },
        { value: 2, label: "Se ne parla, ma niente di ufficiale" },
        { value: 3, label: "Regole comunicate, ma non mi sono chiare" },
        { value: 4, label: "So cosa posso usare" },
        { value: 5, label: "Lista chiara: la conosco e viene aggiornata" },
      ],
    },
    {
      id: "tech-accounts",
      pillarId: "technology",
      sectionId: "technology-rules",
      label:
        "Gli strumenti AI che usi per lavoro sono forniti dall'azienda o ognuno si arrangia?",
      description:
        "Con account aziendali i dati sono piu protetti; con account personali gratuiti nessuno sa dove finiscono.",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
      allowUnsure: true,
      levels: [
        { value: 1, label: "Uso solo account personali gratuiti" },
        { value: 2, label: "Perlopiu personali, qualcosa di aziendale" },
        { value: 3, label: "Un mix di personali e aziendali" },
        { value: 4, label: "Quasi solo strumenti forniti dall'azienda" },
        { value: 5, label: "Solo strumenti aziendali, con il mio account dedicato" },
      ],
    },
    {
      id: "tech-data-rules",
      pillarId: "technology",
      sectionId: "technology-rules",
      label:
        "Ti e chiaro quali informazioni puoi incollare in ChatGPT (o simili) e quali no?",
      description:
        "Es. dati di clienti, contratti, stipendi: sai cosa NON va mai condiviso con l'AI?",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
      allowUnsure: true,
      levels: [
        { value: 1, label: "Non ci ho mai pensato" },
        { value: 2, label: "Vado a intuito" },
        { value: 3, label: "Regole generiche: sui casi pratici ho dubbi" },
        { value: 4, label: "So quasi sempre cosa posso inserire" },
        { value: 5, label: "Regole chiarissime: so sempre cosa posso inserire" },
      ],
    },
    {
      id: "tech-support",
      pillarId: "technology",
      sectionId: "technology-rules",
      label:
        "Se hai un dubbio o un problema con uno strumento AI, sai a chi chiedere?",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
      allowUnsure: true,
      levels: [
        { value: 1, label: "Non saprei proprio a chi rivolgermi" },
        { value: 2, label: "Chiedo a un collega che ne sa piu di me" },
        { value: 3, label: "C'e qualcuno, ma risponde quando puo" },
        { value: 4, label: "C'e un riferimento chiaro" },
        { value: 5, label: "Riferimento chiaro, veloce e sempre disponibile" },
      ],
    },
    // ═════════ EVERYONE — Quanto conosci l'AI ═════════
    {
      id: "ad-inform",
      pillarId: "adoption",
      sectionId: "adoption-knowledge",
      label:
        "Ti capita di informarti sull'intelligenza artificiale (articoli, video, podcast, corsi)?",
      answerType: "single_choice",
      required: true,
      weight: 1,
      options: [
        { value: "never", label: "Mai: non e un tema che seguo", score: 0 },
        { value: "rarely", label: "Raramente, se mi capita sotto gli occhi", score: 1 },
        { value: "sometimes", label: "Ogni tanto, quando esce qualcosa di grosso", score: 3 },
        { value: "often", label: "Spesso: cerco di tenermi aggiornato", score: 4 },
        { value: "always", label: "Con costanza: e un tema che seguo davvero", score: 5 },
      ],
    },
    {
      id: "ad-know-terms",
      pillarId: "adoption",
      sectionId: "adoption-knowledge",
      label:
        "Quanto ti senti sicuro sul significato di parole come 'AI generativa', 'prompt', 'chatbot'?",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
      allowUnsure: true,
      levels: [
        { value: 1, label: "Mai sentite" },
        { value: 2, label: "Le ho sentite, ma non le so spiegare" },
        { value: 3, label: "Le capisco a grandi linee" },
        { value: 4, label: "Le conosco bene" },
        { value: 5, label: "Le so spiegare a un collega" },
      ],
    },
    {
      id: "ad-know-limits",
      pillarId: "adoption",
      sectionId: "adoption-knowledge",
      label: "Sai quando NON fidarti delle risposte dell'AI?",
      description:
        "A volte l'AI inventa dati, nomi o fonti che sembrano veri ma non lo sono.",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
      allowUnsure: true,
      levels: [
        { value: 1, label: "Pensavo ci si potesse sempre fidare" },
        { value: 2, label: "So che puo sbagliare, ma non saprei quando" },
        { value: 3, label: "Ho un'idea dei casi a rischio" },
        { value: 4, label: "So quasi sempre quando verificare" },
        { value: 5, label: "So esattamente quando e come verificare" },
      ],
    },
    {
      id: "ad-quiz-how",
      pillarId: "adoption",
      sectionId: "adoption-knowledge",
      label: "Secondo te, come fa ChatGPT a scrivere le sue risposte?",
      description:
        "Piccola verifica, senza voto individuale: aiuta a capire da dove partiamo come gruppo.",
      answerType: "single_choice",
      required: true,
      weight: 1,
      options: [
        {
          value: "search",
          label: "Cerca su Google e copia quello che trova",
          score: 1,
        },
        {
          value: "predict",
          label:
            "Scrive parola per parola la continuazione piu probabile, in base a tutto cio che ha 'letto' durante l'addestramento",
          score: 5,
        },
        {
          value: "archive",
          label: "Pesca da un archivio di risposte gia scritte da persone",
          score: 0,
        },
        {
          value: "rules",
          label: "Segue regole scritte una per una dai programmatori",
          score: 1,
        },
      ],
    },
    {
      id: "ad-quiz-trust",
      pillarId: "adoption",
      sectionId: "adoption-knowledge",
      label:
        "Ti serve un dato preciso (un prezzo, una norma, una scadenza) e lo chiedi all'AI. Cosa fai con la risposta?",
      answerType: "single_choice",
      required: true,
      weight: 1,
      options: [
        {
          value: "trust",
          label: "La uso direttamente: se lo dice l'AI sara giusto",
          score: 0,
        },
        {
          value: "verify",
          label: "La verifico su una fonte ufficiale prima di usarla",
          score: 5,
        },
        {
          value: "ask-ai",
          label: "Chiedo all'AI se e sicura della risposta",
          score: 1,
        },
        {
          value: "never",
          label: "Non uso mai l'AI per queste cose: tanto sbaglia sempre",
          score: 2,
        },
      ],
    },
    // ═════════ EVERYONE — L'AI nel tuo lavoro di oggi ═════════
    {
      id: "ad-frequency",
      pillarId: "adoption",
      sectionId: "adoption-usage",
      label:
        "Quanto spesso usi strumenti AI (ChatGPT, Copilot, Gemini...) per lavoro?",
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
          label: "Piu volte al giorno: fa parte del mio modo di lavorare",
          score: 5,
        },
      ],
    },
    {
      id: "ad-competence",
      pillarId: "adoption",
      sectionId: "adoption-usage",
      label:
        "Quando usi l'AI, quanto ti senti capace di ottenere quello che ti serve?",
      description:
        "Es. riesci a farle scrivere l'email giusta o riassumere il documento giusto, nel modo che volevi tu?",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
      allowUnsure: true,
      levels: [
        { value: 1, label: "Non saprei da dove cominciare" },
        { value: 2, label: "Provo, ma spesso non ottengo cio che voglio" },
        { value: 3, label: "Me la cavo sulle cose semplici" },
        { value: 4, label: "Ottengo quasi sempre cio che mi serve" },
        { value: 5, label: "Ottengo cio che serve e aiuto anche i colleghi" },
      ],
    },
    {
      id: "ad-beyond",
      pillarId: "adoption",
      sectionId: "adoption-usage",
      label: "Usi l'AI anche per cose fuori dalla tua specialita?",
      description:
        "Es. farti aiutare con un calcolo, una traduzione o un'analisi che prima avresti chiesto a un collega esperto.",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
      allowUnsure: true,
      levels: [
        { value: 1, label: "Mai provato" },
        { value: 2, label: "Una o due volte" },
        { value: 3, label: "Ogni tanto" },
        { value: 4, label: "Spesso" },
        { value: 5, label: "Regolarmente: mi ha cambiato il modo di lavorare" },
      ],
    },
    {
      id: "ad-colleagues",
      pillarId: "adoption",
      sectionId: "adoption-usage",
      label: "Secondo te, quanto usano l'AI i tuoi colleghi?",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
      allowUnsure: true,
      levels: [
        { value: 1, label: "Nessuno la usa" },
        { value: 2, label: "Pochissimi" },
        { value: 3, label: "Qualcuno si, qualcuno no" },
        { value: 4, label: "La maggior parte" },
        { value: 5, label: "Quasi tutti, ogni giorno" },
      ],
    },
    {
      id: "ad-current-usecase",
      pillarId: "adoption",
      sectionId: "adoption-usage",
      label:
        "Se usi gia l'AI per lavoro: per cosa la usi? Racconta uno o due esempi concreti.",
      description:
        "Es. 'riassumo i verbali delle riunioni', 'preparo la prima bozza delle email ai clienti', 'traduco documenti'. Se non la usi, lascia vuoto.",
      answerType: "text",
      required: false,
    },
    // ═════════ EVERYONE — Cosa ne pensi ═════════
    {
      id: "ad-attitude",
      pillarId: "adoption",
      sectionId: "adoption-attitude",
      label: "Come vivi l'arrivo dell'AI nel tuo lavoro?",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
      allowUnsure: true,
      levels: [
        { value: 1, label: "Mi preoccupa: preferirei evitarla" },
        { value: 2, label: "Sono scettico: non mi convince" },
        { value: 3, label: "Neutrale: dipende da come la si usa" },
        { value: 4, label: "Positivo: sono incuriosito" },
        { value: 5, label: "Entusiasta: non vedo l'ora di usarla di piu" },
      ],
    },
    {
      id: "ad-productivity",
      pillarId: "adoption",
      sectionId: "adoption-attitude",
      label:
        "Quanto pensi che l'AI possa aiutarti a lavorare meglio (non solo piu in fretta)?",
      description:
        "Es. meno lavoro noioso, meno errori, piu tempo per le cose che richiedono testa.",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
      allowUnsure: true,
      levels: [
        { value: 1, label: "Per il mio lavoro non serve" },
        { value: 2, label: "Aiuterebbe poco" },
        { value: 3, label: "Qualcosa migliorerebbe" },
        { value: 4, label: "Migliorerebbe parecchie attivita" },
        { value: 5, label: "Cambierebbe davvero le mie giornate" },
      ],
    },
    {
      id: "ad-training",
      pillarId: "adoption",
      sectionId: "adoption-attitude",
      label:
        "La formazione sull'AI che hai ricevuto finora e stata utile per il tuo lavoro?",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
      allowUnsure: true,
      levels: [
        { value: 1, label: "Nessuna formazione ricevuta" },
        { value: 2, label: "Qualcosa, ma poco utile" },
        { value: 3, label: "Utile a meta" },
        { value: 4, label: "Utile" },
        { value: 5, label: "Molto utile e su misura per quello che faccio" },
      ],
    },
    {
      id: "ad-blocker",
      pillarId: "adoption",
      sectionId: "adoption-attitude",
      label:
        "Cosa ti frena di piu, oggi, dall'usare l'AI (o dall'usarla di piu)?",
      description:
        "Es. non so da dove partire, non ho tempo di imparare, non mi fido dei risultati, non so se e permesso...",
      answerType: "text",
      required: false,
    },
    {
      id: "ad-future-usecase",
      pillarId: "adoption",
      sectionId: "adoption-attitude",
      label:
        "C'e un compito del tuo lavoro di tutti i giorni in cui vorresti l'aiuto dell'AI? Descrivilo.",
      description:
        "Non serve sapere se si puo fare: raccontaci il problema. Es. 'vorrei che mi preparasse il report settimanale' o 'vorrei smettere di ricopiare gli ordini a mano'.",
      answerType: "text",
      required: false,
    },
    // ═════════ EVERYONE — Idee e casi concreti ═════════
    {
      id: "uc-recognize",
      pillarId: "use_cases",
      sectionId: "use-cases-ideas",
      label:
        "Sapresti indicare un'attivita del tuo lavoro che l'AI potrebbe fare, o aiutarti a fare?",
      description:
        "In genere l'AI aiuta dove il lavoro e ripetitivo, ha regole chiare e usa informazioni gia scritte da qualche parte.",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
      allowUnsure: true,
      levels: [
        { value: 1, label: "Non saprei proprio" },
        { value: 2, label: "Forse una, ma molto vaga" },
        { value: 3, label: "Un'idea concreta ce l'ho" },
        { value: 4, label: "Piu di un'idea concreta" },
        { value: 5, label: "Ne ho diverse e saprei da dove partire" },
      ],
    },
    {
      id: "uc-tried",
      pillarId: "use_cases",
      sectionId: "use-cases-ideas",
      label:
        "Nel tuo team avete gia provato l'AI su un caso concreto, anche piccolo?",
      description:
        "Es. un esperimento per rispondere prima ai clienti, riassumere documenti, preparare bozze.",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
      allowUnsure: true,
      levels: [
        { value: 1, label: "Mai provato niente" },
        { value: 2, label: "Se ne e parlato, ma nulla di fatto" },
        { value: 3, label: "Un piccolo esperimento" },
        { value: 4, label: "Qualche esperimento, con risultati" },
        { value: 5, label: "Piu esperimenti gia entrati nel lavoro quotidiano" },
      ],
    },
    {
      id: "uc-channel",
      pillarId: "use_cases",
      sectionId: "use-cases-ideas",
      label: "Se hai un'idea per usare l'AI, sai a chi proporla in azienda?",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
      allowUnsure: true,
      levels: [
        { value: 1, label: "Non saprei a chi dirla" },
        { value: 2, label: "La direi al mio capo, poi chissa" },
        { value: 3, label: "C'e un canale, ma non so come funziona" },
        { value: 4, label: "C'e un canale chiaro" },
        { value: 5, label: "Canale chiaro e le idee ricevono risposta" },
      ],
    },
    {
      id: "uc-idea",
      pillarId: "use_cases",
      sectionId: "use-cases-ideas",
      label:
        "Se domani potessi affidare un compito all'AI, quale sceglieresti? Perche?",
      description:
        "Vale tutto: dal piu piccolo fastidio quotidiano al processo piu grosso. Le idee migliori partono quasi sempre da qui.",
      answerType: "text",
      required: false,
    },
  ],
  scoringSchema: {
    version: "ai-readiness-core-4",
    scale: { min: 0, max: 5 },
    readinessFormula: {
      weightedAverageWeight: 0.65,
      weakestPillarWeight: 0.35,
    },
  },
};
