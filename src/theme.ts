// src/theme.ts
export type OS = "windows" | "macos" | "linux" | "unknown";

export function detectOS(): OS {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("mac")) return "macos";
  if (ua.includes("win")) return "windows";
  if (ua.includes("linux")) return "linux";
  return "unknown";
}

/// Apply OS and light/dark theme classes to <html>.
export function applyTheme(os: OS, mode: "system" | "light" | "dark") {
  const root = document.documentElement;
  root.classList.remove("os-windows", "os-macos", "os-linux");
  root.classList.add(`os-${os}`);
  const dark = mode === "dark" || (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.toggle("dark", dark);
}
