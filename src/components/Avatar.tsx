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

  const style = {
    width: size,
    height: size,
    /*
     * Le lavis : un souffle, pas une touche.
     *
     * Il valait 0,16 quand le disque était couvert de hachure et qu'il fallait
     * passer par-dessus. Sur du papier nu, la même valeur redonne une pastille
     * colorée — le médaillon de la maquette est BLANC. À 0,055 il ne reste
     * qu'une différence entre voisins, que l'œil enregistre sans la nommer.
     */
    '--avatar-lavis': `hsl(${hue} 30% 45% / 0.055)`,
    fontSize: Math.round(size * 0.36),
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
