# Indicateur de données mockées

## Objectif

Éviter toute confusion entre les données fictives utilisées par `npm run dev:mock` et les données réelles de `opencode.db`.

## Design

Le frontend mock affiche un bandeau permanent en haut de l'application avec le texte :

> MODE DÉMO · Données fictives

Le bandeau précise également, via un texte visible ou accessible, que l'application réelle utilise `opencode.db`.

L'indicateur est ajouté uniquement par l'entrée mock (`src/mock/tauri-mock.ts` ou son bootstrap) et n'apparaît jamais dans le build Tauri réel. Il doit rester visible sur desktop et mobile, avec un contraste suffisant et une information compréhensible par les lecteurs d'écran.

## Validation

- Le bandeau est visible avec `npm run dev:mock`.
- Il est absent du mode Tauri réel.
- Le build TypeScript et les tests frontend passent.
- Le texte est accessible et ne masque pas le contenu principal.
