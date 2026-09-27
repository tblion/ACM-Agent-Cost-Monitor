# Réduction du bundle initial et chargement différé

## Objectif

Réduire le JavaScript chargé au démarrage de l'application afin de supprimer l'avertissement Vite sur le chunk initial supérieur à 500 kB, sans masquer le problème en augmentant uniquement `chunkSizeWarningLimit`.

## Périmètre

- Charger les huit composants de graphiques avec des imports dynamiques.
- Charger `SettingsModal`, `RatesModal` et `AboutModal` uniquement lors de leur ouverture.
- Conserver exactement les props, les données, les actions et les règles métier existantes.
- Afficher l'application déjà rendue en arrière-plan pendant le chargement initial des graphiques.
- Ajouter un voile de chargement avec le texte traduit « Chargement » et une animation visible indiquant que l'application fonctionne.
- Prévoir un état de chargement compact et accessible lors de l'ouverture d'une modale différée.
- Ne pas augmenter artificiellement le seuil `build.chunkSizeWarningLimit`.

## Architecture retenue

`App` utilisera `lazy(() => import(...))` pour les graphiques et les modales. Les imports statiques de ces composants seront supprimés afin que Vite/Rolldown génère des chunks séparés et ne charge pas Recharts dans le bundle initial par simple import transitif.

La grille des graphiques sera enveloppée dans un `Suspense`. Son fallback conservera la structure visuelle de l'application, avec un flou léger sur le contenu disponible et un voile semi-transparent centré. Le fallback sera un composant dédié réutilisable pour éviter de dupliquer les règles d'accessibilité et de style.

Chaque modale différée sera enveloppée dans son propre `Suspense`. Le fallback sera limité à une zone de dialogue de chargement afin que l'ouverture de Settings, Rates ou About ne floute pas tout le dashboard et ne donne pas l'impression que l'action a échoué.

La configuration Vite ne définira pas de `manualChunks` supplémentaire : le découpage par imports dynamiques est explicite, robuste et suffisant pour cette dépendance. Le seuil d'avertissement restera sa valeur par défaut afin de conserver un signal utile sur les futures régressions de taille.

## État de chargement

Le fallback de chargement initial :

- affiche le texte traduit `Chargement` en français et `Loading` en anglais ;
- affiche une animation CSS discrète et continue ;
- expose `role="status"` et `aria-live="polite"` ;
- applique un flou léger au contenu d'arrière-plan et un voile contrasté au premier plan ;
- désactive l'animation lorsque `prefers-reduced-motion: reduce` est actif, tout en conservant le texte ;
- ne bloque pas les interactions déjà disponibles en dehors de la zone en attente.

Le fallback des modales expose également un état `role="status"`, mais ne prétend pas être une boîte de dialogue complète et ne capte pas le focus avant que la vraie modale soit montée.

## Flux de chargement

1. `App` rend son shell, les filtres, les KPI et le tableau avec les imports synchrones existants.
2. Les composants de graphiques sont demandés par les imports dynamiques.
3. Tant qu'au moins un composant de la grille est suspendu, le fallback visuel « Chargement » est affiché.
4. Une fois les chunks disponibles, la grille réelle remplace le fallback sans modifier les données filtrées.
5. Lorsqu'un utilisateur ouvre une modale, son chunk est demandé.
6. Le fallback compact est remplacé par la modale réelle, qui conserve sa gestion actuelle du focus, de l'Échap et de l'accessibilité.

## Tests et validation

- Vérifier que les composants lazy sont rendus avec leurs props existantes.
- Vérifier que l'état « Chargement » est accessible et visible pendant une suspension.
- Vérifier que les trois actions d'ouverture de modale continuent de charger le composant correspondant.
- Vérifier le rendu après résolution des imports dynamiques.
- Vérifier `prefers-reduced-motion` pour l'animation du chargement.
- Exécuter `npm test`.
- Exécuter `npm run build` et contrôler que le chunk initial ne déclenche plus l'avertissement Vite, sauf nouvelle régression indépendante.
- Exécuter `git diff --check`.

## Hors périmètre

- Modifier le calcul des coûts ou le filtrage métier.
- Remplacer Recharts par une autre bibliothèque.
- Ajouter un système général de préchargement ou de cache applicatif.
- Augmenter `chunkSizeWarningLimit` pour masquer le warning.
- Modifier le format de stockage ou les API Tauri.
