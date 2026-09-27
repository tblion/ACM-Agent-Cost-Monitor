# Groupes de projets comme filtres virtuels

## Objectif

Permettre d'utiliser un groupe personnalisé comme une option du filtre Projet, en agrégeant ses projets membres sous le nom du groupe sans jamais doubler les coûts.

## Périmètre

- Afficher les groupes sauvegardés dans une section séparée en haut du menu Projet.
- Afficher les projets individuels dans une seconde section sous les groupes.
- Identifier chaque groupe avec l'icône `◆`, une couleur dédiée adaptée aux thèmes clair et sombre et une information accessible explicite.
- Laisser les groupes décochés par défaut.
- Exclure les groupes de l'action `Tout sélectionner`, qui concerne uniquement les projets individuels ; l'action `Effacer` vide toutes les sélections, groupes compris.
- Autoriser au maximum un groupe sélectionné à la fois.
- Développer le groupe sélectionné vers ses projets membres pour filtrer les sessions.
- Dédupliquer les sessions lorsque le groupe et un de ses projets individuels sont sélectionnés ensemble.
- Afficher les membres du groupe sous le nom du groupe dans le graphique de coût par projet.
- Conserver le comportement actuel lorsqu'aucun groupe n'est sélectionné.
- Afficher les groupes sans session actuelle, avec une somme nulle lorsqu'ils sont sélectionnés.
- Ne pas modifier le format de stockage `CustomGroup`.

## Architecture retenue

Les options du filtre Projet seront modélisées avec une distinction entre projets réels et groupes virtuels. Une option de groupe contiendra une clé interne non persistée, son nom affiché, son type `group` et la liste de ses projets membres. Les projets réels conserveront leur chemin complet comme clé.

`MultiSelect` sera étendu pour afficher deux sections d'options et pour distinguer les actions globales des options de groupe. La section des groupes sera rendue avant la section des projets, avec un intitulé accessible. L'action de sélection globale ne modifiera que les options de type projet. La sélection d'un groupe remplacera le groupe précédemment sélectionné.

La sélection du filtre continuera à être stockée dans l'état local de `Filters`, mais les clés de groupes seront résolues avant le filtrage. `filterSessions` recevra les groupes nécessaires ou une sélection normalisée afin de construire un `Set` de projets réels. Une session ne pourra correspondre qu'une seule fois à ce set.

Pour le graphique `CostByProject`, les données filtrées seront projetées en lignes d'affichage : les sessions dont le projet appartient au groupe sélectionné seront affectées au nom du groupe ; les autres resteront regroupées par projet réel. Comme un seul groupe peut être actif, aucun recouvrement entre groupes ne peut créer de double ligne.

## Identité visuelle et accessibilité

- Les groupes utiliseront `◆` comme indicateur visuel et textuel stable.
- Une variable CSS de thème clair et une variable CSS de thème sombre fourniront un contraste suffisant avec `--bg` et `--panel`.
- Le groupe sera annoncé comme `Groupe : <nom>` dans son nom accessible, même si son nom visuel reste court.
- La couleur ne sera jamais l'unique moyen de distinguer un groupe.
- Le séparateur et les titres de section seront lisibles et ne seront pas implémentés uniquement par des éléments décoratifs.
- Les interactions existantes au clavier de `MultiSelect` seront conservées.
- Les tests vérifieront l'ordre des sections, l'absence des groupes dans `Tout sélectionner`, l'exclusivité des groupes et les noms accessibles.

## Flux de données

1. `App` dérive les projets individuels des sessions et les groupes de `settings.customGroups`.
2. `FilterBar` transmet les deux catégories au sélecteur Projet.
3. Le sélecteur affiche les groupes en tête, décochés par défaut, puis les projets individuels.
4. La sélection d'un groupe remplace tout autre groupe sélectionné mais ne modifie pas les projets individuels cochés.
5. Le filtre normalise les options sélectionnées en chemins de projets uniques.
6. Les agrégations consomment les sessions filtrées une seule fois et appliquent le nom du groupe au graphique Projet lorsque nécessaire.

## Tests et validation

- Tester l'affichage séparé des groupes en haut des projets.
- Tester que les groupes sont décochés par défaut et absents de `Tout sélectionner`, tandis que `Effacer` les désélectionne comme toute autre option active.
- Tester qu'un seul groupe peut être sélectionné et qu'en sélectionner un second remplace le premier.
- Tester les noms accessibles, l'icône et les couleurs de thème.
- Tester qu'un groupe sélectionné filtre tous ses membres.
- Tester qu'un groupe et un membre sélectionnés ne doublent pas les sessions ni les coûts.
- Tester l'affichage agrégé du groupe dans `CostByProject`.
- Tester le cas d'un groupe sans session actuelle.
- Exécuter `npm test`, `npm run build` et `git diff --check`.

## Hors périmètre

- Modifier la structure persistée de `CustomGroup`.
- Autoriser plusieurs groupes simultanément.
- Changer la logique de calcul des coûts.
- Ajouter une recherche ou une pagination dans le menu Projet.
