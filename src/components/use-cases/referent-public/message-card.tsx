import type { ReactNode } from "react";

/** Una scheda con titolo e testo: i link che non si possono usare, la fine, il ringraziamento. */
export function MessageCard({
  title,
  text,
  children,
  titleId,
  as: Heading = "h1",
}: {
  title: string;
  text?: ReactNode;
  children?: ReactNode;
  titleId?: string;
  as?: "h1" | "h2";
}) {
  return (
    <section className="mt-8 rounded-xl bg-card p-6 text-card-foreground ring-1 ring-foreground/10" aria-labelledby={titleId}>
      <Heading id={titleId} tabIndex={titleId ? -1 : undefined} className="text-xl font-semibold break-words outline-none">
        {title}
      </Heading>
      {text ? <div className="mt-3 space-y-2 text-base leading-7 break-words text-muted-foreground">{text}</div> : null}
      {children}
    </section>
  );
}
