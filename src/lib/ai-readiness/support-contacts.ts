/**
 * Il campo supportEmail dell'assessment può contenere più indirizzi separati da
 * virgola (es. il referente interno del cliente e il nostro). Qui li separiamo
 * per costruire un mailto valido (RFC 6068 vuole la lista senza spazi) e una
 * resa leggibile per chi compila.
 */
export function parseSupportContacts(raw: string | null | undefined) {
  const emails = (raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.includes("@"));
  if (emails.length === 0) return null;
  return {
    emails,
    /** Destinatari per href="mailto:…" */
    mailto: `mailto:${emails.join(",")}`,
    /** "a@x.it" oppure "a@x.it o b@y.it" oppure "a@x.it, b@y.it o c@z.it" */
    label:
      emails.length === 1
        ? emails[0]
        : `${emails.slice(0, -1).join(", ")} o ${emails[emails.length - 1]}`,
  };
}
