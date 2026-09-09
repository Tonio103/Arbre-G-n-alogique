import type { FamilyGraph } from '@/domain/graph';
import type { TreeLayout } from '@/domain/layout';
import type { EtatBotanique } from '@/domain/gaps';
import { drawLinks, goutte, limbe, nervure, petiole, type LinkPalette } from './links';
import { PORTRAIT_RADIUS, cardCenterX, portraitCenterY } from './metrics';
import { formatLifespan } from '@/domain/dates';

import ornementCoin from '@/assets/ornement-coin-1.png';
import ornementCartouche from '@/assets/ornement-cartouche.png';
import ornementFilet from '@/assets/ornement-filet-2.png';

/* ═══════════════════════════════════════════════════════════════════════════
 * LA PLANCHE
 *
 * Tirer l'arbre sur du papier, à la résolution d'une gravure.
 *
 * ── POURQUOI CE N'EST PAS UNE CAPTURE D'ÉCRAN ────────────────────────────
 *
 * Toute la direction artistique de cette application décrit un objet
 * IMPRIMÉ : un papier, une encre, des ornements de coin, un cartouche. Il n'a
 * jamais existé que sur un écran. Une capture d'écran en donnerait quatre-
 * vingt-seize points par pouce et le cadre du navigateur autour ; on ne fait
 * pas encadrer ça.
 *
 * Ce fichier redessine tout, à la taille du papier choisi, avec les mêmes
 * fonctions que l'écran — `drawLinks` en particulier, qui ne demande qu'une
 * densité pour tracer aussi bien à trois cents points par pouce qu'à
 * soixante-douze. Rien n'est agrandi : tout est retracé.
 *
 * ── CE QUE L'ÉCRAN NE SAIT PAS FAIRE, ET QU'IL FAUT REFAIRE ICI ──────────
 *
 * Les médaillons sont du DOM à l'écran — des `<button>` avec leur typographie.
 * Le papier n'a pas de DOM : ils sont donc redessinés au pinceau, cercle,
 * cerne et lettres. C'est le seul endroit de l'application où le dessin d'une
 * carte existe en double, et c'est un coût assumé : l'alternative serait de
 * dessiner l'arbre entier au canevas à l'écran aussi, et de perdre la
 * sélection de texte, l'accessibilité et le survol.
 * ═══════════════════════════════════════════════════════════════════════════ */

export type FormatPapier = 'A4' | 'A3' | 'A2' | 'A1';
export type Orientation = 'portrait' | 'paysage';

/** Millimètres du côté court et du côté long, format par format. */
const MILLIMETRES: Record<FormatPapier, [number, number]> = {
  A4: [210, 297],
  A3: [297, 420],
  A2: [420, 594],
  A1: [594, 841],
};

/**
 * LA RÉSOLUTION, ET SON PLAFOND.
 *
 * Trois cents points par pouce est la résolution d'une impression soignée.
 * Mais un canevas de navigateur a des bornes — au-delà d'environ seize mille
 * pixels de côté, ou de quelques centaines de millions de pixels au total, il
 * ne rend plus rien du tout et ne le dit pas : on obtient un fichier vide.
 *
 * Un A1 à 300 ppp ferait 7016 × 9933, soit soixante-dix millions de pixels —
 * ça passe encore, mais de peu. La densité est donc RAMENÉE quand le compte
 * dépasse le plafond, et l'appelant est prévenu du chiffre réellement obtenu :
 * mieux vaut une planche à 200 ppp dont on connaît la résolution qu'un fichier
 * vide dont on ne comprend pas pourquoi.
 */
const PIXELS_MAX = 80e6;
const COTE_MAX = 16000;

