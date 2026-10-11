# Gestion des tarifs et historique — plan d’implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer la modale des tarifs par une section Réglages centralisée pour gérer les tarifs manuels/versionnés, les abonnements et les recalculs historiques explicites.

**Architecture:** Le catalogue intégré reste en lecture seule comme référence. Les overrides, modèles saisis et versions de souscriptions de l’utilisateur sont conservés dans le fichier de réglages XDG existant avec lecture rétrocompatible. `PricingService` résout les prix par date ; le renderer garde la présentation et la confirmation, tandis que le backend reste responsable du calcul.

**Tech Stack:** React, TypeScript strict, Electron IPC/JSON Lines, .NET 10, réglages JSON, Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-10-11-model-pricing-management-design.md`

## Global Constraints

- `opencode.db` reste strictement en lecture seule.
- Les versions de prix antérieures et les réglages d’abonnement existants sont conservés sans perte.
- Toute action de recalcul présente son impact avant confirmation ; la commande OpenCode qui met à jour le catalogue ne recalcule rien.
- Les tests C# restent désactivés temporairement ; valider par Playwright E2E ou scénarios MCP/API autorisés.
- Conserver XDG pour les chemins de données et de configuration sur les trois OS.
- Maintenir l’accessibilité WCAG 2.2 / RGAA 4.1.2 et les traductions française/anglaise.

## Review Focus

- `settings.json` ancien sans champs de tarifs, avec abonnements existants : lecture et migration sans perte, vérifiées dans un scénario Electron E2E.
- Tarif absent versus prix nul explicite : l’interface et le calcul les distinguent ; vérifier un modèle gratuit en E2E.
- Deux versions du même modèle avec dates d’effet égales ou inversées : refuser les conflits et garder la version temporelle déterministe ; vérifier via l’interface/diagnostic E2E.
- Abonnement modifié, terminé ou couvrant plusieurs modèles : ne jamais étendre silencieusement sa période/couverture ; vérifier le coût avant/après en E2E.
- Message historique sans date/tokens/tarif : conserver le fallback et expliquer le diagnostic dans l’aperçu de recalcul E2E.

---

## Structure des fichiers

- Modify `src-dotnet/Models/Settings.cs`, `src-dotnet/Infrastructure/SettingsStore.cs` : contrats persistés et compatibilité des réglages historiques.
- Modify `src-dotnet/Models/RuntimeModels.cs` et `src/types.ts` : types partagés des tarifs versionnés et du résultat de prévisualisation.
- Modify `src-dotnet/Application/PricingService.cs`, `DataService.cs`, `SessionAggregator.cs` : résolution temporelle avec les tarifs personnalisés et abonnements versionnés.
- Modify `src-dotnet/Protocol/OperationDispatcher.cs`, `electron/main.ts`, `electron/preload.ts`, `electron/renderer-api.ts`, `src/api.ts`, `src/data-source.ts`, `src/mock/desktop-mock.ts` : contrats de lecture/écriture/prévisualisation.
- Modify `src/components/SettingsModal.tsx`, `src/App.tsx`, `src/components/Header.tsx`, `src/components/RatesModal.tsx` : intégrer la section et retirer l’ancienne modale/son déclencheur.
- Modify `src/i18n/resources.ts`, `e2e/settings.spec.ts`, `e2e/electron-app.spec.ts` et fixtures E2E pertinentes.

## Tâches

### Task 1 : Contrats et persistance des overrides historisés

**Files:**
- Modify: `src-dotnet/Models/Settings.cs`
- Modify: `src-dotnet/Infrastructure/SettingsStore.cs`
- Modify: `src/types.ts`
- Test: `e2e/settings.spec.ts`

**Interfaces:**
- Adds `Settings.CustomRates: List<ConfiguredRateVersion>` (facultative à la lecture des anciens réglages) ; chaque version identifie provider/modèle, tarifs input/output/cache, `effectiveFrom`, provenance et une clé stable.
- Rend les entrées d’abonnement stables et historisables ; la lecture des entrées existantes sans identifiant crée un identifiant stable conservé au prochain enregistrement.
- Les champs nouveaux sont strictement validés ; les entrées historiques restent valides après migration.

- [ ] **Step 1: Écrire le scénario E2E de rétrocompatibilité des réglages**

Ajouter un scénario qui charge une fixture `settings.json` ancienne contenant uniquement les abonnements actuels, sauvegarde les réglages puis vérifie que l’abonnement, les modèles, la période et les dates sont préservés et que les nouveaux champs ont des valeurs par défaut sûres.

- [ ] **Step 2: Exécuter le scénario et confirmer l’échec attendu**

Run: `npm run test:e2e -- e2e/settings.spec.ts`
Expected: FAIL car le nouveau contrat de tarifs/versioning n’est pas encore pris en charge.

- [ ] **Step 3: Ajouter `ConfiguredRateVersion` et les champs compatibles**

Ajouter le type backend et le type TypeScript avec les champs exacts ci-dessus ; les tableaux absents dans les anciens fichiers se chargent comme vides. Étendre `SettingsStore` sans supprimer ni renommer les propriétés de réglages existantes.

- [ ] **Step 4: Valider tarifs, dates, clés et versions**

Refuser provider/modèle vides, prix négatifs/non finis, dates non RFC3339 UTC, clés dupliquées et deux versions provider/modèle à même date effective. Garder les entrées existantes intactes si une nouvelle entrée est invalide.

- [ ] **Step 5: Relancer le scénario E2E**

Run: `npm run test:e2e -- e2e/settings.spec.ts`
Expected: PASS pour l’ancien schéma, la sauvegarde, la relecture et le rejet des nouvelles valeurs invalides.

### Task 2 : Résolution du tarif utilisateur par date

**Files:**
- Modify: `src-dotnet/Application/PricingService.cs`
- Modify: `src-dotnet/Application/DataService.cs`
- Modify: `src-dotnet/Application/SessionAggregator.cs`
- Modify: `src-dotnet/Application/AuditService.cs`, `src-dotnet/Application/AuditReportBuilder.cs`
- Modify: `src-dotnet/Protocol/OperationDispatcher.cs`
- Test: `e2e/electron-app.spec.ts`

**Interfaces:**
- `ResolveRateDetail` reçoit les versions utilisateur en plus des overrides OpenCode existants et renvoie la version réellement choisie et sa provenance.
- Priorité : abonnement couvrant le provider/modèle/date, override utilisateur applicable, override explicite `opencode.jsonc`, catalogue applicable, puis coût stocké. Conserver le comportement existant des overrides configurés OpenCode avant le catalogue ; l’override utilisateur est résolu avant la source de référence.

- [ ] **Step 1: Ajouter un scénario Electron avec deux versions de tarif**

Créer une fixture isolée avec un ancien tarif effectif avant une date pivot et un tarif récent après ; vérifier que deux messages correspondants obtiennent les coûts calculés avec leur version respective, sans écriture de la base source.

- [ ] **Step 2: Exécuter le scénario pour vérifier l’échec**

Run: `npm run test:e2e:electron -- --grep "versioned custom pricing"`
Expected: FAIL car les overrides versionnés ne participent pas encore au calcul.

- [ ] **Step 3: Ajouter la résolution des overrides historisés**

Construire un index par `(provider, model)` trié par `effectiveFrom` ; choisir la dernière version dont la date effective est inférieure ou égale à la date du message. Refuser les versions sans tarif applicable et laisser les fallbacks existants agir.

- [ ] **Step 4: Brancher les versions sur calcul, rates, recalcul et audit**

Charger une seule fois les réglages pour la résolution d’un calcul et transmettre les mêmes versions à l’agrégation, au résumé, aux diagnostics et au rapport d’audit afin que toutes les vues partagent les mêmes coûts et provenance.

- [ ] **Step 5: Relancer le scénario Electron**

Run: `npm run test:e2e:electron -- --grep "versioned custom pricing"`
Expected: PASS, anciens/nouveaux messages ont des coûts distincts, `opencode.db` n’a pas été modifiée.

### Task 3 : API desktop et sources mockées

**Files:**
- Modify: `src-dotnet/Protocol/OperationDispatcher.cs`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `electron/renderer-api.ts`
- Modify: `src/api.ts`
- Modify: `src/data-source.ts`
- Modify: `src/mock/desktop-mock.ts`
- Test: `e2e/settings.spec.ts`

- [ ] **Step 1: Ajouter le test de contrat API pour obtenir et sauvegarder les versions**

Vérifier le payload sérialisé camelCase, le retour void de sauvegarde, les erreurs de validation, et la parité du mock.

- [ ] **Step 2: Implémenter les opérations typées**

Ajouter une lecture des réglages enrichis et utiliser `save_settings` pour persister `customRates`/abonnements sans commande renderer directe vers le système de fichiers.

- [ ] **Step 3: Vérifier les contrats en E2E mocké**

Run: `npm run test:e2e -- e2e/settings.spec.ts`
Expected: PASS sur le renderer mocké, avec erreurs de validation cohérentes ; le parcours backend réel est couvert par les tâches Electron et la vérification finale.

### Task 4 : Nouvelle section Tarifs et suppression de la modale

**Files:**
- Modify: `src/components/SettingsModal.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/Header.tsx`
- Delete: `src/components/RatesModal.tsx`
- Modify: `src/components/SettingsModal.test.tsx`, `src/App.test.tsx`, `e2e/settings.spec.ts`
- Modify: `src/i18n/resources.ts`

- [ ] **Step 1: Mettre à jour l’E2E de navigation des réglages**

Vérifier que la section « Tarifs » remplace « Coûts », contient deux vues « Tarifs à l’usage »/« Abonnements », et que l’ancienne entrée n’ouvre plus une modale.

- [ ] **Step 2: Exécuter le scénario pour confirmer son échec**

Run: `npm run test:e2e -- e2e/settings.spec.ts`
Expected: FAIL tant que la navigation et la modale actuelles ne sont pas remplacées.

- [ ] **Step 3: Déplacer l’entrée de navigation et les abonnements dans Tarifs**

Garder général, sources, projets, diagnostics et audit ; ne pas déplacer les autres outils.

- [ ] **Step 4: Retirer l’ancienne modale, son callback et son bouton**

Supprimer seulement les chemins devenus inutiles après confirmation que les fonctions de résumé historique et de recalcul sont accessibles depuis la nouvelle section.

- [ ] **Step 5: Ajouter la liste, la recherche et les infobulles accessibles**

Afficher provider/modèle, tarifs et unités, source/date, statut ; labels, aides, actions et états doivent rester accessibles clavier/lecteur d’écran. Les messages et aides ont des ressources FR/EN.

- [ ] **Step 6: Vérifier navigation et accessibilité en E2E**

Run: `npm run test:e2e -- e2e/settings.spec.ts`
Expected: PASS sans modale tarifs, navigation fonctionnelle et commandes opérables au clavier.

### Task 5 : Édition des tarifs, ajout de modèle et abonnements versionnés

**Files:**
- Modify: `src/components/SettingsModal.tsx` (ou extraire des composants focalisés dans `src/components/pricing/`)
- Modify: `src-dotnet/Infrastructure/SettingsStore.cs`
- Modify: `src/i18n/resources.ts`
- Test: `e2e/settings.spec.ts`

- [ ] **Step 1: Écrire les scénarios d’ajout/modification datée**

Tester création d’un modèle absent, modification d’un prix avec nouvelle date d’effet, création d’une version d’abonnement, fermeture d’une période existante et conservation des versions précédentes.

- [ ] **Step 2: Exécuter pour confirmer l’échec**

Run: `npm run test:e2e -- e2e/settings.spec.ts`
Expected: FAIL car aucune action d’édition/version n’est encore exposée.

- [ ] **Step 3: Ajouter formulaires et validation de tarifs**

Permettre fournisseur/modèle, input/output/cache, zéro explicite, date d’effet, création, modification et retour explicite à la référence catalogue ; ne jamais supprimer la version précédente.

- [ ] **Step 4: Adapter l’édition des abonnements pour historiser**

Conserver fournisseur/montant/périodicité/modèles/dates ; distinguer prix public de montant réellement payé et rendre l’édition manuelle possible sans résultat en ligne.

- [ ] **Step 5: Vérifier les migrations et les E2E**

Run: `npm run test:e2e -- e2e/settings.spec.ts`
Expected: PASS pour l’ajout, les dates, les valeurs nulles/absentes, les versions et les anciens abonnements.

### Task 6 : Prévisualisation puis recalcul explicite

**Files:**
- Modify: `src-dotnet/Application/DataService.cs`
- Modify: `src-dotnet/Protocol/OperationDispatcher.cs`
- Modify: `electron/main.ts`, `electron/preload.ts`, `electron/renderer-api.ts`
- Modify: `src/api.ts`, `src/types.ts`, `src/data-source.ts`, `src/mock/desktop-mock.ts`
- Modify: `src/components/SettingsModal.tsx`, `src/i18n/resources.ts`
- Test: `e2e/electron-app.spec.ts`

- [ ] **Step 1: Ajouter un E2E de prévisualisation sans application**

Vérifier que la prévisualisation annonce messages concernés, coûts avant/après, écart total et fallbacks, mais ne change pas le tableau/KPI tant que l’utilisateur ne confirme pas.

- [ ] **Step 2: Calculer un aperçu avec les tarifs valides à la date du message**

Le calcul doit réutiliser le même résolveur que `get_data`, ne jamais appliquer le tarif actuel à une date passée et ne jamais écrire dans la base source.

- [ ] **Step 3: Ajouter une confirmation distincte de l’aperçu**

Après confirmation, afficher la prévisualisation calculée dans l’application ; annuler conserve intégralement les données affichées. Désactiver les actions pendant le chargement et annoncer erreurs/résultats accessible.

- [ ] **Step 4: Vérifier l’E2E Electron**

Run: `npm run test:e2e:electron -- --grep "historical recalculation preview"`
Expected: PASS pour aperçu, annulation, confirmation, diagnostics et absence d’écriture SQLite.

### Task 7 : Vérification d’intégration

- [ ] Run: `npm run build` — attendu : typecheck et bundle React réussis.
- [ ] Run: `npm run electron:build:desktop` — attendu : renderer, main, preload et types Electron réussis.
- [ ] Run: `npm run test:e2e -- e2e/settings.spec.ts` — attendu : parcours complet mocké réussi.
- [ ] Run: `npm run test:e2e:electron -- e2e/electron-app.spec.ts` — attendu : parcours réel réussi, données XDG isolées et base source inchangée.
- [ ] Inspecter le diff final pour confirmer que seuls les réglages applicatifs sont migrés et que `opencode.db` n’a pas de chemin d’écriture.
