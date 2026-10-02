# Workflow de validation de l'audit

Ce document décrit les validations reproductibles de l'audit. Elles ne modifient jamais la base OpenCode.

## Fixture golden

La fixture de référence se trouve dans `src/fixtures/audit/` :

- `reference.sql` contient les lignes SQLite de test ;
- `reference-config.jsonc` contient les tarifs configurés ;
- `reference-catalog.json` contient les tarifs historiques ;
- `reference-expected.json` est l'oracle écrit manuellement.

`src/demo/audit-fixture.test.ts` conserve une comparaison golden du rapport de démonstration. Les parcours de validation autorisés lancent les scénarios E2E navigateur et Electron avec les fixtures isolées :

```bash
npm run test:e2e
npm run test:e2e:electron
```

Le fichier `reference-expected.json` ne doit pas être régénéré par l'application. Toute modification doit être une évolution volontaire de la fixture ou de l'algorithme, revue avec les valeurs calculées à la main.

Les valeurs manuelles attendues dans l'interface sont : 7 sessions en base, 10 messages totaux, 6 sessions avec assistant, 9 messages assistant, 5 messages recalculables, 4 tarifs configurés, 2 tarifs du catalogue, 4 fallbacks de coût stocké, 1 message avec tokens manquants, 1 avec date manquante et 3 avec tarif manquant. Les totaux sont `58,50` pour le coût retenu, `513,50` pour le coût stocké et `40,00` pour le coût calculé, avec 9 anomalies.

## Vérification MCP Chrome

Démarrer le frontend mock :

```bash
npm run dev:mock
```

Ouvrir l'URL locale affichée par Vite avec MCP Chrome. Le scénario attendu est :

1. ouvrir `Audit` depuis l'en-tête ;
2. vérifier les compteurs et les totaux manuels de la fixture ;
3. générer l'audit avec `Actualiser l'audit` ;
4. ouvrir une ligne et vérifier les tokens, les cinq composants de coût, le total et la source du tarif ;
5. filtrer successivement par anomalie, session, provider, modèle et source de coût ;
6. vérifier que les exports JSON/CSV sont désactivés avant la première génération puis disponibles après une génération valide ;
7. vérifier la date de dernière génération et l'indicateur de rapport obsolète après une modification des données ;
8. parcourir les boutons, filtres et lignes au clavier, puis vérifier les annonces `aria-live` de chargement et les erreurs `role="alert"`.

Pour un contrôle rapide dans MCP Chrome, vérifier notamment le rôle du bouton `Actualiser l'audit`, les intitulés des cinq filtres, le tableau avec son caption, `aria-expanded` sur une ligne ouverte et les boutons d'export désactivés avant génération.

## Lecture seule

Toutes les validations ouvrent la base source en lecture seule et calculent les résultats en mémoire. Les exports écrivent uniquement le fichier explicitement choisi par l'utilisateur. Aucun test d'audit ne doit migrer, réécrire ou réparer `opencode.db`.
