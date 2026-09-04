import { memo, useState } from 'react';
import { hashString } from '@/domain/text';

/**
 * Les teintes du coloriste.
 *
 * Elles ne font plus le portrait — c'est la taille-douce qui le fait, en
 * dégradés (voir `avatar.css`) — elles ne font que le laver. D'où une gamme
 * de planche ancienne : les terres, les verts de vessie, les bleus de Prusse
 * et de cobalt, tels qu'un coloriste les avait sur sa palette. Pas de magenta,
 * pas de cyan : ces pigments-là n'existaient pas.
 */
const HUES = [24, 38, 48, 96, 148, 172, 196, 214, 232, 352];

export interface AvatarProps {
  id: string;
  initials: string;
  photo?: string;
  /** Diamètre en pixels. */
  size?: number;
  alt?: string;
  className?: string;
}

/**
 * Portrait d'une personne. Une vraie photo si le champ `photo` est renseigné,
 * sinon un portrait généré, stable dans le temps pour un même identifiant.
 */
export const Avatar = memo(function Avatar({
  id,
  initials,
  photo,
  size = 76,
  alt,
  className,
}: AvatarProps) {
  const [failed, setFailed] = useState(false);
  // Décalages non signés : `>>` produirait un index négatif pour un hash
  // au-delà de 2³¹, donc une couleur invalide et un portrait sans fond.
  const hash = hashString(id);
  const hue = HUES[hash % HUES.length];
  // L'angle du burin varie d'une planche à l'autre : deux camées voisins ne
  // doivent pas avoir exactement la même trame, sinon l'œil y voit un motif
  // au lieu d'un dessin.
  const taille = 9 + ((hash >>> 7) % 11);

  const style = {
    width: size,
    height: size,
    // Le lavis : une touche, pas un aplat. Au-delà de 0,2 d'opacité la
    // couleur reprend le dessus sur la gravure et le camée redevient une
    // pastille colorée.
    '--avatar-lavis': `hsl(${hue} 32% 46% / 0.16)`,
    '--avatar-taille': 'var(--text-primary)',
    '--avatar-angle': `${taille}deg`,
    fontSize: Math.round(size * 0.34),
  } as React.CSSProperties;

  if (photo && !failed) {
    return (
      <span className={`avatar ${className ?? ''}`} style={style}>
        <img
          className="avatar-image"
          src={photo}
          alt={alt ?? ''}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
        />
      </span>
    );
  }

  return (
    <span
      className={`avatar avatar-generated ${className ?? ''}`}
      style={style}
      aria-hidden={alt ? undefined : true}
      role={alt ? 'img' : undefined}
      aria-label={alt}
    >
      <span className="avatar-initials">{initials}</span>
    </span>
  );
});
