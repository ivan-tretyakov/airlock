import path from "node:path";

export function contractExpired(contract, now = Date.now()) {
  if (contract.expiresAt === undefined) return false;
  const expiresAt = Date.parse(contract.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt <= now;
}

function validIsoTimestamp(value) {
  if (typeof value !== "string") return false;
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/,
  );
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 59) {
    return false;
  }
  if (zone !== "Z") {
    const [zoneHour, zoneMinute] = zone.slice(1).split(":").map(Number);
    if (zoneHour > 23 || zoneMinute > 59) return false;
  }
  return true;
}

function validPathEntries(entries) {
  return Array.isArray(entries) && entries.every((entry) => typeof entry === "string" && entry.length > 0);
}

export function validV2Contract(contract) {
  return (
    validPathEntries(contract.ownedPaths) &&
    (contract.root === undefined || (typeof contract.root === "string" && path.isAbsolute(contract.root))) &&
    (contract.processPaths === undefined || validPathEntries(contract.processPaths)) &&
    (contract.expiresAt === undefined || validIsoTimestamp(contract.expiresAt)) &&
    (contract.allowDispatch === undefined || typeof contract.allowDispatch === "boolean") &&
    (contract.actorMode === undefined || ["agent-id", "single-actor"].includes(contract.actorMode))
  );
}
