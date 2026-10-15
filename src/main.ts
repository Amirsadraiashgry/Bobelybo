import "./styles.css";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

type Book = {
  id: number;
  name: string;
  size: string;
  addedAt: string;
  file: File;
};

const $ = <T extends HTMLElement>(selector: string) =>
  document.querySelector<T>(selector);

const bookGrid = $("#book-grid")!;
const emptyState = $("#empty-state")!;
const bookCount = $("#book-count")!;
const resultsCount = $("#results-count")!;
const searchInput = $("#book-search") as HTMLInputElement;
const pdfInput = $("#pdf-input") as HTMLInputElement;
const toast = $("#toast")!;

let books: Book[] = [];
let activeFilter = "all";
let activeView = "library";
let toastTimeout: number | undefined;

const readerOverlay = $("#reader-overlay")!;
const readerTitle = $("#reader-book-title")!;
const readerLoading = $("#reader-loading")!;
const pdfCanvas = $("#pdf-canvas") as HTMLCanvasElement;
const pdfStage = $("#pdf-stage")!;
const pageNumberInput = $("#page-number") as HTMLInputElement;
const pageTotal = $("#page-total")!;
const zoomLabel = $("#zoom-label")!;
const prevPageButton = $("#prev-page") as HTMLButtonElement;
const nextPageButton = $("#next-page") as HTMLButtonElement;
const pagePrevButton = $("#page-prev") as HTMLButtonElement;
const pageNextButton = $("#page-next") as HTMLButtonElement;

let currentPdf: pdfjsLib.PDFDocumentProxy | null = null;
let currentRenderTask: { cancel: () => void; promise: Promise<void> } | null = null;
let currentPage = 1;
let currentZoom = 1;
let renderSequence = 0;

function toPersianNumber(value: number): string {
  return value.toLocaleString("fa-IR");
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)} کیلوبایت`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} مگابایت`;
}

function showToast(message: string): void {
  toast.textContent = message;
  toast.classList.add("visible");

  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => {
    toast.classList.remove("visible");
  }, 3000);
}

function openFilePicker(): void {
  pdfInput.click();
}

function getVisibleBooks(): Book[] {
  const query = searchInput.value.trim().toLocaleLowerCase("fa");

  return books.filter((book) => {
    const matchesQuery = book.name.toLocaleLowerCase("fa").includes(query);
    const matchesFilter = activeFilter === "all" || activeFilter === "pdf";
    const matchesView = activeView === "library" || activeView === "recent";

    return matchesQuery && matchesFilter && matchesView;
  });
}

function createBookCard(book: Book): HTMLElement {
  const card = document.createElement("article");
  card.className = "book-card";

  const cover = document.createElement("div");
  cover.className = "book-cover";
  cover.innerHTML = `
    <div class="cover-topline"><span>BOBELYBO</span><span>PDF</span></div>
    <div class="cover-art"><span class="cover-orbit"></span><span class="cover-letter">ب</span></div>
    <div class="cover-bottomline"><span></span><span></span><span></span></div>
  `;

  const details = document.createElement("div");
  details.className = "book-details";

  const title = document.createElement("h3");
  title.className = "book-title";
  title.textContent = book.name;

  const meta = document.createElement("p");
  meta.className = "book-meta";
  meta.textContent = `PDF · ${book.size}`;

  const actions = document.createElement("div");
  actions.className = "book-actions";

  const openButton = document.createElement("button");
  openButton.className = "book-open-button";
  openButton.textContent = "باز کردن کتاب";
  openButton.addEventListener("click", () => {
    void openReader(book);
  });

  cover.style.cursor = "pointer";
  cover.title = "باز کردن کتاب";
  cover.addEventListener("click", () => {
    void openReader(book);
  });

  const moreButton = document.createElement("button");
  moreButton.className = "book-more-button";
  moreButton.textContent = "⋯";
  moreButton.title = "حذف از فهرست";
  moreButton.setAttribute("aria-label", `حذف ${book.name} از کتابخانه`);
  moreButton.addEventListener("click", () => {
    books = books.filter((item) => item.id !== book.id);
    renderBooks();
    showToast("کتاب از فهرست این نشست حذف شد؛ فایل اصلی دست‌نخورده است.");
  });

  actions.append(openButton, moreButton);
  details.append(title, meta, actions);
  card.append(cover, details);

  return card;
}


