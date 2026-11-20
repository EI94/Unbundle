/**
 * (Rilascio 10, ondata 4 «Fuori», docs/ui-10/PROPOSTA-10.md §3.11 «Login», audit Fuori §3.1) I testi della pagina
 * d'accesso (`/login`) e del suo modulo (`src/components/auth/login-form.tsx`): H1 «Accedi a Unbundle» anche al telefono,
 * «Privacy» e non «Privacy Policy», la sessione scaduta in una riga, l'avviso dell'app di chat più corto, «Mandami il link
 * per la password». Niente «login» né «reset» a schermo; genere neutro. Modulo puro, senza import.
 */
export const LOGIN_TEXT = Object.freeze({
  metaTitle: "Accedi",
  metaDescription: "Accedi a Unbundle.",
  title: "Accedi a Unbundle",
  /** Da un invito, una riga sotto il titolo. */
  fromInvite: "Poi torni all'invito.",
  /** La sessione scaduta o revocata (`?session=stale`), in una riga. */
  stale: "Sessione scaduta: accedi di nuovo.",
  /** In fondo: i termini e la privacy. */
  terms: "Accedendo accetti i",
  termsLink: "Termini di servizio",
  and: "e la",
  privacyLink: "Privacy",
  form: Object.freeze({
    inApp: "Dentro un'app come WhatsApp o Teams l'accesso con Google spesso non si apre: apri il link nel browser, oppure usa email e password.",
    copy: "Copia il link",
    copied: "Link copiato: incollalo nel browser",
    google: "Continua con Google",
    or: "oppure",
    name: "Nome",
    namePlaceholder: "Nome e cognome",
    email: "Email",
    emailPlaceholder: "tu@azienda.com",
    password: "Password",
    /** Solo per un account nuovo: per accedere è rumore. */
    passwordPlaceholder: "Almeno 6 caratteri",
    login: "Accedi",
    register: "Crea account",
    reset: "Mandami il link per la password",
    toRegister: "Non hai un account? Registrati",
    forgot: "Password dimenticata?",
    toLogin: "Hai già un account? Accedi",
    back: "Torna all'accesso",
    resetSent: "Ti abbiamo mandato il link per la password: controlla la posta.",
    wrong: "Email o password non corrette.",
    suggestRegister: "Primo accesso? Crea l'account con questa email",
    googleBlocked: "Questo browser non apre la finestra di Google. Apri il link in Safari o Chrome, oppure usa email e password qui sotto.",
    googleFailed: "Accesso con Google non riuscito. Riprova.",
    failed: "Accesso non riuscito. Riprova.",
    session: "Non è stato possibile aprire la sessione. Riprova.",
    loading: "Caricamento…",
  }),
});
