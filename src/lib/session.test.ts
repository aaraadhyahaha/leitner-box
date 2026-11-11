import { describe, expect, it } from 'vitest';
import { StudySession } from './session';

type C = { id: number };
const cards = (...ids: number[]): C[] => ids.map((id) => ({ id }));
const ids = (s: StudySession<C>): number[] => {
  const head = s.current;
  return head ? [head.id, ...s.peek(s.pending).map((c) => c.id)] : [];
};

describe('StudySession', () => {
  it('starts empty and throws on answer', () => {
    const s = new StudySession<C>();
    expect(s.current).toBeNull();
    expect(s.pending).toBe(0);
    expect(s.answered).toBe(0);
    expect(() => s.answer(true)).toThrow();
  });

  it('push appends and skips ids already queued', () => {
    const s = new StudySession<C>();
    s.push(cards(1, 2, 3));
    s.push(cards(3, 4, 4));
    expect(ids(s)).toEqual([1, 2, 3, 4]);
    expect(s.peek(2).map((c) => c.id)).toEqual([2, 3]);
    expect(s.peek(0)).toEqual([]);
  });

  it('correct answers drop cards and persist', () => {
    const s = new StudySession<C>();
    s.push(cards(1, 2));
    expect(s.answer(true)).toEqual({ card: { id: 1 }, persist: true });
    expect(s.answer(true)).toEqual({ card: { id: 2 }, persist: true });
    expect(s.pending).toBe(0);
    expect(s.answered).toBe(2);
  });

  it('a wrong card returns after 4 others', () => {
    const s = new StudySession<C>();
    s.push(cards(1, 2, 3, 4, 5, 6));
    expect(s.answer(false).persist).toBe(true);
    expect(ids(s)).toEqual([2, 3, 4, 5, 1, 6]);
    for (let i = 0; i < 4; i++) s.answer(true);
    expect(s.current?.id).toBe(1);
  });

  it('a wrong card in a short queue returns last', () => {
    const s = new StudySession<C>();
    s.push(cards(1, 2, 3));
    s.answer(false);
    expect(ids(s)).toEqual([2, 3, 1]);
  });

  it('a wrong card alone returns immediately', () => {
    const s = new StudySession<C>();
    s.push(cards(1));
    s.answer(false);
    expect(ids(s)).toEqual([1]);
  });

  it('repeat answers are not persisted; right drops the reinsert', () => {
    const s = new StudySession<C>();
    s.push(cards(1, 2));
    expect(s.answer(false)).toEqual({ card: { id: 1 }, persist: true });
    expect(s.answer(true)).toEqual({ card: { id: 2 }, persist: true });
    expect(s.answer(true)).toEqual({ card: { id: 1 }, persist: false });
    expect(s.pending).toBe(0);
    expect(s.answered).toBe(2);
  });

  it('a twice-wrong card returns twice', () => {
    const s = new StudySession<C>();
    s.push(cards(1, 2));
    const seen: Array<[number, boolean]> = [];
    const log = (correct: boolean) => {
      const r = s.answer(correct);
      seen.push([r.card.id, r.persist]);
    };
    log(false); // 1 wrong -> [2, 1]
    log(true); // 2 right -> [1]
    log(false); // 1 wrong again -> [1]
    log(true); // 1 right -> []
    expect(seen).toEqual([
      [1, true],
      [2, true],
      [1, false],
      [1, false],
    ]);
    expect(s.pending).toBe(0);
    expect(s.answered).toBe(2);
  });

  it('respects a custom gap', () => {
    const s = new StudySession<C>(1);
    s.push(cards(1, 2, 3));
    s.answer(false);
    expect(ids(s)).toEqual([2, 1, 3]);
  });

  describe('undo', () => {
    it('returns null and canUndo is false with nothing answered', () => {
      const s = new StudySession<C>();
      s.push(cards(1, 2));
      expect(s.canUndo).toBe(false);
      expect(s.undo()).toBeNull();
    });

    it('undo after a right answer restores the head and answered', () => {
      const s = new StudySession<C>();
      s.push(cards(1, 2, 3));
      s.answer(true);
      expect(s.canUndo).toBe(true);
      expect(s.undo()).toEqual({ card: { id: 1 }, persisted: true });
      expect(ids(s)).toEqual([1, 2, 3]);
      expect(s.answered).toBe(0);
      expect(s.canUndo).toBe(false);
      // Answering again is persisted as a first answer.
      expect(s.answer(true).persist).toBe(true);
    });

    it('undo after a wrong answer removes the reinserted copy', () => {
      const s = new StudySession<C>();
      s.push(cards(1, 2, 3, 4, 5, 6));
      s.answer(false);
      expect(ids(s)).toEqual([2, 3, 4, 5, 1, 6]);
      expect(s.undo()).toEqual({ card: { id: 1 }, persisted: true });
      expect(ids(s)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(s.answered).toBe(0);
    });

    it('undo of a repeat answer is not persisted and keeps answered', () => {
      const s = new StudySession<C>();
      s.push(cards(1, 2));
      s.answer(false); // [2, 1]
      s.answer(true); // [1]
      expect(s.answer(true)).toEqual({ card: { id: 1 }, persist: false }); // []
      expect(s.undo()).toEqual({ card: { id: 1 }, persisted: false });
      expect(ids(s)).toEqual([1]);
      expect(s.answered).toBe(2);
    });

    it('is one level deep: a second undo returns null', () => {
      const s = new StudySession<C>();
      s.push(cards(1, 2, 3));
      s.answer(true);
      s.answer(true);
      expect(s.undo()?.card.id).toBe(2);
      expect(s.canUndo).toBe(false);
      expect(s.undo()).toBeNull();
      expect(ids(s)).toEqual([2, 3]);
      expect(s.answered).toBe(1);
    });

    it('undo from the done state brings the last card back', () => {
      const s = new StudySession<C>();
      s.push(cards(1));
      s.answer(true);
      expect(s.current).toBeNull();
      expect(s.undo()?.card.id).toBe(1);
      expect(s.current?.id).toBe(1);
    });

    it('push leaves the snapshot alone and undo keeps cards pushed since', () => {
      const s = new StudySession<C>();
      s.push(cards(1, 2));
      s.answer(false); // [2, 1]
      s.push(cards(2, 3, 4));
      expect(ids(s)).toEqual([2, 1, 3, 4]);
      expect(s.canUndo).toBe(true);
      expect(s.undo()).toEqual({ card: { id: 1 }, persisted: true });
      expect(ids(s)).toEqual([1, 2, 3, 4]);
    });

    it('canUndo becomes true again after the next answer', () => {
      const s = new StudySession<C>();
      s.push(cards(1, 2));
      s.answer(true);
      s.undo();
      expect(s.canUndo).toBe(false);
      s.answer(true);
      expect(s.canUndo).toBe(true);
    });
  });
});
