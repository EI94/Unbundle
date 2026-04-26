/**
 * Copy SEO/GEO della homepage in un punto solo, così:
 * - i tag visibili e i JSON-LD non possono divergere
 * - llms.txt e llms-full.txt si rigenerano dalle stesse stringhe
 */

export const HOME_HERO = {
  eyebrow:
    "L'AI sta cambiando le condizioni in cui opera la tua organizzazione.",
  h1Top: "Capiremo dove si sposta",
  h1Mid: "il valore",
  h1MidEnd: " e cosa significa",
  h1End: "per te.",
  lead:
    "Unbundle scompone il lavoro della tua organizzazione, identifica dove l'AI trasforma il modo di generare valore, e costruisce il piano per arrivarci.",
  cta: "Inizia",
} as const;

/** I tre stream — fondamento del framework. */
export const STREAMS = [
  {
    key: "automate",
    title: "Automate",
    summary:
      "Le attività commodity, ripetitive, regola-base. L'AI le esegue al posto delle persone con guardrail e supervisione misurata.",
    bullets: [
      "Compliance, dati, ticketing, riconciliazioni",
      "Agenti con tool, monitoring e human-in-the-loop",
      "FTE liberati e quality KPI in salita",
    ],
  },
  {
    key: "differentiate",
    title: "Differentiate",
    summary:
      "Le attività dove le persone fanno la differenza. L'AI le aumenta — non le sostituisce — alzando la soglia di qualità e velocità.",
    bullets: [
      "Decisioni complesse, relazione cliente, creatività",
      "Copilot specializzati, knowledge base contestuale",
      "Talento concentrato dove conta davvero",
    ],
  },
  {
    key: "innovate",
    title: "Innovate",
    summary:
      "Quello che prima non era possibile. L'AI apre nuove categorie di prodotto, di servizio o di modello operativo.",
    bullets: [
      "Servizi nativamente AI, esperienze personalizzate scalabili",
      "Nuovi P&L, nuovi clienti, nuove asset class",
      "Bet strategici da incubare con metriche dedicate",
    ],
  },
] as const;

/** I 4 step del journey, mostrati sulla home come "Come funziona". */
export const JOURNEY_STEPS = [
  {
    n: "01",
    title: "Discovery",
    body:
      "Una conversazione AI con la leadership ricostruisce la value thesis dell'azienda, le unit di analisi e gli obiettivi strategici. La piattaforma fa anche web search sul vostro settore prima di rispondere.",
  },
  {
    n: "02",
    title: "Activity Mapping",
    body:
      "Per ogni funzione mappiamo le attività: Input, Processo, Output, Decisione, Eccezione. La tassonomia poi viene matchata su O*NET e arricchita con una stima di AI exposure ispirata all'Anthropic Economic Index.",
  },
  {
    n: "03",
    title: "Use Case Portfolio",
    body:
      "L'AI propone use case prioritizzati, scorati su Impatto e Fattibilità (più ESG opzionale). I KPI sono custom per workspace. Si aggiungono use case bottom-up via bot Slack — best practice o iniziative AI — già pronti per la review.",
  },
  {
    n: "04",
    title: "Plan & Execute",
    body:
      "Quick win, strategic bet, capability builder, not yet. Per ognuno: blueprint dell'agente, simulazione di tre scenari, value map alla Wardley e report executive in italiano. Pronto per il board.",
  },
] as const;

/** A chi serve. */
export const PERSONAS = [
  {
    title: "Exec sponsor",
    body:
      "Allinea il board sulla AI strategy con un linguaggio operativo, non slide. Misura il ritorno per stream.",
  },
  {
    title: "Transformation lead",
    body:
      "Coordina mapping, scoring e portfolio review senza fogli Excel paralleli. Tutto è auditabile.",
  },
  {
    title: "Function lead",
    body:
      "Mappa la propria funzione in conversazione, propone use case e li lascia scorare con KPI condivisi.",
  },
] as const;

