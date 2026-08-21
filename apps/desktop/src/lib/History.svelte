<!--
  The version history, as a workspace tab.

  Restoring is offered per version rather than as a back/forward pair, because
  "back" is ambiguous once you have gone back once: a list says exactly which
  version you are asking for.

  Restoring never rewrites history. It puts the files back and leaves the
  recorded versions alone, so moving forward again is just another restore
  rather than an undo that can run out.
-->
<script lang="ts">
  import { t } from "./i18n";
  import type { Commit, VcsStatus } from "./ipc";

  interface Props {
    status: VcsStatus | null;
    commits: Commit[];
    busy: boolean;
    onenable: () => void;
    onrestore: (commit: Commit) => void;
    oncommit: () => void;
  }

  let { status, commits, busy, onenable, onrestore, oncommit }: Props = $props();

  /**
   * A timestamp a person can read.
   *
   * The backend hands over ISO-8601 rather than a formatted string, so the
   * locale in force at render time decides — not the one that happened to be
   * active when the version was recorded.
   */
  function when(timestamp: string): string {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return timestamp;
    return date.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }
</script>

<div class="history">
  {#if !status?.enabled}
    <div class="empty">
      <p>{t("vcs-off-explains")}</p>
      <button type="button" onclick={onenable} disabled={busy || !status?.available}>
        {t("vcs-enable")}
      </button>
      {#if status && !status.available}
        <p class="hint">{t("vcs-unavailable")}</p>
      {/if}
    </div>
  {:else}
    <header class="bar">
      <span class="state">
        {status.dirty ? t("vcs-uncommitted") : t("vcs-recording")}
      </span>
      <button type="button" onclick={oncommit} disabled={busy || !status.dirty}>
        {t("vcs-commit-with-message")}
      </button>
    </header>

    {#if commits.length === 0}
      <p class="empty">{t("vcs-empty")}</p>
    {:else}
      <ul class="commits">
        {#each commits as commit, index (commit.id)}
          <li class="commit" class:current={index === 0}>
            <div class="line">
              <span class="summary" title={commit.summary}>{commit.summary}</span>
              <button
                type="button"
                class="restore"
                disabled={busy || status.dirty}
                title={status.dirty ? t("vcs-error-would-lose-changes") : t("vcs-restore")}
                onclick={() => onrestore(commit)}
              >
                {t("vcs-restore")}
              </button>
            </div>
            <div class="meta">
              <code>{commit.shortId}</code>
              <span>{commit.author}</span>
              <span>{when(commit.timestamp)}</span>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>

<style>
  .history {
    block-size: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--yaz-bg-primary);
  }

  .bar {
    display: flex;
    align-items: center;
    gap: var(--yaz-space-3);
    padding: var(--yaz-space-2) var(--yaz-space-3);
    border-block-end: 1px solid var(--yaz-border);
    background: var(--yaz-bg-secondary);
  }

  .state {
    font-size: var(--yaz-font-size-sm);
    color: var(--yaz-text-secondary);
  }

  .bar button,
  .empty button {
    font: inherit;
    font-size: var(--yaz-font-size-sm);
    color: var(--yaz-text-primary);
    background: var(--yaz-bg-tertiary);
    border: 1px solid var(--yaz-border);
    border-radius: var(--yaz-radius-md);
    padding: var(--yaz-space-1) var(--yaz-space-3);
    cursor: pointer;
    margin-inline-start: auto;
  }

  .bar button:disabled,
  .empty button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .empty {
    padding: var(--yaz-space-4);
    color: var(--yaz-text-muted);
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--yaz-space-2);
  }

  .empty button {
    margin-inline-start: 0;
  }

  .hint {
    margin: 0;
    font-size: var(--yaz-font-size-sm);
    color: var(--yaz-warning);
  }

  .commits {
    margin: 0;
    padding: 0;
    list-style: none;
    overflow-y: auto;
  }

  .commit {
    padding: var(--yaz-space-2) var(--yaz-space-3);
    border-block-end: 1px solid var(--yaz-border);
  }

  /* The version the project is currently at. */
  .commit.current {
    border-inline-start: 2px solid var(--yaz-accent);
  }

  .line {
    display: flex;
    align-items: baseline;
    gap: var(--yaz-space-3);
  }

  .summary {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .restore {
    margin-inline-start: auto;
    flex: none;
    font: inherit;
    font-size: var(--yaz-font-size-sm);
    color: var(--yaz-text-secondary);
    background: none;
    border: 1px solid transparent;
    border-radius: var(--yaz-radius-sm);
    padding: 0 var(--yaz-space-2);
    cursor: pointer;
  }

  .restore:hover:not(:disabled) {
    border-color: var(--yaz-border);
    color: var(--yaz-text-primary);
  }

  .restore:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .meta {
    display: flex;
    gap: var(--yaz-space-3);
    margin-block-start: 0.125rem;
    font-size: var(--yaz-font-size-sm);
    color: var(--yaz-text-muted);
  }

  code {
    font-family: var(--yaz-font-mono);
  }
</style>
