import { useEffect, useMemo, useRef, type RefObject } from 'react';
import type { TreeLayout } from '@/domain/layout';
import type { Rect, SpatialIndex } from '@/view/spatial';
import { planterLaSeve, type AncreDePersonne, type PlanDeSeve } from '@/view/links';
import { cardCenterX, cardTop } from '@/view/metrics';
import type { EtatBotanique } from '@/domain/gaps';
import type { ViewportController } from '@/view/viewport';
import { visibleRect } from '@/view/viewport';
import { drawLinks, type LinkPalette } from '@/view/links';

export interface LinkLayerProps {
  stageRef: RefObject<HTMLDivElement | null>;
  viewport: ViewportController;
  layout: TreeLayout;
  spatial: SpatialIndex;
  /** Unions accentuées par la sélection courante. */
  highlightUnions: Set<string>;
  hasSelection: boolean;
  /** Unions du chemin de parenté affiché, tracées en accent. */
  pathUnions?: Set<string>;
  /** Change quand le thème change : la palette est relue. */
  theme: string;
  /** Union tout juste créée (nouveau proche ajouté) : son trait se dessine
   *  au lieu d'apparaître d'un coup — voir `GROWTH_MS` plus bas. */
  growingUnionId?: string | null;
  /** L'état botanique de chaque fiche, pour feuiller les branches. */
  etats: Map<string, EtatBotanique>;
  /**
   * Les fiches dont le bourgeon vient de devenir feuille.
   *
   * `cle` change à chaque nouvelle éclosion : c'est elle qui relance
   * l'animation, deux éclosions successives pouvant porter sur les mêmes
   * personnes.
   */
  eclosion?: { ids: Set<string>; cle: number } | null;
  /** Les personnes sans rameau, qui portent leur marque sur une amorce. */
  souches: Array<{ id: string; x: number; y: number; accentuee: boolean }>;
  /**
   * D'où part la sève : le point de la personne choisie.
   *
   * `null` quand rien n'est sélectionné — l'arbre est alors tout entier à sa
   * teinte normale, et il n'y a pas de front à faire courir.
   */
  source: { x: number; y: number } | null;
  /**
   * L'OUVERTURE : l'arbre entier s'encre depuis sa souche.
   *
   * Le même moteur que la montée de sève, à trois différences près — le plan
   * couvre TOUTES les unions au lieu des seules accentuées, il part de la
   * souche au lieu de la personne choisie, et il dure quelques secondes au
   * lieu d'une. `cle` relance le tracé ; `null` quand l'ouverture est passée.
   */
  ouverture?: { source: { x: number; y: number }; duree: number; cle: number } | null;
  /**
   * Appelé une fois le plan de l'ouverture calculé, avec l'heure d'arrivée de
   * l'encre chez chaque personne, en millisecondes depuis le début.
   *
   * C'est ce qui permet aux médaillons de frapper le papier au passage du
   * front plutôt que d'apparaître tous ensemble : le calcul a lieu ici, où le
   * plan existe, et le résultat remonte à qui pose les cartes.
   */
  onOuverturePlan?: (arrivees: Map<string, number>) => void;
}

/** Durée de l'apparition d'un trait tout juste créé. */
const GROWTH_MS = 640;

/*
 * LA MONTÉE DE SÈVE.
 *
 * La durée ne peut pas être fixe : la même seconde ferait ramper le front sur
 * la parenté d'un enfant de trois cartes et le ferait filer sur une lignée de
 * onze générations. Elle ne peut pas être proportionnelle non plus — une
 * lignée dix fois plus longue n'a pas à durer dix fois plus longtemps, on
 * attendrait quinze secondes.
 *
 * Elle suit donc la RACINE de la portée : une branche quatre fois plus longue
 * prend deux fois plus de temps. C'est la même loi que celle qu'on applique
 * d'instinct à un geste — allonger le trajet allonge le geste, mais de moins
 * en moins.
 */
