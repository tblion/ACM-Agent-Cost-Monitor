// Calculates fixed subscription charges for the selected calendar months.
import type { FixedSubscription } from "../types";

export function fixedCostForPeriod(
  subscriptions: FixedSubscription[],
  from?: number,
  to?: number,
  referenceTime = Date.now(),
): number {
  let total = 0;
  const rangeStart = from === undefined ? null : new Date(from);
  const rangeEnd = to === undefined ? new Date(referenceTime) : new Date(to);

  for (const subscription of subscriptions) {
    const activeStart = localDate(subscription.effectiveFrom);
    const activeEnd = subscription.effectiveTo ? localDate(subscription.effectiveTo, true) : new Date(referenceTime);
    const first = rangeStart && rangeStart > activeStart ? rangeStart : activeStart;
    const last = rangeEnd < activeEnd ? rangeEnd : activeEnd;
    if (first > last) continue;

    const month = new Date(first.getFullYear(), first.getMonth(), 1);
    const finalMonth = new Date(last.getFullYear(), last.getMonth(), 1);
    let months = 0;
    while (month <= finalMonth) {
      const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 0, 23, 59, 59, 999);
      if (month <= last && monthEnd >= first) months++;
      month.setMonth(month.getMonth() + 1);
    }
    total += months * (subscription.period === "annual" ? subscription.amount / 12 : subscription.amount);
  }

  return total;
}

function localDate(value: string, endOfDay = false): Date {
  const [year, month, day] = value.split("-").map(Number);
  return endOfDay
    ? new Date(year, month - 1, day, 23, 59, 59, 999)
    : new Date(year, month - 1, day);
}
