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
export function useGlassLight(): void {
  useEffect(() => {
    // Sans pointeur fin, il n'y a rien à suivre : la lumière garde sa valeur
    // de repos plutôt que de sauter au gré des contacts tactiles.
    if (!window.matchMedia('(pointer: fine)').matches) return undefined;

    const root = document.documentElement;
    let frame = 0;
    let targetX = 0.5;
    let targetY = 0.28;
    let currentX = 0.5;
    let currentY = 0.28;

    const apply = (): void => {
      frame = 0;

      // Poursuite amortie : le reflet suit le pointeur avec un retard, comme le
      // ferait une source lumineuse réelle sur une surface qu'on incline. Sans
      // cet amortissement, le reflet colle au curseur et paraît accroché à lui.
      currentX += (targetX - currentX) * 0.12;
      currentY += (targetY - currentY) * 0.12;

      // L'angle du dégradé conique se déduit de la position : le point le plus
      // clair de l'arête est celui qui fait face à la lumière.
      const angle = Math.round(
        (Math.atan2(currentY - 0.5, currentX - 0.5) * 180) / Math.PI + 270,
      );

      root.style.setProperty('--lg-light', `${angle}deg`);
      root.style.setProperty('--lg-glare-x', `${(currentX * 100).toFixed(1)}%`);
      root.style.setProperty('--lg-glare-y', `${(currentY * 100).toFixed(1)}%`);

      // Tant que le reflet n'a pas rejoint sa cible, on continue de l'animer.
      if (Math.abs(targetX - currentX) > 0.002 || Math.abs(targetY - currentY) > 0.002) {
        frame = requestAnimationFrame(apply);
      }
    };

    const onPointerMove = (event: PointerEvent): void => {
      targetX = event.clientX / window.innerWidth;
      targetY = event.clientY / window.innerHeight;
      if (!frame) frame = requestAnimationFrame(apply);
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      if (frame) cancelAnimationFrame(frame);
      root.style.removeProperty('--lg-light');
      root.style.removeProperty('--lg-glare-x');
      root.style.removeProperty('--lg-glare-y');
    };
  }, []);
}