const SEVE_MIN_MS = 480;
const SEVE_MAX_MS = 1500;
const seveDuree = (portee: number): number =>
  Math.max(SEVE_MIN_MS, Math.min(SEVE_MAX_MS, 380 + Math.sqrt(Math.max(0, portee)) * 26));

/** Le reste de l'arbre s'estompe vite : c'est un fond, pas un sujet. */
const ESTOMPE_MS = 260;

/*
 * L'ÉCLOSION.
 *
 * Assez lente pour être vue, assez brève pour ne pas faire attendre : c'est
 * une récompense, pas une étape. Renseigner une date fait s'ouvrir la feuille
 * de la personne concernée, sous les yeux de qui vient de la renseigner — un
 * compteur qui passe de 145 à 144 ne remercie personne.
 */
const ECLOSION_MS = 900;

/**
 * L'avancée du front dans le temps.
 *
 * Un `smoothstep` : la sève démarre, coule, puis se pose. À vitesse
 * rigoureusement constante le front partirait et s'arrêterait d'un coup, ce
 * qui se remarque bien plus qu'on ne le croit — rien ne démarre à pleine
 * vitesse, pas même un liquide sous pression.
 */
const avance = (p: number): number => {
  const t = Math.max(0, Math.min(1, p));
  return t * t * (3 - 2 * t);
};

/** Exportée pour le tirage sur papier, qui doit encrer avec EXACTEMENT les
 *  mêmes valeurs que l'écran — une planche imprimée dans d'autres teintes
 *  que celles qu'on a réglées ne serait plus la même planche. */
export function readPalette(theme: string): LinkPalette {
  const styles = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string): string =>
    styles.getPropertyValue(name).trim() || fallback;
  /*
   * Les valeurs de secours sont celles de l'HERBIER, et c'est important.
   *
   * C'étaient encore celles de l'ancien thème « ciel » — `rgba(122, 138, 168)`
   * et consorts. Quatre des jetons lus n'existant pas dans la palette, tout
   * l'arbre s'est peint en gris-bleu de nuit sur du papier ivoire pendant
   * toute la refonte, sans que rien ne signale l'erreur : un secours n'échoue
   * jamais bruyamment. Il doit donc être juste, faute de quoi il transforme
   * un jeton oublié en défaut silencieux.
   */
  return {
    line: read('--link', 'rgba(42, 34, 24, 0.88)'),
    strong: read('--link-highlight', 'rgba(24, 18, 10, 0.95)'),
    dim: read('--link-dim', 'rgba(42, 34, 24, 0.24)'),
    cross: read('--link-cross', 'rgba(158, 68, 32, 0.5)'),
    band: read('--row-band', 'rgba(46, 36, 24, 0.028)'),
    bandLabel: read('--row-label', 'rgba(46, 36, 24, 0.3)'),
    // Ciel : un fil de lumière, large et doux, comme les liaisons d'une
    // carte du ciel. Atlas : un trait encré, l'ombre à peine plus large que
    // le trait lui-même, comme l'encre qui bave un rien dans le papier.
    glow:
      theme === 'dark'
        ? { color: read('--star-glow', 'rgba(255,255,255,0.9)'), blur: 5 }
        : { color: read('--star-glow', 'rgba(154,91,35,0.5)'), blur: 1.1 },
  };
}

/**
 * Tant que le cadre visible reste dans cette marge, l'échelle affichée peut
 * s'écarter de celle du dernier dessin sans que le trait perde en netteté au
 * point qu'on le remarque.
 *
 * Large délibérément. Une molette qu'on tourne vite change l'échelle en
 * continu — la resserrer forçait un redessin presque à chaque cran, ce qui
 * annulait justement le bénéfice de ne plus redessiner à chaque image. Une
 * légère perte de netteté pendant un geste rapide ne se voit de toute façon
 * pas : l'œil ne résout pas un trait fin au milieu d'un mouvement qu'il ne
 * peut lui-même pas suivre.
 *
 * Ce raisonnement était juste PENDANT le geste, et faux après : le geste
 * s'arrête, et le canevas reste étiré jusqu'au prochain franchissement de
 * seuil. Mesuré : après un zoom de deux crans, un tampon de 2600 px
 * s'affichait sur 5200 — un raster au double de sa résolution, indéfiniment.
 * Les traits, épais et sombres, y survivaient ; les feuilles, tracées au
 * cheveu, devenaient des taches. Signalé tel quel : « les feuilles de
 * botanique sont floues ».
 *
 * Deux corrections, et la seconde est la vraie.
 *
 * D'ABORD, LA TOLÉRANCE EST ASYMÉTRIQUE. Zoomer EN AVANT étire le tampon et
 * le brouille ; zoomer en arrière ne fait que le sous-échantillonner, ce qui
 * ne coûte rien à l'œil. Il n'y avait aucune raison de traiter les deux sens
 * de la même façon.
 */
