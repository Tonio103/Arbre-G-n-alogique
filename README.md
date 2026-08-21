# Arbre généalogique

Une application web pour parcourir un arbre familial de plusieurs centaines de
personnes : navigation libre dans un très grand plan, recherche instantanée,
fiche détaillée par personne, interface en verre dépoli.

Le jeu de données de démonstration compte **525 personnes sur 10 générations**
(1748 → 2022), réparties en une quinzaine de branches. Toutes les personnes,
dates et lieux sont fictifs.

L'arbre est dessiné comme un arbre : un tronc et des racines plantés dans une
clairière, une ramure dont chaque branche s'épaissit en fonction du nombre de
personnes qu'elle porte, un feuillage là où les lignées s'arrêtent. Les
générations les plus anciennes sont en bas — l'arbre pousse vers le haut, et
chaque personne est un médaillon rond accroché à sa branche.

---

## Démarrer

```bash
npm install
npm run dev        # http://localhost:5173
```

```bash
npm run build      # vérification des types + production dans dist/
npm run preview    # sert le résultat du build
npm run typecheck  # types seuls
```

Aucune dépendance en dehors de React, TypeScript et Vite.

---

## Navigation

L'application ouvre au **pied de l'arbre**, sur la souche de la lignée
principale : on remonte ensuite les générations à la molette, comme on remonte
un arbre du tronc vers la cime. Le zoom se fait avec la touche de commande
enfoncée.

| Geste / touche | Effet |
| --- | --- |
| Molette | Zoom avant et arrière, centré sur le pointeur |
| Pavé tactile à deux doigts | Déplacement libre |
| Glisser | Déplacement, avec inertie |
| Pincement | Zoom tactile |
| Double-clic | Zoom sur le point visé |
| Flèches | Déplacement (`Maj` pour aller plus vite) |
| `+` / `-` | Zoom |
| `0` | Vue d'ensemble de l'arbre entier |
| `H` | Retour à la personne principale |
| `L` | Bascule famille proche ↔ lignée entière |
| `⌘K` / `Ctrl+K` | Recherche |
| `Échap` | Ferme la fiche ou la recherche |
| `Tab` | Parcourt les cartes visibles |

Survoler une personne l'agrandit, affiche ses informations essentielles et
accentue ses liens familiaux. La sélectionner ouvre sa fiche, met en évidence
ses proches et estompe le reste de l'arbre.

En vue éloignée, les cartes cèdent la place aux noms des branches : cliquer sur
l'un d'eux plonge dans la lignée correspondante.

---

## Ajouter ou modifier des personnes

Les données sont totalement séparées de l'interface. Tout se passe dans
`src/data/` — aucun composant à toucher.

Une personne minimale :

```ts
{
  id: 'marie-durand-1912',
  firstName: 'Marie',
  lastName: 'Durand',
  parents: ['jean-durand-1880', 'louise-petit-1884'],
}
```

Une personne complète :

```ts
{
  id: 'roger-beaumont-1921',
  firstName: 'Roger',
  lastName: 'Beaumont',
  gender: 'm',
  birthDate: '1921-03-30',        // "1921", "1921-03" ou "vers 1921" acceptés
  birthPlace: 'Avignon',
  deathDate: '2004-12-19',
  deathPlace: 'Avignon',
  photo: '/photos/roger.jpg',      // sans photo, un portrait est généré
  profession: 'Directeur d’école',
  education: 'École normale d’instituteurs d’Avignon',
  headline: 'Instituteur et résistant',   // deux à quatre mots, sur la carte
  residences: ['Avignon', 'Apt'],
  biography: '…',
  interests: ['Histoire locale', 'Randonnée'],
  anecdotes: ['A refusé la Légion d’honneur en 1974.'],
  milestones: [{ year: '1943', title: 'Entre dans la Résistance' }],
  memories: ['Le bureau couvert de cahiers à corriger.'],
  notes: '…',
  links: [{ label: 'Acte de naissance', url: 'https://…' }],
  custom: { 'Surnom': 'Monsieur Roger' },   // champs libres, affichés tels quels
  parents: ['marcel-beaumont-1894', 'germaine-ferrand-1893'],
  spouses: [{ id: 'monique-lemoine-1926', status: 'married', since: '1947-08-16' }],
}
```

