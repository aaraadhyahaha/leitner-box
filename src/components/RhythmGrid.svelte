<script lang="ts">
  import type { DayRecord } from '../lib/db/types';
  import { rhythmCells, type RhythmCell } from '../lib/habit';
  import { count, fmt } from '../lib/format';

  let { days, today }: { days: DayRecord[]; today: number } = $props();

  const cells = $derived(rhythmCells(days, today));
  const byDay = $derived(new Map(days.map((d) => [d.day, d])));
  const kept = $derived(cells.filter((c) => c.status === 'kept').length);

  // Day numbers are local days counted from the epoch, so format them as UTC dates.
  const dateFmt = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

  function cellTitle(c: RhythmCell): string {
    const date = dateFmt.format(new Date(c.day * 86_400_000));
    switch (c.status) {
      case 'kept':
        return `${date} · Cleared · ${fmt(byDay.get(c.day)?.reviewed ?? 0)} reviewed`;
      case 'rest':
        return `${date} · Nothing due`;
      case 'forgiven':
        return `${date} · Missed, forgiven`;
      case 'missed':
        return `${date} · Missed`;
      case 'none':
        return `${date} · Not cleared yet`;
      default:
        return `${date} · Upcoming`;
    }
  }
</script>

<div class="rhythm">
  <div
    class="rhythm-grid"
    role="img"
    aria-label="Review rhythm, last 12 weeks: {count(kept, 'day')} cleared"
  >
    {#each cells as c (c.day)}
      <span
        class="cell {c.status}"
        class:today={c.day === today}
        style:--cell-fill={c.status === 'kept' ? `var(--rhythm-${c.level})` : undefined}
        title={cellTitle(c)}
      ></span>
    {/each}
  </div>
  <p class="rhythm-caption">One missed day a week is forgiven. Days with nothing due don’t count.</p>
</div>

<style>
  .rhythm {
    display: flex;
    flex-direction: column;
    gap: var(--s2);
  }

  .rhythm-grid {
    display: grid;
    grid-auto-flow: column;
    grid-template-rows: repeat(7, var(--rhythm-cell));
    grid-auto-columns: var(--rhythm-cell);
    gap: var(--rhythm-gap);
    width: max-content;
  }

  .cell {
    width: var(--rhythm-cell);
    height: var(--rhythm-cell);
    border-radius: var(--rhythm-radius);
    background: var(--rhythm-0);
  }

  .cell.kept {
    background: var(--cell-fill, var(--rhythm-1));
  }

  .cell.forgiven {
    background: transparent;
    box-shadow: inset 0 0 0 var(--hairline) var(--rhythm-2);
  }

  .cell.future {
    background: transparent;
    box-shadow: inset 0 0 0 var(--hairline) var(--separator);
  }

  .cell.today {
    outline: var(--hairline) solid var(--label-secondary);
    outline-offset: 1px;
  }

  .rhythm-caption {
    font: var(--text-footnote) var(--font-system);
    color: var(--label-tertiary);
  }
</style>
