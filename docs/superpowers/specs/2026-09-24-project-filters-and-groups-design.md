# Tri des filtres et sélection des groupes de projets

## Objectif

Améliorer la lisibilité des listes de filtres et remplacer la saisie de projets séparés par des virgules dans les groupes personnalisés par une sélection explicite de projets.

## Périmètre

- Trier les projets, modèles et providers selon le nom affiché, sans distinction de casse.
- Utiliser le nom court du projet, c'est-à-dire le dernier segment du chemin, pour le tri et l'affichage.
- Remplacer le champ texte des projets d'un groupe par une liste de cases à cocher.
- Autoriser le même projet dans plusieurs groupes.
- Conserver les projets enregistrés mais absents des données actuellement chargées.
- Permettre la suppression explicite d'un projet absent avec confirmation dans l'application.

## Architecture retenue

Un composant dédié `ProjectGroupPicker` sera ajouté pour l'édition des projets d'un groupe. Il recevra la liste des projets actuellement détectés ainsi que la sélection du groupe.

Pour chaque groupe, la liste affichée sera l'union des projets actifs et des projets déjà enregistrés dans ce groupe. Les projets actifs seront affichés normalement. Les projets absents des données seront affichés cochés et barrés, avec un état visuel distinct, mais resteront sélectionnables.

`App` transmettra les projets détectés à `SettingsModal`. La logique de sélection d'un groupe restera locale à `SettingsModal` jusqu'à l'enregistrement des réglages. Les tableaux `projects` des groupes resteront indépendants afin qu'un projet puisse être présent dans plusieurs groupes.

Le composant générique `MultiSelect` des filtres ne sera pas surchargé avec les règles spécifiques aux projets absents et aux confirmations.

## Tri

Une fonction de tri partagée sera utilisée pour les options des filtres et du sélecteur de groupes. Elle comparera les noms affichés avec `localeCompare` et une sensibilité insensible à la casse. Le tri sera donc alphabétique pour l'utilisateur, au lieu de dépendre de l'ordre ASCII de `sort()`.

Les projets seront comparés sur leur dernier segment de chemin, comme dans l'interface actuelle. Les valeurs complètes des chemins resteront utilisées pour la sélection et l'agrégation afin d'éviter les collisions entre deux chemins ayant le même nom final.

## Interaction et accessibilité

- Chaque projet aura une case à cocher et un nom accessible.
- Les projets absents seront annoncés par un état textuel ou une description accessible, pas uniquement par le barré.
- La désélection d'un projet actif se fera immédiatement.
- La désélection d'un projet absent ouvrira une boîte de dialogue intégrée, avec les actions Annuler et Supprimer.
- Annuler conservera le projet sélectionné.
- Supprimer retirera définitivement le projet du groupe en cours.
- La boîte de dialogue devra gérer le focus, la touche Échap et des libellés traduits en français et en anglais.
- Les actions seront utilisables au clavier et les états sélectionné/absent seront exposés à l'arbre d'accessibilité.

## Flux de données

1. `App` calcule la liste des projets présents dans les sessions chargées.
2. `SettingsModal` transmet cette liste à chaque `ProjectGroupPicker`.
3. Le picker fusionne cette liste avec les projets enregistrés du groupe et trie le résultat.
4. Une modification met à jour le groupe local dans la modale.
5. L'enregistrement persiste tous les projets encore sélectionnés, y compris les projets absents.

## Tests et validation

- Tester le tri insensible à la casse et basé sur le nom court.
- Tester la fusion des projets actifs avec les projets absents enregistrés.
- Tester qu'un projet peut être sélectionné dans plusieurs groupes.
- Tester la désélection immédiate d'un projet actif.
- Tester l'annulation et la confirmation de suppression d'un projet absent.
- Tester les interactions clavier et les attributs d'accessibilité principaux du picker et de la boîte de dialogue.
- Exécuter les tests frontend Vitest et le build frontend `npm run build`.
- Valider le rendu et le parcours clavier avec le mock frontend ou les tests Chrome MCP si nécessaire.

## Hors périmètre

- Modifier la logique d'agrégation des coûts elle-même.
- Dédupliquer automatiquement les projets entre les groupes.
- Ajouter une recherche ou une pagination dans les listes de projets.
- Modifier le format de stockage des réglages `CustomGroup`.
