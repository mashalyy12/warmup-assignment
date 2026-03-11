const fs = require("fs");

// ══════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════

/**
 * Parse "h:mm:ss am" / "h:mm:ss pm" → seconds since midnight.
 * Handles 12:xx am → 0:xx and 12:xx pm → 12:xx correctly.
 */
function timeStrToSec(timeStr) {
  const t = timeStr.trim().toLowerCase();
  const lastSpace = t.lastIndexOf(" ");
  const period = t.slice(lastSpace + 1);       // "am" | "pm"
  const hms    = t.slice(0, lastSpace);        // "h:mm:ss"
  const [h, m, s] = hms.split(":").map(Number);
  let hours = h;
  if (period === "am") { if (hours === 12) hours = 0; }
  else                 { if (hours !== 12) hours += 12; }
  return hours * 3600 + m * 60 + s;
}

/**
 * Parse "h:mm:ss" duration string → total seconds.
 */
function durStrToSec(dur) {
  const [h, m, s] = dur.trim().split(":").map(Number);
  return h * 3600 + m * 60 + s;
}

/**
 * Convert total seconds → "h:mm:ss"  (hours are never zero-padded).
 */
function secToDurStr(total) {
  total = Math.max(0, total);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Read a text file and return non-empty trimmed lines.
 */
function readLines(filePath) {
  return fs.readFileSync(filePath, "utf8")
           .split("\n")
           .filter(l => l.trim() !== "");
}

/**
 * Split a CSV line and trim every field.
 */
function splitLine(line) {
  return line.split(",").map(f => f.trim());
}

/**
 * Check whether a date string falls inside the Eid period (2025-04-10 to 2025-04-30).
 */
function isEidDate(dateStr) {
  const [yr, mo, dy] = dateStr.split("-").map(Number);
  return yr === 2025 && mo === 4 && dy >= 10 && dy <= 30;
}

/**
 * Return the daily quota in seconds for a given date string.
 * Normal: 8h 24m = 30240 s.  Eid: 6h = 21600 s.
 */
function dailyQuota(dateStr) {
  return isEidDate(dateStr) ? 21600 : 30240;
}

/**
 * Return the lowercase weekday name ("monday", "friday" …) for a date string.
 * Uses UTC so timezone can never shift the day.
 */
const DAYS = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
function weekdayOf(dateStr) {
  const [yr, mo, dy] = dateStr.split("-").map(Number);
  return DAYS[new Date(Date.UTC(yr, mo - 1, dy)).getUTCDay()];
}

// ══════════════════════════════════════════════════════════════
//  FUNCTION 1 — getShiftDuration(startTime, endTime)
//  Returns the difference between end and start as "h:mm:ss".
// ══════════════════════════════════════════════════════════════
function getShiftDuration(startTime, endTime) {
  const diff = timeStrToSec(endTime) - timeStrToSec(startTime);
  return secToDurStr(diff);
}

// ══════════════════════════════════════════════════════════════
//  FUNCTION 2 — getIdleTime(startTime, endTime)
//  Delivery window: 08:00:00 – 22:00:00 (8 AM – 10 PM).
//  Any time outside that window is idle.
// ══════════════════════════════════════════════════════════════
function getIdleTime(startTime, endTime) {
  const WINDOW_START = 8  * 3600;   // 08:00:00
  const WINDOW_END   = 22 * 3600;   // 22:00:00

  const start = timeStrToSec(startTime);
  const end   = timeStrToSec(endTime);
  let idle = 0;

  // Idle BEFORE delivery window opens
  if (start < WINDOW_START) {
    idle += Math.min(WINDOW_START, end) - start;
  }

  // Idle AFTER delivery window closes
  if (end > WINDOW_END) {
    idle += end - Math.max(WINDOW_END, start);
  }

  return secToDurStr(idle);
}

// ══════════════════════════════════════════════════════════════
//  FUNCTION 3 — getActiveTime(shiftDuration, idleTime)
//  active = shiftDuration − idleTime
// ══════════════════════════════════════════════════════════════
function getActiveTime(shiftDuration, idleTime) {
  return secToDurStr(durStrToSec(shiftDuration) - durStrToSec(idleTime));
}

// ══════════════════════════════════════════════════════════════
//  FUNCTION 4 — metQuota(date, activeTime)
//  Returns true if activeTime ≥ daily quota (Eid-aware).
// ══════════════════════════════════════════════════════════════
function metQuota(date, activeTime) {
  return durStrToSec(activeTime) >= dailyQuota(date);
}

// ══════════════════════════════════════════════════════════════
//  FUNCTION 5 — addShiftRecord(textFile, shiftObj)
//  Inserts a new row into shifts.txt (after last row of same
//  driverID, or at end if driver not seen yet).
//  Returns the complete 10-property object, or {} on duplicate.
// ══════════════════════════════════════════════════════════════
function addShiftRecord(textFile, shiftObj) {
  const { driverID, driverName, date, startTime, endTime } = shiftObj;
  const dID   = driverID.trim();
  const dDate = date.trim();

  // Load current file (gracefully handle missing file)
  let raw = "";
  try { raw = fs.readFileSync(textFile, "utf8"); } catch (_) {}
  const lines = raw.split("\n").filter(l => l.trim() !== "");

  // Reject duplicate (same driverID + date)
  for (const line of lines) {
    const c = splitLine(line);
    if (c[0] === dID && c[2] === dDate) return {};
  }

  // Derive all fields
  const shiftDuration = getShiftDuration(startTime, endTime);
  const idleTime      = getIdleTime(startTime, endTime);
  const activeTime    = getActiveTime(shiftDuration, idleTime);
  const quotaMet      = metQuota(dDate, activeTime);
  const hasBonus      = false;

  // Build the return object
  const record = {
    driverID:      dID,
    driverName:    driverName.trim(),
    date:          dDate,
    startTime:     startTime.trim(),
    endTime:       endTime.trim(),
    shiftDuration,
    idleTime,
    activeTime,
    metQuota:      quotaMet,
    hasBonus,
  };

  // Build CSV row
  const newRow = [
    dID,
    driverName.trim(),
    dDate,
    startTime.trim(),
    endTime.trim(),
    shiftDuration,
    idleTime,
    activeTime,
    String(quotaMet),
    String(hasBonus),
  ].join(",");

  // Find insertion point: after last row belonging to this driverID
  let lastIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (splitLine(lines[i])[0] === dID) lastIdx = i;
  }

  if (lastIdx === -1) {
    lines.push(newRow);
  } else {
    lines.splice(lastIdx + 1, 0, newRow);
  }

  fs.writeFileSync(textFile, lines.join("\n") + "\n", "utf8");
  return record;
}

