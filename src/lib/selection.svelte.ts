import type { CardQuery, CardSelection } from './db/types';

export type SelectionState =
  | { mode: 'ids'; ids: Set<number> }
  | { mode: 'all'; except: Set<number> };

export interface ClickMods {
  toggle: boolean;
  range: boolean;
}

/** Multi-selection over a paged list. The state object is replaced, never mutated in place. */
export class Selection {
  state: SelectionState = $state.raw({ mode: 'ids', ids: new Set<number>() });
  /** Row index of the last plain or toggle click. */
  anchor: number | null = $state(null);

  has(id: number): boolean {
    const s = this.state;
    return s.mode === 'ids' ? s.ids.has(id) : !s.except.has(id);
  }

  count(total: number): number {
    const s = this.state;
    return s.mode === 'ids' ? s.ids.size : Math.max(0, total - s.except.size);
  }

  click(index: number, idAt: (i: number) => number, mods: ClickMods): void {
    const s = this.state;
    const id = idAt(index);

    if (mods.range && this.anchor !== null) {
      const lo = Math.min(this.anchor, index);
      const hi = Math.max(this.anchor, index);
      if (s.mode === 'all') {
        const except = new Set(s.except);
        for (let i = lo; i <= hi; i++) except.delete(idAt(i));
        this.state = { mode: 'all', except };
      } else {
        const ids = new Set<number>();
        for (let i = lo; i <= hi; i++) ids.add(idAt(i));
        this.state = { mode: 'ids', ids };
      }
      return;
    }

    if (mods.toggle && !mods.range) {
      if (s.mode === 'all') {
        const except = new Set(s.except);
        if (except.has(id)) except.delete(id);
        else except.add(id);
        this.state = { mode: 'all', except };
      } else {
        const ids = new Set(s.ids);
        if (ids.has(id)) ids.delete(id);
        else ids.add(id);
        this.state = { mode: 'ids', ids };
      }
      this.anchor = index;
      return;
    }

    // Plain click (or range with no anchor).
    this.state = { mode: 'ids', ids: new Set([id]) };
    this.anchor = index;
  }

  selectAll(): void {
    this.state = { mode: 'all', except: new Set<number>() };
  }

  clear(): void {
    this.state = { mode: 'ids', ids: new Set<number>() };
    this.anchor = null;
  }

  /** Selection to send to the worker; null when nothing is selected (all mode counts as non-empty). */
  toRequest(query: CardQuery): CardSelection | null {
    const s = this.state;
    if (s.mode === 'ids') return s.ids.size === 0 ? null : { ids: [...s.ids] };
    return {
      query: { deckId: query.deckId, search: query.search, box: query.box },
      exceptIds: [...s.except],
    };
  }
}
