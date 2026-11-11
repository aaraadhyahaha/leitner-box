<script lang="ts" generics="T">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  let {
    items,
    rowHeight = 28,
    overscan = 10,
    row,
    onnearend,
    ...rest
  }: {
    items: T[];
    rowHeight?: number;
    overscan?: number;
    row: Snippet<[T, number]>;
    onnearend?: () => void;
  } & HTMLAttributes<HTMLDivElement> = $props();

  let el: HTMLDivElement | undefined = $state();
  let scrollTop = $state(0);
  let viewHeight = $state(0);
  let frame = 0;

  const start = $derived(Math.max(0, Math.floor(scrollTop / rowHeight) - overscan));
  const end = $derived(
    Math.min(items.length, Math.ceil((scrollTop + viewHeight) / rowHeight) + overscan),
  );
  const visible = $derived(items.slice(start, end));

  $effect(() => {
    const node = el;
    if (!node) return;
    viewHeight = node.clientHeight;
    scrollTop = node.scrollTop;
    const ro = new ResizeObserver(() => {
      viewHeight = node.clientHeight;
    });
    ro.observe(node);
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        scrollTop = node.scrollTop;
      });
    };
    node.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      ro.disconnect();
      node.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    };
  });

  // Ask for more when the visible range nears the end of the loaded items.
  $effect(() => {
    if (!onnearend || viewHeight === 0) return;
    if (items.length - end <= 50) onnearend();
  });

  export function scrollToIndex(i: number): void {
    const node = el;
    if (!node || i < 0 || i >= items.length) return;
    const top = i * rowHeight;
    const bottom = top + rowHeight;
    if (top < node.scrollTop) node.scrollTop = top;
    else if (bottom > node.scrollTop + node.clientHeight) node.scrollTop = bottom - node.clientHeight;
    scrollTop = node.scrollTop;
  }
</script>

<div bind:this={el} {...rest} class="virtual-list {rest.class ?? ''}">
  <div class="virtual-spacer" style:height="{items.length * rowHeight}px">
    <div class="virtual-block" style:transform="translateY({start * rowHeight}px)">
      {#each visible as item, j (start + j)}
        {@render row(item, start + j)}
      {/each}
    </div>
  </div>
</div>

<style>
  .virtual-list {
    position: relative;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .virtual-spacer {
    position: relative;
  }

  .virtual-block {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    will-change: transform;
  }
</style>
