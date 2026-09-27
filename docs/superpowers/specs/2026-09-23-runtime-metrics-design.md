# Indicateurs runtime et actualisation des données

## Objectif

Afficher dans l'interface la taille actuelle de la base `opencode.db`, la mémoire RSS du processus Tauri et la date de la dernière mise à jour des données. Ces indicateurs doivent aider à surveiller l'impact du chargement de la base sans modifier le comportement de lecture seule de la base.

## Périmètre

- Ajouter une commande Tauri native retournant la taille du fichier de base et la mémoire RSS du processus.
- Afficher ces valeurs dans une barre de statut accessible en bas de l'interface.
- Mettre à jour les métriques après le chargement initial et chaque rechargement des données.
- Mettre à jour la date d'actualisation au même moment que les données réellement affichées.
- Gérer le mode réel, le mode live et le mode démo.

## Architecture

### Backend Rust

Ajouter un modèle sérialisable `RuntimeMetrics` avec :

- `databaseSizeBytes: Option<u64>` : taille du fichier de base résolu, absente en mode démo ou si le fichier est inaccessible ;
- `processMemoryBytes: Option<u64>` : mémoire RSS du processus Tauri ;
- `measuredAt: i64` : instant de mesure côté backend.

Ajouter la commande Tauri `get_runtime_metrics(include_database_size: bool)`. Elle mesure la mémoire native du processus et, uniquement lorsque `include_database_size` vaut `true`, résout le chemin de base depuis les réglages courants et lit la taille du fichier sans ouvrir ni modifier la base. La mesure mémoire utilise une dépendance native portable plutôt que des APIs propres à un seul système d'exploitation.

Une erreur de lecture de la taille ou de mesure mémoire ne doit pas empêcher le chargement des données : la valeur concernée est absente et l'interface affiche un état indisponible.

### Frontend React

Ajouter un client `getRuntimeMetrics` dans `src/api.ts`, un type correspondant dans `src/types.ts` et un composant de barre de statut dédié.

Après chaque résolution réussie de `dataSource.getData()` :

1. conserver les sessions reçues ;
2. demander les métriques runtime ;
3. enregistrer l'instant de mise à jour correspondant à ce rechargement ;
4. afficher la barre de statut.

Le rechargement live suit le même chemin. Les requêtes obsolètes ne doivent pas remplacer les métriques d'une requête plus récente, selon le mécanisme existant `dataRequestId`.

En mode démo, le frontend appelle `get_runtime_metrics(false)` : la taille de base est affichée comme indisponible, tandis que la mémoire du processus reste affichée si la mesure est disponible. Le mode démo ne doit pas inspecter le chemin de la base ni appeler de commande de lecture de ses données.

## Présentation

La barre de statut affiche une ligne compacte et responsive, par exemple :

```text
BDD 14,0 Go · Mémoire 82 Mo · Données mises à jour à 19:04:32
```

Les libellés et états indisponibles passent par l'i18n existant. La date est formatée selon la langue active. La barre utilise un élément sémantique `footer` ou `aside` avec un nom accessible et ne doit pas être la seule source d'information sur l'état de chargement.

## Données et précision

- La taille affichée correspond au fichier principal `opencode.db`, pas à une estimation du contenu logique et pas aux fichiers SQLite `-wal` ou `-shm`.
- La mémoire affichée est la mémoire RSS totale du processus Tauri au moment de la mesure ; elle ne permet pas d'isoler exclusivement la mémoire consommée par la base.
- La date représente le dernier chargement de données affiché avec succès, pas uniquement la dernière mesure de métriques.

## Tests et validation

- Test Rust de sérialisation de `RuntimeMetrics` et des valeurs indisponibles.
- Test Rust de lecture de taille sur un fichier temporaire, sans modification du fichier.
- Test frontend du formatage des métriques et de l'état démo.
- Test frontend vérifiant que la date change après un chargement live réussi et ne change pas après un échec.
- Validation par `npm test`, `npm run build` et tests MCP Chrome du rendu accessible et responsive.