// ══════════════════════════════════════════════════════════════
//  FUNCTION 6 — setBonus(textFile, driverID, date, newValue)
//  Overwrites hasBonus (column 9) for the matching row.
// ══════════════════════════════════════════════════════════════
function setBonus(textFile, driverID, date, newValue) {
  const dID   = driverID.trim();
  const dDate = date.trim();
  const raw   = fs.readFileSync(textFile, "utf8");

  const updated = raw.split("\n").map(line => {
    if (!line.trim()) return line;
    const cols = line.split(",");
    if (cols[0].trim() === dID && cols[2].trim() === dDate) {
      cols[9] = String(newValue);
      return cols.join(",");
    }
    return line;
  });

  fs.writeFileSync(textFile, updated.join("\n"), "utf8");
}

// ══════════════════════════════════════════════════════════════
//  FUNCTION 7 — countBonusPerMonth(textFile, driverID, month)
//  Returns number of rows where hasBonus=true for that driver/month.
//  Returns -1 if driverID not found at all.
// ══════════════════════════════════════════════════════════════
function countBonusPerMonth(textFile, driverID, month) {
  const dID   = driverID.trim();
  const tgtMo = parseInt(month, 10);
  const lines = readLines(textFile);

  let found = false;
  let count = 0;

  for (const line of lines) {
    const c = splitLine(line);
    if (c[0] !== dID) continue;
    found = true;
    const mo = parseInt(c[2].split("-")[1], 10);
    if (mo === tgtMo && c[9].toLowerCase() === "true") count++;
  }

  return found ? count : -1;
}

