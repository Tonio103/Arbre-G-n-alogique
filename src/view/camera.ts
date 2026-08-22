/*
 * ============================================================================
 *
 *  CAMÉRA ORBITALE ET PROJECTION
 *
 *  Une projection perspective écrite à la main, sur un canevas ordinaire. Pas
 *  de WebGL : la scène ne compte que quelques milliers de segments, et une
 *  matrice de vue tient en vingt lignes. Ce qui coûte cher en trois dimensions,
 *  ce sont les surfaces et les lumières — un arbre en fil de bois n'en a pas.
 *
 *  La caméra tourne autour d'un axe vertical passant par l'arbre. C'est le
 *  seul mouvement qui a du sens ici : on tourne autour d'un arbre, on ne le
 *  survole pas et on ne le traverse pas.
 *
 * ==========================================================================*/

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Camera {
  /** Rotation autour de l'axe vertical, en radians. */
  yaw: number;
  /** Élévation du regard, en radians. Bornée : on ne passe ni au zénith ni sous terre. */
  pitch: number;
  /** Distance de la caméra au point visé. */
  distance: number;
  /** Point visé, sur l'axe de l'arbre. */
  target: Vec3;
  /** Ouverture verticale, en radians. */
  fov: number;
}

export const PITCH_MIN = -0.32;
export const PITCH_MAX = 1.15;
export const DISTANCE_MIN = 2.4;
export const DISTANCE_MAX = 48;

export const clampPitch = (pitch: number): number =>
  Math.min(PITCH_MAX, Math.max(PITCH_MIN, pitch));

export const clampDistance = (distance: number): number =>
  Math.min(DISTANCE_MAX, Math.max(DISTANCE_MIN, distance));

/** Repère de la caméra : sa position et ses trois axes, prêts pour la projection. */
export interface View {
  eye: Vec3;
  right: Vec3;
  up: Vec3;
  forward: Vec3;
  /** Distance focale en pixels, déduite de l'ouverture et de la hauteur du cadre. */
  focal: number;
  width: number;
  height: number;
}

export function makeView(camera: Camera, width: number, height: number): View {
  const cosPitch = Math.cos(camera.pitch);
  const sinPitch = Math.sin(camera.pitch);

  // La caméra est posée sur une sphère centrée sur le point visé.
  const eye: Vec3 = {
    x: camera.target.x + camera.distance * cosPitch * Math.sin(camera.yaw),
    y: camera.target.y + camera.distance * sinPitch,
    z: camera.target.z + camera.distance * cosPitch * Math.cos(camera.yaw),
  };

  const fx = camera.target.x - eye.x;
  const fy = camera.target.y - eye.y;
  const fz = camera.target.z - eye.z;
  const flen = Math.hypot(fx, fy, fz) || 1;
  const forward: Vec3 = { x: fx / flen, y: fy / flen, z: fz / flen };

  // Droite = avant ∧ vertical, dans cet ordre. L'inverser retourne aussi le
  // vecteur « haut », qui en découle — et toute la scène se peint la tête en
  // bas, sans que rien d'autre ne paraisse anormal. Le produit ne dégénère
  // jamais car le tangage est borné bien avant la verticale.
  const rx = -forward.z;
  const rz = forward.x;
  const rlen = Math.hypot(rx, rz) || 1;
  const right: Vec3 = { x: rx / rlen, y: 0, z: rz / rlen };

  // Haut = droite ∧ avant.
  const up: Vec3 = {
    x: right.y * forward.z - right.z * forward.y,
    y: right.z * forward.x - right.x * forward.z,
    z: right.x * forward.y - right.y * forward.x,
  };

  return {
    eye,
    right,
    up,
    forward,
    focal: height / 2 / Math.tan(camera.fov / 2),
    width,
    height,
  };
}

export interface Projected {
  x: number;
  y: number;
  /** Profondeur devant la caméra, en unités de monde. */
  depth: number;
  /** Facteur de réduction perspective : une longueur de monde × ce facteur = des pixels. */
  scale: number;
}

/** Plan de coupe avant : ce qui est derrière l'œil ne se projette pas. */
const NEAR = 0.05;

export function project(view: View, p: Vec3): Projected | null {
  const vx = p.x - view.eye.x;
  const vy = p.y - view.eye.y;
  const vz = p.z - view.eye.z;

  const depth = vx * view.forward.x + vy * view.forward.y + vz * view.forward.z;
  if (depth <= NEAR) return null;

  const sx = vx * view.right.x + vy * view.right.y + vz * view.right.z;
  const sy = vx * view.up.x + vy * view.up.y + vz * view.up.z;
  const scale = view.focal / depth;

  return {
    x: view.width / 2 + sx * scale,
    y: view.height / 2 - sy * scale,
    depth,
    scale,
  };
}

/**
 * Projette un point même s'il passe derrière la caméra, en le ramenant juste
 * devant le plan de coupe.
 *
 * Une branche dont une seule extrémité est derrière l'œil doit rester
 * dessinée : la couper net ferait clignoter des morceaux de bois dès qu'on
 * approche. On rapproche donc le point fautif de l'autre extrémité jusqu'à ce
 * qu'il repasse devant — le segment reste continu, et sa partie visible est
 * juste.
 */
export function projectSegment(
  view: View,
  a: Vec3,
  b: Vec3,
): { a: Projected; b: Projected } | null {
  const pa = project(view, a);
  const pb = project(view, b);
  if (pa && pb) return { a: pa, b: pb };
  if (!pa && !pb) return null;

  const inside = pa ? a : b;
  const outside = pa ? b : a;

  const dx = outside.x - inside.x;
  const dy = outside.y - inside.y;
  const dz = outside.z - inside.z;
  const dDepth = dx * view.forward.x + dy * view.forward.y + dz * view.forward.z;
  const insideDepth = (pa ?? pb)!.depth;
  if (dDepth === 0) return null;

  // Fraction du segment à parcourir pour atteindre le plan de coupe.
  const t = Math.min(0.999, Math.max(0.001, (NEAR - insideDepth) / dDepth));
  const clipped: Vec3 = {
    x: inside.x + dx * t,
    y: inside.y + dy * t,
    z: inside.z + dz * t,
  };
  const pc = project(view, clipped);
  if (!pc) return null;

  return pa ? { a: pa, b: pc } : { a: pc, b: pb! };
}
