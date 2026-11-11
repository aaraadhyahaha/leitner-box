<script lang="ts">
  import { onMount } from 'svelte';
  import Toolbar from './Toolbar.svelte';
  import RichText from '../lib/render/RichText.svelte';
  import { call } from '../lib/db/client';
  import type { Card, DueCursor } from '../lib/db/types';
  import { StudySession } from '../lib/session';
  import { renderToHtml } from '../lib/render/render';
  import { go } from '../lib/router.svelte';
  import { deckStore, refreshDecks } from '../lib/decks.svelte';

  let { deckId }: { deckId: number } = $props();

  const PAGE = 20;
  const LOW_WATER = 5;
  const PRERENDER = 3;

  const session = new StudySession<Card>();

  let current = $state<Card | null>(null);
  let pending = $state(0);
  let answered = $state(0);
  let revealed = $state(false);

  let initialLoaded = $state(false);
  let fetching = $state(false);
  let hasMore = true;
  let cursor: DueCursor | null = null;
  let loadError = $state<string | null>(null);
  let saveError = $state<string | null>(null);
  let leaving = false;

  const deckName = $derived(deckStore.decks.find((d) => d.id === deckId)?.name ?? 'Study');

  type View = 'loading' | 'error' | 'card' | 'empty' | 'done';
  const view: View = $derived.by(() => {
    if (current) return 'card';
    if (!initialLoaded || fetching) return 'loading';
    if (loadError) return 'error';
    return answered === 0 ? 'empty' : 'done';
  });

  function errorMessage(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }

  function prerender(): void {
    const next = session.peek(PRERENDER);
    if (next.length === 0) return;
    const work = () => {
      for (const c of next) {
        renderToHtml(c.front);
        renderToHtml(c.back);
      }
    };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(work);
    else setTimeout(work, 0);
  }

  function sync(): void {
    const prevId = current?.id ?? null;
    current = session.current;
    pending = session.pending;
    answered = session.answered;
    if ((current?.id ?? null) !== prevId) prerender();
    maybeFetch();
  }

  async function fetchPage(): Promise<void> {
    fetching = true;
    try {
      const cards = await call('study.due', { deckId, after: cursor, limit: PAGE });
      hasMore = cards.length === PAGE;
      const last = cards[cards.length - 1];
      if (last) cursor = { dueDay: last.dueDay, id: last.id };
      session.push(cards);
      loadError = null;
    } catch (e) {
      hasMore = false;
      loadError = errorMessage(e);
    } finally {
      fetching = false;
      initialLoaded = true;
    }
    sync();
  }

  function maybeFetch(): void {
    if (!initialLoaded || fetching || !hasMore || leaving) return;
    if (session.pending < LOW_WATER) void fetchPage();
  }

  function reveal(): void {
    if (!current || revealed) return;
    revealed = true;
  }

  function answer(correct: boolean): void {
    if (!current || !revealed) return;
    const { card, persist } = session.answer(correct);
    if (persist) {
      call('study.answer', { cardId: card.id, correct }).then(
        () => {
          saveError = null;
        },
        (e: unknown) => {
          saveError = `Couldn't save the last answer: ${errorMessage(e)}`;
        },
      );
    }
    revealed = false;
    sync();
  }

  async function exit(): Promise<void> {
    if (leaving) return;
    leaving = true;
    try {
      await refreshDecks();
    } catch {
      // Navigate regardless.
    }
    go({ name: 'deck', deckId });
  }

  function isEditable(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (isEditable(event.target)) return;

    if (event.key === 'Escape') {
      if (document.querySelector('dialog[open]')) return;
      event.preventDefault();
      void exit();
      return;
    }

    if (event.key === ' ' || event.code === 'Space') {
      if (!current) return; // Let Space activate "Back to Deck" in empty/done states.
      // Swallow Space while studying so it never scrolls or re-activates a focused button.
      event.preventDefault();
      if (!event.repeat && !revealed) reveal();
      return;
    }

    if (!current || !revealed || event.repeat) return;
    if (event.key === 'ArrowRight' || event.key === '2') {
      event.preventDefault();
      answer(true);
    } else if (event.key === 'ArrowLeft' || event.key === '1') {
      event.preventDefault();
      answer(false);
    }
  }

  onMount(() => {
    void fetchPage();
  });
