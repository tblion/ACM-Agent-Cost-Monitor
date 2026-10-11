# Refonte de la gestion des tarifs — cahier des charges

Date : 2026-10-11
Statut : proposition à valider avant planification et implémentation

## Intention

Centraliser dans les réglages la consultation et la gestion des tarifs des modèles, qu’ils soient fournis par le catalogue intégré, proposés par des sources en ligne ou saisis manuellement. La même section doit également gérer les abonnements et leurs modèles couverts. Les utilisateurs doivent comprendre d’où vient chaque prix, pouvoir comparer plusieurs propositions et garder la maîtrise de tout changement, notamment de tout recalcul des coûts historiques.

## Contexte existant

- Le renderer React/TypeScript utilise une application desktop Electron et un backend .NET 10 communiquant en JSON Lines.
- `SettingsModal` est actuellement une page de réglages avec des sections, dont une section « Coûts » pour les abonnements fixes. Les abonnements comportent fournisseur, montant, périodicité, modèles couverts et dates d’effet.
- `RatesModal`, ouverte depuis les réglages, affiche les tarifs configurés/catalogue, un résumé historique et l’action de recalcul.
- Le catalogue embarqué est déjà versionné par fournisseur, modèle et `effectiveFrom`. Le calcul de coût choisit le prix configuré ou le prix catalogue applicable à la date du message, puis peut retomber sur le coût enregistré.
- Le backend lit la base OpenCode en lecture seule. Le recalcul actuel reconstruit les coûts en mémoire et ne doit jamais modifier `opencode.db`.
- Les abonnements peuvent actuellement ramener à zéro le coût des modèles couverts pendant leur période, selon leur configuration.

Cette refonte doit étendre ces mécanismes existants, et non créer un second calculateur de coûts incompatible.

## Objectifs

1. Remplacer l’accès à `RatesModal` par une section pérenne « Tarifs » dans les réglages.
2. Réunir tarifs à l’usage et abonnements dans cette section, avec des vues distinctes et une expérience cohérente.
3. Permettre la consultation et la modification de tarifs du catalogue, la création de tarifs personnalisés et l’ajout de modèles absents du catalogue.
4. Comparer plusieurs sources en ligne pour les tarifs à l’usage **et** les prix publics des abonnements.
5. Expliquer la provenance et la confiance accordée à chaque proposition sans score opaque ni application automatique.
6. Enregistrer les changements de manière historisée afin que les calculs futurs et les recalculs explicites restent compréhensibles.
7. Présenter systématiquement l’impact estimé avant d’appliquer un changement affectant les coûts historiques.
8. Ajouter des aides contextuelles aux fonctions et notions importantes, accessibles au clavier et compréhensibles sans survol.
9. Fournir une commande OpenCode propre au dépôt pour rechercher les prix publiés sur les sites officiels et mettre à jour le catalogue après validation du diff.

## Non-objectifs

- Garantir qu’un prix public d’abonnement est le prix réellement payé par l’utilisateur.
- Appliquer automatiquement le prix le moins cher, le prix officiel ou toute autre sélection algorithmique.
- Modifier `opencode.db` ou écrire les résultats de recalcul dans la base source.
- Automatiser la facturation, la connexion à des comptes fournisseurs ou la lecture des factures personnelles.
- Choisir dès cette spécification un fournisseur d’API unique. Les connecteurs et conditions d’accès restent à valider avant implémentation.

## Expérience proposée

### Navigation et présentation

- Ajouter une section « Tarifs » dans la navigation des réglages.
- Y déplacer la gestion des abonnements actuellement située dans « Coûts ».
- Supprimer l’entrée de navigation qui ouvre `RatesModal`, le déclencheur « Tarifs » associé et la modale elle-même une fois la section de remplacement fonctionnelle.
- Conserver les autres réglages, l’audit et les diagnostics à leur emplacement.
- La section comporte deux vues : « Tarifs à l’usage » et « Abonnements ». Une recherche/filtre adapté à chaque vue aide à retrouver les fournisseurs, modèles et offres.
- Ajouter des infobulles pour expliquer les filtres, sources, tarifs, abonnements, synchronisation, historique et recalcul. Les informations indispensables ne doivent pas être disponibles uniquement au survol.

