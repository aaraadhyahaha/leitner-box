<script lang="ts">
  import { CalendarPlus } from '@lucide/svelte';
  import Sheet from './Sheet.svelte';
  import { call } from '../lib/db/client';
  import { deckStore, refreshDecks } from '../lib/decks.svelte';
  import {
    downloadIcs,
    enableNotifications,
    notifyActive,
    reminders,
    savePrefs,
  } from '../lib/reminders/reminders.svelte';

  let { open = $bindable(false) }: { open?: boolean } = $props();

  let error = $state<string | null>(null);
  let pendingNotify = $state(false);

  const decks = $derived(deckStore.decks);
  const notifyOn = $derived(notifyActive());
  const notifyDisabled = $derived(
    !reminders.support.notify || reminders.permission === 'denied' || pendingNotify,
  );

  const supportLine = $derived.by(() => {
    if (!reminders.support.notify) return 'This browser can’t show notifications. Add a calendar event instead.';
    if (reminders.permission === 'denied') return 'Notifications are blocked for this site in the browser settings.';
    if (reminders.support.periodic)
      return 'Shown at this time while Leitner is open. When it’s installed and closed, the browser checks about twice a day, so a reminder can arrive later.';
    return 'Shown only while Leitner is open in a tab. Add a calendar event for reminders when it’s closed.';
  });

  function onTimeChange(e: Event) {
    const value = (e.currentTarget as HTMLInputElement).value;
    if (!/^\d{2}:\d{2}$/.test(value)) return;
    void savePrefs({ ...reminders.prefs, time: value });
  }

  async function onNotifyChange(e: Event) {
    const box = e.currentTarget as HTMLInputElement;
    if (box.checked) {
      pendingNotify = true;
      try {
        const granted = await enableNotifications();
        box.checked = granted;
      } finally {
        pendingNotify = false;
      }
    } else {
      await savePrefs({ ...reminders.prefs, notify: false });
    }
  }

  async function onDeckChange(id: number, e: Event) {
    const box = e.currentTarget as HTMLInputElement;
    error = null;
    try {
      await call('deck.setRemind', { id, remind: box.checked });
      await refreshDecks();
    } catch (err) {
      box.checked = !box.checked;
      error = err instanceof Error ? err.message : String(err);
    }
  }

  function addToCalendar() {
    downloadIcs(decks.filter((d) => d.remind).map((d) => d.name));
  }
</script>

<Sheet bind:open title="Reminders">
  <div class="reminders">
    <div class="group">
      <label class="field-label" for="reminder-time">Reminder time</label>
      <input
        id="reminder-time"
        class="field time-field"
        type="time"
        value={reminders.prefs.time}
        onchange={onTimeChange}
        data-autofocus
      />
    </div>

    <div class="group">
      <label class="check-row">
        <input
          type="checkbox"
          checked={notifyOn}
          disabled={notifyDisabled}
          aria-describedby="reminder-support"
          onchange={onNotifyChange}
        />
        <span>Show notifications</span>
      </label>
      <p id="reminder-support" class="caption">{supportLine}</p>
    </div>

    <div class="group">
      <p class="field-label" id="reminder-decks-label">Decks</p>
      {#if decks.length === 0}
        <p class="caption">No decks yet.</p>
      {:else}
        <div role="group" aria-labelledby="reminder-decks-label">
          {#each decks as d (d.id)}
            <label class="check-row">
              <input type="checkbox" checked={d.remind} onchange={(e) => onDeckChange(d.id, e)} />
              <span class="deck-name" title={d.name}>{d.name}</span>
            </label>
          {/each}
        </div>
      {/if}
      {#if error}
        <p class="field-error">{error}</p>
      {/if}
    </div>

    <div class="group">
      <div>
        <button type="button" class="btn calendar-btn" onclick={addToCalendar}>
          <CalendarPlus size={16} strokeWidth={1.5} aria-hidden="true" />
          <span>Add to Calendar…</span>
        </button>
      </div>
      <p class="caption">Adds a daily event that opens Leitner’s Today screen.</p>
    </div>
  </div>

  {#snippet footer()}
    <button type="button" class="btn btn-primary" onclick={() => (open = false)}>Done</button>
  {/snippet}
</Sheet>

<style>
  .reminders {
    display: flex;
    flex-direction: column;
    gap: var(--s4);
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: var(--s1);
    min-width: 0;
  }

  .time-field {
    width: var(--search-width);
  }

  .caption {
    font: var(--text-callout) var(--font-system);
    color: var(--label-secondary);
  }

  .deck-name {
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .calendar-btn {
    gap: var(--s2);
  }

  .calendar-btn :global(svg) {
    flex: none;
    width: var(--icon);
    height: var(--icon);
  }
</style>
