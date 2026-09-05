import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useFamilyTree } from '@/hooks/useFamilyTree';
import { unionKey } from '@/domain/graph';
import { useDataset } from '@/hooks/useDataset';
import { useTheme } from '@/hooks/useTheme';
import { useVisitor } from '@/hooks/useVisitor';
import { useIsCompact } from '@/hooks/useMediaQuery';
import { computeHighlight, relationPath, type HighlightMode } from '@/domain/relations';
import {
  addChild,
  addParent,
  addSpouse,
  createPerson,
  deletePerson,
  detachChild,
  detachParent,
  detachSpouse,
  linkChild,
  linkParent,
  linkSpouse,
  updateUnion,
  upsertPerson,
  type NewPersonInput,
} from '@/domain/edit';
import type { PersonRecord, UnionStatus } from '@/data/schema';
import { ViewportController, transformForBounds } from '@/view/viewport';
import { HoverStore } from '@/view/hover-store';
import { CARD_HEIGHT, CARD_WIDTH, FIT_PADDING } from '@/view/metrics';
import { Backdrop } from '@/components/Backdrop';
import { LoadingScreen } from '@/components/LoadingScreen';
import { TopBar } from '@/components/TopBar';
import { TreeCanvas } from '@/components/TreeCanvas';
import { DetailPanel } from '@/components/DetailPanel';
import { DataNotice } from '@/components/DataNotice';
import { WelcomeNote } from '@/components/WelcomeNote';
import type { ViewMode } from '@/components/ViewSwitch';
import { FamilyBanner } from '@/components/FamilyBanner';
/*
 * Les trois autres vues et le guide ne sont chargés qu'à l'ouverture.
 *
 * L'arbre est la vue principale et la seule visible au démarrage ; faire
 * télécharger la carte, la frise et la liste des manques avant de dessiner le
 * premier médaillon retarde ce que l'on est venu voir. Le découpage est celui
 * de l'usage : ce qui s'affiche tout de suite, et ce qui attend un clic.
 */
const MapView = lazy(() => import('@/components/MapView').then((m) => ({ default: m.MapView })));
const TimelineView = lazy(() =>
  import('@/components/TimelineView').then((m) => ({ default: m.TimelineView })),
);
const GapsView = lazy(() => import('@/components/GapsView').then((m) => ({ default: m.GapsView })));
import { hasSeenTour } from '@/components/tour-state';
const Tour = lazy(() => import('@/components/Tour').then((m) => ({ default: m.Tour })));
import { DEFAULT_SCOPE, peopleInScope, type Scope } from '@/domain/scope';
import { findGaps } from '@/domain/gaps';
import { GenerationRail } from '@/components/GenerationRail';

import '@/styles/base.css';
import '@/styles/papier.css';
import '@/styles/app.css';
import '@/styles/avatar.css';
import '@/styles/node.css';
import '@/styles/botanique.css';
import '@/styles/chrome.css';
import '@/styles/detail.css';
import '@/styles/loading-screen.css';
import '@/styles/path-flow.css';
import '@/styles/views.css';
import '@/styles/theme-transition.css';

/** Largeur réservée au panneau de détails lors d'un recentrage, sur grand écran. */
const PANEL_OFFSET = 400;

