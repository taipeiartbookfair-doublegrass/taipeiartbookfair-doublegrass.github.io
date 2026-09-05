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

  function splitLines(text) {
    return String(text || "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
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

  // ===== GitHub 攤位地圖資料夾（image/archive/map/{年份}.jpg，副檔名不限）=====
  const GITHUB_MAP_PATH = "image/archive/map"; // 跟 GITHUB_PHOTO_BASE_PATH 同一層，放地圖圖檔
  let mapFolderPromise = null; // 整個資料夾只列一次，所有年份共用同一次 API 呼叫

  function loadMapFolder() {
    if (mapFolderPromise) return mapFolderPromise;
    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_MAP_PATH}`;
    mapFolderPromise = fetch(url)
      .then((r) => (r.ok ? r.json() : []))
      .then((files) => (Array.isArray(files) ? files : []))
      .catch(() => []);
    return mapFolderPromise;
  }

  // 找檔名（去掉副檔名）等於年份的那一張，例如 image/archive/map/2026.jpg
  function loadYearMap(year) {
    return loadMapFolder().then((files) => {
      const match = files.find(
        (f) =>
          f.type === "file" &&
          IMAGE_EXT_RE.test(f.name) &&
          f.name.replace(IMAGE_EXT_RE, "") === String(year),
      );
      return match ? match.download_url : "";
    });
  }

  // ===== Programs（掃該年展期範圍的 Google Calendar 活動）=====
  const programsCache = {}; // year -> Promise<event[]>

  // 接受純日期 "2026-03-18" 或完整 ISO 字串 "2026-03-17T23:00:00.000Z"，
  // 只取前 10 碼的日期部分，避免試算表儲存格格式不一致造成解析失敗
  function toDateOnly(str) {
    const s = String(str || "").trim();
    if (!s) return "";

    // 已經是純日期字串（沒有時間），直接取前 10 碼即可
    if (!/t\d{2}:\d{2}/i.test(s)) return s.slice(0, 10);

    // 帶時間的完整時間戳（試算表的日期儲存格常常這樣序列化）：不能直接切前 10 碼，
    // 那是原始字串裡的日期，不一定等於轉成台灣時區之後的日曆日期
    // （e.g. "2026-03-05T23:00:00.000Z" 切出來是 3/5，但轉成台灣時區其實是 3/6）。
    // 一律當成一個絕對時間點，換算成台灣時區的日曆日期，才會跟活動比對時用的
    // 時區基準一致。
    const d = new Date(s);
    if (isNaN(d.getTime())) return s.slice(0, 10);
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(d);
    const y = parts.find((p) => p.type === "year").value;
    const m = parts.find((p) => p.type === "month").value;
    const day = parts.find((p) => p.type === "day").value;
    return `${y}-${m}-${day}`;
  }

  function loadYearPrograms(year, dateStartRaw, dateEndRaw) {
    if (programsCache[year]) return programsCache[year];
    const dateStart = toDateOnly(dateStartRaw);
    const dateEnd = toDateOnly(dateEndRaw);
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
    const cleaned = String(desc || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .trim();

    // Archive 是歷史紀錄，不需要顯示現場報名用的 SIGN UP 欄位（跟 timeline-visit.js
    // 的 parseDescription 認得同一種格式：一行 "SIGN UP: ..."）
    return cleaned
      .split("\n")
      .filter((line) => !/^sign\s*up\s*:?/i.test(line.trim()))
      .join("\n")
      .trim();
  }

  // 解析活動描述裡的 "KEY: value" 欄位（跟 timeline-visit.js 的 parseDescription 同一種格式），
  // 但不讀取 SIGN UP —— archive 是歷史紀錄，不需要現場報名連結
  function parseEventDescription(description) {
    if (!description) return {};
    const cleanDescription = String(description)
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s+/g, "\n")
      .replace(/\s+\n/g, "\n")
      .trim();

    const fields = {};
    let currentKey = null;
    let currentValue = "";
    cleanDescription.split("\n").forEach((rawLine) => {
      const line = rawLine.trim();
      const colonIndex = line.indexOf(":");
      if (colonIndex > 0) {
        if (currentKey) fields[currentKey] = currentValue.trim();
        currentKey = line.substring(0, colonIndex).trim();
        currentValue = line.substring(colonIndex + 1).trim();
      } else if (currentKey && line) {
        currentValue += " " + line;
      }
    });
    if (currentKey) fields[currentKey] = currentValue.trim();
    delete fields["SIGN UP"];
    return fields;
  }

  // 依日期範圍（含頭尾）列出每一天，給時間軸畫日期欄用。
  // 注意：不能用 new Date(...).getFullYear()/getMonth()/getDate() 來取值——
  // 那些吃的是瀏覽器「本地時區」，但下面比對活動所屬日期時是用
  // Intl.DateTimeFormat({ timeZone: "Asia/Taipei" }) 抽取台灣時區的年月日。
  // 如果瀏覽器本地時區不是 +08:00，這兩邊算出來的日期會差一天，
  // 導致大部分活動對不到任何一欄、只剩下剛好還對得上的那一天有顯示。
  // 這裡改成純日曆日期的整數運算（配合 Date.UTC 只是拿來做加一天的進位，
  // 不代表任何實際時區），完全不經過本地時區轉換。
  function getEventDaysInRange(dateStartRaw, dateEndRaw) {
    const days = [];
    const dateStart = toDateOnly(dateStartRaw);
    const dateEnd = toDateOnly(dateEndRaw);
    if (!dateStart || !dateEnd) return days;

    const [sy, sm, sd] = dateStart.split("-").map(Number);
    const [ey, em, ed] = dateEnd.split("-").map(Number);
    if (!sy || !sm || !sd || !ey || !em || !ed) return days;

    let cursor = Date.UTC(sy, sm - 1, sd);
    const endCursor = Date.UTC(ey, em - 1, ed);
    while (cursor <= endCursor) {
      const d = new Date(cursor);
      days.push({
        year: d.getUTCFullYear(),
        month: d.getUTCMonth(),
        day: d.getUTCDate(),
      });
      cursor += 24 * 60 * 60 * 1000;
    }
    return days;
  }

  // 用台灣時區抽取一個 Date 的小時／分鐘，取代 Date.prototype.getHours()/getMinutes()
  // （本地時區），確保跟時間軸定位公式用的是同一套時區基準
  function getTaipeiHourMinute(date) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Taipei",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(date);
    return {
      hour: parseInt(parts.find((p) => p.type === "hour").value, 10),
      minute: parseInt(parts.find((p) => p.type === "minute").value, 10),
    };
  }

  // 跟 ticketvisit.html 的 Programs 時間軸同一套視覺（時間格線＋日期欄＋活動長條＋
  // 篩選按鈕＋點擊預覽），沿用同一組 CSS class（timeline-*），但整個函式吃 container 和
  // 日期範圍當參數，不靠任何固定 id ——這樣才能同一頁同時存在好幾個年份而不互相打架。
  function renderYearTimeline(container, events, eventDays) {
    container.innerHTML = "";
    if (!events.length || !eventDays.length) {
      container.innerHTML =
        '<div class="timeline-empty-state"><h3>Programs</h3><p>目前沒有活動安排</p></div>';
      return;
    }

    // 預設顯示 9:00-22:00，若有活動超出這個範圍則自動擴大，避免資料被裁掉。
    // 這裡一定要用台灣時區抽取小時／分鐘（跟下面畫活動長條時算 startHourNum 用同一套
    // 邏輯），不能用 Date.prototype.getHours()——那是本地時區，跟下面的定位公式
    // 對不起來的話，某一天的活動就會被算到畫面外面，看起來像整天都沒有活動一樣。
    let startHour = 9;
    let endHour = 22;
    events.forEach((event) => {
      if (event.start.dateTime) {
        const { hour } = getTaipeiHourMinute(new Date(event.start.dateTime));
        if (hour < startHour) startHour = hour;
      }
      if (event.end.dateTime) {
        const { hour, minute } = getTaipeiHourMinute(new Date(event.end.dateTime));
        const eh = hour + (minute > 0 ? 1 : 0);
        if (eh > endHour) endHour = eh;
      }
    });
    const timelineHeight = (endHour - startHour) * 60;
    const timelineStartY = 100;

    const mainContainer = document.createElement("div");
    mainContainer.className = "timeline-main-container dynamic-height";
    mainContainer.style.height = `${timelineHeight + 100}px`;

    const timelineArea = document.createElement("div");
    timelineArea.className = "timeline-area dynamic-height";
    timelineArea.style.height = `${timelineHeight + 100}px`;

    const previewContainer = document.createElement("div");
    previewContainer.className =
      "timeline-right-container dynamic dynamic-height";
    previewContainer.style.height = `${timelineHeight + 100}px`;
    previewContainer.innerHTML =
      '<div class="timeline-preview-default"><p>點擊左側活動查看詳情</p></div>';

    const availableWidth = timelineArea.offsetWidth || 1200;
    const dayWidth = Math.floor((availableWidth - 60) / eventDays.length);

    // 時間格線（縱軸）
    for (let hour = startHour; hour < endHour; hour++) {
      const yPosition = timelineStartY + (hour - startHour) * 60;
      const timeLine = document.createElement("div");
      timeLine.className = "timeline-time-line dynamic";
      timeLine.style.top = `${yPosition}px`;
      const timeLabel = document.createElement("div");
      timeLabel.className = "timeline-time-label dynamic";
      timeLabel.style.top = `${yPosition}px`;
      timeLabel.textContent = `${hour.toString().padStart(2, "0")}:00`;
      timelineArea.appendChild(timeLine);
      timelineArea.appendChild(timeLabel);
    }

    // 日期分區邊界線
    eventDays.forEach((_day, dayIndex) => {
      const columnStartX = 30 + dayIndex * dayWidth;
      if (dayIndex > 0) {
        const leftBorder = document.createElement("div");
        leftBorder.className = "timeline-zone-border dynamic";
        leftBorder.style.left = `${columnStartX}px`;
        leftBorder.style.top = `${timelineStartY}px`;
        leftBorder.style.height = `${timelineHeight}px`;
        timelineArea.appendChild(leftBorder);
      }
      if (dayIndex === eventDays.length - 1) {
        const rightBorder = document.createElement("div");
        rightBorder.className = "timeline-zone-border dynamic";
        rightBorder.style.left = `${columnStartX + dayWidth}px`;
        rightBorder.style.top = `${timelineStartY}px`;
        rightBorder.style.height = `${timelineHeight}px`;
        timelineArea.appendChild(rightBorder);
      }
    });

    // 日期標籤（橫軸）
    eventDays.forEach(({ year, month, day }, dayIndex) => {
      const columnStartX = 30 + dayIndex * dayWidth;
      const columnCenterX = columnStartX + dayWidth / 2;

      const dateColumn = document.createElement("div");
      dateColumn.className = "timeline-date-column dynamic";
      dateColumn.style.left = `${columnStartX}px`;
      dateColumn.style.width = `${dayWidth}px`;
      const date = new Date(
        `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00+08:00`,
      );
      const weekday = date.toLocaleDateString("en-US", {
        weekday: "short",
        timeZone: "Asia/Taipei",
      });
      const monthDay = date.toLocaleDateString("en-US", {
        month: "numeric",
        day: "numeric",
        timeZone: "Asia/Taipei",
      });
      dateColumn.textContent = `${weekday} ${monthDay}`;

      const dateLine = document.createElement("div");
      dateLine.className = "timeline-date-line dynamic";
      dateLine.style.left = `${columnCenterX}px`;
      dateLine.style.top = `${timelineStartY}px`;
      dateLine.style.height = `${timelineHeight}px`;

      timelineArea.appendChild(dateColumn);
      timelineArea.appendChild(dateLine);
    });

    // 篩選按鈕（ALL / TALK / WORKSHOP / PERFORMANCE）
    const filterContainer = document.createElement("div");
    filterContainer.className = "timeline-filter-container";
    const allEventElements = [];
    ["all", "talk", "workshop", "performance"].forEach((key) => {
      const button = document.createElement("button");
      button.className = `timeline-filter-btn ${key}`;
      button.textContent = key.toUpperCase();
      button.dataset.filter = key;
      if (key === "all") {
        button.style.backgroundColor = "#333";
        button.style.color = "#fff";
      }
      button.addEventListener("click", () => {
        filterContainer.querySelectorAll(".timeline-filter-btn").forEach((btn) => {
          btn.className = `timeline-filter-btn ${btn.dataset.filter}`;
          if (btn.dataset.filter === "all") {
            btn.style.backgroundColor = "";
            btn.style.color = "";
          }
        });
        button.className = `timeline-filter-btn ${key}`;
        if (key === "all") {
          button.style.backgroundColor = "#333";
          button.style.color = "#fff";
        }
        allEventElements.forEach((eventElement) => {
          const evType = eventElement.dataset.eventType || "default";
          eventElement.className =
            key === "all" || evType === key
              ? `timeline-event-bar dynamic ${evType} visible`
              : `timeline-event-bar dynamic ${evType} hidden`;
        });
      });
      filterContainer.appendChild(button);
    });
    timelineArea.appendChild(filterContainer);

    // 依日期分組活動
    const eventsByDay = {};
    events.forEach((event) => {
      const eventDate = new Date(event.start.dateTime || event.start.date);
      const taiwanDateFormatter = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Taipei",
        year: "numeric",
        month: "numeric",
        day: "numeric",
      });
      const dateParts = taiwanDateFormatter.formatToParts(eventDate);
      const taiwanYear = parseInt(dateParts.find((p) => p.type === "year").value, 10);
      const taiwanMonth =
        parseInt(dateParts.find((p) => p.type === "month").value, 10) - 1;
      const taiwanDay = parseInt(dateParts.find((p) => p.type === "day").value, 10);

      const dayIndex = eventDays.findIndex(
        ({ year, month, day }) =>
          taiwanYear === year && taiwanMonth === month && taiwanDay === day,
      );
      if (dayIndex === -1) return;

      const eventFields = parseEventDescription(event.description);
      const eventType = (eventFields.TYPE || "default").toLowerCase();

      const eventStartTime = new Date(event.start.dateTime || event.start.date);
      const eventEndTime = new Date(event.end.dateTime || event.end.date);
      const { hour: startHourNum, minute: startMinuteNum } =
        getTaipeiHourMinute(eventStartTime);
      const { hour: endHourNum, minute: endMinuteNum } =
        getTaipeiHourMinute(eventEndTime);

      // 用 Date.UTC 只是拿來裝 taiwanYear/Month/Day 這些「已經是台灣時區的日曆值」，
      // 不代表任何實際時區——之後格式化時要搭配 timeZone:"UTC" 讀回來，
      // 才不會又被瀏覽器本地時區轉一次（跟上面 getEventDaysInRange 同一種坑）
      const taiwanEventDate = new Date(
        Date.UTC(taiwanYear, taiwanMonth, taiwanDay, startHourNum, startMinuteNum),
      );
      const startTimeY =
        timelineStartY + (startHourNum - startHour) * 60 + startMinuteNum;

      if (!eventsByDay[dayIndex]) eventsByDay[dayIndex] = [];
      eventsByDay[dayIndex].push({
        event,
        eventFields,
        eventType,
        startTimeY,
        taiwanEventDate,
        startHourNum,
        startMinuteNum,
        endHourNum,
        endMinuteNum,
      });
    });

    // 畫每一天的活動長條；同一時間有多筆活動時做 zigzag 位移避免重疊
    Object.keys(eventsByDay).forEach((dayKey) => {
      const dayIndex = parseInt(dayKey, 10);
      const eventsInDay = eventsByDay[dayKey]
        .slice()
        .sort((a, b) => a.startTimeY - b.startTimeY);
      const columnStartX = 30 + dayIndex * dayWidth;
      const strictZoneLeft = columnStartX + 10;
      const strictZoneRight = columnStartX + dayWidth - 10;

      const placedEvents = [];
      eventsInDay.forEach((eventData) => {
        const {
          event,
          eventFields,
          eventType,
          taiwanEventDate,
          startHourNum,
          startMinuteNum,
          endHourNum,
          endMinuteNum,
        } = eventData;
        let startTimeY = eventData.startTimeY;

        const eventBar = document.createElement("div");
        eventBar.className = `timeline-event-bar dynamic ${eventType}`;
        eventBar.dataset.eventType = eventType;
        allEventElements.push(eventBar);

        const eventContent = document.createElement("div");
        eventContent.className = "timeline-event-content";
        const titleText = event.summary || "未命名活動";
        const eventTitleEl = document.createElement("div");
        eventTitleEl.className = "timeline-event-title large";
        eventTitleEl.style.maxWidth = "200px";
        eventTitleEl.textContent = titleText;
        const eventTimeEl = document.createElement("div");
        eventTimeEl.className = "timeline-event-time";
        eventTimeEl.textContent =
          `${startHourNum.toString().padStart(2, "0")}:${startMinuteNum.toString().padStart(2, "0")} - ` +
          `${endHourNum.toString().padStart(2, "0")}:${endMinuteNum.toString().padStart(2, "0")}`;
        eventContent.appendChild(eventTitleEl);
        eventContent.appendChild(eventTimeEl);
        eventBar.appendChild(eventContent);

        timelineArea.appendChild(eventBar);
        const actualWidth = eventBar.offsetWidth || 150;

        let maxAllowedWidth = 225;
        if (titleText.length > 30) maxAllowedWidth = 160;
        else if (titleText.length > 20) maxAllowedWidth = 200;
        else if (titleText.length > 15) maxAllowedWidth = 220;
        maxAllowedWidth = Math.min(maxAllowedWidth, dayWidth - 20);
        const adjustedWidth = Math.min(actualWidth, maxAllowedWidth);
        eventBar.style.width = `${adjustedWidth}px`;

        const sameTimeCount = placedEvents.filter(
          (p) => Math.abs(p.top - startTimeY) <= 5,
        ).length;
        let bestPosition = strictZoneLeft;
        if (sameTimeCount > 0) {
          bestPosition = strictZoneLeft + sameTimeCount * 100;
          startTimeY += sameTimeCount * 15;
        }
        if (bestPosition < strictZoneLeft) {
          bestPosition = strictZoneLeft;
        } else if (bestPosition + adjustedWidth > strictZoneRight) {
          bestPosition = strictZoneRight - adjustedWidth;
        }

        eventBar.style.height = "30px";
        eventBar.style.left = `${bestPosition}px`;
        eventBar.style.top = `${startTimeY}px`;
        placedEvents.push({ left: bestPosition, top: startTimeY });

        eventBar.addEventListener("click", () => {
          const hasTime = Boolean(event.start.dateTime);
          const dateStr = taiwanEventDate.toLocaleDateString("en-US", {
            weekday: "short",
            month: "numeric",
            day: "numeric",
            timeZone: "UTC",
          });
          const dateTimeStr = hasTime
            ? `${dateStr} | ${startHourNum.toString().padStart(2, "0")}:${startMinuteNum.toString().padStart(2, "0")} - ${endHourNum.toString().padStart(2, "0")}:${endMinuteNum.toString().padStart(2, "0")}`
            : dateStr;

          previewContainer.innerHTML = "";
          if (eventFields.IMAGE) {
            const img = document.createElement("img");
            img.src = `image/programIMG/${eventFields.IMAGE}`;
            img.className = "timeline-preview-image";
            img.alt = "";
            img.onerror = function () {
              this.style.display = "none";
            };
            previewContainer.appendChild(img);
          }
          const tag = document.createElement("div");
          tag.className = `timeline-preview-type-tag ${eventType}`;
          tag.textContent = `#${eventType.toUpperCase()}`;
          const dt = document.createElement("div");
          dt.className = "timeline-preview-date-time";
          dt.textContent = dateTimeStr;
          const titleEl = document.createElement("div");
          titleEl.className = "timeline-preview-event-title";
          titleEl.textContent = event.summary || "未命名活動";
          const descEl = document.createElement("div");
          descEl.className = "timeline-preview-description";
          descEl.innerHTML = withBr(
            cleanEventDescription(eventFields.DESCRIPTION || event.description || "暫無詳細描述"),
          );

          previewContainer.appendChild(tag);
          previewContainer.appendChild(dt);
          previewContainer.appendChild(titleEl);
          previewContainer.appendChild(descEl);
        });
      });
    });

    mainContainer.appendChild(timelineArea);
    mainContainer.appendChild(previewContainer);
    container.appendChild(mainContainer);
  }

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

      // 手風琴的 max-height 是開啟當下量好的，攤商卡片展開後內容變高
      // 卻沒有人重新量過，會被 .archive-year-panel 的 overflow:hidden 卡住
      // ——尤其是最下面那幾張卡片，展開的內容直接被切掉看不到
      const yearItem = card.closest(".archive-year-item");
      if (yearItem) refreshPanelHeight(yearItem);
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
      const timelineCalendarEl = itemEl.querySelector(".archive-year-timeline-calendar");
      loadYearPrograms(year, dateStart, dateEnd).then((events) => {
        if (!timelineCalendarEl) return;
        const eventDays = getEventDaysInRange(dateStart, dateEnd);
        renderYearTimeline(timelineCalendarEl, events, eventDays);
        refreshPanelHeight(itemEl);
      });
    }

    // 照片是懶載入：第一次展開才去抓 GitHub 資料夾
    if (!itemEl.dataset.photosLoaded) {
      itemEl.dataset.photosLoaded = "1";
      const sliderEl = itemEl.querySelector(".archive-year-slider");
      const sliderImg = itemEl.querySelector(".archive-year-slider-img");
      const prevBtn = itemEl.querySelector(".archive-year-slider-prev");
      const nextBtn = itemEl.querySelector(".archive-year-slider-next");
      loadYearPhotos(year).then((photos) => {
        if (!photos.length || !sliderEl) return;
        sliderEl.style.display = "block";
        let index = 0;
        function show(i) {
          index = (i + photos.length) % photos.length;
          sliderImg.src = photos[index];
        }
        show(0);
        if (photos.length > 1) {
          prevBtn.style.display = "";
          nextBtn.style.display = "";
          prevBtn.addEventListener("click", () => show(index - 1));
          nextBtn.addEventListener("click", () => show(index + 1));
        }
        refreshPanelHeight(itemEl);
      });
    }

    // 攤位地圖也是懶載入：第一次展開才去查 GitHub 的 image/archive/map 資料夾
    if (!itemEl.dataset.mapLoaded) {
      itemEl.dataset.mapLoaded = "1";
      const mapImg = itemEl.querySelector(".archive-year-map-image");
      loadYearMap(year).then((url) => {
        if (!url || !mapImg) return;
        mapImg.src = url;
        mapImg.style.display = "block";
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

  // ===== Hero 影片 / 時間・地點 / Access（跟 ticketvisit.html 同一套排版與 CSS class，
  // 但完全不用 id —— ticketvisit.html 用 id="time-list"／id="location"／id="googlemap" 等
  // 固定 id，因為那頁只會有「當屆」一份資料；archive 是每個年份都會重複這個區塊，
  // 若照搬固定 id，同一頁會出現重複 id，document.getElementById 永遠只抓得到第一個年份，
  // 其他年份就會是空的。這裡改成純 class + createElement，靠 DOM 節點本身而不是 id 來定位）=====
  function buildHeroVideo(heroVideo) {
    if (!heroVideo) return null;
    const heroSection = document.createElement("div");
    heroSection.className = "hero-poster-section";
    const iframe = document.createElement("iframe");
    iframe.src = heroVideo;
    iframe.setAttribute("frameborder", "0");
    iframe.setAttribute("allow", "autoplay; fullscreen; picture-in-picture");
    iframe.allowFullscreen = true;
    iframe.loading = "lazy";
    heroSection.appendChild(iframe);
    return heroSection;
  }

  function buildExhibitionDetails(timeListRaw, location, locationLink, googlemap) {
    if (!timeListRaw && !location && !googlemap) return null;
    const wrap = document.createElement("div");
    wrap.className = "exhibition-details";

    if (timeListRaw) {
      const item = document.createElement("div");
      item.className = "detail-item";
      const h3 = document.createElement("h3");
      h3.className = "detail-item-title";
      h3.textContent = "時間 Time";
      const ul = document.createElement("ul");
      ul.className = "time-list";
      splitLines(timeListRaw).forEach((line) => {
        const li = document.createElement("li");
        li.textContent = line;
        ul.appendChild(li);
      });
      item.appendChild(h3);
      item.appendChild(ul);
      wrap.appendChild(item);
    }

    if (location || googlemap) {
      const item = document.createElement("div");
      item.className = "detail-item";
      const h3 = document.createElement("h3");
      h3.className = "detail-item-title";
      h3.textContent = "活動地點 Location";
      item.appendChild(h3);

      if (location) {
        const p = document.createElement("p");
        const a = document.createElement("a");
        a.textContent = location;
        if (locationLink) {
          a.href = locationLink;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
        }
        p.appendChild(a);
        item.appendChild(p);
      }

      if (googlemap) {
        const mapContainer = document.createElement("div");
        mapContainer.className = "map-container";
        const mapIframe = document.createElement("iframe");
        mapIframe.src = googlemap;
        mapIframe.loading = "lazy";
        mapIframe.setAttribute("referrerpolicy", "no-referrer-when-downgrade");
        mapContainer.appendChild(mapIframe);
        item.appendChild(mapContainer);
      }

      wrap.appendChild(item);
    }

    return wrap;
  }

  // Credit 區塊支援的排版公式（跟主站 info-log 用同一套語法，多加「純網址自動變連結」
  // 跟「支援直接寫 HTML 標籤」）：
  //   Enter 換行         → <br>
  //   **粗體**           → <strong>
  //   *斜體* 或 _斜體_    → <em>
  //   ~~刪除線~~         → <del>
  //   {顏色}文字（一行的最前面）→ <span style="color: 顏色">文字</span>
  //   {small}文字{small} → <small>
  //   https://example.com → 自動變成可點擊連結
  //   <a href="...">...</a> 這種直接寫的 HTML 標籤也支援，因為這裡完全沒有把輸入
  //   先跳脫（escape），所以本來就會照樣輸出，不需要額外處理
  function formatCreditText(raw) {
    let html = String(raw || "")
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>")
      .replace(/_(.*?)_/g, "<em>$1</em>")
      .replace(/~~(.*?)~~/g, "<del>$1</del>")
      .replace(/\{(.*?)\}(.*?)(?=\n|\r|$)/g, function (_match, color, text) {
        return '<span style="color: ' + color + '">' + text + "</span>";
      })
      .replace(/\{small\}(.*?)\{small\}/g, "<small>$1</small>")
      .replace(/\n/g, "<br>");

    // 純文字網址 → <a>，只走訪文字節點，不會動到已經寫好的 <a> 標籤或 href 屬性
    const temp = document.createElement("div");
    temp.innerHTML = html;
    const walker = document.createTreeWalker(temp, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) textNodes.push(node);
    textNodes.forEach((textNode) => {
      if (!/https?:\/\//.test(textNode.nodeValue)) return;
      const span = document.createElement("span");
      span.innerHTML = textNode.nodeValue.replace(
        /(https?:\/\/[^\s<>"]+)/g,
        '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>',
      );
      textNode.parentNode.replaceChild(span, textNode);
    });
    return temp.innerHTML;
  }

  function buildCreditSection(credit) {
    if (!credit) return null;
    const section = document.createElement("div");
    section.className = "archive-year-credit-section";

    const title = document.createElement("h2");
    title.className = "archive-year-credit-title";
    title.textContent = "CREDIT";
    section.appendChild(title);

    const body = document.createElement("div");
    body.className = "archive-year-credit-body";
    body.innerHTML = formatCreditText(credit);
    section.appendChild(body);

    return section;
  }

  function buildYearItem(year, fields, exhibitors) {
    // id 沿用主站 pageconfig 同一套命名（exhibition-title / exhibition-subtitle / exhibition-poem）
    const title = pick(fields["exhibition-title"]) || year;
    const subtitle = pick(fields["exhibition-subtitle"]);
    const desc = pick(fields["exhibition-poem"]);
    const heroVideo = pick(fields["hero-video"]);
    const timeListRaw = pick(fields["time-list"]);
    const location = pick(fields["location"]);
    const locationLink = pick(fields["location_link"]);
    const googlemap = pick(fields["googlemap"]);
    const credit = pick(fields["credit"]);
    const dateStart = pick(fields.date_start);
    const dateEnd = pick(fields.date_end);
    // 手風琴標題：年份 + 當屆主題（subtitle 本身不含年份，才需要補上）；
    // 沒有 subtitle 才退回 title（title 通常已經包含年份，不再重複補一次）
    const headerLabel = subtitle ? year + "　" + subtitle : title || year;

    const itemEl = document.createElement("div");
    itemEl.className = "archive-year-item";
    itemEl.dataset.dateStart = dateStart;
    itemEl.dataset.dateEnd = dateEnd;

    const header = document.createElement("button");
    header.type = "button";
    header.className = "archive-year-header";
    header.setAttribute("aria-expanded", "false");
    header.innerHTML =
      '<span class="archive-year-label">' +
      headerLabel +
      '</span><span class="archive-year-toggle" aria-hidden="true">+</span>';
    header.addEventListener("click", () => toggleYear(itemEl, year));

    const panel = document.createElement("div");
    panel.className = "archive-year-panel";

    const panelInner = document.createElement("div");
    panelInner.className = "archive-year-panel-inner";

    // 排版順序跟 ticketvisit.html 一致：影片 → 主題文字 → 時間/地點 → Access → Programs
    // → 相簿（archive 專屬，試算表沒有這個區塊）→ 攤商名單
    const heroVideoEl = buildHeroVideo(heroVideo);
    if (heroVideoEl) panelInner.appendChild(heroVideoEl);

    // 主題文字（當屆主題／當屆文字）放左邊、時間地點放右邊，桌機併排顯示；
    // 手機版用 CSS media query 改回上下堆疊（.archive-year-theme-row 加
    // flex-direction:column），跟其他手機版排版邏輯一致
    const themeCol = document.createElement("div");
    themeCol.className = "archive-year-theme-col";

    if (subtitle) {
      const subtitleEl = document.createElement("p");
      subtitleEl.className = "archive-year-subtitle";
      subtitleEl.textContent = subtitle;
      themeCol.appendChild(subtitleEl);
    }

    if (desc) {
      const descEl = document.createElement("p");
      descEl.className = "archive-year-desc";
      descEl.innerHTML = withBr(desc);
      themeCol.appendChild(descEl);
    }

    const detailsEl = buildExhibitionDetails(
      timeListRaw,
      location,
      locationLink,
      googlemap,
    );
    if (detailsEl) detailsEl.classList.add("archive-year-details-col");

    if (themeCol.childNodes.length || detailsEl) {
      const themeRow = document.createElement("div");
      themeRow.className = "archive-year-theme-row";
      if (themeCol.childNodes.length) themeRow.appendChild(themeCol);
      if (detailsEl) themeRow.appendChild(detailsEl);
      panelInner.appendChild(themeRow);
    }

    // Programs：跟 ticketvisit.html 同一套時間軸 class（timeline-mode-container /
    // timeline-scroll-container / timeline-calendar），內容懶載入時才由
    // renderYearTimeline() 動態填進 .archive-year-timeline-calendar
    const programsTitle = document.createElement("h2");
    programsTitle.className = "timeline-title";
    programsTitle.textContent = "Programs";
    panelInner.appendChild(programsTitle);

    const timelineModeContainer = document.createElement("div");
    timelineModeContainer.className = "timeline-mode-container visible";

    const timelineScroll = document.createElement("div");
    timelineScroll.className = "timeline-scroll-container";

    const timelineCalendarEl = document.createElement("div");
    timelineCalendarEl.className = "timeline-calendar archive-year-timeline-calendar";

    timelineScroll.appendChild(timelineCalendarEl);
    timelineModeContainer.appendChild(timelineScroll);
    panelInner.appendChild(timelineModeContainer);

    const sliderEl = document.createElement("div");
    sliderEl.className = "archive-year-slider";
    sliderEl.style.display = "none";

    const sliderImg = document.createElement("img");
    sliderImg.className = "archive-year-slider-img";
    sliderImg.alt = title || year;

    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "archive-year-slider-prev";
    prevBtn.setAttribute("aria-label", "上一張");
    prevBtn.style.display = "none";
    prevBtn.textContent = "‹";

    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "archive-year-slider-next";
    nextBtn.setAttribute("aria-label", "下一張");
    nextBtn.style.display = "none";
    nextBtn.textContent = "›";

    sliderEl.appendChild(sliderImg);
    sliderEl.appendChild(prevBtn);
    sliderEl.appendChild(nextBtn);

    // 攤位地圖：不從試算表讀，直接對應 GitHub repo 的 image/archive/map/{年份}.jpg，
    // 跟相簿一樣懶載入（第一次展開才去查 GitHub 資料夾），查不到就維持隱藏
    const mapImg = document.createElement("img");
    mapImg.className = "archive-year-map-image";
    mapImg.alt = "攤位地圖 Booth Map";
    mapImg.style.display = "none";

    // 相簿放左邊、地圖放右邊，桌機併排；手機版用 CSS media query 改回上下堆疊
    const mediaRow = document.createElement("div");
    mediaRow.className = "archive-year-media-row";
    mediaRow.appendChild(sliderEl);
    mediaRow.appendChild(mapImg);
    panelInner.appendChild(mediaRow);

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

    // Credit 放最後面（在攤商名單之後）
    const creditEl = buildCreditSection(credit);
    if (creditEl) panelInner.appendChild(creditEl);

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
