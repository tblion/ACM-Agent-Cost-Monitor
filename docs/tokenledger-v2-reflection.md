# TokenLedger V2 - Note de cadrage

Cette note conserve la réflexion initiale sur l'évolution d'Opencode Costs Viewer vers une application multi-agents et multi-providers.

Le nom **TokenLedger** est provisoire.

## Vision

L'application ne doit plus être dépendante d'OpenCode. Elle doit devenir un registre local capable de récupérer, normaliser et analyser l'utilisation de plusieurs agents de développement et de plusieurs providers.

Les agents et les providers doivent être deux concepts distincts :

- un agent produit une session ou une utilisation ;
- un provider fournit des modèles et définit la facturation ;
- un modèle peut être gratuit, inclus dans une formule ou facturé au token.

Agents à étudier en priorité :

- OpenCode ;
- Codex CLI ;
- Claude Code ;
- Aider ;
- Cline ;
- Kilo Code ;
- Roo Code ;
- Continue ;
- Goose ;
- OpenHands ;
- Qwen Code.

Première vague d'adaptateurs spécialisés retenue :

- OpenCode ;
- Kilo Code.
- Cline ;
- Claude Code ;
- Codex CLI.

Priorité produit retenue :

1. OpenCode ;
2. Kilo Code ;
3. Cline ;
4. Claude Code ;
5. Codex CLI.

Aider et les autres agents restent dans une seconde phase.

Les autres agents pourront passer par l'import générique JSON, JSONL ou CSV.

La première version lit uniquement les données locales présentes sur la machine. Elle ne doit pas appeler les API des providers pour reconstituer l'historique d'utilisation.

Les adaptateurs locaux restent indépendants de la synchronisation des catalogues et des tarifs.

## Initialisation de TokenLedger V2

La V2 démarre avec une base TokenLedger vide. Il n'y a pas de migration directe du schéma actuel.

OpenCode devient un agent parmi les autres via son propre module. Ce module peut relire `opencode.db` en lecture seule et effectuer un premier import contrôlé de l'historique existant.

Le premier démarrage suit donc le même flux qu'une nouvelle source :

```text
détection de opencode.db
  -> aperçu des données trouvées
  -> confirmation de l'import
  -> normalisation dans TokenLedger
```

Le premier import récupère tout l'historique disponible par défaut. Une limitation à une période pourra être ajoutée plus tard comme option, mais ne sera pas le comportement standard.

Le même mécanisme sera utilisé pour les autres agents. Une synchronisation ultérieure ne doit importer que les nouvelles données ou les changements détectés.

## Facturation

Chaque provider peut combiner plusieurs modes de facturation :

- modèle gratuit ou local ;
- coût fixe mensuel ;
- coût variable au token ;
- formule hybride ;
- coût inconnu.

Le **coût fixe mensuel** est compté une seule fois lorsqu'un provider est utilisé au moins une fois pendant le mois calendaire concerné.

Exemple : si trois projets utilisent Openrama pendant janvier, le coût fixe mensuel de 10 USD est compté une seule fois, pas trois fois.

Le total réel suit cette règle :

```text
coûts fixes mensuels des providers utilisés
+ coûts variables des modèles facturés au token
```

Un modèle inclus dans un coût fixe mensuel a un coût variable de zéro. Un modèle local ou gratuit a également un coût de zéro.

Les coûts fixes mensuels sont associés à un compte ou une formule. Un même provider peut donc avoir plusieurs comptes :

```text
provider + compte + formule + période
```

Les périodes sont actuellement des mois calendaires, mais sont stockées avec une vraie date de début et une vraie date de fin afin de permettre plus tard des périodes de facturation personnalisées.

## Coût réel et prix théorique

Pour un provider facturé par abonnement, un calcul au token n'est pas nécessairement représentatif de la facture réelle.

L'application doit donc distinguer :

- **coût fixe mensuel** : montant réellement payé pour la formule ;
- **coût variable d'utilisation** : montant réellement calculé au token lorsque le provider le facture ainsi ;
- **coût théorique au token** : estimation de ce que l'utilisation aurait coûté avec une tarification au token ;
- **coût inconnu** : lorsque les informations disponibles ne permettent pas de calculer le montant.

