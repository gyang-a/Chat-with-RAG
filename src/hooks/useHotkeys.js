// application module
// File: C:\Users\yango\Desktop\Chat\src\hooks\useHotkeys.js
import { useEffect } from 'react'

export function useHotkeys({ onNewConversation, onSend }) {
  useEffect(() => {
    const handleKeyDown = (event) => {
      const ctrlOrCmd = event.ctrlKey || event.metaKey

      if (!ctrlOrCmd) return

      if (event.key.toLowerCase() === 'n') {
        event.preventDefault()
        onNewConversation?.()
      }

      if (event.key === 'Enter') {
        onSend?.()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onNewConversation, onSend])
}
