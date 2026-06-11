// ════════════════════════════════════════════════════════════════════════════
//  Open Call 時間控制 & 邀請密碼  —  Apps Script 新增片段
//
//  你的「各區快公佈時間」欄位對應（由左到右，index 0 起算）：
//    A(0)  區塊名稱
//    B(1)  sectionId        ← 用這欄找 row
//    C(2)  descId
//    D(3)  公布日期
//    E(4)  公布時間
//    F(5)  截止日期
//    G(6)  截止時間
//    H(7)  備取截止日期
//    I(8)  備取截止時間
//    J(9)  公布時間ISO格式  ← 用這欄取 openTime
//    K(10) 截止時間ISO格式  ← 用這欄取 closeTime
//    L(11) 備取截止時間ISO格式
//    M(12) 未公佈時顯示內容
//    N(13) 公佈時顯示內容   ← 密碼存這欄（僅 opencall-invite-password 那列）
//    O(14) 公佈時顯示內容EN
//
// ════════════════════════════════════════════════════════════════════════════
//  📋 STEP 1 — 在「各區快公佈時間」工作表新增兩列
// ════════════════════════════════════════════════════════════════════════════
//
//  照你現有欄位格式，新增以下兩列（其餘欄位留空即可）：
//
//  列 1：Open Call 開放時間區間
//    A  區塊名稱     → Open Call 時間控制
//    B  sectionId   → opencall-schedule        ← 固定不要改
//    D  公布日期     → 2026/9/1
//    E  公布時間     → 10:00:00
//    F  截止日期     → 2026/10/15
//    G  截止時間     → 23:59:00
//    J  公布時間ISO格式  → 複製上面列的公式往下拉（或手動填 2026-09-01T10:00:00+08:00）
//    K  截止時間ISO格式  → 複製上面列的公式往下拉（或手動填 2026-10-15T23:59:00+08:00）
//    其餘欄位留空
//
//  列 2：邀請密碼
//    A  區塊名稱     → Open Call 邀請密碼
//    B  sectionId   → opencall-invite-password  ← 固定不要改
//    N  公佈時顯示內容 → 先留空；要開放邀請時才填密碼
//    其餘欄位留空
//
//  ⚠️ 密碼填在 N 欄（公佈時顯示內容），留空 = 未開放邀請。
//     hasPassword 只告訴前端「有沒有密碼」，密碼本身不會傳到前端。
//
// ════════════════════════════════════════════════════════════════════════════
//  片段 A — 加到 publishApiUrl 那支 Apps Script
//  在你的 doGet 組裝回傳 JSON 的地方，在 return 之前貼這段
// ════════════════════════════════════════════════════════════════════════════

function getOpenCallSchedule_() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("各區快公佈時間");
  if (!sheet) return null;

  const data = sheet.getDataRange().getValues();

  var openTime  = null;
  var closeTime = null;
  var hasPassword = false;

  data.forEach(function (row) {
    var sectionId = String(row[1] || "").trim();   // 欄 B：sectionId

    if (sectionId === "opencall-schedule") {
      openTime  = String(row[9]  || "").trim();    // 欄 J：公布時間ISO格式
      closeTime = String(row[10] || "").trim();    // 欄 K：截止時間ISO格式
    }

    if (sectionId === "opencall-invite-password") {
      var pwd = String(row[13] || "").trim();      // 欄 N：公佈時顯示內容
      hasPassword = pwd.length > 0;
    }
  });

  if (!openTime && !closeTime) return null;

  return {
    openTime:    openTime    || null,
    closeTime:   closeTime   || null,
    hasPassword: hasPassword,
  };
}

// ── 在你的 doGet 回傳物件加入 opencall-schedule key ──────────────────────
//
//  doGet 大概長這樣（在 return 前插入下面兩行）：
//
//    function doGet(e) {
//      var result = {};
//      // ... 你原本讀 sheet、組 result 的邏輯 ...
//
//      // ↓ 加入這兩行 ↓
//      var ocSchedule = getOpenCallSchedule_();
//      if (ocSchedule) result["opencall-schedule"] = ocSchedule;
//      // ↑ 加入這兩行 ↑
//
//      return ContentService
//        .createTextOutput(JSON.stringify(result))
//        .setMimeType(ContentService.MimeType.JSON);
//    }


// ════════════════════════════════════════════════════════════════════════════
//  片段 B — 加到 apiUrl 那支 Apps Script（主要攤商資料那支）
// ════════════════════════════════════════════════════════════════════════════
//
//  兩種情況：
//  ① apiUrl 和 publishApiUrl 是同一個試算表的不同部署
//     → 下面的 SpreadsheetApp.getActiveSpreadsheet() 就可以直接讀「各區快公佈時間」
//  ② 兩個試算表分開
//     → 把 getActiveSpreadsheet() 改成 SpreadsheetApp.openById("各區快試算表的ID")
//

function getOpenCallInvitePassword_() {
  // 如果不同試算表，改成：
  // var ss = SpreadsheetApp.openById("各區快試算表的ID");
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("各區快公佈時間");
  if (!sheet) return "";

  var data = sheet.getDataRange().getValues();
  for (var i = 0; i < data.length; i++) {
    var sectionId = String(data[i][1] || "").trim();   // 欄 B
    if (sectionId === "opencall-invite-password") {
      return String(data[i][13] || "").trim();          // 欄 N：公佈時顯示內容
    }
  }
  return "";
}

// ── 在你的 doPost action 判斷裡加入 verify_opencall_password ─────────────
//
//    function doPost(e) {
//      var params = e.parameter;
//      var action = params.action;
//
//      if (action === "get_dashboard_info") { ... }
//      else if (action === "update_dashboard_info") { ... }
//      // ... 其他 action ...
//
//      // ↓ 加入這段 ↓
//      else if (action === "verify_opencall_password") {
//        return verifyOpenCallPassword_(params);
//      }
//      // ↑ 加入這段 ↑
//    }

function verifyOpenCallPassword_(params) {
  var submitted = String(params.password || "").trim();
  var stored    = getOpenCallInvitePassword_();

  if (!stored) {
    // 密碼欄位空白 = 邀請未開放
    return jsonOut_({ success: false, reason: "no_password_set" });
  }

  if (submitted === stored) {
    return jsonOut_({ success: true });
  } else {
    return jsonOut_({ success: false, reason: "wrong_password" });
  }
}

// ── JSON helper（如果你的 script 裡已有類似函式，請用原本的，不要重複宣告）─
function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
