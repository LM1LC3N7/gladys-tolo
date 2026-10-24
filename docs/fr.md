# TOLO pour Gladys

Cette intégration affiche dans Gladys un **générateur de vapeur ou un sauna
TOLO avec son App Box**, en réseau local (UDP, port 51500), sans compte ni
cloud. **Jamais testé avec un vrai appareil.** Sans lien avec TOLO.

> **Sécurité.** Un hammam ou un sauna chauffe. Ne lancez jamais la chauffe à
> distance sans vous assurer que personne n'est dedans. L'allumage depuis
> Gladys est **désactivé par défaut** ; l'extinction n'est retenue par aucune
> option ni commande en cours.

## Ce que vous obtenez

Un appareil dans l'onglet Découverte, avec :

- **Chauffe en marche** (oui/non, en lecture seule) et le **statut** en texte
  (« Éteint », « En chauffe », « Maintien en température », « En marche, sans
  chauffe ») ;
- **température** et **humidité** mesurées, **consigne** ;
- **temps restant** (minutes) de la minuterie ;
- **niveau d'eau** (0, 33, 66 ou 100 %) et **température du réservoir** ;
- **lampe** (marche/arrêt) et **ventilateur** (marche/arrêt) : ils ne
  chauffent rien ;
- deux boutons : **Allumer (chauffer)** et **Éteindre**.

La chauffe n'a pas d'interrupteur : un « tout allumer » de Google Home,
Alexa, HomeKit, MCP ou d'une scène ne peut pas la lancer. Il peut allumer la
lampe ou le ventilateur.

## Configuration

1. Donnez une **adresse fixe** à l'App Box dans votre box (bail DHCP fixe).
2. Dans Gladys, ouvrez l'intégration TOLO et saisissez cette **adresse IP**
   (IPv4, par exemple 192.168.1.50). Sont refusées : un nom, les adresses de
   diffusion (dont toute adresse finissant par .255), de multidiffusion, de
   bouclage, 0.x.x.x et 169.254.x.x.
3. Enregistrez, puis ajoutez l'appareil depuis l'onglet **Découverte** (il y
   apparaît après la première lecture réussie).
4. Si vous voulez lancer la chauffe depuis Gladys, activez **Autoriser le
   chauffage depuis Gladys**, et réglez la **durée de séance** (30 min par
   défaut, de 1 à 60 min, la limite de l'App Box) et la **consigne la plus
   haute** (50 °C par défaut, de 35 à 60 °C, la plage de l'App Box).

L'App Box est lue toutes les 30 s (réglable de 10 s à 1 h), jamais plus
souvent, même après un redémarrage de l'intégration, une reconnexion à
Gladys, le bouton « Tester la connexion » ou un scan de la Découverte. Après
une commande, deux lectures de suivi partent 5 s et 20 s plus tard.

Le protocole ne donne ni numéro de série ni adresse MAC : l'appareil est
« l'App Box qui répond à l'adresse configurée ». Changer d'adresse garde le
même appareil dans Gladys.

## Les commandes

### Éteindre

Elle n'est retenue ni par l'option, ni par une commande en cours, ni par une
lecture en cours, ni par une App Box qui ne répond plus, et elle part aussi
juste après un redémarrage, avant la première lecture. Elle est toujours
envoyée (jamais « déjà éteint ») et, tant que l'App Box se tait, renvoyée
jusqu'à 4 fois (400 ms d'écart). Elle annule un allumage qui n'est pas encore
parti ; si un allumage était déjà parti, elle est renvoyée quand il se
termine.

Elle n'est confirmée que par une relecture qui montre l'App Box éteinte.
Sinon : « Envoyée, sans confirmation », et pendant 2 minutes chaque lecture
qui voit l'App Box en marche renvoie l'extinction (3 fois au plus). Cette
garde est gardée dans `/data` et survit à un redémarrage. Elle peut aussi
éteindre une chauffe lancée depuis l'App Box ou l'application TOLO dans ces
2 minutes : c'est voulu. Pendant la garde, un allumage depuis Gladys est
refusé.

Elle échoue (« Non envoyée ») seulement si aucun paquet n'a pu partir (par
exemple réseau injoignable depuis le conteneur), ou si aucune adresse valide
n'est configurée.

