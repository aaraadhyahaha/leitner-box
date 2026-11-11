<script lang="ts">
  import { applyUpdate, dismissPersistNotice, pwa } from '../lib/pwa.svelte';
  import { router } from '../lib/router.svelte';

  // Never offer a reload in the middle of a study session.
  const showUpdate = $derived(pwa.updateReady && router.route.name !== 'study');
  const showPersist = $derived(pwa.persistNotice && router.route.name !== 'study');
</script>

{#if showUpdate || showPersist}
  <div class="notices" role="status" aria-live="polite">
    {#if showUpdate}
      <div class="notice">
        <span class="notice-text">Update available</span>
        <button type="button" class="btn" onclick={applyUpdate}>Reload</button>
      </div>
    {/if}
    {#if showPersist}
      <div class="notice">
        <span class="notice-text">
          The browser may clear this library when space runs low. Export regularly to keep a backup.
        </span>
        <button type="button" class="btn" onclick={dismissPersistNotice}>OK</button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .notices {
    position: fixed;
    right: var(--s4);
    bottom: var(--s4);
    display: grid;
    gap: var(--s2);
    max-width: var(--notice-width);
    z-index: 10;
  }

  .notice {
    display: flex;
    align-items: center;
    gap: var(--s3);
    padding: var(--s2) var(--s2) var(--s2) var(--s3);
    background: var(--bg-sheet);
    color: var(--label);
    font: var(--text-callout);
    font-family: var(--font-system);
    border: var(--hairline) solid var(--separator);
    border-radius: var(--radius-sheet);
    box-shadow: var(--shadow-sheet);
  }

  .notice-text {
    flex: 1;
  }

  .notice .btn {
    flex: none;
  }
</style>
