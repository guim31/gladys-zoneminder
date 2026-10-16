# ZoneMinder

Amène dans Gladys les moniteurs d'un serveur [ZoneMinder](https://zoneminder.com/) : leur image, s'ils
sont en alarme, leur mode (Monitor, Modect, Record, Mocord, Nodect), s'ils capturent, et le nombre
d'événements du jour. Un nouvel événement déclenche une scène avec sa cause et son score, et l'image du
moment, qu'une scène peut vous envoyer. Les scènes peuvent aussi passer tous les moniteurs en Modect
quand vous partez, et déclencher une alarme forcée.

Testée contre de vrais serveurs ZoneMinder en Docker (1.36.4 et 1.38.6) avec des caméras réseau
simulées, pas encore sur une installation en service depuis longtemps : vos retours sont les bienvenus
sur [GitHub](https://github.com/guim31/gladys-zoneminder/issues) ou sur le forum Gladys.

## Ce qu'il vous faut

- Gladys 5.1 ou plus récent.
- Un serveur ZoneMinder joignable depuis Gladys sur le réseau local, version 1.34 ou plus récente (son
  API donne des jetons depuis la 1.34). La 1.36 et les 1.37+ sont prises en charge : à partir de la
  1.37, le mode est fait des réglages « Analysing » et « Recording », que l'intégration lit et écrit.
- L'API activée : **Options → System → OPT_USE_API** (activée par défaut).
- Si ZoneMinder demande une connexion (**OPT_USE_AUTH**), un compte avec **API Enabled** coché dans
  **Options → Users**. La lecture demande « Monitors : View » et « Events : View » ; changer le mode
  demande « Monitors : Edit ».

## Installation

1. Dans Gladys, ouvrez **Intégrations**, trouvez **ZoneMinder** et installez-la.
2. Dans son onglet **Configuration**, renseignez :
   - **Adresse de ZoneMinder** : l'adresse de la page web de ZoneMinder, ex. `http://192.168.1.20/zm`.
     Sans chemin, `/zm` puis `/` sont essayés (certaines images Docker servent ZoneMinder à la racine).
     Ajoutez `https://` ou un port si besoin.
   - **Nom d'utilisateur** (`admin` par défaut) et **Mot de passe**. Laissez le nom d'utilisateur vide
     si ZoneMinder n'a pas de connexion.
   - **Vérification des alarmes** : fréquence de lecture de l'état d'alarme et des nouveaux événements
     des moniteurs ajoutés dans Gladys (2, 5, 10 ou 30 secondes, 5 par défaut).
   - **Rafraîchissement des images** : fréquence d'envoi de l'image de chaque caméra à Gladys (de 10
     secondes à 15 minutes, 1 minute par défaut). Une alarme ou un nouvel événement en envoie aussi une
     aussitôt.
   - **Langue des noms** : la langue des noms de fonctionnalités donnés à l'ajout d'une caméra.
3. Enregistrez, puis ouvrez l'onglet **Découverte** : un appareil par moniteur. Ajoutez ceux que vous
   voulez.
4. **Vérifier la connexion** montre ce que lit l'intégration : la version de ZoneMinder, chaque
   moniteur, s'il reçoit des images et son mode.

## Les appareils Gladys

Chaque moniteur devient une caméra Gladys, nommée comme le moniteur, avec :

| Fonctionnalité             | Ce que c'est                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------ |
| **Image**                  | L'image de la caméra, envoyée au rythme choisi et aussitôt sur alarme ou événement.  |
| **Alarme**                 | 1 tant que ZoneMinder dit le moniteur en alarme (mouvement, alarme forcée), sinon 0. |
| **Mode**                   | Monitor, Modect, Record, Mocord ou Nodect. Modifiable depuis le tableau de bord.     |
| **Capture active**         | 1 quand le moniteur est activé et capture, 0 quand il est arrêté dans ZoneMinder.    |
| **Événements aujourd'hui** | Événements commencés depuis minuit sur ce moniteur.                                  |

Le **Mode** est une liste, à dessein : un choix délibéré, jamais un interrupteur qu'un assistant vocal
couperait par erreur. **Capture active** est en lecture seule : couper une caméra de surveillance reste
une décision prise dans ZoneMinder. Un moniteur qui ne reçoit plus d'images de sa caméra apparaît
injoignable dans Gladys (vérifié chaque minute).

## Widget du tableau de bord

**Caméra ZoneMinder** montre l'image d'une caméra, si elle est en alarme, son mode, les événements du
jour, et deux boutons : **Déclencher l'alarme** (ou **Annuler l'alarme** pendant une alarme ;
seulement pour un moniteur en Modect, Mocord ou Nodect) et **Nouvelle image**.

## Scènes

### Déclencheurs

