import type { GenerationRow, LayoutUnion } from '@/domain/layout';
import type { EtatBotanique } from '@/domain/gaps';
import {
  CARD_HEIGHT,
  ROW_HEIGHT,
  cardCenterX,
  cardTop,
  cardBottom,
  portraitCenterY,
} from './metrics';

/*
 * ============================================================================
 *
 *  LES TRAITS DE FILIATION
 *
 *  Un arbre généalogique se lit, il ne se contemple pas. Les liens sont donc
 *  ce qu'ils sont sur tous les arbres imprimés depuis toujours : des traits
 *  orthogonaux. Un trait vertical descend du couple, un trait horizontal
 *  distribue, un trait vertical rejoint chaque enfant.
 *
 *  Ce choix n'est pas un renoncement, c'est ce qui rend le dessin infaillible.
 *  Une courbe doit décider par où passer et peut mal passer ; trois segments à
 *  angle droit partagent leurs extrémités par construction. Il ne peut pas
 *  exister de branche qui « ne touche pas » : le trait qui descend du bus et
 *  le bus lui-même sont le même point.
 *
 * ==========================================================================*/

export interface LinkPalette {
  /** Trait ordinaire. */
  line: string;
  /** Trait d'une lignée mise en évidence. */
  strong: string;
  /** Trait estompé, quand une autre lignée est sélectionnée. */
  dim: string;
  /** Alliance entre deux branches éloignées. */
  cross: string;
  /** Bande de fond, une rangée sur deux. */
  band: string;
  /** Étiquette de décennie, dans la marge de chaque bande. */
  bandLabel: string;
  /**
   * La touche du thème, portée jusque sur le trait.
   *
   * Ciel : un fil de lumière plutôt qu'un vecteur froid — une lueur portée
   * sous le trait, comme les liaisons d'une carte du ciel. Atlas : un trait
   * encré plutôt qu'une ligne de logiciel — une ombre très courte et sombre,
   * comme l'encre qui bave à peine dans le papier.
   */
  glow: { color: string; blur: number };
}

export interface DrawLinksParams {
  unions: LayoutUnion[];
  /** Rangées de générations, pour les bandes de fond. */
  rows: GenerationRow[];
  /**
   * La zone du monde couverte par ce canevas — pas le cadre visible à
   * l'instant du dessin, mais l'étendue, plus large, pré-rendue une fois pour
   * plusieurs images (voir `LinkLayer`).
   */
  worldRect: { left: number; top: number; right: number; bottom: number };
  /**
   * Pixels de canevas par unité du monde, à l'instant du dessin — pas
   * l'échelle courante de la vue. Le canevas vit dans `.world` et hérite de
   * son `transform: scale()` : il n'a donc besoin d'être redessiné à cette
   * densité que de loin en loin, pas à chaque image de zoom.
   */
  density: number;
  dpr: number;
  palette: LinkPalette;
  /** Unions accentuées par la sélection courante. */
  highlighted: Set<string>;
  hasSelection: boolean;
  /** Unions du chemin de parenté affiché, tracées en accent par-dessus tout. */
  pathUnions?: Set<string>;
  /**
   * L'union qu'on vient de créer (nouveau proche ajouté), et l'avancement de
   * son tracé — 0 au tout début, 1 une fois complet. Tant que `progress < 1`,
   * cette union est retirée du tracé normal : sans quoi le trait complet
   * transparaîtrait déjà sous l'animation, qui ne ferait plus que le
   * souligner au lieu de le révéler.
   */
  growth?: { unionId: string; progress: number };
  /**
   * L'état de chaque fiche, pour la feuillaison des branches.
   *
   * Passé plutôt que calculé ici : `drawLinks` ne connaît que la géométrie, et
   * doit continuer à ne connaître que ça. C'est `TreeCanvas` qui sait ce que
   * contiennent les fiches.
   */
  etats?: Map<string, EtatBotanique>;
  /**
   * La sève en train de monter, quand une sélection vient de changer.
   *
   * `front` est la distance déjà parcourue depuis la personne choisie, dans
   * les unités du monde — la même mesure que `PlanDeSeve.portee`. `estompe`
   * va de 0 (le reste de l'arbre est encore noir) à 1 (il a fini de griser).
   * Absent : tout est à son état final, sans animation.
   */
  seve?: { plan: PlanDeSeve; front: number; estompe: number };
  /**
   * Les fiches dont le bourgeon vient de s'ouvrir en feuille, et où en est
   * cette ouverture.
   *
   * Une seule avancée pour toutes : elles viennent d'une même modification,
   * elles s'ouvrent donc ensemble. Absent : rien n'éclôt.
   */
  eclosion?: { ids: Set<string>; progres: number };
  /**
   * Les SOUCHES : les personnes que l'arbre place sans qu'elles soient
   * l'enfant d'aucune union dessinée.
   *
   * Elles n'ont pas de rameau, donc pas d'endroit où accrocher leur marque
   * botanique — et la moitié de l'arbre se retrouvait muette (voir
   * `feuiller`). Elles reçoivent une amorce de branche au-dessus de leur
   * carte, qui dit ce qui est vrai : ça continue par là, on ne sait
   * simplement pas encore où.
   */
  souches?: Array<{ id: string; x: number; y: number; accentuee: boolean }>;
}

/**
 * Hauteur du trait distributeur au-dessus de la rangée des enfants.
 *
 * À mi-chemin entre les deux rangées : c'est là qu'il sépare le plus
 * nettement ce qui descend de ce qui distribue.
 */
const BUS_LIFT = (ROW_HEIGHT - CARD_HEIGHT) * 0.5;

