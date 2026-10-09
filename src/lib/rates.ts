// Provides stable provider/model keys and pricing comparison helpers.
export const rateKey = (provider: string, model: string) => `${provider}\u0000${model}`;

export const isConfiguredRate = (configuredKeys: Set<string>, provider: string, model: string) =>
  configuredKeys.has(rateKey(provider, model));

export const getFocusTrapTarget = (
  focusables: readonly HTMLElement[],
  activeElement: Element | null,
  backwards: boolean,
) => {
  if (focusables.length === 0) return null;

  const activeIndex = activeElement ? focusables.indexOf(activeElement as HTMLElement) : -1;
  if (backwards) return activeIndex <= 0 ? focusables[focusables.length - 1] : null;
  return activeIndex === -1 || activeIndex === focusables.length - 1 ? focusables[0] : null;
};
