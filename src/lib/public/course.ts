/**
 * (Rilascio 10, ondata 4 «Fuori», docs/ui-10/PROPOSTA-10.md §3.11 «Corso `/c`», audit Fuori §3.7) I testi della pagina
 * del link di un corso (`/c/<token>`) e del suo modulo d'ingresso (`src/components/learning/join-course-form.tsx`).
 *
 * Una card: H1 = il titolo del corso; una riga «Lunedì 24 novembre · 14:30–16:30 · con {formatore}»; un solo pulsante
 * pieno, «Entra con Google», e il link «Usa email e password»; la privacy in una frase più «Cosa viene registrato ▸».
 * Con l'ingresso chiuso la pagina controlla da sola ogni 10 secondi. Genere neutro, «AI», nessun codice.
 *
 * Modulo puro, senza import.
 */

/** Ogni quanti secondi la pagina con l'ingresso chiuso si rilegge da sola. */
export const COURSE_DOOR_CHECK_SECONDS = 10;

export const COURSE_LINK_TEXT = Object.freeze({
  /** L'anteprima del link in WhatsApp, Teams o in una mail. */
  preview: Object.freeze({
    title: "{Corso} — {Cliente}",
    description: "{Lezione} · {Quando}. Entra con il tuo account: bastano pochi secondi.",
    lesson: "Lezione",
    fallbackTitle: "Accesso al corso",
    fallbackDescription: "Il link per entrare in un corso.",
  }),
  /** «con Giulia Neri», nella riga della data. */
  withTrainer: "con {Formatore}",
  /** La privacy in una frase, sotto i pulsanti. */
  privacy: "Il formatore vede le tue risposte. L'azienda registra presenza ed esercizi consegnati, senza voti.",
  /** La piega con il resto, chiusa. */
  recorded: "Cosa viene registrato",
  recordedOnlyThis: "Questo accesso ti mostra solo questo corso, nessun'altra area dell'azienda.",
  recordedTrainer: "Il formatore vede le tue risposte agli esercizi e il tuo avanzamento. I risultati di gruppo partono da {N} persone, così nessuno è riconoscibile.",
  recordedRetention: "Le risposte restano conservate per {N} {giorni} dopo la chiusura del corso.",
  day: "giorno",
  days: "giorni",
  /** In fondo, il contatto. */
  helpTrainer: "Problemi a entrare? Chiedi a {Formatore}.",
  help: "Problemi a entrare? Chiedi al formatore.",
  /** Ingresso chiuso: la pagina si rilegge da sola. */
  waiting: "Ti facciamo entrare appena si apre la lezione.",
  /** Ingresso chiuso, senza il corso da mostrare. */
  closed: "La lezione non è ancora aperta",
  /** Chi è già nel corso rientra anche con un link chiuso, per gli esercizi. */
  returning: "Già nel corso?",
  returningLink: "Accedi e torna al corso",
  /** Un link che non vale più (sbagliato, tolto o scaduto): la scheda unica, con il testo per chi l'ha avuto in chat. */
  gone: "Chiedi al formatore il link nuovo.",
  goneCourse: "È il link di «{Corso}»: chiedi al formatore quello nuovo.",
  notFound: "Controlla di averlo copiato per intero, oppure chiedi al formatore di rimandartelo.",
  /** Gli altri stati: il link è giusto, ma per ora non si entra. */
  unavailable: Object.freeze({ title: "Il corso non è ancora pronto", body: "Riprova più tardi, oppure avvisa il formatore." }),
  full: Object.freeze({ title: "Posti esauriti", body: "Chiedi al formatore di aggiungerne o di darti un altro link: non hai perso niente." }),
  disabled: Object.freeze({ title: "Corso non disponibile", body: "La formazione non è attiva qui: avvisa il formatore." }),
  /** L'errore della pagina: la scheda unica con «Riprova». */
  error: "Non hai perso niente: se eri già nel corso, ci resti.",
});

