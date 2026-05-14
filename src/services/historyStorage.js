// application module
// File: C:\Users\yango\Desktop\Chat\src\services\historyStorage.js
const HISTORY_KEY = '灵犀-历史'

export function saveHistories(payload) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(payload))
}

export function readHistories() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function clearHistories() {
  localStorage.removeItem(HISTORY_KEY)
}
