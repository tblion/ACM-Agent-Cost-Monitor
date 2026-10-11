# Commande OpenCode de mise à jour du catalogue — plan d’implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter `/update-model-prices` au projet OpenCode pour rechercher des tarifs sur les pages officielles et mettre à jour les JSON de référence après approbation du diff.

**Architecture:** Une commande Markdown `.opencode/commands/update-model-prices.md` guide OpenCode pour rechercher les pages officielles, comparer à `pricing-source.json`, présenter la proposition et attendre une approbation explicite. Après accord seulement, elle met à jour la source versionnée et invoque le générateur/validateur atomique existant ; elle ne lance jamais de recalcul applicatif.

**Tech Stack:** OpenCode V2 project command Markdown, `pricing-source.json`, Node.js, `scripts/release-pricing.mjs`.

**Spec:** `docs/superpowers/specs/2026-10-11-model-pricing-management-design.md`

## Global Constraints

- Une commande projet OpenCode V2 est un `.md` sous `.opencode/commands/` ; `$ARGUMENTS` reçoit les filtres facultatifs.
- Sources autorisées : sites officiels des fournisseurs de modèles uniquement ; citer l’URL exacte et date de consultation.
- Ne jamais deviner un tarif, écraser l’historique versionné, ni écrire avant l’approbation explicite du diff.
- La commande met à jour uniquement les JSON de référence ; aucun coût utilisateur/historique n’est modifié et aucun recalcul n’est déclenché.
- Ne pas utiliser de bloc shell OpenCode exécuté avant validation ni placer d’argument non fiable dans une commande shell.
- Conserver les fichiers valides : réutiliser `npm run release:prepare` qui valide une sortie temporaire avant remplacement atomique.

## Review Focus

- Source officielle inaccessible ou limitée par anti-bot : n’ajouter aucune valeur supposée ; E2E/documentation de commande confirme l’arrêt sûr.
- Modèle proche mais variante ou seuil de contexte différent : marquer ambigu et ne pas créer une entrée ; scénario de revue de commande.
- Tarif officiel modifié : ajouter une version datée et garder la précédente ; exécuter le générateur puis vérifier les deux versions.
- Plusieurs prix dépendant région/cache/context : conserver les distinctions prises en charge par le schéma, demander une précision ou exclure les champs non normalisables.
- Validation ou écriture atomique échouée : les fichiers de référence antérieurs restent valides ; vérifier le flux avec `npm run release:prepare` sur une source temporaire.

---

## Structure des fichiers

- Create: `.opencode/commands/update-model-prices.md` — prompt de recherche, comparaison, approbation et mise à jour.
- Use: `src-dotnet/Resources/pricing-source.json` — source maintenue du catalogue avec URL officielle et dates d’effet.
- Use: `src-dotnet/Resources/pricing.json` — catalogue normalisé embarqué, généré.
- Use: `scripts/generate-pricing.mjs` et `scripts/release-pricing.mjs` — normalisation, génération et validation atomique ; ne pas réécrire ces outils sauf lacune démontrée.
- Create: documentation de scénario OpenCode si nécessaire dans `docs/` (instructions de test manuel seulement, aucun secret).

## Tâches

### Task 1 : Définir le prompt de commande sans effet prématuré

**Files:**
- Create: `.opencode/commands/update-model-prices.md`

- [ ] **Step 1: Écrire le prompt avec filtres `$ARGUMENTS`**

Décrire par défaut l’inspection de toutes les entrées de `pricing-source.json`, ou le ciblage des fournisseurs/modèles demandés. Exiger une recherche source officielle, une correspondance exacte provider/model, les prix unitaires et cache disponibles, la provenance, la date, la date d’effet publiée si disponible et les incertitudes.

- [ ] **Step 2: Imposer une phase de proposition avant toute écriture**

Le premier résultat doit inclure les valeurs avant/après, ajouts, dates d’effet, liens directs, champs impossibles à vérifier et conséquences sur l’historique. Terminer en demandant une approbation explicite ; ne pas éditer avant celle-ci.

- [ ] **Step 3: Décrire le refus et les cas incomplets**

Un refus, aucune source officielle, une page ambiguë, une devise/unité inconnue ou une variante non identifiée laisse les fichiers intacts et explique ce qui manque. Ne jamais traiter un agrégateur comme page officielle.

### Task 2 : Mise à jour contrôlée de la source puis génération

**Files:**
- Modify after approval only: `src-dotnet/Resources/pricing-source.json`
- Generate after approval only: `src-dotnet/Resources/pricing.json`
- Use: `scripts/release-pricing.mjs`

- [ ] **Step 1: Définir les consignes d’édition minimale**

Après approbation, modifier uniquement les entrées sélectionnées : préserver les anciennes versions, ajouter `effectiveFrom` officiel ou explicitement confirmé par l’utilisateur, conserver le lien officiel en `source`, préserver les autres fournisseurs et métadonnées.

- [ ] **Step 2: Appeler le validateur/générateur fixé**

Le prompt demande d’exécuter `npm run release:prepare` seulement après approbation ; le script générera et validera dans un temporaire avant remplacement atomique de `pricing.json`.

- [ ] **Step 3: Rapporter les fichiers et validations**

Présenter sources consultées, entrées modifiées/ignorées, date d’effet et résultat de validation. Mentionner explicitement qu’aucun recalcul ni changement de coût historique n’a été lancé.

### Task 3 : Vérification de la commande dans OpenCode

- [ ] Vérifier la découverte de la commande par OpenCode avec `/update-model-prices` et un argument ciblé.
- [ ] Exécuter un essai de recherche limité à un ou deux modèles dont le fournisseur a une page officielle accessible ; examiner les citations, variantes, unités et dates.
- [ ] Refuser le diff dans un essai et vérifier qu’aucun JSON n’a changé.
- [ ] Après approbation d’un essai contrôlé, vérifier le diff de `pricing-source.json`, puis valider le générateur sur une source isolée avec `npm run release:prepare -- --source chemin/vers/source.json`.
- [ ] Vérifier que `pricing.json` conserve l’ancienne version, que la nouvelle source est officielle et que ni l’état utilisateur ni les coûts d’historique ne sont modifiés.
