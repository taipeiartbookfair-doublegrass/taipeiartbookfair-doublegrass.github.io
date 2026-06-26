// ════════════════════════════════════════════════════════════════════════════
//  Pretty Fly Books — 寄售合約簽署紀錄 Apps Script
//  貼到「寄售合約簽署 Log」試算表的擴充功能 > Apps Script
//  （獨立試算表，不共用攤商合約 log）
//
//  部署方式:
//  1. 擴充功能 > Apps Script > 貼上此程式碼
//  2. 部署 > 新增部署 > 類型「網頁應用程式」
//     - 以誰的身份執行：我
//     - 誰可以存取：任何人
//  3. 複製部署 URL → 貼回 js/consignment.js 的 CONSIGNMENT_CONSENT_API_URL
//
//  工作表結構:
//  - "ConsentLog" 工作表：自動建立，無需手動設定欄位
// ════════════════════════════════════════════════════════════════════════════

function doPost(e) {
  try {
    var params = parseParams(e);
    if (params.action === "save_consent") {
      return handleSaveConsent(params);
    }
    return jsonResponse({ error: "Unknown action: " + params.action });
  } catch (err) {
    return jsonResponse({ error: err.toString() });
  }
}

// ── 合約同意紀錄 ──────────────────────────────────────────────────────────────
function handleSaveConsent(params) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("ConsentLog");
  if (!sheet) {
    sheet = ss.insertSheet("ConsentLog");
    sheet.appendRow(["時間戳記 Timestamp", "帳號 Account", "姓名 Name", "Email", "寄售單位 Organization", "電話 Phone", "合約版本 Version"]);
    sheet.setFrozenRows(1);
  }

  var timestamp = new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });

  sheet.appendRow([
    timestamp,
    params.userId          || "",
    params.name            || "",
    params.email           || "",
    params.unit            || "",
    params.phone           || "",
    params.frontendVersion || "",
  ]);

  try { sendConsentEmail(params, timestamp); } catch (e) {}

  return jsonResponse({ success: true });
}

// ── 合約確認信 ────────────────────────────────────────────────────────────────
function sendConsentEmail(params, timestamp) {
  var email = params.email || "";
  if (!email || !email.includes("@")) return;

  var name    = params.name    || "";
  var unit    = params.unit    || "";
  var version = params.frontendVersion || "";

  GmailApp.sendEmail(
    email,
    "【草率季 Pretty Fly Books】寄售合約簽署確認 Consignment Agreement Confirmed",
    "Dear" + (name ? " " + name : "") + ",\n\n" +
    "我們已收到您的寄售合約簽署，以下為簽署紀錄：\n" +
    "We have received your signed Consignment Agreement. Below is your signing record:\n\n" +
    "姓名 Name：" + name + "\n" +
    "寄售單位 Organization：" + unit + "\n" +
    "Email：" + email + "\n" +
    "簽署時間 Signed at：" + timestamp + " (GMT+8)\n" +
    "合約版本 Version：" + version + "\n\n" +
    "如有任何疑問，請來信 nmhw@double-grass.com 與我們聯繫。\n" +
    "If you have any questions, please contact us at nmhw@double-grass.com.\n\n" +
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