### Tarifs à l’usage

Pour chaque fournisseur/modèle, afficher au minimum : fournisseur, identifiant exact du modèle, tarifs entrée/sortie et cache lorsque disponibles, unité et devise, source actuellement appliquée, date d’effet, date de dernière vérification, statut et éventuelles propositions concurrentes.

Actions :

- modifier un tarif utilisé, en créant une nouvelle version plutôt qu’en écrasant la version historique ;
- saisir un tarif personnalisé pour un modèle connu ou ajouter un modèle inconnu ;
- consulter le tarif de référence du catalogue et rétablir explicitement ce tarif comme valeur appliquée ;
- demander une actualisation/comparaison des sources en ligne ;
- choisir les champs et modèles à appliquer après comparaison.

Une liste de modèles peut proposer recherche, filtre « personnalisés », filtre « mises à jour disponibles » et filtre « utilisés dans mes données ». Toute valeur zéro doit être distinguée d’une valeur absente.

### Comparaison des sources en ligne

- Plusieurs sources sont consultées pour un même modèle ou une même offre lorsqu’elles le prennent en charge.
- Les résultats sont présentés côte à côte avec les valeurs, les unités/devises, la date de publication ou de vérification, la source et un lien ou une référence permettant de retrouver l’origine.
- L’interface signale les écarts par rapport au tarif appliqué et entre sources.
- Une proposition ne modifie rien tant que l’utilisateur ne l’a pas sélectionnée puis confirmée. La confirmation permet de choisir les modèles/champs concernés ; elle ne doit pas sélectionner silencieusement le prix minimal.
- Les sources disponibles, leur couverture, leur format, leurs limites et leurs conditions d’utilisation sont évalués avant de retenir les connecteurs initiaux. OpenRouter et LiteLLM sont des pistes évoquées, pas des choix arrêtés.
- Les requêtes réseau ne transmettent que les identifiants publics de fournisseur/modèle ou d’offre nécessaires à la recherche. Elles ne transmettent ni historique d’usage, ni coût, ni données de session.
- Si une source échoue, ses résultats manquent ou ne sont pas comparables, l’interface l’indique et conserve tous les tarifs déjà appliqués.

### Commande OpenCode de mise à jour du catalogue

- Ajouter une commande de projet OpenCode V2 sous `.opencode/commands/`, exposée comme `/update-model-prices [fournisseur/modèle ...]` (nom proposé).
- La commande recherche et lit uniquement des sources officielles des fournisseurs de modèles pour mettre à jour les tarifs à l’usage du catalogue du dépôt. Les arguments permettent de cibler un fournisseur ou un modèle ; sans argument, la commande traite les entrées de la source catalogue.
- Pour chaque changement proposé, afficher le lien officiel exact, la date de consultation, le modèle/variante correspondant, l’unité/devise et les valeurs relevées. Ne jamais inférer un prix absent, ne jamais utiliser un agrégateur comme autorité et signaler explicitement toute information non vérifiable.
- Avant écriture, présenter un diff lisible (ajouts, versions de prix et changements de valeur) et demander une approbation explicite. Un refus, une source indisponible ou une correspondance incertaine laisse les fichiers intacts.
- Après approbation, modifier la source maintenue `src-dotnet/Resources/pricing-source.json`, conserver la provenance officielle dans chaque entrée et régénérer `src-dotnet/Resources/pricing.json` par le flux existant (`npm run release:prepare` / `scripts/release-pricing.mjs`). L’historique des tarifs précédents et leurs dates d’effet doit être conservé ; les nouvelles valeurs créent une nouvelle entrée datée plutôt que d’écraser l’ancienne.
- Valider la source et le catalogue avec le générateur/validateur du projet avant de déclarer l’opération terminée. Le script de release valide un fichier temporaire avant remplacement atomique du catalogue généré ; réutiliser ce comportement. En cas d’échec, ne pas laisser le catalogue généré à moitié mis à jour ; conserver les dernières données valides.
- La commande est une instruction d’agent OpenCode, pas un script de scraping arbitraire : ne pas intégrer de bloc shell qui exécute du contenu issu du web ou interpoler des arguments non fiables dans une commande shell. Elle doit utiliser les capacités de recherche/lecture web disponibles dans la session OpenCode, puis modifier le dépôt seulement après accord.
- Son seul effet applicatif est la mise à jour des JSON de référence du dépôt. Elle ne modifie pas les tarifs personnalisés de l’utilisateur, ne lance aucun recalcul et ne réécrit aucun coût historique. La prise en compte d’un tarif dans les coûts reste soumise aux dates d’effet et au fonctionnement normal de l’application ; un recalcul des coûts existants est une action distincte, déclenchée explicitement dans l’interface.
- Cette commande met à jour le catalogue tarifaire à l’usage. Elle ne modifie pas automatiquement les abonnements personnels ni les prix publics de souscriptions ; ceux-ci restent des références à vérifier dans l’interface de gestion.