**Seuls `parents` et `spouses` se saisissent.** Les enfants, la fratrie, les
demi-frères et sœurs, les unions et les générations sont dérivés au chargement,
de sorte qu'un lien ne puisse jamais être renseigné d'un côté seulement. Les
liens de conjoint sont symétrisés automatiquement : le déclarer sur une seule
des deux personnes suffit.

Le champ `custom` accepte n'importe quelle paire clé/valeur et s'affiche dans la
fiche sans modification de code — c'est le point d'extension prévu pour tout ce
que le schéma n'anticipe pas.

Les incohérences (parent inconnu, identifiant en double, boucle de filiation)
n'interrompent rien : elles sont collectées dans `graph.warnings`.

### Organisation des données

| Fichier | Rôle |
| --- | --- |
| `data/schema.ts` | Types. La référence de ce qu'on peut saisir |
| `data/core-family.ts` | Le noyau familial, écrit à la main, richement documenté |
| `data/generator.ts` | Peuple les branches collatérales de façon déterministe |
| `data/vocabulary.ts` | Prénoms, métiers et lieux par époque |
| `data/index.ts` | Assemble le tout et déclare les branches nommées |

Pour un arbre plus grand ou plus petit, ajustez les `budget` des graines dans
`core-family.ts` : c'est le seul réglage. Le générateur étant semé par une
valeur fixe, le même arbre est reconstruit à chaque chargement.

Pour partir de vos propres données, remplacez le contenu de `data/index.ts` par
votre liste de `PersonRecord` : rien d'autre ne change.

---

## Architecture

```
src/
  data/         Données familiales et schéma — aucune dépendance à l'interface
  domain/       Graphe, placement, parenté, recherche, dates — sans React
  view/         Navigation, index spatial, dessin de l'arbre, mesures
  hooks/        Assemblage des données, thème, media queries
  components/   Interface
  styles/       Jetons de design et feuilles par zone
```

`domain/` et `view/` ne dépendent d'aucun composant : le placement de l'arbre
et le calcul des parentés sont testables et réutilisables tels quels.

### Le matériau de verre

`styles/liquid-glass.css` définit une seule matière, dont tous les panneaux
flottants sont faits. Elle superpose cinq couches, chacune isolée pour pouvoir
se dégrader seule :

| Couche | Rôle | Support |
| --- | --- | --- |
| Substrat | flou, saturation et luminosité de l'arrière-plan | `backdrop-filter` |
| Réfraction | la surface courbe ce qui passe derrière, comme une lentille | filtre SVG `feDisplacementMap`, dans `components/GlassFilters.tsx` |
| Teinte | la masse colorée qui donne son épaisseur au matériau | dégradé, plus dense sur les bords |
| Reflet | le point lumineux qui glisse avec la source de lumière | dégradé radial piloté par `hooks/useGlassLight.ts` |
| Spéculaire | l'arête qui capte la lumière, frange colorée comprise | dégradé conique sur un anneau d'un pixel |
| Tranche | les ombres internes, qui donnent au verre son épaisseur | trois ombres `inset` |
| Élévation | l'ombre portée qui décolle la surface du fond | trois ombres superposées |

La lentille couvre **toute** la surface, et non un liseré de bord : une plaque de
verre réfracte partout, simplement moins en son centre où elle est plane. C'est
la carte de déplacement qui porte ce profil. Restreindre l'effet à un anneau
laisse une couture nette là où la déformation démarre, et le procédé devient
visible.

