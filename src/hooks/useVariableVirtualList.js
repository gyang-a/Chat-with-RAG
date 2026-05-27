/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useRef, useState } from 'react'

const AT_BOTTOM_THRESHOLD = 80

// 用“前缀和”记录每一项的起始位置。
// positions[i] 表示第 i 项顶部距离列表顶部的像素，最后一位就是列表总高度。
function buildPositions(count, estimateHeight) {
  const positions = new Array(count + 1)
  positions[0] = 0
  for (let i = 0; i < count; i += 1) {
    positions[i + 1] = positions[i] + estimateHeight
  }
  return positions
}

// 根据滚动偏移量找到当前落在哪一项上。
// positions 是递增数组，用二分查找比从头遍历更适合长列表。
function findIndex(positions, offset) {
  let left = 0
  let right = positions.length - 1

  while (left <= right) {
    const mid = (left + right) >> 1
    if (positions[mid] <= offset) {
      left = mid + 1
    } else {
      right = mid - 1
    }
  }

  return Math.max(0, left - 1)
}

// 判断用户是否仍在底部附近。
// 留 80px 阈值，避免用户离底部一点点时就被判定为“手动上翻”。
function isNearBottom(element, totalHeight) {
  if (!element) return true
  return totalHeight - element.scrollTop - element.clientHeight < AT_BOTTOM_THRESHOLD
}