/** Differenziatori rispetto ai consulenti tradizionali. */
export const DIFFERENTIATORS = [
  {
    title: "Conversazionale, non template",
    body:
      "Niente questionari. La piattaforma fa interview con tool calling reali: salva value thesis, attività, KPI man mano che parli.",
  },
  {
    title: "Italiano nativo",
    body:
      "Prompt, RAG (tsvector italiano), report e UI sono in italiano. Pensato per aziende italiane, ma multi-lingua ready.",
  },
  {
    title: "Bottom-up via Slack",
    body:
      "Ogni dipendente con accesso Slack può proporre best practice o use case AI in 6-8 campi. Il bot guida con Block Kit, l'admin riceve la notifica e scora con KPI custom.",
  },
  {
    title: "Auditabile e self-host friendly",
    body:
      "Postgres, Drizzle, RAG con full-text search Italian, tutti i prompt in repo. Dati e modelli sotto controllo.",
  },
] as const;

/** FAQ — visibili in pagina + emesse come FAQPage JSON-LD. */
export const FAQS: Array<{ q: string; a: string }> = [
  {
    q: "Cos'è Unbundle?",
    a: "Unbundle è una piattaforma di AI Transformation per aziende mid e large. Conduce un'intervista AI con la leadership, mappa le attività di ogni dipartimento, classifica ogni attività in Automate / Differentiate / Innovate, genera use case prioritizzati e raccoglie contributi bottom-up tramite un bot Slack. Output finale: portfolio, blueprint di agenti, simulazioni e report executive.",
  },
  {
    q: "Come si distingue dai consulenti tradizionali?",
    a: "Niente template Excel: la piattaforma è conversazionale, l'AI fa intervista con tool calling che scrivono direttamente nel database. Tutto resta auditabile e riusabile, e i contributi bottom-up arrivano via Slack — non via email.",
  },
  {
    q: "Cosa significano Automate, Differentiate, Innovate?",
    a: "Automate sono le attività commodity dove l'AI esegue (con guardrail). Differentiate sono attività dove le persone fanno la differenza e l'AI le aumenta. Innovate sono cose che prima non erano possibili: nuovi prodotti, servizi o modelli operativi nativamente AI.",
  },
  {
    q: "Come funziona la classificazione delle attività?",
    a: "Dopo la mapping di ogni dipartimento, un batch classifier AI assegna automaticamente Automate, Differentiate o Innovate con confidence score. In parallelo, ogni attività viene matchata sui task O*NET e riceve una stima di AI exposure ispirata all'Anthropic Economic Index.",
  },
  {
    q: "Come funziona lo scoring degli use case?",
    a: "Ogni workspace parte con KPI di default su Impatto, Fattibilità (e ESG se attivo) ma può ridefinirli completamente: aggiungere KPI, cambiare i pesi e le soglie. Lo score complessivo determina il quadrante: quick win, strategic bet, capability builder o not yet.",
  },
  {
    q: "Cosa fa l'integrazione Slack?",
    a: "Dopo l'OAuth, ogni dipendente può menzionare il bot o scrivere in DM. L'agente capisce se sta proponendo una best practice (6 campi) o uno use case AI (8 campi), guida la compilazione e pubblica un riepilogo Block Kit con bottoni Conferma e Modifica. Quando l'utente conferma, l'idea entra nel portfolio in stato proposed e l'admin riceve notifiche su Slack, in-app e (opzionale) WhatsApp.",
  },
  {
    q: "I dati restano controllabili?",
    a: "Sì. Database Postgres (Neon o self-hosted), tutti i prompt in repo, RAG con tsvector italiano. La piattaforma è multi-tenant: organizzazioni, membership con ruoli e workspace separati. I token Slack sono cifrati e mai esposti al frontend.",
  },
  {
    q: "Quali modelli AI usa Unbundle?",
    a: "La piattaforma è costruita su provider LLM enterprise con modelli configurabili. Per la Discovery usa web search controllata. La RAG è basata su Postgres tsvector full-text search in italiano, non su embedding vettoriali — più veloce, più ispezionabile e zero vendor lock-in sull'embedder.",
  },
];

export const HOMEPAGE_TITLE =
  "Unbundle — AI Transformation per aziende che vogliono ridisegnare il lavoro";

export const HOMEPAGE_DESCRIPTION =
  "Scompone il lavoro, mappa dove l'AI sposta il valore, prioritizza use case su impatto e fattibilità e raccoglie contributi bottom-up via Slack. Per leadership che vogliono trasformare l'organizzazione, non solo automatizzarla.";
