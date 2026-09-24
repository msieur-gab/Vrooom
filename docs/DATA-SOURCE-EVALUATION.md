# Brief — choisir la source de données des lieux

Mission pour le prochain agent. Rédigé le 2026-09-22.
**Lis `BADGE-NAMING-TODO.md` et `js/services/overpass.js` avant de commencer.**

---

## Ce qu'il faut obtenir

Vrooom doit répondre à une question simple : **y a-t-il un parc, une aire de jeux
ou une piscine autour de moi dans un rayon de N mètres ?**

Aujourd'hui c'est Overpass (OpenStreetMap). Ça marche mal, et **pas pour la raison
qu'on croit**.

## Le vrai problème : la qualité, pas la disponibilité

Observation de Gab, qui est le cœur de la mission :

> « Overpass remonte des piscines qui sont privées, des aires de jeux privées, et
> manque le nom des aires de jeux publiques. »

Donc trois exigences, dans cet ordre :

1. **Distinguer public et privé.** OSM a `access=private|customers|yes`, mais le
   tag est très souvent absent — une requête ne peut donc pas filtrer dessus de
   façon fiable. Une piscine privée proposée à un enfant est un bug grave : la
   promesse du produit, c'est qu'on peut y aller.
2. **Avoir le nom des lieux publics.** Beaucoup n'en ont aucun dans OSM. C'est la
   racine des badges tous intitulés « Playground » — voir `BADGE-NAMING-TODO.md`.
3. **Fournir une identité stable.** Critère éliminatoire, voir plus bas.

## Le critère éliminatoire : l'identité des lieux

`js/services/checkin.js` construit `placeKey` = `type_lat.toFixed(3)_lon.toFixed(3)`
et **c'est cette clé qui identifie un badge**. Si une nouvelle source décale une
coordonnée ou découpe les lieux autrement, les clés changent et **tous les badges
déjà gagnés cessent de correspondre**.

Toute source retenue doit donc exposer un identifiant stable — idéalement
l'identifiant OSM (`way/12345`), ce qui permettrait au passage de corriger le bug
documenté dans `BADGE-NAMING-TODO.md` : la clé en coordonnées arrondies peut
fusionner deux aires de jeux voisines, ou dédoubler un parc dont le centroïde a
bougé.

Prévoir une migration des `placeKey` existants fait partie de la mission.

---

## Ce qui est déjà mesuré — ne le refais pas

Tout est détaillé dans `~/dev/agent/brain/projects/vrooom/data-sources.md`.
En résumé :

- `overpass-api.de` renvoie **406** sur l'interpréteur : bannissement anti-abus
  délibéré, pas une panne. Son `/api/status` répond 200 depuis la même IP. Aucune
  combinaison d'en-têtes (UA, Referer, Accept, GET, POST) n'y change quoi que ce
  soit. **Il n'existe ni clé API, ni inscription, ni offre payante** pour cette
  instance — vérifié.
- `kumi.systems` a fermé. `private.coffee` ne complète jamais de connexion TCP.
- `maps.mail.ru` est le **seul** miroir mondial joignable, et il sature.
- **`overpass.osm.ch` est un piège** : instance suisse, 0 résultat en France,
  répond `200` avec du JSON valide et zéro élément. Un faux succès est pire qu'un
  échec — l'app affiche une carte blanche sans erreur.
- **Overpass n'envoie `Access-Control-Allow-Origin` que sur les réponses
  réussies.** Une page d'erreur n'a pas d'en-tête CORS, donc le navigateur affiche
  « blocked by CORS policy » et masque le vrai code HTTP.
- Certains miroirs répondent **200 avec du HTML** dedans.
- **Nominatim** et **Photon** ont été testés et écartés : ce sont des géocodeurs.
  Photon n'indexe que les lieux *nommés* — 21 résultats à Lyon, aucun sans nom,
  alors que la majorité des aires de jeux OSM n'ont pas de nom.
- Un proxy serveur a été construit puis supprimé : il n'atteint rien de plus
  qu'un navigateur. Il est dans l'historique git si une instance payante a besoin
  d'un endroit où loger une clé.

`tools/overpass-check.html` mesure un endpoint depuis un vrai navigateur (statut,
JSON réel ou non, nombre de résultats). **Étends-le plutôt que d'en refaire un.**

---

## La méthode — c'est la partie qui compte

**Compter des résultats ne prouve rien.** C'est l'erreur commise toute la journée
du 22/09 : on a mesuré des disponibilités, jamais de la justesse.

La seule mesure honnête est une **liste de vérité terrain** :

1. Avec Gab, établis une liste d'une douzaine de lieux qu'il connaît réellement
   autour de chez lui — pour chacun : nom réel, public ou privé, type. Il a des
   enfants et arpente ces endroits ; c'est la meilleure source de vérité
   disponible, et elle ne s'obtient qu'en la lui demandant.
2. Interroge chaque candidat sur cette zone.
3. Note chacun sur : **précision** (combien de privés remontés à tort),
   **rappel** (combien de publics manqués), **nommage** (combien de lieux publics
   avec un nom correct), **identité** (identifiant stable, oui/non).
4. Présente un tableau comparatif. Une recommandation, pas un catalogue.

Fais tourner les tests **depuis le vrai navigateur Brave de Gab** — le sandbox
n'atteint qu'une fraction des hôtes, ce qui a produit des conclusions fausses le
22/09. Écris une page de test en HTML servie en http, Gab l'ouvre.

---

## Les pistes à tester, par ordre d'intérêt

1. **Places APIs** — la piste principale. Geoapify (catégories
   `leisure.playground`, `leisure.park`, `sport.swimming_pool` + `filter=circle:`,
   clé gratuite sans carte bancaire), OpenRouteService POIs, HERE, Foursquare.
   Elles *curatent* les données au lieu de servir les tags OSM bruts : c'est
   précisément là qu'on peut espérer un gain sur public/privé et sur les noms.
   Vérifie si elles exposent l'`osm_id`.
2. **Tuiles vectorielles auto-hébergées (PMTiles / Protomaps)** — le schéma
   contient `park` et `playground` dans `landuse` et `pois`. Un seul fichier
   hébergé par nous : zéro fournisseur, zéro quota, fonctionne hors-ligne. À
   vérifier : la présence d'identifiants OSM stables, et ce que le sous-ensemble
   « curaté » laisse de côté. La branche `test/pbf-static-data` montre que Gab y
   pensait déjà.
3. **Overpass payant** — Overspan (~19 $/mois, planète, mises à jour à la
   minute), Geofabrik (40 €/mois payable un an d'avance). **Ne règle aucun des
   trois problèmes de qualité** : mêmes données, meilleure disponibilité. À ne
   retenir que si la qualité s'avère acceptable et que seule la fiabilité manque.
4. **Requête Overpass affinée** — avant de changer de source, vérifier ce qu'on
   peut gagner sans rien changer : exclure `access=private|customers`, exclure
   `leisure=swimming_pool` sans `access=yes`, remonter le nom du parc englobant
   pour les aires sans nom. Peu coûteux, et c'est la référence à battre.

## Contraintes du projet

Vanilla JS, aucun build, aucun framework. Une clé d'API ne doit **jamais** être
dans le code client. Progressive enhancement : le cache doit servir quand le
réseau est absent. Développer en local puis déployer — ne pas éditer en SSH.

## Livrable

Le tableau comparatif noté sur la vérité terrain, une recommandation argumentée,
et le plan de migration des `placeKey` si la source change. **Ne change pas la
source de données sans validation explicite de Gab.**