La dispersion chromatique, elle, est portée par l'arête en CSS et non par le
filtre. Séparer les trois canaux pour les déplacer différemment est la méthode
exacte, mais les filtres SVG travaillent en alpha prémultiplié : recomposer un
arrière-plan translucide lui fait perdre sa luminosité et laisse des franges
cyan très visibles au lieu d'un liseré discret.

Une seule source de lumière éclaire tout le verre, `useGlassLight`, qui suit le
pointeur avec un amortissement. Une arête dont le reflet ne bouge jamais se lit
comme un trait peint ; c'est le déplacement du reflet qui fait percevoir une
surface. Les portraits de l'arbre partagent cet angle, si bien que médaillons et
panneaux sont éclairés depuis le même point.

Les variantes s'obtiennent par classes : `lg--clear`, `lg--thick`,
`lg--control`, `lg--chip`, `lg--pill`, `lg--interactive`. Un seul jeu de
variables CSS pilote l'ensemble ; changer `--lg-blur` change l'épaisseur perçue
partout.

La réfraction est suspendue pendant que la vue bouge (`data-moving` sur `.app`) :
elle recalcule tout l'arrière-plan à chaque image pour un effet que l'œil ne
peut pas suivre en mouvement. Elle disparaît aussi, avec le flou, quand le
navigateur ne les gère pas ou quand le système demande moins de transparence —
le texte reste alors posé sur une surface pleine.

### Le dessin de l'arbre

`view/tree-renderer.ts` dessine la ramure entière sur un seul canvas. Chaque
branche est un **polygone fuselé**, pas un trait : son épaisseur doit décroître
le long du parcours, ce qu'une largeur de trait constante ne permet pas. Elle
suit une racine carrée du nombre de descendants, comme dans un arbre réel où la
section d'une branche équivaut à la somme des sections qu'elle nourrit.

Le dessin se fait en sept passes, du fond vers la surface : la clairière et
l'ombre portée, le bois, son modelé, l'écorce du fût, les mariages entre
branches éloignées, le feuillage, puis la lignée sélectionnée.

**Le modelé du bois.** Une branche est un cylindre : elle reçoit la lumière d'un
côté et s'assombrit de l'autre. Peinte d'un seul aplat, elle reste une découpe
de papier. Comme un tracé de canvas ne porte qu'une couleur, le volume se
construit en repassant la même courbe en plus étroit et décalé sur le côté —
une fois en ombre, une fois en lumière, puis un filet vif sur l'arête qui donne
au bois son poli. Les bandes ne sont dessinées qu'au-delà de quatre pixels
d'épaisseur à l'écran ; en deçà, elles ne produiraient qu'un liseré sale.

**Le feuillage** compte trois plans de verdure. Une couronne d'une seule teinte
se lit comme une tache : c'est l'écart entre les feuilles d'ombre, celles de
plein jour et celles que la lumière traverse qui lui donne son épaisseur.

Modelé, écorce et troisième plan de feuillage triplent le coût d'une image. Ce
sont des détails qu'on regarde à l'arrêt, pas pendant qu'on fait défiler un
arbre : ils sont suspendus en mouvement et rétablis dès la première image
immobile.

`view/organic.ts` fournit l'irrégularité sans laquelle une ramure se lit comme
un diagramme : déviation des branches, décalage des fourches, variation des
épaisseurs, orientation des feuilles. Elle vient d'un **hachage de
l'identifiant**, jamais d'un tirage aléatoire — la même personne doit produire
la même forme à chaque image, sinon l'arbre frémirait à chaque déplacement.

Deux repères de calibrage, faciles à casser en retouchant le rendu :

- l'épaisseur d'une branche est plafonnée **sous** la largeur d'un médaillon ;
  au-delà elle cesse d'être une branche et devient une bande qui écrase le
  portrait ;
- la compensation de zoom est calée sur l'écart entre deux personnes voisines ;
  au-delà, les branches fusionnent en masses pleines et l'arbre perd sa ramure.

### Tenir la charge

