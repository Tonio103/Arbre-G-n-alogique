import { useMemo } from 'react';
import type { FamilyGraph } from '@/domain/graph';
import { collectScopedPlaces } from '@/domain/places';
import { cadrePourLieux, urlTuile } from '@/view/tuiles';

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

/**
 * La vignette, en pixels. Assez grande pour reconnaître une côte.
 *
 * Presque carrée, et c'est la géographie qui l'impose : l'étendue d'une
 * famille l'est aussi. Mesuré sur les 39 lieux de la démonstration —
 * d'Audierne à Grenoble, de Bailleul à Aix — 117 px de large pour 121 de haut
 * au niveau de tuile 4. Dans un cadre en 1,6:1, la hauteur ne passait pas et
 * il fallait descendre d'un cran : moitié de la largeur perdue en mer, et la
 * France réduite à une tache au milieu de l'Europe.
 */
const VIGNETTE_W = 236;
const VIGNETTE_H = 162;

export function MapCorner({ graph, people, selectedId, onOpen }: MapCornerProps) {
  const vue = useMemo(() => {
    const rapport = collectScopedPlaces(graph, people);
    if (rapport.places.length === 0) return null;

    const cadre = cadrePourLieux(rapport.places, VIGNETTE_W, VIGNETTE_H);
    if (!cadre) return null;

    const marques = rapport.places.map((lieu) => ({
      key: lieu.key,
      label: lieu.label,
      ...cadre.projeter(lieu.lat, lieu.lon),
      gens: lieu.people,
      poids: lieu.people.length,
    }));

    return { z: cadre.z, tuiles: cadre.tuiles, marques, nombre: rapport.places.length };
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
              src={urlTuile(vue.z, tuile.x, tuile.y)}
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