const SCALE_DRIFT_AVANT = 1.5;
const SCALE_DRIFT_ARRIERE = 2.2;

/**
 * Le délai après lequel on considère que le geste est fini.
 *
 * ENSUITE, ET SURTOUT : dès que la vue se pose, le canevas est redessiné à
 * l'échelle exacte, quelle que soit la dérive. C'est ce qui préserve les deux
 * choses à la fois — on ne redessine toujours pas pendant le mouvement, et on
 * n'est jamais laissé sur une image étirée une fois immobile.
 */
const REPOS_MS = 180;

/**
 * Les traits de filiation, sur un canevas unique.
 *
 * Rendu dans les coordonnées du monde, à l'intérieur même de `.world` : le
 * canevas hérite du `transform: translate3d() scale()` du conteneur comme
 * n'importe quelle carte, et suivre un déplacement ne coûte donc rien de
 * plus qu'à elles — aucune image à refaire, seulement une recomposition que
 * le compositeur du navigateur gère déjà pour les cartes.
 *
 * Redessiner refait tout le tracé — bandes, traits, jalons — quel que soit
 * le nombre d'unions concernées : coûteux si c'est fait à chaque image d'un
 * geste qui dure, comme un défilement à la molette. On ne le refait donc
 * que quand le cadre visible sort de la zone déjà couverte (dessinée avec
 * une marge généreuse) ou que l'échelle a trop dérivé pour rester nette —
 * jamais à chaque image d'un mouvement continu.
 */