Le coût théorique est toujours affiché séparément et ne doit jamais être additionné au coût réel.

## Projets et coûts fixes

Un coût fixe mensuel ne doit pas être copié dans chaque projet utilisant le provider, car cela créerait un faux total.

Dans une vue projet, l'application peut indiquer :

```text
Provider utilisé : Openrama
Coût variable : 0 USD
Coût fixe : couvert par la formule Openrama
```

Le coût fixe reste compté une seule fois dans la vue globale ou dans la vue du provider.

## Devises

Le montant original et sa devise sont toujours conservés.

L'application peut afficher une conversion indicative avec le taux actuel au moment de l'affichage :

```text
10,00 USD
9,21 EUR
Taux utilisé : 1 USD = 0,921 EUR
```

La conversion :

- ne modifie pas le montant original ;
- affiche le taux utilisé ;
- est indicative ;
- n'a pas besoin d'être conservée historiquement pour l'instant.

## Configuration et synchronisation

Les providers, comptes, formules, modèles et tarifs doivent pouvoir être modifiés manuellement.

L'application peut proposer plusieurs sources :

- catalogue officiel du provider ;
- API du provider ;
- fichier local ;
- import JSON ou CSV ;
- saisie manuelle.

Une vérification est effectuée au démarrage. Elle ne modifie rien automatiquement. Si des différences sont détectées, l'application affiche une indication :

```text
Synchronisation disponible
3 ajouts · 2 modifications · 1 archivage
```

La comparaison doit montrer les différences et permettre :

- un choix ligne par ligne ;
- `Tout accepter` ;
- `Tout refuser` ;
- de remettre un changement à plus tard.

En cas de conflit entre plusieurs sources, aucune priorité automatique ne doit écraser une valeur. La différence est affichée et l'utilisateur choisit.

Les éléments supprimés par une source sont archivés, pas effacés. Ils restent disponibles pour l'historique mais ne sont plus proposés pour les nouvelles utilisations.

## Base SQLite TokenLedger

Les bases et fichiers des agents restent des sources externes lues sans modification. TokenLedger possède sa propre base SQLite locale, commune à tous les agents et providers.

Flux général :

```text
détection
  -> import
  -> déduplication
  -> normalisation
  -> stockage SQLite
  -> calcul des coûts
  -> affichage
```

La base doit conserver notamment :

- les agents ;
- les providers ;
- les comptes ;
- les modèles ;
- les formules ;
- les coûts fixes mensuels ;
- les tarifs ;
- les utilisations ;
- les sources ;
- les synchronisations ;
- les versions de calcul ;
- les éléments archivés.

Une utilisation importée doit avoir une référence stable, par exemple :

```text
source + identifiant externe
```

Une nouvelle synchronisation ne doit donc jamais compter deux fois la même session ou le même événement.

## Données et calculs séparés

Les données d'utilisation et les résultats de calcul doivent être stockés séparément.

### Données d'utilisation

Cette partie décrit uniquement ce qui s'est passé :

- agent ;
- provider ;
- compte ;
- modèle ;
- projet ;
- session ;
- date ;
- tokens ;
- identifiant de source ;
- référence externe.

Ces données ne doivent pas dépendre d'un tarif ou d'un algorithme particulier.

### Résultats de calcul

Les résultats sont générés à partir :

- des données d'utilisation ;
- des tarifs ;
- des coûts fixes mensuels ;
- de la devise ;
- de la version de l'algorithme.

Chaque calcul doit référencer :

- la version de l'algorithme ;
- la version des tarifs ;
- la date du calcul ;
- les résultats produits ;
- son statut `current` ou `superseded`.

Si l'algorithme est corrigé, un nouveau calcul est créé sans modifier les données d'utilisation ni les anciens résultats.

Les anciens calculs sont conservés afin de pouvoir comparer les résultats, détecter une régression et expliquer un changement de montant.

## Corrections manuelles

Les données importées ne sont jamais modifiées directement par une correction utilisateur.

Une correction est enregistrée séparément comme une surcharge locale, par exemple pour :