export function drawLinks(ctx: CanvasRenderingContext2D, params: DrawLinksParams): void {
  const { worldRect, dpr, palette, highlighted, hasSelection } = params;
  const density = Math.max(params.density, 0.02);

  const bufferWidth = (worldRect.right - worldRect.left) * density * dpr;
  const bufferHeight = (worldRect.bottom - worldRect.top) * density * dpr;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, bufferWidth, bufferHeight);
  // Le canevas ne couvre pas l'origine du monde : son coin (worldRect.left,
  // worldRect.top) doit tomber sur le pixel (0, 0) de son propre tampon.
  ctx.setTransform(
    density * dpr,
    0,
    0,
    density * dpr,
    -worldRect.left * density * dpr,
    -worldRect.top * density * dpr,
  );

  /*
   * Les bandes de génération.
   *
   * Une rangée sur deux, à peine teintée. Sur cinq cents personnes réparties
   * sur treize mille unités de large, rien ne dit à quelle génération on est
   * en train de regarder : l'œil perd sa ligne dès qu'il se déplace
   * latéralement. La bande la lui rend, et la décennie posée dans sa marge
   * donne l'époque sans qu'on ait à consulter quoi que ce soit.
   *
   * L'étiquette est calée sur le bord de la zone couverte par ce canevas, pas
   * sur le cadre visible à l'instant précis : ce dernier change à chaque
   * image, la zone couverte seulement de loin en loin (voir `LinkLayer`).
   * En pratique elle suit un déplacement continu par à-coups plutôt qu'en
   * temps réel — un compromis largement rentable au vu de ce qu'il économise.
   */
  const left = worldRect.left;
  const right = worldRect.right;
  const bandTop = worldRect.top;
  const bandBottom = worldRect.bottom;

  for (const row of params.rows) {
    if (row.generation % 2 !== 0) continue;
    const top = row.y - (ROW_HEIGHT - CARD_HEIGHT) / 2;
    if (top > bandBottom || top + ROW_HEIGHT < bandTop) continue;
    ctx.fillStyle = palette.band;
    ctx.fillRect(left, top, right - left, ROW_HEIGHT);
  }

  // La décennie, calée sur le bord gauche du cadre : elle reste lisible où
  // qu'on se trouve dans la largeur, sans jamais recouvrir une carte.
  const labelSize = 13 / density;
  if (labelSize < ROW_HEIGHT * 0.5) {
    ctx.fillStyle = palette.bandLabel;
    ctx.font = `600 ${labelSize}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const row of params.rows) {
      if (!row.label) continue;
      const middle = row.y + CARD_HEIGHT / 2;
      if (middle < bandTop || middle > bandBottom) continue;
      ctx.fillText(row.label, left + 16 / density, middle);
    }
  }

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // L'union en cours d'apparition est retirée du tracé normal tant qu'elle
  // n'est pas complète : sinon le trait entier transparaîtrait déjà dessous,
  // et l'animation ne ferait que le souligner au lieu de le révéler.
  const growingId = params.growth && params.growth.progress < 1 ? params.growth.unionId : undefined;
  const drawableUnions = growingId
    ? params.unions.filter((union) => union.id !== growingId)
    : params.unions;

  // Deux teintes au plus, et un seul `Path2D` par teinte : `encrer` accumule
  // tous les traits d'un groupe dans le même chemin, puis le remplit trois
  // fois. Séparer les couleurs plus finement voudrait dire un chemin par
  // union — un millier de chemins là où deux suffisent.
  const groups: Array<{
    role: 'seul' | 'estompe' | 'accent';
    list: LayoutUnion[];
    color: string;
    weight: number;
  }> = hasSelection
    ? [
        {
          role: 'estompe',
          list: drawableUnions.filter((union) => !highlighted.has(union.id)),
          color: palette.dim,
          weight: 2.0,
        },
        {
          role: 'accent',
          list: drawableUnions.filter((union) => highlighted.has(union.id)),
          color: palette.strong,
          weight: 3.6,
        },
      ]
    : [{ role: 'seul', list: drawableUnions, color: palette.line, weight: 2.6 }];

  /*
   * L'encre.
   *
   * Le trait n'est plus « strocké » à épaisseur constante : chaque segment est
   * une forme remplie, plus grasse à son attaque qu'à sa sortie. C'est ce
   * dégradé — épais au tronc, effilé au rameau — qui fait lire un arbre là où
   * un vecteur d'épaisseur égale ne donnait qu'un organigramme.
   *
   * L'unité reste le pixel d'écran : un trait de filiation ne grossit pas avec
   * le zoom, sans quoi il finirait par masquer les cartes.
   */
  const unit = 1 / density;
  ctx.shadowBlur = 0;

  const seve = params.seve;

  for (const group of groups) {
    if (group.list.length === 0) continue;

    // Un divorce garde sa descente pleine — se séparer ne défait pas la
    // filiation — mais son trait d'alliance se dessine à part, plus bas.
    const traits: Trait[] = [];
    /** Le point exact où la plume en est, sur chaque trait en cours. */
    const gouttes: Array<[number, number]> = [];
    /** Par union, la part déjà encrée : c'est elle qui ouvre les feuilles. */
    let avancements: Map<string, number> | undefined;

    /*
     * L'OUVERTURE COULE SUR LE GROUPE UNIQUE.
     *
     * La sève ne s'appliquait qu'au groupe accentué — celui qui n'existe que
     * lorsqu'une personne est sélectionnée. À l'ouverture, il n'y a pas de
     * sélection : tout l'arbre est dans le groupe « seul », et le plan, tout
     * calculé qu'il était, ne servait à rien.
     */
    if ((group.role === 'accent' || group.role === 'seul') && seve) {
      avancements = new Map();
      for (const union of group.list) {
        const plan = seve.plan.traits.get(union.id);
        let atteint = 0;
        let total = 0;
        unionSegments(union, union.status !== 'divorced').forEach((trait, rang) => {
          const arrivee = plan?.[rang];
          // Un trait que le plan ne connaît pas — de longueur nulle, donc
          // écarté à la construction : il n'a rien à révéler.
          if (!arrivee) {
            traits.push(trait);
            return;
          }
          total += arrivee.longueur;
          const f = Math.max(
            0,
            Math.min(1, (seve.front - arrivee.depart) / arrivee.longueur),
          );
          atteint += arrivee.longueur * f;
          if (f <= 0) return;
          if (f >= 1) {
            traits.push(trait);
            return;
          }
          traits.push(couper(trait, f, arrivee.parLeDebut));
          const [x1, y1, x2, y2] = trait.seg;
          gouttes.push(
            arrivee.parLeDebut
              ? [x1 + (x2 - x1) * f, y1 + (y2 - y1) * f]
              : [x2 + (x1 - x2) * f, y2 + (y1 - y2) * f],
          );
        });
        avancements.set(union.id, total > 0 ? atteint / total : 1);
      }
    } else {
      for (const union of group.list) {
        for (const trait of unionSegments(union, union.status !== 'divorced')) traits.push(trait);
      }
    }

    encrer(ctx, traits, group.color, group.weight * unit, unit);

    /*
     * Le reste de l'arbre ne grise pas d'un coup : son encre pleine se retire
     * par-dessus le gris déjà posé.
     *
     * Un fondu croisé, donc deux remplissages superposés pendant deux
     * dixièmes de seconde — ce qui assombrit très légèrement le trait à
     * mi-parcours. On pourrait l'éviter en n'animant que l'alpha d'une seule
     * teinte, puisque `--link` et `--link-dim` ne diffèrent aujourd'hui que
     * par là. Ce serait construire sur un accident : le jour où l'une des
     * deux change de pigment, le fondu deviendrait faux sans que rien ne le
     * dise. Le fondu croisé, lui, reste juste pour n'importe quel couple de
     * couleurs.
     */
    if (group.role === 'estompe' && seve && seve.estompe < 1) {
      encrer(ctx, traits, palette.line, 2.6 * unit, unit, 1 - seve.estompe);
    }

    /*
     * La goutte au front.
     *
     * C'est le détail qui fait la différence entre « un trait qui s'allonge »
     * et « quelque chose qui coule » : une plume qui avance porte toujours un
     * peu plus d'encre à sa pointe qu'elle n'en laisse derrière elle. Deux
     * cercles — un halo large et pâle, un cœur plus dense — et le mouvement
     * cesse d'être une simple longueur qui change.
     */
    if (gouttes.length > 0) {
      for (const [rayon, alpha] of [[3.4, 0.14] as const, [1.6, 0.5] as const]) {
        const perles = new Path2D();
        const r = rayon * unit;
        for (const [gx, gy] of gouttes) {
          perles.moveTo(gx + r, gy);
          perles.arc(gx, gy, r, 0, Math.PI * 2);
        }
        ctx.globalAlpha = alpha;
        ctx.fillStyle = group.color;
        ctx.fill(perles);
      }
      ctx.globalAlpha = 1;
    }

    if (params.etats) {
      // Les souches suivent le même partage que les unions : accentuées avec
      // la lignée choisie, estompées avec le reste.
      const souchesDuGroupe = params.souches?.filter(
        (souche) => group.role === 'seul' || souche.accentuee === (group.role === 'accent'),
      );
      const seveGlobale =
        (group.role === 'accent' || group.role === 'seul') && seve
          ? Math.max(0, Math.min(1, seve.front / Math.max(1, seve.plan.portee)))
          : 1;
      feuiller(
        ctx,
        group.list,
        params.etats,
        group.color,
        unit,
        avancements,
        params.eclosion,
        souchesDuGroupe,
        seveGlobale,
      );
    }
  }

  /*
   * Le trait d'alliance d'un divorce, à part et en pointillé.
   *
   * Un couple séparé garde sa place dans l'arbre — ses enfants en
   * descendent toujours — mais le trait qui les unissait, lui, ne doit plus
   * se lire comme un lien intact. Chaque teinte (atténuée, accentuée ou
   * normale) reprend le même partage que les traits pleins ci-dessus, pour
   * qu'un divorce mis en évidence par la sélection le reste ici aussi.
   */
  const divorced = drawableUnions.filter((union) => union.status === 'divorced');
  if (divorced.length > 0) {
    for (const group of groups) {
      const list = group.list.filter((union) => union.status === 'divorced');
      if (list.length === 0) continue;
      /*
       * Un pointillé de plume, et non un `setLineDash`.
       *
       * Une ligne pointillée de logiciel a des tirets rigoureusement égaux ;
       * une plume qui saute laisse des traits inégaux, chacun avec sa propre
       * attaque et sa propre sortie. On découpe donc l'alliance en cinq
       * fragments effilés aux deux bouts.
       */
      const traits: Trait[] = [];
      for (const union of list) {
        const alliance = allianceSegment(union);
        if (!alliance) continue;
        const [x1, y1, x2, y2] = alliance;
        for (let i = 0; i < 5; i += 1) {
          const a = i / 5;
          const b = a + 0.13;
          traits.push({
            seg: [x1 + (x2 - x1) * a, y1 + (y2 - y1) * a, x1 + (x2 - x1) * b, y1 + (y2 - y1) * b],
            from: 0.5,
            to: 0.5,
          });
        }
      }
      encrer(ctx, traits, group.color, group.weight * unit, unit);
    }
  }

  // Le chemin de parenté, par-dessus tout le reste : c'est la réponse à la
  // question qu'on vient de poser, elle ne doit se perdre dans rien.
  if (params.pathUnions && params.pathUnions.size > 0) {
    const onPath = params.unions.filter((union) => params.pathUnions!.has(union.id));
    if (onPath.length > 0) {
      encrer(ctx, traitsDe(onPath), palette.strong, 3.2 * unit, unit);
    }
  }

  // L'union tout juste créée se dessine elle-même, trait par trait, dans le
  // même ordre de lecture que le reste de l'arbre (alliance, descente, bus,
  // puis chaque enfant) — la même technique de révélation par longueur de
  // trait que le rideau d'ouverture, portée ici sur le canevas via
  // plume qui avance sur le papier plutôt que trait qui se découvre.
  if (params.growth) {
    const growing = params.unions.find((union) => union.id === params.growth!.unionId);
    const length = growing ? unionPathLength(growing) : 0;
    if (growing && length > 0) {
      const progress = Math.min(1, Math.max(0, params.growth.progress));
      let reste = length * progress;
      const traits: Trait[] = [];
      for (const trait of unionSegments(growing)) {
        if (reste <= 0) break;
        const [x1, y1, x2, y2] = trait.seg;
        const l = Math.hypot(x2 - x1, y2 - y1);
        if (l <= reste) {
          traits.push(trait);
          reste -= l;
        } else {
          // Le trait en cours, coupé là où la plume en est.
          const f = reste / l;
          traits.push({
            seg: [x1, y1, x1 + (x2 - x1) * f, y1 + (y2 - y1) * f],
            from: trait.from,
            to: trait.from + (trait.to - trait.from) * f,
          });
          reste = 0;
        }
      }
      encrer(ctx, traits, palette.strong, 3 * unit, unit);
    }
  }

  ctx.shadowBlur = 0;

  /*
   * Le jalon de chaque union.
   *
   * Un trait qui bifurque a besoin d'un point où bifurquer — sans lui, le
   * réseau de traits reste un pur vecteur, sans rien qui dise « c'est ici
   * qu'une famille commence ». Ciel : une étoile de plus, dans la même
   * couleur que le fil de lumière des traits. Atlas : un point d'encre, là
   * où la plume a posé le paraphe du mariage.
   */
  const hubRadius = 2 / density;
  ctx.beginPath();
  for (const union of params.unions) {
    const hub = unionHub(union);
    if (!hub) continue;
    ctx.moveTo(hub.x + hubRadius, hub.y);
    ctx.arc(hub.x, hub.y, hubRadius, 0, Math.PI * 2);
  }
  ctx.fillStyle = palette.glow.color;
  ctx.globalAlpha = hasSelection ? 0.32 : 0.85;
  ctx.fill();

  if (hasSelection && highlighted.size > 0) {
    const hubRadiusStrong = 2.6 / density;
    ctx.beginPath();
    for (const union of params.unions) {
      if (!highlighted.has(union.id)) continue;
      const hub = unionHub(union);
      if (!hub) continue;
      ctx.moveTo(hub.x + hubRadiusStrong, hub.y);
      ctx.arc(hub.x, hub.y, hubRadiusStrong, 0, Math.PI * 2);
    }
    ctx.fillStyle = palette.strong;
    ctx.globalAlpha = 1;
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  /*
   * Le veuvage : le même « † » que porte déjà la fiche de la personne
   * disparue (voir `.node[data-deceased] .node-years::before` dans
   * `node.css`) — pas un symbole inventé pour l'occasion, le même repère
   * qu'on a déjà appris à lire, posé cette fois sur le nœud de l'union
   * plutôt que caché dans une fiche qu'il faudrait ouvrir pour le découvrir.
   */
  const widowed = params.unions.filter((union) => union.status === 'widowed');
  if (widowed.length > 0) {
    const fontSize = 11 / density;
    ctx.font = `${fontSize}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = palette.bandLabel;
    ctx.globalAlpha = hasSelection ? 0.55 : 0.85;
    for (const union of widowed) {
      const hub = unionHub(union);
      if (!hub) continue;
      ctx.fillText('†', hub.x, hub.y - 6 / density);
    }
    ctx.globalAlpha = 1;
  }
}