async function renderPdfPage(): Promise<void> {
  if (!currentPdf) return;

  const sequence = ++renderSequence;

  if (currentRenderTask) {
    const oldTask = currentRenderTask;
    currentRenderTask = null;
    oldTask.cancel();
    try {
      await oldTask.promise;
    } catch {
      // لغو رندر قبلی هنگام جابه‌جایی صفحه طبیعی است.
    }
  }

  if (sequence !== renderSequence || !currentPdf) return;

  try {
    currentPage = Math.max(1, Math.min(currentPage, currentPdf.numPages));
    pageNumberInput.value = String(currentPage);

    const page = await currentPdf.getPage(currentPage);
    if (sequence !== renderSequence || !currentPdf) return;

    const baseViewport = page.getViewport({ scale: 1 });
    const availableWidth = Math.max(200, pdfStage.clientWidth - 32);
    const fitScale = Math.min(1, availableWidth / baseViewport.width);
    const viewport = page.getViewport({ scale: fitScale * currentZoom });
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

    const context = pdfCanvas.getContext("2d");
    if (!context) throw new Error("امکان ساخت بوم نمایش PDF وجود ندارد.");

    pdfCanvas.width = Math.floor(viewport.width * pixelRatio);
    pdfCanvas.height = Math.floor(viewport.height * pixelRatio);
    pdfCanvas.style.width = `${viewport.width}px`;
    pdfCanvas.style.height = `${viewport.height}px`;
    pdfCanvas.hidden = false;
    readerLoading.hidden = true;

    const task = page.render({
      canvasContext: context,
      viewport,
      transform: pixelRatio === 1
        ? undefined
        : [pixelRatio, 0, 0, pixelRatio, 0, 0],
    });

    currentRenderTask = task;

    await task.promise;

    if (sequence !== renderSequence) return;
    currentRenderTask = null;

    pageTotal.textContent = toPersianNumber(currentPdf.numPages);
    zoomLabel.textContent = `${toPersianNumber(Math.round(currentZoom * 100))}٪`;

    const atFirstPage = currentPage <= 1;
    const atLastPage = currentPage >= currentPdf.numPages;

    prevPageButton.disabled = atFirstPage;
    pagePrevButton.disabled = atFirstPage;
    nextPageButton.disabled = atLastPage;
    pageNextButton.disabled = atLastPage;
  } catch (error) {
    if (sequence !== renderSequence) return;

    currentRenderTask = null;
    const message = error instanceof Error ? error.message : String(error);
    readerLoading.hidden = false;
    readerLoading.textContent = "نمایش این صفحه با خطا مواجه شد.";
    pdfCanvas.hidden = true;
    showToast(`خطا در نمایش PDF: ${message}`);
  }
}

async function openReader(book: Book): Promise<void> {
  try {
    readerOverlay.hidden = false;
    readerTitle.textContent = book.name;
    readerLoading.hidden = false;
    readerLoading.textContent = "در حال بازکردن کتاب…";
    pdfCanvas.hidden = true;

    if (currentRenderTask) {
      const oldTask = currentRenderTask;
      currentRenderTask = null;
      oldTask.cancel();
      try {
        await oldTask.promise;
      } catch {
        // رندر قبلی ممکن است هنگام تعویض کتاب لغو شود.
      }
    }

    renderSequence++;

    if (currentPdf) {
      const oldPdf = currentPdf;
      currentPdf = null;
      await oldPdf.destroy();
    }

    const data = new Uint8Array(await book.file.arrayBuffer());

    const loadingTask = pdfjsLib.getDocument({
      data,
      disableFontFace: true,
    });

    const pdf = await loadingTask.promise;

    if (readerOverlay.hidden) {
      await pdf.destroy();
      return;
    }

    currentPdf = pdf;
    currentPage = 1;
    currentZoom = 1;

    pageNumberInput.min = "1";
    pageNumberInput.max = String(pdf.numPages);
    pageNumberInput.value = "1";
    pageTotal.textContent = toPersianNumber(pdf.numPages);
    zoomLabel.textContent = "۱۰۰٪";

    await renderPdfPage();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    readerLoading.hidden = false;
    readerLoading.textContent = "فایل PDF باز نشد.";
    showToast(`بازکردن کتاب ناموفق بود: ${message}`);
  }
}