- associer un modèle à un autre provider ;
- corriger l'identification d'un projet ;
- compléter un compte ou une formule ;
- remplacer un tarif erroné ;
- corriger une date ou une devise.

Lors d'un calcul, la surcharge locale est appliquée après l'import. Une nouvelle synchronisation ne doit pas l'effacer. Elle doit toutefois signaler si la donnée source change et si la correction entre en conflit avec cette nouvelle valeur.

## Adaptateurs d'agents

Approche recommandée :

- adaptateurs spécialisés pour les agents prioritaires ;
- import générique JSON, JSONL ou CSV pour les autres ;
- format interne commun pour les sessions et utilisations ;
- indication explicite des données estimées, inconnues ou incomplètes.

L'application tente d'abord de détecter automatiquement les fichiers de sessions. Une configuration manuelle est proposée si aucune source n'est trouvée.

## Architecture modulaire

Le code doit être organisé en modules indépendants et maintenables.

### Modules d'agents

Un module d'agent est responsable de :

- détecter les fichiers ou bases locales ;
- lire les données sans les modifier ;
- reconnaître les sessions et les projets ;
- extraire les tokens, le provider et le modèle ;
- produire le format d'utilisation interne de TokenLedger ;
- signaler les champs absents ou estimés.

Exemples :

```text
agents/opencode
agents/codex
agents/claude-code
agents/aider
agents/cline
agents/kilo-code
```

Chaque agent possède son propre fichier ou module, ses propres types de parsing et ses propres tests. Même lorsque deux agents semblent partager un format ou une origine, ils ne partagent pas automatiquement leur adaptateur.

La mutualisation est limitée au noyau et aux utilitaires clairement génériques : lecture SQLite en lecture seule, lecture JSONL, déduplication, normalisation finale et diagnostics. Une différence future entre deux agents doit pouvoir être traitée dans un seul module sans effet de bord sur l'autre.

### Modules de providers

Un module de provider est responsable de :

- connaître les modèles du provider ;
- synchroniser ou importer les tarifs ;
- gérer les coûts fixes mensuels ;
- reconnaître les formules et les comptes ;
- indiquer la devise et la période ;
- appliquer les règles de facturation.

Exemples possibles :

```text
providers/openai
providers/anthropic
providers/google
providers/openrouter
providers/ollama
providers/custom
```

Un agent et un provider restent indépendants. Codex peut utiliser plusieurs providers et un provider peut être utilisé par plusieurs agents. Il ne faut donc pas créer des modules couplés tels que `codex-openai` ou `claude-code-anthropic`.

### Noyau commun

Le noyau TokenLedger reste indépendant des agents et providers. Il contient :

- le modèle SQLite ;
- la déduplication ;
- la normalisation ;
- les versions de calcul ;
- le calcul des coûts ;
- les devises ;
- les synchronisations ;
- les rapports et agrégations.

Flux cible :

```text
module agent
  -> usage normalisé
  -> noyau TokenLedger
  -> module provider
  -> résultat de calcul versionné
```

Chaque module devra déclarer sa version et ses capacités afin que le noyau puisse gérer les différences de formats sans les masquer.

## Plugins et interfaces publiques

Les modules d'agents doivent reposer sur une interface publique et versionnée afin que la communauté puisse :

- ajouter un nouvel agent ;
- remplacer un adaptateur intégré ;
- corriger un parseur plus rapidement que le cycle de publication de l'application.

Les interfaces doivent décrire au minimum :

- la détection des sources ;
- la configuration requise ;
- l'import en lecture seule ;
- le format d'utilisation produit ;
- les capacités disponibles ;
- la version du plugin ;
- les diagnostics et niveaux de confiance.

La frontière de plugin est l'agent : un plugin Codex, un plugin Claude Code, un plugin Cline, etc. Il n'y a pas de plugin provider indépendant dans le modèle retenu.

Les providers restent des composants partagés du noyau. Un plugin d'agent produit l'identité du provider et du modèle utilisés, puis le noyau applique les règles et tarifs correspondants.

