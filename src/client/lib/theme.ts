import { useEffect, useState } from "react";
import type { Mode, Theme } from "./models.js";

const themes: Theme[] = ["lavender", "mint", "sky", "amber", "rose", "graphite"];
const modes: Mode[] = ["system", "light", "dark"];

function stored<T extends string>(key: string, values: readonly T[], fallback: T): T {
  const value = localStorage.getItem(key) as T | null;
  return value && values.includes(value) ? value : fallback;
}

export function useTheme(): {
  theme: Theme;
  mode: Mode;
  setTheme: (theme: Theme) => void;
  setMode: (mode: Mode) => void;
  themes: Theme[];
  modes: Mode[];
} {
  const [theme, setTheme] = useState<Theme>(() => stored("tuniku-theme", themes, "lavender"));
  const [mode, setMode] = useState<Mode>(() => stored("tuniku-mode", modes, "system"));

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = mode === "system" ? (query.matches ? "dark" : "light") : mode;
      document.documentElement.dataset.theme = theme;
      document.documentElement.dataset.mode = mode;
      document.documentElement.dataset.resolvedMode = resolved;
      document.documentElement.style.colorScheme = resolved;
      localStorage.setItem("tuniku-theme", theme);
      localStorage.setItem("tuniku-mode", mode);
    };
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [theme, mode]);

  return { theme, mode, setTheme, setMode, themes, modes };
}
