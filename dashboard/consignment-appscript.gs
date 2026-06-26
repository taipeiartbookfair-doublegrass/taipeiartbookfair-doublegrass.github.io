// ════════════════════════════════════════════════════════════════════════════
//  Pretty Fly Books — 寄售申請 Apps Script
//  貼到「NMHW&zinewall書籍商品總表」試算表的擴充功能 > Apps Script
//
//  部署方式:
//  1. 擴充功能 > Apps Script > 貼上此程式碼
//  2. 部署 > 新增部署 > 類型「網頁應用程式」
//     - 以誰的身份執行：我
//     - 誰可以存取：任何人
//  3. 複製部署 URL → 貼回 js/consignment.js 的 CONSIGNMENT_API_URL
// ════════════════════════════════════════════════════════════════════════════

var SHEET_NAME  = "";   // 留空 = 使用第一個工作表；否則填工作表名稱
var HEADER_ROW  = 4;    // 欄位標題在第幾列（從 1 起算）

// ── 分類中文對照 ──────────────────────────────────────────────────────────────
var CATEGORY_ZH = {
  "illustration & comic":       "插畫 & 漫畫",
  "photography":                "攝影",
  "magazine":                   "雜誌",
  "art & design":               "藝術 & 設計",
  "experimental & conceptual":  "實驗 & 概念",
  "project & curatorial":       "計畫 & 策展",
  "writing & literature":       "文字 & 文學",
};

// ── 來自地區中文對照 ───────────────────────────────────────────────────────────
var REGION_ZH = {
  "Taiwan":   "台灣",
  "Overseas": "海外",
};

// ─────────────────────────────────────────────────────────────────────────────

function doPost(e) {
  try {
    var params = parseParams(e);
    if (params.action === "submit_consignment") {
      return handleConsignmentSubmit(params);
    }
    return jsonResponse({ error: "Unknown action: " + params.action });
  } catch (err) {
    return jsonResponse({ error: err.toString() });
  }
}