/** Il modulo d'ingresso (`join-course-form.tsx`). */
export const COURSE_JOIN_TEXT = Object.freeze({
  google: "Entra con Google",
  useEmail: "Usa email e password",
  continueAs: "Entra nel corso come {Nome}",
  notMe: "Non sono io",
  name: "Nome e cognome",
  namePlaceholder: "Come ti chiami",
  email: "Email",
  password: "Password",
  register: "Crea l'account ed entra",
  login: "Entra nel corso",
  toLogin: "Ho già un account: accedi",
  toRegister: "Non ho un account: creane uno",
  nameNeeded: "Scrivi nome e cognome: compaiono nel registro della formazione.",
  browserTitle: "Apri il link nel browser",
  browserBody: "L'app da cui hai aperto il link non permette l'accesso con Google.",
  copy: "Copia l'indirizzo",
  copied: "Indirizzo copiato",
  copyFailed: "Copia non riuscita: seleziona l'indirizzo dalla barra del browser.",
  googleBlocked: "Questa app non permette di accedere con Google. Apri il link in Safari o Chrome.",
  googleFailed: "Accesso con Google non riuscito. Riprova.",
  emailFailed: "Accesso non riuscito. Controlla email e password.",
  sessionFailed: "Non è stato possibile aprire la sessione. Riprova ad accedere.",
  enrollFailed: "Non è stato possibile completare l'iscrizione. Riprova.",
  failed: "Qualcosa non ha funzionato. Riprova: nessuna delle tue risposte è andata persa.",
  progress: "Ti sto portando dentro al corso…",
  steps: Object.freeze({ account: "Account verificato", enroll: "Iscrizione alla lezione", open: "Apro il corso" }),
  stepDone: "fatto",
  retry: "Riprova",
  /** I messaggi di Firebase, in italiano: i nomi dei pulsanti sono quelli veri. */
  firebase: Object.freeze({
    "auth/email-already-in-use": "Questa email ha già un account. Usa la password che hai scelto allora, oppure entra con Google.",
    "auth/invalid-email": "Controlla l'indirizzo email.",
    "auth/weak-password": "Serve una password di almeno 6 caratteri.",
    "auth/user-not-found": "Nessun account con questa email: tocca «Non ho un account: creane uno».",
    "auth/wrong-password": "Password errata.",
    "auth/invalid-credential": "Email o password non corrette. Se è la prima volta, tocca «Non ho un account: creane uno».",
    "auth/too-many-requests": "Troppi tentativi. Aspetta un minuto e riprova.",
    "auth/network-request-failed": "Connessione interrotta. Controlla la rete e riprova: non hai perso nulla.",
    "auth/popup-closed-by-user": "Finestra chiusa prima di finire. Riprova.",
  } as Record<string, string>),
});

const DAY = (timezone: string) => new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "numeric", month: "long", timeZone: timezone });
const TIME = (timezone: string) => new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit", timeZone: timezone });

function capitalized(text: string): string {
  return text.charAt(0).toLocaleUpperCase("it-IT") + text.slice(1);
}

/** «Lunedì 24 novembre · 14:30–16:30»: la data una volta sola. Su due giorni, inizio e fine per intero. */
export function courseWhen(startsAt: string, endsAt: string, timezone: string): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const day = DAY(timezone);
  const time = TIME(timezone);
  const startDay = day.format(start);
  if (Number.isNaN(end.getTime())) return `${capitalized(startDay)} · ${time.format(start)}`;
  const endDay = day.format(end);
  if (startDay === endDay) return `${capitalized(startDay)} · ${time.format(start)}–${time.format(end)}`;
  return `${capitalized(startDay)} ${time.format(start)} – ${endDay} ${time.format(end)}`;
}

/** La riga sotto il titolo: la data e, se si sa, il formatore. */
export function courseLine(i: { startsAt: string; endsAt: string; timezone: string; trainerName: string | null }): string {
  const trainer = i.trainerName?.trim();
  return [courseWhen(i.startsAt, i.endsAt, i.timezone), trainer ? COURSE_LINK_TEXT.withTrainer.replace("{Formatore}", trainer) : null].filter(Boolean).join(" · ");
}

/** «… per 30 giorni dopo la chiusura del corso.» */
export function courseRetention(days: number): string {
  return COURSE_LINK_TEXT.recordedRetention.replace("{N}", String(days)).replace("{giorni}", days === 1 ? COURSE_LINK_TEXT.day : COURSE_LINK_TEXT.days);
}

/** Il contatto in fondo: il formatore per nome, se si sa. */
export function courseHelp(trainerName: string | null): string {
  const trainer = trainerName?.trim();
  return trainer ? COURSE_LINK_TEXT.helpTrainer.replace("{Formatore}", trainer) : COURSE_LINK_TEXT.help;
}
