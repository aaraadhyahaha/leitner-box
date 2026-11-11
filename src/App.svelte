<script lang="ts">
  import Sidebar from './components/Sidebar.svelte';
  import Toolbar from './components/Toolbar.svelte';
  import ImportButton from './components/ImportButton.svelte';
  import ExportButton from './components/ExportButton.svelte';
  import DeckView from './components/DeckView.svelte';
  import StudyView from './components/StudyView.svelte';
  import ImportsView from './components/ImportsView.svelte';
  import Notices from './components/Notices.svelte';
  import { deckStore, refreshDecks } from './lib/decks.svelte';
  import { router } from './lib/router.svelte';

  $effect(() => {
    void refreshDecks();
  });

  const route = $derived(router.route);
</script>

<div class="window">
  <Sidebar />
  <main class="main">
    {#if deckStore.error}
      <Toolbar title="Leitner" />
      <div class="main-scroller">
        <div class="empty-state">
          <p class="empty-state-title">Couldn’t Open Library</p>
          <p class="empty-state-message">{deckStore.error}</p>
        </div>
      </div>
    {:else if route.name === 'deck'}
      {#key route.deckId}
        <DeckView deckId={route.deckId} />
      {/key}
    {:else if route.name === 'imports'}
      <ImportsView />
    {:else if route.name === 'study'}
      {#key route.deckId}
        <StudyView deckId={route.deckId} />
      {/key}
    {:else}
      <Toolbar title="Leitner">
        {#if deckStore.decks.length > 0}
          <ExportButton />
        {/if}
        <ImportButton />
      </Toolbar>
      <div class="main-scroller">
        {#if deckStore.loaded && deckStore.decks.length === 0}
          <div class="empty-state">
            <p class="empty-state-title">No Decks</p>
            <p class="empty-state-message">Import a JSONL file to add cards.</p>
            <ImportButton />
          </div>
        {:else if deckStore.loaded}
          <div class="empty-state">
            <p class="empty-state-title">No Deck Selected</p>
            <p class="empty-state-message">Choose a deck in the sidebar.</p>
          </div>
        {/if}
      </div>
    {/if}
  </main>
</div>
<Notices />

<style>
  .window {
    display: grid;
    grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
    height: 100vh;
    height: 100dvh;
    overflow: hidden;
  }

  .main {
    display: grid;
    grid-template-rows: auto 1fr;
    min-width: 0;
    min-height: 0;
    background: var(--bg-content);
  }

  .main-scroller {
    min-height: 0;
    overflow-y: auto;
  }
</style>