/** Le point où une union « se noue » : le milieu du trait d'alliance pour un
 *  couple, le bas de la carte pour un parent seul. */
function unionHub(union: LayoutUnion): { x: number; y: number } | undefined {
  const { partners } = union;
  if (partners.length === 0) return undefined;
  const sorted = [...partners].sort((a, b) => a.x - b.x);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (sorted.length > 1 && union.adjacent) {
    const y = portraitCenterY(Math.min(first.y, last.y));
    return { x: (cardCenterX(first.x) + cardCenterX(last.x)) / 2, y };
  }
  return { x: cardCenterX(first.x), y: cardBottom(first.y) };
}

/** Un segment orthogonal, dans l'ordre où l'union se lit : `[x1, y1, x2, y2]`. */
type Segment = readonly [number, number, number, number];

/**
 * Un trait de plume : un segment, et l'épaisseur qu'il porte à chaque bout.
 *
 * Les deux valeurs sont des MULTIPLES de l'épaisseur de base, pas des
 * pixels : c'est ce qui permet à la sélection d'épaissir tout le réseau d'un
 * coup sans que le rapport entre un tronc et un rameau ne bouge.
 */
interface Trait {
  seg: Segment;
  from: number;
  to: number;
  /**
   * Le nœud : un renflement LOCAL au départ du trait, en pixels d'écran.
   *
   * Une branche ne quitte pas sa mère par un embranchement net — elle en
   * sort par un bourrelet, et c'est ce bourrelet qui fait qu'on la lit comme
   * ATTACHÉE plutôt que posée dessus. L'effilement linéaire de `from` à `to`
   * ne peut pas le dire : il n'a qu'une pente, là où un nœud est une bosse
   * qui s'éteint en quelques pixels.
   */
  noeud?: number;
}

/**
 * Le frémis de la main.
 *
 * Une plume ne trace pas droit — elle ondule très lentement, au rythme du
 * poignet. Ce qu'il faut, c'est un bruit LISSÉ : un tirage au hasard à chaque
 * point donnerait un zigzag de sismographe, qui se lit comme un défaut de
 * rendu et non comme une main.
 *
 * Déterministe, et c'est essentiel : la même union doit frémir exactement
 * pareil à chaque redessin, sinon l'arbre entier tremblote dès qu'on le
 * déplace.
 */
/*
 * LE FRÉMIS : UNE SEULE TABLE, POUR TOUT L'ARBRE.
 *
 * Chaque trait tirait sa propre table de soixante-quatre valeurs et la
 * refermait dans une fonction. Mesuré : à cent cinquante traits redessinés
 * trois fois — une passe par épaisseur d'encre —, cela faisait quatre cent
 * cinquante tables et quatre cent cinquante fermetures créées puis jetées à
 * CHAQUE image de la montée de sève.
 *
 * Une table unique, remplie une fois, suffit : chaque trait n'y entre pas au
 * même endroit. Le décalage vient de sa position, donc il ne bouge jamais —
 * un trait frémit exactement pareil à chaque redessin, ce qui est toute la
 * condition pour que l'arbre ne tremblote pas quand on le déplace.
 */
