/*
 * ============================================================================
 *
 *  LES PIÈCES GRAVÉES
 *
 *  Les ornements sont des masques : un fichier PNG dont le noir est devenu de
 *  l'alpha, posé en `mask-image`, peint avec `currentColor`. Le même fichier
 *  sert donc au bistre de la planche et au bleu pâle du cyanotype, et se
 *  reteinte tout seul quand le thème change. Voir `src/assets/README.md` et la
 *  section « LES ORNEMENTS » de `papier.css`.
 *
 *  Ce fichier ne contient que le PLACEMENT. Les dessins vivent dans les
 *  ressources, leurs classes dans la feuille de style.
 *
 * ==========================================================================*/

export interface CoinsGravesProps {
  /**
   * Le modèle de coin. La planche source en contenait quatre ; vérification
   * faite, ce ne sont que deux dessins, chacun employé deux fois en miroir.
   */
  modele?: 'haut' | 'bas';
}

/**
 * Les quatre angles d'une planche.
 *
 * Un seul dessin, retourné par CSS : `scaleX(-1)`, `scaleY(-1)`, les deux. La
 * symétrie est donc EXACTE, là où quatre fichiers découpés séparément
 * n'auraient été symétriques qu'à peu près — et elle coûte trois fichiers de
 * moins à charger.
 */
export function CoinsGraves({ modele = 'haut' }: CoinsGravesProps) {
  return (
    <span className="coins" data-modele={modele} aria-hidden="true">
      <span className="ornement ornement--coin" data-angle="ho" />
      <span className="ornement ornement--coin" data-angle="hd" />
      <span className="ornement ornement--coin" data-angle="bo" />
      <span className="ornement ornement--coin" data-angle="bd" />
    </span>
  );
}
