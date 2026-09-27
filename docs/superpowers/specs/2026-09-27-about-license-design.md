# Fenêtre À propos et licence MIT

## Objectif

Rendre la fenêtre « À propos » plus claire et plus compacte en supprimant l'adresse email et la mention de l'auteur, en affichant un lien fonctionnel vers le dépôt GitHub et en présentant la licence MIT complète.

## Décisions

- Le nom de l'application et sa description restent visibles en tête de fenêtre.
- La mention « Développé par Thomas Blion » est supprimée.
- Toute adresse email ou lien `mailto:` est absente de la fenêtre.
- Le lien « GitHub du projet » cible `https://github.com/tblion/OpencodeCostsViewer`.
- Le lien « Licence MIT · LICENSE » cible `https://github.com/tblion/OpencodeCostsViewer/blob/main/LICENSE`.
- Les deux liens s'ouvrent dans le navigateur externe afin de fonctionner depuis l'application Tauri.
- Le texte intégral de `LICENSE` est visible dans la fenêtre, dans une zone scrollable à hauteur limitée.
- La largeur et la hauteur de la fenêtre restent contenues sur desktop et mobile ; la licence défile sans agrandir la fenêtre.
- Les libellés français et anglais sont ajoutés aux ressources i18n existantes.

## Architecture

`AboutModal` conserve son rôle de dialogue, son focus initial, son piège de focus, la fermeture par Échap et la restauration du focus. Le contenu est réorganisé en quatre blocs : identité, liens du projet, bloc de licence scrollable et actions.

Le texte légal affiché correspond au fichier racine `LICENSE`, sans modification de son contenu. L'ouverture externe utilise l'intégration Tauri existante ou, si nécessaire, le mécanisme de repli adapté au navigateur de développement.

Les styles de la modale définissent une hauteur maximale relative à la fenêtre, une zone de licence avec `overflow: auto`, une largeur responsive et des états de focus visibles conformes aux conventions existantes.

## Validation

Les tests frontend vérifient :

- la présence des deux liens avec leurs URLs exactes ;
- l'absence de l'email et de la mention de l'auteur ;
- la présence du texte complet de la licence MIT ;
- le rôle de dialogue et les contrôles de fermeture existants ;
- la conservation des libellés français et anglais.

Le build frontend et les tests frontend ciblés sont exécutés avant de considérer la modification terminée.
