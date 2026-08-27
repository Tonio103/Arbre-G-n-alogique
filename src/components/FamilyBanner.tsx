import { CloseIcon } from './icons';
import type { Person } from '@/data/schema';

/**
 * Le bandeau de la vue « famille ».
 *
 * On y arrive en cliquant quelqu'un dont un point signalait une union cachée.
 * L'arbre entier a disparu au profit de sa seule famille : il faut donc dire
 * en clair où l'on est, et surtout comment revenir — d'où la croix, à un
 * endroit fixe, plutôt qu'un geste à deviner.
 *
 * Fermer ne change pas la personne racine : l'arbre revient exactement comme
 * on l'avait laissé.
 */
export interface FamilyBannerProps {
  person: Person;
  /** Nombre de personnes affichées dans cette famille. */
  count: number;
  onClose: () => void;
}

export function FamilyBanner({ person, count, onClose }: FamilyBannerProps) {
  return (
    <div className="family-banner lg lg--thick lg--bar" role="status">
      <div className="family-banner-text">
        <span className="family-banner-label">Famille de</span>
        <strong className="family-banner-name">{person.displayName}</strong>
        <span className="family-banner-count">
          {count} personne{count > 1 ? 's' : ''}
        </span>
      </div>
      <button
        type="button"
        className="icon-button family-banner-close"
        onClick={onClose}
        aria-label="Fermer et revenir à l’arbre"
        title="Revenir à l’arbre"
      >
        <CloseIcon />
      </button>
    </div>
  );
}
