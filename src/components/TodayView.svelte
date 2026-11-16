<script lang="ts">
  import { Bell, CalendarCheck } from '@lucide/svelte';
  import Toolbar from './Toolbar.svelte';
  import ImportButton from './ImportButton.svelte';
  import RhythmGrid from './RhythmGrid.svelte';
  import RemindersSheet from './RemindersSheet.svelte';
  import { deckStore } from '../lib/decks.svelte';
  import { habitStore } from '../lib/habit.svelte';
  import { computeStreak, estimateMinutes } from '../lib/habit';
  import { go } from '../lib/router.svelte';
  import { count, fmt } from '../lib/format';

  const QUICK_LIMIT = 10;
  const QUICK_THRESHOLD = 30;

  let remindersOpen = $state(false);

  const summary = $derived(habitStore.summary);
  const reminded = $derived(deckStore.decks.filter((d) => d.remind));
  const dueDecks = $derived(
    reminded
      .filter((d) => d.due > 0)
      .sort((a, b) => b.due - a.due || a.name.localeCompare(b.name)),
  );
  const total = $derived(dueDecks.reduce((n, d) => n + d.due, 0));
  const minutes = $derived(estimateMinutes(total, summary?.secondsPerCard ?? 8));
  const tomorrow = $derived(
    summary ? summary.forecast.reduce((n, f) => n + (f.byDay[1] ?? 0), 0) : null,
  );
  const streak = $derived(summary ? computeStreak(summary.days, summary.today) : null);

  // Re-derives when the summary's day changes, so the date rolls over at midnight.
  const dateLabel = $derived.by(() => {
    void summary?.today;
    return new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  });

  const scope = $derived(
    dueDecks.length === 1 ? `in ${dueDecks[0].name}` : `across ${count(dueDecks.length, 'deck')}`,
  );

  function start(limit?: number) {
    const first = dueDecks[0];
    if (!first) return;
    go(limit === undefined ? { name: 'study', deckId: first.id } : { name: 'study', deckId: first.id, limit });
  }

  function onWindowKeydown(e: KeyboardEvent) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (document.querySelector('dialog[open]')) return;
    const t = e.target;
    if (t instanceof Element && t.closest('input, textarea, select, [contenteditable], button, a, [role="listbox"]')) return;
    if (total === 0) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      start();
    } else if ((e.key === 't' || e.key === 'T') && total > QUICK_THRESHOLD) {
      e.preventDefault();
      start(QUICK_LIMIT);
    }
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

<Toolbar title="Today" subtitle={dateLabel}>
  <button type="button" class="btn btn-toolbar" onclick={() => (remindersOpen = true)}>
    <Bell size={16} strokeWidth={1.5} aria-hidden="true" />
    <span>Reminders…</span>
  </button>
</Toolbar>

