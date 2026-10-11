---
description: Compare model prices with official provider sources and update the embedded catalog only after approval
---

Update model prices for: $ARGUMENTS

If no provider or model filter was supplied, inspect every entry in `src-dotnet/Resources/pricing-source.json`. Otherwise, inspect only entries matching the requested provider and/or model filters; do not broaden the requested scope silently.

## Research and comparison

1. Read `src-dotnet/Resources/pricing-source.json` and identify the exact provider/model entries in scope, their existing versions, effective dates, source URLs, units, cache prices, and context tiers.
2. Research each requested model using the provider's official pricing documentation or official product documentation only. Cite the direct URL for each value and the date you accessed the source. Community catalogs, search snippets, forums, and third-party aggregators are not official evidence and must not establish a price.
3. Require an exact provider and model identifier match. Confirm model variants and any context-window or usage conditions before associating a price. Never infer a price from a nearby model, a family name, or an undocumented mapping.
4. Compare every supported price component: input, output, cache read, cache write, and any context threshold / above-threshold prices represented by the current schema. Record the currency and unit (the catalog expects USD per million tokens) and the published effective date when available. Distinguish unknown, unpublished, and not-applicable fields; do not convert currencies or invent cache prices.
5. If a source is inaccessible, anti-bot restricted, ambiguous, missing a required unit/currency, or does not establish the exact variant, mark that entry unverified and do not propose a new catalog value for it. You may report other independently verified entries in scope.

## Proposal first — no writes yet

Before changing any file, present a review table with one row per proposed change and:

- provider/model and exact official source URL, plus access date;
- current version/value and proposed value for every changed field;
- whether this is a new model or a new dated version, the effective date, and the evidence for that date;
- cache/context fields that are unknown, unpublished, or unchanged;
- ambiguities, regional/volume conditions, or other limitations;
- the historical consequence: existing dated versions remain in place, so historical messages continue to resolve against the price effective on their message date; no existing history is recalculated.

Also list entries inspected but skipped and why. If nothing can be verified, report the missing evidence and stop without editing. End by asking the user to approve this exact proposed diff. Do not edit either JSON, run a script that writes either JSON, or otherwise mutate files during this proposal phase. Wait for an explicit approval; silence or a request to inspect is not approval.

## After explicit approval only

1. Apply only the approved changes to `src-dotnet/Resources/pricing-source.json`. Preserve all prior dated versions and unrelated entries/metadata. Add a new model only when its exact identifier and pricing are verified. Use the official URL in `source`; use the published `effectiveFrom`, or ask the user to confirm a date if the source does not publish one. Never overwrite an older version to make the new price retroactive.
2. Show the resulting source-file diff and verify it contains only the approved changes. If the diff differs from the approved proposal, stop and request approval again.
3. Only after that diff is approved, run `npm run release:prepare`. This command validates the generated catalog before atomically replacing `src-dotnet/Resources/pricing.json`. Do not hand-edit the generated file. If validation or generation fails, report the failure and preserve the prior valid catalog; do not work around the validator.
4. Report the sources consulted, added/updated/skipped entries, effective dates, source diff, and validation result. State explicitly that no user database, cost history, or historical recalculation was touched. Never invoke application recalculation as part of this command.
