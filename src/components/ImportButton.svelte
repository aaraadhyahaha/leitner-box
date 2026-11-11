<script lang="ts">
  import { FileDown } from '@lucide/svelte';
  import ImportSheet from './ImportSheet.svelte';

  let { deckName = null }: { deckName?: string | null } = $props();

  let open = $state(false);
</script>

<button type="button" class="btn btn-toolbar" onclick={() => (open = true)}>
  <FileDown size={16} strokeWidth={1.5} aria-hidden="true" />
  <span>Import…</span>
</button>
<ImportSheet bind:open {deckName} />
