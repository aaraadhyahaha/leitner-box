<script lang="ts" module>
  let nextId = 0;
</script>

<script lang="ts">
  let {
    open = $bindable(false),
    title,
    message = '',
    confirmLabel = 'OK',
    cancelLabel = null,
    destructive = false,
    onconfirm,
    oncancel,
  }: {
    open?: boolean;
    title: string;
    message?: string;
    confirmLabel?: string;
    cancelLabel?: string | null;
    destructive?: boolean;
    onconfirm?: () => void;
    oncancel?: () => void;
  } = $props();

  const uid = `alert-${++nextId}`;
  const titleId = `${uid}-title`;
  const messageId = `${uid}-message`;

  let dialog: HTMLDialogElement | undefined = $state();
  let cancelBtn: HTMLButtonElement | undefined = $state();
  let confirmBtn: HTMLButtonElement | undefined = $state();

  $effect(() => {
    const el = dialog;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      // Cancel is the default when present; a destructive button is never focused on open.
      if (cancelLabel) cancelBtn?.focus();
      else if (!destructive) confirmBtn?.focus();
      else el.focus();
    } else if (!open && el.open) {
      el.close();
    }
  });

  function handleCancelEvent(e: Event) {
    e.preventDefault();
    if (!open) return;
    open = false;
    oncancel?.();
  }

  // The browser may force-close the dialog without a cancellable event; keep state in sync.
  function handleClose() {
    if (!open) return;
    open = false;
    oncancel?.();
  }

  function cancel() {
    open = false;
    oncancel?.();
  }

  function confirm() {
    open = false;
    onconfirm?.();
  }
</script>

<dialog
  bind:this={dialog}
  class="alert"
  tabindex="-1"
  role="alertdialog"
  aria-modal="true"
  aria-labelledby={titleId}
  aria-describedby={message ? messageId : undefined}
  oncancel={handleCancelEvent}
  onclose={handleClose}
>
  <h2 id={titleId} class="alert-title">{title}</h2>
  {#if message}
    <p id={messageId} class="alert-message">{message}</p>
  {/if}
  <div class="alert-buttons">
    {#if cancelLabel}
      <button bind:this={cancelBtn} type="button" class="btn btn-primary" onclick={cancel}>
        {cancelLabel}
      </button>
      <button
        bind:this={confirmBtn}
        type="button"
        class="btn"
        class:btn-destructive={destructive}
        onclick={confirm}
      >
        {confirmLabel}
      </button>
    {:else}
      <button
        bind:this={confirmBtn}
        type="button"
        class="btn"
        class:btn-primary={!destructive}
        class:btn-destructive={destructive}
        onclick={confirm}
      >
        {confirmLabel}
      </button>
    {/if}
  </div>
</dialog>

<style>
  .alert {
    margin: auto;
    width: var(--alert-width);
    max-width: calc(100vw - var(--s8));
    padding: var(--s5);
    border: none;
    border-radius: var(--radius-sheet);
    background: var(--bg-sheet);
    color: var(--label);
    box-shadow: var(--shadow-sheet);
    text-align: center;
  }

  .alert[open] {
    display: flex;
    flex-direction: column;
    gap: var(--s2);
    animation: alert-fade var(--dur-fast) var(--ease);
  }

  .alert:focus {
    outline: none;
  }

  .alert::backdrop {
    background: var(--backdrop);
    animation: alert-fade var(--dur-fast) var(--ease);
  }

  .alert-title {
    font: var(--text-title3) var(--font-system);
    font-weight: 600;
  }

  .alert-message {
    font: var(--text-callout) var(--font-system);
    overflow-wrap: anywhere;
  }

  .alert-buttons {
    display: flex;
    flex-direction: column;
    gap: var(--s2);
    margin-top: var(--s2);
  }

  .alert-buttons .btn {
    width: 100%;
  }

  @keyframes alert-fade {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
</style>
