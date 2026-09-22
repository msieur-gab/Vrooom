# Fond de carte — problème ouvert

État au 2026-09-22. L'app utilise OSM standard : **ça marche, mais c'est trop
dense pour un enfant**, ce qui est le vrai sujet de l'écran carte.

## Ce qui a été essayé et pourquoi ça ne marche pas

| fond | clé | verdict |
|---|---|---|
| **CARTO Voyager / Positron** | — | sert des tuiles sans clé, mais **chaque tuile porte « API KEY REQUIRED » en filigrane** |
| **Stadia** (Alidade Smooth, OSM Bright) | oui | renvoie HTTP 401 avec une tuile d'erreur — la *même image de 14 885 octets* pour Lyon et pour Tokyo |
| **OSM standard** | non | propre, sans filigrane, mais trop chargé |
| **CyclOSM** | non | 33 Ko/tuile, encore plus chargé |

**Leçon de méthode, payée deux fois dans la journée :** un `200` avec une image
ne prouve rien. J'ai comparé tailles et hashes de trois tuiles CARTO, constaté
qu'elles différaient, et conclu que c'était de la vraie carte. C'en était — avec
un filigrane en travers. **Il faut regarder l'image.**

## Les pistes

### 1. Stadia Maps avec un compte gratuit — le plus proche de ce qu'on veut
`alidade_smooth` est visuellement très proche de Voyager : clair, calme,
lisible. Compte gratuit, et l'authentification peut se faire **par domaine
autorisé** plutôt que par clé dans l'URL. Une clé de tuiles restreinte à un
domaine dans le code client est une pratique normale — ce n'est pas comparable à
une clé d'API de données.

### 2. OpenFreeMap — vraiment sans clé, sans compte, sans quota
`tiles.openfreemap.org`, styles `positron` (clair, très épuré) et `bright`.
Vérifié : répond 200 sans clé. Le coût : ce sont des tuiles **vectorielles**, donc
il faut MapLibre GL à la place du `L.tileLayer` raster. Faisable sans build —
MapLibre et `maplibre-gl-leaflet` se chargent en deux balises `<script>` depuis
un CDN — mais ça touche `js/utils/map.js` plus profondément.

À vérifier : le rendu sur téléphone d'entrée de gamme (le vectoriel coûte plus
de CPU que le raster), ce qui compte pour le principe « le téléphone le moins
cher doit servir ».

### 3. Versatiles — équivalent européen d'OpenFreeMap
`tiles.versatiles.org`, style `colorful`. Répond 200 sans clé. Même contrainte
vectorielle.

### 4. Héberger ses propres tuiles (PMTiles / Protomaps)
Un seul fichier pour la région, servi par nous : zéro fournisseur, zéro quota,
fonctionne hors-ligne, et le style est entièrement le nôtre — donc réglable
précisément pour un enfant. C'est le plus de travail, et c'est la seule option
que personne ne peut retirer. Rejoint la piste « données statiques » de
`DATA-SOURCE-EVALUATION.md` : le même fichier pourrait porter la carte *et* les
lieux.

## Comment trancher

`tools/tile-compare.html` affiche les fonds côte à côte. **Il faut les regarder
dans un vrai navigateur, sur un vrai téléphone, avec la question : est-ce qu'un
enfant de 6 ans y retrouve son parc ?** Aucune mesure automatique ne répond à ça.
