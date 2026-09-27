import type { RateEntry } from "../types";

export interface DemoModelPricing {
  provider: string;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export const DEMO_PRICING: DemoModelPricing[] = [
  { provider: "Anthropic", model: "claude-sonnet-4-6", input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  { provider: "Anthropic", model: "claude-haiku-4-5", input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  { provider: "OpenAI", model: "gpt-5.4", input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 0 },
  { provider: "OpenAI", model: "gpt-5.4-mini", input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: 0 },
  { provider: "OpenAI", model: "gpt-4.1", input: 2, output: 8, cacheRead: 0.5, cacheWrite: 0 },
  { provider: "Mistral", model: "mistral-medium-3.5", input: 1.5, output: 7.5, cacheRead: 0.15, cacheWrite: 0 },
  { provider: "Mistral", model: "mistral-small-4", input: 0.15, output: 0.6, cacheRead: 0.015, cacheWrite: 0 },
  { provider: "Mistral", model: "codestral", input: 0.3, output: 0.9, cacheRead: 0.03, cacheWrite: 0 },
];

export const DEMO_HISTORICAL_PRICING: DemoModelPricing[] = [
  { provider: "Anthropic", model: "claude-3-5-sonnet-20241022", input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  { provider: "Anthropic", model: "claude-3-haiku-20240307", input: 0.25, output: 1.25, cacheRead: 0.03, cacheWrite: 0.3 },
  { provider: "OpenAI", model: "gpt-4o", input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 0 },
  { provider: "OpenAI", model: "gpt-4o-mini", input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0 },
  { provider: "OpenAI", model: "o1-mini", input: 3, output: 12, cacheRead: 1.5, cacheWrite: 0 },
  { provider: "Mistral", model: "mistral-large-2", input: 2, output: 6, cacheRead: 0.2, cacheWrite: 0 },
  { provider: "Mistral", model: "ministral-8b-latest", input: 0.1, output: 0.1, cacheRead: 0.01, cacheWrite: 0 },
  { provider: "Mistral", model: "pixtral-large-latest", input: 2, output: 6, cacheRead: 0.2, cacheWrite: 0 },
];

export const DEMO_RATES: RateEntry[] = DEMO_PRICING.map(pricing => ({
  ...pricing,
  source: "catalog",
  effectiveFrom: null,
}));