### Confiance et fraîcheur des données

Ne pas présenter une note chiffrée unique qui suggère une vérité certaine. Montrer un niveau qualitatif accompagné de raisons observables, en considérant :

1. la nature de la source (officielle, agrégateur identifié, autre) ;
2. la fraîcheur (date de publication si fournie, sinon date de dernière vérification) ;
3. la précision de correspondance (modèle/variante ou offre, région, formule, unité et devise) ;
4. l’accord ou le désaccord entre sources indépendantes.

Exemples de formulation : « confiance élevée — tarif officiel, modèle exact, vérifié récemment » ; « à vérifier — source secondaire, région non précisée ». L’accord entre sources est un indice, jamais une preuve. Les raisons sont visibles dans l’interface et dans l’infobulle associée.

### Abonnements

- Conserver les fonctions existantes : fournisseur, nom/formule si disponible, montant réellement payé, périodicité, devise, date de début/fin et modèles couverts.
- Préserver les abonnements existants lors de la migration ; ne pas les remplacer par les prix publics trouvés en ligne.
- Les prix détectés en ligne sont des références à comparer et à valider. Ils ne changent jamais automatiquement le montant payé enregistré.
- Les résultats de comparaison doivent préciser, lorsque connu, région, devise, périodicité, taxes incluses/exclues, type d’offre et date de vérification. Une offre dont la variante est ambiguë ne doit pas être présentée comme directement équivalente.
- La saisie manuelle reste disponible même sans correspondance ou source en ligne.
- Historiser les modifications d’abonnement et conserver les périodes/modèles couverts nécessaires à l’interprétation des coûts.

## Règles de dates et de calcul

- Chaque nouveau tarif appliqué porte une date d’effet explicite. Par défaut, la nouvelle valeur s’applique aux usages datés à partir de cette date ; elle ne remplace pas rétroactivement les versions antérieures.
- Les abonnements conservent leurs intervalles effectifs et leur couverture de modèles.
- Les tarifs servant au calcul doivent être traçables : valeur, fournisseur/modèle ou abonnement, provenance et intervalle/date d’effet.
- Les priorités actuelles du calcul de coût sont préservées, sauf décision contraire documentée lors du plan : couverture abonnement selon sa période, tarif personnalisé appliqué, tarif catalogue applicable à la date, puis coût enregistré en fallback.
- L’écran de recalcul historique doit toujours présenter un aperçu avant confirmation : nombre de messages/sessions concernés, coûts avant/après estimés, écart total, cas non recalculables et raisons (date/tokens/tarif manquants, fallback).
- Le recalcul reste non destructif pour `opencode.db`. Les changements de prix ne recalculent pas silencieusement les données affichées ; l’utilisateur déclenche explicitement l’opération.

### Recalcul historique

