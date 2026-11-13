const KEY = "media-studio-history-v1";
export function readHistory() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}
export function addHistory(entry) {
  const items = readHistory();
  items.unshift({ ...entry, createdAt: new Date().toISOString() });
  localStorage.setItem(KEY, JSON.stringify(items.slice(0, 60)));
  return items.slice(0, 60);
}
export function clearHistory() {
  localStorage.removeItem(KEY);
}
