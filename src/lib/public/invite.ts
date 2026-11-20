/**
 * (Rilascio 10, ondata 4 «Fuori», docs/ui-10/PROPOSTA-10.md §3.11 «Invito», audit Fuori §3.2) I testi dell'invito in un
 * workspace (`/invite/<token>`) e dei suoi pezzi (`src/components/workspace/workspace-invite-accept-form.tsx`,
 * `verify-invite-email.tsx`): H1 «{Organizzazione} ti invita in {workspace}», «Ruolo: … · valido fino al 25 novembre»,
 * «Cosa potrai fare ▸» chiusa, i ruoli con «caso d'uso» (`ROLE_INFO_OUTSIDE`), niente «Firebase» a schermo, testi corti
 * per «già dentro» e «non disponibile». Genere neutro. Modulo puro, senza import.
 */
export const INVITE_TEXT = Object.freeze({
  metaTitle: "Invito",
  title: "{Organizzazione} ti invita in {Workspace}",
  roleLine: "Ruolo: {Ruolo} · valido fino al {Data}",
  canDo: "Cosa potrai fare",
  onlyThis: "Vedrai solo {Workspace}, non il resto dell'organizzazione.",
  learner: "Ora segui un corso qui. Accettando diventi {Ruolo} e continui a seguire i tuoi corsi.",
  collaborator: "collaboratore",
  reserved: "L'invito è per {Email}: entra con quella email.",
  register: "Crea il tuo account",
  login: "Ho già un account",
  after: "Dopo l'accesso torni qui.",
  account: "Account: {Email}",
  notYou: "Non sei tu? Usa un altro account",
  wrongAccount: "Hai fatto l'accesso con {Sessione}, ma l'invito è per {Invito}: esci e rientra con quella email.",
  alreadyThere: "Con questo account sei già in {Workspace}:",
  openIt: "aprilo",
  askLink: "Oppure chiedi a chi ti ha mandato l'invito un link per {Email}.",
  accept: "Accetta ed entra in {Workspace}",
  accepting: "Ti porto nel workspace…",
  /** Chi ha già accesso. */
  already: Object.freeze({
    title: "Sei già in {Workspace}",
    body: "Ci sei come {Ruolo}: questo invito non cambia il tuo ruolo. Per un altro ruolo, chiedi a chi gestisce il workspace.",
    open: "Apri {Workspace}",
  }),
  /** L'invito che non si può usare: la scheda unica «Questo link non vale più.», con il motivo in una frase. */
  gone: Object.freeze({
    invalid: "Controlla di averlo copiato per intero, oppure chiedi a chi ti ha mandato l'invito di rimandartelo.",
    expired: "Gli inviti valgono 7 giorni: chiedi a chi ti ha mandato l'invito un link nuovo.",
    revoked: "Chi ti ha mandato l'invito l'ha annullato: se ti serve, chiedi un link nuovo.",
    used: "Ogni invito vale per una persona. Se l'hai usato tu, trovi il workspace tra i tuoi.",
  }),
  workspaces: "Vai ai tuoi workspace",
  /** La conferma dell'email per un invito riservato (accesso con email e password). */
  verify: Object.freeze({
    title: "Conferma la tua email per entrare",
    body: "L'invito è per {Email}. Prima di entrare conferma che la casella è tua: ti mandiamo un link.",
    mismatch: "In questo browser hai fatto l'accesso con un'altra email ({Altra}). Esci e rientra con {Email} per confermarla.",
    newLogin: "Per mandare il link serve un nuovo accesso da questo browser: esci e rientra con {Email}.",
    send: "Mandami il link di conferma",
    sending: "Invio in corso…",
    already: "Ho già confermato",
    confirmed: "Ho confermato",
    checking: "Controllo…",
    resend: "Rimanda il link",
    sent: "Ti abbiamo scritto a {Email}. Apri il link nella mail, poi torna qui e tocca «Ho confermato».",
    sendFailed: "Invio non riuscito. Riprova tra un minuto.",
    notYetIdle: "Non risulta ancora confermata: mandati il link qui sopra e aprilo dalla mail.",
    notYet: "Non risulta ancora confermata. Apri il link nella mail e riprova.",
    received: "Conferma ricevuta: aggiorno la pagina…",
    refreshFailed: "Non è stato possibile aggiornare l'accesso. Ricarica la pagina e riprova.",
    google: "Con «Continua con Google» la conferma non serve.",
  }),
});

/** «25 novembre»: la scadenza dell'invito, a Roma (un invito vale 7 giorni: l'anno non serve). */
export function inviteDay(date: Date): string {
  return new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", day: "numeric", month: "long" }).format(date);
}

/** Riempie «{Workspace}» e simili; un segnaposto senza valore resta com'è. */
export function fillInvite(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (Object.hasOwn(values, key) ? values[key] : whole));
}
