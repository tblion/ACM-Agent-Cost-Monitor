// Provides display labels and locale-aware ordering for dashboard values.
export function displayName(value: string): string {
  if (/^\/+$/u.test(value)) return "/";
  const windowsRoot = value.match(/^([A-Za-z]:)[\\/]+$/u);
  if (windowsRoot) return `${windowsRoot[1]}${value[value.length - 1]}`;

  const trimmedValue = value.replace(/[\\/]+$/, "");
  return trimmedValue.split(/[\\/]/).pop() ?? trimmedValue;
}

export function compareDisplayNames(left: string, right: string): number {
  return displayName(left).localeCompare(displayName(right), undefined, { sensitivity: "base" });
}

export function sortDisplayValues(values: string[]): string[] {
  return [...values].sort(compareDisplayNames);
}
