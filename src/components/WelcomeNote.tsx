import { useMemo, useState } from 'react';
import type { FamilyGraph } from '@/domain/graph';
import type { Visitor } from '@/hooks/useVisitor';
import { CloseIcon } from './icons';

export interface WelcomeNoteProps {
  visitor: Visitor;
  graph: FamilyGraph;
  /** Nombre d'informations manquantes dans le périmètre courant. */
  gapCount: number;
  /** Enregistre qui cette personne est dans l'arbre. */
  onIdentify: (personId: string | null) => void;
  /** Bascule vers « À compléter ». */
  onOpenGaps: () => void;
}

/** Une absence plus longue que ça mérite qu'on redise bonjour, même sans
 *  nouveauté à annoncer. */
const LONG_ABSENCE_DAYS = 21;

const daysSince = (iso: string | null): number => {
  if (!iso) return Number.POSITIVE_INFINITY;
  return (Date.now() - new Date(iso).getTime()) / 86_400_000;
};

/** « Jean, Marie et 3 autres » — une énumération qui s'arrête avant de lasser. */
function enumerate(names: string[], max = 3): string {
  const kept = names.slice(0, max);
  const rest = names.length - kept.length;
  const head =
    kept.length > 1 ? `${kept.slice(0, -1).join(', ')} et ${kept[kept.length - 1]}` : kept[0] ?? '';
  if (rest === 0) return head;
  return `${kept.join(', ')} et ${rest} autre${rest > 1 ? 's' : ''}`;
}

/**
 * Le mot d'accueil.
 *
 * Il tient la place qu'aurait prise un courriel, et la tient mieux : la
 * personne est DÉJÀ devant l'arbre au moment où on lui parle. Lui souhaiter
 * la bienvenue, lui dire ce qui a bougé depuis son dernier passage et
 * l'inviter à combler un manque n'a jamais besoin de sortir du navigateur —
 * seul « revenir voir » en aurait eu besoin, et cela demandait un nom de
 * domaine.
 *
 * Il ne s'affiche pas à chaque visite : une première fois, quand il y a
 * vraiment quelque chose à annoncer, ou après une longue absence. Un mot qui
 * revient à chaque rechargement cesse d'être un mot d'accueil et devient une
 * fenêtre à fermer.
 */
export function WelcomeNote({ visitor, graph, gapCount, onIdentify, onOpenGaps }: WelcomeNoteProps) {
  const [dismissed, setDismissed] = useState(false);
  const [showVisitors, setShowVisitors] = useState(false);

  const { added, removed, edited } = visitor.news;
  const hasNews = added.length > 0 || removed.length > 0 || edited > 0;
  const longAbsence = daysSince(visitor.lastVisit) >= LONG_ABSENCE_DAYS;

  /** Le vrai prénom dès qu'on le connaît ; celui deviné d'après l'adresse
   *  sinon (voir `nameFromEmail` dans le Worker). */
  const person = visitor.personId ? graph.people.get(visitor.personId) : undefined;
  const name = person?.firstName ?? visitor.name;

  // Les gens de l'arbre, par ordre alphabétique, pour se désigner.
  const roster = useMemo(
    () =>
      [...graph.people.values()]
        .map((entry) => ({ id: entry.id, label: entry.displayName }))
        .sort((a, b) => a.label.localeCompare(b.label, 'fr')),
    [graph],
  );

  if (dismissed) return null;
  if (!visitor.firstVisit && !hasNews && !longAbsence) return null;

  return (
    <aside className="welcome lg lg--thick lg--liquid" role="status">
      <div className="welcome-head">
        <p className="welcome-greeting">
          {visitor.firstVisit ? 'Bienvenue' : 'Bon retour'} {name}
        </p>
        <button
          type="button"
          className="icon-button welcome-close"
          onClick={() => setDismissed(true)}
          aria-label="Fermer ce message"
        >
          <CloseIcon />
        </button>
      </div>

      {visitor.firstVisit && (
        <p className="welcome-line">
          Vous êtes dans l’arbre de la famille — {graph.people.size} personnes sur{' '}
          {graph.generations.length} générations. Cliquez sur quelqu’un pour ouvrir sa fiche.
        </p>
      )}

      {hasNews && (
        <p className="welcome-line">
          Depuis votre dernière visite :{' '}
          {added.length > 0 && (
            <>
              <strong>{enumerate(added)}</strong>{' '}
              {added.length > 1 ? 'ont rejoint l’arbre' : 'a rejoint l’arbre'}
            </>
          )}
          {added.length > 0 && (removed.length > 0 || edited > 0) && ', '}
          {removed.length > 0 && (
            <>
              {enumerate(removed)} {removed.length > 1 ? 'en sont sortis' : 'en est sorti'}
            </>
          )}
          {removed.length > 0 && edited > 0 && ', '}
          {edited > 0 && (
            <>
              {edited} fiche{edited > 1 ? 's' : ''} complétée{edited > 1 ? 's' : ''}
            </>
          )}
          .
        </p>
      )}

      {/*
        L'invitation à compléter. Elle vient en dernier et reste une phrase,
        pas une injonction : un arbre généalogique est incomplet par nature,
        et ce qui manque n'est pas une faute de la personne qui lit.
      */}
      {gapCount > 0 && (
        <p className="welcome-line">
          {gapCount} information{gapCount > 1 ? 's' : ''} restent à retrouver. Si vous connaissez
          une date, un lieu, un métier,{' '}
          <button type="button" className="welcome-link" onClick={onOpenGaps}>
            n’hésitez pas à compléter
          </button>
          .
        </p>
      )}

      {/*
        Se désigner dans l'arbre. Proposé une seule fois — tant que c'est
        utile, c'est-à-dire tant que personne ne l'a fait — et jamais imposé :
        le prénom deviné d'après l'adresse suffit à dire bonjour.
      */}
      {!visitor.personId && (
        <label className="welcome-identify">
          <span>Vous êtes qui dans l’arbre ?</span>
          <select
            defaultValue=""
            onChange={(event) => event.target.value && onIdentify(event.target.value)}
          >
            <option value="">Je préfère ne pas le dire</option>
            {roster.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {/*
        Qui est venu. Réservé à qui tient l'arbre — c'est la seule chose de
        ce panneau qui parle des autres plutôt qu'à la personne qui lit.
      */}
      {visitor.owner && visitor.visitors && visitor.visitors.length > 0 && (
        <div className="welcome-visitors">
          <button type="button" className="welcome-link" onClick={() => setShowVisitors((v) => !v)}>
            {visitor.visitors.length} personne{visitor.visitors.length > 1 ? 's' : ''} se{' '}
            {visitor.visitors.length > 1 ? 'sont' : 'est'} connectée
            {visitor.visitors.length > 1 ? 's' : ''}
            {showVisitors ? ' — masquer' : ' — voir'}
          </button>
          {showVisitors && (
            <ul>
              {visitor.visitors.map((entry) => {
                const who = entry.personId ? graph.people.get(entry.personId) : undefined;
                return (
                  <li key={entry.email}>
                    <span className="welcome-visitor-who">{who?.displayName ?? entry.email}</span>
                    <span className="welcome-visitor-when">
                      {entry.visits} visite{entry.visits > 1 ? 's' : ''} · dernière le{' '}
                      {new Date(entry.lastSeen).toLocaleDateString('fr-FR')}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </aside>
  );
}