// ══════════════════════════════════════════════════════════════
//  FUNCTION 8 — getTotalActiveHoursPerMonth(textFile, driverID, month)
//  Sums activeTime (col 7) for driver/month.  Returns "h:mm:ss".
// ══════════════════════════════════════════════════════════════
function getTotalActiveHoursPerMonth(textFile, driverID, month) {
  const dID   = driverID.trim();
  const tgtMo = parseInt(month, 10);
  const lines = readLines(textFile);
  let total   = 0;

  for (const line of lines) {
    const c = splitLine(line);
    if (c[0] !== dID) continue;
    const mo = parseInt(c[2].split("-")[1], 10);
    if (mo === tgtMo) total += durStrToSec(c[7]);
  }

  return secToDurStr(total);
}

// ══════════════════════════════════════════════════════════════
//  FUNCTION 9 — getRequiredHoursPerMonth(textFile, rateFile, bonusCount, driverID, month)
//  Sums the required daily quota for each shift day (skipping the
//  driver's day-off), then deducts 2h per bonus.
//  Returns "h:mm:ss".
// ══════════════════════════════════════════════════════════════
function getRequiredHoursPerMonth(textFile, rateFile, bonusCount, driverID, month) {
  const dID   = driverID.trim();
  const tgtMo = parseInt(month, 10);

  let dayOff = null;
  for (const line of readLines(rateFile)) {
    const c = splitLine(line);
    if (c[0] === dID) { dayOff = c[1].toLowerCase(); break; }
  }

  let total = 0;
  for (const line of readLines(textFile)) {
    const c = splitLine(line);
    if (c[0] !== dID) continue;
    const dateStr = c[2];
    const mo = parseInt(dateStr.split("-")[1], 10);
    if (mo !== tgtMo) continue;

    if (dayOff && weekdayOf(dateStr) === dayOff) continue;
    total += dailyQuota(dateStr);
  }

  total = Math.max(0, total - bonusCount * 2 * 3600);
  return secToDurStr(total);
}

// ══════════════════════════════════════════════════════════════
//  FUNCTION 10 — getNetPay(driverID, actualHours, requiredHours, rateFile)
//  Calculates net salary after missing-hour deductions.
//  Returns integer.
// ══════════════════════════════════════════════════════════════
function getNetPay(driverID, actualHours, requiredHours, rateFile) {
  const dID = driverID.trim();

  const TIER_ALLOWANCE = { 1: 50, 2: 20, 3: 10, 4: 3 };

  let basePay = 0;
  let tier    = 0;
  for (const line of readLines(rateFile)) {
    const c = splitLine(line);
    if (c[0] === dID) { basePay = parseInt(c[2], 10); tier = parseInt(c[3], 10); break; }
  }

  const actualSec   = durStrToSec(actualHours);
  const requiredSec = durStrToSec(requiredHours);

  if (actualSec >= requiredSec) return basePay;

  const missingSec    = requiredSec - actualSec;
  const allowedSec    = (TIER_ALLOWANCE[tier] || 0) * 3600;
  const billableSec   = Math.max(0, missingSec - allowedSec);
  const billableHours = Math.floor(billableSec / 3600);  

  const deductionRate = Math.floor(basePay / 185);
  return basePay - billableHours * deductionRate;
}

module.exports = {
  getShiftDuration,
  getIdleTime,
  getActiveTime,
  metQuota,
  addShiftRecord,
  setBonus,
  countBonusPerMonth,
  getTotalActiveHoursPerMonth,
  getRequiredHoursPerMonth,
  getNetPay,
};
