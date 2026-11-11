/**
 * In-memory study queue. A card's first answer in the session is persisted;
 * wrong cards are reinserted `gap` places ahead and re-answers are not persisted.
 */
export class StudySession<T extends { id: number }> {
  private readonly gap: number;
  private queue: T[] = [];
  private readonly answeredIds = new Set<number>();

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

  answer(correct: boolean): { card: T; persist: boolean } {
    const card = this.queue.shift();
    if (card === undefined) throw new Error('StudySession: no current card');
    const persist = !this.answeredIds.has(card.id);
    if (persist) this.answeredIds.add(card.id);
    if (!correct) {
      this.queue.splice(Math.min(this.gap, this.queue.length), 0, card);
    }
    return { card, persist };
  }
}