</script>

<svelte:window onkeydown={onKeydown} />

<div class="study">
  <Toolbar title={deckName} subtitle={view === 'card' ? `${pending} remaining` : ''}>
    <button type="button" class="btn btn-toolbar" onclick={() => void exit()}>Done</button>
  </Toolbar>

  <div class="content">
    {#if view === 'card' && current}
      <article class="card" aria-live="polite">
        {#key current.id}
          <div class="side front">
            <RichText source={current.front} />
          </div>
          {#if revealed}
            <hr class="divider" />
            <div class="side back">
              <RichText source={current.back} />
            </div>
          {/if}
        {/key}
      </article>
    {:else if view === 'loading'}
      <div class="empty-state" role="status">
        <p class="empty-state-message">Loading…</p>
      </div>
    {:else if view === 'error'}
      <div class="empty-state" role="alert">
        <p class="empty-state-title">Couldn't Load Cards</p>
        <p class="empty-state-message">{loadError}</p>
        <button type="button" class="btn" onclick={() => void exit()}>Back to Deck</button>
      </div>
    {:else if view === 'empty'}
      <div class="empty-state">
        <p class="empty-state-title">Nothing Due</p>
        <p class="empty-state-message">No cards in this deck are due today.</p>
        <button type="button" class="btn" onclick={() => void exit()}>Back to Deck</button>
      </div>
    {:else if view === 'done'}
      <div class="empty-state">
        <p class="empty-state-title">Session Complete</p>
        <p class="empty-state-message">
          {answered === 1 ? '1 card reviewed.' : `${answered} cards reviewed.`}
        </p>
        <button type="button" class="btn" onclick={() => void exit()}>Back to Deck</button>
      </div>
    {/if}
  </div>

  {#if view === 'card'}
    <div class="footer">
      {#if saveError}
        <p class="warning" role="alert">{saveError}</p>
      {:else if loadError}
        <p class="warning" role="alert">Couldn't load more cards: {loadError}</p>
      {/if}
      <div class="bottom-bar">
        {#if !revealed}
          <div class="action">
            <button type="button" class="btn btn-large" onclick={reveal}>Show Answer</button>
            <span class="hint" aria-hidden="true">Space</span>
          </div>
        {:else}
          <div class="action">
            <button type="button" class="btn btn-large wrong" onclick={() => answer(false)}>
              Wrong
            </button>
            <span class="hint" aria-hidden="true">←</span>
          </div>
          <div class="action">
            <button type="button" class="btn btn-large right" onclick={() => answer(true)}>
              Right
            </button>
            <span class="hint" aria-hidden="true">→</span>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .study {
    display: grid;
    grid-template-rows: auto 1fr auto;
    height: 100%;
    min-height: 0;
    background: var(--bg-content);
  }

  .content {
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  .card {
    width: 100%;
    max-width: var(--content-max);
    margin: 0 auto;
    padding: var(--s8) var(--s6);
    color: var(--label);
  }

  .side {
    font: var(--text-card) var(--font-system);
  }

  .divider {
    border: 0;
    border-top: var(--hairline) solid var(--separator);
    margin: var(--s6) 0;
  }

  .content > .empty-state {
    flex: 1 1 auto;
  }

  .footer {
    border-top: var(--hairline) solid var(--separator);
  }

  .warning {
    font: var(--text-callout) var(--font-system);
    color: var(--orange);
    text-align: center;
    padding: var(--s2) var(--s4) 0;
  }

  .bottom-bar {
    display: flex;
    justify-content: center;
    align-items: flex-start;
    gap: var(--s3);
    padding: var(--s4);
  }

  .action {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s1);
  }

  .btn-large {
    min-height: var(--answer-height);
  }

  .wrong {
    color: var(--red);
  }

  .right {
    color: var(--green);
  }

  .hint {
    font: var(--text-footnote) var(--font-system);
    color: var(--label-tertiary);
  }
</style>
