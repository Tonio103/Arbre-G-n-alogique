# Ressources de l'herbier

Préparées à partir des images fournies (11 Mo de PNG), ramenées ici à 580 Ko.

## Les ornements — des masques, pas des images

Le noir sur blanc a été converti en **alpha**. Ils se posent en `mask-image`
et prennent la couleur d'encre du thème courant : un seul fichier sert au
bistre de la planche comme au bleu pâle du cyanotype.

Le découpage de la planche source est passé par la **connexité**, après l'échec
de deux méthodes fondées sur des projections — le cartouche et les coins
partagent la même bande, et les volutes du coin supérieur s'avancent sous le
cartouche : aucune ligne ni colonne ne les sépare.

Vérification faite, les quatre coins ne sont que **deux dessins**, chacun
employé deux fois en miroir (écart quadratique 0,057 entre les deux premiers,
contre 0,25 entre les deux modèles). D'où deux fichiers seulement : CSS
retourne les autres par `scaleX(-1)` / `scaleY(-1)`, ce qui donne en prime une
symétrie exacte plutôt qu'approchée.

| Fichier | Emploi |
|---|---|
| `ornement-cartouche.png` | Titre de planche, en-tête de la fiche |
| `ornement-coin-1.png` | Angles de la cuvette (modèle haut) |
| `ornement-coin-2.png` | Angles secondaires (modèle bas) |
| `ornement-filet-1..3.png` | Séparateurs, du plus fin au plus gras |
| `ornement-rose-des-vents.png` | Vue Carte |

## Les papiers marbrés — les seules vraies images

La seule matière que je ne sais pas calculer proprement. Réduits à 512² et
compressés en JPEG : un fond répété ne coûte rien au compositeur, contrairement
à un flou d'arrière-plan.

À n'employer qu'en **fond de panneau ou de rideau**, jamais sous du texte : le
motif est trop actif pour qu'on lise par-dessus.

| Fichier | Thème |
|---|---|
| `marbre-planche.jpg` | Clair — bleu de Prusse, bistre et rouille sur pierre |
| `marbre-cyanotype.jpg` | Sombre — bleu pâle sur nuit de Prusse |