const FREMIS_TAILLE = 512;
const FREMIS = new Float64Array(FREMIS_TAILLE);
{
  let x = 0x9e3779b9;
  for (let i = 0; i < FREMIS_TAILLE; i += 1) {
    x = (x * 1664525 + 1013904223) >>> 0;
    FREMIS[i] = x / 4294967296;
  }
}

function fremis(decalage: number, t: number): number {
  const u = t + decalage;
  const i = Math.floor(u);
  const f = u - i;
  const a = FREMIS[((i % FREMIS_TAILLE) + FREMIS_TAILLE) % FREMIS_TAILLE];
  const b = FREMIS[(((i + 1) % FREMIS_TAILLE) + FREMIS_TAILLE) % FREMIS_TAILLE];
  // Lissage en marche d'escalier adoucie : la dérivée s'annule aux nœuds,
  // donc pas d'angle au passage d'un intervalle à l'autre.
  return a + (b - a) * (f * f * (3 - 2 * f));
}

/** Une graine stable, tirée de la position : le même trait frémit toujours
 *  de la même façon, où qu'on en soit dans le déplacement. */
const graineDe = ([x1, y1]: Segment): number => Math.abs(Math.round(x1 * 7.3 + y1 * 13.1));

/* ---------------------------------------------------------------------------
 * L'AXE D'UN TRAIT, ÉCHANTILLONNÉ UNE SEULE FOIS
 *
 * Un trait est encré en trois passes — deux bavures et l'encre — et les trois
 * suivent EXACTEMENT le même axe : seule la demi-épaisseur change. On les
 * calculait pourtant trois fois, avec leur trigonométrie, leur bruit et deux
 * tableaux qui grandissaient à coups de `push`.
 *
 * L'axe est donc échantillonné une fois dans des tampons réutilisés d'un trait
 * à l'autre, et les trois chemins sont nourris dans la foulée. Plus une seule
 * allocation par trait, et un tiers du calcul.
 * ------------------------------------------------------------------------- */

/** Bien au-delà du `N` maximal ci-dessous : ces tampons ne sont alloués qu'une
 *  fois pour toute la vie de la page. */
const ECH_MAX = 40;
const ECH_X = new Float64Array(ECH_MAX);
const ECH_Y = new Float64Array(ECH_MAX);
const ECH_DEMI = new Float64Array(ECH_MAX);
let echN = 0;
let echNx = 0;
let echNy = 0;

/**
 * Pose l'axe d'un trait dans les tampons partagés.
 *
 * Rend `false` pour un trait de longueur nulle : il n'y a rien à encrer, et sa
 * normale ne serait pas définie.
 */
function echantillonner(trait: Trait, base: number, unit: number): boolean {
  const [x1, y1, x2, y2] = trait.seg;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 0.01) return false;

  echNx = -dy / len;
  echNy = dx / len;

  /*
   * Le frémis se mesure à l'ÉCRAN, pas à l'épaisseur du trait.
   *
   * Premier essai : une amplitude proportionnelle à `base`, sur la foi que
   * l'ondulation était « une propriété du trait ». Un trait fait deux pixels :
   * l'ondulation en faisait un demi, et la mesure des pixels rendus l'a
   * confirmé — parfaitement invisible. Une main ne tremble pas plus fort parce
   * qu'elle tient une plume plus grasse ; elle dévie de la même fraction de
   * millimètre. L'unité, donc, est le pixel d'écran.
   *
   * Et la période aussi : à fréquence fixe par segment, une barre courte
   * ondulait autant qu'une longue descente et se lisait comme un défaut. Une
   * ondulation tous les ~70 px de course, et le geste redevient le même
   * partout.
   */
  const courseEcran = len / unit;
  const periodes = Math.max(1.2, courseEcran / 70);
  // Le nœud s'éteint en six pixels d'écran, quelle que soit la longueur du
  // trait : c'est un accident de l'attache, pas une proportion de la branche.
  const noeud = trait.noeud ?? 0;
  const portee = 6 / courseEcran;
  const decalage = graineDe(trait.seg) % FREMIS_TAILLE;
  // Assez de points pour que chaque ondulation soit décrite, pas au point de
  // payer un millier de sommets par union.
  const N = Math.min(24, Math.max(6, Math.round(periodes * 5)));
  echN = N;

  for (let i = 0; i <= N; i += 1) {
    const t = i / N;
    const bosse = noeud > 0 ? noeud * unit * Math.exp(-(t / portee) * (t / portee)) : 0;
    const ecart = (fremis(decalage, t * periodes) - 0.5) * unit * 1.5;
    ECH_X[i] = x1 + dx * t + echNx * ecart;
    ECH_Y[i] = y1 + dy * t + echNy * ecart;
    ECH_DEMI[i] = (base * (trait.from + (trait.to - trait.from) * t)) / 2 + bosse;
  }

  return true;
}

/**
 * Le tracé d'un trait à la plume, depuis l'axe déjà posé.
 *
 * On ne « strokes » pas une ligne : on REMPLIT la forme comprise entre deux
 * bords décalés de part et d'autre de l'axe. C'est la seule façon de faire
 * varier l'épaisseur le long de la course — et c'est ce qui distingue une
 * plume d'un feutre, qui pose partout la même largeur.
 *
 * `gonfle` sert à la bavure : le même tracé, élargi, très pâle, posé dessous.
 */
function plume(path: Path2D, gonfle: number): void {
  const n = echN;
  let demi = ECH_DEMI[0] + gonfle;
  path.moveTo(ECH_X[0] + echNx * demi, ECH_Y[0] + echNy * demi);
  for (let i = 1; i <= n; i += 1) {
    demi = ECH_DEMI[i] + gonfle;
    path.lineTo(ECH_X[i] + echNx * demi, ECH_Y[i] + echNy * demi);
  }
  for (let i = n; i >= 0; i -= 1) {
    demi = ECH_DEMI[i] + gonfle;
    path.lineTo(ECH_X[i] - echNx * demi, ECH_Y[i] - echNy * demi);
  }
  path.closePath();
}

/**
 * Encrer une liste de traits.
 *
 * Trois passes, et l'ordre compte : la bavure d'abord — le papier boit
 * l'encre bien au-delà du tracé —, le trait ensuite. La bavure est obtenue
 * en élargissant la même forme plutôt qu'en floutant, ce qui évite un
 * `ctx.filter` par groupe : un flou de canevas coûte cher, deux remplissages
 * de plus ne coûtent presque rien.
 */
function encrer(
  ctx: CanvasRenderingContext2D,
  traits: Trait[],
  couleur: string,
  base: number,
  unit: number,
  opacite = 1,
): void {
  if (traits.length === 0 || opacite <= 0) return;

  /*
   * Les trois chemins se remplissent EN MÊME TEMPS, un trait après l'autre.
   *
   * Trois boucles séparées sur la liste des traits obligeaient à
   * rééchantillonner l'axe à chaque fois. Une seule boucle, trois `Path2D`
   * nourris dans la foulée : l'axe n'est calculé qu'une fois.
   */
  const bavureLarge = new Path2D();
  const bavureCourte = new Path2D();
  const encre = new Path2D();

  for (const trait of traits) {
    if (!echantillonner(trait, base, unit)) continue;
    plume(bavureLarge, 2.6 * unit);
    plume(bavureCourte, 1.1 * unit);
    plume(encre, 0);
  }

  // L'ordre compte : le papier boit l'encre bien au-delà du tracé, donc la
  // bavure d'abord, le trait ensuite. Elle est obtenue en élargissant la même
  // forme plutôt qu'en floutant, ce qui évite un `ctx.filter` par groupe — un
  // flou de canevas coûte cher, deux remplissages de plus ne coûtent rien.
  ctx.fillStyle = couleur;
  ctx.globalAlpha = 0.05 * opacite;
  ctx.fill(bavureLarge);
  ctx.globalAlpha = 0.07 * opacite;
  ctx.fill(bavureCourte);
  ctx.globalAlpha = opacite;
  ctx.fill(encre);
  ctx.globalAlpha = 1;
}