<div class="today-scroller">
  {#if !deckStore.loaded}
    <!-- loading -->
  {:else if deckStore.decks.length === 0}
    <div class="empty-state">
      <p class="empty-state-title">No Decks</p>
      <p class="empty-state-message">Import a JSONL file to add cards.</p>
      <ImportButton />
    </div>
  {:else if reminded.length === 0}
    <div class="empty-state">
      <p class="empty-state-title">No Reminded Decks</p>
      <p class="empty-state-message">Turn on Remind Me Daily in a deck to see it here.</p>
    </div>
  {:else}
    <div class="today">
      {#if total === 0}
        <div class="empty-state caught-up">
          <p class="empty-state-title">All Caught Up</p>
          {#if tomorrow !== null}
            <p class="empty-state-message">
              {tomorrow > 0 ? `Tomorrow: ${count(tomorrow, 'card')}.` : 'Nothing due tomorrow.'}
            </p>
          {/if}
        </div>
      {:else}
        <section class="hero" aria-label="Due today">
          <p class="hero-count">{count(total, 'card')}</p>
          <p class="hero-detail">about {fmt(minutes)} min · {scope}</p>
          <div class="hero-actions">
            <button
              type="button"
              class="btn btn-primary btn-large"
              aria-keyshortcuts="Enter"
              onclick={() => start()}
            >
              Start Review <kbd class="key">Return</kbd>
            </button>
            {#if total > QUICK_THRESHOLD}
              <button
                type="button"
                class="btn btn-large"
                aria-keyshortcuts="T"
                onclick={() => start(QUICK_LIMIT)}
              >
                Just 10 <kbd class="key">T</kbd>
              </button>
            {/if}
          </div>
        </section>
      {/if}

      {#if summary && streak}
        <section class="habit" aria-label="Streak">
          <p class="streak">
            <CalendarCheck size={16} strokeWidth={1.5} aria-hidden="true" />
            {#if streak.length > 0}
              <span class="streak-count">{fmt(streak.length)}-day streak</span>
              {#if streak.forgiven.length > 0}
                <span class="streak-forgiven">· {count(streak.forgiven.length, 'day')} forgiven</span>
              {/if}
            {:else}
              <span class="streak-forgiven">Clear today’s cards to start a streak.</span>
            {/if}
          </p>
          <RhythmGrid days={summary.days} today={summary.today} />
        </section>
      {/if}

      {#if dueDecks.length > 0}
        <section class="decks" aria-label="Reminded decks due today">
          {#each dueDecks as d (d.id)}
            <div class="list-row deck-row">
              <span class="deck-name" title={d.name}>{d.name}</span>
              <span class="deck-due">{fmt(d.due)} due</span>
              <button
                type="button"
                class="btn"
                aria-label="Study {d.name}"
                onclick={() => go({ name: 'study', deckId: d.id })}>Study</button
              >
            </div>
          {/each}
        </section>
      {/if}
    </div>
  {/if}
</div>

<RemindersSheet bind:open={remindersOpen} />

<style>
  .today-scroller {
    min-height: 0;
    overflow-y: auto;
  }

  .today {
    display: flex;
    flex-direction: column;
    gap: var(--s6);
    max-width: var(--content-max);
    margin: 0 auto;
    padding: var(--s8);
  }

  .caught-up {
    height: auto;
    padding: var(--s6) 0 0;
  }

  .hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s1);
    text-align: center;
  }

  .hero-count {
    font: var(--text-large-title) var(--font-system);
    font-variant-numeric: tabular-nums;
    color: var(--label);
  }

  .hero-detail {
    font: var(--text-callout) var(--font-system);
    color: var(--label-secondary);
  }

  .hero-actions {
    display: flex;
    gap: var(--s3);
    margin-top: var(--s3);
  }

  .hero-actions .btn {
    gap: var(--s2);
  }

  .key {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: var(--s5);
    height: var(--s4);
    padding: 0 var(--s1);
    border: var(--hairline) solid var(--control-border);
    border-radius: var(--radius-row);
    font: var(--text-footnote) var(--font-system);
    color: var(--label-secondary);
  }

  .btn-primary .key {
    border-color: currentColor;
    color: var(--on-accent);
  }

  .habit {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s3);
  }

  .streak {
    display: flex;
    align-items: center;
    gap: var(--s2);
    color: var(--label);
  }

  .streak :global(svg) {
    flex: none;
    width: var(--icon);
    height: var(--icon);
    color: var(--label-secondary);
  }

  .streak-count {
    font: var(--text-headline) var(--font-system);
    font-variant-numeric: tabular-nums;
  }

  .streak-forgiven {
    font: var(--text-body) var(--font-system);
    color: var(--label-secondary);
  }

  .decks {
    border-top: var(--hairline) solid var(--separator);
  }

  .deck-row {
    height: auto;
    min-height: var(--row-height);
    padding-top: var(--s1);
    padding-bottom: var(--s1);
  }

  .deck-name {
    flex: 1 1 auto;
    min-width: 0;
    font: var(--text-body) var(--font-system);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .deck-due {
    flex: none;
    font: var(--text-body) var(--font-system);
    color: var(--label-secondary);
    font-variant-numeric: tabular-nums;
  }
</style>
