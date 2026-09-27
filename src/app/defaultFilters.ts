import { endOfLocalDay, MAX_PERIOD_DAYS, startOfLocalDay, type Filters } from "../lib/aggregate";
import type { SessionRecord } from "../types";

export function defaultFilters(sessions: SessionRecord[], defaultPeriodDays?: number | null): Filters {
  if (sessions.length === 0) return {};
  const requestedPeriod = defaultPeriodDays ?? NaN;
  const period = Number.isFinite(requestedPeriod) && Number.isInteger(requestedPeriod) && requestedPeriod > 0 && requestedPeriod <= MAX_PERIOD_DAYS
    ? requestedPeriod
    : 30;
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  today.setDate(today.getDate() - period + 1);
  const from = startOfLocalDay(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`);
  const todayString = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return { from, to: endOfLocalDay(todayString) };
}