/* ---------------------------------------------------------------------------
 * LA FEUILLAISON
 *
 * Les quatre états d'une fiche (voir `etatBotanique` dans `domain/gaps.ts`)
 * étaient posés en marge des médaillons, en masques CSS de seize pixels.
 * Verdict de qui regarde l'arbre : « la botanique ne se voit pas assez ».
 * C'était juste — une marque posée à côté d'un portrait est un badge, et un
 * badge se lit comme une décoration d'interface, pas comme un arbre.
 *
 * Elles passent donc SUR LES BRANCHES, à même le canevas, là où une feuille
 * pousse. Et l'état le plus grave devient le plus évident sans qu'on dessine
 * rien : un rameau nu est une branche SANS FEUILLE.
 *
 *   FEUILLE        un limbe plein, encré comme la branche
 *   FEUILLE SÈCHE  le même limbe, en contour seul, plus étroit et recourbé
 *   BOURGEON       une petite goutte close, sans nervure
 *   RAMEAU NU      rien
 *
 * ------------------------------------------------------------------------- */

/**
 * Le repère local d'une feuille : `u` court le long, `v` en travers.
 */
export function repere(x: number, y: number, angle: number) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return (u: number, v: number): [number, number] => [
    x + u * cos - v * sin,
    y + u * sin + v * cos,
  ];
}

/**
 * Le limbe : deux arcs qui se rejoignent EN POINTE aux deux bouts.
 *
 * Premier essai, les points de contrôle voisins de la pointe étaient posés en
 * travers de l'axe : les deux arcs y arrivaient tangents l'un à l'autre, donc
 * la feuille se fermait en rond. À l'écran, ce n'était pas une feuille mais
 * une tache — et une tache reste une tache quelle que soit sa taille.
 *
 * Ils sont maintenant ramenés vers l'axe (0,72 L pour un écart de 0,8 l) : les
 * deux arcs y arrivent en biais, ils se coupent, et la feuille a sa pointe.
 * C'est la seule chose qui distingue un limbe d'un pâté.
 *
 * `creux` cambre la feuille : nul elle est symétrique, fort elle s'enroule —
 * c'est ce qui fait la feuille sèche.
 */
export function limbe(path: Path2D, x: number, y: number, angle: number, taille: number, creux: number): void {
  const px = repere(x, y, angle);
  const L = taille;
  const l = taille * 0.34;
  const [bx, by] = px(0, 0);
  const [tx, ty] = px(L, 0);
  path.moveTo(bx, by);
  path.bezierCurveTo(...px(L * 0.16, l), ...px(L * 0.72, l * 0.8), tx, ty);
  path.bezierCurveTo(...px(L * 0.72, -l * (0.8 - creux)), ...px(L * 0.16, -l * (1 - creux)), bx, by);
}

/** La nervure, qui suit la cambrure du limbe. */
export function nervure(path: Path2D, x: number, y: number, angle: number, taille: number, creux: number): void {
  const px = repere(x, y, angle);
  const L = taille;
  const [bx, by] = px(L * 0.08, 0);
  path.moveTo(bx, by);
  path.bezierCurveTo(
    ...px(L * 0.4, taille * 0.06 * creux),
    ...px(L * 0.7, taille * 0.04 * creux),
    ...px(L * 0.9, 0),
  );
}

/** Le pétiole : la feuille est ATTACHÉE à sa branche, elle n'y flotte pas. */
export function petiole(path: Path2D, x: number, y: number, angle: number, longueur: number): void {
  const px = repere(x, y, angle);
  path.moveTo(x, y);
  path.lineTo(...px(longueur, 0));
}

/** La goutte close du bourgeon : courte, large, sans pointe ni nervure. */
export function goutte(path: Path2D, x: number, y: number, angle: number, taille: number): void {
  const px = repere(x, y, angle);
  const L = taille;
  const l = taille * 0.42;
  const [bx, by] = px(0, 0);
  const [tx, ty] = px(L, 0);
  path.moveTo(bx, by);
  path.bezierCurveTo(...px(L * 0.12, l), ...px(L * 0.86, l * 0.62), tx, ty);
  path.bezierCurveTo(...px(L * 0.86, -l * 0.62), ...px(L * 0.12, -l), bx, by);
}

/**
 * Feuiller les branches d'un groupe d'unions.
 *
 * Quatre chemins pour tout l'arbre — les pétioles, les limbes pleins, les
 * limbes secs, les bourgeons — tracés ou remplis une fois chacun. Le même
 * principe que `encrer` : ce qui coûte, ce n'est pas la quantité de dessin,
 * c'est le nombre d'appels.
 */
/**
 * L'éclosion : la feuille s'ouvre un peu au-delà de sa taille, puis revient.
 *
 * Ce dépassement de dix pour cent est tout ce qui sépare une feuille qui
 * s'ouvre d'une feuille qu'on agrandit. Rien de vivant n'atteint sa taille en
 * ralentissant : ça dépasse, puis ça se pose.
 */
function eclot(p: number): number {
  const t = Math.max(0, Math.min(1, p));
  const c = 1.70158;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
}

/**
 * Un point où une marque vient se poser.
 *
 * Deux origines, un seul dessin : le rameau qui descend vers un enfant, et
 * l'amorce qui monte au-dessus d'une souche. Les rassembler évite d'écrire
 * deux fois la même feuille — et c'est en les séparant qu'on avait laissé la
 * moitié de l'arbre sans marque.
 */
interface Attache {
  id: string;
  x: number;
  y: number;
  /** De quel côté la feuille s'écarte. Jamais au hasard : voir plus bas. */
  cote: number;
  /** Ce que la sève a déjà atteint ici. 1 hors animation. */
  pousse: number;
  /** Longueur du bout de branche à tracer sous la marque. 0 sur un rameau. */
  amorce: number;
}

/**
 * L'amorce d'une souche, en pixels d'écran.
 *
 * Assez longue pour se lire comme une branche qui continue, assez courte pour
 * ne pas se confondre avec un vrai lien de filiation — ce qu'elle n'est pas.
 */
const AMORCE_SOUCHE = 17;

