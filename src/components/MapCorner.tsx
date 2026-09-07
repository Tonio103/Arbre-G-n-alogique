import { useMemo } from 'react';
import type { FamilyGraph } from '@/domain/graph';
import { collectScopedPlaces } from '@/domain/places';

export interface MapCornerProps {
  graph: FamilyGraph;
  /** Le périmètre courant — les mêmes personnes que la vue Carte montrerait. */
  people: Set<string>;
  /** Les lieux de la personne choisie, encrés quand le reste s'estompe. */
  selectedId: string | null;
  onOpen: () => void;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * LA CARTE EN COIN
 *
 * La géographie occupait un onglet entier, à égalité avec l'arbre, la
 * chronologie et les manques. Or on ne vient pas « consulter la carte » : on
 * veut savoir d'où vient la famille pendant qu'on regarde l'arbre. Un onglet
 * l'oblige à quitter l'arbre pour ça, puis à y revenir.
 *
 * Elle devient donc une vignette de coin — un index, pas une consultation —
 * et le grand format s'ouvre d'un clic dessus.
 *
 * ── CE QU'ELLE MONTRE, ET POURQUOI PAS LA FRANCE ENTIÈRE ─────────────────
 *
 * Le cadre suit les lieux RÉELS de la famille, pas un contour de pays. Une
 * famille corse tient dans un carré de deux degrés : lui montrer l'hexagone
 * entier, c'est lui montrer surtout du vide. Le niveau de tuile est donc
 * choisi comme le plus SERRÉ qui fasse encore tenir tous ses lieux.
 *
 * ── LE COÛT RÉSEAU, PUISQU'IL CHANGE ─────────────────────────────────────
 *
 * Les tuiles viennent d'OpenStreetMap, comme dans la grande carte. Jusqu'ici
 * ce domaine tiers n'était sollicité qu'en ouvrant l'onglet ; il l'est
 * désormais dès l'arbre affiché. Le cadre est petit et le niveau bas : quatre
 * tuiles au grand maximum, souvent deux. La mention de licence reste portée
 * par la grande carte, qui est la vue de la carte ; la vignette n'est qu'un
 * bouton qui y mène.
 * ═══════════════════════════════════════════════════════════════════════════ */

const TILE = 256;
/**
 * La vignette, en pixels. Assez grande pour reconnaître une côte.
 *
 * Presque carrée, et c'est la géographie qui l'impose : l'étendue d'une
 * famille l'est aussi. Mesuré sur les 39 lieux de la démonstration — d'Audierne
 * à Grenoble, de Bailleul à Aix — 117 px de large pour 121 de haut au niveau
 * de tuile 4. Dans un cadre en 1,6:1, la hauteur ne passait pas et il fallait
 * descendre d'un cran : moitié de la largeur perdue en mer, et la France
 * réduite à une tache au milieu de l'Europe.
 */
const VIGNETTE_W = 236;
const VIGNETTE_H = 162;
/**
 * La marge autour des lieux, en fraction du cadre.
 *
 * Un huitième plutôt qu'un sixième. Une marge sert à ce qu'aucune marque ne
 * touche le filet ; au-delà, elle ne fait que coûter un niveau de tuile — et
 * un niveau de tuile, c'est la moitié de la finesse.
 */
const MARGE = 0.08;
const Z_MIN = 3;
const Z_MAX = 11;

const tileX = (lon: number, z: number): number => ((lon + 180) / 360) * 2 ** z;
const tileY = (lat: number, z: number): number => {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z;
};

export function MapCorner({ graph, people, selectedId, onOpen }: MapCornerProps) {
  const vue = useMemo(() => {
    const rapport = collectScopedPlaces(graph, people);
    if (rapport.places.length === 0) return null;

    let latMin = Infinity;
    let latMax = -Infinity;
    let lonMin = Infinity;
    let lonMax = -Infinity;
    for (const lieu of rapport.places) {
      latMin = Math.min(latMin, lieu.lat);
      latMax = Math.max(latMax, lieu.lat);
      lonMin = Math.min(lonMin, lieu.lon);
      lonMax = Math.max(lonMax, lieu.lon);
    }

    /*
     * LE NIVEAU LE PLUS SERRÉ QUI TIENNE ENCORE.
     *
     * On descend depuis le plus fin : le premier niveau où l'étendue des lieux
     * entre dans le cadre est le bon. Chercher en montant depuis le plus large
     * donnerait le même résultat en plus d'itérations — et il y a un cas où
     * l'on ne trouve rien du tout, celui d'un seul lieu : l'étendue est alors
     * nulle et TOUS les niveaux conviennent, donc on prend le plus fin, ce qui
     * est exactement ce qu'on veut d'un lieu unique.
     */
    const utileW = VIGNETTE_W * (1 - MARGE * 2);
    const utileH = VIGNETTE_H * (1 - MARGE * 2);
    let z = Z_MIN;
    for (let essai = Z_MAX; essai >= Z_MIN; essai -= 1) {
      const largeur = (tileX(lonMax, essai) - tileX(lonMin, essai)) * TILE;
      const hauteur = (tileY(latMin, essai) - tileY(latMax, essai)) * TILE;
      if (largeur <= utileW && hauteur <= utileH) {
        z = essai;
        break;
      }
    }

    const centreX = (tileX(lonMin, z) + tileX(lonMax, z)) / 2;
    const centreY = (tileY(latMax, z) + tileY(latMin, z)) / 2;
    const origine = {
      x: centreX * TILE - VIGNETTE_W / 2,
      y: centreY * TILE - VIGNETTE_H / 2,
    };

    const compte = 2 ** z;
    const tuiles: Array<{ x: number; y: number; left: number; top: number }> = [];
    const txDebut = Math.max(0, Math.floor(origine.x / TILE));
    const txFin = Math.min(compte - 1, Math.floor((origine.x + VIGNETTE_W) / TILE));
    const tyDebut = Math.max(0, Math.floor(origine.y / TILE));
    const tyFin = Math.min(compte - 1, Math.floor((origine.y + VIGNETTE_H) / TILE));
    for (let tx = txDebut; tx <= txFin; tx += 1) {
      for (let ty = tyDebut; ty <= tyFin; ty += 1) {
        tuiles.push({ x: tx, y: ty, left: tx * TILE - origine.x, top: ty * TILE - origine.y });
      }
    }

    const marques = rapport.places.map((lieu) => ({
      key: lieu.key,
      label: lieu.label,
      x: tileX(lieu.lon, z) * TILE - origine.x,
      y: tileY(lieu.lat, z) * TILE - origine.y,
      gens: lieu.people,
      poids: lieu.people.length,
    }));

    return { z, tuiles, marques, nombre: rapport.places.length };
  }, [graph, people]);

  if (!vue) return null;

  return (
    <button
      type="button"
      className="carte-coin lg lg--thick"
      onClick={onOpen}
      aria-label={`Ouvrir la carte — ${vue.nombre} lieux`}
    >
      <span className="carte-coin-cadre" aria-hidden="true">
        <span className="carte-coin-tuiles">
          {vue.tuiles.map((tuile) => (
            <img
              key={`${vue.z}:${tuile.x}:${tuile.y}`}
              className="carte-coin-tuile"
              src={`https://tile.openstreetmap.org/${vue.z}/${tuile.x}/${tuile.y}.png`}
              alt=""
              style={{ left: tuile.left, top: tuile.top }}
              loading="lazy"
              decoding="async"
              draggable={false}
            />
          ))}
        </span>

        <svg className="carte-coin-marques" viewBox={`0 0 ${VIGNETTE_W} ${VIGNETTE_H}`}>
          {vue.marques.map((marque) => (
            <circle
              key={marque.key}
              cx={marque.x}
              cy={marque.y}
              r={Math.min(5.5, 2.2 + Math.sqrt(marque.poids))}
              className="carte-coin-marque"
              data-vif={(selectedId && marque.gens.includes(selectedId)) || undefined}
            />
          ))}
        </svg>
      </span>

      <span className="carte-coin-pied">
        <span className="carte-coin-titre">Carte</span>
        <span className="carte-coin-compte">{vue.nombre} lieux</span>
      </span>
    </button>
  );
}
