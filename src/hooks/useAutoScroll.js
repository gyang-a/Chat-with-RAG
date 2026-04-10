// application module
// File: C:\Users\yango\Desktop\Chat\src\hooks\useAutoScroll.js
import { useCallback, useState } from 'react'

export function useAutoScroll() {
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true)

  const onAtBottomStateChange = useCallback((atBottom) => {
    setAutoScrollEnabled(atBottom)
  }, [])

  return {
    autoScrollEnabled,
    onAtBottomStateChange,
    forceEnableAutoScroll: () => setAutoScrollEnabled(true),
  }
}
