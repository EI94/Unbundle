"use client";

import type { ReactNode } from "react";
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CONTEXT_TEXT } from "@/lib/context/text";

/**
 * Il pannello di «Contesto» (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §7.6): a destra sullo schermo largo,
 * a tutto schermo sul telefono. Titolo, contenuto che scorre, piede facoltativo, «Chiudi» in italiano.
 */
export function ContextSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" showCloseButton={false} className="gap-0 overflow-hidden data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
        <SheetHeader className="border-b pr-14 pt-[max(1rem,env(safe-area-inset-top))]">
          <SheetTitle className="text-base font-semibold break-words">{title}</SheetTitle>
          {description ? <SheetDescription className="break-words">{description}</SheetDescription> : null}
          <SheetClose render={<Button variant="ghost" size="icon" className="absolute top-[max(0.75rem,env(safe-area-inset-top))] right-3 size-11 sm:size-8" />}>
            <XIcon aria-hidden />
            <span className="sr-only">{CONTEXT_TEXT.ask.close}</span>
          </SheetClose>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain p-4">{children}</div>
        {footer ? <SheetFooter className="mt-0 border-t pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</SheetFooter> : null}
      </SheetContent>
    </Sheet>
  );
}
