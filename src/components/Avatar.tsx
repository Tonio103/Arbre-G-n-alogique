import { memo, useState } from 'react';
import { hashString } from '@/domain/text';

/**
 * Teintes retenues pour les portraits générés. Volontairement peu nombreuses
 * et proches en saturation : côte à côte par centaines, elles doivent former
 * un ensemble, pas un nuancier.
 */
const HUES = [212, 232, 258, 284, 318, 342, 12, 32, 46, 168, 186, 196];

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
  const hueB = HUES[(hash >>> 5) % HUES.length];
  const tilt = (hash >>> 11) % 60;

  // Saturation volontairement contenue : côte à côte par centaines, des
  // portraits vifs donneraient un damier criard. On cherche des teintes
  // sourdes qui se distinguent sans se disputer l'attention.
  const style = {
    width: size,
    height: size,
    '--avatar-a': `hsl(${hue} 38% 56%)`,
    '--avatar-b': `hsl(${hueB} 34% 40%)`,
    '--avatar-c': `hsl(${(hue + 18) % 360} 42% 66%)`,
    '--avatar-tilt': `${tilt + 110}deg`,
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