export default function App() {
  const datasetCtrl = useDataset();
  /**
   * La personne dont on regarde la famille.
   *
   * L'arbre n'affiche qu'une fiche à la fois — grands-parents, parents,
   * fratrie et enfants — et cliquer sur n'importe qui ouvre la sienne. C'est
   * ce qui rend le dessin toujours lisible : jamais deux familles ne se
   * disputent la même rangée.
   */
  const [focusId, setFocusId] = useState<string | null>(null);
  /*
   * La personne dont on regarde la famille « à part ».
   *
   * Un point sous une carte signale une union que l'ascendance ne montre pas
   * — un conjoint absent, souvent des enfants derrière. Cliquer cette
   * personne ouvre SA famille seule : ses parents, sa fratrie, son conjoint,
   * ses enfants. Une croix referme et rend l'arbre exactement tel qu'il
   * était, `focusId` n'ayant pas bougé.
   */
  const [familyOf, setFamilyOf] = useState<string | null>(null);
  const { graph, layout, spatial, searchIndex, anomalies } = useFamilyTree(
    datasetCtrl.dataset,
    familyOf ?? focusId ?? undefined,
    familyOf !== null,
  );
  const [theme, toggleTheme] = useTheme();

  /**
   * Bascule de thème, en iris.
   *
   * `startViewTransition` fige l'écran, laisse `toggleTheme` changer l'état,
   * puis anime la différence — c'est cette capture qui permet à
   * `theme-transition.css` de balayer un thème par l'autre depuis le point du
   * geste plutôt que d'un bord de l'écran. L'API n'existe pas partout, et un
   * mouvement réduit demandé doit rester sans effet visuel : dans les deux
   * cas, on se contente de la bascule instantanée déjà en place.
   */
  const toggleThemeFromPoint = useCallback(
    (x: number, y: number) => {
      const doc = document as Document & {
        startViewTransition?: (callback: () => void) => {
          ready: Promise<void>;
          finished: Promise<void>;
          updateCallbackDone: Promise<void>;
        };
      };
      if (!doc.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        toggleTheme();
        return;
      }
      document.documentElement.style.setProperty('--reveal-x', `${x}px`);
      document.documentElement.style.setProperty('--reveal-y', `${y}px`);
      // `startViewTransition` fige l'écran au moment où le callback rend la
      // main : un `setState` React ordinaire ne peint qu'au prochain cycle,
      // trop tard pour la capture. `flushSync` force la mise à jour du DOM
      // avant que le callback ne se termine.
      const transition = doc.startViewTransition(() => {
        flushSync(() => {
          toggleTheme();
        });
      });
      // Le navigateur peut interrompre une transition (geste répété trop
      // vite, onglet masqué) : une promesse rejetée sans anse remonterait en
      // erreur non interceptée alors que la bascule, elle, a déjà eu lieu.
      transition.ready.catch(() => {});
      transition.finished.catch(() => {});
      transition.updateCallbackDone.catch(() => {});
    },
    [toggleTheme],
  );
  /*
   * La lumière glissante a été retirée avec le verre.
   *
   * `useGlassLight` tenait une boucle d'animation permanente pour déplacer le
   * reflet des surfaces au gré du pointeur, et son propre commentaire la
   * décrivait comme « l'opération la plus chère de toute l'interface » :
   * chaque écriture invalidait le style de toutes les surfaces de verre à la
   * fois. Un papier n'a pas de reflet qui se déplace — sa lumière est celle
   * du graveur, fixée une fois pour toutes en haut à gauche. La boucle
   * n'avait donc plus rien à éclairer.
   */
  const compact = useIsCompact();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [highlightMode, setHighlightMode] = useState<HighlightMode>('close');
  const [flaggedId, setFlaggedId] = useState<string | null>(null);
  const [hintVisible, setHintVisible] = useState(true);

  /**
   * La vue courante et son périmètre.
   *
   * L'arbre reste la vue principale : c'est lui qui décide de QUI l'on parle.
   * Les trois autres n'en changent pas, elles le regardent autrement, et se
   * réfèrent au même périmètre — d'où le `Scope` partagé plutôt qu'un filtre
   * par vue, qui laisserait chacune avec sa propre idée de la famille.
   */
  /*
   * Le guide s'ouvre tout seul à la première visite, et jamais ensuite. On
   * attend que l'arbre soit cadré : s'expliquer par-dessus un écran encore
   * vide ne veut rien dire.
   */
  const [tourOpen, setTourOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('tree');
  const [scope, setScope] = useState<Scope>(DEFAULT_SCOPE);


  /**
   * Le point de repère.
   *
   * Dans un arbre de cinq cents personnes, « Eugénie Beaumont, 1843 – 1921 »
   * ne dit rien : ce qu'on veut savoir, c'est qui elle est *pour soi*. En
   * désignant une personne comme repère — soi-même, en général — chaque fiche
   * et chaque résultat de recherche se met à répondre à cette question.
   *
   * Le choix est mémorisé : on ne redésigne pas son propre repère à chaque
   * visite.
   */
  const [anchorId, setAnchorId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem('arbre-repere');
  });

  useEffect(() => {
    if (anchorId && graph.people.has(anchorId)) {
      window.localStorage.setItem('arbre-repere', anchorId);
    } else {
      window.localStorage.removeItem('arbre-repere');
      if (anchorId) setAnchorId(null);
    }
  }, [anchorId, graph]);

  const hoverStore = useMemo(() => new HoverStore(), []);
  // Une seule instance pour toute la session — pas une par changement de
  // bornes. Un import ou une retouche recalcule `layout.bounds` à chaque
  // fois ; recréer le contrôleur à chaque fois jetterait le cadrage en
  // cours, comme si retoucher une seule fiche remettait la vue à zéro.
  const viewport = useMemo(() => new ViewportController({ bounds: layout.bounds }), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    viewport.setBounds(layout.bounds);
  }, [viewport, layout.bounds]);

  useEffect(() => () => viewport.destroy(), [viewport]);

  const panelOffset = compact ? 0 : PANEL_OFFSET;

  /*
   * Le placement, par référence.
   *
   * `focusOn` en a besoin, mais le lister en dépendance lui donnait une
   * identité neuve à chaque recalcul — et avec lui à `selectPerson`, passé en
   * `onSelect` à chaque médaillon. Le `memo` des cartes tombait alors à chaque
   * dépliage : quarante médaillons redessinés pour en ajouter quatre.
   */
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const focusOn = useCallback(
    (id: string, options?: { scale?: number; duration?: number; withPanel?: boolean }) => {
      const position = layoutRef.current.positions.get(id);
      if (!position) return;
      viewport.focusPoint(
        position.x + CARD_WIDTH / 2,
        position.y + CARD_HEIGHT / 2,
        options?.scale ?? Math.max(viewport.transform.scale, 0.92),
        options?.withPanel === false ? 0 : panelOffset,
        options?.duration ?? 720,
      );
    },
    [viewport, panelOffset],
  );

  /*
   * Cliquer quelqu'un ouvre sa fiche — sans toucher à l'arbre.
   *
   * Recentrer l'arbre sur la personne cliquée effaçait tout le reste : ouvrir
   * une grand-mère ne laissait plus voir que SON ascendance à elle, et la
   * famille qu'on avait sous les yeux disparaissait. On ne re-enracine donc
   * que si la personne n'est pas déjà dessinée — cas d'un résultat de
   * recherche ou d'un manque à compléter, où il faut bien aller la chercher.
   */
  const reveal = useCallback(
    (id: string) => {
      const placed = layoutRef.current.positions;
      if (!placed.has(id)) {
        // Pas dessinée du tout : il faut bien repartir d'elle pour l'atteindre.
        setFocusId(id);
        return;
      }
      // Déjà dessinée : on l'amène au centre. Et si elle cache un proche que
      // cette vue ne montre pas, on ouvre sa famille à part.
      //
      // Le décompte vient du calcul de mise en page, qui est aussi ce que lit
      // la pastille « +2 » sur la carte (voir `hiddenKin` dans `layout.ts`).
      // Une seule définition pour les deux : une carte marquée mène donc
      // toujours quelque part, et une carte non marquée ne cache rien.
      focusOn(id);
      if (layoutRef.current.hiddenKin.has(id)) setFamilyOf(id);
    },
    [focusOn],
  );

  const selectPerson = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      setHintVisible(false);
      if (id) reveal(id);
      else setFlaggedId(null);
    },
    [reveal],
  );

  const pickFromSearch = useCallback(
    (id: string) => {
      setSelectedId(id);
      setFlaggedId(id);
      setHintVisible(false);
      reveal(id);
    },
    [reveal],
  );

  /*
   * Changer de personne racine amène la vue sur elle.
   *
   * Seulement `focusId` en dépendance. Y ajouter le placement, comme on l'a
   * d'abord fait, rejouait l'animation de caméra à CHAQUE recalcul — donc à
   * chaque dépliage : on cliquait pour voir apparaître quatre cartes, et toute
   * la vue se remettait en mouvement. Le placement est lu par référence, il
   * est déjà à jour quand cet effet s'exécute.
   */
  useEffect(() => {
    if (!focusId) return;
    focusOn(focusId, { scale: 1.05, duration: 620 });
  }, [focusId, focusOn]);

  /*
   * Recadrer quand on entre dans la vue « famille », et quand on en sort.
   *
   * Cette vue ne déplace pas la caméra : elle REFAIT le placement. Les
   * coordonnées d'avant ne désignent plus rien — la même personne se retrouve
   * à quelques centaines de pixels de là, et tout le reste de l'arbre a
   * disparu du calcul. Sans recadrage, on cliquait donc quelqu'un, le bandeau
   * annonçait « Famille de X — 23 personnes », et l'écran restait vide : la
   * caméra visait fidèlement un endroit du monde précédent.
   *
   * À l'ouverture on montre la famille entière — c'est ce qu'on est venu voir,
   * et elle tient à l'écran. À la fermeture on revient sur la personne dont on
   * regardait la famille, à sa nouvelle place dans le placement restauré, pour
   * ne pas être rendu au hasard.
   *
   * Le placement est lu par référence : il est déjà recalculé quand cet effet
   * s'exécute, comme pour l'effet de `focusId` ci-dessus.
   */
  const previousFamilyOf = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousFamilyOf.current;
    previousFamilyOf.current = familyOf;
    if (familyOf) {
      // La fiche est ouverte — c'est elle qu'on vient de cliquer. Le cadrage
      // se calcule donc sur la largeur qu'elle laisse, sinon la famille est
      // mise à l'échelle de tout l'écran puis poussée à moitié dessous.
      const bounds = layoutRef.current.bounds;
      const free = { width: Math.max(1, viewport.size.width - panelOffset), height: viewport.size.height };
      const { scale } = transformForBounds(bounds, free, FIT_PADDING, 0.95);
      viewport.focusPoint(
        (bounds.minX + bounds.maxX) / 2,
        (bounds.minY + bounds.maxY) / 2,
        scale,
        panelOffset,
        620,
      );
    } else if (previous) {
      focusOn(previous, { duration: 620 });
    }
  }, [familyOf, viewport, focusOn, panelOffset]);

  // Échap referme la vue famille : c'est le geste attendu de tout ce qui se
  // superpose, et il évite d'avoir à viser la croix.
  useEffect(() => {
    if (!familyOf) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setFamilyOf(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [familyOf]);

  const fitAll = useCallback(() => {
    setFlaggedId(null);
    viewport.fit(layout.bounds, FIT_PADDING, 0.9, 820);
  }, [viewport, layout.bounds]);

  // Ouverture : l'arbre entier apparaît d'abord, puis la vue plonge vers la
  // personne principale. En une seconde, on comprend l'échelle et où l'on est.
  const introRef = useRef(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (introRef.current) return;
    // Tant que la version partagée n'a pas répondu, l'arbre affiché n'est
    // qu'un brouillon local — inutile de cadrer dessus pour devoir recadrer
    // une seconde fois dès que la vraie version arrive.
    if (datasetCtrl.loading) return;

    /*
     * `viewport.size` peut valoir zéro un court instant — un onglet ouvert en
     * arrière-plan, par exemple, que certains navigateurs mettent en pause
     * avant même son premier calcul de mise en page. Sans nouvelle tentative,
     * ce `return` était définitif : rien ne redéclenchait cet effet une fois
     * la taille redevenue valide (`viewport` ne change jamais d'identité, et
     * `layout` non plus une fois les données arrivées), et le rideau restait
     * affiché indéfiniment. On réessaie donc à chaque image.
     *
     * La limite se compte en TEMPS, pas en images, et c'est tout le sujet.
     * Elle valait cent cinquante essais, sur l'idée qu'une image dure seize
     * millisecondes : deux secondes et demie. Mais un onglet en arrière-plan
     * — précisément le cas que ce garde-fou vise — voit son `rAF` ramené à
     * une image par seconde, voire moins. Cent cinquante essais y prenaient
     * plusieurs MINUTES, pendant lesquelles le rideau restait affiché sur des
     * noms de famille qui défilaient dans le vide. Mesuré ici même : l'arbre
     * n'apparaissait plus du tout tant que la fenêtre n'était pas au premier
     * plan.
     */
    let frame = 0;
    let rideau = 0;
    let focusTimer = 0;

    const start = (stageSize: { width: number; height: number }): void => {
      introRef.current = true;
      // Le cas normal : le rideau se retire au moment où l'arbre est cadré,
      // sans attendre le minuteur posé plus bas.
      setReady(true);

      // L'arbre entier d'abord : on doit voir de quoi il s'agit — un arbre, sa
      // silhouette, son ampleur — avant de descendre dans une branche.
      viewport.set(transformForBounds(layout.bounds, stageSize, FIT_PADDING, 0.92));

      // Puis la vue s'approche doucement du pied, d'où l'on plonge à la
      // molette ou en glissant. Ce mouvement d'ouverture dit en une seconde
      // ce que l'espace contient et comment il se parcourt.
      const root = layout.positions.get(graph.rootId);
      focusTimer = window.setTimeout(() => {
        if (root) viewport.focusPoint(root.x + CARD_WIDTH / 2, root.y + CARD_HEIGHT / 2, 0.9, 0, 1800);
      }, 1500);
    };

    /*
     * Le cadrage attend une taille utilisable, AUSSI LONGTEMPS QU'IL LE FAUT.
     *
     * Cadrer sur une scène de zéro pixel ne produit pas un cadrage approximatif
     * mais un cadrage absurde — mesuré ici : une échelle de 0,02, un arbre
     * réduit à un point, un écran vide. Une scène finit toujours par obtenir sa
     * taille dès qu'on la regarde ; il n'y a donc aucune raison de renoncer.
     */
    const tryStart = (): void => {
      if (introRef.current) return;
      const stageSize = viewport.size;
      if (stageSize.width <= 1) {
        frame = requestAnimationFrame(tryStart);
        return;
      }
      start(stageSize);
    };
    tryStart();

    /*
     * Le rideau, lui, se retire sur un MINUTEUR, et c'est la seule chose qui
     * ne doit dépendre de rien.
     *
     * Il se retirait à la fin du cadrage, ce qui liait deux choses sans
     * rapport : un onglet ouvert en arrière-plan ne reçoit aucune image, donc
     * jamais de taille, donc jamais de cadrage — et le rideau y restait
     * affiché indéfiniment, sur des noms de famille défilant dans le vide.
     * Mesuré ici même, fenêtre au second plan : l'arbre n'apparaissait plus du
     * tout. Un minuteur échoit dans un onglet caché ; une image, non.
     */
    rideau = window.setTimeout(() => setReady(true), 2400);

    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(rideau);
      window.clearTimeout(focusTimer);
    };
  }, [viewport, layout, datasetCtrl.loading]);

  /*
   * Un import ou un retour à la démonstration change l'arbre de forme au
   * point que l'ancien cadrage n'a plus de sens — contrairement à une simple
   * retouche de fiche, qui ne doit surtout pas faire sauter la caméra.
   * `replaceVersion` ne bouge que pour ce cas-là ; sa première valeur
   * correspond au chargement initial, déjà traité par l'ouverture ci-dessus.
   */
  const replaceVersionRef = useRef(datasetCtrl.replaceVersion);
  useEffect(() => {
    if (datasetCtrl.replaceVersion === replaceVersionRef.current) return;
    replaceVersionRef.current = datasetCtrl.replaceVersion;
    setSelectedId(null);
    setFlaggedId(null);
    setHighlightMode('close');
    viewport.fit(layout.bounds, FIT_PADDING, 0.92, 720);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetCtrl.replaceVersion]);

  // La pastille de recherche s'estompe d'elle-même.
  useEffect(() => {
    if (!flaggedId) return undefined;
    const timer = window.setTimeout(() => setFlaggedId(null), 6000);
    return () => window.clearTimeout(timer);
  }, [flaggedId]);

  const highlight = useMemo(
    () => computeHighlight(graph, selectedId, highlightMode),
    [graph, selectedId, highlightMode],
  );

  /*
   * Le chemin de parenté entre le repère et la personne ouverte.
   *
   * Il ne se calcule que lorsque les deux existent et diffèrent — c'est-à-dire
   * quand la question « comment suis-je lié à cette personne ? » a un sens.
   */
  const relation = useMemo(
    () =>
      anchorId && selectedId && anchorId !== selectedId
        ? relationPath(graph, anchorId, selectedId)
        : undefined,
    [graph, anchorId, selectedId],
  );

  /*
   * Retouches.
   *
   * Chacune passe par `datasetCtrl.mutate`, qui persiste dans le navigateur
   * et laisse `useFamilyTree` reconstruire graphe, placement et index à
   * partir de la nouvelle liste — la même mécanique qu'un import, à
   * l'échelle d'une seule personne.
   */
  const updatePerson = useCallback(
    (record: PersonRecord) => {
      datasetCtrl.mutate((people) => upsertPerson(people, record));
    },
    [datasetCtrl],
  );

  const removePerson = useCallback(
    (id: string) => {
      datasetCtrl.mutate((people) => deletePerson(people, id));
      setSelectedId((current) => (current === id ? null : current));
      setFlaggedId((current) => (current === id ? null : current));
    },
    [datasetCtrl],
  );

  /*
   * L'union qu'on vient de créer.
   *
   * Son identifiant se prédit sans attendre la reconstruction du graphe (voir
   * `unionKey`) : on le connaît dès qu'on sait qui la compose, au moment même
   * de l'ajout. `LinkLayer` s'en sert pour dessiner ce trait au lieu de le
   * faire apparaître d'un coup — voir l'écran de chargement pour la même
   * idée, appliquée cette fois à une seule branche plutôt qu'à l'arbre entier.
   */
  const [growingUnionId, setGrowingUnionId] = useState<string | null>(null);
  const growingTimerRef = useRef(0);
  const growUnion = useCallback((id: string) => {
    window.clearTimeout(growingTimerRef.current);
    setGrowingUnionId(id);
    growingTimerRef.current = window.setTimeout(() => setGrowingUnionId(null), 900);
  }, []);
  useEffect(() => () => window.clearTimeout(growingTimerRef.current), []);

  const addPersonParent = useCallback(
    (childId: string, input: NewPersonInput) => {
      const existingIds = new Set(graph.people.keys());
      const parent = createPerson(input, existingIds);
      const nextParents = [...(graph.people.get(childId)?.parents ?? []), parent.id].slice(0, 2);
      datasetCtrl.mutate((people) => addParent(people, childId, parent));
      growUnion(nextParents.length > 1 ? unionKey(nextParents[0], nextParents[1]) : unionKey(nextParents[0]));
    },
    [datasetCtrl, graph, growUnion],
  );

  const addPersonSpouse = useCallback(
    (personId: string, input: NewPersonInput, union?: { status: UnionStatus; since?: string; place?: string }) => {
      const existingIds = new Set(graph.people.keys());
      const spouse = createPerson(input, existingIds);
      datasetCtrl.mutate((people) => addSpouse(people, personId, spouse, union));
      growUnion(unionKey(personId, spouse.id));
    },
    [datasetCtrl, graph, growUnion],
  );

  const addPersonChild = useCallback(
    (parentId: string, input: NewPersonInput, otherParentId: string | null) => {
      const existingIds = new Set(graph.people.keys());
      const child = createPerson(input, existingIds);
      const parentIds = otherParentId ? [parentId, otherParentId] : [parentId];
      datasetCtrl.mutate((people) => addChild(people, parentIds, child));
      growUnion(otherParentId ? unionKey(parentId, otherParentId) : unionKey(parentId));
    },
    [datasetCtrl, graph, growUnion],
  );

  const linkPersonParent = useCallback(
    (childId: string, parentId: string) => {
      const nextParents = [...(graph.people.get(childId)?.parents ?? []), parentId].slice(0, 2);
      datasetCtrl.mutate((people) => linkParent(people, childId, parentId));
      growUnion(nextParents.length > 1 ? unionKey(nextParents[0], nextParents[1]) : unionKey(nextParents[0]));
    },
    [datasetCtrl, graph, growUnion],
  );

  const linkPersonSpouse = useCallback(
    (personId: string, spouseId: string, union?: { status: UnionStatus; since?: string; place?: string }) => {
      datasetCtrl.mutate((people) => linkSpouse(people, personId, spouseId, union));
      growUnion(unionKey(personId, spouseId));
    },
    [datasetCtrl, growUnion],
  );

  const linkPersonChild = useCallback(
    (parentId: string, childId: string, otherParentId: string | null) => {
      const parentIds = otherParentId ? [parentId, otherParentId] : [parentId];
      datasetCtrl.mutate((people) => linkChild(people, parentIds, childId));
      growUnion(otherParentId ? unionKey(parentId, otherParentId) : unionKey(parentId));
    },
    [datasetCtrl, growUnion],
  );

  /*
   * Défaire un lien.
   *
   * Aucune fiche n'est supprimée : seule la relation disparaît. Corriger une
   * filiation fausse ou un remariage mal noté imposait jusqu'ici de supprimer
   * la personne et de tout ressaisir.
   */
  const detachPersonParent = useCallback(
    (childId: string, parentId: string) => {
      datasetCtrl.mutate((people) => detachParent(people, childId, parentId));
    },
    [datasetCtrl],
  );

  const detachPersonSpouse = useCallback(
    (personId: string, spouseId: string) => {
      datasetCtrl.mutate((people) => detachSpouse(people, personId, spouseId));
    },
    [datasetCtrl],
  );

  const updatePersonUnion = useCallback(
    (personId: string, spouseId: string, union: { status: UnionStatus; since?: string; place?: string }) => {
      datasetCtrl.mutate((people) => updateUnion(people, personId, spouseId, union));
    },
    [datasetCtrl],
  );

  const detachPersonChild = useCallback(
    (parentId: string, childId: string) => {
      datasetCtrl.mutate((people) => detachChild(people, parentId, childId));
    },
    [datasetCtrl],
  );

  // Diagnostic : en développement, le graphe et le placement sont exposés pour
  // pouvoir vérifier depuis l'extérieur que chaque personne affichée est
  // réellement reliée à sa parenté.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).__arbre = { graph, layout, viewport };
  }, [graph, layout, viewport]);

  /*
   * Les noms qui défilent sur le rideau d'ouverture.
   *
   * De vrais ancêtres, pris du plus ancien au plus récent : l'écran d'attente
   * montre déjà ce qu'on est venu voir. `graph.order` est trié par génération,
   * on en prélève donc quelques-uns régulièrement espacés plutôt que les
   * premiers, qui seraient tous de la même rangée.
   */
  const openingNames = useMemo(() => {
    const ids = graph.order;
    if (ids.length === 0) return [];
    const wanted = Math.min(6, ids.length);
    const step = Math.max(1, Math.floor(ids.length / wanted));
    const picked: string[] = [];
    for (let i = 0; i < ids.length && picked.length < wanted; i += step) {
      const person = graph.people.get(ids[i]);
      if (person) picked.push(person.displayName);
    }
    return picked;
  }, [graph]);

  useEffect(() => {
    if (!ready || hasSeenTour()) return undefined;
    const timer = window.setTimeout(() => setTourOpen(true), 900);
    return () => window.clearTimeout(timer);
  }, [ready]);

  const currentFocus = focusId && graph.people.has(focusId) ? focusId : graph.rootId;

  /*
   * Qui les trois autres vues regardent.
   *
   * Par défaut, exactement les personnes que l'arbre dessine à l'instant :
   * ouvrir la famille du père puis passer à la Carte ne montre donc que ses
   * lieux à lui. C'est la règle que demande l'application — une vue ne parle
   * jamais d'un périmètre plus large que celui qu'on a sous les yeux, sauf à
   * le demander explicitement.
   */
  const scopePeople = useMemo(
    () => peopleInScope(graph, currentFocus, scope, layout.positions.keys()),
    [graph, currentFocus, scope, layout],
  );

  // Le décompte de la pastille suit le périmètre courant, comme la liste.
  const gapCount = useMemo(() => findGaps(graph, scopePeople).length, [graph, scopePeople]);

  /*
   * Qui regarde l'arbre — Cloudflare Access le sait déjà, il n'y a qu'à le
   * lui demander (voir `useVisitor`). Vaut `null` en développement local,
   * où Access n'est pas devant : l'accueil ne s'affiche simplement pas.
   */
  const { visitor, identify: identifyVisitor } = useVisitor();

  /** Ouvre une personne dans l'arbre : on y revient, puis on la sélectionne. */
  const showInTree = useCallback(
    (id: string) => {
      setViewMode('tree');
      setSelectedId(id);
      setHintVisible(false);
      reveal(id);
    },
    [reveal],
  );

  const selectedPerson = selectedId ? (graph.people.get(selectedId) ?? null) : null;

  /*
   * Le verre gardait autrefois une marque `data-moving` pendant les gestes,
   * qui suspendait son flou et sa réfraction le temps du déplacement (voir
   * `liquid-glass.css`). La bascule se voyait à chaque zoom et à chaque
   * glissé : la netteté constante vaut mieux ici que les images gagnées, et
   * plus rien ne lit cette marque.
   */
  return (
    <div className="app" data-panel-open={selectedPerson ? true : undefined}>
      <LoadingScreen
        ready={ready}
        title={graph.title}
        names={openingNames}
        people={graph.people.size}
        generations={graph.generations.length}
      />
      <Backdrop viewport={viewport} />

      <TopBar
        graph={graph}
        searchIndex={searchIndex}
        onPick={pickFromSearch}
        anchorId={anchorId}
        onFit={fitAll}
        onZoomIn={() => viewport.zoomBy(1.35)}
        onZoomOut={() => viewport.zoomBy(1 / 1.35)}
        highlightMode={highlightMode}
        onToggleHighlightMode={() =>
          setHighlightMode((mode) => (mode === 'close' ? 'lineage' : 'close'))
        }
        theme={theme}
        onToggleTheme={toggleThemeFromPoint}
        onOpenTour={() => setTourOpen(true)}
        viewMode={viewMode}
        onChangeView={setViewMode}
        gapCount={gapCount}
      />

      {familyOf && graph.people.has(familyOf) && viewMode === 'tree' && (
        <FamilyBanner
          person={graph.people.get(familyOf)!}
          count={layout.positions.size}
          onClose={() => setFamilyOf(null)}
        />
      )}

      <Suspense fallback={null}>
        {tourOpen && <Tour open onClose={() => setTourOpen(false)} />}
      </Suspense>

      <Suspense fallback={null}>
        {viewMode === 'map' && (
          <MapView
            graph={graph}
            focusId={currentFocus}
            scope={scope}
            onScopeChange={setScope}
            people={scopePeople}
            onSelectPerson={showInTree}
          />
        )}
        {viewMode === 'timeline' && (
          <TimelineView
            graph={graph}
            focusId={currentFocus}
            scope={scope}
            onScopeChange={setScope}
            people={scopePeople}
            selectedId={selectedId}
            onSelectPerson={showInTree}
          />
        )}
        {viewMode === 'gaps' && (
          <GapsView
            graph={graph}
            focusId={currentFocus}
            scope={scope}
            onScopeChange={setScope}
            people={scopePeople}
            onShowInTree={showInTree}
            onEdit={showInTree}
          />
        )}
      </Suspense>

      <TreeCanvas
        graph={graph}
        layout={layout}
        spatial={spatial}
        viewport={viewport}
        hoverStore={hoverStore}
        highlight={highlight}
        selectedId={selectedId}
        flaggedId={flaggedId}
        onSelect={selectPerson}
        theme={theme}
        pathPeople={relation?.people}
        pathUnions={relation?.unions}
        relation={relation}
        growingUnionId={growingUnionId}
      />

      <GenerationRail rows={layout.rows} positions={layout.positions} viewport={viewport} />

      <DataNotice anomalies={anomalies} onSelect={selectPerson} />

      {/* Après le rideau seulement : un mot d'accueil par-dessus l'écran de
          chargement s'adresserait à quelqu'un qui ne voit pas encore l'arbre
          dont on lui parle. */}
      {ready && visitor && viewMode === 'tree' && (
        <WelcomeNote
          visitor={visitor}
          graph={graph}
          gapCount={gapCount}
          onIdentify={identifyVisitor}
          onOpenGaps={() => setViewMode('gaps')}
        />
      )}

      <DetailPanel
        relation={relation}
        graph={graph}
        person={selectedPerson}
        onSelect={selectPerson}
        onClose={() => setSelectedId(null)}
        onCenter={() => {
          if (!selectedId) return;
          setFamilyOf(null);
          setFocusId(selectedId);
        }}
        onShowLineage={() =>
          setHighlightMode((mode) => (mode === 'close' ? 'lineage' : 'close'))
        }
        lineageActive={highlightMode === 'lineage'}
        anchorId={anchorId}
        onToggleAnchor={() =>
          setAnchorId((current) => (current === selectedId ? null : selectedId))
        }
        onUpdatePerson={updatePerson}
        onDeletePerson={removePerson}
        onAddParent={(input) => selectedId && addPersonParent(selectedId, input)}
        onAddSpouse={(input, union) => selectedId && addPersonSpouse(selectedId, input, union)}
        onAddChild={(input, otherParentId) => selectedId && addPersonChild(selectedId, input, otherParentId)}
        onLinkParent={(parentId) => selectedId && linkPersonParent(selectedId, parentId)}
        onLinkSpouse={(spouseId, union) => selectedId && linkPersonSpouse(selectedId, spouseId, union)}
        onLinkChild={(childId, otherParentId) => selectedId && linkPersonChild(selectedId, childId, otherParentId)}
        onDetachParent={(parentId) => selectedId && detachPersonParent(selectedId, parentId)}
        onDetachSpouse={(spouseId) => selectedId && detachPersonSpouse(selectedId, spouseId)}
        onUpdateUnion={(spouseId, union) => selectedId && updatePersonUnion(selectedId, spouseId, union)}
        onDetachChild={(childId) => selectedId && detachPersonChild(selectedId, childId)}
      />

      {/*
        Décrit le geste de l'ARBRE — molette et glisser sur le canevas des
        personnes. Restait affiché sur les trois autres vues aussi, où ni
        l'un ni l'autre n'a de sens (rien à zoomer sur « À compléter », et la
        Carte a désormais son propre geste, quoique de même nature).
      */}
      {viewMode === 'tree' && (
        <div className="hint-bar lg lg--clear lg--pill" data-hidden={hintVisible ? undefined : true}>
          <span>
            <kbd>Molette</kbd> zoom
          </span>
          <span className="hint-sep" aria-hidden="true" />
          <span>
            <kbd>Glisser</kbd> déplacer
          </span>
        </div>
      )}

    </div>
  );
}
