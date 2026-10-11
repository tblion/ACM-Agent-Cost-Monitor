# Comparaison des sources de tarifs — plan d’implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Comparer plusieurs propositions de tarifs à l’usage et d’abonnements dans la section Tarifs, sans appliquer une proposition avant sélection et confirmation.

**Architecture:** Le backend récupère/normalise des candidats depuis des sources distantes au moyen d’adaptateurs isolés. Les candidats incluent la provenance, la fraîcheur, la correspondance et les motifs de confiance ; ils restent séparés des tarifs actifs tant que l’utilisateur ne les a pas appliqués explicitement.

**Tech Stack:** React/TypeScript, Electron IPC/JSON Lines, .NET 10 `HttpClient`, Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-10-11-model-pricing-management-design.md`

## Global Constraints

- Aucune source ne remplace silencieusement le prix actif ; prévisualiser les différences et demander confirmation.
- Les prix publics d’abonnement sont des références et ne remplacent pas le montant réellement payé.
- Ne transmettre aux sources distantes que des identifiants publics, jamais les sessions ou historiques utilisateur.
- Source manquante, erreur ou correspondance incertaine ne doit pas effacer les données locales valides.
- Les tests C# restent désactivés temporairement ; validation via E2E Playwright ou MCP/API autorisés.
- Accessibilité WCAG 2.2 / RGAA 4.1.2 et traductions FR/EN.

## Review Focus

- Page distante indisponible, HTTP erreur ou réponse non JSON : afficher l’état de cette source et conserver les candidats des autres ; E2E avec serveur mock en erreur.
- Modèle similaire mais variante/context window différent : ne pas l’associer automatiquement ; E2E de correspondance ambiguë.
- Tarifs de même offre en régions/devises différentes : ne pas comparer comme équivalents sans indication ; E2E de différences de devise/région.
- Source renvoyant un champ prix nul/absent : distinguer gratuit de non communiqué ; E2E sur ces deux états.
- Abonnement en promotion ou taxes exclues : afficher les conditions et ne pas remplacer le montant payé ; E2E avec tarif public conditionnel.

---

## Structure des fichiers

- Create `src-dotnet/Models/PricingCandidate.cs` : résultat normalisé et provenance.
- Create `src-dotnet/Application/PricingComparisonService.cs` : coordination des adaptateurs et comparaison.
- Create `src-dotnet/Application/PricingSources/` adaptateurs sélectionnés après recherche de couverture/conditions.
- Modify `src-dotnet/Protocol/OperationDispatcher.cs`, Electron main/preload/API : opérations de recherche et application explicite.
- Modify `src/types.ts`, `src/api.ts`, `src/data-source.ts`, `src/mock/desktop-mock.ts` : contrat renderer/mock.
- Create ou modify composants dans `src/components/pricing/` et intégrer dans `SettingsModal`.
- Modify `src/i18n/resources.ts`; add fixtures/scenarios in `e2e/settings.spec.ts`.

## Tâches

### Task 1 : Choix vérifié des premières sources

**Files:**
- Modify: `docs/superpowers/specs/2026-10-11-model-pricing-management-design.md` si le périmètre des connecteurs doit être clarifié avant codage.

- [ ] **Step 1: Évaluer les sources candidates**

Comparer, pour les tarifs modèle et abonnements, deux sources ou plus évoquées (sites officiels, OpenRouter, LiteLLM ou alternatives) : accès automatisable sans secrets, couverture, structure, devise/région, fraîcheur, conditions d’utilisation et type de source.

- [ ] **Step 2: Consigner les sources retenues et exclusions**

Retenir uniquement celles qui fournissent un contenu identifiable et licite à récupérer ; distinguer sources officielles et agrégateurs. Si moins de deux sources couvrent un même modèle/offre, afficher simplement les candidats disponibles plutôt que fabriquer une comparaison.

### Task 2 : Contrat des candidats et adaptateurs

**Files:**
- Create: `src-dotnet/Models/PricingCandidate.cs`
- Create: `src-dotnet/Application/PricingComparisonService.cs`
- Create: `src-dotnet/Application/PricingSources/`
- Modify: `src-dotnet/Protocol/OperationDispatcher.cs`
- Test: `e2e/settings.spec.ts`

**Interfaces:**
- `PricingCandidate`: source id/type/name/url, `retrievedAt`, `effectiveFrom` si publiée, provider/model ou nom d’offre/formule, region, currency, unité/période, champs prix connus, match status et liste de raisons de confiance.
- `get_pricing_candidates({ keys: PricingLookupKey[] }) -> PricingComparisonResult` accepte des clés modèle ou offre ; réponse contient les résultats indépendants et statuts/erreurs par source.
- `apply_pricing_candidates({ selections: PricingCandidateSelection[] }) -> Settings` reçoit seulement les candidats sélectionnés explicitement et utilise les interfaces de persistance définies par `2026-10-11-pricing-settings-and-history.md`.

- [ ] **Step 1: Construire des fixtures E2E locales pour candidat officiel, agrégateur et erreur isolée**

Fixture officielle avec modèle exact et date ; fixture agrégateur avec variante approchante ; source indisponible. Vérifier correspondance, type de source et erreurs indépendantes.

- [ ] **Step 2: Ajouter le contrat normalisé et les adaptateurs HTTP**

Chaque adaptateur reçoit une clé de modèle/offre, retourne uniquement des prix explicitement publiés et une source URL vérifiable. N’inférer aucun tarif et ne demander aucun identifiant utilisateur.

- [ ] **Step 3: Calculer une confiance textuelle explicable**

Produire raisons par source officielle/agrégateur, fraîcheur, correspondance exacte/région/unité et accord inter-sources. Pas de score numérique opaque ; conserver les faits bruts séparément de l’étiquette qualitative.

- [ ] **Step 4: Vérifier les états indépendants en E2E**

Run: `npm run test:e2e -- e2e/settings.spec.ts`
Expected: résultats valides visibles même si une autre source échoue ; aucun candidat ambigu n’est associé silencieusement.

### Task 3 : Comparateur tarifs à l’usage et abonnements

**Files:**
- Modify/Create: `src/components/pricing/PricingComparison.tsx`
- Modify/Create: `src/components/pricing/SubscriptionComparison.tsx`
- Modify: `src/components/SettingsModal.tsx`
- Modify: `src/api.ts`, `src/data-source.ts`, `src/types.ts`, `src/mock/desktop-mock.ts`
- Modify: `src/i18n/resources.ts`
- Test: `e2e/settings.spec.ts`

- [ ] **Step 1: Ajouter les scénarios E2E de comparaison sans application**

Vérifier résultats côte à côte, provenance cliquable, dernière vérification, différences entrée/sortie/cache, région/devise/périodicité, raisons de confiance et valeurs inconnues.

- [ ] **Step 2: Ajouter l’UI de comparaison avec erreur par source**

Afficher les sources candidates, le prix actif, les écarts, les conditions d’abonnement et les explications. Les aides sont accessibles clavier et ne masquent pas les données importantes.

- [ ] **Step 3: Ajouter sélection et confirmation explicites**

Permettre de choisir fournisseur/modèle/offre et champs à appliquer. La confirmation affiche un résumé du diff ; annuler ne modifie ni override, ni abonnement, ni coût historique.

- [ ] **Step 4: Appliquer uniquement à travers les opérations de persistance du plan principal**

Ne pas créer un chemin de sauvegarde parallèle. Enregistrer la provenance et date d’effet ; pour un abonnement, sauvegarder le prix public comme référence distincte du montant réellement payé.

- [ ] **Step 5: Vérifier échecs, annulation et application partielle en E2E**

Run: `npm run test:e2e -- e2e/settings.spec.ts`
Expected: aucune mutation sur annulation/erreur ; seules les lignes sélectionnées changent après confirmation.

### Task 4 : Vérification de l’application réelle

- [ ] Run: `npm run build` — attendu : typecheck/bundle réussis.
- [ ] Run: `npm run test:e2e -- e2e/settings.spec.ts` — attendu : comparaison mockée réussie.
- [ ] Run: `npm run test:e2e:electron -- --grep "pricing source comparison"` — attendu : backend réel, données externes mockées, statuts indépendants corrects.
- [ ] Vérifier avec les connecteurs retenus qu’aucune session ou donnée de coût n’est envoyée en requête.
