<!--
  A single indicator for whether yaz is talking to anything.

  Sits at the far end of the toolbar rather than being a labelled button,
  because it is something you glance at, not something you operate. Clicking it
  opens the connections view; that is a shortcut, not its job.

  Three colours and, deliberately, one animation. The pulse marks a *live*
  connection — the state that can change under you — so a glance distinguishes
  "reading your library as it is now" from "reading a copy". Amber and red are
  still, because a steady problem should not draw the eye forever.
-->
<script lang="ts">
  import { t } from "./i18n";

  /**
   * `live` pulses green, `degraded` is amber, `off` is red, `unknown` is grey.
   *
   * `unknown` exists because nothing connects at startup any more: until the
   * user asks, yaz genuinely does not know, and inventing a colour for it would
   * be a guess shown as a fact.
   */
  export type Health = "live" | "degraded" | "off" | "unknown";

  interface Props {
    health: Health;
    /** Message key describing the current state, used as the tooltip. */
    labelKey: string;
    onclick: () => void;
  }

  let { health, labelKey, onclick }: Props = $props();
</script>

<button
  type="button"
  class="light {health}"
  title={t(labelKey)}
  aria-label={t(labelKey)}
  {onclick}
>
  <span class="dot" aria-hidden="true"></span>
</button>

<style>
  .light {
    display: flex;
    align-items: center;
    justify-content: center;
    inline-size: 1.75rem;
    block-size: 1.75rem;
    padding: 0;
    background: none;
    border: none;
    border-radius: var(--yaz-radius-sm);
    cursor: pointer;
  }

  .light:hover {
    background: var(--yaz-bg-hover);
  }

  .dot {
    inline-size: 0.5rem;
    block-size: 0.5rem;
    border-radius: 50%;
    background: var(--yaz-text-muted);
  }

  .live .dot {
    background: var(--yaz-success);
    animation: pulse 2s ease-in-out infinite;
  }

  .degraded .dot {
    background: var(--yaz-warning);
  }

  .off .dot {
    background: var(--yaz-error);
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
      box-shadow: 0 0 0 0 var(--yaz-success);
    }
    50% {
      opacity: 0.65;
      box-shadow: 0 0 0 0.25rem transparent;
    }
  }

  /* A pulsing dot in the corner of the eye is exactly what this setting is
     for. The colour still carries the state. */
  @media (prefers-reduced-motion: reduce) {
    .live .dot {
      animation: none;
    }
  }
</style>
