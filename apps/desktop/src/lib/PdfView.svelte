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
    /**
     * A page was clicked.
     *
     * `x` and `y` are PDF points from the top left of that page — the
     * coordinate system SyncTeX records in, converted here because this is the
     * only place that knows the page's size and the scale it was drawn at.
     */
    onclickpoint?: ((page: number, x: number, y: number) => void) | undefined;
  }

  let { data, onclickpoint }: Props = $props();

  let container: HTMLDivElement;
  let renderError = $state<string | null>(null);

  /**
   * Turn a click on a page into a point on that page.
   *
   * The canvas is drawn at a device scale and then laid out at whatever width
   * the pane gives it, so neither the bitmap's size nor the scale it was drawn
   * at is what the pointer landed on. The element's rendered box is, which is
   * why the ratio is taken from `getBoundingClientRect` and multiplied by the
   * page's size in points.
   */
  function onpageclick(event: MouseEvent) {
    if (!onclickpoint) return;
    const canvas = (event.target as HTMLElement | null)?.closest?.("canvas.page");
    if (!(canvas instanceof HTMLCanvasElement)) return;

    const page = Number(canvas.dataset.page);
    const width = Number(canvas.dataset.width);
    const height = Number(canvas.dataset.height);
    if (!page || !width || !height) return;

    const box = canvas.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;
    onclickpoint(
      page,
      ((event.clientX - box.left) / box.width) * width,
      ((event.clientY - box.top) / box.height) * height,
    );
  }

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
          // The page's own size, which is what a click has to be expressed in.
          // Taken from the unscaled viewport rather than divided out of the
          // scaled one, so a change to how the page is drawn cannot silently
          // move where a click lands.
          const unscaled = page.getViewport({ scale: 1 });
          canvas.dataset.page = String(n);
          canvas.dataset.width = String(unscaled.width);
          canvas.dataset.height = String(unscaled.height);
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
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="pages" bind:this={container} onclick={onpageclick}></div>
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

  /* The pages answer a click by moving the cursor in the source, so they read
     as something to point at. */
  .pdf :global(.page) {
    cursor: pointer;
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
