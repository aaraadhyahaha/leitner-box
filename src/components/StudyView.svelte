<script lang="ts">
  let { deckId }: { deckId: number } = $props();
</script>

<div hidden data-deck-id={deckId}></div>