- **ZoneMinder : nouvel événement** : ZoneMinder commence à enregistrer un événement. Filtres : la
  caméra (vide = toutes) et le **Type d'événement** : Mouvement, Alarme forcée, Enregistrement continu
  (les segments de Record et Mocord), Perte de signal, Moniteur lié, Autre. Variables : nom de la
  caméra, type, cause (telle que ZoneMinder l'écrit, ex. `Motion: All`), score (le plus haut score au
  moment où l'événement est vu ; il peut encore monter) et numéro de l'événement. L'image du moment est
  envoyée à Gladys d'abord.
- **ZoneMinder : caméra hors ligne** : un moniteur ne reçoit plus d'images de sa caméra, ou ZoneMinder
  lui-même ne répond plus. Pas déclenché pour un moniteur arrêté dans ZoneMinder.

### Actions

- **ZoneMinder : changer le mode** : règle le mode d'une caméra, ou de toutes quand la caméra est
  laissée vide. Seuls les moniteurs dont le mode change sont écrits (chacun redémarre quelques
  secondes). Sortie : le nombre de caméras modifiées.
- **ZoneMinder : alarme forcée** : **Déclencher** fait enregistrer à ZoneMinder un événement (cause
  « Forced Web ») jusqu'à **Annuler**. Seulement pour un moniteur en Modect, Mocord ou Nodect.
- **ZoneMinder : lire une caméra** : lit une caméra maintenant. Sorties : reçoit des images, en alarme,
  capture active, mode (`monitor`, `modect`…) et événements du jour, pour les conditions des actions
  suivantes.

L'action **Envoyer une image de caméra** du cœur envoie la dernière image d'une caméra : juste après
**ZoneMinder : nouvel événement**, c'est l'image de cet événement.

### Idées de scènes

- **Alarme armée** : quand tout le monde est parti, **ZoneMinder : changer le mode** en Modect pour
  toutes les caméras ; retour en Monitor quand quelqu'un rentre.
- **Intrusion** : **ZoneMinder : nouvel événement**, type Mouvement, caméra « Jardin », alarme armée →
  **Envoyer une image de caméra** de cette caméra sur votre téléphone.
- **Porte ouverte la nuit** : un détecteur d'ouverture s'ouvre → **ZoneMinder : alarme forcée**,
  Déclencher, sur la caméra de l'entrée ; Annuler deux minutes plus tard.
- **Caméra perdue** : **ZoneMinder : caméra hors ligne** → envoyer un message avec le nom de la
  caméra.

## Dépannage

- **« ZoneMinder refuse l'identifiant ou le mot de passe »** : vérifiez-les sur la page de connexion de
  ZoneMinder.
- **« Cet utilisateur ZoneMinder n'a pas accès à l'API »** : cochez **API Enabled** pour cet
  utilisateur dans **Options → Users**.
- **« ZoneMinder répond, mais pas comme prévu »** : il manque peut-être le chemin dans l'adresse.
  Essayez `http://<adresse>/zm`, ou l'adresse utilisée dans un navigateur, sans `index.php`.
- **« Insufficient privileges » en changeant un mode** : le compte doit avoir « Monitors : Edit ».
- **Une alarme forcée est refusée** : le moniteur n'analyse pas ses images (Monitor ou Record).
  Passez-le d'abord en Modect, Mocord ou Nodect.
- **Une caméra reste injoignable** : ZoneMinder n'en reçoit pas d'images (son état n'est pas
  « Connected » dans la console ZoneMinder). Vérifiez la caméra dans ZoneMinder.
- **Plus de détails** : les logs de l'intégration (Intégrations → ZoneMinder → Logs) ; mettez
  `LOG_LEVEL` à `debug` pour voir chaque requête.

## Limites

- Pas de vidéo en direct : Gladys montre des images, envoyées au rythme choisi (Gladys garde 12 images
  par minute et par caméra au plus). Le flux en direct se regarde dans ZoneMinder.
- Alarmes et événements sont lus toutes les quelques secondes (la vérification des alarmes) : une
  alarme très courte entre deux lectures apparaît comme un événement, pas comme un état d'alarme.
- **Événements aujourd'hui** compte depuis minuit, dans le fuseau de ZoneMinder : Gladys et ZoneMinder
  doivent avoir le même.
- Un serveur ZoneMinder par intégration. Avec plusieurs serveurs ZoneMinder (multi-serveur), les
  images d'un moniteur sont demandées à l'adresse de la configuration.
- Le mode « None » (pas de capture) et l'arrêt d'un moniteur ne sont pas proposés : faites-le dans
  ZoneMinder.
- Développée sans installation ZoneMinder en service depuis longtemps : vos retours sont les
  bienvenus.

Cette intégration n'est pas affiliée au projet ZoneMinder.
