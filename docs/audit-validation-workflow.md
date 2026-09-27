# Workflow de validation de l'audit

Ce document décrit les validations reproductibles de la Task 8. Elles complètent les tests unitaires et ne modifient jamais la base OpenCode.

## Fixture golden

La fixture déterministe se trouve dans `src-tauri/tests/fixtures/audit/` :

- `reference.sql` contient les lignes SQLite de test ;
- `reference-config.jsonc` contient les tarifs configurés ;
- `reference-catalog.json` contient les tarifs historiques ;
- `reference-expected.json` est l'oracle écrit manuellement.

Le test golden backend vérifie les coûts par composant, les sources de tarifs, les anomalies, les compteurs de sessions/messages et les invariants :

```bash
cd src-tauri
cargo test --test audit_test -- --nocapture
```

Le fichier `reference-expected.json` ne doit pas être régénéré par l'application. Toute modification doit être une évolution volontaire de la fixture ou de l'algorithme, revue avec les valeurs calculées à la main.

Les valeurs manuelles attendues dans l'interface sont : 7 sessions en base, 10 messages totaux, 6 sessions avec assistant, 9 messages assistant, 5 messages recalculables, 4 tarifs configurés, 2 tarifs du catalogue, 4 fallbacks de coût stocké, 1 message avec tokens manquants, 1 avec date manquante et 3 avec tarif manquant. Les totaux sont `58,50` pour le coût retenu, `513,50` pour le coût stocké et `40,00` pour le coût calculé, avec 9 anomalies.

## Test legacy réel

`acceptance_test.rs` compare le calcul de l'application au CSV produit par le script legacy à partir du même snapshot de base. Le test vérifie exactement les deux ensembles d'IDs de session (`csv - app` et `app - csv`), imprime les IDs manquants ou supplémentaires avant l'échec, puis conserve la comparaison des coûts avec la tolérance flottante existante.

Préparer une copie du fichier OpenCode et le CSV legacy, puis lancer :

```bash
cd src-tauri
ACCEPTANCE_DB=/chemin/vers/opencode-snapshot.db \
ACCEPTANCE_CSV=/chemin/vers/session-costs.csv \
cargo test --test acceptance_test -- --nocapture
```

Sur PowerShell :

```powershell
$env:ACCEPTANCE_DB = "C:\chemin\vers\opencode-snapshot.db"
$env:ACCEPTANCE_CSV = "C:\chemin\vers\session-costs.csv"
cd src-tauri
cargo test --test acceptance_test -- --nocapture
```

Sans `ACCEPTANCE_DB` ou `ACCEPTANCE_CSV`, le test affiche explicitement `SKIP` et retourne sans fabriquer de snapshot ni de CSV.

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