- La mise à jour du JSON de référence par la commande OpenCode ne recalcule ni ne remplace aucun coût historique.
- L’interface de l’application conserve une action de recalcul historique distincte, lancée uniquement sur demande explicite et précédée d’un aperçu d’impact.
- Le recalcul utilise les tarifs versionnés applicables à la date de chaque message. Aucun mode « appliquer le tarif actuel à tout le passé » n’est prévu dans cette refonte.
- Une nouvelle version tarifaire ne change donc que les usages dont la date est couverte par sa date d’effet ; les tarifs historiques antérieurs restent disponibles.

## Persistance et architecture — orientations proposées

- Garder le catalogue intégré comme référence de l’application et ne pas le modifier sur disque lors d’une édition utilisateur.
- Stocker séparément les changements appliqués, les versions effectives, les modèles personnalisés et les métadonnées de provenance dans le stockage applicatif approprié ; préserver les données existantes et supporter une migration sans perte.
- Garder distincts les résultats candidats d’une comparaison en ligne et les tarifs effectivement appliqués. Un résultat candidat ne devient pas automatiquement une version tarifaire.
- Évaluer avec le backend .NET les fournisseurs d’accès réseau, la validation stricte des entrées externes, la gestion des devises, les erreurs/réessais et le format de persistance, avant de figer les contrats API.
- Réutiliser le service de calcul versionné et le contrat `AppDataSource` plutôt que faire porter la logique de coût au renderer.
- Ne pas introduire de secrets d’API ou d’identifiants de compte dans les réglages sans décision explicite distincte.

Ces orientations sont des propositions d’architecture, pas des décisions de schéma définitives.

### Périmètre initial de comparaison (vérifié le 11 octobre 2026)

- **Références officielles d’usage** : OpenAI (`https://developers.openai.com/api/docs/pricing`), Anthropic (`https://platform.claude.com/docs/en/about-claude/pricing`) et Google Gemini API (`https://ai.google.dev/gemini-api/docs/pricing`). Pages accessibles sans identifiant, avec tarifs principalement exprimés en USD par million de tokens. Leurs dimensions divergent (seuils de contexte, batch/fast/flex, cache, région, promotions) : normaliser uniquement les champs réellement compatibles et conserver la provenance.
- **Agrégateur d’usage** : LiteLLM publie `https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json`, accessible sans secret et sous licence MIT hors répertoire enterprise. Source communautaire, couverture/fraîcheur non garanties, identifiants parfois ambigus et provenance incomplète : la présenter comme agrégateur, jamais comme preuve officielle ; aucun rapprochement approximatif ne doit être appliqué automatiquement.
- **OpenRouter** : l’endpoint documenté `/api/v1/models` fournit identifiants et prix normalisés, mais sa définition OpenAPI consultée déclare une sécurité Bearer. Exclu du premier connecteur tant qu’un accès public sans clé n’est pas établi ; ne pas demander ni stocker de clé pour contourner cette limite.
- **Abonnements publics** : pages officielles Anthropic (`https://claude.com/pricing`), OpenAI (`https://chatgpt.com/pricing/`) et Google (`https://one.google.com/intl/en_us/about/google-ai-plans/`) consultables sans secret, mais région, devise, taxes, périodicité, promotions et avantages groupés peuvent varier. Ne présenter comme comparable que si offre, région, devise et période sont identifiables ; une valeur ambiguë reste conditionnelle/inconnue et ne remplace jamais le montant réellement payé.
- **Décision** : démarrer par les pages officielles fournisseur et LiteLLM pour l’usage ; pour les abonnements, utiliser les pages officielles seulement quand les dimensions de comparaison sont explicites. Les erreurs sont isolées par source. Quand une seule source est exploitable pour un modèle ou une formule, montrer le candidat seul sans fabriquer d’accord ; les sources indisponibles ou ambiguës restent signalées comme telles.

## Contraintes et qualité

