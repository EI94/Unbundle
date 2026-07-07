"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { Switch } from "@/components/ui/switch";

const STORAGE_KEY = "unbundle-survey-theme";

let listeners: Array<() => void> = [];

function readTheme() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "light";
  } catch {
    return false;
  }
}

function subscribe(listener: () => void) {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

function setTheme(light: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, light ? "light" : "dark");
  } catch {}
  document
    .getElementById("survey-root")
    ?.classList.toggle("survey-light", light);
  for (const listener of listeners) listener();
}

/** Cursore light/dark per le pagine survey: applica .survey-light al wrapper. */
export function SurveyThemeToggle() {
  const light = useSyncExternalStore(subscribe, readTheme, () => false);

  // Allinea il wrapper alla preferenza salvata anche al primo paint client.
  if (typeof document !== "undefined") {
    document
      .getElementById("survey-root")
      ?.classList.toggle("survey-light", light);
  }

  return (
    <label
      className="flex cursor-pointer items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs text-muted-foreground"
      data-testid="survey-theme-toggle"
    >
      <Moon className="size-3.5" />
      <Switch checked={light} onCheckedChange={setTheme} aria-label="Tema chiaro" />
      <Sun className="size-3.5" />
    </label>
  );
}