export interface OptionsPlanche {
  graph: FamilyGraph;
  layout: TreeLayout;
  etats: Map<string, EtatBotanique>;
  palette: LinkPalette;
  format: FormatPapier;
  orientation: Orientation;
  /** Points par pouce demandés. La densité réelle peut être moindre. */
  ppp: number;
  /** Le papier, l'encre et les filets, lus sur le thème courant. */
  couleurs: {
    papier: string;
    encre: string;
    encreDouce: string;
    encrePale: string;
    filet: string;
  };
  /** Composer les ornements de coin et le cartouche. */
  ornements: boolean;
  /** Composer la légende des marques botaniques au pied de la planche. */
  legende: boolean;
}

export interface Planche {
  canvas: HTMLCanvasElement;
  largeur: number;
  hauteur: number;
  /** La résolution réellement obtenue, une fois le plafond appliqué. */
  pppReel: number;
}

/** Charge une image, une seule fois par adresse. */
const cache = new Map<string, Promise<HTMLImageElement>>();
function charger(src: string): Promise<HTMLImageElement> {
  const connu = cache.get(src);
  if (connu) return connu;
  const promesse = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
  cache.set(src, promesse);
  return promesse;
}

/**
 * Une image de masque, teintée d'encre.
 *
 * Les ornements sont des PNG en niveaux de gris dont l'application se sert en
 * `mask-image` : l'encre passe là où le fichier est opaque. Un canevas ne
 * connaît pas les masques CSS, mais `source-in` fait exactement la même
 * chose — on dessine le masque, puis on remplit en ne gardant que ce qui est
 * déjà couvert.
 */
function teinter(image: HTMLImageElement, couleur: string, largeur: number): HTMLCanvasElement {
  const hauteur = Math.round((largeur * image.naturalHeight) / image.naturalWidth);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(largeur));
  c.height = Math.max(1, hauteur);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(image, 0, 0, c.width, c.height);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = couleur;
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

/** Le grain du papier : deux réseaux de filets d'un demi-pixel, comme à l'écran. */
function grainer(ctx: CanvasRenderingContext2D, w: number, h: number, unite: number): void {
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = 'rgba(46, 36, 24, 0.035)';
  const pasY = 5 * unite;
  for (let y = 0; y < h; y += pasY) ctx.fillRect(0, y, w, Math.max(1, 0.5 * unite));
  const pasX = 31 * unite;
  for (let x = 0; x < w; x += pasX) ctx.fillRect(x, 0, Math.max(1, 0.5 * unite), h);
  ctx.restore();
}

/**
 * Le tirage.
 *
 * Rendu à part de tout composant : c'est une fonction du graphe et d'un format
 * vers une image, elle n'a besoin ni d'état ni de cycle de vie. La fenêtre de
 * dialogue qui l'appelle peut donc n'être qu'un formulaire.
 */
