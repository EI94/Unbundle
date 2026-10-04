/**
 * Errori di Firebase Auth in italiano, per i moduli di accesso. Le webview
 * di WhatsApp, Teams, Instagram e LinkedIn bloccano la finestra di Google:
 * lì serve dire di aprire il link nel browser, non mostrare un codice.
 */

export const FIREBASE_AUTH_MESSAGES: Record<string, string> = {
  "auth/email-already-in-use": "Questa email ha già un account: accedi con la tua password, oppure con Google.",
  "auth/invalid-email": "Controlla l'indirizzo email.",
  "auth/weak-password": "Serve una password di almeno 6 caratteri.",
  "auth/user-not-found": "Nessun account con questa email.",
  "auth/wrong-password": "Password errata.",
  "auth/invalid-credential": "Email o password non corrette.",
  "auth/too-many-requests": "Troppi tentativi. Aspetta un minuto e riprova.",
  "auth/network-request-failed": "Connessione interrotta. Controlla la rete e riprova.",
  "auth/popup-closed-by-user": "Finestra di Google chiusa prima di finire. Riprova.",
  "auth/cancelled-popup-request": "Finestra di Google chiusa prima di finire. Riprova.",
  "auth/user-disabled": "Questo account è stato disattivato.",
};

/** Codici con cui la finestra di Google non può funzionare in questo browser. */
export const GOOGLE_NEEDS_REAL_BROWSER = new Set([
  "auth/popup-blocked",
  "auth/operation-not-supported-in-this-environment",
  "auth/web-storage-unsupported",
]);

export function firebaseErrorCode(err: unknown) {
  return err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
}

export function firebaseErrorMessage(err: unknown, fallback = "Accesso non riuscito. Riprova.") {
  return FIREBASE_AUTH_MESSAGES[firebaseErrorCode(err)] ?? fallback;
}

/** Browser interni delle app di messaggistica e social, riconosciuti dallo user agent. */
export function isInAppBrowser(userAgent: string) {
  return /WhatsApp|FBAN|FBAV|Instagram|LinkedInApp|Line\/|MicroMessenger|Teams\/|; wv\)/i.test(userAgent);
}