### Allumer (chauffer)

Il est refusé, sans rien envoyer, dans ces cas :

- « Autoriser le chauffage depuis Gladys » est désactivé (vérifié à
  l'arrivée, après la lecture, puis juste avant chaque paquet) ;
- une extinction est en cours, n'est pas encore confirmée (sa garde), ou est
  demandée pendant l'allumage ;
- un autre allumage est en cours, ou le précédent n'est pas encore confirmé
  (2 minutes au plus) ;
- l'App Box ne répond pas à la lecture fraîche (état et réglages) en 1,5 s,
  ou l'état de marche y est illisible ;
- la minuterie ou la consigne n'a pas pu être réglée puis relue ;
- la configuration (adresse) a changé entre-temps ;
- l'allumage ne peut pas partir dans les 3,5 s après le clic.

Déroulé : lecture fraîche de l'état et des réglages (jamais l'état en
mémoire) ; déjà en marche : rien n'est envoyé ; sinon la **minuterie** de
l'App Box est réglée sur la durée de séance (jamais « sans minuterie ») et
une consigne au-dessus de la consigne la plus haute est **ramenée** à
celle-ci, puis relues ; ensuite seulement l'allumage part. Il n'est confirmé
que par une relecture qui montre l'App Box en marche ; sinon « Envoyée, sans
confirmation ». Une relecture de moins de 10 s qui montre l'App Box déjà en
marche suffit pour ne rien envoyer (une scène qui appuie en boucle ne
sollicite pas l'App Box à chaque fois).

La minuterie bornée vaut pour les séances lancées depuis Gladys : si
quelqu'un retire ensuite la minuterie depuis l'App Box, l'intégration ne la
remet pas.

### Consigne

Refusée si l'option est désactivée, si la valeur n'est pas un nombre entier
de 35 °C à la consigne la plus haute (revérifié juste avant le paquet), ou
si une autre consigne est en cours. Changer la consigne n'allume pas l'App
Box. Confirmée par une relecture des réglages.

### Lampe et ventilateur

Marche/arrêt simples (0 ou 1), une commande à la fois pour chacun,
confirmés par une relecture.

## Quand ça ne va pas

- **L'App Box ne répond pas** : le statut le dit, l'appareil est montré
  injoignable, nouvel essai après 30 s, 1, 2 puis 5 min (jamais plus vite
  que l'intervalle). L'extinction est quand même envoyée.
- Seules les réponses venant de **l'adresse et du port de l'App Box**, bien
  formées (préfixe, suffixe, somme de contrôle, longueur) et de la commande
  envoyée sont prises en compte ; chaque échange a sa propre socket, donc la
  réponse tardive d'un échange précédent n'est jamais prise pour celle d'un
  autre.
- Le conteneur doit pouvoir joindre l'App Box en UDP (réseau en pont de
  Docker : le trafic unicast sort normalement vers le réseau local).

## Limites

- **Protocole non documenté** par TOLO : l'intégration suit la bibliothèque
  libre tololib, écrite en observant l'App Box. Il peut changer avec un
  micrologiciel.
- Pas de découverte automatique : l'adresse se saisit à la main.
- Pas encore d'humidité de consigne, d'aromathérapie, de bain salin, de
  balayage ni de minuterie du ventilateur.
- Une seule App Box par intégration.

## Données

`/data/tolo-state.json` contient seulement l'heure de la dernière lecture et
la garde d'une extinction en cours (adresse de l'App Box, échéance, nombre de
renvois). Aucun secret n'existe dans cette intégration.

Basée sur la bibliothèque Python tololib (MIT, Matthias Lohr), portée en
JavaScript : voir `THIRD_PARTY_NOTICES.md`.
