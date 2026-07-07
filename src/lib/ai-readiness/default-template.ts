import type { AiReadinessTemplateDefinition } from "./types";

export const AI_READINESS_SYSTEM_TEMPLATE_VERSION = "3.0.0";

/**
 * Template core v3 — riscritto per persone non tecniche: zero gergo, esempi
 * concreti in ogni domanda, ancore esplicite (cosa significa 0 e cosa 5).
 * La sezione Adoption è la più ricca (stile survey Datapizza/NATIVA) perché
 * viene condivisa con tutta l'organizzazione, e raccoglie sia gli use case
 * AI già in uso sia quelli desiderati. Score sempre 0–5 per pilastro.
 */
export const AI_READINESS_SYSTEM_TEMPLATE: AiReadinessTemplateDefinition = {
  pillars: [
    {
      id: "technology",
      title: "Technology",
      description:
        "Strumenti AI a disposizione e regole d'uso: cosa si puo usare, con quali account, con quali dati.",
      weight: 1,
    },
    {
      id: "context",
      title: "Context",
      description:
        "Informazioni, documenti e dati aziendali: quanto sono facili da trovare, affidabili e scritti nero su bianco.",
      weight: 1,
    },
    {
      id: "workflow",
      title: "Workflow",
      description:
        "Come si lavora ogni giorno: chiarezza dei passaggi, tempo perso in attivita ripetitive, apertura al cambiamento.",
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
    {
      id: "technology-rules",
      pillarId: "technology",
      title: "Strumenti e regole d'uso",
      description:
        "Quali strumenti AI puoi usare, con quali account e con quali dati: le regole del gioco.",
    },
    {
      id: "context-knowledge",
      pillarId: "context",
      title: "Informazioni e documenti",
      description:
        "Quanto e facile trovare cio che serve per lavorare, e quanto e scritto invece che solo 'nella testa' di qualcuno.",
    },
    {
      id: "workflow-daily",
      pillarId: "workflow",
      title: "Come lavorate ogni giorno",
      description:
        "Attivita ripetitive, chiarezza dei passaggi e disponibilita a cambiare il modo di lavorare.",
    },
    {
      id: "adoption-knowledge",
      pillarId: "adoption",
      title: "Quanto conosci l'AI",
      description:
        "Niente esame: serve a capire da dove partiamo. Rispondi con sincerita.",
    },
    {
      id: "adoption-usage",
      pillarId: "adoption",
      title: "L'AI nel tuo lavoro di oggi",
      description:
        "Quanto e come usi gia strumenti come ChatGPT, Copilot o Gemini nel lavoro di tutti i giorni.",
    },
    {
      id: "adoption-attitude",
      pillarId: "adoption",
      title: "Cosa ne pensi",
      description:
        "La tua opinione conta: entusiasmo, dubbi e cosa ti frena sono informazioni preziose quanto i numeri.",
    },
    {
      id: "use-cases-ideas",
      pillarId: "use_cases",
      title: "Idee e casi concreti",
      description:
        "Dove l'AI potrebbe aiutarti davvero: idee, esperimenti gia fatti e casi delicati da riconoscere.",
    },
  ],
  questions: [
    // ───────────── TECHNOLOGY — Strumenti e regole d'uso ─────────────
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
      scaleAnchors: {
        min: "Nessuno mi ha mai detto nulla",
        max: "C'e una lista chiara e la conosco",
      },
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
      scaleAnchors: {
        min: "Ognuno usa account personali",
        max: "Tutti abbiamo account aziendali dedicati",
      },
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
      scaleAnchors: {
        min: "Non ci ho mai pensato",
        max: "Regole chiarissime, so sempre cosa posso inserire",
      },
    },
    {
      id: "tech-stack-fit",
      pillarId: "technology",
      sectionId: "technology-rules",
      label:
        "Gli strumenti AI che hai oggi a disposizione ti bastano per il tuo lavoro?",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
      scaleAnchors: {
        min: "Non ho nessuno strumento utile",
        max: "Ho tutto quello che mi serve",
      },
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
      scaleAnchors: {
        min: "Non saprei proprio a chi rivolgermi",
        max: "C'e un riferimento chiaro che mi aiuta",
      },
    },
    // ───────────── CONTEXT — Informazioni e documenti ─────────────
    {
      id: "ctx-find-info",
      pillarId: "context",
      sectionId: "context-knowledge",
      label:
        "Quando ti serve un'informazione per lavorare (una procedura, un documento, un dato), la trovi facilmente?",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
      scaleAnchors: {
        min: "Perdo tempo a cercarla o a chiedere in giro",
        max: "La trovo subito: e ordinata e aggiornata",
      },
    },
    {
      id: "ctx-data-quality",
      pillarId: "context",
      sectionId: "context-knowledge",
      label: "I dati e i file con cui lavori sono affidabili cosi come sono?",
      description:
        "Es. anagrafiche clienti, listini, report: sono giusti al primo colpo o vanno sempre sistemati a mano?",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
      scaleAnchors: {
        min: "Vanno sempre controllati e corretti a mano",
        max: "Sono affidabili, li uso senza rilavorarli",
      },
    },
    {
      id: "ctx-who-knows",
      pillarId: "context",
      sectionId: "context-knowledge",
      label:
        "Se la persona che 'sa tutto' di un processo va in ferie, il lavoro va avanti lo stesso?",
      description:
        "Misura quanto la conoscenza e scritta da qualche parte invece che solo nella testa di qualcuno.",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
      scaleAnchors: {
        min: "Ci blocchiamo: sa tutto solo lei/lui",
        max: "Tutto e scritto: chiunque puo proseguire",
      },
    },
    {
      id: "ctx-documented",
      pillarId: "context",
      sectionId: "context-knowledge",
      label:
        "I passaggi del tuo lavoro sono scritti da qualche parte (guide, procedure, istruzioni)?",
      description:
        "Se domani arrivasse un collega nuovo, capirebbe come fare leggendo quello che c'e?",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
      scaleAnchors: {
        min: "Niente e scritto: si impara a voce",
        max: "Tutto documentato e aggiornato",
      },
    },
    {
      id: "ctx-missing-info",
      pillarId: "context",
      sectionId: "context-knowledge",
      label:
        "Quale informazione ti manca piu spesso per lavorare bene? Dove la cerchi di solito?",
      answerType: "text",
      required: false,
    },
    // ───────────── WORKFLOW — Come lavorate ogni giorno ─────────────
    {
      id: "wf-repetitive",
      pillarId: "workflow",
      sectionId: "workflow-daily",
      label:
        "Le attivita ripetitive del tuo team sono state identificate e misurate?",
      description:
        "Es. copiare dati da un file all'altro, compilare moduli, scrivere sempre le stesse email: sapete quali sono e quanto tempo portano via?",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
      scaleAnchors: {
        min: "Nessuno le ha mai guardate davvero",
        max: "Le conosciamo e sappiamo quanto tempo costano",
      },
    },
    {
      id: "wf-clear-steps",
      pillarId: "workflow",
      sectionId: "workflow-daily",
      label: "Nel tuo lavoro e chiaro chi fa cosa e quando?",
      description:
        "Es. quando arriva una richiesta di un cliente, tutti sanno chi la prende in carico e quali sono i passaggi?",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
      scaleAnchors: {
        min: "Ogni volta si improvvisa",
        max: "Passaggi e responsabilita chiari per tutti",
      },
    },
    {
      id: "wf-measure",
      pillarId: "workflow",
      sectionId: "workflow-daily",
      label:
        "Sapete quanto tempo costa un'attivita importante del vostro lavoro?",
      description:
        "Es. 'preparare un preventivo ci porta via 45 minuti': avete numeri cosi? Servono per capire dove l'AI fa risparmiare davvero.",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
      scaleAnchors: {
        min: "Nessuna idea: non lo misura nessuno",
        max: "Abbiamo numeri precisi e aggiornati",
      },
    },
    {
      id: "wf-automation",
      pillarId: "workflow",
      sectionId: "workflow-daily",
      label:
        "Ci sono gia pezzi del vostro lavoro che 'si fanno da soli'?",
      description:
        "Es. email che partono in automatico, report che si generano da soli, dati che passano da un programma all'altro senza copia-incolla.",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
      scaleAnchors: {
        min: "Tutto si fa a mano",
        max: "Molti passaggi sono gia automatici",
      },
    },
    {
      id: "wf-change-openness",
      pillarId: "workflow",
      sectionId: "workflow-daily",
      label:
        "Il tuo team e disposto a cambiare il modo di lavorare, non solo a fare le stesse cose piu in fretta?",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
      scaleAnchors: {
        min: "'Si e sempre fatto cosi': meglio non toccare",
        max: "Cambiare non ci spaventa: l'abbiamo gia fatto",
      },
    },
    {
      id: "wf-time-waster",
      pillarId: "workflow",
      sectionId: "workflow-daily",
      label:
        "Qual e l'attivita che ti fa perdere piu tempo ogni settimana?",
      description:
        "Descrivila con parole tue: e uno dei punti dove andremo a cercare i primi risultati.",
      answerType: "text",
      required: false,
    },
    // ───────────── ADOPTION — Quanto conosci l'AI ─────────────
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
      scaleAnchors: {
        min: "Mai sentite / non saprei spiegarle",
        max: "Le so spiegare a un collega",
      },
    },
    {
      id: "ad-know-limits",
      pillarId: "adoption",
      sectionId: "adoption-knowledge",
      label:
        "Sai quando NON fidarti delle risposte dell'AI?",
      description:
        "A volte l'AI inventa dati, nomi o fonti che sembrano veri ma non lo sono. Sapere quando controllare e un'abilita chiave.",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
      scaleAnchors: {
        min: "Pensavo ci si potesse sempre fidare",
        max: "So bene quando verificare e come",
      },
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
    // ───────────── ADOPTION — L'AI nel tuo lavoro di oggi ─────────────
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
        "Es. riesci a farle scrivere l'email giusta, riassumere il documento giusto, nel modo che volevi tu?",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
      scaleAnchors: {
        min: "Non saprei da dove cominciare",
        max: "Ottengo quasi sempre cio che mi serve",
      },
    },
    {
      id: "ad-beyond",
      pillarId: "adoption",
      sectionId: "adoption-usage",
      label:
        "Usi l'AI anche per cose fuori dalla tua specialita?",
      description:
        "Es. farti aiutare con un calcolo, una traduzione o un'analisi che prima avresti chiesto a un collega esperto.",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
      scaleAnchors: {
        min: "Mai provato",
        max: "Si, regolarmente",
      },
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
      scaleAnchors: {
        min: "Nessuno la usa",
        max: "La usano quasi tutti, ogni giorno",
      },
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
    // ───────────── ADOPTION — Cosa ne pensi ─────────────
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
      scaleAnchors: {
        min: "Mi preoccupa / preferirei evitarla",
        max: "Non vedo l'ora di usarla di piu",
      },
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
      scaleAnchors: {
        min: "Per il mio lavoro non serve",
        max: "Cambierebbe davvero le mie giornate",
      },
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
      scaleAnchors: {
        min: "Nessuna formazione ricevuta",
        max: "Molto utile e adatta a quello che faccio",
      },
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
    // ───────────── USE CASES — Idee e casi concreti ─────────────
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
      scaleAnchors: {
        min: "Non saprei proprio",
        max: "Ne ho gia in mente piu di una",
      },
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
      scaleAnchors: {
        min: "Mai provato niente",
        max: "Si, piu di un esperimento gia fatto",
      },
    },
    {
      id: "uc-channel",
      pillarId: "use_cases",
      sectionId: "use-cases-ideas",
      label:
        "Se hai un'idea per usare l'AI, sai a chi proporla in azienda?",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
      scaleAnchors: {
        min: "Non saprei a chi dirla",
        max: "C'e un percorso chiaro e le idee vengono ascoltate",
      },
    },
    {
      id: "uc-risk",
      pillarId: "use_cases",
      sectionId: "use-cases-ideas",
      label:
        "Riesci a riconoscere quando un uso dell'AI e delicato e va maneggiato con cura?",
      description:
        "Es. quando ci sono di mezzo dati personali, soldi, o decisioni che toccano le persone: li serve piu attenzione.",
      answerType: "scale",
      required: true,
      min: 0,
      max: 5,
      weight: 1,
      scaleAnchors: {
        min: "Non saprei distinguere",
        max: "Riconosco subito i casi delicati",
      },
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
    version: "ai-readiness-core-3",
    scale: { min: 0, max: 5 },
    readinessFormula: {
      weightedAverageWeight: 0.65,
      weakestPillarWeight: 0.35,
    },
  },
};