export async function graverLaPlanche(options: OptionsPlanche): Promise<Planche> {
  const { graph, layout, etats, palette, couleurs } = options;

  /* Les fontes doivent être chargées AVANT de composer : un canevas qui écrit
     avec une fonte pas encore arrivée retombe silencieusement sur la fonte
     système, et l'on obtient une planche en sans-serif sans savoir pourquoi. */
  if (document.fonts?.ready) await document.fonts.ready;

  const [court, long] = MILLIMETRES[options.format];
  const mmLarge = options.orientation === 'paysage' ? long : court;
  const mmHaut = options.orientation === 'paysage' ? court : long;

  let ppp = options.ppp;
  const pixels = (d: number) => ((mmLarge / 25.4) * d) * ((mmHaut / 25.4) * d);
  const cote = (d: number) => Math.max((mmLarge / 25.4) * d, (mmHaut / 25.4) * d);
  while (ppp > 72 && (pixels(ppp) > PIXELS_MAX || cote(ppp) > COTE_MAX)) ppp -= 25;

  const largeur = Math.round((mmLarge / 25.4) * ppp);
  const hauteur = Math.round((mmHaut / 25.4) * ppp);

  const canvas = document.createElement('canvas');
  canvas.width = largeur;
  canvas.height = hauteur;
  const ctx = canvas.getContext('2d')!;

  /* L'unité de composition : un point à 72 ppp. Toutes les tailles de la
     planche s'expriment en points, jamais en pixels — c'est ce qui fait
     qu'un A4 à 150 ppp et un A2 à 300 ppp portent la MÊME mise en page, à
     l'échelle près, et non deux mises en page différentes. */
  const pt = ppp / 72;

  ctx.fillStyle = couleurs.papier;
  ctx.fillRect(0, 0, largeur, hauteur);
  grainer(ctx, largeur, hauteur, pt);

  /*
   * LA MARGE.
   *
   * Généreuse, et sur le modèle du livre : la marge de pied est la plus
   * grande, celle de tête vient ensuite, les marges latérales sont les plus
   * étroites. Une planche à marges égales des quatre côtés paraît toujours
   * tomber vers le bas — c'est un fait de perception, connu des typographes
   * bien avant qu'on sache l'expliquer, et c'est la raison pour laquelle on ne
   * centre jamais un cadre optiquement au milieu de sa page.
   */
  const margeCote = Math.round(mmLarge * 0.075 * (ppp / 25.4));
  const margeHaut = Math.round(mmHaut * 0.062 * (ppp / 25.4));
  const margePied = Math.round(mmHaut * 0.092 * (ppp / 25.4));

  // Le filet d'encadrement.
  ctx.strokeStyle = couleurs.filet;
  ctx.lineWidth = Math.max(1, 1.1 * pt);
  ctx.strokeRect(
    margeCote,
    margeHaut,
    largeur - margeCote * 2,
    hauteur - margeHaut - margePied,
  );

  // ── Le cartouche et son titre ────────────────────────────────────────────
  let hautDuChamp = margeHaut + 26 * pt;
  if (options.ornements) {
    const image = await charger(ornementCartouche);
    /*
     * LE CARTOUCHE EST BORNÉ EN HAUTEUR, pas seulement en largeur.
     *
     * À 46 % de la largeur, il occupait le quart supérieur de la page — plus
     * de place que l'arbre lui-même sur un format en largeur. Un cartouche est
     * une enseigne, pas un sujet. Sa hauteur est donc plafonnée à un huitième
     * de la page, et sa largeur en découle : c'est le rapport de l'image qui
     * décide, pas un chiffre posé au jugé.
     */
    const rapport = image.naturalHeight / image.naturalWidth;
    const largeurCartouche = Math.min(
      largeur * 0.36,
      380 * pt,
      (hauteur * 0.125) / rapport,
    );
    const teinte = teinter(image, couleurs.encrePale, largeurCartouche);
    const x = (largeur - teinte.width) / 2;
    const y = margeHaut + 12 * pt;
    ctx.drawImage(teinte, x, y);

    /* Le titre se pose dans la RÉSERVE du cartouche — l'ovale clair au
       milieu de la gravure — jamais sur la gravure elle-même. Les proportions
       de l'ouverture ont été mesurées sur l'image : 18,8 % à 81 % en largeur,
       27,5 % à 79 % en hauteur. */
    const oxy = { x: x + teinte.width * 0.188, y: y + teinte.height * 0.275 };
    const olarge = teinte.width * (0.81 - 0.188);
    const ohaut = teinte.height * (0.79 - 0.275);

    ctx.save();
    ctx.fillStyle = couleurs.encre;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let corps = 30 * pt;
    ctx.font = `500 ${corps}px "Cormorant Garamond", Georgia, serif`;
    while (ctx.measureText(graph.title).width > olarge * 0.82 && corps > 9 * pt) {
      corps -= pt;
      ctx.font = `500 ${corps}px "Cormorant Garamond", Georgia, serif`;
    }
    ctx.fillText(graph.title, oxy.x + olarge / 2, oxy.y + ohaut / 2);
    ctx.restore();

    hautDuChamp = y + teinte.height + 16 * pt;
  } else {
    ctx.save();
    ctx.fillStyle = couleurs.encre;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `500 ${30 * pt}px "Cormorant Garamond", Georgia, serif`;
    ctx.fillText(graph.title, largeur / 2, margeHaut + 18 * pt);
    ctx.restore();
    hautDuChamp = margeHaut + 64 * pt;
  }

  // ── Les ornements de coin ────────────────────────────────────────────────
  if (options.ornements) {
    const image = await charger(ornementCoin);
    const taille = Math.min(largeur, hauteur) * 0.11;
    const teinte = teinter(image, couleurs.encrePale, taille);
    const poser = (x: number, y: number, sx: number, sy: number): void => {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(sx, sy);
      ctx.drawImage(teinte, 0, 0);
      ctx.restore();
    };
    const m = 6 * pt;
    poser(margeCote + m, margeHaut + m, 1, 1);
    poser(largeur - margeCote - m, margeHaut + m, -1, 1);
    poser(margeCote + m, hauteur - margePied - m, 1, -1);
    poser(largeur - margeCote - m, hauteur - margePied - m, -1, -1);
  }

  // ── La légende, au pied ──────────────────────────────────────────────────
  let basDuChamp = hauteur - margePied - 22 * pt;
  if (options.legende) {
    basDuChamp = hauteur - margePied - 74 * pt;
    dessinerLegende(ctx, {
      x: margeCote + 30 * pt,
      y: hauteur - margePied - 58 * pt,
      largeur: largeur - margeCote * 2 - 60 * pt,
      pt,
      couleurs,
    });
  }

  // ── L'arbre ──────────────────────────────────────────────────────────────
  const champLarge = largeur - margeCote * 2 - 44 * pt;
  const champHaut = basDuChamp - hautDuChamp;
  const arbreLarge = Math.max(1, layout.bounds.maxX - layout.bounds.minX);
  const arbreHaut = Math.max(1, layout.bounds.maxY - layout.bounds.minY);
  const densite = Math.min(champLarge / arbreLarge, champHaut / arbreHaut);


  /*
   * `drawLinks` pose SA propre transformation, calculée depuis `worldRect` :
   * le coin haut-gauche de la zone du monde tombe sur le pixel (0, 0) du
   * tampon. On le laisse donc travailler sur un canevas à lui, exactement
   * dimensionné, puis on reporte ce canevas à sa place sur la planche. C'est
   * plus simple et surtout plus sûr que de lui faire croire à une origine
   * décalée — il n'a aucune raison de connaître la mise en page d'une feuille.
   */
  /*
   * LES BANDES DE GÉNÉRATION VONT D'UN BORD À L'AUTRE.
   *
   * `drawLinks` peint ses bandes sur toute la largeur de la zone du monde
   * qu'on lui donne. À l'écran, cette zone est le cadre visible : les bandes
   * traversent l'écran, et l'œil garde sa ligne en se déplaçant. En donnant
   * ici la stricte étendue de l'arbre, elles s'arrêtaient net à sa boîte —
   * quatre rubans gris posés en travers d'une planche, vérifiés à l'écran.
   *
   * Le calque couvre donc tout le CHAMP, et non l'arbre : l'étendue du monde
   * est élargie de part et d'autre de ce qu'il faut pour que les bandes
   * atteignent le filet d'encadrement.
   */
  const champHautPx = Math.max(1, Math.round(champHaut));
  const champLargePx = Math.max(1, Math.round(champLarge));
  const debordX = (champLarge / densite - arbreLarge) / 2;
  const debordY = (champHaut / densite - arbreHaut) / 2;

  const calque = document.createElement('canvas');
  calque.width = champLargePx;
  calque.height = champHautPx;
  const cctx = calque.getContext('2d')!;
  drawLinks(cctx, {
    unions: layout.unions,
    rows: layout.rows,
    worldRect: {
      left: layout.bounds.minX - debordX,
      top: layout.bounds.minY - debordY,
      right: layout.bounds.maxX + debordX,
      bottom: layout.bounds.maxY + debordY,
    },
    density: densite,
    dpr: 1,
    palette,
    highlighted: new Set(),
    hasSelection: false,
    etats,
    souches: souchesDe(layout),
  });
  ctx.drawImage(calque, margeCote + 22 * pt, hautDuChamp);

  // ── Les médaillons ───────────────────────────────────────────────────────
  ctx.save();
  ctx.translate(
    margeCote + 22 * pt - (layout.bounds.minX - debordX) * densite,
    hautDuChamp - (layout.bounds.minY - debordY) * densite,
  );
  ctx.scale(densite, densite);
  for (const [id, position] of layout.positions) {
    const person = graph.people.get(id);
    if (person) dessinerCarte(ctx, person, position, couleurs, densite);
  }
  ctx.restore();

  // ── Le pied de page ──────────────────────────────────────────────────────
  ctx.save();
  ctx.fillStyle = couleurs.encrePale;
  ctx.font = `italic ${11 * pt}px "Cormorant Garamond", Georgia, serif`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const pied = `${layout.positions.size} personnes · ${layout.rows.length} générations`;
  ctx.fillText(pied, margeCote + 2 * pt, hauteur - margePied + 22 * pt);
  ctx.textAlign = 'right';
  ctx.fillText(
    `Tiré le ${new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}`,
    largeur - margeCote - 2 * pt,
    hauteur - margePied + 22 * pt,
  );
  ctx.restore();

  return { canvas, largeur, hauteur, pppReel: ppp };
}

