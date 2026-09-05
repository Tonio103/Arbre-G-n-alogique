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
  const groups: Array<{ list: LayoutUnion[]; color: string; weight: number }> = hasSelection
    ? [
        {
          list: drawableUnions.filter((union) => !highlighted.has(union.id)),
          color: palette.dim,
          weight: 2.0,
        },
        {
          list: drawableUnions.filter((union) => highlighted.has(union.id)),
          color: palette.strong,
          weight: 3.6,
        },
      ]
    : [{ list: drawableUnions, color: palette.line, weight: 2.6 }];

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

  for (const group of groups) {
    if (group.list.length === 0) continue;
    // Un divorce garde sa descente pleine — se séparer ne défait pas la
    // filiation — mais son trait d'alliance se dessine à part, plus bas.
    const traits: Trait[] = [];
    for (const union of group.list) {
      for (const trait of unionSegments(union, union.status !== 'divorced')) traits.push(trait);
    }
    encrer(ctx, traits, group.color, group.weight * unit, unit);
    if (params.etats) feuiller(ctx, group.list, params.etats, group.color, unit);
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
function fremis(graine: number): (t: number) => number {
  const table: number[] = [];
  let x = graine * 2654435761 % 4294967296;
  for (let i = 0; i < 64; i += 1) {
    x = (x * 1664525 + 1013904223) % 4294967296;
    table.push(x / 4294967296);
  }
  return (t: number): number => {
    const i = Math.floor(t);
    const f = t - i;
    const a = table[((i % 64) + 64) % 64];
    const b = table[((i + 1) % 64 + 64) % 64];
    // Lissage en marche d'escalier adoucie : la dérivée s'annule aux nœuds,
    // donc pas d'angle au passage d'un intervalle à l'autre.
    return a + (b - a) * (f * f * (3 - 2 * f));
  };
}

/** Une graine stable, tirée de la position : le même trait frémit toujours
 *  de la même façon, où qu'on en soit dans le déplacement. */
const graineDe = ([x1, y1]: Segment): number => Math.abs(Math.round(x1 * 7.3 + y1 * 13.1));

/**
 * Le tracé d'un trait à la plume.
 *
 * On ne « strokes » pas une ligne : on REMPLIT la forme comprise entre deux
 * bords décalés de part et d'autre de l'axe. C'est la seule façon de faire
 * varier l'épaisseur le long de la course — et c'est ce qui distingue une
 * plume d'un feutre, qui pose partout la même largeur.
 *
 * `gonfle` sert à la bavure : le même tracé, élargi, très pâle, posé dessous.
 */
function plume(path: Path2D, trait: Trait, base: number, gonfle: number, unit: number): void {
  const [x1, y1, x2, y2] = trait.seg;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 0.01) return;

  const nx = -dy / len;
  const ny = dx / len;
  const bruit = fremis(graineDe(trait.seg));

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
  // Assez de points pour que chaque ondulation soit décrite, pas au point de
  // payer un millier de sommets par union.
  const N = Math.min(24, Math.max(6, Math.round(periodes * 5)));
  const gauche: number[] = [];
  const droite: number[] = [];

  for (let i = 0; i <= N; i += 1) {
    const t = i / N;
    const bosse = noeud > 0 ? noeud * unit * Math.exp(-(t / portee) * (t / portee)) : 0;
    const demi = (base * (trait.from + (trait.to - trait.from) * t)) / 2 + gonfle + bosse;
    const ecart = (bruit(t * periodes) - 0.5) * unit * 1.5;
    const px = x1 + dx * t + nx * ecart;
    const py = y1 + dy * t + ny * ecart;
    gauche.push(px + nx * demi, py + ny * demi);
    droite.push(px - nx * demi, py - ny * demi);
  }

  path.moveTo(gauche[0], gauche[1]);
  for (let i = 2; i < gauche.length; i += 2) path.lineTo(gauche[i], gauche[i + 1]);
  for (let i = droite.length - 2; i >= 0; i -= 2) path.lineTo(droite[i], droite[i + 1]);
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
): void {
  if (traits.length === 0) return;

  for (const [gonfle, alpha] of [[2.6, 0.05] as const, [1.1, 0.07] as const]) {
    const bavure = new Path2D();
    for (const trait of traits) plume(bavure, trait, base, gonfle * unit, unit);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = couleur;
    ctx.fill(bavure);
  }

  ctx.globalAlpha = 1;
  const encre = new Path2D();
  for (const trait of traits) plume(encre, trait, base, 0, unit);
  ctx.fillStyle = couleur;
  ctx.fill(encre);
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
function repere(x: number, y: number, angle: number) {
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
function limbe(path: Path2D, x: number, y: number, angle: number, taille: number, creux: number): void {
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
function nervure(path: Path2D, x: number, y: number, angle: number, taille: number, creux: number): void {
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
function petiole(path: Path2D, x: number, y: number, angle: number, longueur: number): void {
  const px = repere(x, y, angle);
  path.moveTo(x, y);
  path.lineTo(...px(longueur, 0));
}

/** La goutte close du bourgeon : courte, large, sans pointe ni nervure. */
function goutte(path: Path2D, x: number, y: number, angle: number, taille: number): void {
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
function feuiller(
  ctx: CanvasRenderingContext2D,
  unions: LayoutUnion[],
  etats: Map<string, EtatBotanique>,
  couleur: string,
  unit: number,
): void {
  const tiges = new Path2D();
  const pleines = new Path2D();
  const seches = new Path2D();
  const nervures = new Path2D();
  const bourgeons = new Path2D();
  let quelquechose = false;

  for (const union of unions) {
    const { partners, children } = union;
    if (partners.length === 0 || children.length === 0) continue;
    const busY = cardTop(children[0].y) - BUS_LIFT;

    for (const child of children) {
      const etat = etats.get(child.id);
      if (!etat || etat === 'rameau-nu') continue;

      const centre = cardCenterX(child.x);
      const haut = cardTop(child.y);
      // Aux deux cinquièmes de la descente : assez bas pour ne pas se perdre
      // dans le nœud d'attache, assez haut pour ne pas toucher la carte.
      const yb = busY + (haut - busY) * 0.42;
      // Le côté alterne selon la position, jamais au hasard : une même branche
      // doit porter sa feuille du même côté à chaque redessin.
      const cote = Math.round(centre) % 2 === 0 ? 1 : -1;
      // La feuille part de la branche et s'en écarte vers le haut : c'est le
      // sens dans lequel pousse un rameau.
      const angle = cote > 0 ? -0.68 : Math.PI + 0.68;
      const taille = 24 * unit;
      const tige = 5 * unit;
      const px = repere(centre, yb, angle);
      const [bx, by] = px(tige, 0);

      quelquechose = true;
      petiole(tiges, centre, yb, angle, tige);
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

function unionSegments(union: LayoutUnion, includeAlliance = true): Trait[] {
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

