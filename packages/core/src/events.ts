/**
 * Connected WebRTC Core SDK - Type-safe Event Emitter
 * Lightweight, zero-dependency event emitter for browser and headless environments.
 */

export type EventListener = (...args: any[]) => void;
export type EventMap = Record<string, EventListener>;

export class TypedEventEmitter<Events extends object = EventMap> {
  private listeners: Map<keyof Events, Set<EventListener>> = new Map();
  private onceListeners: Map<keyof Events, Set<EventListener>> = new Map();

  /**
   * Register a persistent event listener.
   */
  public on<E extends keyof Events>(
    event: E,
    listener: Events[E] extends EventListener ? Events[E] : EventListener
  ): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener as EventListener);
    return this;
  }

  /**
   * Register a one-time event listener.
   */
  public once<E extends keyof Events>(
    event: E,
    listener: Events[E] extends EventListener ? Events[E] : EventListener
  ): this {
    if (!this.onceListeners.has(event)) {
      this.onceListeners.set(event, new Set());
    }
    this.onceListeners.get(event)!.add(listener as EventListener);
    return this;
  }

  /**
   * Remove an event listener.
   */
  public off<E extends keyof Events>(
    event: E,
    listener: Events[E] extends EventListener ? Events[E] : EventListener
  ): this {
    const regular = this.listeners.get(event);
    if (regular) {
      regular.delete(listener as EventListener);
      if (regular.size === 0) {
        this.listeners.delete(event);
      }
    }

    const once = this.onceListeners.get(event);
    if (once) {
      once.delete(listener as EventListener);
      if (once.size === 0) {
        this.onceListeners.delete(event);
      }
    }

    return this;
  }

  /**
   * Emit an event to all registered listeners.
   */
  public emit<E extends keyof Events>(
    event: E,
    ...args: Events[E] extends (...a: infer A) => any ? A : any[]
  ): boolean {
    let handled = false;

    // Fire regular listeners
    const regular = this.listeners.get(event);
    if (regular && regular.size > 0) {
      handled = true;
      for (const listener of Array.from(regular)) {
        try {
          listener(...args);
        } catch (err) {
          console.error(`Error in event listener for "${String(event)}":`, err);
        }
      }
    }

    // Fire and remove once listeners
    const once = this.onceListeners.get(event);
    if (once && once.size > 0) {
      handled = true;
      const snapshot = Array.from(once);
      this.onceListeners.delete(event);
      for (const listener of snapshot) {
        try {
          listener(...args);
        } catch (err) {
          console.error(`Error in one-time event listener for "${String(event)}":`, err);
        }
      }
    }

    return handled;
  }

  /**
   * Remove all listeners for an event or all events.
   */
  public removeAllListeners(event?: keyof Events): this {
    if (event !== undefined) {
      this.listeners.delete(event);
      this.onceListeners.delete(event);
    } else {
      this.listeners.clear();
      this.onceListeners.clear();
    }
    return this;
  }

  /**
   * Count listeners for an event.
   */
  public listenerCount(event: keyof Events): number {
    const regCount = this.listeners.get(event)?.size ?? 0;
    const onceCount = this.onceListeners.get(event)?.size ?? 0;
    return regCount + onceCount;
  }
}

