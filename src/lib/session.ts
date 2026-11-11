/**
 * In-memory study queue. A card's first answer in the session is persisted;
 * wrong cards are reinserted `gap` places ahead and re-answers are not persisted.
 */
export class StudySession<T extends { id: number }> {
  private readonly gap: number;
  private queue: T[] = [];
  private readonly answeredIds = new Set<number>();
  private snapshot: { queue: T[]; card: T; persisted: boolean } | null = null;

  constructor(gap = 4) {
    this.gap = gap;
  }

  /** Append newly fetched due cards, skipping any already in the queue. */
  push(cards: T[]): void {
    const inQueue = new Set(this.queue.map((c) => c.id));
    for (const card of cards) {
      if (inQueue.has(card.id)) continue;
      inQueue.add(card.id);
      this.queue.push(card);
    }
  }

  get current(): T | null {
    return this.queue[0] ?? null;
  }

  get pending(): number {
    return this.queue.length;
  }

  get answered(): number {
    return this.answeredIds.size;
  }

  /** The n cards after current. */
  peek(n: number): T[] {
    return this.queue.slice(1, 1 + Math.max(0, n));
  }

  get canUndo(): boolean {
    return this.snapshot !== null;
  }

  answer(correct: boolean): { card: T; persist: boolean } {
    const card = this.queue[0];
    if (card === undefined) throw new Error('StudySession: no current card');
    const persist = !this.answeredIds.has(card.id);
    this.snapshot = { queue: this.queue.slice(), card, persisted: persist };
    this.queue.shift();
    if (persist) this.answeredIds.add(card.id);
    if (!correct) {
      this.queue.splice(Math.min(this.gap, this.queue.length), 0, card);
    }
    return { card, persist };
  }

  /**
   * Revert the last answer (one level). Cards pushed since that answer are kept,
   * appended after the restored queue in their current order.
   */
  undo(): { card: T; persisted: boolean } | null {
    const snap = this.snapshot;
    if (snap === null) return null;
    this.snapshot = null;
    const restored = snap.queue;
    const inRestored = new Set(restored.map((c) => c.id));
    for (const c of this.queue) {
      if (inRestored.has(c.id)) continue;
      inRestored.add(c.id);
      restored.push(c);
    }
    this.queue = restored;
    if (snap.persisted) this.answeredIds.delete(snap.card.id);
    return { card: snap.card, persisted: snap.persisted };
  }
}
