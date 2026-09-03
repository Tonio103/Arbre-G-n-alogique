import { useCallback, useEffect, useState } from 'react';

/** Une visite passée, telle que le Worker la garde. */
export interface VisitorRecord {
  email: string;
  firstSeen: string;
  lastSeen: string;
  visits: number;
  personId?: string;
}

export interface Visitor {
  email: string;
  /** Prénom deviné d'après l'adresse, remplacé par le vrai dès que la
   *  personne s'est désignée dans l'arbre. */
  name: string;
  /** Qui cette personne est dans l'arbre, si elle l'a dit. */
  personId: string | null;
  firstVisit: boolean;
  lastVisit: string | null;
  visits: number;
  /** Vrai pour la seule adresse déclarée comme tenant l'arbre. */
  owner: boolean;
  news: { added: string[]; removed: string[]; edited: number };
  /** Renseigné pour cette personne-là uniquement. */
  visitors?: VisitorRecord[];
}

/**
 * Qui regarde l'arbre, et ce qui a changé depuis son dernier passage.
 *
 * Tout vient de Cloudflare Access, qui sait déjà qui passe la porte : il n'y
 * a ni compte à créer, ni mot de passe, ni consentement à demander — la
 * personne s'est identifiée à l'entrée, l'application se contente de le
 * savoir (voir `identify` dans `worker/index.ts`).
 *
 * `null` quand il n'y a personne à saluer : en développement local, où
 * Access n'est pas devant, et si le Worker ne répond pas. L'application doit
 * marcher exactement pareil dans ce cas — l'accueil est un supplément, pas
 * une condition.
 */
export function useVisitor(): {
  visitor: Visitor | null;
  /** Enregistre qui cette personne est dans l'arbre. */
  identify: (personId: string | null) => void;
} {
  const [visitor, setVisitor] = useState<Visitor | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/visitor')
      .then((response) => (response.ok ? response.json() : null))
      .then((data: (Visitor & { known: boolean }) | null) => {
        if (cancelled || !data?.known) return;
        setVisitor(data);
      })
      .catch(() => {
        // Hors ligne, ou Worker injoignable : on n'affiche simplement rien.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const identify = useCallback((personId: string | null) => {
    // Optimiste : la réponse du serveur n'apprendrait rien de plus, et
    // l'accueil doit réagir tout de suite au choix qu'on vient de faire.
    setVisitor((current) => (current ? { ...current, personId } : current));
    void fetch('/api/visitor', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ personId }),
    }).catch(() => {
      // Sans conséquence : la personne pourra se redésigner au prochain
      // passage, et l'accueil retombe sur le prénom deviné d'ici là.
    });
  }, []);

  return { visitor, identify };
}