function closeReader(): void {
  renderSequence++;

  if (currentRenderTask) {
    currentRenderTask.cancel();
    currentRenderTask = null;
  }

  if (currentPdf) {
    void currentPdf.destroy();
    currentPdf = null;
  }

  readerOverlay.hidden = true;
  pdfCanvas.hidden = true;
  readerLoading.hidden = false;
  readerLoading.textContent = "در حال آماده‌سازی کتاب…";
}

function changePage(delta: number): void {
  if (!currentPdf) return;

  const target = currentPage + delta;
  if (target < 1 || target > currentPdf.numPages) return;

  currentPage = target;
  void renderPdfPage();
}

$("#reader-close")!.addEventListener("click", closeReader);
prevPageButton.addEventListener("click", () => changePage(-1));
pagePrevButton.addEventListener("click", () => changePage(-1));
nextPageButton.addEventListener("click", () => changePage(1));
pageNextButton.addEventListener("click", () => changePage(1));

pageNumberInput.addEventListener("change", () => {
  if (!currentPdf) return;

  const requestedPage = Number.parseInt(pageNumberInput.value, 10);
  if (!Number.isFinite(requestedPage)) {
    pageNumberInput.value = String(currentPage);
    return;
  }

  currentPage = Math.max(1, Math.min(requestedPage, currentPdf.numPages));
  void renderPdfPage();
});

$("#zoom-in")!.addEventListener("click", () => {
  currentZoom = Math.min(2.5, Math.round((currentZoom + 0.15) * 100) / 100);
  if (currentPdf) void renderPdfPage();
  zoomLabel.textContent = `${toPersianNumber(Math.round(currentZoom * 100))}٪`;
});

$("#zoom-out")!.addEventListener("click", () => {
  currentZoom = Math.max(0.5, Math.round((currentZoom - 0.15) * 100) / 100);
  if (currentPdf) void renderPdfPage();
  zoomLabel.textContent = `${toPersianNumber(Math.round(currentZoom * 100))}٪`;
});

window.addEventListener("resize", () => {
  if (currentPdf && !readerOverlay.hidden) {
    void renderPdfPage();
  }
});

function renderBooks(): void {
  const visibleBooks = getVisibleBooks();
  bookGrid.replaceChildren();

  visibleBooks.forEach((book) => {
    bookGrid.append(createBookCard(book));
  });

  bookCount.textContent = toPersianNumber(books.length);
  resultsCount.textContent = books.length
    ? `${toPersianNumber(visibleBooks.length)} کتاب`
    : "هنوز کتابی اضافه نشده";

  const hasBooks = visibleBooks.length > 0;
  emptyState.hidden = hasBooks;
  bookGrid.hidden = !hasBooks;

  if (books.length > 0 && !hasBooks) {
    $("#empty-title")!.textContent = "کتابی پیدا نشد";
    $("#empty-description")!.textContent =
      "عبارت جست‌وجو یا فیلتر انتخاب‌شده را تغییر بده.";
    $("#empty-add-book")!.classList.add("secondary-button");
  } else {
    $("#empty-title")!.textContent = "کتابخانه‌ات را بساز";
    $("#empty-description")!.textContent =
      "اولین کتاب PDF را اضافه کن تا مجموعهٔ شخصی‌ات اینجا شکل بگیرد.";
    $("#empty-add-book")!.classList.remove("secondary-button");
  }
}

