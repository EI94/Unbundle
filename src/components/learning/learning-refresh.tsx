"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { confirmLearningNavigation } from "./use-unsaved-changes";

export function LearningRefresh({ label = "Aggiorna vista", className }: { label?: string; className?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <Button type="button" variant="outline" className={className ?? "h-10"} disabled={pending} aria-busy={pending} onClick={() => {
    if (confirmLearningNavigation()) startTransition(() => router.refresh());
  }}>{pending ? "Aggiornamento…" : label}</Button>;
}
