// application module
// File: C:\Users\yango\Desktop\Chat\src\hooks\useAutoScroll.js
// import { useCallback, useState } from 'react'

// export function useAutoScroll() {
//   const [autoScrollEnabled, setAutoScrollEnabled] = useState(true)

//   const onAtBottomStateChange = useCallback((atBottom) => {
//     setAutoScrollEnabled(atBottom)
//   }, [])

//   return {
//     autoScrollEnabled,
//     onAtBottomStateChange,
//     forceEnableAutoScroll: () => setAutoScrollEnabled(true),
//   }
// }
import { useCallback, useState } from 'react'

export function useAutoScroll() {
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true)

  //优化：使用函数式更新，无需依赖项，符合 React 规范
  const onAtBottomStateChange = useCallback((atBottom) => {
    setAutoScrollEnabled(atBottom)
  }, [])

  //优化：缓存强制开启方法，避免重复渲染
  const forceEnableAutoScroll = useCallback(() => {
    setAutoScrollEnabled(true)
  }, [])

  return {
    autoScrollEnabled,
    onAtBottomStateChange,
    forceEnableAutoScroll,
  }
}