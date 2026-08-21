import { useState } from 'react';
import type { Anomaly } from '@/domain/check';
import { CloseIcon } from './icons';

export interface DataNoticeProps {
  anomalies: Anomaly[];
  /** Ouvre la fiche de la personne concernée. */
  onSelect: (id: string) => void;
}

/** Au-delà, la liste devient un mur : le reste attend dans la console. */
const SHOWN = 6;

/**
 * Le bandeau des incohérences.
 *
 * Il n'apparaît que s'il y a quelque chose à dire, et disparaît pour de bon
 * quand on le referme : c'est un outil de saisie, pas une alerte. Chaque ligne
 * est cliquable — la seule chose qu'on veuille faire d'une anomalie, c'est
 * aller voir la personne concernée.
 */
export function DataNotice({ anomalies, onSelect }: DataNoticeProps) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || anomalies.length === 0) return null;

  const erreurs = anomalies.filter((a) => a.level === 'erreur').length;
  const doutes = anomalies.length - erreurs;

  return (
    <aside className="notice lg lg--thick" role="status">
      <div className="notice-head">
        <span className="notice-title">
          {erreurs > 0 && `${erreurs} incohérence${erreurs > 1 ? 's' : ''}`}
          {erreurs > 0 && doutes > 0 && ' · '}
          {doutes > 0 && `${doutes} point${doutes > 1 ? 's' : ''} douteux`}
        </span>
        <button
          type="button"
          className="icon-button notice-close"
          onClick={() => setDismissed(true)}
          aria-label="Masquer les anomalies"
        >
          <CloseIcon />
        </button>
      </div>

      <ul className="notice-list">
        {anomalies.slice(0, SHOWN).map((anomaly, index) => (
          <li key={`${anomaly.message}-${index}`} data-level={anomaly.level}>
            {anomaly.id ? (
              <button type="button" onClick={() => onSelect(anomaly.id as string)}>
                {anomaly.message}
              </button>
            ) : (
              <span>{anomaly.message}</span>
            )}
          </li>
        ))}
      </ul>

      {anomalies.length > SHOWN && (
        <p className="notice-more">
          et {anomalies.length - SHOWN} autre{anomalies.length - SHOWN > 1 ? 's' : ''} — la liste
          complète est dans la console.
        </p>
      )}
    </aside>
  );
}
