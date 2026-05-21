/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useRef, useState } from 'react'

const AT_BOTTOM_THRESHOLD = 80

function buildPositions(count, estimateHeight) {
  const positions = new Array(count + 1)
  positions[0] = 0
  for (let i = 0; i < count; i += 1) {
    positions[i + 1] = positions[i] + estimateHeight
  }
  return positions
}

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
  const heightsRef = useRef([])
  const positionsRef = useRef(buildPositions(0, estimateHeight))
  const itemKeysRef = useRef([])
  const firstVisibleRef = useRef(0)
  const rafRef = useRef(0)
  const [version, setVersion] = useState(0)
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 0 })
  const [totalHeight, setTotalHeight] = useState(0)
  const [virtualItems, setVirtualItems] = useState([])

  const rebuildPositions = useCallback((startIndex = 0) => {
    const heights = heightsRef.current
    const positions = positionsRef.current
    const safeStart = Math.max(0, Math.min(startIndex, heights.length))

    for (let i = safeStart; i < heights.length; i += 1) {
      positions[i + 1] = positions[i] + heights[i]
    }
    setTotalHeight(positions[positions.length - 1] || 0)
  }, [])

  const getTotalHeight = useCallback(() => {
    const positions = positionsRef.current
    return positions[positions.length - 1] || 0
  }, [])

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

  useEffect(() => {
    const previousKeys = itemKeysRef.current
    const nextKeys = Array.isArray(itemKeys) ? itemKeys : []
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

  const measureElement = useCallback((index, element) => {
    if (!element || index < 0 || index >= heightsRef.current.length) return

    const measuredHeight = Math.ceil(element.getBoundingClientRect().height)
    const oldHeight = heightsRef.current[index] || estimateHeight
    const delta = measuredHeight - oldHeight

    if (Math.abs(delta) < 1) return

    const scrollElement = containerRef.current
    const totalBefore = getTotalHeight()
    const shouldStickToBottom = autoScrollEnabled && isNearBottom(scrollElement, totalBefore)
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

  const scrollToBottom = useCallback((behavior = 'auto') => {
    const element = containerRef.current
    if (!element) return

    element.scrollTo({
      top: getTotalHeight(),
      behavior,
    })
  }, [containerRef, getTotalHeight])

  useEffect(() => {
    if (!autoScrollEnabled) return
    window.requestAnimationFrame(() => {
      scrollToBottom('auto')
    })
  }, [autoScrollEnabled, count, scrollToBottom, version])

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
