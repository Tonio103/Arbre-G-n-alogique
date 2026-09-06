import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FamilyGraph } from '@/domain/graph';
import type { NodePosition, TreeLayout } from '@/domain/layout';
import type { HighlightSet, RelationPath } from '@/domain/relations';
import type { SpatialIndex } from '@/view/spatial';
import type { ViewportController } from '@/view/viewport';
import { visibleRect } from '@/view/viewport';
import type { HoverStore } from '@/view/hover-store';
import { LOD_COMPACT, LOD_FULL, cardCenterX, portraitCenterY } from '@/view/metrics';
import { etatBotanique, type EtatBotanique } from '@/domain/gaps';
import { PersonNode, type NodeDetail } from './PersonNode';
import { LinkLayer } from './LinkLayer';
import { PathFlow } from './PathFlow';

export interface TreeCanvasProps {
  graph: FamilyGraph;
  layout: TreeLayout;
  spatial: SpatialIndex;
  viewport: ViewportController;
  hoverStore: HoverStore;
  highlight: HighlightSet;
  selectedId: string | null;
  /** Personne mise en avant par la recherche. */
  flaggedId: string | null;
  onSelect: (id: string | null) => void;
  theme: string;
  /** Personnes du chemin de parenté courant. */
  pathPeople?: Set<string>;
  /** Unions traversées par ce chemin. */
  pathUnions?: Set<string>;
  /** Le chemin complet, ordonné — pour animer la lumière qui le parcourt. */
  relation?: RelationPath;
  /** Union tout juste créée : son trait se dessine au lieu d'apparaître d'un coup. */
  growingUnionId?: string | null;
}

interface VisibleState {
  nodes: NodePosition[];
  detail: NodeDetail | 'none';
}

const EMPTY_VISIBLE: VisibleState = { nodes: [], detail: 'none' };

/* ---------------------------------------------------------------------------
 * LA REPLANTATION
 *
 * « Repartir d'ici » redessine l'arbre autour d'une autre personne. Le
 * commentaire de ce bouton le dit lui-même : trente-sept personnes sur quatre-
 * vingts ne sont atteignables que par lui. C'était pourtant le moment le plus
 * désorientant de l'application — tout l'arbre se dissolvait (`node-materialize`
 * : opacité nulle, échelle 0,5, flou de quatre pixels) et se reformait ailleurs.
 * On perdait complètement où sa branche était partie.
 *
 * Les cartes VOYAGENT donc de leur ancienne place à la nouvelle. Les
 * identifiants sont stables d'une disposition à l'autre, le rapprochement est
 * donc exact : qui reste voyage, qui entre se matérialise comme avant.
 *
 * Le voyage s'exprime en unités du MONDE, et c'est ce qui le rend possible :
 * les cartes sont positionnées en `left`/`top` dans `.world`, pas en
 * coordonnées d'écran. La caméra vole vers la nouvelle racine pendant ce
 * temps-là — les deux mouvements se composent au lieu de se combattre, ce qui
 * serait arrivé avec un déplacement exprimé à l'écran.
 *
 * `translate` et non `transform` : ce sont deux propriétés distinctes que le
 * navigateur compose lui-même. `.node` se sert déjà de `transform` pour le
 * survol et la matérialisation ; les écrire au même endroit aurait voulu dire
 * les recomposer à la main.
 * ------------------------------------------------------------------------- */

/** Un peu plus que le vol de caméra (620 ms) : les cartes se posent après lui. */
const VOYAGE_MS = 760;

/** En deçà, ce n'est pas un voyage mais un arrondi de placement. */
const VOYAGE_SEUIL = 0.5;

/** Le niveau de détail suit le zoom : texte complet, prénom seul, puis points. */
function detailForScale(scale: number): NodeDetail | 'none' {
  if (scale >= LOD_FULL) return 'full';
  if (scale >= LOD_COMPACT) return 'compact';
  return 'none';
}