function feuiller(
  ctx: CanvasRenderingContext2D,
  unions: LayoutUnion[],
  etats: Map<string, EtatBotanique>,
  couleur: string,
  unit: number,
  /** Par union, la part de son trait déjà encrée. Absent : tout est ouvert. */
  avancements?: Map<string, number>,
  /** Les feuilles en train de s'ouvrir. Voir `eclosion` dans les paramètres. */
  eclosion?: { ids: Set<string>; progres: number },
  /** Les personnes sans rameau, qui portent leur marque sur une amorce. */
  souches?: Array<{ id: string; x: number; y: number }>,
  /**
   * L'avancée d'ensemble de la sève, pour les souches.
   *
   * Elles ne sont rattachées à aucun trait dont on connaîtrait l'arrivée
   * exacte du front. Faute de mieux, elles suivent l'avancée globale : ce
   * n'est pas juste au trait près, mais elles arrivent AVEC la vague au lieu
   * d'être déjà là avant elle, ce qui se verrait.
   */
  seveGlobale = 1,
): void {
  const tiges = new Path2D();
  const pleines = new Path2D();
  const seches = new Path2D();
  const nervures = new Path2D();
  const bourgeons = new Path2D();
  let quelquechose = false;

  const attaches: Attache[] = [];

  /*
   * Le côté alterne selon la position, jamais au hasard : une même branche
   * doit porter sa feuille du même côté à chaque redessin.
   */
  const coteDe = (x: number): number => (Math.round(x) % 2 === 0 ? 1 : -1);

  for (const union of unions) {
    const { partners, children } = union;
    if (partners.length === 0 || children.length === 0) continue;
    const busY = cardTop(children[0].y) - BUS_LIFT;

    // Une feuille ne pousse pas sur une branche que la sève n'a pas atteinte.
    const pousse = avancements ? eclot(avancements.get(union.id) ?? 1) : 1;
    if (pousse <= 0.02) continue;

    for (const child of children) {
      const centre = cardCenterX(child.x);
      const haut = cardTop(child.y);
      // Aux deux cinquièmes de la descente : assez bas pour ne pas se perdre
      // dans le nœud d'attache, assez haut pour ne pas toucher la carte.
      attaches.push({
        id: child.id,
        x: centre,
        y: busY + (haut - busY) * 0.42,
        cote: coteDe(centre),
        pousse,
        amorce: 0,
      });
    }
  }

  for (const souche of souches ?? []) {
    const centre = cardCenterX(souche.x);
    attaches.push({
      id: souche.id,
      x: centre,
      y: cardTop(souche.y) - AMORCE_SOUCHE * unit,
      cote: coteDe(centre),
      pousse: seveGlobale,
      amorce: AMORCE_SOUCHE * unit,
    });
  }

  for (const attache of attaches) {
    const etat = etats.get(attache.id);
    if (!etat || etat === 'rameau-nu') continue;

    quelquechose = true;

    /*
     * L'amorce se trace AVANT la feuille, et ne suit pas son ouverture.
     *
     * Une branche ne rétrécit pas parce qu'une feuille pousse dessus. Les
     * lier aurait fait disparaître l'amorce le temps de l'éclosion, puis
     * repousser avec elle — un clignotement, à l'endroit précis qu'on
     * regarde. Elle ne suit que la sève.
     */
    if (attache.amorce > 0) {
      const longueur = attache.amorce * Math.max(0, Math.min(1, attache.pousse));
      if (longueur > 0.5) {
        tiges.moveTo(attache.x, attache.y + longueur);
        tiges.lineTo(attache.x, attache.y);
      }
    }

    /*
     * L'ÉCLOSION.
     *
     * Une feuille ne s'ouvre pas en grandissant : elle se DÉROULE. Elle
     * arrive donc pliée contre sa branche et se redresse — un demi-radian de
     * vrille qui se résorbe, dans le sens de son côté, et le dépassement
     * d'`eclot` par-dessus. Sans cette vrille, ce serait une feuille qu'on
     * agrandit, ce qui ne ressemble à rien de vivant.
     *
     * `brut` et non la valeur adoucie : `eclot` dépasse un, et une vrille qui
     * dépasse repartirait de l'autre côté.
     */
    const enTrainDEclore = eclosion?.ids.has(attache.id) ?? false;
    const brut = enTrainDEclore ? Math.max(0, Math.min(1, eclosion!.progres)) : 1;
    const ouverture = enTrainDEclore ? eclot(eclosion!.progres) : 1;
    const echelle = Math.min(attache.pousse, ouverture);
    if (echelle <= 0.02) continue;

    // La feuille part de la branche et s'en écarte vers le haut : c'est le
    // sens dans lequel pousse un rameau.
    const angleRepos = attache.cote > 0 ? -0.68 : Math.PI + 0.68;
    const angle = angleRepos + (1 - brut) * 0.62 * attache.cote;
    const taille = 24 * unit * echelle;
    const tige = 5 * unit * echelle;
    const px = repere(attache.x, attache.y, angle);
    const [bx, by] = px(tige, 0);

    petiole(tiges, attache.x, attache.y, angle, tige);
    if (etat === 'feuille') {
      limbe(pleines, bx, by, angle, taille, 0);
      nervure(nervures, bx, by, angle, taille, 0);
    } else if (etat === 'feuille-seche') {
      limbe(seches, bx, by, angle, taille * 0.92, 0.5);
      nervure(nervures, bx, by, angle, taille * 0.92, 0.5);
    } else {
      goutte(bourgeons, bx, by, angle, taille * 0.42);
    }
  }

  if (!quelquechose) return;

  ctx.fillStyle = couleur;
  ctx.strokeStyle = couleur;
  ctx.lineWidth = 1.3 * unit;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  ctx.globalAlpha = 0.85;
  ctx.stroke(tiges);

  /*
   * Le limbe est TRACÉ, pas rempli.
   *
   * Rempli, il devenait un aplat noir de la taille d'une capitale : sur une
   * planche gravée, où tout est trait, c'était la seule masse pleine de la
   * feuille, et elle attirait l'œil plus que les noms. Un botaniste dessine le
   * contour et la nervure, puis laisse le papier.
   */
  ctx.stroke(pleines);
  ctx.globalAlpha = 0.72;
  ctx.stroke(seches);
  ctx.globalAlpha = 0.6;
  ctx.stroke(nervures);
  // Le bourgeon, lui, est plein : c'est ce qui dit qu'il est CLOS.
  ctx.globalAlpha = 0.88;
  ctx.fill(bourgeons);
  ctx.globalAlpha = 1;
}

/**
 * Les traits d'une union, source commune au tracé normal (`traitsDe`) et
 * au calcul de longueur pour son animation d'apparition (`unionPathLength`) :
 * une seule géométrie, jamais deux versions qui pourraient diverger.
 *
 * Dans l'ordre de lecture : le trait d'alliance entre les deux portraits, la
 * descente depuis le couple, le distributeur, puis une descente par enfant.
 */
/**
 * Le trait d'alliance entre les deux conjoints — rien d'autre.
 *
 * Séparé de `unionSegments` pour qu'un divorce puisse le dessiner à part, en
 * pointillé, sans toucher au tracé (plein, continu) de la descente vers les
 * enfants : se séparer ne défait pas la filiation.
 */
function allianceSegment(union: LayoutUnion): Segment | undefined {
  const { partners } = union;
  if (partners.length < 2 || !union.adjacent) return undefined;
  const sorted = [...partners].sort((a, b) => a.x - b.x);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const y = portraitCenterY(Math.min(first.y, last.y));
  return [cardCenterX(first.x), y, cardCenterX(last.x), y];
}

/* ---------------------------------------------------------------------------
 * LA SÈVE
 *
 * Quand on choisit quelqu'un, sa parenté s'encre et le reste s'estompe. Faire
 * apparaître les deux d'un coup donne un changement d'état — vrai, mais mort.
 * Ce qu'on veut voir, c'est l'encre PARTIR de la personne choisie et gagner
 * les branches de proche en proche, comme la sève monte.
 *
 * Deux façons de s'y prendre, et une seule est bonne.
 *
 * Par SAUTS DE GÉNÉRATION : chaque union s'allume un cran après la
 * précédente. C'est simple, et c'est faux — la longueur des branches ne
 * compte plus, si bien qu'un rameau de trente pixels et une descente de trois
 * cents mettent le même temps. L'œil le voit tout de suite : ça ne coule pas,
 * ça clignote en cascade.
 *
 * Par DISTANCE PARCOURUE : le front avance à vitesse constante le long du
 * réseau de traits, exactement comme un liquide dans des veines. Une longue
 * descente met plus longtemps qu'un court rameau, deux branches parties
 * ensemble se séparent puis se rejoignent, et un détour se voit. C'est la
 * seule des deux qui ressemble à quelque chose de vivant, et c'est celle-ci.
 *
 * Le plan se calcule UNE FOIS par sélection (voir `LinkLayer`), pas à chaque
 * image : il ne dépend que de la géométrie, qui ne bouge pas pendant que
 * l'animation court.
 * ------------------------------------------------------------------------- */

/** Ce que le front doit parcourir pour atteindre un trait, et par quel bout. */
export interface ArriveeDeSeve {
  /** Distance à laquelle le front touche ce trait, en unités du monde. */
  depart: number;
  longueur: number;
  /** L'encre entre-t-elle par le début du segment, ou par sa fin ? */
  parLeDebut: boolean;
}

