"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Switch } from "@/components/ui/switch";

const STORAGE_KEY = "unbundle-survey-theme";

/** Cursore light/dark per le pagine survey: applica .survey-light al wrapper. */
export function SurveyThemeToggle() {
  const [light, setLight] = useState(false);

  const apply = (next: boolean) => {
    setLight(next);
    document.getElementById("survey-root")?.classList.toggle("survey-light", next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "light" : "dark");
    } catch {}
  };

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "light") apply(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <label
      className="flex cursor-pointer items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs text-muted-foreground"
      data-testid="survey-theme-toggle"
    >
      <Moon className="size-3.5" />
      <Switch checked={light} onCheckedChange={apply} aria-label="Tema chiaro" />
      <Sun className="size-3.5" />
    </label>
  );
}
