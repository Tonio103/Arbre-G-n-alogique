import { useMemo, useState } from 'react';
import type { FamilyGraph } from '@/domain/graph';
import { ephemeride, quand, type Evenement } from '@/domain/ephemeride';

export interface EphemerideProps {
  graph: FamilyGraph;
  /** Le périmètre courant — les mêmes personnes que les autres vues. */
  people: Set<string>;
  onSelectPerson: (id: string) => void;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * L'ÉPHÉMÉRIDE
 *
 * Ce que la famille a à fêter ces jours-ci, dans le coin de la planche.
 *
 * ── CE QU'ELLE CHANGE ────────────────────────────────────────────────────
 *
 * L'application ne parlait que du passé : un arbre, une frise, une carte, une
 * planche à imprimer — tout tourné vers ce qui a eu lieu. Elle connaissait la
 * date de naissance de chacun et n'a jamais dit une seule fois que c'était
 * l'anniversaire de quelqu'un. C'est la première chose ici qui parle
 * d'aujourd'hui, et c'est ce qui fait ouvrir l'application un mardi.
 *
 * ── LE TON ───────────────────────────────────────────────────────────────
 *
 * Trois lignes, pas davantage, et elle disparaît quand il n'y a rien — comme
 * la vignette de carte. Une éphéméride qui afficherait « rien cette semaine »
 * occuperait un coin d'écran pour ne rien dire, et on apprendrait vite à ne
 * plus la regarder.
 *
 * Ce qui se fête et ce qui se rappelle ne se composent pas pareil : un
 * anniversaire porte un âge en chiffres francs, une date de mémoire se met en
 * italique et ne reçoit aucun ornement. La distinction est tenue dans le
 * domaine (voir `ephemeride.ts`) ; ici on ne fait que l'habiller.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Trois lignes tiennent dans un coin sans le disputer à l'arbre. */
const REPLIE = 3;

/** Le petit signe devant chaque ligne, dessiné et non écrit. */
function Marque({ sorte }: { sorte: Evenement['sorte'] }) {
  if (sorte === 'alliance') {
    // Deux anneaux entrelacés : le seul cas où l'événement concerne deux
    // personnes, et cela doit se voir avant d'avoir lu les deux prénoms.
    return (
      <svg className="ephemeride-marque" viewBox="0 0 20 12" aria-hidden="true">
        <circle cx="7.4" cy="6" r="4.1" />
        <circle cx="12.6" cy="6" r="4.1" />
      </svg>
    );
  }
  if (sorte === 'memoire') {
    // Un filet, pas un point : on ne pose pas une pastille de fête devant le
    // nom de quelqu'un qui n'est plus là.
    return (
      <svg className="ephemeride-marque" viewBox="0 0 20 12" aria-hidden="true">
        <path d="M4 6h12" />
      </svg>
    );
  }
  return (
    <svg className="ephemeride-marque" viewBox="0 0 20 12" aria-hidden="true">
      <circle cx="10" cy="6" r={sorte === 'anniversaire-rond' ? 4.2 : 3.2} />
    </svg>
  );
}

export function Ephemeride({ graph, people, onSelectPerson }: EphemerideProps) {
  const [deplie, setDeplie] = useState(false);

  /*
   * Calculée une fois par arbre et par périmètre — jamais par image.
   *
   * `new Date()` est lu ICI plutôt que dans le domaine : une fonction qui
   * interroge l'horloge elle-même ne se vérifie qu'en attendant le bon jour.
   * En la lui passant, on peut lui demander n'importe quelle date et lire la
   * réponse tout de suite.
   */
  const evenements = useMemo(
    () => ephemeride(graph, people, new Date()),
    [graph, people],
  );

  if (evenements.length === 0) return null;

  const montres = deplie ? evenements : evenements.slice(0, REPLIE);
  const reste = evenements.length - montres.length;

  return (
    <aside className="ephemeride lg lg--thick" aria-label="Éphéméride de la famille">
      <h2 className="ephemeride-titre">Éphéméride</h2>

      <ul className="ephemeride-liste">
        {montres.map((evenement) => (
          <li key={evenement.id}>
            <button
              type="button"
              className="ephemeride-ligne"
              data-sorte={evenement.sorte}
              data-aujourdhui={evenement.dans === 0 || undefined}
              onClick={() => onSelectPerson(evenement.personId)}
            >
              <Marque sorte={evenement.sorte} />
              <span className="ephemeride-texte">
                <span className="ephemeride-qui">{evenement.qui}</span>
                <span className="ephemeride-dit">
                  {evenement.dit} · {quand(evenement.dans)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      {reste > 0 && (
        <button type="button" className="ephemeride-plus" onClick={() => setDeplie(true)}>
          et {reste} autre{reste > 1 ? 's' : ''}
        </button>
      )}
      {deplie && evenements.length > REPLIE && (
        <button type="button" className="ephemeride-plus" onClick={() => setDeplie(false)}>
          replier
        </button>
      )}
    </aside>
  );
}
