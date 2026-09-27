# Conception des améliorations d'architecture

## Objectif

Implémenter progressivement les huit tâches de `docs/architecture-improvement-plan.md` afin de fiabiliser l'application sans réécriture complète. Les commandes Tauri publiques, le mode démo, les conventions XDG et l'absence d'écriture dans `opencode.db` restent inchangés.

## Architecture cible

Le backend conserve Tauri, mais sépare le cycle de vie du watcher, les services métier et l'adaptation des commandes.

- `AppState` possède un service de watcher unique, capable de démarrer, redémarrer et arrêter explicitement son thread.
- `save_settings` compare les anciens et nouveaux réglages et synchronise le watcher avec `live` et `dbPath`.
- `commands.rs` devient progressivement un adaptateur Tauri ; les calculs, réglages, audits et tarifs migrent vers `src-tauri/src/application/`.
- Les erreurs backend sont regroupées dans `AppError`, sérialisées avec un code stable et un message technique.
- Le frontend traduit les codes connus et conserve un repli lisible pour les codes inconnus.

Le frontend conserve `App.tsx` comme point de composition, mais délègue l'orchestration à quatre hooks : `useAppData`, `useLiveMode`, `useSettings` et `useAudit`. Les protections contre les réponses asynchrones obsolètes restent obligatoires.

## Validation des réglages au démarrage

Les réglages utilisateur restent dans `<app_config_dir>/settings.json`, séparés de la configuration OpenCode `opencode.jsonc`.

Au chargement :

- un fichier absent retourne les réglages par défaut ;
- un JSON mal formé produit une erreur de configuration explicite ;
- un JSON valide mais incompatible avec `Settings` produit une erreur de validation explicite ;
- un fichier valide et conforme est chargé normalement.

Un fichier invalide n'est jamais réécrit automatiquement. Le diagnostic est propagé au frontend par l'erreur typée dès que cette couche est introduite. Le mode démo doit rester utilisable indépendamment de la base et des fichiers réels de l'utilisateur.

La validation couvre les types des champs, les valeurs d'énumération, `defaultPeriodDays`, les groupes personnalisés et les champs optionnels. Les valeurs invalides de période sont normalisées vers `30` selon le plan fonctionnel.

## Flux de données

1. `useSettings` charge les réglages, puis initialise langue et thème.
2. `useAppData` charge la source active et ignore les réponses obsolètes grâce à un identifiant de requête.
3. `useLiveMode` s'abonne aux événements uniquement en mode réel et lorsque le live est actif.
4. Une seule file sérialise les sauvegardes de réglages.
5. Les changements de données ou de réglages incrémentent la génération d'audit et rendent le rapport obsolète.
6. Un changement de mode charge uniquement les données nécessaires et ne déclenche pas d'appels inutilisés à `getRates` ou `getCostSummary`.
7. Les filtres utilisent `defaultPeriodDays`; les bornes saisies localement couvrent respectivement `00:00:00.000` et `23:59:59.999`.

## Contrat d'erreur

Les commandes converties retournent une erreur de forme stable :

```json
{
  "code": "database_read_failed",
  "message": "..."
}
```

Les catégories prévues sont `Database`, `Configuration`, `Settings`, `Pricing`, `Watcher`, `Export` et `InvalidInput`. Les commandes ciblées en premier sont `get_data`, `save_settings`, `recalculate_data` et `get_audit_report`.

Les opérations non critiques, notamment les métriques runtime, peuvent conserver leur comportement tolérant. Les chargements, sauvegardes, recalculs et rapports d'audit doivent propager leurs erreurs.

## Tests et séquencement

Les changements sont réalisés dans l'ordre du plan : watcher, périodes, hooks React, erreurs typées, services Rust, optimisations, contrats, puis E2E. Chaque tâche est validée avant la suivante.

Les tests ajoutés couvrent :

- activation, désactivation et redémarrage du watcher ;
- fichier de base absent au démarrage du live ;
- validation des réglages absents, invalides et conformes ;
- période par défaut et fin de journée inclusive ;
- mode démo et réponses asynchrones obsolètes ;
- sérialisation et traduction des erreurs ;
- services Rust appelés sans démarrer Tauri ;
- payloads Rust/TypeScript et champs optionnels ;
- scénarios E2E sur des fixtures dédiées, jamais sur la base réelle.

Les validations prévues sont `npm test`, `npm run build`, `npm run test:e2e` après sa mise en place et `cd src-tauri && cargo test`. Aucun test C# n'est ajouté ou réactivé.

## Contraintes de mise en œuvre

- Ne pas écrire dans `opencode.db`.
- Respecter les chemins XDG OpenCode existants.
- Ne pas créer de worktree.
- Préserver les changements non liés présents dans le dépôt.
- Ajouter les commentaires de code en français uniquement lorsqu'ils clarifient une logique non évidente.
- Ne pas introduire de cache global sans mesure préalable.