Les modules seront intégrés et compilés avec TokenLedger. Les contributions externes se feront via fork et pull request, plutôt que par l'exécution de code tiers installé dynamiquement.

Le noyau doit rester capable de fonctionner sans plugin externe et les plugins doivent être refusés ou désactivés explicitement lorsqu'ils sont incompatibles avec la version de l'interface.

### Mécanisme retenu

Les interfaces d'agents sont des interfaces Rust internes au projet. Chaque adaptateur est un module compilé dans l'application :

```text
src-tauri/src/agents/opencode.rs
src-tauri/src/agents/codex.rs
src-tauri/src/agents/claude_code.rs
src-tauri/src/agents/aider.rs
src-tauri/src/agents/cline.rs
src-tauri/src/agents/kilo_code.rs
```

Le noyau dépend uniquement de l'interface, jamais des détails propres à un agent. Un contributeur peut ajouter ou remplacer un module via fork et pull request, puis le module est revu, testé et livré avec une version de TokenLedger.

Le mot « plugin » désigne donc ici un module d'extension intégré et contrôlé par le projet, pas un binaire tiers exécuté dynamiquement.

## Données brutes et confidentialité

Par défaut, l'import ne conserve que les métadonnées nécessaires au calcul : dates, sessions, projets, modèles, providers et tokens.

Les prompts, réponses et événements bruts peuvent contenir du code ou des informations sensibles. Ils ne sont donc pas conservés par défaut.

Une option explicite pourra permettre de conserver les données brutes pour le diagnostic ou l'analyse d'un import problématique.

## Questions ouvertes

- Quelles sources et quels adaptateurs doivent être inclus dans la première version ?
- Comment gérer les limites, crédits ou dépassements des formules hybrides ?
- Quelle source de taux de change utiliser pour la conversion indicative ?

## Premier audit des formats locaux

Le premier audit confirme que les agents n'ont pas tous un format local équivalent.

| Agent | Source locale observée | Tokens | Risque principal |
|---|---|---|---|
| OpenCode | Base SQLite structurée | Oui | Schéma dépendant des versions |
| Codex CLI | Historique JSONL dans `~/.codex/sessions/` | Oui, souvent détaillés | Compteurs cumulatifs et sessions multi-agents |
| Claude Code | Sessions JSONL dans `~/.claude/projects/` | Oui dans les réponses assistant | Provider parfois absent ou indirect |
| Aider | `.aider.chat.history.md` et fichiers texte | Pas garanti dans l'historique | Historique destiné à la reprise, pas à l'audit des tokens |
| Cline | Stockage `globalStorage` de l'extension, tâches JSON | Variable selon la version | Format très versionné et plusieurs produits |
| Kilo Code | Stockage OpenCode actuel ou ancien stockage de tâches | Oui dans le format OpenCode | Migration entre générations |

Conséquences pour les adaptateurs :

- les données de tokens absentes doivent rester inconnues, jamais être remplacées par zéro ;
- les compteurs cumulatifs doivent être distingués des deltas ;
- chaque import doit conserver sa provenance et un niveau de confiance ;
- les parseurs doivent être versionnés par agent et par génération de format ;
- les fichiers sources restent strictement en lecture seule ;
- Kilo nécessite au moins un détecteur pour le format OpenCode actuel et un détecteur historique pour les tâches d'extension ;
- Aider pourra fournir un historique utile même lorsque le coût exact ou les tokens ne sont pas disponibles.

Priorité technique suggérée pour l'audit détaillé :

1. OpenCode ;
2. Kilo Code ;
3. Cline et ses anciennes générations de tâches ;
4. Claude Code ;
5. Codex CLI ;
6. Aider et les agents de seconde phase.

Sources examinées :

- [Codex](https://github.com/openai/codex)
- [Codex configuration reference](https://developers.openai.com/codex/config-reference/)
- [Claude Code - fonctionnement et sessions](https://code.claude.com/docs/en/how-claude-code-works)
- [Aider - configuration et fichiers d'historique](https://aider.chat/docs/config/aider_conf.html)
- [Cline](https://github.com/cline/cline)
- [Kilo Code](https://github.com/Kilo-Org/kilocode)
