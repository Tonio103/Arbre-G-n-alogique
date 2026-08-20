type Listener = () => void;

/**
 * Personne survolée, tenue hors de l'état React.
 *
 * Le survol ne doit repeindre que la couche de liens : le faire passer par un
 * `useState` remonterait jusqu'au composant qui rend les cartes et les
 * reconstruirait toutes à chaque mouvement de souris.
 */
export class HoverStore {
  private value: string | null = null;
  private readonly listeners = new Set<Listener>();

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): string | null => this.value;

  set = (id: string | null): void => {
    if (id === this.value) return;
    this.value = id;
    for (const listener of this.listeners) listener();
  };
}