- Conserver le mode démonstration et les scénarios E2E isolés.
- Respecter TypeScript strict, l’accessibilité WCAG 2.2 / RGAA 4.1.2, les traductions française et anglaise et les conventions du projet.
- Fournir états de chargement, absence de résultats, erreurs réseau/validation, confirmation et résultat accessible aux lecteurs d’écran.
- Ne pas remplacer une dernière donnée valide par une réponse incomplète ou invalide d’une source.
- La mise à jour d’une source ne doit pas bloquer l’affichage des tarifs existants ; chaque source conserve un état/erreur indépendant.
- Les tests C# restent désactivés temporairement selon les instructions du dépôt ; la validation attendue lors de l’implémentation sera E2E Playwright et/ou scénarios MCP/API autorisés.

## Critères d’acceptation

1. Les tarifs et abonnements sont tous gérables depuis une section Tarifs des réglages ; l’ancienne modale et son entrée sont retirées sans perdre de fonction nécessaire.
2. L’utilisateur peut ajouter un modèle, saisir ou modifier ses tarifs, définir leur date d’effet et retrouver leur provenance/historique.
3. Les propositions de plusieurs sources sont comparables pour prix à l’usage et prix publics d’abonnement, avec écarts, unité/devise, fraîcheur et éléments justifiant leur niveau de confiance.
4. Une source en ligne n’écrase jamais un tarif appliqué ni un montant réellement payé sans sélection et confirmation explicites.
5. Un abonnement existant reste intact après migration et peut toujours être saisi/modifié manuellement.
6. Les nouveaux tarifs n’altèrent pas implicitement les coûts historiques ; tout recalcul affiche un aperçu d’impact avant confirmation.
7. Les coûts recalculés conservent les diagnostics/provenances nécessaires, et `opencode.db` reste strictement en lecture seule.
8. Les outils essentiels ont des explications accessibles au survol et au clavier, et les actions/états restent opérables sans souris.
9. Les scénarios E2E couvrent les changements de tarifs, la comparaison/sélection de sources, les abonnements, la migration et l’aperçu/confirmation du recalcul.
10. La commande OpenCode ne modifie aucun fichier sans approbation du diff, utilise des références officielles vérifiables, conserve les anciennes versions et laisse les fichiers valides intacts en cas d’échec de recherche ou de validation.

## Décisions déjà prises avec l’utilisateur

- La gestion des tarifs sera une section dédiée des réglages ; l’interface actuelle de tarifs sera supprimée.
- La section couvre tarifs par usage et abonnements.
- L’utilisateur pourra consulter/modifier les tarifs du catalogue, saisir ses propres prix et ajouter des modèles.
- Plusieurs sources seront comparées pour les tarifs à l’usage et les abonnements.
- Les prix en ligne ne sont que des propositions ; pour un abonnement, le montant réellement payé reste la valeur enregistrée tant que l’utilisateur ne le modifie pas.
- La confiance est expliquée par critères visibles, sans score unique opaque.
- Les changements sont datés, conservés et ne réécrivent pas seuls l’historique ; tout recalcul explicite montre toujours son impact.
- Des infobulles expliquent les fonctions et notions de la section.
- Une commande OpenCode du dépôt recherche sur les sites officiels et met à jour le catalogue tarifaire après présentation et approbation du diff.

## À la charge du plan d’implémentation

- Vérifier les sources candidates, leurs licences/conditions, couverture, fraîcheur, devise, éventuelles limites de requêtes et accès sans secret.
- Arrêter le modèle de persistance et la stratégie de migration réversible, sans perte des abonnements ni des coûts stockés.
- Définir la gestion des devises et les correspondances fournisseur/modèle/offre sans rapprochement hasardeux.
- Préciser le flux d’import, les conflits de versions et la sélection partielle des champs/modèles.
- Vérifier la disponibilité, dans les sessions OpenCode utilisées par l’équipe, d’outils de recherche/lecture web permettant à la commande de citer les pages officielles ; définir un comportement explicite si ces outils ne sont pas disponibles.
- Décomposer la refonte en étapes vérifiables sans commencer l’implémentation avant approbation de cette spécification.