export interface PlanDeSeve {
  /** Par union accentuée, dans l'ordre exact de `unionSegments`. */
  traits: Map<string, Array<ArriveeDeSeve | undefined>>;
  /** La course entière : du départ jusqu'au trait le plus lointain. */
  portee: number;
  /**
   * PAR PERSONNE, LA DISTANCE À LAQUELLE L'ENCRE LA REJOINT.
   *
   * Le plan savait animer des TRAITS ; il ne savait rien dire des gens que
   * ces traits relient. Pour l'ouverture, c'est pourtant la seule question
   * qui compte : un médaillon ne doit pas apparaître avant que la branche qui
   * le porte soit tracée jusqu'à lui, sinon la carte flotte une demi-seconde
   * au bout d'un rameau qui n'existe pas encore.
   *
   * Renseigné seulement quand on passe des ancres — le tracé d'une sélection
   * n'en a pas besoin et ne paie donc pas ce calcul.
   */
  personnes?: Map<string, number>;
}

/** Le point du monde par lequel l'encre rejoint une personne. */
export interface AncreDePersonne {
  id: string;
  x: number;
  y: number;
}

/**
 * Deux pas par unité de monde pour recoller les extrémités.
 *
 * Les segments d'une union partagent leurs extrémités par construction — mais
 * ce sont des nombres flottants, et deux valeurs qui se lisent pareil ne sont
 * pas forcément égales au bit près. Sans arrondi, le réseau se retrouverait
 * coupé en morceaux à chaque embranchement, et la sève n'irait nulle part.
 */
const PAS_GRILLE = 2;

/**
 * Le réseau des branches accentuées, mesuré depuis la personne choisie.
 *
 * `null` s'il n'y a rien à parcourir — une personne seule, sans union.
 */
export function planterLaSeve(
  unions: LayoutUnion[],
  accentuees: Set<string>,
  source: { x: number; y: number },
  /** Où chaque personne accroche le réseau. Voir `personnes` dans le plan. */
  ancres?: AncreDePersonne[],
): PlanDeSeve | null {
  const index = new Map<string, number>();
  const px: number[] = [];
  const py: number[] = [];
  const voisins: Array<Array<{ vers: number; longueur: number }>> = [];

  const noeud = (x: number, y: number): number => {
    const cle = `${Math.round(x * PAS_GRILLE)}:${Math.round(y * PAS_GRILLE)}`;
    const connu = index.get(cle);
    if (connu !== undefined) return connu;
    const n = px.length;
    index.set(cle, n);
    px.push(x);
    py.push(y);
    voisins.push([]);
    return n;
  };

  const inscrits: Array<{
    unionId: string;
    rang: number;
    a: number;
    b: number;
    longueur: number;
  }> = [];

  for (const union of unions) {
    if (!accentuees.has(union.id)) continue;
    // Le MÊME appel que le tracé, sans quoi les rangs ne désigneraient pas
    // les mêmes traits : une union divorcée n'a pas son alliance dans la
    // liste, et tout serait décalé d'un cran pour elle seule.
    unionSegments(union, union.status !== 'divorced').forEach((trait, rang) => {
      const [x1, y1, x2, y2] = trait.seg;
      const longueur = Math.hypot(x2 - x1, y2 - y1);
      if (longueur < 0.01) return;
      const a = noeud(x1, y1);
      const b = noeud(x2, y2);
      voisins[a].push({ vers: b, longueur });
      voisins[b].push({ vers: a, longueur });
      inscrits.push({ unionId: union.id, rang, a, b, longueur });
    });
  }

  if (inscrits.length === 0) return null;

  // Le départ : le point du réseau le plus proche de la personne choisie. La
  // sève part de là où elle est, pas d'une extrémité arbitraire de l'arbre.
  let depart = 0;
  let meilleur = Infinity;
  for (let n = 0; n < px.length; n += 1) {
    const d = (px[n] - source.x) ** 2 + (py[n] - source.y) ** 2;
    if (d < meilleur) {
      meilleur = d;
      depart = n;
    }
  }

  /*
   * Dijkstra, en O(n²) et sans tas.
   *
   * Le réseau compte quelques centaines de nœuds au plus — quatre par union
   * accentuée — et ce calcul n'a lieu qu'une fois par sélection. Un tas
   * binaire ferait gagner des microsecondes sur une opération qui n'a pas
   * lieu pendant l'animation, au prix de trente lignes de plus.
   */
  const dist = new Float64Array(px.length).fill(Infinity);
  const vu = new Uint8Array(px.length);
  dist[depart] = 0;
  for (;;) {
    let u = -1;
    let d = Infinity;
    for (let n = 0; n < dist.length; n += 1) {
      if (!vu[n] && dist[n] < d) {
        d = dist[n];
        u = n;
      }
    }
    if (u < 0) break;
    vu[u] = 1;
    for (const arete of voisins[u]) {
      const candidat = d + arete.longueur;
      if (candidat < dist[arete.vers]) dist[arete.vers] = candidat;
    }
  }

  const traits = new Map<string, Array<ArriveeDeSeve | undefined>>();
  let portee = 0;

  for (const inscrit of inscrits) {
    const da = dist[inscrit.a];
    const db = dist[inscrit.b];
    let arrivee: number;
    let parLeDebut: boolean;

    if (Number.isFinite(da) || Number.isFinite(db)) {
      parLeDebut = da <= db;
      arrivee = Math.min(da, db);
    } else {
      /*
       * Une branche que le réseau n'atteint pas.
       *
       * La famille d'un conjoint, par exemple : elle est accentuée, mais
       * l'union qui l'y rattache ne l'est pas, si bien qu'aucun trait ne mène
       * jusqu'à elle. Elle prend alors son rang à vol d'oiseau — la sève ne
       * l'atteint pas vraiment, mais elle apparaît au moment où le front
       * passe à sa hauteur, ce qui suffit à ne pas la voir surgir.
       */
      const va = Math.hypot(px[inscrit.a] - source.x, py[inscrit.a] - source.y);
      const vb = Math.hypot(px[inscrit.b] - source.x, py[inscrit.b] - source.y);
      parLeDebut = va <= vb;
      arrivee = Math.min(va, vb);
    }

    let liste = traits.get(inscrit.unionId);
    if (!liste) {
      liste = [];
      traits.set(inscrit.unionId, liste);
    }
    liste[inscrit.rang] = { depart: arrivee, longueur: inscrit.longueur, parLeDebut };
    portee = Math.max(portee, arrivee + inscrit.longueur);
  }

  /*
   * L'HEURE D'ARRIVÉE DE CHAQUE PERSONNE.
   *
   * L'ancre d'une personne — le haut de sa carte, là où son rameau la
   * rejoint — est déjà un nœud du réseau par construction : c'est l'extrémité
   * basse de ce rameau. On la retrouve donc par la clé de grille, en O(1), et
   * l'on ne retombe sur un balayage complet que pour les rares ancres qui n'y
   * correspondent à rien — une souche, qui n'a pas de rameau du tout, et dont
   * l'accroche la plus proche est une extrémité de son trait d'alliance.
   */
  let personnes: Map<string, number> | undefined;
  if (ancres && ancres.length > 0) {
    personnes = new Map();
    for (const ancre of ancres) {
      const cle = `${Math.round(ancre.x * PAS_GRILLE)}:${Math.round(ancre.y * PAS_GRILLE)}`;
      let n = index.get(cle);
      if (n === undefined) {
        let meilleure = Infinity;
        for (let k = 0; k < px.length; k += 1) {
          const d = (px[k] - ancre.x) ** 2 + (py[k] - ancre.y) ** 2;
          if (d < meilleure) {
            meilleure = d;
            n = k;
          }
        }
      }
      const d = n === undefined ? Infinity : dist[n];
      // Hors réseau : la personne arrive quand le front passe à sa hauteur,
      // à vol d'oiseau. Même parti que pour les traits inaccessibles.
      personnes.set(
        ancre.id,
        Number.isFinite(d) ? d : Math.hypot(ancre.x - source.x, ancre.y - source.y),
      );
    }
  }

  return { traits, portee, personnes };
}