Un arbre de 647 personnes occupe environ 57 000 × 2 000 pixels. Rien n'est
dimensionné en fonction du nombre total de personnes :

- **Cartes virtualisées** — seules les cartes réellement dans le cadre sont
  montées, une trentaine à l'écran contre 647 au total. Un index spatial en
  grille donne la liste des personnes visibles en temps constant.
- **Liens sur un canvas unique** — un élément par lien coûterait des milliers de
  nœuds DOM. Ils sont tracés en trois passes groupées par style, et seuls les
  liens visibles sont parcourus.
- **Transformation hors de React** — le déplacement et le zoom écrivent
  directement dans le DOM ; l'état React n'est mis à jour que lorsque l'ensemble
  des cartes visibles change réellement.
- **Survol hors de React** — la personne survolée transite par un petit store
  externe, pour ne repeindre que la couche de liens.
- **Niveaux de détail** — sous 0,52 la carte se réduit au prénom ; sous 0,24 les
  cartes disparaissent au profit de points tracés sur le canvas, ce qui plafonne
  le coût quel que soit le niveau de dézoom.
- **Le décor est une couche isolée** — tant qu'il vivait sous l'élément
  transformé, le navigateur repeignait tout le fond à chaque image, ce qui
  coûtait près de la moitié du budget d'affichage.

### Placement par contours

Le placement naïf réserve à chaque sous-arbre une bande où nul autre n'entre.
Une personne sans descendance monopolise alors une colonne sur toute la hauteur
de l'arbre : la largeur totale finit par valoir le nombre de **feuilles** plutôt
que la population de la génération la plus fournie — deux fois et demie
l'espace nécessaire sur ce jeu de données. Les branches doivent traverser cette
largeur en une génération de hauteur, ce qui les couche à l'horizontale et fait
perdre à l'ensemble toute allure d'arbre.

`measure()` garde donc, pour chaque sous-arbre, la silhouette de ses bords
gauche et droit niveau par niveau. Deux voisins ne s'écartent que de ce que
leurs silhouettes exigent réellement : une branche courte se glisse sous la
ramure de sa voisine au lieu de la pousser.

### Placement

Les générations sont calculées en propageant deux règles jusqu'à stabilisation :
un enfant se place sous ses parents, et deux conjoints partagent la même ligne.

Le placement horizontal est un parcours en deux temps, en O(n) : mesure des
largeurs de bas en haut, puis attribution des positions de haut en bas. Le bloc
d'un couple et le groupe de ses enfants étant centrés sur le même axe, un couple
se retrouve naturellement au-dessus de sa descendance, sans passe de correction.

Chaque personne n'apparaît qu'une fois. Un conjoint venu de l'extérieur se place
à côté de son époux ou de son épouse ; un conjoint né dans l'arbre garde sa
place dans sa propre lignée, et l'union devient alors un **lien croisé**, tracé
en courbe pointillée — c'est le cas du mariage de Marcel Beaumont et Germaine
Ferrand, qui unit les deux lignées fondatrices. Un arbre sur papier procède de
la même façon : on ne peut pas dessiner quelqu'un à deux endroits.

---

## Accessibilité

Chaque carte est un bouton, atteignable au clavier, annoncé avec son nom, ses
dates et sa profession. La zone de navigation se pilote entièrement au clavier.
Les listes de résultats suivent le motif `combobox` / `listbox`, avec navigation
aux flèches. Le contraste des textes reste au-dessus des seuils AA dans les deux
thèmes, et `prefers-reduced-motion` désactive les animations.

---

## Portraits

Sans champ `photo`, un portrait est généré à partir de l'identifiant de la
personne : dégradé stable dans le temps, initiales lisibles, teintes volontairement
sourdes pour qu'une centaine de portraits côte à côte forment un ensemble et non
un nuancier. Renseigner `photo` (URL ou chemin) le remplace ; en cas d'échec de
chargement, le portrait généré reprend la main.
