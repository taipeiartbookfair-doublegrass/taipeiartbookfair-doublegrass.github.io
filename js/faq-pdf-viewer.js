/**
 * FAQ PDF 檢視器：不用 <iframe> 讓瀏覽器內建的 PDF 檢視器處理（手機瀏覽器大多不支援
 * 在 iframe 裡面滑動翻頁），改用 PDF.js 把每一頁畫成 <canvas>、直接放進頁面 DOM。
 * 這樣它就是普通的 HTML 內容，會被 .scroll-inner 原本的 overflow 捲動處理，
 * 手機滑動、桌機滾輪都跟頁面其他內容一樣正常運作。
 */
(function () {
  const PDF_URL = "dashboard/faq.pdf";
  const PDF_WORKER_URL =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js";

  const container = document.getElementById("faq-pdf-viewer");
  const faqSection = document.getElementById("faq");
  if (!container || !faqSection || typeof pdfjsLib === "undefined") return;

  pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;

  let rendered = false;

  function renderPage(pdf, pageNum) {
    return pdf.getPage(pageNum).then((page) => {
      const containerWidth = container.clientWidth || 800;
      const unscaledViewport = page.getViewport({ scale: 1 });
      const scale = containerWidth / unscaledViewport.width;
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      canvas.className = "faq-pdf-page";
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      const context = canvas.getContext("2d");
      container.appendChild(canvas);

      return page.render({ canvasContext: context, viewport }).promise;
    });
  }

  function renderPdf() {
    if (rendered) return;
    rendered = true;

    container.innerHTML = '<div class="faq-pdf-loading">PDF 載入中… Loading…</div>';

    pdfjsLib
      .getDocument(PDF_URL)
      .promise.then((pdf) => {
        container.innerHTML = "";
        let chain = Promise.resolve();
        for (let i = 1; i <= pdf.numPages; i++) {
          chain = chain.then(() => renderPage(pdf, i));
        }
        return chain;
      })
      .catch((err) => {
        console.warn("[faq-pdf-viewer] render error", err);
        container.innerHTML =
          '<div class="faq-pdf-error">PDF 載入失敗，<a href="' +
          PDF_URL +
          '" target="_blank" rel="noopener">請點此在新分頁開啟</a></div>';
      });
  }

  // 懶渲染：FAQ 面板真的被打開（style.display 不是 none）才去載入/畫 PDF，
  // 避免拖慢一開始整個 dashboard 頁面的載入
  function checkVisibility() {
    if (faqSection.style.display !== "none") renderPdf();
  }

  const observer = new MutationObserver(checkVisibility);
  observer.observe(faqSection, { attributes: true, attributeFilter: ["style", "class"] });
  checkVisibility();
})();
