/**
 * (8.0c) Sotto il nome di una persona di «Chi costruisce»: l'e-mail (per Lateral Space) e i fatti della riga (esterno,
 * ruolo, dove, la CLI), su una riga da 640 px in su, sotto il nome sul telefono.
 *
 * Le parole vanno a capo intere (`break-words`): solo l'e-mail, una parola sola e lunga, può andare a capo dove serve
 * (`break-all`). Con `break-all` su tutta la riga, a 390 px «Sviluppatore» e «collegata» si spezzavano a metà.
 */
export function BuilderFacts({ email, facts }: { email: string | null; facts: readonly string[] }) {
  return (
    <span className="block text-xs break-words text-muted-foreground sm:inline">
      <span className="hidden sm:inline"> · </span>
      {email ? (
        <>
          <span className="break-all">{email}</span>
          {facts.length ? " · " : null}
        </>
      ) : null}
      {facts.join(" · ")}
    </span>
  );
}
