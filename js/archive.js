(function () {
  // TODO: 部署完 ARCHIVE 試算表專用的 Apps Script 後，把下面換成你拿到的 /exec 網址
  const ARCHIVE_API =
    "https://script.google.com/macros/s/AKfycbym6pO2HK3Reu0kTYV8_by2kf33d5nukcN0TBzmpOc_P0o7aEsOPesJZ9VuRjb0TzaEaA/exec";

  const GITHUB_OWNER = "taipeiartbookfair-doublegrass";
  const GITHUB_REPO = "taipeiartbookfair-doublegrass.github.io";
  const GITHUB_PHOTO_BASE_PATH = "image/archive"; // image/archive/{year}/*.jpg

  const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp)$/i;

  // 跟 timeline-visit.js 用同一個 Google Calendar，只是每年查詢的日期範圍不同
  const CALENDAR_ID =
    "90527f67fa462c83e184b0c62def10ebc8b00cc8c67a5b83af2afb90a1bdb293@group.calendar.google.com";
  const CALENDAR_API_KEY = "AIzaSyCOLToQuZFbB1mULxYrMyQVeTVGnhk8-U4";

  const loadingEl = document.getElementById("archive-loading");
  const listEl = document.getElementById("archive-list");
  const emptyEl = document.getElementById("archive-empty");

  function withBr(text) {
    return String(text || "").replace(/\n/g, "<br>");
  }

  // ===== 試算表資料 pivot =====
  // info 是「一列一個欄位」的長格式，依 年份 + id 轉成 { year: { title:{zh,en}, subtitle:{zh,en}, desc:{zh,en} } }
  function pivotInfo(rows) {
    const byYear = {};
    (rows || []).forEach((row) => {
      const year = String(row["年份"] || row["year"] || "").trim();
      const id = String(row["id"] || "").trim();
      if (!year || !id) return;
      if (!byYear[year]) byYear[year] = {};
      byYear[year][id] = {
        zh: (row["content(中)"] || row["content_zh"] || "").toString().trim(),
        en: (row["content(英)"] || row["content_en"] || "").toString().trim(),
      };
    });
    return byYear;
  }

  function groupExhibitors(rows) {
    const byYear = {};
    (rows || []).forEach((row) => {
      const year = String(row["年份"] || row["year"] || "").trim();
      if (!year) return;
      if (!byYear[year]) byYear[year] = [];
      byYear[year].push(row);
    });
    return byYear;
  }

  function pick(field) {
    if (!field) return "";
    return (field.zh || field.en || "").toString();
  }

  // ===== GitHub 照片資料夾 =====
  const photoCache = {}; // year -> Promise<string[]>

  function loadYearPhotos(year) {
    if (photoCache[year]) return photoCache[year];
    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_PHOTO_BASE_PATH}/${encodeURIComponent(year)}`;
    photoCache[year] = fetch(url)
      .then((r) => {
        if (!r.ok) return [];
        return r.json();
      })
      .then((files) => {
        if (!Array.isArray(files)) return [];
        return files
          .filter((f) => f.type === "file" && IMAGE_EXT_RE.test(f.name))
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((f) => f.download_url);
      })
      .catch(() => []);
    return photoCache[year];
  }

  // ===== Programs（掃該年展期範圍的 Google Calendar 活動）=====
  const programsCache = {}; // year -> Promise<event[]>

  function loadYearPrograms(year, dateStart, dateEnd) {
    if (programsCache[year]) return programsCache[year];
    if (!dateStart || !dateEnd) {
      programsCache[year] = Promise.resolve([]);
      return programsCache[year];
    }
    const timeMin = new Date(dateStart + "T00:00:00+08:00").toISOString();
    const timeMax = new Date(dateEnd + "T23:59:59+08:00").toISOString();
    const url =
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}` +
      `/events?key=${CALENDAR_API_KEY}&singleEvents=true&orderBy=startTime&timeMin=${timeMin}&timeMax=${timeMax}`;
    programsCache[year] = fetch(url)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data) => data.items || [])
      .catch(() => []);
    return programsCache[year];
  }

  function cleanEventDescription(desc) {
    return String(desc || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .trim();
  }

  function formatEventDateTime(event) {
    const startInfo = event.start || {};
    const endInfo = event.end || {};
    if (startInfo.dateTime) {
      const start = new Date(startInfo.dateTime);
      const end = endInfo.dateTime ? new Date(endInfo.dateTime) : null;
      const dateStr = start.toLocaleDateString("zh-TW", {
        month: "2-digit",
        day: "2-digit",
      });
      const startTime = start.toLocaleTimeString("zh-TW", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      const endTime = end
        ? end.toLocaleTimeString("zh-TW", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          })
        : "";
      return dateStr + " " + startTime + (endTime ? "–" + endTime : "");
    }
    if (startInfo.date) {
      const start = new Date(startInfo.date + "T00:00:00");
      return start.toLocaleDateString("zh-TW", {
        month: "2-digit",
        day: "2-digit",
      });
    }
    return "";
  }

  function createProgramItem(event) {
    const el = document.createElement("div");
    el.className = "archive-program-item";

    const timeEl = document.createElement("div");
    timeEl.className = "archive-program-time";
    timeEl.textContent = formatEventDateTime(event);

    const bodyEl = document.createElement("div");
    bodyEl.className = "archive-program-body";

    const titleEl = document.createElement("div");
    titleEl.className = "archive-program-title";
    titleEl.textContent = event.summary || "(無標題)";
    bodyEl.appendChild(titleEl);

    const desc = cleanEventDescription(event.description);
    if (desc) {
      const descEl = document.createElement("div");
      descEl.className = "archive-program-desc";
      descEl.innerHTML = withBr(desc);
      bodyEl.appendChild(descEl);
    }

    el.appendChild(timeEl);
    el.appendChild(bodyEl);
    return el;
  }

  // ===== 燈箱 =====
  const lightboxEl = document.getElementById("archive-lightbox");
  const lightboxImg = document.getElementById("archive-lightbox-img");
  const lightboxBackdrop = document.getElementById("archive-lightbox-backdrop");
  const lightboxClose = document.getElementById("archive-lightbox-close");
  const lightboxPrev = document.getElementById("archive-lightbox-prev");
  const lightboxNext = document.getElementById("archive-lightbox-next");
  let lightboxPhotos = [];
  let lightboxIndex = 0;

  function openLightbox(photos, index) {
    lightboxPhotos = photos;
    lightboxIndex = index;
    updateLightboxImg();
    lightboxEl.setAttribute("aria-hidden", "false");
  }

  function closeLightbox() {
    lightboxEl.setAttribute("aria-hidden", "true");
  }

  function updateLightboxImg() {
    lightboxImg.src = lightboxPhotos[lightboxIndex] || "";
  }

  lightboxBackdrop.addEventListener("click", closeLightbox);
  lightboxClose.addEventListener("click", closeLightbox);
  lightboxPrev.addEventListener("click", () => {
    if (!lightboxPhotos.length) return;
    lightboxIndex =
      (lightboxIndex - 1 + lightboxPhotos.length) % lightboxPhotos.length;
    updateLightboxImg();
  });
  lightboxNext.addEventListener("click", () => {
    if (!lightboxPhotos.length) return;
    lightboxIndex = (lightboxIndex + 1) % lightboxPhotos.length;
    updateLightboxImg();
  });
  document.addEventListener("keydown", (e) => {
    if (lightboxEl.getAttribute("aria-hidden") === "true") return;
    if (e.key === "Escape") closeLightbox();
    if (e.key === "ArrowLeft") lightboxPrev.click();
    if (e.key === "ArrowRight") lightboxNext.click();
  });

  // ===== 攤商卡片（跟 ticket&visit 的 exhibitor-display.js 同一套結構/樣式）=====
  function createExhibitorCard(row) {
    const brand = row["品牌"] || "";
    const boothNumber = row["攤商編號"] || "-";
    const region = row["region"] || row["國籍"] || "TW";
    const description = row["品牌簡介"] || "暫無簡介";

    const card = document.createElement("div");
    card.className = "exhibitor-card-main";

    const basicInfo = document.createElement("div");
    basicInfo.className = "exhibitor-basic-info";

    const brandDisplay = document.createElement("div");
    brandDisplay.className = "exhibitor-brand-display";
    brandDisplay.textContent = brand || "Unknown";

    const metaInfo = document.createElement("div");
    metaInfo.className = "exhibitor-meta-info";

    const boothDisplay = document.createElement("span");
    boothDisplay.className = "exhibitor-booth-display";
    boothDisplay.textContent = boothNumber;

    const nationalityDisplay = document.createElement("span");
    nationalityDisplay.className = "exhibitor-nationality-display";
    nationalityDisplay.textContent = region;

    metaInfo.appendChild(boothDisplay);
    metaInfo.appendChild(nationalityDisplay);
    basicInfo.appendChild(brandDisplay);
    basicInfo.appendChild(metaInfo);

    const details = document.createElement("div");
    details.className = "exhibitor-details";

    const detailsContent = document.createElement("div");
    detailsContent.className = "exhibitor-details-content";

    const descEl = document.createElement("div");
    descEl.className = "exhibitor-description";
    descEl.textContent = description;
    detailsContent.appendChild(descEl);

    const socialLinks = document.createElement("div");
    socialLinks.className = "exhibitor-social-links";

    if (row["facebook"]) {
      const a = document.createElement("a");
      a.href = row["facebook"];
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.className = "exhibitor-social-link facebook";
      a.textContent = "Facebook";
      socialLinks.appendChild(a);
    }
    if (row["instagram"]) {
      const a = document.createElement("a");
      a.href = row["instagram"];
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.className = "exhibitor-social-link instagram";
      a.textContent = "Instagram";
      socialLinks.appendChild(a);
    }
    if (row["website"]) {
      const a = document.createElement("a");
      a.href = row["website"];
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.className = "exhibitor-social-link website";
      a.textContent = "Website";
      socialLinks.appendChild(a);
    }

    details.appendChild(detailsContent);
    details.appendChild(socialLinks);
    card.appendChild(basicInfo);
    card.appendChild(details);

    card.addEventListener("click", (e) => {
      e.stopPropagation();
      const isExpanded = details.classList.contains("expanded");
      card
        .closest(".archive-year-exhibitors-grid")
        .querySelectorAll(".exhibitor-details.expanded")
        .forEach((d) => {
          if (d !== details) d.classList.remove("expanded");
        });
      details.classList.toggle("expanded", !isExpanded);
    });

    return card;
  }

  // ===== 折疊清單 =====
  function toggleYear(itemEl, year) {
    const isOpen = itemEl.classList.contains("open");
    listEl.querySelectorAll(".archive-year-item.open").forEach((el) => {
      if (el !== itemEl) closeYear(el);
    });
    if (isOpen) {
      closeYear(itemEl);
    } else {
      openYear(itemEl, year);
    }
  }

  function refreshPanelHeight(itemEl) {
    const panel = itemEl.querySelector(".archive-year-panel");
    if (panel && itemEl.classList.contains("open")) {
      panel.style.maxHeight = panel.scrollHeight + "px";
    }
  }

  function openYear(itemEl, year) {
    itemEl.classList.add("open");
    const header = itemEl.querySelector(".archive-year-header");
    if (header) header.setAttribute("aria-expanded", "true");
    refreshPanelHeight(itemEl);

    // Programs 是懶載入：第一次展開才去掃該年展期範圍的 Google Calendar
    if (!itemEl.dataset.programsLoaded) {
      itemEl.dataset.programsLoaded = "1";
      const dateStart = itemEl.dataset.dateStart || "";
      const dateEnd = itemEl.dataset.dateEnd || "";
      const programsLabelEl = itemEl.querySelector(
        ".archive-year-programs-label"
      );
      const programsListEl = itemEl.querySelector(
        ".archive-year-programs-list"
      );
      loadYearPrograms(year, dateStart, dateEnd).then((events) => {
        if (!events.length || !programsListEl) return;
        if (programsLabelEl) programsLabelEl.style.display = "";
        events.forEach((ev) => {
          programsListEl.appendChild(createProgramItem(ev));
        });
        refreshPanelHeight(itemEl);
      });
    }

    // 照片是懶載入：第一次展開才去抓 GitHub 資料夾
    if (!itemEl.dataset.photosLoaded) {
      itemEl.dataset.photosLoaded = "1";
      const coverEl = itemEl.querySelector(".archive-year-cover");
      const photosEl = itemEl.querySelector(".archive-year-photos");
      loadYearPhotos(year).then((photos) => {
        if (!photos.length) {
          if (coverEl) coverEl.style.display = "none";
          return;
        }
        const [cover, ...rest] = photos;
        if (coverEl) {
          coverEl.src = cover;
          coverEl.style.display = "block";
          coverEl.addEventListener("click", () => openLightbox(photos, 0));
        }
        rest.forEach((url, i) => {
          const img = document.createElement("img");
          img.src = url;
          img.alt = "";
          img.loading = "lazy";
          img.addEventListener("click", () => openLightbox(photos, i + 1));
          photosEl.appendChild(img);
        });
        refreshPanelHeight(itemEl);
      });
    }
  }

  function closeYear(itemEl) {
    itemEl.classList.remove("open");
    const header = itemEl.querySelector(".archive-year-header");
    if (header) header.setAttribute("aria-expanded", "false");
    const panel = itemEl.querySelector(".archive-year-panel");
    if (panel) panel.style.maxHeight = "0px";
  }

  function buildYearItem(year, fields, exhibitors) {
    const title = pick(fields.title) || year;
    const subtitle = pick(fields.subtitle);
    const desc = pick(fields.desc);
    const dateStart = pick(fields.date_start);
    const dateEnd = pick(fields.date_end);

    const itemEl = document.createElement("div");
    itemEl.className = "archive-year-item";
    itemEl.dataset.dateStart = dateStart;
    itemEl.dataset.dateEnd = dateEnd;

    const header = document.createElement("button");
    header.type = "button";
    header.className = "archive-year-header";
    header.setAttribute("aria-expanded", "false");
    header.innerHTML =
      '<span class="archive-year-num">' +
      year +
      '</span><span class="archive-year-title">' +
      (title || "") +
      '</span><span class="archive-year-toggle" aria-hidden="true">+</span>';
    header.addEventListener("click", () => toggleYear(itemEl, year));

    const panel = document.createElement("div");
    panel.className = "archive-year-panel";

    const panelInner = document.createElement("div");
    panelInner.className = "archive-year-panel-inner";

    const coverImg = document.createElement("img");
    coverImg.className = "archive-year-cover";
    coverImg.style.display = "none";
    coverImg.alt = title || year;
    panelInner.appendChild(coverImg);

    if (subtitle) {
      const subtitleEl = document.createElement("p");
      subtitleEl.className = "archive-year-subtitle";
      subtitleEl.textContent = subtitle;
      panelInner.appendChild(subtitleEl);
    }

    if (desc) {
      const descEl = document.createElement("p");
      descEl.className = "archive-year-desc";
      descEl.innerHTML = withBr(desc);
      panelInner.appendChild(descEl);
    }

    const programsLabel = document.createElement("div");
    programsLabel.className = "archive-year-programs-label";
    programsLabel.style.display = "none"; // 抓到活動才顯示
    programsLabel.textContent = "活動節目 Programs";
    panelInner.appendChild(programsLabel);

    const programsListEl = document.createElement("div");
    programsListEl.className = "archive-year-programs-list";
    panelInner.appendChild(programsListEl);

    const photosEl = document.createElement("div");
    photosEl.className = "archive-year-photos";
    panelInner.appendChild(photosEl);

    if (exhibitors && exhibitors.length) {
      const label = document.createElement("div");
      label.className = "archive-year-exhibitors-label";
      label.textContent = "參展品牌 Exhibitors";
      panelInner.appendChild(label);

      const exhibitorsGrid = document.createElement("div");
      exhibitorsGrid.className =
        "archive-year-exhibitors-grid exhibitors-grid-main";
      exhibitors.forEach((row) => {
        exhibitorsGrid.appendChild(createExhibitorCard(row));
      });
      panelInner.appendChild(exhibitorsGrid);
    }

    panel.appendChild(panelInner);
    itemEl.appendChild(header);
    itemEl.appendChild(panel);
    return itemEl;
  }

  function render(infoByYear, exhibitorsByYear) {
    listEl.innerHTML = "";

    const years = new Set([
      ...Object.keys(infoByYear),
      ...Object.keys(exhibitorsByYear),
    ]);

    if (!years.size) {
      emptyEl.style.display = "block";
      return;
    }
    emptyEl.style.display = "none";

    const sortedYears = Array.from(years).sort((a, b) => {
      const ya = parseInt(a, 10);
      const yb = parseInt(b, 10);
      if (!isNaN(ya) && !isNaN(yb)) return yb - ya;
      return String(b).localeCompare(String(a));
    });

    sortedYears.forEach((year) => {
      const fields = infoByYear[year] || {};
      const exhibitors = exhibitorsByYear[year] || [];
      listEl.appendChild(buildYearItem(year, fields, exhibitors));
    });
  }

  fetch(ARCHIVE_API)
    .then((r) => r.json())
    .then((response) => {
      const infoByYear = pivotInfo(response && response.info);
      const exhibitorsByYear = groupExhibitors(response && response.exhibitors);
      loadingEl.style.display = "none";
      render(infoByYear, exhibitorsByYear);
    })
    .catch((err) => {
      console.warn("[archive] fetch error", err);
      loadingEl.textContent = "載入失敗：" + (err.message || "請稍後再試");
    });

  // 回到頂部
  const backToTop = document.getElementById("backToTop");
  if (backToTop) {
    window.addEventListener("scroll", () => {
      backToTop.style.display = window.pageYOffset > 300 ? "flex" : "none";
    });
    backToTop.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }
})();
