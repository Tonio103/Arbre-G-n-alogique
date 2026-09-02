import { useEffect } from 'react';

/**
 * La lumière qui éclaire tout le verre de l'interface.
 *
 * Une arête dont le reflet ne bouge jamais se lit comme un trait peint. Ce qui
 * fait percevoir une surface, c'est que son reflet se déplace quand le point de
 * vue change : sur un appareil, l'inclinaison s'en charge ; sur un écran, c'est
 * le pointeur qui joue ce rôle.
 *
 * Une seule source pour toute l'application, écrite sur l'élément racine. Deux
 * variables en découlent :
 *
 *   --lg-light    l'angle d'où vient la lumière, qui oriente les arêtes
 *   --lg-glare-*  la position du point lumineux glissant sur les surfaces
 *
 * Toutes les surfaces de verre partagent ces valeurs : c'est cette cohérence
 * qui les fait appartenir au même espace éclairé, plutôt que d'être des
 * panneaux décorés chacun de leur côté.
 */

/** Délai sans geste au bout duquel la lumière reprend sa route toute seule. */
const IDLE_DELAY = 2600;

/**
 * Cadence de la dérive au repos.
 *
 * Chaque écriture des variables invalide le style de toutes les surfaces de
 * verre — et une surface de verre qu'on invalide, c'est un flou d'arrière-plan
 * à refaire. C'est l'opération la plus chère de toute l'interface, et elle ne
 * sert ici qu'à déplacer un reflet de quelques dixièmes de pourcent.
 *
 * Quatre fois par seconde. À la vitesse où cette lumière se promène — un tour
 * complet en plus d'une minute — c'est indiscernable d'un mouvement continu,
 * et c'est quinze fois moins de flous recalculés.
 */
const IDLE_FRAME = 250;

export function useGlassLight(): void {
  useEffect(() => {
    // Sans pointeur fin, il n'y a rien à suivre : la lumière garde sa valeur
    // de repos plutôt que de sauter au gré des contacts tactiles.
    if (!window.matchMedia('(pointer: fine)').matches) return undefined;

    /*
     * Transparence réduite : la lumière ne bouge plus du tout.
     *
     * Sous Windows, cette préférence expose le réglage « Effets de
     * transparence », le plus souvent désactivé parce que la machine n'a pas
     * le GPU pour les porter (voir le repli correspondant dans
     * `liquid-glass.css`). Or le commentaire de `IDLE_FRAME` ci-dessus le dit
     * déjà : chaque écriture de ces trois variables invalide TOUTES les
     * surfaces de verre à la fois. Cinquante médaillons portent chacun un
     * anneau et une plaque dont le dégradé conique lit `--lg-light` : une
     * écriture, c'est plus de cent cinquante éléments à recalculer et
     * repeindre — en continu, pour un reflet qui se déplace de quelques
     * dixièmes de pour cent.
     *
     * Sur une machine qui a déjà dit qu'elle ne voulait pas payer d'effets de
     * composition, faire tourner une boucle d'animation permanente pour un
     * ornement est exactement ce qu'il ne faut pas faire. Les valeurs de repos
     * définies dans `:root` restent en place, et le verre garde son reflet —
     * simplement immobile.
     */
    if (window.matchMedia('(prefers-reduced-transparency: reduce)').matches) return undefined;

    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const root = document.documentElement;
    let frame = 0;
    let targetX = 0.5;
    let targetY = 0.28;
    let currentX = 0.5;
    let currentY = 0.28;

    // Dérive au repos.
    //
    // Le reflet suit le pointeur ; quand celui-ci s'immobilise, tout le verre
    // se fige avec lui et redevient un décor peint. Une source réelle, elle, ne
    // s'arrête jamais tout à fait : un nuage passe, le jour tourne. Après
    // quelques secondes sans geste, la lumière repart donc d'elle-même sur une
    // trajectoire lente dont les deux périodes sont incommensurables — elle ne
    // repasse jamais exactement au même endroit, et rien ne s'y lit comme une
    // boucle.
    let idleSince = performance.now();
    let lastDrift = 0;

    const write = (): void => {
      // L'angle du dégradé conique se déduit de la position : le point le plus
      // clair de l'arête est celui qui fait face à la lumière.
      const angle = Math.round(
        (Math.atan2(currentY - 0.5, currentX - 0.5) * 180) / Math.PI + 270,
      );
      root.style.setProperty('--lg-light', `${angle}deg`);
      root.style.setProperty('--lg-glare-x', `${(currentX * 100).toFixed(1)}%`);
      root.style.setProperty('--lg-glare-y', `${(currentY * 100).toFixed(1)}%`);
    };

    const apply = (now: number): void => {
      frame = requestAnimationFrame(apply);

      const idle = now - idleSince > IDLE_DELAY;
      const settled =
        Math.abs(targetX - currentX) < 0.002 && Math.abs(targetY - currentY) < 0.002;

      if (idle) {
        if (calm) return;
        // À l'arrêt, on ne travaille qu'une image sur quinze.
        if (now - lastDrift < IDLE_FRAME) return;
        lastDrift = now;
        const t = now / 1000;
        targetX = 0.5 + Math.sin(t * 0.083) * 0.3;
        targetY = 0.32 + Math.sin(t * 0.061 + 1.7) * 0.19;
      } else if (settled) {
        // Le pointeur vient de bouger mais le reflet l'a déjà rejoint : rien à
        // écrire, et surtout rien à invalider.
        return;
      }

      // Poursuite amortie : le reflet suit sa cible avec un retard, comme le
      // ferait une source lumineuse réelle sur une surface qu'on incline. Sans
      // cet amortissement, le reflet colle au curseur et paraît accroché à lui.
      // Le suivi du pointeur est vif, la dérive au repos très molle — c'est
      // cette mollesse qui la fait passer pour une lumière du jour plutôt que
      // pour un point qui se déplace.
      const pull = idle ? 0.24 : 0.12;
      currentX += (targetX - currentX) * pull;
      currentY += (targetY - currentY) * pull;
      write();
    };

    const onPointerMove = (event: PointerEvent): void => {
      // Pas de suivi pendant qu'on tient un bouton : déplacer l'arbre bouge le
      // pointeur en continu, et chaque écriture des variables repeint toutes
      // les surfaces de verre à la fois. Le reflet reste donc figé le temps du
      // geste, ce que personne ne regarde puisqu'on suit l'arbre.
      if (event.buttons !== 0) return;

      targetX = event.clientX / window.innerWidth;
      targetY = event.clientY / window.innerHeight;
      idleSince = performance.now();
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    frame = requestAnimationFrame(apply);

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      if (frame) cancelAnimationFrame(frame);
      root.style.removeProperty('--lg-light');
      root.style.removeProperty('--lg-glare-x');
      root.style.removeProperty('--lg-glare-y');
    };
  }, []);
}
