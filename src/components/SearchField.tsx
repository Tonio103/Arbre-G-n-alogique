import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { FamilyGraph } from '@/domain/graph';
import { searchPeople, type SearchIndex } from '@/domain/search';
import { describeRelationship, descendantsOf } from '@/domain/relations';
import { formatLifespan } from '@/domain/dates';
import { Avatar } from './Avatar';

export interface SearchFieldProps {
  graph: FamilyGraph;
  index: SearchIndex;
  onPick: (id: string) => void;
  /** Compte total, affiché comme repère quand le champ est vide. */
  total: number;
  /** Personne de référence : chaque résultat dit ce qu'il est pour elle. */
  anchorId?: string | null;
}

const MAX_RESULTS = 24;

/** Filtre sur l'état civil. */
type Vitality = 'tous' | 'vivants' | 'disparus';

/**
 * Recherche par prénom, nom ou nom complet.
 *
 * Le filtrage tourne sur un index préparé une seule fois : la frappe reste
 * fluide même quand l'arbre compte plusieurs milliers de personnes.
 */
export function SearchField({ graph, index, onPick, total, anchorId }: SearchFieldProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [vitality, setVitality] = useState<Vitality>('tous');
  const [branch, setBranch] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const deferredQuery = useDeferredValue(query);

  /**
   * Les membres d'une branche : la descendance de la personne qui lui donne
   * son nom, et les conjoints qui l'ont rejointe — une branche coupée de ses
   * pièces rapportées ne serait pas une famille.
   */
  const branchMembers = useMemo(() => {
    if (!branch) return null;
    const inside = new Set<string>([branch]);
    for (const id of descendantsOf(graph, branch).keys()) inside.add(id);
    for (const id of [...inside]) {
      for (const link of graph.people.get(id)?.spouseLinks ?? []) inside.add(link.id);
    }
    return inside;
  }, [graph, branch]);

  const filtering = vitality !== 'tous' || branch !== null;

  const keep = useCallback(
    (id: string): boolean => {
      if (branchMembers && !branchMembers.has(id)) return false;
      if (vitality === 'tous') return true;
      const gone = graph.people.get(id)?.deathDate !== undefined;
      return vitality === 'disparus' ? gone : !gone;
    },
    [branchMembers, vitality, graph],
  );

  const results = useMemo(() => {
    const term = deferredQuery.trim();

    // Sans texte mais avec un filtre, la recherche devient un parcours : on
    // liste ce qui correspond, dans l'ordre de l'arbre. C'est ce qui permet de
    // demander « qui est encore là dans la branche de Bretagne ? » sans
    // connaître un seul nom.
    if (term.length === 0) {
      if (!filtering) return [];
      const found: { id: string; score: number }[] = [];
      for (const id of graph.order) {
        if (!keep(id)) continue;
        found.push({ id, score: 0 });
        if (found.length >= MAX_RESULTS) break;
      }
      return found;
    }

    return searchPeople(index, term, MAX_RESULTS * 3).filter((hit) => keep(hit.id)).slice(0, MAX_RESULTS);
  }, [index, deferredQuery, filtering, keep, graph.order]);

  useEffect(() => {
    setActive(0);
  }, [deferredQuery, vitality, branch]);

  // Raccourci global : ⌘K ou Ctrl+K place le curseur dans le champ.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // Garde l'élément actif visible pendant la navigation au clavier.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const element = list.children[active] as HTMLElement | undefined;
    element?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = useCallback(
    (id: string) => {
      onPick(id);
      setOpen(false);
      inputRef.current?.blur();
    },
    [onPick],
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      if (query) setQuery('');
      else inputRef.current?.blur();
      setOpen(false);
      return;
    }
    if (results.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((value) => (value + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((value) => (value - 1 + results.length) % results.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const hit = results[active];
      if (hit) choose(hit.id);
    }
  };

  const showResults = open && (query.trim().length > 0 || filtering);

  return (
    <div className="search" ref={containerRef}>
      <div className="search-field lg lg--control lg--pill lg--bar" data-open={showResults || undefined}>
        <svg className="search-icon" viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="9" cy="9" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
          <path d="M13.6 13.6 L17.4 17.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>

        <input
          ref={inputRef}
          type="search"
          className="search-input"
          value={query}
          placeholder="Rechercher une personne"
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={showResults}
          aria-controls="search-results"
          aria-autocomplete="list"
          aria-label={`Rechercher parmi ${total} personnes`}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />

        {query ? (
          <button
            type="button"
            className="search-clear"
            aria-label="Effacer la recherche"
            onClick={() => {
              setQuery('');
              inputRef.current?.focus();
            }}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M4.5 4.5 L11.5 11.5 M11.5 4.5 L4.5 11.5"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            </svg>
          </button>
        ) : (
          <kbd className="search-kbd" aria-hidden="true">
            ⌘K
          </kbd>
        )}
      </div>

      {open && (
        <div className="search-results lg lg--thick lg--liquid" role="presentation">
          {/*
            * Les filtres.
            *
            * Ils servent autant à chercher qu'à parcourir : sans un mot tapé,
            * ils répondent déjà à « qui est encore là ? » ou « qui est dans
            * cette branche ? ».
            */}
          <div className="search-filters">
            {(['tous', 'vivants', 'disparus'] as const).map((value) => (
              <button
                key={value}
                type="button"
                className="search-chip lg lg--chip lg--pill lg--interactive"
                data-on={vitality === value || undefined}
                onClick={() => setVitality(value)}
              >
                {value === 'tous' ? 'Tous' : value === 'vivants' ? 'Vivants' : 'Disparus'}
              </button>
            ))}

            {graph.branches.length > 0 && <span className="search-filters-sep" aria-hidden="true" />}

            {graph.branches.slice(0, 6).map((anchor) => (
              <button
                key={anchor.anchorId}
                type="button"
                className="search-chip lg lg--chip lg--pill lg--interactive"
                data-on={branch === anchor.anchorId || undefined}
                onClick={() =>
                  setBranch((current) => (current === anchor.anchorId ? null : anchor.anchorId))
                }
                title={anchor.label}
              >
                {anchor.label.split(' — ')[0]}
              </button>
            ))}
          </div>

          {results.length === 0 ? (
            <p className="search-empty">
              {query.trim()
                ? `Aucune personne ne correspond à « ${query.trim()} ».`
                : filtering
                  ? 'Aucune personne ne correspond à ce filtre.'
                  : `Tapez un nom, ou choisissez un filtre pour parcourir les ${total} personnes.`}
            </p>
          ) : (
            <>
              <p className="search-count">
                {results.length === MAX_RESULTS
                  ? `${MAX_RESULTS} premiers résultats`
                  : `${results.length} résultat${results.length > 1 ? 's' : ''}`}
              </p>
              <ul id="search-results" className="search-list scroll-area" role="listbox" ref={listRef}>
                {results.map((hit, position) => {
                  const person = graph.people.get(hit.id);
                  if (!person) return null;
                  const lifespan = formatLifespan(person.birthDate, person.deathDate);
                  // Ce que cette personne est pour le point de repère. C'est
                  // presque toujours plus parlant que son métier.
                  const kinship =
                    anchorId && anchorId !== person.id
                      ? describeRelationship(graph, anchorId, person.id)
                      : undefined;
                  return (
                    <li key={hit.id}>
                      <button
                        type="button"
                        className="search-result"
                        role="option"
                        aria-selected={position === active}
                        data-active={position === active || undefined}
                        onPointerEnter={() => setActive(position)}
                        onClick={() => choose(hit.id)}
                      >
                        <Avatar
                          id={person.id}
                          initials={person.initials}
                          photo={person.photo}
                          size={34}
                        />
                        <span className="search-result-text">
                          <span className="search-result-name">{person.displayName}</span>
                          <span className="search-result-meta">
                            {[lifespan, kinship ?? person.profession ?? person.headline]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </span>
                        <span className="search-result-gen">G{person.generation + 1}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
