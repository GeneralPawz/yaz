<script lang="ts">
  import { t } from "./i18n";

  /**
   * pdf.js is loaded on first use, not at startup.
   *
   * It is the largest thing the frontend pulls in, and nothing can appear in
   * this pane until a compile has succeeded — which is never during boot, and
   * often not at all in a session spent writing. Paying for it up front buys
   * nothing.
   *
   * Cached after the first load, so switching documents does not re-import.
   */
  let pdfjs: typeof import("pdfjs-dist") | null = null;

  async function loadPdfjs() {
    if (pdfjs) return pdfjs;
    const [module, worker] = await Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
    ]);
    // Bundled and served from our own origin. The CSP in tauri.conf.json
    // permits no external hosts, so the CDN default pdf.js would otherwise
    // reach for is not an option — which is correct, not a limitation.
    module.GlobalWorkerOptions.workerSrc = worker.default;
    pdfjs = module;
    return module;
  }

  interface Props {
    /** Raw PDF bytes, or null when nothing has been compiled yet. */
    data: Uint8Array | null;
  }

  let { data }: Props = $props();

  let container: HTMLDivElement;
  let renderError = $state<string | null>(null);

  $effect(() => {
    if (!container) return;
    const bytes = data;
    if (!bytes) {
      container.replaceChildren();
      return;
    }

    let cancelled = false;
    renderError = null;

    (async () => {
      try {
        const lib = await loadPdfjs();
        if (cancelled) return;
        // pdf.js takes ownership of the buffer it is handed, so a copy is passed
        // rather than the caller's array.
        const doc = await lib.getDocument({ data: bytes.slice() }).promise;
        if (cancelled) return;

        const rendered: HTMLCanvasElement[] = [];
        const scale = Math.min(2, window.devicePixelRatio || 1) * 1.25;

        for (let n = 1; n <= doc.numPages; n += 1) {
          const page = await doc.getPage(n);
          if (cancelled) return;
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.className = "page";
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          // pdf.js wants the canvas itself from 5.x onward, not only its 2D
          // context. On 4.x passing `canvas` was rejected as an unknown
          // property, so this argument flips with the major version.
          await page.render({ canvas, canvasContext: ctx, viewport }).promise;
          if (cancelled) return;
          rendered.push(canvas);
        }

        container.replaceChildren(...rendered);
      } catch (error) {
        if (!cancelled) renderError = String(error);
      }
    })();

    return () => {
      cancelled = true;
    };
  });
</script>

<div class="pdf">
  {#if renderError}
    <p class="notice error">{renderError}</p>
  {:else if !data}
    <p class="notice">{t("pdf-empty")}</p>
  {/if}
  <div class="pages" bind:this={container}></div>
</div>

<style>
  .pdf {
    block-size: 100%;
    overflow: auto;
    background: var(--yaz-pdf-bg);
    padding-block: var(--yaz-space-4);
  }

  .pages {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--yaz-space-4);
  }

  .pdf :global(.page) {
    max-inline-size: 100%;
    block-size: auto;
    box-shadow: 0 2px 12px var(--yaz-pdf-page-shadow);
    background: var(--yaz-bg-primary);
  }

  .notice {
    color: var(--yaz-text-muted);
    text-align: center;
    font-family: var(--yaz-font-ui);
    padding: var(--yaz-space-6);
    margin: 0;
  }

  .notice.error {
    color: var(--yaz-error);
    font-family: var(--yaz-font-mono);
    text-align: start;
    white-space: pre-wrap;
  }
</style>
