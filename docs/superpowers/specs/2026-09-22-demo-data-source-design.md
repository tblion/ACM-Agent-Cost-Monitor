# Mode démo persistant et données générées

## Objectif

Permettre à l'utilisateur d'activer un mode démo depuis les réglages de l'application. Ce mode remplace, uniquement en mémoire, les données issues de `opencode.db` par un jeu de données réaliste, déterministe et anonymisé. Le mode doit rester disponible en ligne de commande via `npm run dev:mock`.

## Décisions

- Le mode démo est désactivé par défaut dans l'application packagée.
- Le choix `demo` ou `real` est persistant jusqu'à désactivation explicite.
- `npm run dev:mock` force toujours le mode démo, indépendamment du choix persistant.
- Le mode démo ne lit pas `opencode.db`, ne l'écrit pas et ne contacte aucun provider. Il ne déclenche pas les commandes Tauri de données `get_data`, `get_rates` ou `get_cost_summary`, mais peut utiliser les commandes de réglages nécessaires à l'application.
- Le mode réel conserve le comportement actuel et utilise les commandes Tauri existantes.
- Les providers et modèles peuvent conserver leurs marques et noms réels.
- Les projets, chemins, descriptions et noms de sessions de la démo sont fictifs.
- Les tarifs actuels sont appliqués uniformément sur toute la période ; aucun historique de prix n'est simulé. Le catalogue de modèles utilisés pour les coûts historiques peut contenir des couples absents de la configuration locale afin de représenter la provenance `stored`, mais leurs tarifs de calcul restent actuels et fixes.

## Architecture des sources

Le frontend utilise une source de données unique exposant les mêmes résultats que l'API réelle : données de sessions, tarifs et résumé des coûts.

En mode `real`, cette source appelle `getData`, `getRates` et `getCostSummary` via Tauri. En mode `demo`, elle appelle le générateur local en mémoire et ne déclenche aucune commande Tauri qui lit SQLite.

Le choix est conservé dans `localStorage`, avec `real` comme valeur par défaut. La variable `VITE_OPENCODE_MOCK=true`, injectée par `vite.config.mock.ts`, est prioritaire sur cette valeur et impose `demo`.

Le changement de mode depuis `SettingsModal` recharge toutes les données immédiatement. Le bandeau `MODE DÉMO · Données fictives` est affiché tant que la source active est `demo`, dans le navigateur mock comme dans l'application Tauri. Le bandeau rappelle que les données réelles de `opencode.db` ne sont pas utilisées.

Le générateur est séparé de `src/mock/tauri-mock.ts` afin de pouvoir fonctionner dans l'application Tauri packagée et dans le navigateur mock. Les données ne sont jamais persistées.

## Générateur démo

Le générateur produit une fenêtre glissante de 24 mois terminée à la date de chargement. Une graine dérivée de la date du jour garantit qu'un même jour produit le même jeu de données, tandis que la fenêtre avance naturellement le lendemain. Aucun timestamp ne doit être futur ou sortir de la fenêtre.

Le catalogue utilise les providers et modèles suivants :

- Anthropic : Claude Sonnet 4.6 et Claude Haiku 4.5 ;
- OpenAI : GPT-5.4, GPT-5.4 mini et GPT-4.1 ;
- Mistral : Mistral Medium 3.5, Mistral Small 4 et Codestral.

Les tarifs actuels input, output, cache read, cache write et reasoning nécessaires au calcul sont centralisés par modèle. Ils sont utilisés pour calculer les coûts à partir des tokens, avec les mêmes règles que le backend réel.

L'activité simule un développeur IA réel : plusieurs projets fictifs, volumes variables par semaine, périodes creuses, sessions courtes fréquentes, sessions longues occasionnelles et reprise d'activité. Les sessions couvrent les scénarios utiles à l'interface :

- sessions mono-modèle et multi-modèles ;
- sous-agents avec relations parent/enfant ;
- modèles avec coûts `configured` ;
- modèles avec coûts `stored` ;
- sessions mixtes dont la provenance est visible par modèle ;
- quelques sessions à coût nul ;
- providers et modèles regroupables dans les filtres et graphiques.

Le générateur construit les sessions, modèles, messages, agrégats de coûts, tarifs et résumé des coûts attendus par l'application. Il ne fait aucun appel réseau.

## Interface

`SettingsModal` expose une bascule accessible avec deux états explicites :

- `Mode réel — données de opencode.db` ;
- `Mode démo — données générées en mémoire`.

Le changement est appliqué immédiatement après confirmation ou activation du contrôle. Le reste de l'interface conserve ses filtres, groupes, badges de provenance, KPI, tableaux, graphiques et fenêtre Tarifs.

## Tests et validation

Les tests frontend vérifient :

- le mode réel par défaut ;
- la persistance du choix et sa désactivation ;
- la priorité du flag `VITE_OPENCODE_MOCK` ;
- l'absence d'appels `get_data`, `get_rates` et `get_cost_summary` en mode démo ;
- le retour au mode réel ;
- le déterminisme pour une même date et la variation pour une date différente ;
- la fenêtre de 24 mois, les bornes et l'absence de dates futures ;
- l'absence de projets ou chemins réels dans les fixtures ;
- la cohérence des coûts, du résumé et de la ventilation des sources ;
- les filtres, groupes, sous-sessions et badges de provenance.

La validation manuelle utilise le navigateur mock pour le bandeau et la bascule, puis un lancement Tauri réel pour confirmer que le mode réel continue de lire les données existantes. Les commandes attendues sont `npm test`, `npm run build` et `npm run dev:mock`. Aucun test ne modifie la base utilisateur.
