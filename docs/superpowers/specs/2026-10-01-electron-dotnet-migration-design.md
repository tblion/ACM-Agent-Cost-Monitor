# Design : migration vers Electron, React et .NET

## Objectif

Remplacer le runtime desktop Tauri et le backend Rust par Electron et un backend C#/.NET, tout en conservant l’application React et en préservant le comportement fonctionnel existant. Le résultat doit être compréhensible et maintenable par le propriétaire du projet, familier de .NET/C#.

L’application continue de prendre en charge Windows, macOS et Linux. L’utilisateur installe une seule application par installation et lance celle-ci avec un seul raccourci. Le backend .NET est inclus dans les bundles et n’est pas présenté comme une application distincte.

## Décisions retenues

- Interface : conserver React, TypeScript et Vite.
- Runtime desktop : Electron.
- Backend métier : application .NET/C# autonome, lancée et supervisée par Electron comme processus enfant.
- SQLite : `Microsoft.Data.Sqlite.Core` avec provider SQLite système (Winsqlite3 sur Windows, `sqlite3` sur macOS/Linux) ; aucun bundle natif SQLitePCLRaw `e_sqlite3` vulnérable n’est inclus.
- Communication frontend : API typée exposée par un preload à accès limité ; le renderer n’a pas accès direct à Node.js.
- Communication Electron/.NET : protocole JSON Lines sur stdin/stdout, avec identifiants de requête, réponses corrélées et notifications asynchrones.
- Déploiement .NET : runtime inclus dans les bundles afin de ne pas exiger une installation .NET préalable.
- SQLite : ouverture de `opencode.db` en lecture seule, sans migration ni écriture dans la base OpenCode.
- Windows : publier un installateur NSIS `.exe` pour installation par utilisateur et un MSI pour installation par machine destinée notamment aux déploiements DSI. Les deux installateurs livrent la même application. Chaque installation crée un seul raccourci dans le menu Démarrer ; aucun raccourci bureau supplémentaire n’est créé par défaut.
- macOS : publier un DMG contenant l’application et un alias vers `/Applications`, avec le parcours glisser-déposer.
- Linux : publier un paquet `.deb` pour Debian/Ubuntu, qui installe une seule application et son entrée de lancement.

Le paquet Linux déclare la bibliothèque système `libsqlite3-0` comme dépendance. Windows utilise `winsqlite3` fourni par Windows et macOS son SQLite système.

## Architecture

### Processus Electron principal

Le processus principal Electron crée et ferme la fenêtre, initialise les dialogues natifs, démarre le backend .NET, suit sa disponibilité et son arrêt, et relaie les requêtes autorisées du renderer. Il arrête proprement le processus .NET à la fermeture de l’application et signale les erreurs de démarrage ou les arrêts inattendus.

Le renderer est configuré avec `nodeIntegration` désactivé, `contextIsolation` activé et une surface IPC minimale. Le preload expose uniquement des fonctions explicites correspondant à l’API applicative ; il ne transmet pas l’objet IPC générique au renderer.

### Backend .NET

Le backend reprend les responsabilités Rust actuelles :

- chargement et validation des réglages ;
- résolution des chemins OpenCode et des chemins personnalisés ;
- lecture de la base SQLite en lecture seule ;
- lecture du JSONC `opencode.jsonc`, commentaires et virgules finales compris ;
- calcul des coûts, résolution du catalogue tarifaire versionné et agrégations ;
- résumé des coûts, recalcul et diagnostics ;
- génération des rapports d’audit ;
- métriques runtime pertinentes ;
- surveillance de la base et notification après debounce.

Les dialogues système (sélection de fichier, sauvegarde d’export) relèvent du processus principal Electron. L’écriture de fichiers d’export reste explicitement autorisée, contrairement à toute écriture dans la base OpenCode.

### Protocole local

Chaque requête est un objet JSON sur une ligne, contenant un identifiant, un nom d’opération et ses arguments. Chaque réponse contient le même identifiant, puis soit le résultat, soit une erreur structurée avec code et message. Les notifications asynchrones, dont `db-changed`, sont des messages identifiés comme événements.

