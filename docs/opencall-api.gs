// ============================================================
//  Open Call Submission API — 2026
//  部署方式：擴充功能 > Apps Script > 部署為網路應用程式
//    - 執行身分：我
//    - 存取權限：任何人（含匿名）
// ============================================================

var SPREADSHEET_ID = "1RWUUW8ROptqlOMpzFFFNIwBp2EK7g2FQfDNdJFM-Fhw";

var BOOTH_CONFIG = {
  "書攤":                   { sheet: "書攤",                   prefix: "LB" },
  "創作商品":               { sheet: "創作商品",               prefix: "LM" },
  "裝置類":                 { sheet: "裝置類",                 prefix: "LI" },
  "策展":                   { sheet: "策展",                   prefix: "LC" },
  "食物酒水":               { sheet: "食物酒水",               prefix: "LF" },
  "Regular Book Booth":     { sheet: "Regular Book Booth",     prefix: "IB" },
  "Regular Non-Book Booth": { sheet: "Regular Non-Book Booth", prefix: "IN" },
  "Installation Booth":     { sheet: "Installation Booth",     prefix: "II" },
  "Curation Booth":         { sheet: "Curation Booth",         prefix: "IC" },
};

// ── 所有欄位的值映射（海外/本地共用，依 header 名稱對應）──────────────
function buildFieldValues(p, ps, isOverseas, userId, appNo) {
  return {
    "user_id":         userId,
    "報名編號":         appNo,
    // 品牌
    "品牌":            p["entry.1159390039"]  || "",
    "品牌(原文)":      isOverseas ? (p["entry.2674519285"] || "") : (p["entry.2674519284"] || ""),
    "品牌簡介":        isOverseas ? (p["entry.1793579345"] || "") : (p["entry.1877870250"] || ""),
    "品牌簡介(翻譯)":  "",  // 表單未收集，由工作人員填寫
    // 身份 / 作品類別
    "身份類別":        p["entry.2022316464"]  || "",
    "作品類別":        p["entry.1482635628"]  || "",
    // 社群
    "IG帳號":         p["entry.138567696"]   || "",
    "instagram":      p["entry.138567696"]   || "",
    "facebook":       p["entry.1361490241"]  || "",
    "website":        p["entry.699732974"]   || "",
    "whatsapp":       "",  // 表單未收集
    "Other Link(1)":  p["entry.2050899252"]  || "",
    "Other Link(2)":  p["entry.830227276"]   || "",
    // 過往參與
    "是否過往參與":    p["entry.1144386047"]  || "",
    "參與年份":        (ps["entry.1734398784"] || []).join(", "),
    // 上傳：作品集 (715764736)、Proposal Plan (1801583093 → 審核資料)
    "作品/企劃書上傳": p["entry.715764736"]   || "",
    "審核資料":        p["entry.1801583093"]  || "",
    "販售商品描述":    p["entry.1111437113"]  || "",
    // 授權
    "行銷授權":        p["entry.7322984"]     || "",
    "社群媒體授權":    p["entry.1214650515"]  || "",
    "工作坊":          p["entry.1347561831"]  || "",
    // 地點 / 國籍
    "region":          isOverseas ? (p["entry.356734101"] || p._region || "") : (p._region || "TW"),
    "主要創作據點":    isOverseas ? (p["entry.1232010148"] || "") : (p["entry.637996839"] || ""),
    // 書/非書（IB 欄位，由工作人員判斷填寫）
    "書/非書":         "",
    // 帳號資料（從 cookie 傳入）
    "name":            p._name    || "",
    "account":         p.account  || "",
    "phone":           p._phone   || "",
    // 留言
    "留言":            p["entry.2019239800"]  || "",
    // 以下為後台填寫欄位，送出時留空
    "攤商編號": "", "錄取": "", "已匯款": "", "匯款備註": "",
    "同意書": "", "證": "", "桌": "", "當屆問答": "",
    "草率簿": "", "行銷素材": "", "活動場次資訊": "", "報到備註": "",
    "親友票": "", "包裹明細": "",
  };
}

// ── 主處理函式 ────────────────────────────────────────────

