# Provenance des coûts

## Objectif

Distinguer clairement les coûts recalculés avec un tarif local des coûts déjà enregistrés par OpenCode dans `opencode.db`. L'application ne doit pas présenter un coût historique comme un tarif confirmé par le provider.

## Vocabulaire

Chaque coût porte une provenance explicite :

- `Configured` : tarif trouvé dans le catalogue versionné embarqué ou dans `opencode.jsonc`/`opencode.json`, puis coût recalculé à partir des tokens.
- `Stored` : aucun tarif local trouvé ; valeur `message.cost` reprise telle quelle depuis la base.
- `Estimated` : tarif éventuellement déduit statistiquement de la base, uniquement informatif et jamais utilisé automatiquement pour calculer le total.

La première version implémente `Configured` et `Stored`. `Estimated` est réservé à une évolution future.

## Résolution de configuration

Le backend doit rechercher la configuration OpenCode selon cet ordre pour les tarifs explicitement configurés par l'utilisateur :

1. chemin personnalisé défini dans les réglages ;
2. `~/.config/opencode/opencode.jsonc` ;
3. `~/.config/opencode/opencode.json`.

Le parsing JSONC reste appliqué aux deux formats. Une configuration absente, invalide ou sans bloc `cost` produit zéro tarif configuré local sans empêcher la lecture de la base. Le catalogue versionné embarqué est chargé séparément et constitue la source de référence pour le calcul historique.

## Calcul backend

Pour chaque message assistant, la priorité de calcul est strictement : **override local explicite > catalogue versionné applicable > `message.cost` Stored**.

- si un tarif explicitement configuré par l'utilisateur existe pour le couple exact `providerID/modelID`, calculer le coût avec cet override et les tokens `input`, `output`, `cache.read`, `cache.write` et `reasoning` ; la provenance est `Configured` ;
- sinon, si un tarif versionné applicable existe pour le couple exact et la date du message, calculer le coût avec ce tarif ; la provenance est `Configured` ;
- sinon, reprendre `message.cost` ; la provenance est `Stored`.

Les coûts `Stored` ne sont pas recalculés et aucun tarif estimé ne modifie le total. L'agrégation par session et l'ajout visuel des sous-sessions restent inchangés.

## Catalogue de tarifs versionné

Le catalogue de référence couvre tous les providers et est généré automatiquement lors de la préparation d'une release, puis embarqué dans l'application. Dans ce dépôt, la source par défaut est explicitement la fixture locale synthétique `src-tauri/catalog/pricing-source.json` et ne constitue pas une source live provider. L'application doit rester utilisable hors ligne avec le dernier catalogue embarqué.

Chaque entrée de tarif est identifiée par le couple exact `providerID/modelID` et contient au minimum :

- `effectiveFrom`, date et heure UTC à partir desquelles le tarif s'applique ;
- tarifs `input`, `output`, `cacheRead` et `cacheWrite` par million de tokens ;
- une provenance permettant d'identifier la source et la version du catalogue.

Plusieurs versions peuvent exister pour un même modèle. Pour chaque message, le calcul sélectionne le tarif dont `effectiveFrom` est la plus récente parmi les dates antérieures ou égales à la date du message. La date du message doit être privilégiée à la date de création de la session.

Le catalogue doit être validé avant chaque release. La validation vérifie notamment :

- la conformité au schéma JSON ;
- les providers et modèles non vides ;
- des dates UTC valides et ordonnées ;
- des tarifs numériques, finis et non négatifs ;
- l'absence de doublons ou de périodes qui se chevauchent pour un même modèle ;
- la présence d'une version exploitable pour chaque entrée ;
- la compatibilité avec les modèles couverts par les fixtures de test.

Une erreur de téléchargement, de génération ou de validation doit faire échouer la génération de la release plutôt que produire un catalogue partiel ou silencieusement vide.

## Recalcul historique

Le coût calculé par l'application est une donnée dérivée des messages, des tokens et du tarif applicable. Il ne doit pas être écrit dans `opencode.db` et l'application ne doit jamais modifier cette base, y compris lors d'un recalcul.

Une action explicite « Recalculer les coûts » permet de recalculer les montants en mémoire après une correction du catalogue, notamment d'un tarif historique. Le bouton doit :

- expliquer que les coûts affichés peuvent changer ;
- demander une confirmation avant l'opération ;
- vérifier qu'un catalogue valide est chargé ;
- signaler le nombre de messages qui seront recalculés et ceux sans date, tokens ou tarif applicable ;
- rafraîchir les sessions, agrégats et récapitulatifs sans écrire dans la base OpenCode.

Le coût `message.cost` fourni par OpenCode reste une référence secondaire lorsqu'aucun tarif versionné applicable n'est disponible. L'interface doit distinguer clairement ce coût stocké d'un coût recalculé.

Le backend expose la provenance au niveau session/modèle et un récapitulatif par provider/modèle contenant au minimum : nombre de messages, coût cumulé, présence d'un tarif configuré et présence d'un coût stocké.

## Fenêtre Tarifs

La fenêtre remplace la liste unique actuelle par deux sections :

### Tarifs configurés

Liste des modèles présents dans la configuration, avec provider, modèle et composantes tarifaires.

### Coûts historiques détectés

Liste des couples provider/modèle ayant au moins un `message.cost` positif dans la base, avec nombre de messages et coût cumulé. Chaque ligne porte le badge `Historique OpenCode`.

Si un modèle est présent dans les deux sections, l'interface affiche les deux sources et précise que les sessions utilisent le tarif configuré.

Si aucun tarif configuré n'est trouvé, afficher une explication indiquant que les coûts visibles proviennent des coûts historiques enregistrés par OpenCode.

## Dashboard et sessions

- Le montant du KPI `Coût total` ne change pas.
- Le KPI expose la répartition entre coûts `Configuré` et `Historique OpenCode`.
- Le badge actuel `coût 0` devient `Configuré` ou `Historique` selon la provenance réelle.
- Une session parent continue d'afficher son coût propre plus celui de ses sous-sessions ; chaque sous-session conserve sa propre provenance.

## Tests et critères d'acceptation

Les tests couvrent :

- modèle uniquement présent dans la configuration ;
- modèle uniquement présent dans la base ;
- modèle présent dans les deux sources ;
- configuration `.jsonc`, `.json`, absente et invalide ;
- coûts stockés nuls ;
- agrégation parent/sous-session ;
- récapitulatif par provider/modèle ;
- sélection du tarif selon la date du message ;
- changement de tarif entre deux dates d'effet ;
- correction d'un tarif historique suivie d'un recalcul ;
- validation du catalogue : schéma, dates, tarifs, doublons et chevauchements ;
- échec de release lorsqu'une source ou un catalogue est invalide ;
- vérification qu'un recalcul n'écrit jamais dans `opencode.db`.

Le test d'acceptation legacy reste obligatoire si la logique numérique du coût est modifiée. La modification ne doit pas faire utiliser les tarifs estimés dans le total.
