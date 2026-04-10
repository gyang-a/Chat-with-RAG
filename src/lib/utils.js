// application module
// File: C:\Users\yango\Desktop\Chat\src\lib\utils.js
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export function createId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export function formatRelativeLabel(timestamp) {
  const date = new Date(timestamp)
  const now = new Date()
  const oneDay = 24 * 60 * 60 * 1000
  const diff = now.setHours(0, 0, 0, 0) - new Date(date).setHours(0, 0, 0, 0)

  if (diff === 0) return '今天'
  if (diff === oneDay) return '昨天'
  if (diff < 7 * oneDay) return '近7天'
  return '更早'
}

export function truncateText(text, max = 48) {
  if (!text) return ''
  return text.length > max ? `${text.slice(0, max)}...` : text
}
