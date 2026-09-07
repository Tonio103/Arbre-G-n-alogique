import { useEffect, useMemo, useRef, useState } from 'react';
import type { FamilyGraph } from '@/domain/graph';
import { useGlassScrollSuspend } from '@/hooks/useGlassScrollSuspend';
import { useIsCompact } from '@/hooks/useMediaQuery';
import type { Scope } from '@/domain/scope';
import { buildTimeline, livingIn } from '@/domain/timeline';
import { formatLifespan } from '@/domain/dates';
import { ScopeBar } from './ScopeBar';

export interface TimelineViewProps {
  graph: FamilyGraph;
  focusId: string;
  scope: Scope;
  onScopeChange: (scope: Scope) => void;
  people: Set<string>;
  selectedId: string | null;
  onSelectPerson: (id: string) => void;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * LA TABLE CHRONOLOGIQUE
 *
 * Ce qu'il y avait avant : des pilules grises à coins arrondis, remplies d'un
 * bleu translucide, posées sur un quadrillage complet — un diagramme de Gantt.
 * C'était la seule vue de l'application à n'avoir jamais reçu la planche : un
 * outil de gestion de projet au milieu d'un album gravé.
 *
 * Ce que c'est devenu suit la forme qui a INVENTÉ la frise : la « Chart of
 * Biography » de Joseph Priestley, 1765 — des vies tracées en traits
 * horizontaux sur une règle graduée, et des points là où l'on ne sait pas.
 * C'est une gravure, elle est d'époque, et elle règle au passage un problème
 * qu'on n'avait pas su nommer : une vie n'est pas un intervalle, c'est un
 * TRAIT, et un trait a un début, une fin, et une manière de s'arrêter.
 *
 * Trois choses ont changé sur le fond, pas seulement sur la forme :
 *
 * · LE RANGEMENT. Par génération, plus par année de naissance. Les traits
 *   descendent alors en escalier à travers les siècles ; auparavant un
 *   grand-oncle né tard tombait entre ses propres petits-neveux.
 *
 * · LA FAMILLE. Un fil descend du trait d'un parent, à l'année exacte, vers
 *   le début du trait de son enfant ; deux anneaux joints marquent une union.
 *   Une frise généalogique qui ne montre ni l'un ni l'autre n'est qu'une
 *   liste de durées.
 *
 * · LE TEMPS QUI COURT. Le curseur d'année ne grise plus ce qui est hors
 *   sujet : il n'a pas ENCORE tracé ce qui n'a pas eu lieu. La planche
 *   s'écrit d'elle-même quand on le fait courir.
 * ═══════════════════════════════════════════════════════════════════════════ */

/* ── LES PROPORTIONS DE LA PLANCHE ─────────────────────────────────────
 *
 * DEUX JEUX, et non un seul mis à l'échelle. C'est toute la différence.
 *
 * La planche avait une largeur unique de 1060 unités, et sur téléphone le
 * `viewBox` la ramenait simplement à la largeur disponible. Mesuré à 390 px
 * d'écran : un facteur 0,32, donc des noms rendus à moins de quatre pixels de
 * haut. Une planche illisible n'est pas une planche réduite, c'est une planche
 * perdue.
 *
 * Rétrécir la GÉOMÉTRIE plutôt que le rendu remet les rapports d'aplomb : une
 * gouttière de noms plus courte, moins de marge, une largeur moindre. Les
 * textes sont dimensionnés en unités de `viewBox` — diviser la largeur du
 * repère par deux double donc leur taille apparente, sans toucher à une seule
 * règle de style.
 * ─────────────────────────────────────────────────────────────────────── */

interface Proportions {
  /** Hauteur d'une vie. Serré : c'est un registre, pas un tableau. */
  rowH: number;
  /** Le blanc entre deux générations, où se logent le filet et son titre. */
  genGap: number;
  /** La colonne des noms s'achève ici. */
  left: number;
  /** La gouttière tout à gauche, où se lit le titre de génération. */
  genX: number;
  /** La hauteur du filet porteur de la règle des siècles. */
  ruleY: number;
  /**
   * Où commence le premier registre.
   *
   * Assez bas pour que son titre et son filet tiennent SOUS la règle des
   * siècles, dont les millésimes se composent juste au-dessus de `ruleY`.
   */
  top: number;
  /** De la place à droite du trait pour les millésimes. */
  rightPad: number;
  width: number;
}

const PLANCHE: Proportions = {
  rowH: 21,
  genGap: 28,
  left: 216,
  genX: 12,
  ruleY: 34,
  top: 64,
  rightPad: 62,
  width: 1060,
};

const PLANCHE_ETROITE: Proportions = {
  rowH: 20,
  genGap: 26,
  left: 150,
  genX: 8,
  ruleY: 32,
  top: 60,
  rightPad: 46,
  width: 620,
};

/** Un pas de graduation lisible, quel que soit l'intervalle couvert. */
function tickStep(years: number): number {
  for (const step of [10, 20, 25, 50, 100]) {
    if (years / step <= 12) return step;
  }
  return 200;
}

/**
 * Le pas des graduations PORTÉES, celles qui reçoivent une date.
 *
 * Une règle graduée ne chiffre pas chacun de ses traits — un double décimètre
 * porte ses centimètres et tait ses millimètres. La frise faisait l'inverse :
 * chaque graduation, quel qu'en fût le pas, portait son millésime et tirait un
 * trait sur toute la hauteur. À treize traits pleins et treize dates, ce n'est
 * plus une règle, c'est un quadrillage de tableur.
 *
 * On cherche donc le multiple du pas le plus FIN qui tienne encore : entre
 * trois dates et sept, la première qui convient en montant. Le demi-siècle et
 * le siècle arrivent naturellement les premiers, puisque c'est ainsi qu'on
 * situe une famille.
 *
 * Les deux bornes ont chacune coûté un essai. Sans plancher, une famille
 * couvrant cinquante ans se retrouvait avec UNE seule date sur toute la
 * règle : le demi-siècle passait le plafond haut la main, et ne graduait plus
 * rien. Puis, à retenir le plus GROS multiple valable plutôt que le plus fin,
 * deux siècles et demi n'obtenaient que trois dates pour onze graduations —
 * une règle qu'on ne peut plus lire sans compter les traits. Vérifié sur huit
 * étendues, de quarante à huit cents ans.
 */
function labelStep(step: number, span: number): number {
  for (const gros of [step, 50, 100, 200, 500]) {
    if (gros % step !== 0) continue;
    const dates = Math.floor(span / gros) + 1;
    if (dates >= 3 && dates <= 7) return gros;
  }
  return step;
}

/**
 * LE TRAIT D'UNE VIE, TRACÉ À LA PLUME.
 *
 * Pas un « stroke » d'épaisseur constante : le polygone rempli entre deux
 * bords, exactement comme les liens de filiation de l'arbre (voir `plume`
 * dans `view/links.ts`). C'est la seule façon d'obtenir une épaisseur qui
 * varie le long de la course — et c'est ce qui distingue une plume d'un
 * feutre, lequel pose partout la même largeur.
 *
 * Le trait s'effile de la naissance vers le décès. Ce n'est pas une métaphore
 * sur la vieillesse : c'est ce que fait une plume qu'on ne recharge pas, et
 * c'est ce qui donne au registre son sens de lecture — on sait de quel côté
 * le trait a commencé sans avoir besoin d'une flèche.
 *
 * `graine` décale l'ondulation pour que deux traits voisins ne frémissent pas
 * ensemble. Tirée de l'identifiant, donc stable : un trait ondule pareil à
 * chaque rendu, sinon la planche tremblerait à chaque survol.
 */
function traitDeVie(
  x1: number,
  x2: number,
  y: number,
  e1: number,
  e2: number,
  graine: number,
): string {
  const N = 10;
  const haut: string[] = [];
  const bas: string[] = [];
  for (let i = 0; i <= N; i += 1) {
    const t = i / N;
    const x = x1 + (x2 - x1) * t;
    const demi = (e1 + (e2 - e1) * t) / 2;
    // Une ondulation d'un quart de pixel : invisible en tant que telle, mais
    // elle suffit à ce que le trait ne soit pas une règle de tableur.
    const f = Math.sin(t * 6.3 + graine) * 0.24;
    haut.push(`${x.toFixed(1)} ${(y - demi + f).toFixed(1)}`);
    bas.push(`${x.toFixed(1)} ${(y + demi + f).toFixed(1)}`);
  }
  return `M ${haut.join(' L ')} L ${bas.reverse().join(' L ')} Z`;
}

/** Vitesse du défilement automatique, en années par seconde. */
const ANNEES_PAR_SECONDE = 14;

/**
 * La famille dans le temps.
 *
 * Rien n'est inventé. Une personne sans aucune date n'a pas de trait — elle
 * est listée à part. Une vie sans date de décès s'arrête à la dernière année
 * où elle est attestée, et le trait s'y dissout au lieu de trancher.
 */
export function TimelineView({
  graph,
  focusId,
  scope,
  onScopeChange,
  people,
  selectedId,
  onSelectPerson,
}: TimelineViewProps) {
  /* Le même seuil que la feuille de style : les deux décrivent la même
     bascule, et les laisser diverger ferait basculer la géométrie et la mise
     en page à des largeurs différentes. */
  const etroit = useIsCompact();
  const { rowH: ROW_H, genGap: GEN_GAP, left: LEFT, genX: GEN_X, ruleY: RULE_Y, top: TOP, rightPad: RIGHT_PAD, width: WIDTH } =
    etroit ? PLANCHE_ETROITE : PLANCHE;

  const timeline = useMemo(() => buildTimeline(graph, people), [graph, people]);
  const [year, setYear] = useState<number | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const viewRef = useGlassScrollSuspend<HTMLElement>();

  const name = (id: string): string => graph.people.get(id)?.displayName ?? id;

  // Une marge d'une graduation de part et d'autre, pour que les traits
  // extrêmes ne touchent pas le bord.
  const step = tickStep(timeline.to - timeline.from || 1);
  const from = Math.floor(timeline.from / step) * step;
  const to = Math.ceil((timeline.to + 1) / step) * step;

  /*
   * LE DÉFILEMENT DES ANNÉES.
   *
   * À vitesse constante en années par seconde, pas en fraction de la durée
   * totale : deux siècles doivent mettre deux fois plus longtemps qu'un
   * siècle, sinon une famille ancienne défile en accéléré et l'on ne voit
   * plus rien passer. `performance.now()` plutôt qu'un compteur d'images —
   * une image sautée ne doit pas ralentir le temps lui-même.
   */
  /* L'année lue au DÉMARRAGE de la boucle, sans que la boucle en dépende :
     elle change à chaque image, et la relire relancerait l'effet à chaque
     fois depuis une nouvelle origine — le temps n'avancerait plus jamais. */
  const yearRef = useRef(year);
  yearRef.current = year;

  const boucleRef = useRef(0);
  useEffect(() => {
    if (!running) return undefined;
    const depart = performance.now();
    const debut = yearRef.current !== null && yearRef.current < to ? yearRef.current : from;
    const tick = (maintenant: number): void => {
      const ecoule = (maintenant - depart) / 1000;
      const valeur = debut + ecoule * ANNEES_PAR_SECONDE;
      if (valeur >= to) {
        setYear(to);
        setRunning(false);
        return;
      }
      setYear(Math.round(valeur));
      boucleRef.current = requestAnimationFrame(tick);
    };
    boucleRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(boucleRef.current);
  }, [running, from, to]);

  if (timeline.spans.length === 0) {
    return (
      <section className="view view--timeline" aria-label="Chronologie familiale" ref={viewRef}>
        <ScopeBar
          graph={graph}
          focusId={focusId}
          scope={scope}
          onChange={onScopeChange}
          count={people.size}
        />
        <p className="view-empty lg lg--thick">
          Aucune date n’est renseignée dans cette partie de la famille.
          {timeline.undated.length > 0 && ` ${timeline.undated.length} personnes sont sans date.`}
        </p>
      </section>
    );
  }

  const span = Math.max(1, to - from);
  const xOf = (value: number): number => LEFT + ((value - from) / span) * (WIDTH - LEFT - RIGHT_PAD);

  const ticks: number[] = [];
  for (let value = from; value <= to; value += step) ticks.push(value);
  const gros = labelStep(step, span);

  /*
   * LES RANGÉES.
   *
   * Une passe unique qui pose chaque vie à sa hauteur et retient au passage
   * les bornes de chaque registre : la vue en a besoin trois fois — pour la
   * bande de fond, pour l'étiquette de gouttière, et pour tirer les fils de
   * filiation d'une rangée à l'autre. La recalculer trois fois serait aussi
   * juste et trois fois plus difficile à suivre.
   */
  const rangees = new Map<string, number>();
  const registres: Array<{ generation: number; haut: number; bas: number }> = [];
  let curseurY = TOP;
  for (const registre of timeline.registres) {
    const haut = curseurY;
    for (const life of registre.spans) {
      rangees.set(life.personId, curseurY + ROW_H / 2);
      curseurY += ROW_H;
    }
    registres.push({ generation: registre.generation, haut, bas: curseurY });
    curseurY += GEN_GAP;
  }
  const height = Math.max(140, curseurY + 14);

  const alive = year !== null ? livingIn(timeline, year) : [];
  const vivants = new Set(alive.map((s) => s.personId));
  const generationsEnVie = new Set(alive.map((s) => s.generation)).size;

  /** Celui dont on éclaire la parentèle : le survol l'emporte sur la sélection. */
  const enAvant = hoverId ?? selectedId;

  /** Une année est-elle déjà advenue, au regard du curseur ? */
  const advenu = (valeur: number): boolean => year === null || valeur <= year;

  return (
    <section className="view view--timeline" aria-label="Chronologie familiale" ref={viewRef}>
      <ScopeBar
        graph={graph}
        focusId={focusId}
        scope={scope}
        onChange={onScopeChange}
        count={people.size}
      />

      <div className="timeline-tools">
        <button
          type="button"
          className="timeline-play"
          data-running={running || undefined}
          onClick={() => {
            if (running) {
              setRunning(false);
              return;
            }
            if (year === null || year >= to) setYear(from);
            setRunning(true);
          }}
          aria-label={running ? 'Arrêter le défilement des années' : 'Faire courir les années'}
        >
          <span aria-hidden="true">{running ? '❙❙' : '▶'}</span>
        </button>

        <label className="timeline-rule-field">
          <span>Année</span>
          <input
            type="range"
            min={from}
            max={to}
            step={1}
            value={year ?? from}
            onChange={(event) => {
              setRunning(false);
              setYear(Number(event.target.value));
            }}
          />
        </label>

        <strong className="timeline-year">{year ?? '—'}</strong>

        {year !== null ? (
          <p className="timeline-reading">
            {alive.length} en vie
            {generationsEnVie > 1 && ` · ${generationsEnVie} générations ensemble`}
            <button
              type="button"
              className="timeline-clear"
              onClick={() => {
                setRunning(false);
                setYear(null);
              }}
            >
              planche entière
            </button>
          </p>
        ) : (
          <p className="timeline-reading timeline-reading--hint">
            {timeline.spans.length} vies · {timeline.registres.length} générations
          </p>
        )}
      </div>

      <div className="timeline-stage lg lg--thick">
        <svg
          viewBox={`0 0 ${WIDTH} ${height}`}
          className="timeline-svg"
          role="img"
          aria-label={`${timeline.spans.length} vies de ${timeline.from} à ${timeline.to}`}
          onMouseLeave={() => setHoverId(null)}
        >
          {/* ── Les registres de génération ──────────────────────────────
              Un titre, puis un filet d'un bord à l'autre. C'est ce qui fait
              lire un ESCALIER de générations plutôt qu'un peigne de traits —
              et c'est ainsi qu'une table gravée sépare ses sections. */}
          {registres.map((registre) => (
            <g key={registre.generation} className="timeline-registre">
              <text className="timeline-gen" x={GEN_X} y={registre.haut - 13}>
                {`Génération ${registre.generation}`}
              </text>
              <line
                className="timeline-filet"
                x1={GEN_X}
                y1={registre.haut - 7}
                x2={WIDTH - 8}
                y2={registre.haut - 7}
              />
            </g>
          ))}

          {/* ── La règle des siècles ─────────────────────────────────────
              Un filet horizontal, et les graduations qui y pendent : courtes
              et muettes pour le pas courant, longues et chiffrées pour le
              demi-siècle ou le siècle. Seules ces dernières prolongent leur
              trait sur toute la hauteur, et très pâle — un repère qu'on suit
              du regard quand on en a besoin, pas un quadrillage qu'on subit. */}
          <line className="timeline-rule" x1={LEFT} y1={RULE_Y} x2={xOf(to)} y2={RULE_Y} />
          {ticks.map((value) => {
            const porte = value % gros === 0;
            return (
              <g key={value} className="timeline-tick" data-porte={porte || undefined}>
                {porte && (
                  <line
                    className="timeline-guide"
                    x1={xOf(value)}
                    y1={RULE_Y}
                    x2={xOf(value)}
                    y2={height - 12}
                  />
                )}
                <line
                  x1={xOf(value)}
                  y1={RULE_Y}
                  x2={xOf(value)}
                  y2={RULE_Y + (porte ? 10 : 5)}
                />
                {porte && (
                  <text x={xOf(value)} y={RULE_Y - 6}>
                    {value}
                  </text>
                )}
              </g>
            );
          })}

          {/* ── Les fils de filiation ────────────────────────────────────
              Un fil descend du trait du parent, à l'année de naissance de
              l'enfant, jusqu'au début du trait de l'enfant. Très pâles par
              défaut : à quatre-vingt-dix vies, les montrer tous en pleine
              encre ferait un rideau. Ils s'encrent quand on désigne l'une des
              deux personnes — c'est là, et là seulement, qu'on veut les lire. */}
          <g className="timeline-filiations">
            {timeline.filiations.map((filiation) => {
              const yParent = rangees.get(filiation.parentId);
              const yEnfant = rangees.get(filiation.childId);
              if (yParent === undefined || yEnfant === undefined) return null;
              if (!advenu(filiation.year)) return null;
              const x = xOf(filiation.year);
              const vif = enAvant === filiation.parentId || enAvant === filiation.childId;
              return (
                <g
                  key={`${filiation.parentId}>${filiation.childId}`}
                  className="timeline-filiation"
                  data-vif={vif || undefined}
                >
                  <line x1={x} y1={yParent} x2={x} y2={yEnfant} />
                  <circle cx={x} cy={yParent} r={1.7} />
                </g>
              );
            })}
          </g>

          {/* ── Les alliances ────────────────────────────────────────────
              Deux anneaux à la même année, sur les deux traits, joints par un
              montant. Une union rompue garde ses anneaux et pointille son
              montant : le mariage a bien eu lieu, c'est sa suite qui a changé. */}
          <g className="timeline-alliances">
            {timeline.alliances.map((alliance) => {
              const yA = rangees.get(alliance.aId);
              const yB = rangees.get(alliance.bId);
              if (yA === undefined || yB === undefined) return null;
              if (!advenu(alliance.year)) return null;
              const x = xOf(alliance.year);
              const vif = enAvant === alliance.aId || enAvant === alliance.bId;
              return (
                <g
                  key={`${alliance.aId}+${alliance.bId}`}
                  className="timeline-alliance"
                  data-vif={vif || undefined}
                  data-rompue={alliance.rompue || undefined}
                >
                  <line x1={x} y1={yA} x2={x} y2={yB} />
                  <circle cx={x} cy={yA} r={2.6} />
                  <circle cx={x} cy={yB} r={2.6} />
                </g>
              );
            })}
          </g>

          {/* ── Les vies ─────────────────────────────────────────────────── */}
          {timeline.spans.map((life) => {
            const y = rangees.get(life.personId);
            if (y === undefined) return null;
            // Le curseur n'estompe pas ce qui n'a pas eu lieu : il ne l'a pas
            // ENCORE tracé. C'est ce qui fait que la planche s'écrit d'elle-même
            // quand on fait courir les années.
            if (year !== null && life.from > year) return null;
            const finVue = year !== null ? Math.min(life.to, year) : life.to;

            const x1 = xOf(life.from);
            const x2 = Math.max(xOf(finVue), x1 + 2.5);
            const graine = (life.personId.charCodeAt(0) + life.personId.length) % 7;
            const vivant = year === null || vivants.has(life.personId);
            const designe = enAvant === life.personId;
            const acheve = finVue >= life.to;

            return (
              <g
                key={life.personId}
                className="timeline-vie"
                data-selected={life.personId === selectedId || undefined}
                data-designe={designe || undefined}
                data-clos={!vivant || undefined}
                onClick={() => onSelectPerson(life.personId)}
                onMouseEnter={() => setHoverId(life.personId)}
                role="button"
                tabIndex={0}
                onFocus={() => setHoverId(life.personId)}
                onBlur={() => setHoverId(null)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') onSelectPerson(life.personId);
                }}
              >
                <title>
                  {`${name(life.personId)} — ${
                    formatLifespan(
                      life.birthYear ? String(life.birthYear) : undefined,
                      life.deathYear ? String(life.deathYear) : undefined,
                    ) || 'dates partielles'
                  }`}
                </title>

                {/* La zone de préhension : le trait fait trois pixels de haut,
                    et l'on ne vise pas trois pixels à la souris. */}
                <rect
                  className="timeline-prise"
                  x={0}
                  y={y - ROW_H / 2}
                  width={WIDTH}
                  height={ROW_H}
                />

                <text x={LEFT - 14} y={y + 3.5} className="timeline-name">
                  {name(life.personId)}
                </text>

                {/* LA CONDUITE.
                    Une vie née tard commence loin dans la planche : entre son
                    nom et son trait s'ouvrait jusqu'à trois cents pixels de
                    blanc, et l'œil perdait la ligne en chemin. Des points de
                    conduite, comme dans une table des matières gravée — c'est
                    exactement le même problème, et il a la même solution
                    depuis trois siècles. Sous le seuil, le blanc se franchit
                    d'un regard et la conduite ne serait qu'un bruit. */}
                {x1 - LEFT > 26 && (
                  <line className="timeline-conduite" x1={LEFT + 6} y1={y} x2={x1 - 8} y2={y} />
                )}

                {/* Naissance approximative : trois points d'appel qui vont en
                    diminuant, avant le trait. Le graveur n'effaçait pas ce
                    qu'il ignorait, il l'écrivait — « vers 1810 » est une
                    position, pas une certitude, et le pointillé le dit sans
                    avoir besoin d'une note. */}
                {life.approximateBirth &&
                  [5, 10, 15].map((dx, index) => (
                    <circle
                      key={dx}
                      className="timeline-doute"
                      cx={x1 - dx}
                      cy={y}
                      r={1.5 - index * 0.35}
                    />
                  ))}

                {/* Naissance sûre : la plume se pose. */}
                {!life.approximateBirth && life.birthYear !== undefined && (
                  <circle className="timeline-pose" cx={x1} cy={y} r={2.2} />
                )}

                <path
                  className="timeline-encre"
                  d={traitDeVie(x1, x2, y, 3.4, life.open ? 0.6 : 2.2, graine)}
                />

                {/* La fin. Trois manières de s'arrêter, trois notations : le
                    décès daté ferme le trait d'un montant net ; le décès
                    approximatif s'achève en pointillé ; le décès inconnu ne
                    s'achève pas du tout — le trait s'effile et se perd, ce qui
                    est exactement ce qu'on en sait. */}
                {acheve && !life.open && !life.approximateDeath && (
                  <line className="timeline-terme" x1={x2} y1={y - 3.6} x2={x2} y2={y + 3.6} />
                )}
                {acheve &&
                  life.approximateDeath &&
                  [4, 9, 14].map((dx, index) => (
                    <circle
                      key={dx}
                      className="timeline-doute"
                      cx={x2 + dx}
                      cy={y}
                      r={1.5 - index * 0.35}
                    />
                  ))}

                {/* Le point de l'année courante : à 1924, une colonne de points
                    descend la planche, un par personne alors en vie. C'est la
                    réponse à « qui était là », lue d'un seul regard. */}
                {year !== null && vivants.has(life.personId) && (
                  <circle className="timeline-present" cx={xOf(year)} cy={y} r={2.9} />
                )}

                {/*
                  LE MILLÉSIME — OU L'ÂGE, QUAND LE TEMPS COURT.

                  Sur la planche entière, le trait porte ses deux dates. Mais
                  dès qu'on arrête le curseur sur une année, afficher la date de
                  mort de quelqu'un qui est alors bien vivant révèle une suite
                  que la planche vient justement de ne pas encore tracer — et
                  répond à une question qu'on n'a pas posée. Ce qu'on veut lire
                  en 1830, c'est l'âge qu'on avait en 1830.

                  Les morts, eux, gardent leurs deux dates : leur vie est
                  entière, elle est devenue de l'histoire.
                */}
                <text
                  x={x2 + (acheve && life.approximateDeath ? 20 : 8)}
                  y={y + 3.5}
                  className="timeline-years"
                  data-age={(year !== null && vivant && life.birthYear !== undefined) || undefined}
                >
                  {year !== null && vivant && life.birthYear !== undefined
                    ? `${year - life.birthYear} ans`
                    : `${life.birthYear ?? '?'}${
                        life.deathYear ? ` – ${life.deathYear}` : life.open ? ' –' : ''
                      }`}
                </text>
              </g>
            );
          })}

          {/* Le curseur passe par-dessus tout : c'est lui qu'on déplace. */}
          {year !== null && (
            <line
              className="timeline-cursor"
              x1={xOf(year)}
              y1={RULE_Y - 4}
              x2={xOf(year)}
              y2={height - 12}
            />
          )}
        </svg>
      </div>

      <p className="view-note view-note--standalone">
        Le trait d’une vie va de la naissance au décès. Des points d’appel signalent une date
        approximative, un montant net un décès daté ; un trait qui s’effile sans se fermer est une
        vie dont le décès n’est pas connu — elle s’arrête alors à la dernière année attestée par
        les données, jamais à une durée supposée. Les fils verticaux sont les filiations, les
        anneaux les unions.
      </p>

      {timeline.undated.length > 0 && (
        <div className="timeline-undated lg lg--thick">
          <h3>
            {timeline.undated.length} personne{timeline.undated.length > 1 ? 's' : ''} sans aucune
            date
          </h3>
          <p className="view-note">
            Elles n’apparaissent pas sur la frise : leur donner une position reviendrait à inventer
            une date.
          </p>
          <ul>
            {timeline.undated.map((id) => (
              <li key={id}>
                <button type="button" onClick={() => onSelectPerson(id)}>
                  {name(id)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
