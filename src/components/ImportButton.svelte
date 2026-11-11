<script lang="ts">
  import { FileDown } from '@lucide/svelte';
  import Alert from './Alert.svelte';
  import { call } from '../lib/db/client';
  import { refreshDecks } from '../lib/decks.svelte';
  import type { ImportResult } from '../lib/db/types';

  let { deckName = null }: { deckName?: string | null } = $props();

  let input: HTMLInputElement | undefined = $state();
  let running = $state(false);
  let alertOpen = $state(false);
  let alertTitle = $state('');
  let alertMessage = $state('');

  function baseName(name: string): string {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(0, dot) : name;
  }

  function summarize(r: ImportResult): { title: string; message: string } {
    const title = r.added === 1 ? 'Imported 1 Card' : `Imported ${r.added} Cards`;
    const parts: string[] = [];
    if (r.duplicates > 0) {
      parts.push(
        r.duplicates === 1 ? '1 duplicate skipped.' : `${r.duplicates} duplicates skipped.`,
      );
    }
    if (r.errorCount > 0) {
      parts.push(r.errorCount === 1 ? '1 line had errors.' : `${r.errorCount} lines had errors.`);
    }
    let message = parts.join(' ');
    const first = r.errors[0];
    if (r.errorCount > 0 && first) {
      message += `${message ? ' ' : ''}First error: line ${first.line}: ${first.message}.`;
    }
    return { title, message };
  }

  async function onchange() {
    const file = input?.files?.[0];
    if (input) input.value = '';
    if (!file) return;
    running = true;
    try {
      const defaultDeck = deckName ?? baseName(file.name);
      const result = await call('import.run', { file, defaultDeck, commit: true });
      const s = summarize(result);
      alertTitle = s.title;
      alertMessage = s.message;
    } catch (e) {
      alertTitle = 'Import Failed';
      alertMessage = e instanceof Error ? e.message : String(e);
    } finally {
      running = false;
    }
    alertOpen = true;
    await refreshDecks();
  }
</script>

<button type="button" class="btn btn-toolbar" disabled={running} onclick={() => input?.click()}>
  <FileDown size={16} strokeWidth={1.5} aria-hidden="true" />
  <span>Import…</span>
</button>
<input
  bind:this={input}
  type="file"
  accept=".jsonl,.json,.txt"
  hidden
  tabindex="-1"
  aria-hidden="true"
  {onchange}
/>
<Alert bind:open={alertOpen} title={alertTitle} message={alertMessage} />