function selectView(view: string, label: string): void {
  activeView = view;

  document.querySelectorAll<HTMLButtonElement>(".nav-item[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });

  $("#breadcrumb-current")!.textContent = label;
  $("#section-title")!.textContent =
    view === "library" ? "کتابخانهٔ من" : label;

  if (view === "notes" || view === "bookmarks") {
    showToast(`${label} در مرحلهٔ بعدی توسعه پیاده‌سازی می‌شود.`);
    selectView("library", "کتابخانه");
    return;
  }

  if (view === "recent") {
    showToast("فهرست مطالعهٔ اخیر پس از اضافه‌شدن تاریخچهٔ مطالعه فعال می‌شود.");
  }

  renderBooks();
}

$("#add-book")!.addEventListener("click", openFilePicker);
$("#empty-add-book")!.addEventListener("click", openFilePicker);

pdfInput.addEventListener("change", () => {
  const selectedFiles = Array.from(pdfInput.files ?? []);
  let added = 0;

  for (const file of selectedFiles) {
    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      continue;
    }

    const duplicate = books.some(
      (book) => book.name === file.name && book.size === formatSize(file.size),
    );

    if (duplicate) continue;

    books.push({
      id: Date.now() + added,
      name: file.name.replace(/\.pdf$/i, ""),
      size: formatSize(file.size),
      addedAt: new Date().toISOString(),
      file,
    });
    added++;
  }

  if (added > 0) {
    activeView = "library";
    document.querySelectorAll<HTMLButtonElement>(".nav-item[data-view]").forEach((button) => {
      button.classList.toggle("active", button.dataset.view === "library");
    });
    $("#breadcrumb-current")!.textContent = "کتابخانه";
    $("#section-title")!.textContent = "کتابخانهٔ من";
    activeFilter = "all";
    document.querySelectorAll<HTMLButtonElement>(".filter-chip").forEach((button) => {
      button.classList.toggle("selected", button.dataset.filter === "all");
    });
    searchInput.value = "";
    renderBooks();
    showToast(`${toPersianNumber(added)} کتاب به فهرست فعلی اضافه شد.`);
  } else if (selectedFiles.length > 0) {
    showToast("این فایل قبلاً اضافه شده یا PDF معتبری انتخاب نشده است.");
  }

  // اجازه می‌دهد کاربر همان فایل را دوباره انتخاب کند.
  pdfInput.value = "";
});

searchInput.addEventListener("input", renderBooks);

document.querySelectorAll<HTMLButtonElement>(".filter-chip").forEach((button) => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter ?? "all";

    document.querySelectorAll<HTMLButtonElement>(".filter-chip").forEach((chip) => {
      chip.classList.toggle("selected", chip === button);
    });

    renderBooks();
  });
});

document.querySelectorAll<HTMLButtonElement>(".nav-item[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    selectView(button.dataset.view ?? "library", button.textContent?.trim() ?? "کتابخانه");
  });
});

$("#settings-button")!.addEventListener("click", () => {
  showToast("تنظیمات پیشرفته در مرحلهٔ بعدی اضافه می‌شود.");
});

$("#theme-toggle")!.addEventListener("click", () => {
  document.body.classList.toggle("light-theme");
});

document.addEventListener("keydown", (event) => {
  if (!readerOverlay.hidden) {
    if (event.key === "Escape") {
      closeReader();
      return;
    }
    if (event.key === "ArrowLeft") changePage(1);
    if (event.key === "ArrowRight") changePage(-1);
    return;
  }

  if (event.key === "/" && !(event.target instanceof HTMLInputElement)) {
    event.preventDefault();
    searchInput.focus();
  }

  if (event.key === "Escape" && document.activeElement === searchInput) {
    searchInput.value = "";
    searchInput.blur();
    renderBooks();
  }
});

renderBooks();