function doPost(e) {
  try {
    var p  = e.parameter;
    var ps = e.parameters;

    if (!p || p.action !== "submit_opencall") {
      return res({ success: false, error: "Unknown action" });
    }

    var isOverseas = p.isOverseas === "1";
    var boothType  = p["entry.133172086"] || "";
    var cfg        = BOOTH_CONFIG[boothType];
    if (!cfg) return res({ success: false, error: "Unknown booth type: " + boothType });

    var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(cfg.sheet);
    if (!sheet) return res({ success: false, error: "Sheet not found: " + cfg.sheet });

    // 從 Users 工作表查詢 user_id
    var userId = getUserId(ss, p.account || "");

    // 產生報名編號（加鎖避免同時寫入產生重複）
    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    var appNo;
    try {
      var seq  = sheet.getLastRow(); // header 算第 1 行，第一筆資料 = seq 001
      var year = new Date().getFullYear().toString().slice(-2);
      appNo    = year + "-" + cfg.prefix + String(seq).padStart(3, "0");
    } finally {
      lock.releaseLock();
    }

    var fields = buildFieldValues(p, ps, isOverseas, userId, appNo);
    writeRowByHeaders(sheet, fields);

    updateUsersAfterSubmission(ss, p.account || "", appNo, cfg.prefix);

    var email = p.account || "";
    if (email) sendConfirmationEmail(email, p._name || email, appNo, boothType, isOverseas);

    return res({ success: true, appNo: appNo });

  } catch (err) {
    return res({ success: false, error: err.message });
  }
}

// ── 從 Users 工作表查 user_id ─────────────────────────────

function getUserId(ss, email) {
  if (!email) return "";
  try {
    var sheet   = ss.getSheetByName("Users");
    if (!sheet) return "";
    var data    = sheet.getDataRange().getValues();
    var headers = data[0].map(function(h) { return String(h).toLowerCase().trim(); });
    var uidCol  = headers.indexOf("user_id");
    var accCol  = headers.indexOf("account");
    if (uidCol === -1 || accCol === -1) return "";
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][accCol]).trim().toLowerCase() === email.toLowerCase()) {
        return String(data[i][uidCol]).trim();
      }
    }
  } catch (err) {
    Logger.log("getUserId error: " + err.message);
  }
  return "";
}

// ── 依 header 名稱找欄位後寫入（不依賴欄位位置）─────────────

function writeRowByHeaders(sheet, fields) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();

  if (lastRow === 0 || lastCol === 0) {
    // 空 sheet：用 fields 的 key 建立 header（通常不應發生）
    var keys = Object.keys(fields);
    sheet.appendRow(keys);
    sheet.getRange(1, 1, 1, keys.length)
         .setFontWeight("bold")
         .setBackground("#f3f3f3");
    sheet.appendRow(keys.map(function(k) { return fields[k]; }));
    return;
  }

  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var row = headers.map(function(h) {
    var key = String(h).trim();
    return fields.hasOwnProperty(key) ? fields[key] : "";
  });
  sheet.appendRow(row);
}

// ── Users 工作表更新 ──────────────────────────────────────

function updateUsersAfterSubmission(ss, email, appNo, postCode) {
  if (!email) return;
  try {
    var sheet   = ss.getSheetByName("Users");
    if (!sheet) return;
    var data    = sheet.getDataRange().getValues();
    var headers = data[0].map(function(h) { return String(h).toLowerCase().trim(); });
    var accCol  = headers.indexOf("account");
    var postCol = headers.indexOf("post");
    if (accCol === -1 || postCol === -1) return;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][accCol]).trim().toLowerCase() !== email.toLowerCase()) continue;
      if (!data[i][postCol]) {
        sheet.getRange(i + 1, postCol + 1).setValue(postCode);
      }
      break;
    }
  } catch (err) {
    Logger.log("updateUsersAfterSubmission error: " + err.message);
  }
}

// ── 確認信 ────────────────────────────────────────────────

