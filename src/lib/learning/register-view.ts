/**
 * (Rilascio 10, ondata 7a «Formazione», docs/ui-10/PROPOSTA-10.md §3.9, audit Fuori §4.13) Il registro della
 * formazione AI in una frase di stato, al posto dei cinque controlli aperti: «In ordine», oppure che cosa manca, nel
 * loro ordine di importanza, e i fatti in una riga grigia. Le stesse regole di prima (i dati dell'azienda che mancano,
 * le iscrizioni senza partecipazione documentata, le lezioni concluse senza partecipanti, la copia da scaricare dopo
 * l'ultima lezione svolta). Il contenuto del registro, del PDF e dell'Excel non cambia. Modulo puro.
 */

export type RegisterFacts = {
  organization: { legalName: string | null; registerOwner: string | null; aiActRole: string | null; aiSystems: readonly string[]; useContext: string | null; trainers: string | null };
  companies: ReadonlyArray<{ domain: string; legalName: string | null }>;
  sessions: ReadonlyArray<{ state: string; endsAt: string }>;
  totals: { sessionsHeld: number; peopleAttended: number; undocumented: number; sessionsScheduled: number };
};

/** I dati dell'azienda che mancano, in parole: gli stessi di prima («ragione sociale», «referente del registro»…). */
export function missingCompanyFields(register: Pick<RegisterFacts, "organization" | "companies">): string[] {
  const org = register.organization;
  const multiCompany = register.companies.length > 1;
  return [
    !multiCompany && !org.legalName && "ragione sociale",
    ...(multiCompany ? register.companies.filter((company) => !company.legalName).map((company) => `ragione sociale per @${company.domain}`) : []),
    !org.registerOwner && "referente del registro",
    !org.aiActRole && "ruolo nell'uso dell'AI",
    !org.aiSystems.length && "sistemi di AI in uso",
    !org.useContext && "contesto d'uso",
    !org.trainers && "docenti",
  ].filter((field): field is string => typeof field === "string");
}

/** La copia più recente vale se è stata scaricata dopo la fine dell'ultima lezione svolta (o se non ce ne sono). */
export function copyIsCurrent(register: Pick<RegisterFacts, "sessions">, lastCopyAt: string | null): boolean {
  const lastHeldEnd = register.sessions.filter((session) => session.state === "svolta").map((session) => session.endsAt).sort().at(-1) ?? null;
  return Boolean(lastCopyAt && (!lastHeldEnd || lastCopyAt >= lastHeldEnd));
}

export type RegisterStatus = {
  tone: "verde" | "giallo" | "grigio";
  /** La frase: «In ordine», «Mancano 2 dati dell'azienda»… */
  sentence: string;
  /** Dove si sistema: l'ancora della piega che serve aprire, se c'è. */
  fix: "dati-azienda" | "presenze" | null;
};

/**
 * La frase di stato, in quest'ordine: i dati dell'azienda (compaiono in ogni copia), poi le presenze da registrare
 * (iscrizioni senza partecipazione documentata e lezioni concluse senza partecipanti), poi la copia da scaricare dopo
 * l'ultima lezione svolta; altrimenti «In ordine». Senza lezioni svolte, il registro aspetta la prima.
 */
export function registerStatus(register: RegisterFacts, lastCopyAt: string | null): RegisterStatus {
  const missing = missingCompanyFields(register).length;
  if (missing) return { tone: "giallo", sentence: missing === 1 ? "Manca un dato dell'azienda." : `Mancano ${missing} dati dell'azienda.`, fix: "dati-azienda" };
  const undocumented = register.totals.undocumented;
  const empty = register.sessions.filter((session) => session.state === "senza_partecipanti").length;
  if (undocumented) return { tone: "giallo", sentence: undocumented === 1 ? "Una presenza da controllare." : `${undocumented} presenze da controllare.`, fix: "presenze" };
  if (empty) return { tone: "giallo", sentence: empty === 1 ? "Una lezione conclusa senza partecipanti." : `${empty} lezioni concluse senza partecipanti.`, fix: "presenze" };
  if (register.totals.sessionsHeld === 0) return { tone: "grigio", sentence: "Nessuna lezione ancora svolta.", fix: null };
  if (!copyIsCurrent(register, lastCopyAt)) return { tone: "giallo", sentence: "Scarica una copia aggiornata.", fix: null };
  return { tone: "verde", sentence: "In ordine.", fix: null };
}

/** I fatti, in una riga grigia: lezioni svolte, persone, l'ultima copia. Lo zero non si mostra. */
export function registerFacts(register: Pick<RegisterFacts, "totals">, lastCopy: string | null): string {
  const { sessionsHeld, peopleAttended, sessionsScheduled } = register.totals;
  return [
    sessionsHeld ? (sessionsHeld === 1 ? "1 lezione svolta" : `${sessionsHeld} lezioni svolte`) : null,
    peopleAttended ? (peopleAttended === 1 ? "1 persona" : `${peopleAttended} persone`) : null,
    sessionsScheduled ? (sessionsScheduled === 1 ? "1 in programma" : `${sessionsScheduled} in programma`) : null,
    lastCopy ? `ultima copia ${lastCopy}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
