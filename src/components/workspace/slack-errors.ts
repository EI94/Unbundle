/**
 * Gli errori del collegamento con Slack (`?slack_error=` del ritorno da Slack), per chi gestisce l'app Slack di Unbundle
 * (rilascio 10, ondata 6b: solo Lateral Space li vede, in «Dettagli tecnici»; a tutti gli altri una frase sola).
 *
 * Modulo puro e senza import.
 */

/** Il codice dell'errore com'è arrivato nell'indirizzo, decodificato; "" senza. */
export function decodeSlackErrorParam(raw: string | undefined): string {
  if (!raw) return "";
  try {
    return decodeURIComponent(raw.replace(/\+/g, " "));
  } catch {
    return raw;
  }
}

/** Che cosa fare, per chi gestisce l'app Slack, per gli errori che si riconoscono; null per gli altri. */
export function slackInstallErrorHint(decoded: string): string | null {
  const t = decoded.toLowerCase();
  if (t.includes("bad_client_secret")) {
    return (
      "Il valore di SLACK_CLIENT_SECRET su Vercel non corrisponde al Client Secret dell'app Slack " +
      "(oppure è vuoto o di un'altra app). Apri https://api.slack.com/apps → seleziona l'app Unbundle → " +
      "Basic Information → App Credentials → copia «Client Secret» e in Vercel (Project → Settings → " +
      "Environment Variables) imposta SLACK_CLIENT_SECRET per Production, salva e fai Redeploy. " +
      "Se hai rigenerato il secret in Slack, il vecchio su Vercel non funziona più."
    );
  }
  if (t.includes("did not match any configured") || t.includes("bad_redirect_uri") || t.includes("redirect_uri")) {
    return (
      "L'URL di callback non è nella lista Slack. Vai su api.slack.com/apps → la tua app → OAuth & Permissions → " +
      "Redirect URLs e aggiungi esattamente l'URL che vedi nell'errore (host + /api/slack/oauth). " +
      "Se installi da un deploy Vercel preview (es. *.vercel.app), quell'host va aggiunto in aggiunta a " +
      "produzione (www.theunbundle.com / theunbundle.com). Slack non accetta wildcard: ogni dominio preview usato va elencato, oppure testa Slack solo da produzione."
    );
  }
  return null;
}