function sendConfirmationEmail(email, name, appNo, boothType, isOverseas) {
  var subject = isOverseas
    ? "Taipei Art Book Fair 2026 — Application Confirmation"
    : "草率季 2026 申請確認信 | Taipei Art Book Fair Confirmation";

  var plainBody, htmlBody;

  if (isOverseas) {
    plainBody =
      "Dear " + name + ",\n\n" +
      "Thank you for submitting your application for the 2026 Taipei Art Book Fair.\n\n" +
      "Your application number is: " + appNo + "\n" +
      "Booth type: " + boothType + "\n\n" +
      "If accepted, you will be notified via email. Accepted exhibitors will need to complete payment within two weeks of notification.\n\n" +
      "Your account: " + email + "\n\n" +
      "For any questions, contact hooroo@double-grass.com.\n\n" +
      "Best regards,\nTaipei Art Book Fair Team\ntaipeiartbookfair.com";

    htmlBody =
      "<div style='font-family:Arial,sans-serif;font-size:14px;line-height:1.6'>" +
      "<p>Dear " + name + ",</p>" +
      "<p>Thank you for submitting your application for the <strong>2026 Taipei Art Book Fair</strong>.</p>" +
      "<p><strong>👉 Your application number: </strong>" + appNo + "<br>Booth type: " + boothType + "</p>" +
      "<p>If accepted, you will be notified via email.<br>" +
      "The full exhibitor list will be progressively announced on our official website and social channels.</p>" +
      "<p>Your account: " + email + "</p>" +
      "<p>For any questions, contact <a href='mailto:hooroo@double-grass.com'>hooroo@double-grass.com</a>.</p>" +
      "<p>Best regards,<br>Taipei Art Book Fair Team<br><a href='https://taipeiartbookfair.com'>taipeiartbookfair.com</a></p>" +
      "</div>";

  } else {
    plainBody =
      name + " 您好，\n\n" +
      "非常感謝您提交 2026 草率季的申請。我們已成功收到您所提交的回應。\n\n" +
      "👉 您的報名編號為：" + appNo + "\n" +
      "攤種：" + boothType + "\n\n" +
      "如果您錄取本屆攤商，我們將寄送通知信至您的信箱，錄取後請於兩週內完成繳費，逾時將自動取消參與資格。\n" +
      "完整的參展名單將於活動前在官方網站和社群公布。\n\n" +
      "您的帳號：" + email + "\n\n" +
      "如有任何疑問，請寄信至 hooroo@double-grass.com 與我們聯繫。\n\n" +
      "敬祝順心，\n草率季 團隊\ntaipeiartbookfair.com\n\n----\n\n" +
      "Dear " + name + ",\n\n" +
      "Thank you for submitting your application for the 2026 Taipei Art Book Fair.\n\n" +
      "👉 Your application number is: " + appNo + "\nBooth type: " + boothType + "\n\n" +
      "If accepted, you will be notified via email.\n\n" +
      "Your account: " + email + "\n\n" +
      "For any questions, contact hooroo@double-grass.com.\n\n" +
      "Best regards,\nTaipei Art Book Fair Team\ntaipeiartbookfair.com";

    htmlBody =
      "<div style='font-family:Arial,sans-serif;font-size:14px;line-height:1.6'>" +
      "<p>" + name + " 您好，</p>" +
      "<p>非常感謝您提交 <strong>2026 草率季</strong> 的申請。我們已成功收到您所提交的回應。</p>" +
      "<p><strong>👉 您的報名編號為：</strong>" + appNo + "<br>攤種：" + boothType + "</p>" +
      "<p>如果您錄取本屆攤商，我們將寄送通知信至您的信箱，錄取後請於兩週內完成繳費，逾時將自動取消參與資格。<br>" +
      "完整的參展名單將於活動前在官方網站和社群公布。</p>" +
      "<p>您的帳號：" + email + "</p>" +
      "<p>如有任何疑問，請寄信至 <a href='mailto:hooroo@double-grass.com'>hooroo@double-grass.com</a> 與我們聯繫。</p>" +
      "<hr>" +
      "<p>Dear " + name + ",</p>" +
      "<p>Thank you for submitting your application for the <strong>2026 Taipei Art Book Fair</strong>.</p>" +
      "<p><strong>👉 Your application number is:</strong> " + appNo + "<br>Booth type: " + boothType + "</p>" +
      "<p>If accepted, you will be notified via email.</p>" +
      "<p>Your account: " + email + "</p>" +
      "<p>For any questions, contact <a href='mailto:hooroo@double-grass.com'>hooroo@double-grass.com</a>.</p>" +
      "<p>Best regards,<br>草率季 Team<br><a href='https://taipeiartbookfair.com'>taipeiartbookfair.com</a></p>" +
      "</div>";
  }

  MailApp.sendEmail({ to: email, subject: subject, body: plainBody, htmlBody: htmlBody });
}

// ── 工具函式 ─────────────────────────────────────────────

function doGet() {
  return res({ success: false, error: "Use POST" });
}

function res(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