// ── 表單送出 ──────────────────────────────────────────────────────────────────
function handleConsignmentSubmit(params) {
  var account     = params.account     || "";
  var message     = params.message     || "";
  var submittedAt = params.submittedAt || new Date().toISOString();
  var books       = JSON.parse(params.books || "[]");

  if (!books.length) return jsonResponse({ error: "No books submitted" });

  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = SHEET_NAME
    ? ss.getSheetByName(SHEET_NAME)
    : ss.getSheets()[0];
  if (!sheet) return jsonResponse({ error: "Sheet not found: " + SHEET_NAME });

  // ── 讀取並正規化標題列 ─────────────────────────────────────────────────────
  var lastCol    = sheet.getLastColumn();
  var rawHeaders = sheet.getRange(HEADER_ROW, 1, 1, lastCol).getValues()[0];

  // 正規化：移除 ＊、* 、換行、多餘空白
  var headers = rawHeaders.map(function (h) {
    return String(h).replace(/[\n\r＊\*]/g, " ").replace(/\s+/g, " ").trim();
  });

  // 找欄位 index（0-based）；找不到回傳 -1
  function idx(keyword) {
    for (var i = 0; i < headers.length; i++) {
      if (headers[i].indexOf(keyword) !== -1) return i;
    }
    return -1;
  }

  // 需要區分「作者/出版單位(英)」和「作者/出版單位(中)」
  var authorEnIdx = -1, authorZhIdx = -1;
  for (var i = 0; i < headers.length; i++) {
    if (headers[i].indexOf("作者") !== -1 || headers[i].indexOf("出版單位") !== -1) {
      if (headers[i].indexOf("英") !== -1 && authorEnIdx === -1) authorEnIdx = i;
      if (headers[i].indexOf("中") !== -1 && authorZhIdx === -1) authorZhIdx = i;
    }
  }

  var COL = {
    brand:         idx("寄售單位名稱"),
    title_en:      idx("商品名稱(英)"),
    title_zh:      idx("商品名稱(中)"),
    author_en:     authorEnIdx,
    author_zh:     authorZhIdx,
    price:         idx("含稅定價"),
    qty:           idx("可賣數量"),
    creator:       idx("創作者"),
    publisher:     idx("出版(書"),        // 出版(書、印刷物)Publisher
    photos:        idx("書籍照片"),
    region_en:     idx("來自(英)"),
    region_zh:     idx("來自(中)"),
    size:          idx("尺寸"),
    pages:         idx("頁數"),
    year:          idx("出版年"),
    language:      idx("語言(英)"),
    isbn:          idx("ISBN"),
    intro_en:      idx("內容介紹(英)"),
    intro_zh:      idx("內容介紹(中)"),
    category_en:   idx("分類(英)"),
    category_zh:   idx("分類(中)"),
    collab:        idx("合作方式"),
    supplier_note: idx("進貨方"),         // 進貨方備註
    our_note:      idx("我方"),           // 我方備註（存帳號+送出時間）
  };

  // ── 每本書寫一行 ───────────────────────────────────────────────────────────
  for (var b = 0; b < books.length; b++) {
    var book    = books[b];
    var nextRow = sheet.getLastRow() + 1;

    // 建立空白陣列，長度 = 總欄數
    var row = new Array(lastCol).fill("");

    function set(colIdx, value) {
      if (colIdx >= 0 && value !== "" && value !== null && value !== undefined) {
        row[colIdx] = value;
      }
    }

    var authorCombined = [book.creator, book.publisher]
      .filter(Boolean).join(" / ");

    set(COL.brand,         book.brand);
    set(COL.title_en,      book.title_en);
    set(COL.title_zh,      book.title_zh);
    set(COL.author_en,     authorCombined);
    set(COL.author_zh,     authorCombined);
    set(COL.price,         Number(book.price)  || "");
    set(COL.qty,           Number(book.qty)    || "");
    set(COL.creator,       book.creator);
    set(COL.publisher,     book.publisher);
    set(COL.photos,        book.photos);
    set(COL.region_en,     book.region);
    set(COL.region_zh,     REGION_ZH[book.region] || book.region);
    set(COL.size,          book.size);
    set(COL.pages,         Number(book.pages)  || "");
    set(COL.year,          Number(book.year)   || "");
    set(COL.language,      book.language);
    set(COL.isbn,          book.isbn);
    set(COL.intro_en,      book.intro_en);
    set(COL.intro_zh,      book.intro_zh);
    set(COL.category_en,   book.category);
    set(COL.category_zh,   CATEGORY_ZH[book.category] || "");
    set(COL.collab,        "寄售");
    set(COL.supplier_note, message);
    set(COL.our_note,      "帳號:" + account + "  送出:" + submittedAt);

    sheet.getRange(nextRow, 1, 1, lastCol).setValues([row]);
  }

  try { sendConfirmationEmail(account, books); } catch (e) {}

  return jsonResponse({ success: true, count: books.length });
}

// ── 確認信 ────────────────────────────────────────────────────────────────────
function sendConfirmationEmail(account, books) {
  if (!account || !account.includes("@")) return;

  var bookList = books.map(function (b, i) {
    var title = b.title_zh || b.title_en || "(無書名)";
    return (i + 1) + ". " + title + " (" + b.brand + ") × " + b.qty + " 本 (copies)";
  }).join("\n");

  GmailApp.sendEmail(
    account,
    "【草率季 Pretty Fly Books】寄售申請確認 Consignment Application Received",
    "Dear,\n\n" +
    "我們已收到您的寄售申請，以下為您提交的書籍清單：\n" +
    "We have received your consignment application. Below is the list of books you submitted:\n\n" +
    bookList + "\n\n" +
    "實際寄售品項及數量將另以信件確認。如有任何疑問，請來信 nmhw@double-grass.com 與我們聯繫。\n" +
    "The final consignment items and quantities will be confirmed in a separate email. If you have any questions, please contact us at nmhw@double-grass.com.\n\n" +
    "BR,\n\n" +
    "草率季 TPABF Team\n" +
    "hooroo@double-grass.com"
  );
}

// ── 工具函式 ──────────────────────────────────────────────────────────────────
function parseParams(e) {
  if (e.parameter && Object.keys(e.parameter).length > 0) return e.parameter;
  if (e.postData && e.postData.contents) {
    var result = {};
    e.postData.contents.split("&").forEach(function (pair) {
      var eq = pair.indexOf("=");
      if (eq === -1) return;
      result[decodeURIComponent(pair.slice(0, eq).replace(/\+/g, " "))] =
            decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, " "));
    });
    return result;
  }
  return {};
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
