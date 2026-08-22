/** Jeu d'icônes minimal, tracé à la main pour rester net à 20 px. */

const base = {
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export const HomeIcon = () => (
  <svg {...base}>
    <path d="M3.4 8.6 10 3.2l6.6 5.4" />
    <path d="M5 8v8.2h10V8" />
    <path d="M8.2 16.2v-4.1h3.6v4.1" />
  </svg>
);

export const FitIcon = () => (
  <svg {...base}>
    <path d="M3.2 7.2V3.6h3.6" />
    <path d="M16.8 7.2V3.6h-3.6" />
    <path d="M3.2 12.8v3.6h3.6" />
    <path d="M16.8 12.8v3.6h-3.6" />
  </svg>
);

export const PlusIcon = () => (
  <svg {...base}>
    <path d="M10 4.6v10.8M4.6 10h10.8" />
  </svg>
);

export const MinusIcon = () => (
  <svg {...base}>
    <path d="M4.6 10h10.8" />
  </svg>
);

export const BranchIcon = () => (
  <svg {...base}>
    <circle cx="10" cy="4.4" r="1.9" />
    <circle cx="5" cy="15.6" r="1.9" />
    <circle cx="15" cy="15.6" r="1.9" />
    <path d="M10 6.3v3.3M5 13.7v-1.8h10v1.8" />
  </svg>
);

export const SunIcon = () => (
  <svg {...base}>
    <circle cx="10" cy="10" r="3.6" />
    <path d="M10 2.6v1.8M10 15.6v1.8M2.6 10h1.8M15.6 10h1.8M4.8 4.8l1.3 1.3M13.9 13.9l1.3 1.3M15.2 4.8l-1.3 1.3M6.1 13.9l-1.3 1.3" />
  </svg>
);

export const MoonIcon = () => (
  <svg {...base}>
    <path d="M15.6 11.8A6.2 6.2 0 0 1 8.2 4.4a6.4 6.4 0 1 0 7.4 7.4Z" />
  </svg>
);

export const MapIcon = () => (
  <svg {...base}>
    <path d="M3.4 5.6 7.6 4l4.8 2 3.8-1.5v9.9L12.4 16l-4.8-2-4.2 1.6z" />
    <path d="M7.6 4v10M12.4 6v10" />
  </svg>
);

export const ImportIcon = () => (
  <svg {...base}>
    <path d="M10 3v9M6.5 8.5 10 12l3.5-3.5" />
    <path d="M4 13.6V16.4h12V13.6" />
  </svg>
);

export const CloseIcon = () => (
  <svg {...base}>
    <path d="M5.4 5.4 14.6 14.6M14.6 5.4 5.4 14.6" />
  </svg>
);

export const ChevronIcon = () => (
  <svg {...base}>
    <path d="M7.6 4.8 12.8 10l-5.2 5.2" />
  </svg>
);

export const PeopleIcon = () => (
  <svg {...base}>
    <circle cx="7.6" cy="7.4" r="2.7" />
    <path d="M3.2 16.4c0-2.4 2-4.1 4.4-4.1s4.4 1.7 4.4 4.1" />
    <path d="M13.2 5.2a2.7 2.7 0 0 1 0 5.2M14.4 12.6c1.6.5 2.7 1.9 2.7 3.8" />
  </svg>
);

export const HelpIcon = () => (
  <svg {...base}>
    <circle cx="10" cy="10" r="7" />
    <path d="M8.1 8a2 2 0 1 1 2.6 1.9c-.5.2-.7.6-.7 1.1v.5" />
    <path d="M10 14.2h.01" strokeWidth="2" />
  </svg>
);

/**
 * Le point de repère : une épingle.
 *
 * Le seul objet dont le geste — planter quelque chose quelque part pour ne
 * plus le perdre — dise exactement ce que fait ce bouton.
 */
export function PinIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="icon">
      <path
        d="M10 2.6c2.5 0 4.5 2 4.5 4.5 0 3.2-4.5 8.3-4.5 8.3S5.5 10.3 5.5 7.1c0-2.5 2-4.5 4.5-4.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="7.1" r="1.7" fill="currentColor" />
    </svg>
  );
}
