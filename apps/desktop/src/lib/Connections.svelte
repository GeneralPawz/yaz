<!--
  What yaz is connected to, and how.

  Replaces a bare "Reconnect to Zotero" button, which asked the user to act
  without telling them what the current state was — and reconnecting is the rare
  case, while knowing whether the library is live is the common one.

  The status is deliberately more than connected/disconnected. "Zotero is running
  but its local API is switched off" is a thing a user can fix in half a minute,
  and it is invisible if all they are told is that the library is being read
  offline. That exact case is why this exists: the local API is disabled by
  default, and the first version reported a healthy live connection and then
  failed every query.

  Built for more than one integration from the start — Obsidian lands here too.
-->
<script lang="ts">
  import { t } from "./i18n";
  import type { ZoteroStatus } from "./ipc";

  interface Props {
    status: ZoteroStatus | null;
    /** True while a probe is in flight. */
    busy: boolean;
    onreconnect: () => void;
  }

  let { status, busy, onreconnect }: Props = $props();

  let open = $state(false);
  let container = $state<HTMLElement | null>(null);

  /**
   * Three states, not two: a source can be reachable but stale.
   *
   * `warn` is what a library read from a copy on disk gets — it works, and
   * calling it "connected" would be the silent degradation ADR-0008 forbids.
   */
  const health = $derived.by((): "ok" | "warn" | "off" => {
    if (!status || status.source === "none") return "off";
    return status.isLive ? "ok" : "warn";
  });

  $effect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (container && !container.contains(event.target as Node)) open = false;
    };
    document.addEventListener("mousedown", close, true);
    return () => document.removeEventListener("mousedown", close, true);
  });
</script>

<div class="connections" bind:this={container}>
  <button
    type="button"
    class="trigger"
    aria-haspopup="dialog"
    aria-expanded={open}
    onclick={() => (open = !open)}
  >
    <span class="dot {health}" aria-hidden="true"></span>
    {t("connections-title")}
  </button>

  {#if open}
    <div class="panel" role="dialog" aria-label={t("connections-title")}>
      <div class="row">
        <div class="head">
          <span class="dot {health}" aria-hidden="true"></span>
          <span class="name">{t("connections-zotero")}</span>
          <button type="button" class="action" disabled={busy} onclick={onreconnect}>
            {t("connections-reconnect")}
          </button>
        </div>

        {#if status}
          <!-- The live probe first, because it is the actionable half. -->
          <p class="detail">{t(status.liveStatusKey)}</p>

          {#if status.liveStatusKey === "zotero-live-api-disabled"}
            <p class="hint">{t("zotero-live-api-disabled-help")}</p>
          {/if}

          {#if status.wasDemoted}
            <p class="hint">{t("zotero-demoted")}</p>
          {/if}

          <p class="detail">{t(status.sourceKey)}</p>

          {#if !status.isLive && status.dataDir}
            <p class="path" title={status.dataDir}>{status.dataDir}</p>
          {/if}

          {#if !status.keysAreAuthoritative && status.source !== "none"}
            <p class="hint">{t("zotero-keys-generated")}</p>
          {/if}

          {#if status.detail}
            <p class="hint">{status.detail}</p>
          {/if}
        {:else}
          <p class="detail">{t("connections-not-configured")}</p>
        {/if}
      </div>

      <div class="row muted">
        <div class="head">
          <span class="dot off" aria-hidden="true"></span>
          <span class="name">{t("connections-obsidian")}</span>
        </div>
        <p class="detail">{t("connections-not-configured")}</p>
      </div>
    </div>
  {/if}
</div>

<style>
  .connections {
    position: relative;
  }

  .trigger {
    display: flex;
    align-items: center;
    gap: var(--yaz-space-2);
  }

  .dot {
    inline-size: 0.5rem;
    block-size: 0.5rem;
    border-radius: 50%;
    flex: none;
  }

  .dot.ok {
    background: var(--yaz-success);
  }

  .dot.warn {
    background: var(--yaz-warning);
  }

  .dot.off {
    background: var(--yaz-text-muted);
  }

  .panel {
    position: absolute;
    inset-block-start: calc(100% + var(--yaz-space-1));
    inset-inline-start: 0;
    inline-size: 24rem;
    max-inline-size: 90vw;
    padding: var(--yaz-space-3);
    background: var(--yaz-bg-overlay);
    border: 1px solid var(--yaz-border);
    border-radius: var(--yaz-radius-md);
    box-shadow: var(--yaz-shadow-overlay);
    z-index: 60;
  }

  .row + .row {
    margin-block-start: var(--yaz-space-3);
    padding-block-start: var(--yaz-space-3);
    border-block-start: 1px solid var(--yaz-border);
  }

  .row.muted .name {
    color: var(--yaz-text-muted);
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--yaz-space-2);
  }

  .name {
    font-weight: 600;
  }

  .action {
    margin-inline-start: auto;
    font-size: var(--yaz-font-size-sm);
    padding-block: 0;
  }

  .detail,
  .hint,
  .path {
    margin: var(--yaz-space-1) 0 0;
    margin-inline-start: calc(0.5rem + var(--yaz-space-2));
    font-size: var(--yaz-font-size-sm);
    color: var(--yaz-text-secondary);
  }

  .hint {
    color: var(--yaz-text-muted);
  }

  .path {
    font-family: var(--yaz-font-mono);
    color: var(--yaz-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    /* The interesting end of a long path is the last part of it. */
    direction: rtl;
    text-align: start;
  }
</style>