/**
 * Un trait coupé là où le front en est, entré par l'un ou l'autre bout.
 *
 * Entrer par la fin retourne le segment ET son épaisseur : un trait effilé
 * parcouru à l'envers doit rester effilé du même côté, sinon la branche
 * s'épaissit en s'éloignant du tronc.
 */
function couper(trait: Trait, f: number, parLeDebut: boolean): Trait {
  const [x1, y1, x2, y2] = trait.seg;
  if (parLeDebut) {
    return {
      seg: [x1, y1, x1 + (x2 - x1) * f, y1 + (y2 - y1) * f],
      from: trait.from,
      to: trait.from + (trait.to - trait.from) * f,
      noeud: trait.noeud,
    };
  }
  return {
    seg: [x2, y2, x2 + (x1 - x2) * f, y2 + (y1 - y2) * f],
    from: trait.to,
    to: trait.to + (trait.from - trait.to) * f,
    // Le renflement d'attache est au DÉPART du trait d'origine : en venant de
    // l'autre bout, on ne l'a pas encore atteint. Il revient quand le trait
    // est complet et rendu tel quel.
    noeud: undefined,
  };
}

/*
 * Les épaisseurs, en multiples de l'épaisseur de base.
 *
 * Elles disent la botanique : un arbre est épais au tronc et effilé aux
 * rameaux. Le trait qui descend d'un couple part donc plus gras que celui qui
 * rejoint un enfant, et chaque descente s'amincit vers la carte qu'elle
 * atteint. C'est ce dégradé, plus qu'aucun ornement, qui fait lire un arbre
 * plutôt qu'un organigramme.
 */
const EP_ALLIANCE = 1;
/** Le renflement d'attache, en pixels d'écran. Voir `Trait.noeud`. */
const NOEUD = 0.9;

const EP_DESCENTE_HAUT = 1.4;
const EP_DESCENTE_BAS = 1.05;
const EP_BUS = 1;
const EP_RAMEAU_HAUT = 0.95;
const EP_RAMEAU_BAS = 0.72;

/*
 * LES TRAITS D'UNE UNION, CALCULÉS UNE FOIS PAR DISPOSITION.
 *
 * Ils ne dépendent que de la géométrie, qui ne change pas entre deux
 * redessins — mais on les reconstruisait à chaque image : un tableau et cinq
 * objets par union, pour cent cinquante unions visibles, soixante fois par
 * seconde pendant une montée de sève.
 *
 * Le cache est une `WeakMap` sur l'objet union lui-même : quand la
 * disposition est recalculée, ce sont de NOUVEAUX objets, et l'ancien cache
 * s'efface tout seul. Rien à invalider à la main — donc rien à oublier
 * d'invalider.
 *
 * Deux variantes coexistent, avec ou sans le trait d'alliance : un divorce le
 * dessine à part, en pointillé. On garde donc les deux.
 */
const CACHE_TRAITS = new WeakMap<LayoutUnion, { avec?: Trait[]; sans?: Trait[] }>();

function unionSegments(union: LayoutUnion, includeAlliance = true): Trait[] {
  let entree = CACHE_TRAITS.get(union);
  if (!entree) {
    entree = {};
    CACHE_TRAITS.set(union, entree);
  }
  const cle = includeAlliance ? 'avec' : 'sans';
  const connu = entree[cle];
  if (connu) return connu;
  const calcule = calculerSegments(union, includeAlliance);
  entree[cle] = calcule;
  return calcule;
}

function calculerSegments(union: LayoutUnion, includeAlliance: boolean): Trait[] {
  const { partners, children } = union;
  if (partners.length === 0) return [];

  const segments: Trait[] = [];
  const sorted = [...partners].sort((a, b) => a.x - b.x);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  if (includeAlliance) {
    const alliance = allianceSegment(union);
    // Le trait d'alliance unit deux égaux : il ne s'effile ni d'un côté ni
    // de l'autre.
    if (alliance) segments.push({ seg: alliance, from: EP_ALLIANCE, to: EP_ALLIANCE });
  }

  if (children.length === 0) return segments;

  // Le départ : du milieu du trait d'alliance pour un couple voisin, du bas
  // de la carte sinon — un parent seul, ou un mariage entre deux branches
  // dont les enfants sont rattachés au sous-arbre d'un seul des deux (voir
  // `anchorX` dans `domain/layout.ts` pour le pourquoi).
  const startX = union.anchorX;
  const startY =
    sorted.length > 1 && union.adjacent
      ? portraitCenterY(Math.min(first.y, last.y))
      : cardBottom(first.y);

  let childTop = Number.POSITIVE_INFINITY;
  let leftMost = Number.POSITIVE_INFINITY;
  let rightMost = Number.NEGATIVE_INFINITY;
  for (const child of children) {
    childTop = Math.min(childTop, cardTop(child.y));
    const centre = cardCenterX(child.x);
    leftMost = Math.min(leftMost, centre);
    rightMost = Math.max(rightMost, centre);
  }

  /*
   * Un seul étage de trait suffit.
   *
   * Les familles étaient autrefois réparties sur plusieurs hauteurs, pour que
   * deux traits distributeurs qui se recouvrent ne se confondent pas en une
   * seule ligne. Dans une ascendance, ce recouvrement ne peut plus se produire :
   * chaque couple a sa propre part de la rangée. Mesuré sur la famille
   * Albertini, un seul étage était utilisé sur les vingt-trois unions.
   */
  const busY = childTop - BUS_LIFT;

  // Enfant unique à l'aplomb du couple : un simple trait droit. Le bus n'aurait
  // rien à distribuer, et son coude se lirait comme un détour.
  if (children.length === 1 && Math.abs(leftMost - startX) < 1) {
    segments.push({
      seg: [startX, startY, leftMost, childTop],
      from: EP_DESCENTE_HAUT,
      to: EP_RAMEAU_BAS,
    });
    return segments;
  }

  // La descente depuis le couple : le tronc de cette famille.
  segments.push({
    seg: [startX, startY, startX, busY],
    from: EP_DESCENTE_HAUT,
    to: EP_DESCENTE_BAS,
  });

  // Le distributeur. Il couvre les enfants et rejoint l'aplomb du couple, même
  // quand celui-ci tombe hors de la fratrie — cas d'un enfant unique décalé.
  const busLeft = Math.min(leftMost, startX);
  const busRight = Math.max(rightMost, startX);
  if (busRight - busLeft > 0.5) {
    segments.push({ seg: [busLeft, busY, busRight, busY], from: EP_BUS, to: EP_BUS });
  }

  // Une descente par enfant : un simple trait droit depuis le bus. Aucun
  // coude à arrondir ici — le bus et chaque descente sont deux traits
  // distincts qui se rejoignent au même point, pas un unique chemin continu
  // que `arcTo` pourrait infléchir.
  for (const child of children) {
    const centre = cardCenterX(child.x);
    const top = cardTop(child.y);
    segments.push({
      seg: [centre, busY, centre, top],
      from: EP_RAMEAU_HAUT,
      to: EP_RAMEAU_BAS,
      noeud: NOEUD,
    });
  }

  return segments;
}

/** Tous les traits d'une liste d'unions, prêts à être encrés d'un coup. */
function traitsDe(unions: LayoutUnion[], includeAlliance = true): Trait[] {
  const out: Trait[] = [];
  for (const union of unions) {
    for (const trait of unionSegments(union, includeAlliance)) out.push(trait);
  }
  return out;
}

/** Longueur totale du trait d'une union — voir `growth` dans `DrawLinksParams`. */
function unionPathLength(union: LayoutUnion): number {
  let total = 0;
  for (const { seg } of unionSegments(union)) {
    total += Math.hypot(seg[2] - seg[0], seg[3] - seg[1]);
  }
  return total;
}

