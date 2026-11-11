<script lang="ts">
  import { FileUp } from '@lucide/svelte';
  import Alert from './Alert.svelte';
  import { call } from '../lib/db/client';
  import { deckStore } from '../lib/decks.svelte';

  let { deckId = null }: { deckId?: number | null } = $props();

  let running = $state(false);
  let alertOpen = $state(false);
  let alertMessage = $state('');

  const label = $derived(deckId === null ? 'Export All Decks…' : 'Export Deck…');

  function pad(n: number): string {
    return String(n).padStart(2, '0');
  }

  function fileName(): string {
    if (deckId !== null) {
      const deck = deckStore.decks.find((d) => d.id === deckId);
      if (deck) {
        const safe = deck.name.replace(/[^\p{L}\p{N} ._-]/gu, '_');
        if (safe) return `${safe}.jsonl`;
      }
    }
    const now = new Date();
    return `leitner-box-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.jsonl`;
  }

  function save(blob: Blob, name: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.hidden = true;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Firefox needs the URL alive until the download has started.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function onclick() {
    if (running) return;
    running = true;
    try {
      const name = fileName();
      const blob = await call('export.jsonl', { deckId });
      save(blob, name);
    } catch (e) {
      alertMessage = e instanceof Error ? e.message : String(e);
      alertOpen = true;
    } finally {
      running = false;
    }
  }
</script>

<button
  type="button"
  class="btn-icon"
  aria-label={label}
  title={label}
  disabled={running}
  {onclick}
>
  <FileUp size={16} strokeWidth={1.5} aria-hidden="true" />
</button>
<Alert bind:open={alertOpen} title="Export Failed" message={alertMessage} />
