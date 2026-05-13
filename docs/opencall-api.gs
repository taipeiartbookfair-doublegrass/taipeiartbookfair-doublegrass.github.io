// ============================================================
//  Open Call Submission API — 2026
//  部署方式：擴充功能 > Apps Script > 部署為網路應用程式
//    - 執行身分：我
//    - 存取權限：任何人（含匿名）
// ============================================================

var SPREADSHEET_ID = "1RWUUW8ROptqlOMpzFFFNIwBp2EK7g2FQfDNdJFM-Fhw";

// 攤種 → 分頁名 + 報名編號前綴
// ⚠️ 加上 "26" 後綴，與舊 Google 表單分頁隔開
var BOOTH_CONFIG = {
  "書攤":                   { sheet: "書攤26",                 prefix: "LB" },
  "創作商品":               { sheet: "創作商品26",             prefix: "LM" },
  "裝置類":                 { sheet: "裝置類26",               prefix: "LI" },
  "策展":                   { sheet: "策展26",                 prefix: "LC" },
  "食物酒水":               { sheet: "食物酒水26",             prefix: "LF" },
  "Regular Book Booth":     { sheet: "Overseas-Book26",         prefix: "IB" },
  "Regular Non-Book Booth": { sheet: "Overseas-NonBook26",      prefix: "IN" },
  "Installation Booth":     { sheet: "Overseas-Installation26", prefix: "II" },
  "Curation Booth":         { sheet: "Overseas-Curation26",     prefix: "IC" },
};

// 欄位定義（與主試算表一致）
// user_id 填 appNo（報名編號），作為系統主識別碼
var COLUMNS = [
  ["user_id",          "auto:user_id"],    // = appNo，非 email
  ["報名編號",          "auto:app_no"],
  ["攤商編號",          ""],
  ["品牌",             "auto:brand"],
  ["品牌(原文)",        "auto:brand_orig"],
  ["錄取",             ""],
  ["已匯款",            ""],
  ["匯款備註",          ""],
  ["同意書",            ""],
  ["證",               ""],
  ["桌",               ""],
  ["當屆問答",          ""],
  ["草率簿",            ""],
  ["行銷素材",          ""],
  ["活動場次資訊",      ""],
  ["報到備註",          ""],
  ["親友票",            ""],
  ["包裹明細",          ""],
  ["身份類別",          "param:entry.2022316464"],
  ["作品類別",          "param:entry.1482635628"],
  ["IG帳號",           "param:entry.138567696"],
  ["品牌簡介",          "auto:bio"],
  ["是否過往參與",      "param:entry.1144386047"],
  ["參與年份",          "params:entry.1734398784"],
  ["作品/企劃書上傳",   "param:entry.715764736"],
  ["販售商品描述",      "param:entry.1111437113"],
  ["facebook",          "param:entry.1361490241"],
  ["instagram",         "param:entry.138567696"],
  ["website",           "param:entry.699732974"],
  ["whatsapp",          ""],
  ["Other Link(1)",     "param:entry.2050899252"],
  ["Other Link(2)",     "param:entry.830227276"],
  ["行銷授權",          "param:entry.7322984"],
  ["社群媒體授權",      "param:entry.1214650515"],
  ["工作坊",            "param:entry.1347561831"],
  ["name",              "auto:name"],
  ["account",           "auto:account"],   // email，保留供參考
  ["phone",             "auto:phone"],
  ["留言",              "param:entry.2019239800"],
  ["region",            "auto:region"],
  ["主要創作據點",      "auto:base"],
];

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
    var sheetName  = cfg ? cfg.sheet : (isOverseas ? "Overseas-Other26" : "未分類26");
    var prefix     = cfg ? cfg.prefix : "XX";

    var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) sheet = ss.insertSheet(sheetName);

    // 建立標題列（第一次使用）
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(COLUMNS.map(function(c) { return c[0]; }));
      sheet.getRange(1, 1, 1, COLUMNS.length)
           .setFontWeight("bold")
           .setBackground("#f3f3f3");
    }

    // 產生報名編號（加 lock 防並發重複）
    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    var appNo;
    try {
      var seq  = sheet.getLastRow(); // 含標題列；新列序號 = seq
      var year = new Date().getFullYear().toString().slice(-2);
      appNo = year + "-" + prefix + String(seq).padStart(3, "0");
    } finally {
      lock.releaseLock();
    }

    // 組裝自動填入欄位
    // ⚠️ user_id = appNo（報名編號），與 Users 工作表的 application_id 對應
    var autoValues = {
      user_id:    appNo,                    // ← 系統識別碼，非 email
      app_no:     appNo,
      account:    p.account || "",          // email，保留供參考
      name:       p._name   || "",
      phone:      p._phone  || "",
      brand:      p["entry.1159390039"] || "",
      brand_orig: isOverseas ? (p["entry.2674519285"] || "") : (p["entry.2674519284"] || ""),
      bio:        isOverseas ? (p["entry.1793579345"] || "") : (p["entry.1877870250"] || ""),
      region:     isOverseas ? (p["entry.356734101"] || p._region || "") : (p._region || "TW"),
      base:       isOverseas ? (p["entry.1232010148"] || "") : (p["entry.637996839"]  || ""),
    };

    // 逐欄取值並寫入
    var row = COLUMNS.map(function(col) {
      var rule = col[1];
      if (!rule) return "";
      if (rule.indexOf("auto:")   === 0) return autoValues[rule.slice(5)]  || "";
      if (rule.indexOf("params:") === 0) return (ps[rule.slice(7)] || []).join(", ");
      if (rule.indexOf("param:")  === 0) return p[rule.slice(6)]   || "";
      return "";
    });

    sheet.appendRow(row);

    // Users 工作表：把 application_id 更新為 appNo
    // 讓 get_dashboard_info 能透過 application_id 掃到此筆資料
    updateUsersApplicationId(ss, p.account || "", appNo);

    // 寄送確認信
    var email = p.account || "";
    var name  = p._name   || email;
    if (email) {
      sendConfirmationEmail(email, name, appNo, boothType, isOverseas);
    }

    return res({ success: true, appNo: appNo });

  } catch (err) {
    return res({ success: false, error: err.message });
  }
}

