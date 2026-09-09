import { useCallback, useEffect, useRef, useState } from 'react';
import type { FamilyGraph } from '@/domain/graph';
import type { TreeLayout } from '@/domain/layout';
import type { EtatBotanique } from '@/domain/gaps';
import type { LinkPalette } from '@/view/links';
import {
  graverLaPlanche,
  type FormatPapier,
  type Orientation,
} from '@/view/planche';

export interface PlancheDialogProps {
  graph: FamilyGraph;
  layout: TreeLayout;
  etats: Map<string, EtatBotanique>;
  palette: LinkPalette;
  onClose: () => void;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * LE TIRAGE — la fenêtre qui grave la planche.
 *
 * Un formulaire et une épreuve. Rien de plus : tout le dessin vit dans
 * `view/planche.ts`, qui est une fonction du graphe vers une image et n'a
 * besoin ni d'état ni de cycle de vie.
 *
 * ── L'ÉPREUVE, ET POURQUOI ELLE EST BASSE RÉSOLUTION ─────────────────────
 *
 * Elle se grave à 72 ppp, pas à la résolution demandée. Un A2 à 300 ppp fait
 * cinquante millions de pixels : le composer à chaque changement de case à
 * cocher gèlerait l'onglet une seconde entière. L'épreuve montre la MISE EN
 * PAGE — marges, cartouche, place de l'arbre, légende — qui est exactement ce
 * qu'on règle ici ; la résolution, elle, ne se juge pas à l'écran.
 * ═══════════════════════════════════════════════════════════════════════════ */

const FORMATS: Array<{ valeur: FormatPapier; dit: string; mm: [number, number] }> = [
  { valeur: 'A4', dit: 'A4 · 21 × 29,7 cm', mm: [210, 297] },
  { valeur: 'A3', dit: 'A3 · 29,7 × 42 cm', mm: [297, 420] },
  { valeur: 'A2', dit: 'A2 · 42 × 59,4 cm', mm: [420, 594] },
  { valeur: 'A1', dit: 'A1 · 59,4 × 84,1 cm', mm: [594, 841] },
];

/** L'épreuve : assez grande pour juger d'une mise en page, assez petite pour
 *  se regraver à chaque réglage sans qu'on l'attende. */
const EPREUVE_PPP = 72;

export function PlancheDialog({ graph, layout, etats, palette, onClose }: PlancheDialogProps) {
  const [format, setFormat] = useState<FormatPapier>('A3');

  /*
   * LE SENS SE DÉDUIT DE L'ARBRE, il ne se devine pas.
   *
   * Un arbre plus haut que large sur une feuille en largeur ne peut occuper
   * que la hauteur : mesuré sur la démonstration — 1526 unités de large pour
   * 2170 de haut — il ne prenait que vingt-neuf pour cent de la largeur
   * disponible, et les deux tiers de la planche restaient blancs. Le rapport
   * de la feuille A est de 1,41 ; on compare simplement le rapport de l'arbre
   * à celui-là.
   *
   * Réglable ensuite, bien sûr : un arbre presque carré se compose aussi bien
   * dans les deux sens, et c'est alors une affaire de mur.
   */
  const [orientation, setOrientation] = useState<Orientation>(() => {
    const large = Math.max(1, layout.bounds.maxX - layout.bounds.minX);
    const haut = Math.max(1, layout.bounds.maxY - layout.bounds.minY);
    return large / haut > Math.SQRT2 * 0.86 ? 'paysage' : 'portrait';
  });
  const [ornements, setOrnements] = useState(true);
  const [legende, setLegende] = useState(true);
  const [travaille, setTravaille] = useState(false);
  const [pppReel, setPppReel] = useState<number | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const apercuRef = useRef<HTMLDivElement | null>(null);

  /** Les couleurs de la planche, lues sur le thème au moment du tirage. */
  const couleurs = useCallback(() => {
    const styles = getComputedStyle(document.documentElement);
    const lire = (nom: string, secours: string): string =>
      styles.getPropertyValue(nom).trim() || secours;
    return {
      papier: lire('--bg-base', '#F0E7D7'),
      encre: lire('--text-primary', '#2E2418'),
      encreDouce: lire('--text-secondary', '#4E4131'),
      encrePale: lire('--text-tertiary', '#6E6250'),
      filet: lire('--glass-border-strong', 'rgba(46, 36, 24, 0.3)'),
    };
  }, []);

  /*
   * L'ÉPREUVE se regrave à chaque réglage.
   *
   * Le canevas rendu est INSÉRÉ dans le DOM plutôt que converti en image :
   * une conversion en `toDataURL` recopierait cinquante millions de pixels en
   * base64 à chaque case cochée. Un canevas se pose tel quel.
   */
  useEffect(() => {
    let annule = false;
    const boite = apercuRef.current;
    if (!boite) return undefined;

    graverLaPlanche({
      graph,
      layout,
      etats,
      palette,
      couleurs: couleurs(),
      format,
      orientation,
      ppp: EPREUVE_PPP,
      ornements,
      legende,
    })
      .then((planche) => {
        if (annule) return;
        planche.canvas.className = 'planche-epreuve';
        boite.replaceChildren(planche.canvas);
        setErreur(null);
      })
      .catch((cause: unknown) => {
        if (!annule) setErreur(cause instanceof Error ? cause.message : 'tirage impossible');
      });

    return () => {
      annule = true;
    };
  }, [graph, layout, etats, palette, couleurs, format, orientation, ornements, legende]);

  const telecharger = useCallback(async () => {
    setTravaille(true);
    setErreur(null);
    try {
      const planche = await graverLaPlanche({
        graph,
        layout,
        etats,
        palette,
        couleurs: couleurs(),
        format,
        orientation,
        ppp: 300,
        ornements,
        legende,
      });
      setPppReel(planche.pppReel);

      const blob = await new Promise<Blob | null>((resolve) =>
        planche.canvas.toBlob(resolve, 'image/png'),
      );
      if (!blob) throw new Error('le navigateur n’a pas pu produire l’image');

      const url = URL.createObjectURL(blob);
      const lien = document.createElement('a');
      lien.href = url;
      const nom = graph.title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/(^-|-$)/g, '');
      lien.download = `${nom || 'arbre'}-${format}.png`;
      document.body.appendChild(lien);
      lien.click();
      lien.remove();
      // Rendu au ramasse-miettes une fois le téléchargement lancé : un objet
      // URL retient sa donnée tant qu'on ne le révoque pas, et celle-ci pèse
      // plusieurs dizaines de mégaoctets.
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (cause) {
      setErreur(cause instanceof Error ? cause.message : 'tirage impossible');
    } finally {
      setTravaille(false);
    }
  }, [graph, layout, etats, palette, couleurs, format, orientation, ornements, legende]);

  /*
   * LA DÉFINITION ANNONCÉE, ET POURQUOI ELLE EST CALCULÉE.
   *
   * Cette ligne annonçait « quelques dizaines de mégaoctets ». Mesuré : 1,3 Mo
   * en A4, 6,5 en A1 — un ordre de grandeur d'écart, dans une phrase que
   * personne ne pouvait vérifier. Elle donne maintenant la seule chose qu'un
   * imprimeur demande, et qui se vérifie : le nombre de pixels.
   */
  const [courtMm, longMm] = FORMATS.find((f) => f.valeur === format)!.mm;
  const pxLarge = Math.round(((orientation === 'paysage' ? longMm : courtMm) / 25.4) * 300);
  const pxHaut = Math.round(((orientation === 'paysage' ? courtMm : longMm) / 25.4) * 300);
  const definition = `${pxLarge} × ${pxHaut} pixels à 300 points par pouce.`;

  useEffect(() => {
    const touche = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', touche);
    return () => window.removeEventListener('keydown', touche);
  }, [onClose]);

  return (
    <div className="planche-fond" role="dialog" aria-modal="true" aria-label="Tirer la planche">
      <button type="button" className="planche-sortie" aria-label="Fermer" onClick={onClose} />

      <div className="planche-boite lg lg--thick">
        <header className="planche-entete">
          <h2>Tirer la planche</h2>
          <p>
            L’arbre gravé sur du papier, à trois cents points par pouce — de quoi le faire
            imprimer et l’encadrer.
          </p>
        </header>

        <div className="planche-corps">
          <div className="planche-apercu" ref={apercuRef} aria-label="Épreuve" />

          <div className="planche-reglages">
            <fieldset>
              <legend>Format</legend>
              <div className="planche-choix">
                {FORMATS.map((entree) => (
                  <button
                    key={entree.valeur}
                    type="button"
                    data-actif={format === entree.valeur || undefined}
                    onClick={() => setFormat(entree.valeur)}
                  >
                    {entree.dit}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend>Sens</legend>
              <div className="planche-choix">
                <button
                  type="button"
                  data-actif={orientation === 'portrait' || undefined}
                  onClick={() => setOrientation('portrait')}
                >
                  Portrait
                </button>
                <button
                  type="button"
                  data-actif={orientation === 'paysage' || undefined}
                  onClick={() => setOrientation('paysage')}
                >
                  Paysage
                </button>
              </div>
            </fieldset>

            <fieldset>
              <legend>Composition</legend>
              <label className="planche-case">
                <input
                  type="checkbox"
                  checked={ornements}
                  onChange={(event) => setOrnements(event.target.checked)}
                />
                <span>Cartouche et ornements de coin</span>
              </label>
              <label className="planche-case">
                <input
                  type="checkbox"
                  checked={legende}
                  onChange={(event) => setLegende(event.target.checked)}
                />
                <span>Légende des marques botaniques</span>
              </label>
            </fieldset>

            <div className="planche-pied">
              <button
                type="button"
                className="planche-tirer"
                onClick={telecharger}
                disabled={travaille}
              >
                {travaille ? 'Gravure en cours…' : 'Télécharger la planche'}
              </button>
              {erreur ? (
                <p className="planche-note planche-note--erreur">{erreur}</p>
              ) : pppReel !== null && pppReel < 300 ? (
                <p className="planche-note">
                  Tirée à {pppReel} points par pouce : à cette taille de papier, un canevas de
                  navigateur ne va pas plus haut. L’impression reste nette.
                </p>
              ) : (
                <p className="planche-note">{definition}</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
