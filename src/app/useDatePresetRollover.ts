// Keeps selected rolling and calendar presets aligned with the local date.
import { useEffect } from "react";
import { dateRangeForPreset, type DatePreset, type Filters } from "../lib/aggregate";

export function useDatePresetRollover(
  preset: DatePreset | undefined,
  setFilters: React.Dispatch<React.SetStateAction<Filters>>,
): void {
  useEffect(() => {
    if (!preset || preset === "custom" || preset === "allTime") return;

    let timeout: ReturnType<typeof setTimeout>;
    const scheduleNextDay = () => {
      const nextDay = new Date();
      nextDay.setHours(24, 0, 0, 20);
      timeout = setTimeout(() => {
        setFilters(current => {
          if (current.datePreset !== preset) return current;
          const range = dateRangeForPreset(preset);
          return current.from === range.from && current.to === range.to
            ? current
            : { ...current, ...range };
        });
        scheduleNextDay();
      }, Math.max(1, nextDay.getTime() - Date.now()));
    };

    scheduleNextDay();
    return () => clearTimeout(timeout);
  }, [preset, setFilters]);
}
