# Passe de contraste des textes

## Objectif

Éliminer les cas de texte illisible ou visuellement inversé dans les thèmes clair et sombre, en particulier le texte des boutons de fermeture de la popup des tarifs. La passe conserve la direction visuelle B : texte fortement contrasté, avec des accents colorés réservés aux données et aux états.

## Périmètre

- Corriger les couleurs de texte, de fond et de bordure associées aux textes.
- Remplacer les couleurs inline ambiguës par des tokens CSS sémantiques lorsque nécessaire.
- Vérifier les en-têtes, labels, liens, boutons, champs, tableaux, badges, messages d’erreur, états désactivés et popups.
- Conserver les espacements, la typographie, la structure des composants et les couleurs d’accent des graphiques/KPI.

## Règles

- Le thème clair utilise un texte principal sombre et un texte secondaire gris foncé sur des fonds clairs.
- Le thème sombre utilise un texte principal clair et un texte secondaire gris clair sur des fonds sombres.
- Aucun texte blanc ne sera placé sur un fond clair et aucun texte noir ou très sombre sur un fond sombre.
- Les états désactivés restent distinguables sans devenir illisibles.
- Le bouton « Fermer » des tarifs doit rester lisible sur le fond de la popup, y compris lorsqu’il est désactivé.

## Validation

- Exécuter le build frontend.
- Utiliser le mode mock dans le navigateur pour inspecter les thèmes clair et sombre.
- Ouvrir les popups des tarifs, réglages et informations, et vérifier leurs boutons et messages.
- Vérifier qu’aucune régression de test frontend n’est introduite.
