import { call } from './db/client';
import type { DeckSummary } from './db/types';

export const deckStore: { decks: DeckSummary[]; loaded: boolean; error: string | null } = $state({
  decks: [],
  loaded: false,
  error: null,
});

export async function refreshDecks(): Promise<void> {
  try {
    deckStore.decks = await call('deck.list', null);
    deckStore.error = null;
  } catch (e) {
    deckStore.error = e instanceof Error ? e.message : String(e);
  } finally {
    deckStore.loaded = true;
  }
}