// ── Users 工作表更新 application_id ──────────────────────

function updateUsersApplicationId(ss, email, appNo) {
  if (!email || !appNo) return;
  try {
    var usersSheet = ss.getSheetByName("Users");
    if (!usersSheet) return;

    var data    = usersSheet.getDataRange().getValues();
    var headers = data[0].map(function(h) { return String(h).toLowerCase(); });
    var accountCol = headers.indexOf("account");
    var appIdCol   = headers.indexOf("application_id");

    if (accountCol === -1 || appIdCol === -1) return;

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][accountCol]).trim().toLowerCase() === email.toLowerCase()) {
        // 只在 application_id 為空時才寫入（避免覆蓋已有的 ID）
        if (!data[i][appIdCol]) {
          usersSheet.getRange(i + 1, appIdCol + 1).setValue(appNo);
        }
        break;
      }
    }
  } catch (err) {
    // 不影響主流程
    Logger.log("updateUsersApplicationId error: " + err.message);
  }
}

// ── 確認信 ───────────────────────────────────────────────

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
      "<p><strong>👉 Your application number: </strong>" + appNo + "<br>" +
      "Booth type: " + boothType + "</p>" +
      "<p>If accepted, you will be notified via email. Accepted exhibitors will need to complete payment within two weeks of notification.<br>" +
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
      "如果您有任何疑問，請寄信至 hooroo@double-grass.com 與我們聯繫。\n\n" +
      "敬祝順心，\n草率季 團隊\ntaipeiartbookfair.com\n\n----\n\n" +
      "Dear " + name + ",\n\n" +
      "Thank you for submitting your application for the 2026 Taipei Art Book Fair.\n\n" +
      "👉 Your application number is: " + appNo + "\n" +
      "Booth type: " + boothType + "\n\n" +
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
      "<p>如果您有任何疑問，請寄信至 <a href='mailto:hooroo@double-grass.com'>hooroo@double-grass.com</a> 與我們聯繫。</p>" +
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