Le protocole doit traiter les réponses hors ordre, les sorties de diagnostic, les lignes mal formées, le backend indisponible et l’arrêt du processus. stdout est réservé au protocole ; les journaux vont sur stderr. Les tailles de message doivent rester bornées et les messages reçus être validés.

## Contrat frontend

`src/api.ts` reste le point d’entrée applicatif, mais son adaptateur Tauri est remplacé par l’API du preload. Les noms d’opérations, les formes de données, la sérialisation camelCase et les catégories d’erreurs sont conservés autant que possible afin de limiter les changements dans les hooks et composants React.

Les fonctions de dialogues et d’export sont adaptées aux API Electron. Le mode mock et les scénarios Playwright sont maintenus ; ils ne doivent pas masquer l’absence de validation du backend réellement empaqueté.

## Packaging et mises à jour

Les builds sont produits sur des runners adaptés aux cibles et architectures prises en charge. Le backend .NET autonome est embarqué dans chaque package, sans installation distincte demandée à l’utilisateur.

- Windows NSIS : installation par utilisateur, sans privilège administrateur par défaut.
- Windows MSI : installation par machine, privilèges administrateur et usage pour déploiement centralisé. La DSI pilote le déploiement et les mises à jour du MSI ; aucun mécanisme de mise à jour automatique Electron du MSI n’est supposé.
- macOS DMG : application glissable vers l’alias Applications. La signature et la notarisation sont requises pour une distribution macOS sans avertissements de sécurité.
- Linux `.deb` : package Debian/Ubuntu avec lanceur de menu.

L’installation simultanée des variantes NSIS et MSI sur une même machine n’est pas un scénario supporté ; les chemins, identifiants de mise à niveau et règles de désinstallation doivent empêcher les conflits entre installations utilisateur et machine.

## Parité fonctionnelle et validation

La migration ne modifie pas les règles métier. Les résultats et comportements de référence comprennent notamment :

- sommes et détails de coûts, tarifs custom et dates d’effet du catalogue ;
- tokens de reasoning facturés au tarif output ;
- traitement des champs absents, valeurs invalides et erreurs de schéma SQLite ;
- ouverture de la base en lecture seule ;
- chemins XDG sur les trois systèmes et chemins configurés manuellement ;
- interprétation du JSONC ;
- persistence des réglages, diagnostics et erreurs ;
- mode live, debounce, changement de chemin observé et arrêt propre du watcher ;
- export CSV/JSON, audit et dialogue d’annulation ;
- livrables d’installation, raccourcis, démarrage et désinstallation sur les trois systèmes.

La validation finale doit exercer l’application empaquetée avec le backend .NET réel, et non uniquement le mock React. Les scénarios Playwright existants sont adaptés au nouveau mode E2E et complétés par des parcours qui démarrent les bundles natifs. Les tests d’acceptation des coûts restent comparés aux références existantes lorsque leurs données de référence sont disponibles.

## Migration proposée

1. Définir le contrat indépendant du runtime desktop à partir des commandes et événements publics actuels.
2. Porter le backend métier en C# en conservant ses règles et ses formes de données.
3. Ajouter le protocole JSON Lines et son cycle de vie depuis Electron.
4. Remplacer l’adaptateur Tauri du frontend sans réécrire les composants React.
5. Ajouter dialogues, empaquetage backend et installateurs par OS.
6. Valider la parité fonctionnelle sur l’application empaquetée pour Windows, macOS et Linux.
7. Retirer Tauri/Rust seulement après validation des scénarios requis et des quatre livrables Windows (NSIS, MSI), macOS (DMG) et Linux (`.deb`).

## Hors périmètre

- Refonte visuelle de l’interface React.
- Modification ou migration de `opencode.db`.
- Changement des règles de calcul, du catalogue de tarifs ou des fonctionnalités métier.
- Ajout d’un service réseau distant ou d’une dépendance à un serveur.
- Publication simultanée d’installateurs Linux RPM ou AppImage dans cette cible initiale.
