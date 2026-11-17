import { Download } from "lucide-react";
import type { ReferentQuestionView } from "@/lib/use-cases/referent/contract";
import { templateLinks } from "./public-view-render";

/**
 * («File da compilare») Sotto il titolo della domanda, a vista, senza aprire niente: «Scarica il file da compilare»,
 * con il nome e la dimensione. Il referente legge quasi solo il titolo: il link sta subito lì. Il file arriva sempre
 * come allegato; lo stesso file sta su ogni domanda a cui il team l'ha legato.
 */
export function TemplateDownloads({ token, question }: { token: string; question: Pick<ReferentQuestionView, "state" | "templates"> }) {
  const links = templateLinks(token, question);
  if (links.length === 0) return null;
  return (
    <ul data-slot="question-templates" className="space-y-2">
      {links.map((link) => (
        <li key={link.id} className="min-w-0">
          <a
            href={link.href}
            download
            aria-label={link.ariaLabel}
            className="inline-flex min-h-11 items-center gap-2 rounded-md text-base font-medium text-primary underline underline-offset-4 outline-none hover:no-underline focus-visible:ring-3 focus-visible:ring-ring/40"
          >
            <Download className="size-4 shrink-0" aria-hidden />
            {link.label}
          </a>
          <span className="block text-sm break-all text-muted-foreground">{link.detail}</span>
        </li>
      ))}
    </ul>
  );
}