export function useVariableVirtualList({
  count,
  itemKeys,
  containerRef,
  autoScrollEnabled,
  onAtBottomStateChange,
  estimateHeight = 128,
  overscan = 4,
}) {
  // 每一项的真实高度。未测量前先用 estimateHeight 占位。
  const heightsRef = useRef([])
  // 每一项顶部位置的前缀和表，用来计算总高度和虚拟项 top。
  const positionsRef = useRef(buildPositions(0, estimateHeight))
  // 记录消息 id 列表，用来判断本次更新能否复用已有高度。
  const itemKeysRef = useRef([])
  // 当前第一个可见项，用于高度变化时判断是否需要补偿 scrollTop。
  const firstVisibleRef = useRef(0)
  // 滚动事件节流用，避免一次滚动触发过多 React 状态更新。
  const rafRef = useRef(0)
  // 高度或位置变化后递增，驱动虚拟项重新计算。
  const [version, setVersion] = useState(0)
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 0 })
  const [totalHeight, setTotalHeight] = useState(0)
  const [virtualItems, setVirtualItems] = useState([])

  // 从 startIndex 开始重算 positions。
  // 某一项高度变化时，不需要重算它前面的所有位置。
  const rebuildPositions = useCallback((startIndex = 0) => {
    const heights = heightsRef.current
    const positions = positionsRef.current
    const safeStart = Math.max(0, Math.min(startIndex, heights.length))

    for (let i = safeStart; i < heights.length; i += 1) {
      positions[i + 1] = positions[i] + heights[i]
    }
    setTotalHeight(positions[positions.length - 1] || 0)
  }, [])

  // 读取当前列表总高度。
  const getTotalHeight = useCallback(() => {
    const positions = positionsRef.current
    return positions[positions.length - 1] || 0
  }, [])

  // 同步滚动容器的视口信息，并把“是否在底部附近”回传给 useAutoScroll。
  const updateViewport = useCallback(() => {
    const element = containerRef.current
    if (!element) return

    const totalHeight = getTotalHeight()
    const nextViewport = {
      scrollTop: element.scrollTop,
      height: element.clientHeight,
    }

    setViewport(nextViewport)
    onAtBottomStateChange?.(isNearBottom(element, totalHeight))
  }, [containerRef, getTotalHeight, onAtBottomStateChange])

  // 当消息数量或消息 id 列表变化时，初始化或迁移高度缓存。
  useEffect(() => {
    const previousKeys = itemKeysRef.current
    const nextKeys = Array.isArray(itemKeys) ? itemKeys : []
    // 追加新消息时，旧消息 id 会保持前缀一致，这时可以复用已测量高度。
    const canReusePrefix =
      previousKeys.length > 0 &&
      previousKeys.every((key, index) => nextKeys[index] === key)

    if (canReusePrefix) {
      const previousHeights = heightsRef.current
      heightsRef.current = nextKeys.map((_, index) => previousHeights[index] || estimateHeight)
      positionsRef.current = buildPositions(nextKeys.length, estimateHeight)
      rebuildPositions(0)
    } else {
      heightsRef.current = new Array(count).fill(estimateHeight)
      positionsRef.current = buildPositions(count, estimateHeight)
    }

    itemKeysRef.current = nextKeys
    firstVisibleRef.current = 0
    setTotalHeight(positionsRef.current[positionsRef.current.length - 1] || 0)
    setVersion((value) => value + 1)

    const element = containerRef.current
    if (element) {
      setViewport({
        scrollTop: element.scrollTop,
        height: element.clientHeight,
      })
    }
  }, [count, itemKeys, estimateHeight, containerRef, rebuildPositions])

  // 监听滚动和容器尺寸变化，更新当前可视窗口。
  useEffect(() => {
    const element = containerRef.current
    if (!element) return undefined

    updateViewport()

    const onScroll = () => {
      if (rafRef.current) return
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = 0
        updateViewport()
      })
    }

    const resizeObserver = new ResizeObserver(() => {
      updateViewport()
    })

    element.addEventListener('scroll', onScroll, { passive: true })
    resizeObserver.observe(element)

    return () => {
      element.removeEventListener('scroll', onScroll)
      resizeObserver.disconnect()
      if (rafRef.current) {
        window.cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
      }
    }
  }, [containerRef, updateViewport])

  // 测量单条消息的真实高度。
  // 消息内容、代码块、引用、流式输出都会让高度和估算值不同。
  const measureElement = useCallback((index, element) => {
    if (!element || index < 0 || index >= heightsRef.current.length) return

    const measuredHeight = Math.ceil(element.getBoundingClientRect().height)
    const oldHeight = heightsRef.current[index] || estimateHeight
    const delta = measuredHeight - oldHeight

    if (Math.abs(delta) < 1) return

    const scrollElement = containerRef.current
    const totalBefore = getTotalHeight()
    // 如果用户在底部，高度变化后继续贴底。
    const shouldStickToBottom = autoScrollEnabled && isNearBottom(scrollElement, totalBefore)
    // 如果用户正在看历史，且变化发生在可视区域上方，补偿 scrollTop，避免内容跳动。
    const shouldCompensate = !shouldStickToBottom && index < firstVisibleRef.current

    heightsRef.current[index] = measuredHeight
    rebuildPositions(index)
    setVersion((value) => value + 1)

    if (scrollElement && shouldCompensate) {
      scrollElement.scrollTop += delta
    }

    if (scrollElement && shouldStickToBottom) {
      window.requestAnimationFrame(() => {
        scrollElement.scrollTop = getTotalHeight()
      })
    }
  }, [autoScrollEnabled, containerRef, estimateHeight, getTotalHeight, rebuildPositions])

  // 滚动到底部。top 取总高度即可，浏览器会自动夹到最大 scrollTop。
  const scrollToBottom = useCallback((behavior = 'auto') => {
    const element = containerRef.current
    if (!element) return

    element.scrollTo({
      top: getTotalHeight(),
      behavior,
    })
  }, [containerRef, getTotalHeight])

  // 自动跟随开启时，消息数量或测量版本变化都会把视口拉回底部。
  useEffect(() => {
    if (!autoScrollEnabled) return
    window.requestAnimationFrame(() => {
      scrollToBottom('auto')
    })
  }, [autoScrollEnabled, count, scrollToBottom, version])

  // 根据当前 scrollTop/clientHeight 计算需要渲染哪些项。
  // 只渲染可视区域附近的消息，前后额外保留 overscan 项，减少滚动白屏。
  useEffect(() => {
    if (count <= 0) {
      setVirtualItems([])
      return
    }

    const positions = positionsRef.current
    const firstIndex = Math.max(0, findIndex(positions, viewport.scrollTop))
    const lastIndex = Math.min(count - 1, findIndex(positions, viewport.scrollTop + viewport.height))
    const start = Math.max(0, firstIndex - overscan)
    const end = Math.min(count - 1, lastIndex + overscan)
    const nextItems = []

    firstVisibleRef.current = firstIndex

    for (let index = start; index <= end; index += 1) {
      nextItems.push({
        index,
        top: positions[index] || 0,
        height: heightsRef.current[index] || estimateHeight,
      })
    }

    setVirtualItems(nextItems)
  }, [count, estimateHeight, overscan, version, viewport])

  return {
    totalHeight,
    virtualItems,
    measureElement,
    scrollToBottom,
  }
}