/** Les personnes que l'arbre place sans qu'elles descendent de personne. */
function souchesDe(layout: TreeLayout) {
  const enfants = new Set<string>();
  for (const union of layout.unions) for (const enfant of union.children) enfants.add(enfant.id);
  const liste: Array<{ id: string; x: number; y: number; accentuee: boolean }> = [];
  for (const [id, position] of layout.positions) {
    if (enfants.has(id)) continue;
    liste.push({ id, x: position.x, y: position.y, accentuee: false });
  }
  return liste;
}

/**
 * Un médaillon, au pinceau.
 *
 * Les tailles sont celles de l'écran (voir `avatar.css` et `node.css`), en
 * unités du MONDE : la transformation posée par l'appelant s'occupe de les
 * porter à l'échelle du papier. Les redéclarer ici en points aurait fait deux
 * mises en page à tenir d'accord.
 */
function dessinerCarte(
  ctx: CanvasRenderingContext2D,
  person: { initials: string; firstName: string; lastName: string; birthDate?: string; deathDate?: string },
  position: { x: number; y: number },
  couleurs: OptionsPlanche['couleurs'],
  densite: number,
): void {
  const cx = cardCenterX(position.x);
  const cy = portraitCenterY(position.y);

  ctx.beginPath();
  ctx.arc(cx, cy, PORTRAIT_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = couleurs.papier;
  ctx.fill();
  // Le cerne est en pixels d'ÉCRAN sur l'arbre ; sur le papier, il doit garder
  // la même épaisseur relative au médaillon, sans quoi un tirage A1 le rendrait
  // filiforme et un A4 pâteux.
  ctx.lineWidth = 1.4 / densite > 0.9 ? 1.4 / densite : 0.9;
  ctx.strokeStyle = couleurs.encre;
  ctx.stroke();

  ctx.fillStyle = couleurs.encre;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${PORTRAIT_RADIUS * 0.72}px "Cormorant Garamond", Georgia, serif`;
  ctx.fillText(person.initials, cx, cy + PORTRAIT_RADIUS * 0.02);

  const basPortrait = cy + PORTRAIT_RADIUS;
  ctx.textBaseline = 'top';
  ctx.font = `600 13px "Cormorant Garamond", Georgia, serif`;
  ctx.fillText(person.firstName, cx, basPortrait + 7);

  ctx.fillStyle = couleurs.encreDouce;
  ctx.font = `500 10.5px "Cormorant Garamond", Georgia, serif`;
  ctx.fillText(person.lastName, cx, basPortrait + 22);

  const vie = formatLifespan(person.birthDate, person.deathDate);
  if (vie) {
    ctx.font = `italic 10px "Cormorant Garamond", Georgia, serif`;
    ctx.fillText(vie, cx, basPortrait + 36);
  }
}

/**
 * LA LÉGENDE DES MARQUES.
 *
 * Les feuilles de l'arbre disent l'état de chaque fiche. À l'écran, une
 * infobulle l'explique ; sur du papier, il n'y a personne à qui demander. Une
 * planche d'herbier a toujours porté sa légende, et c'est ce qui la distingue
 * d'une illustration.
 *
 * Les marques sont tracées par les MÊMES fonctions que les branches — pas
 * redessinées à l'approchant. Une légende qui ne montrerait pas exactement le
 * signe qu'elle explique ne servirait à rien.
 */
function dessinerLegende(
  ctx: CanvasRenderingContext2D,
  o: {
    x: number;
    y: number;
    largeur: number;
    pt: number;
    couleurs: OptionsPlanche['couleurs'];
  },
): void {
  const { pt, couleurs } = o;
  const entrees: Array<{ etat: EtatBotanique; dit: string }> = [
    { etat: 'feuille', dit: 'fiche renseignée' },
    { etat: 'feuille-seche', dit: 'renseignée, personne décédée' },
    { etat: 'bourgeon', dit: 'fiche à compléter' },
    { etat: 'rameau-nu', dit: 'rien de renseigné' },
  ];

  ctx.save();
  ctx.strokeStyle = couleurs.filet;
  ctx.lineWidth = Math.max(1, 0.8 * pt);
  ctx.beginPath();
  ctx.moveTo(o.x, o.y - 14 * pt);
  ctx.lineTo(o.x + o.largeur, o.y - 14 * pt);
  ctx.stroke();

  const pas = o.largeur / entrees.length;
  const taille = 15 * pt;

  entrees.forEach((entree, index) => {
    const x = o.x + pas * index + 10 * pt;
    const y = o.y + 16 * pt;

    const tiges = new Path2D();
    const pleines = new Path2D();
    const seches = new Path2D();
    const nervures = new Path2D();
    const bourgeons = new Path2D();

    if (entree.etat === 'rameau-nu') {
      // Un rameau nu, c'est justement l'absence de marque : on montre la
      // branche seule, sinon l'entrée n'aurait rien à montrer.
      tiges.moveTo(x, y + 8 * pt);
      tiges.lineTo(x, y - 8 * pt);
    } else {
      const angle = -0.68;
      petiole(tiges, x, y, angle, 4 * pt);
      const bx = x + Math.cos(angle) * 4 * pt;
      const by = y + Math.sin(angle) * 4 * pt;
      if (entree.etat === 'feuille') {
        limbe(pleines, bx, by, angle, taille, 0);
        nervure(nervures, bx, by, angle, taille, 0);
      } else if (entree.etat === 'feuille-seche') {
        limbe(seches, bx, by, angle, taille * 0.92, 0.5);
        nervure(nervures, bx, by, angle, taille * 0.92, 0.5);
      } else {
        goutte(bourgeons, bx, by, angle, taille * 0.42);
      }
    }

    ctx.strokeStyle = couleurs.encre;
    ctx.lineWidth = Math.max(1, 1.3 * pt);
    ctx.lineCap = 'round';
    ctx.stroke(tiges);
    ctx.fillStyle = couleurs.encre;
    ctx.fill(pleines);
    ctx.fill(bourgeons);
    ctx.globalAlpha = 0.4;
    ctx.fill(seches);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = couleurs.papier;
    ctx.lineWidth = Math.max(1, 0.7 * pt);
    ctx.stroke(nervures);

    ctx.fillStyle = couleurs.encreDouce;
    ctx.font = `italic ${10.5 * pt}px "Cormorant Garamond", Georgia, serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(entree.dit, x + 20 * pt, y);
  });

  ctx.restore();
}

/** Le filet de séparation, pour qui veut composer une planche à la main. */
export const ORNEMENT_FILET = ornementFilet;