function sameNodes(a: NodePosition[], b: NodePosition[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].id !== b[i].id) return false;
  }
  return true;
}

/**
 * Zone de navigation : gère le déplacement, le zoom et le montage des seules
 * cartes visibles. Le nombre de personnes dans l'arbre n'influe pas sur le
 * coût d'une image — seule compte la surface affichée.
 */
export function TreeCanvas({
  graph,
  layout,
  spatial,
  viewport,
  hoverStore,
  highlight,
  selectedId,
  flaggedId,
  onSelect,
  theme,
  pathPeople,
  pathUnions,
  relation,
  growingUnionId,
}: TreeCanvasProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState<VisibleState>(EMPTY_VISIBLE);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  const [grabbing, setGrabbing] = useState(false);
  const draggedRef = useRef(false);

  /*
   * Le voyage se prépare au changement de disposition, mais ne peut être joué
   * qu'une image plus tard.
   *
   * Le recensement des cartes visibles passe par un `requestAnimationFrame` :
   * au moment où la disposition change, le DOM porte encore les ANCIENNES
   * positions. Jouer l'animation là annulerait son propre effet — on
   * décalerait les cartes depuis l'endroit où elles sont déjà. On retient donc
   * les écarts et on les joue quand le recensement a posé les cartes à leur
   * nouvelle place.
   */
  const positionsPrecedentes = useRef(layout.positions);
  const voyageEnAttente = useRef<{
    ecarts: Map<string, { dx: number; dy: number }>;
    montees: Set<string>;
    pour: TreeLayout;
  } | null>(null);

  // --- Transform appliquée directement au DOM, hors cycle de rendu React ---
  useEffect(() => {
    const world = worldRef.current;
    const stage = stageRef.current;
    if (!world || !stage) return undefined;

    let pending = 0;
    // Transform au dernier recensement des cartes visibles.
    let committed: { x: number; y: number; scale: number } | null = null;

    const commitVisible = (): void => {
      pending = 0;
      const box = stage.getBoundingClientRect();
      const transform = viewport.transform;

      // Le recensement n'a pas à suivre chaque image.
      //
      // Il interroge l'index spatial, trie le résultat et, quand la liste
      // change, remonte un état à React qui monte et démonte des dizaines de
      // médaillons. À pleine vitesse, cela peut arriver soixante fois par
      // seconde pour un déplacement de quelques pixels.
      //
      // Les cartes vivent dans le conteneur transformé : elles suivent le
      // déplacement toutes seules. Seule la *liste* doit être rafraîchie, et
      // comme on recense large — deux cent quatre-vingts pixels au-delà du
      // cadre — on peut laisser la vue prendre cent pixels d'avance avant d'y
      // revenir. Personne ne peut voir la différence ; la machine, si.
      if (
        committed !== null &&
        committed.scale === transform.scale &&
        Math.abs(committed.x - transform.x) < 100 &&
        Math.abs(committed.y - transform.y) < 100
      ) {
        return;
      }
      committed = { x: transform.x, y: transform.y, scale: transform.scale };

      const detail = detailForScale(transform.scale);
      const rect = visibleRect(transform, { width: box.width, height: box.height }, 280);
      const nodes = detail === 'none' ? [] : spatial.visibleNodes(rect);
      nodes.sort((a, b) => a.y - b.y || a.x - b.x);

      const previous = visibleRef.current;
      if (previous.detail === detail && sameNodes(previous.nodes, nodes)) {
        return;
      }
      setVisible({ nodes, detail });
    };

    /*
     * `.world` ne promeut sa propre couche GPU à AUCUN moment — voir plus bas
     * pourquoi, mais figé, c'est le bon choix : le zoom rendait sinon les
     * portraits flous en permanence. Le défaut opposé s'est révélé tout aussi
     * réel pendant un geste : sans couche dédiée, chaque image d'un glissé ou
     * d'un zoom oblige le navigateur à repeindre le sous-arbre entier — des
     * dizaines de portraits, halos et plaques de verre — plutôt que de
     * recomposer un calque déjà prêt.
     *
     * `will-change` ne se pose donc que PENDANT le mouvement, et se retire
     * environ deux dixièmes de seconde après la dernière image du geste : le
     * temps qu'il reste posé est trop court pour qu'une couche y garde une
     * image figée assez longtemps pour qu'on la remarque, et une fois retiré,
     * le rendu à l'arrêt redevient net au pixel près — exactement l'état
     * déjà vérifié.
     */
    /*
     * Ce qui flotte AU-DESSUS de l'arbre paie le même prix que les plaques
     * de nom qui sont DEDANS — et pour une raison à laquelle on ne pense pas
     * d'emblée : la barre du haut, la frise des générations, la fiche
     * ouverte ne bougent pas pendant un glissé, mais ce qu'il y a DERRIÈRE
     * elles, si — c'est tout l'arbre qui défile sous des panneaux fixes. Un
     * flou d'arrière-plan échantillonne ce qui est dessous à chaque image,
     * qu'il soit lui-même en mouvement ou non : rester immobile ne met donc
     * PAS ces panneaux à l'abri, puisqu'ils regardent chacun un rectangle de
     * scène qui change en continu.
     *
     * Mesuré autrement qu'en chiffres : la barre du haut et la fiche ouverte
     * sont deux flous de 28 à 30 pixels sur une bien plus grande surface que
     * cinquante plaques de 9 pixels — la dépense qu'ils paient à eux deux
     * pendant un glissé peut aisément dépasser celle de tous les médaillons
     * réunis.
     *
     * L'attribut se pose donc sur la racine du document, pas sur `.world` :
     * ces panneaux ne sont pas ses descendants, une classe CSS ne peut pas
     * les viser depuis un ancêtre qui n'est pas le leur. Une seule règle,
     * dans `liquid-glass.css`, suspend alors le flou de TOUTE surface de
     * verre à la fois — les plaques comme les panneaux fixes — pendant le
     * geste et les deux dixièmes de seconde qui suivent, le même délai que
     * `will-change`. La teinte, la nappe, l'arête restent : ce sont des
     * dégradés, pas des échantillons, ils ne coûtent rien de plus en
     * mouvement.
     */
    let movingTimer = 0;
    const root = document.documentElement;
    const apply = (): void => {
      const transform = viewport.transform;
      world.style.transform = `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`;
      world.style.willChange = 'transform';
      root.setAttribute('data-panning', '');
      window.clearTimeout(movingTimer);
      movingTimer = window.setTimeout(() => {
        world.style.willChange = 'auto';
        root.removeAttribute('data-panning');
      }, 200);
      if (!pending) pending = requestAnimationFrame(commitVisible);
    };

    apply();
    const unsubscribe = viewport.subscribe(apply);

    const resize = (): void => {
      const box = stage.getBoundingClientRect();
      viewport.setSize({ width: box.width, height: box.height });
      // Le cadre a changé de taille : le recensement doit être refait même si
      // la vue, elle, n'a pas bougé d'un pixel.
      committed = null;
      apply();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(stage);

    return () => {
      unsubscribe();
      observer.disconnect();
      if (pending) cancelAnimationFrame(pending);
      window.clearTimeout(movingTimer);
      root.removeAttribute('data-panning');
    };
  }, [viewport, spatial]);

  // --- Déplacement, pincement, molette ---
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;

    const pointers = new Map<number, { x: number; y: number }>();
    let panning = false;
    let lastX = 0;
    let lastY = 0;
    let lastTime = 0;
    let velocityX = 0;
    let velocityY = 0;
    let pinchDistance = 0;

    const distance = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
      Math.hypot(a.x - b.x, a.y - b.y);

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      draggedRef.current = false;

      if (pointers.size === 1) {
        panning = true;
        lastX = event.clientX;
        lastY = event.clientY;
        lastTime = event.timeStamp;
        velocityX = 0;
        velocityY = 0;
        viewport.beginInteraction();
        setGrabbing(true);
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDistance = distance(a, b);
        panning = false;
      }
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const next = distance(a, b);
        if (pinchDistance > 0 && next > 0) {
          const rect = stage.getBoundingClientRect();
          viewport.zoomAt(
            (a.x + b.x) / 2 - rect.left,
            (a.y + b.y) / 2 - rect.top,
            next / pinchDistance,
          );
        }
        pinchDistance = next;
        draggedRef.current = true;
        return;
      }

      if (!panning) return;
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      if (!draggedRef.current && Math.hypot(event.clientX - lastX, event.clientY - lastY) > 0) {
        // Seuil : un léger tremblement pendant le clic ne doit pas annuler la sélection.
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
          draggedRef.current = true;
          // La capture n'est prise qu'ici, une fois le déplacement avéré.
          //
          // Capturer dès l'appui détourne vers la zone de navigation le clic
          // que le navigateur synthétise après un toucher : sur mobile, appuyer
          // sur une personne n'ouvrait alors jamais sa fiche.
          stage.setPointerCapture(event.pointerId);
        }
      }

      const elapsed = Math.max(1, event.timeStamp - lastTime);
      velocityX = dx / elapsed;
      velocityY = dy / elapsed;
      lastX = event.clientX;
      lastY = event.clientY;
      lastTime = event.timeStamp;
      viewport.panBy(dx, dy);
    };

    const endPointer = (event: PointerEvent): void => {
      if (!pointers.delete(event.pointerId)) return;
      if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);

      if (pointers.size === 0) {
        if (panning) {
          const idle = event.timeStamp - lastTime > 90;
          viewport.endInteraction(idle ? 0 : velocityX, idle ? 0 : velocityY);
        }
        panning = false;
        pinchDistance = 0;
        setGrabbing(false);
      } else if (pointers.size === 1) {
        const [remaining] = [...pointers.values()];
        panning = true;
        lastX = remaining.x;
        lastY = remaining.y;
        lastTime = event.timeStamp;
        pinchDistance = 0;
      }
    };

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const rect = stage.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      const step = event.deltaMode === 1 ? event.deltaY * 18 : event.deltaY;
      const sideways = event.deltaMode === 1 ? event.deltaX * 18 : event.deltaX;

      // Molette crantée ou pavé tactile ?
      //
      // Les deux passent par le même événement, et une souris physique n'a pas
      // de quoi pincer. Une souris envoie un saut isolé, en gros crans ; un
      // pavé tactile envoie un flot de petits déplacements déjà continus. Le
      // volume du cran les sépare — c'est le seul indice disponible, et il
      // suffit à savoir lequel des deux appareils est en jeu.
      const notched = event.deltaMode === 1 || Math.abs(step) >= 42 || Math.abs(sideways) >= 42;

      if (event.ctrlKey || event.metaKey) {
        event.stopPropagation();
        const factor = Math.exp(-step * 0.0022);
        if (notched) viewport.zoomAtSmooth(x, y, factor);
        else viewport.zoomAt(x, y, factor);
        return;
      }

      if (event.shiftKey) {
        if (notched) viewport.panBySmooth(-step, 0);
        else {
          viewport.stopAnimation();
          viewport.panBy(-step, 0);
        }
        return;
      }

      // Souris ou pavé tactile : le geste qu'on attend d'eux n'est pas le même.
      //
      // Un pavé tactile pince pour zoomer et glisse à deux doigts pour
      // déplacer la vue — c'est déjà le geste naturel, et le laisser faire
      // continue de parcourir l'arbre comme on tourne les pages d'un plan.
      // Une souris, elle, n'a que sa molette : sur un si grand plan, en faire
      // un défilement plutôt qu'un zoom est le contraire de ce que chacun a
      // appris de toutes les cartes et de toutes les visionneuses qu'il a
      // ouvertes. Le cran de la molette suffit à distinguer les deux, sans
      // qu'aucun des deux gestes n'ait besoin d'une touche supplémentaire.
      if (notched) {
        viewport.zoomAtSmooth(x, y, Math.exp(-step * 0.0022));
        return;
      }

      viewport.stopAnimation();
      viewport.panBy(-sideways, -step);
    };

    const onDoubleClick = (event: MouseEvent): void => {
      const rect = stage.getBoundingClientRect();
      // Un double-clic double presque l'échelle : d'un coup, on ne sait plus où
      // l'on a atterri. Trois cent vingt millisecondes suffisent à ce que
      // l'œil suive le point qu'il visait.
      viewport.zoomAtSmooth(event.clientX - rect.left, event.clientY - rect.top, 1.75, 320);
    };

    stage.addEventListener('pointerdown', onPointerDown);
    stage.addEventListener('pointermove', onPointerMove);
    stage.addEventListener('pointerup', endPointer);
    stage.addEventListener('pointercancel', endPointer);
    stage.addEventListener('wheel', onWheel, { passive: false });
    stage.addEventListener('dblclick', onDoubleClick);

    return () => {
      stage.removeEventListener('pointerdown', onPointerDown);
      stage.removeEventListener('pointermove', onPointerMove);
      stage.removeEventListener('pointerup', endPointer);
      stage.removeEventListener('pointercancel', endPointer);
      stage.removeEventListener('wheel', onWheel);
      stage.removeEventListener('dblclick', onDoubleClick);
    };
  }, [viewport]);

  const handleSelect = useCallback(
    (id: string) => {
      // Un déplacement de l'arbre ne doit pas se terminer par une sélection.
      if (draggedRef.current) return;
      onSelect(id);
    },
    [onSelect],
  );

  const handleHover = useCallback(
    (id: string | null) => {
      hoverStore.set(id);
    },
    [hoverStore],
  );

  const handleBackgroundClick = useCallback(() => {
    if (draggedRef.current) return;
    onSelect(null);
  }, [onSelect]);

  /*
   * Circuler dans l'arbre aux flèches.
   *
   * Les médaillons sont des boutons, donc déjà atteignables à la tabulation —
   * mais tabuler traverse quarante cartes dans l'ordre du DOM, qui n'est pas
   * celui de la parenté. Les flèches suivent ce que l'œil suivrait : vers le
   * haut on remonte aux parents, vers le bas on redescend, sur les côtés on
   * longe la fratrie.
   *
   * On cherche le voisin le plus proche DANS la direction demandée, en pesant
   * l'écart latéral plus lourd que l'écart dans l'axe : sans cela, une carte
   * très loin sur le côté mais à peine plus haut l'emporterait sur le parent
   * qui se trouve juste au-dessus.
   */
  const moveFocus = useCallback(
    (from: string, dx: number, dy: number): void => {
      const origin = layout.positions.get(from);
      if (!origin) return;

      let best: string | undefined;
      let bestCost = Number.POSITIVE_INFINITY;

      for (const candidate of layout.positions.values()) {
        if (candidate.id === from) continue;
        const ax = candidate.x - origin.x;
        const ay = candidate.y - origin.y;
        // Écarter tout ce qui n'est pas franchement dans la direction visée.
        const along = dx !== 0 ? ax * dx : ay * dy;
        const across = dx !== 0 ? Math.abs(ay) : Math.abs(ax);
        if (along <= 0) continue;
        const cost = along + across * 2.5;
        if (cost < bestCost) {
          bestCost = cost;
          best = candidate.id;
        }
      }

      if (!best) return;
      const target = document.querySelector<HTMLElement>(`.node[data-id="${CSS.escape(best)}"]`);
      // Hors du cadre visible, la carte n'est pas montée : on la sélectionne,
      // ce qui amène la vue sur elle, et le focus suivra au prochain rendu.
      if (target) target.focus();
      else onSelect(best);
    },
    [layout, onSelect],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      const active = document.activeElement as HTMLElement | null;
      const from = active?.dataset?.id;
      if (!from || !active?.classList.contains('node')) return;

      const moves: Record<string, [number, number]> = {
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
      };
      const move = moves[event.key];
      if (!move) return;
      event.preventDefault();
      moveFocus(from, move[0], move[1]);
    },
    [moveFocus],
  );


  const hasSelection = highlight.people.size > 0;

  const detail = visible.detail;

  /*
   * L'état botanique de chaque fiche, pour feuiller les branches.
   *
   * Calculé ici, en une fois pour tout l'arbre, et non dans `drawLinks` :
   * cette couche est redessinée à chaque recadrage du canevas, et le tracé ne
   * doit rien savoir du contenu des fiches. `graph.people` ne change qu'à une
   * modification réelle des données.
   */
  /*
   * D'où part la sève.
   *
   * Le centre du PORTRAIT, et non celui de la carte : c'est là que les traits
   * d'alliance viennent se rattacher, donc le point que le réseau de branches
   * touche réellement. Partir du centre de la carte ferait chercher au front
   * son entrée dans le réseau à côté de la personne qu'on vient de choisir.
   */
  const source = useMemo(() => {
    if (!selectedId) return null;
    const position = layout.positions.get(selectedId);
    if (!position) return null;
    return { x: cardCenterX(position.x), y: portraitCenterY(position.y) };
  }, [selectedId, layout]);

  /*
   * Qui s'est déplacé, et de combien.
   *
   * On ne retient que les cartes DÉJÀ MONTÉES : une carte qui entre dans le
   * cadre au même moment a sa propre animation d'arrivée, et lui ajouter un
   * voyage la ferait voler et surgir en même temps.
   */
  useEffect(() => {
    const avant = positionsPrecedentes.current;
    positionsPrecedentes.current = layout.positions;
    if (avant === layout.positions) return;

    const ecarts = new Map<string, { dx: number; dy: number }>();
    for (const [id, apres] of layout.positions) {
      const depart = avant.get(id);
      if (!depart) continue;
      const dx = depart.x - apres.x;
      const dy = depart.y - apres.y;
      if (Math.abs(dx) < VOYAGE_SEUIL && Math.abs(dy) < VOYAGE_SEUIL) continue;
      ecarts.set(id, { dx, dy });
    }

    voyageEnAttente.current =
      ecarts.size > 0
        ? {
            ecarts,
            montees: new Set(visibleRef.current.nodes.map((node) => node.id)),
            pour: layout,
          }
        : null;
  }, [layout]);

  /*
   * Et le voyage se joue, une fois les cartes reposées.
   *
   * `fill: 'backwards'` est indispensable : sans lui, la carte s'afficherait
   * une image à sa nouvelle place avant que l'animation ne la ramène en
   * arrière — un sursaut, précisément ce qu'on cherche à supprimer.
   */
  useLayoutEffect(() => {
    const voyage = voyageEnAttente.current;
    if (!voyage) return;
    // La disposition a encore changé entre-temps : ces écarts ne décrivent
    // plus le trajet réel, mieux vaut ne rien jouer qu'un faux mouvement.
    if (voyage.pour !== layout) {
      voyageEnAttente.current = null;
      return;
    }
    voyageEnAttente.current = null;

    const world = worldRef.current;
    if (!world) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let unSeulVoyage = false;
    for (const carte of world.querySelectorAll<HTMLElement>('.node[data-id]')) {
      const id = carte.dataset.id;
      if (!id || !voyage.montees.has(id)) continue;
      const ecart = voyage.ecarts.get(id);
      if (!ecart) continue;
      unSeulVoyage = true;
      carte.animate(
        [{ translate: `${ecart.dx}px ${ecart.dy}px` }, { translate: '0px 0px' }],
        { duration: VOYAGE_MS, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'backwards' },
      );
    }

    // Aucune carte n'a bougé à l'écran : la ramure n'a aucune raison de
    // s'effacer, et le clignotement se verrait pour rien.
    if (!unSeulVoyage) return;

    world.dataset.replantation = 'true';
    const fin = window.setTimeout(() => {
      delete world.dataset.replantation;
    }, VOYAGE_MS * 0.62);
    return () => window.clearTimeout(fin);
  }, [visible, layout]);

  const etats = useMemo(() => {
    const table = new Map<string, EtatBotanique>();
    for (const [id, person] of graph.people) table.set(id, etatBotanique(person));
    return table;
  }, [graph.people]);

  /*
   * QUI VIENT DE FLEURIR.
   *
   * En posant le langage des feuilles, on a écrit que « renseigner une date
   * fait éclore le bourgeon en feuille, sous les yeux ». Ce n'était pas vrai :
   * depuis que les feuilles sont peintes sur le canevas, l'ouverture n'existait
   * plus que pendant la montée de sève. On remplissait une date, et la feuille
   * apparaissait d'un coup, à sa taille définitive.
   *
   * On compare donc les états d'une modification à l'autre, et on ne retient
   * que le passage de ce qui est CLOS — bourgeon, rameau nu — à ce qui est
   * OUVERT. L'inverse n'est pas une éclosion : effacer une date referme une
   * fiche, et rien ne doit récompenser ça.
   *
   * Une personne qui vient d'entrer dans l'arbre n'éclôt pas non plus : elle a
   * déjà son animation d'arrivée, et sa feuille naît avec elle.
   */
  const etatsPrecedents = useRef(etats);
  const numeroEclosion = useRef(0);
  const [eclosion, setEclosion] = useState<{ ids: Set<string>; cle: number } | null>(null);

  useEffect(() => {
    const avant = etatsPrecedents.current;
    etatsPrecedents.current = etats;
    if (avant === etats) return;

    const ouvertes = new Set<string>();
    for (const [id, apres] of etats) {
      const depart = avant.get(id);
      if (!depart || depart === apres) continue;
      const etaitClos = depart === 'bourgeon' || depart === 'rameau-nu';
      const estOuvert = apres === 'feuille' || apres === 'feuille-seche';
      if (etaitClos && estOuvert) ouvertes.add(id);
    }

    if (ouvertes.size === 0) return;
    numeroEclosion.current += 1;
    setEclosion({ ids: ouvertes, cle: numeroEclosion.current });
  }, [etats]);

  return (
    <div
      ref={stageRef}
      className="stage"
      data-grabbing={grabbing || undefined}
      aria-label="Arbre généalogique — flèches pour circuler entre les personnes"
      onClick={handleBackgroundClick}
      onKeyDown={handleKeyDown}
    >
      <div ref={worldRef} className="world">
        <LinkLayer
          stageRef={stageRef}
          viewport={viewport}
          layout={layout}
          spatial={spatial}
          highlightUnions={highlight.unions}
          hasSelection={hasSelection}
          theme={theme}
          pathUnions={pathUnions}
          growingUnionId={growingUnionId}
          etats={etats}
          source={source}
          eclosion={eclosion}
        />

        <PathFlow layout={layout} relation={relation} />

        {detail !== 'none' &&
          visible.nodes.map((node) => {
            const person = graph.people.get(node.id);
            if (!person) return null;
            const role = highlight.people.get(node.id);
            return (
              <PersonNode
                key={node.id}
                person={person}
                x={node.x}
                y={node.y}
                detail={detail}
                role={role}
                dimmed={hasSelection && !role}
                selected={selectedId === node.id}
                flagged={flaggedId === node.id}
                onPath={pathPeople?.has(node.id) || undefined}
                hiddenKin={layout.hiddenKin.get(node.id)}
                onSelect={handleSelect}
                onHover={handleHover}
              />
            );
          })}
      </div>
    </div>
  );
}