export function LinkLayer({
  stageRef,
  viewport,
  layout,
  spatial,
  highlightUnions,
  hasSelection,
  pathUnions,
  theme,
  growingUnionId,
  etats,
  source,
  eclosion,
  souches,
  ouverture,
  onOuverturePlan,
}: LinkLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef(0);
  const paletteRef = useRef<LinkPalette | null>(null);
  const forceRef = useRef<(() => void) | null>(null);
  const growthRef = useRef<{ unionId: string; start: number } | null>(null);
  const seveRef = useRef<{ plan: PlanDeSeve; start: number; duree: number } | null>(null);
  const eclosionRef = useRef<{ ids: Set<string>; start: number } | null>(null);

  /*
   * Les ancres de l'ouverture, dérivées de la mise en page.
   *
   * Le haut de chaque carte : c'est là que le rameau vient la rejoindre, donc
   * l'endroit exact où l'encre l'atteint. Recalculées avec `layout` et jamais
   * autrement — elles ne dépendent de rien d'autre, et les tenir dans une
   * `ref` évite de les faire entrer dans les dépendances de l'effet de sève,
   * où un nouveau tableau à chaque rendu relancerait Dijkstra sans cesse.
   */
  const ouvertureAncresRef = useRef<AncreDePersonne[]>([]);
  useMemo(() => {
    const ancres: AncreDePersonne[] = [];
    for (const [id, position] of layout.positions) {
      ancres.push({ id, x: cardCenterX(position.x), y: cardTop(position.y) });
    }
    ouvertureAncresRef.current = ancres;
  }, [layout]);

  const stateRef = useRef({ highlightUnions, hasSelection, pathUnions, etats, souches });
  stateRef.current = { highlightUnions, hasSelection, pathUnions, etats, souches };

  useEffect(() => {
    paletteRef.current = readPalette(theme);
  }, [theme]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return undefined;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) return undefined;

    let stageSize = { width: 1, height: 1 };
    let dpr = 1;
    // La zone du monde déjà couverte par le tampon du canevas, et la densité
    // (pixels de canevas par unité du monde) à laquelle elle a été dessinée.
    let committed: { rect: Rect; density: number } | null = null;

    const redraw = (): void => {
      const transform = viewport.transform;
      /*
       * Marge de pré-rendu : assez pour qu'un glissement ordinaire ne
       * redessine pas à chaque image, pas au point de multiplier le coût de
       * chaque redessin par neuf. La zone couverte croît au carré de cette
       * marge (deux dimensions) — mesuré, une marge d'une pleine fenêtre
       * revenait à dessiner neuf fois plus d'unions qu'affiché, ce qui
       * finissait par coûter plus cher que le gain de fréquence ne rapportait
       * pendant un zoom soutenu.
       */
      const overscan = Math.max(stageSize.width, stageSize.height) * 0.5;
      const rect = visibleRect(transform, stageSize, overscan);

      committed = { rect, density: transform.scale };

      const worldWidth = Math.max(1, rect.right - rect.left);
      const worldHeight = Math.max(1, rect.bottom - rect.top);
      canvas.style.left = `${rect.left}px`;
      canvas.style.top = `${rect.top}px`;
      canvas.style.width = `${worldWidth}px`;
      canvas.style.height = `${worldHeight}px`;
      canvas.width = Math.round(worldWidth * transform.scale * dpr);
      canvas.height = Math.round(worldHeight * transform.scale * dpr);

      drawLinks(context, {
        unions: spatial.visibleUnions(rect),
        rows: layout.rows,
        worldRect: rect,
        density: transform.scale,
        dpr,
        palette: paletteRef.current ?? readPalette(theme),
        highlighted: stateRef.current.highlightUnions,
        hasSelection: stateRef.current.hasSelection,
        pathUnions: stateRef.current.pathUnions,
        etats: stateRef.current.etats,
        souches: stateRef.current.souches,
        eclosion: eclosionRef.current
          ? {
              ids: eclosionRef.current.ids,
              progres: (performance.now() - eclosionRef.current.start) / ECLOSION_MS,
            }
          : undefined,
        seve: seveRef.current
          ? {
              plan: seveRef.current.plan,
              front:
                seveRef.current.plan.portee *
                avance((performance.now() - seveRef.current.start) / seveRef.current.duree),
              estompe: Math.min(1, (performance.now() - seveRef.current.start) / ESTOMPE_MS),
            }
          : undefined,
        growth: growthRef.current
          ? {
              unionId: growthRef.current.unionId,
              progress: Math.min(1, (performance.now() - growthRef.current.start) / GROWTH_MS),
            }
          : undefined,
      });
    };

    const maybeRedraw = (force = false): void => {
      frameRef.current = 0;
      if (force || !committed) {
        redraw();
        return;
      }
      const transform = viewport.transform;
      // Petite marge de sécurité, pour redessiner un peu avant d'être
      // réellement à court plutôt qu'exactement à la limite.
      const safety = 24;
      const visible = visibleRect(transform, stageSize, safety);
      const scaleDrift = transform.scale / committed.density;
      const outOfBounds =
        visible.left < committed.rect.left ||
        visible.right > committed.rect.right ||
        visible.top < committed.rect.top ||
        visible.bottom > committed.rect.bottom;
      const scaleStale =
        scaleDrift > SCALE_DRIFT_AVANT || scaleDrift < 1 / SCALE_DRIFT_ARRIERE;
      if (outOfBounds || scaleStale) redraw();
    };

    const schedule = (force = false): void => {
      if (force) {
        // Une sélection ou un changement de thème doit repeindre au prochain
        // image, sans attendre une dérive qui n'arrivera peut-être jamais.
        if (frameRef.current) cancelAnimationFrame(frameRef.current);
        frameRef.current = requestAnimationFrame(() => maybeRedraw(true));
        return;
      }
      if (frameRef.current) return;
      frameRef.current = requestAnimationFrame(() => maybeRedraw(false));
    };

    const resize = (): void => {
      const box = stage.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      stageSize = { width: Math.max(1, box.width), height: Math.max(1, box.height) };
      // Le cadre a changé de taille : la zone déjà couverte n'a plus de sens.
      committed = null;
      schedule(true);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(stage);

    /*
     * Le rattrapage de netteté, quand la vue se pose.
     *
     * Pendant le geste on laisse dériver : c'est tout l'intérêt de ne pas
     * redessiner à chaque image. Mais le geste finit toujours par s'arrêter,
     * et c'est LÀ qu'on regarde vraiment — donc là que la moindre dilatation
     * du tampon se voit. Un seul redessin, à l'échelle exacte, une fois le
     * calme revenu.
     */
    let repos = 0;
    const surMouvement = (): void => {
      schedule(false);
      window.clearTimeout(repos);
      repos = window.setTimeout(() => {
        if (committed && viewport.transform.scale !== committed.density) schedule(true);
      }, REPOS_MS);
    };

    const unsubscribe = viewport.subscribe(surMouvement);
    forceRef.current = () => schedule(true);

    return () => {
      observer.disconnect();
      unsubscribe();
      window.clearTimeout(repos);
      forceRef.current = null;
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    };
    // La palette et l'état de sélection sont lus depuis des refs à l'instant
    // du dessin : cet effet ne doit se relancer que si le monde lui-même
    // change de forme.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport, layout, spatial, stageRef]);

  // Une sélection ou un changement de thème doit repeindre immédiatement —
  // même si le cadre visible, lui, n'a pas bougé d'un pixel.
  useEffect(() => {
    forceRef.current?.();
    // `etats` en dépendance : sans lui, une feuille nouvellement ouverte ne
    // réapparaissait qu'au prochain déplacement de la vue. Cela FONCTIONNAIT,
    // mais par un chemin détourné — toute modification refait la disposition,
    // dont le changement d'identité relance l'effet principal. Une repeinte
    // qui dépend d'un effet de bord n'est pas une repeinte.
  }, [highlightUnions, hasSelection, pathUnions, theme, etats, souches]);

  /*
   * L'éclosion, image par image.
   *
   * Même mécanique que la montée de sève : on repeint tant que l'ouverture
   * dure, puis on relâche. Le reste du temps `LinkLayer` ne redessine que
   * lorsque la vue bouge.
   */
  useEffect(() => {
    if (!eclosion || eclosion.ids.size === 0) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      eclosionRef.current = null;
      forceRef.current?.();
      return undefined;
    }

    eclosionRef.current = { ids: eclosion.ids, start: performance.now() };

    let frame = 0;
    const tick = (): void => {
      forceRef.current?.();
      const en = eclosionRef.current;
      if (en && performance.now() - en.start < ECLOSION_MS) {
        frame = requestAnimationFrame(tick);
        return;
      }
      eclosionRef.current = null;
      forceRef.current?.();
    };
    frame = requestAnimationFrame(tick);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      eclosionRef.current = null;
    };
  }, [eclosion]);

  /*
   * LA SÈVE MONTE.
   *
   * Le plan se calcule sur TOUTES les unions de l'arbre, pas sur celles qui
   * sont à l'écran : le front doit garder le même temps de parcours qu'on
   * regarde la branche ou non, sinon déplacer la vue pendant l'animation
   * changerait la vitesse de ce qu'on est en train de regarder.
   *
   * Une seule fois par sélection : la géométrie ne bouge pas pendant que
   * l'animation court, et Dijkstra n'a donc aucune raison de tourner soixante
   * fois par seconde.
   */
  useEffect(() => {
    /*
     * DEUX SÈVES, UN SEUL MOTEUR.
     *
     * L'ouverture et la sélection font exactement la même chose — un front
     * d'encre qui court sur un réseau depuis un point — et ne diffèrent que
     * par leur périmètre, leur départ et leur durée. Les tenir dans deux
     * effets aurait voulu dire deux boucles capables d'écrire dans le même
     * `seveRef`, et donc de s'écraser l'une l'autre au moment précis où l'on
     * clique pendant l'ouverture. Un seul effet, trois paramètres.
     *
     * L'ouverture passe DEVANT : cliquer pendant qu'elle court l'interrompt,
     * ce qui est le comportement attendu — le geste de l'utilisateur prime
     * toujours sur une animation d'accueil.
     */
    const cible = ouverture
      ? {
          unions: new Set(layout.unions.map((union) => union.id)),
          depuis: ouverture.source,
          duree: ouverture.duree,
          ancres: ouvertureAncresRef.current,
        }
      : hasSelection && source && highlightUnions.size > 0
        ? { unions: highlightUnions, depuis: source, duree: 0, ancres: undefined }
        : null;

    if (!cible) {
      seveRef.current = null;
      forceRef.current?.();
      return undefined;
    }

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      seveRef.current = null;
      forceRef.current?.();
      return undefined;
    }

    const plan = planterLaSeve(layout.unions, cible.unions, cible.depuis, cible.ancres);
    if (!plan || plan.portee <= 0) {
      seveRef.current = null;
      forceRef.current?.();
      return undefined;
    }

    const duree = cible.duree > 0 ? cible.duree : seveDuree(plan.portee);
    seveRef.current = { plan, start: performance.now(), duree };

    /*
     * L'heure d'arrivée chez chacun, convertie en millisecondes.
     *
     * `avance` est un `smoothstep` : le front ne parcourt pas la portée à
     * vitesse constante. Inverser la distance en temps demande donc d'inverser
     * ce lissage, faute de quoi les cartes du milieu de l'arbre frapperaient
     * jusqu'à un sixième de seconde trop tôt — l'écart maximal d'un smoothstep
     * à sa diagonale. On le fait par bissection : c'est monotone, dix
     * itérations donnent le millième, et cela n'a lieu qu'une fois.
     */
    if (plan.personnes && onOuverturePlan) {
      const arrivees = new Map<string, number>();
      for (const [id, distance] of plan.personnes) {
        const cible2 = Math.max(0, Math.min(1, distance / plan.portee));
        let bas = 0;
        let haut = 1;
        for (let k = 0; k < 12; k += 1) {
          const milieu = (bas + haut) / 2;
          if (avance(milieu) < cible2) bas = milieu;
          else haut = milieu;
        }
        arrivees.set(id, ((bas + haut) / 2) * duree);
      }
      onOuverturePlan(arrivees);
    }

    let frame = 0;
    const tick = (): void => {
      forceRef.current?.();
      const seve = seveRef.current;
      if (seve && performance.now() - seve.start < seve.duree) {
        frame = requestAnimationFrame(tick);
        return;
      }
      // Le plan retiré, le tracé revient de lui-même à son état final : c'est
      // la même image, sans le coût d'un chemin recoupé à chaque trait.
      seveRef.current = null;
      forceRef.current?.();
    };
    frame = requestAnimationFrame(tick);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      seveRef.current = null;
    };
  }, [highlightUnions, hasSelection, source, layout, ouverture, onOuverturePlan]);

  // L'apparition d'un trait tout juste créé : redessine à chaque image
  // pendant `GROWTH_MS`, puis relâche — le reste du temps, `LinkLayer` ne
  // redessine que quand la vue bouge (voir plus haut), pas à chaque image.
  useEffect(() => {
    if (!growingUnionId) return undefined;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    growthRef.current = { unionId: growingUnionId, start: performance.now() };
    if (reduced) {
      growthRef.current = null;
      forceRef.current?.();
      return undefined;
    }

    let frame = 0;
    const tick = (): void => {
      forceRef.current?.();
      if (growthRef.current && performance.now() - growthRef.current.start < GROWTH_MS) {
        frame = requestAnimationFrame(tick);
      } else {
        growthRef.current = null;
        forceRef.current?.();
      }
    };
    frame = requestAnimationFrame(tick);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      growthRef.current = null;
    };
  }, [growingUnionId]);

  return <canvas ref={canvasRef} className="stage-canvas" aria-hidden="true" />;
}
