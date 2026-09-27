# Utilisation gratuite/payante et fenêtre À propos

## Objectif

Rendre visibles les modèles gratuits même lorsque leur coût est nul, ajouter une légende accessible au graphique des coûts par provider et ajouter une fenêtre À propos avec les informations de Thomas Blion.

## Décisions

- L'utilisation est mesurée principalement en tokens consommés.
- `Gratuit` correspond à un `ModelUsage` avec des tokens positifs et `cost === 0`.
- `Payant` correspond à un `ModelUsage` avec des tokens positifs et `cost > 0`.
- Une session multi-modèles est comptée dans chaque catégorie qu'elle contient.
- Les sessions sans tokens ne sont pas comptées dans ces catégories.
- Les montants du graphique provider restent calculés en dollars, y compris lorsqu'ils valent zéro.
- La légende provider est une liste HTML accessible sous le graphique et inclut les providers présents avec `0 $`.
- Le Header reçoit un bouton `À propos` à côté de Tarifs et Réglages.
- La modale affiche Thomas Blion, `https://github.com/tblion` et `https://thomasblion.com`.

## Architecture

Un agrégateur pur `usageByBillingType` est ajouté dans `src/lib/aggregate.ts`, avec des tests unitaires. Un nouveau composant `UsageByBilling` affiche les deux catégories et est intégré au dashboard.

`CostByProvider` conserve son donut existant et ajoute une légende accessible basée sur les mêmes lignes, couleurs et montants. `AboutModal` reprend les garanties de dialogue existantes : rôle dialog, Échap, focus initial, piège et restauration du focus.

## Validation

Les tests couvrent les coûts nuls avec tokens, les sessions mixtes, les sessions sans tokens, les pourcentages et la conservation des providers à coût nul. Le build frontend, les tests Rust de régression, le scénario mock et le diff seront exécutés avant commit et push.
