// application module
// File: C:\Users\yango\Desktop\Chat\src\components\chat\MessageList.jsx
import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { MessageBubble } from '@/components/chat/MessageBubble'
import { useVariableVirtualList } from '@/hooks/useVariableVirtualList'

const ESTIMATE_MESSAGE_HEIGHT = 90
const OVERSCAN_COUNT = 5

const VirtualMessageRow = memo(function VirtualMessageRow({
  item,
  message,
  streaming,
  top,
  measureElement,
  onRegenerate,
}) {
  const rowRef = useRef(null)

  useLayoutEffect(() => {
    const element = rowRef.current
    if (!element) return undefined

    measureElement(item.index, element)

    if (!streaming) {
      const firstTimer = window.setTimeout(() => measureElement(item.index, element), 80)
      const secondTimer = window.setTimeout(() => measureElement(item.index, element), 260)

      return () => {
        window.clearTimeout(firstTimer)
        window.clearTimeout(secondTimer)
      }
    }

    const resizeObserver = new ResizeObserver(() => {
      measureElement(item.index, element)
    })
    resizeObserver.observe(element)

    return () => {
      resizeObserver.disconnect()
    }
  }, [item.index, measureElement, streaming, message.content])

  useEffect(() => {
    const element = rowRef.current
    if (!element) return
    measureElement(item.index, element)
  }, [item.index, measureElement, message.refs, message.retrievalModeUsed])

  return (
    <div
      ref={rowRef}
      className='absolute left-0 right-0 top-0'
      style={{
        transform: `translateY(${top}px)`,
      }}
    >
      <MessageBubble message={message} onRegenerate={onRegenerate} streaming={streaming} />
    </div>
  )
})

export function MessageList({
  messages,
  generating,
  autoScrollEnabled,
  onAtBottomStateChange,
  onRegenerate,
}) {
  const containerRef = useRef(null)
  const latestAssistantId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]?.role === 'assistant') return messages[i].id
    }
    return null
  }, [messages])
  const itemSignature = useMemo(() => messages.map((item) => item.id).join('|'), [messages])
  const itemKeys = useMemo(() => (itemSignature ? itemSignature.split('|') : []), [itemSignature])
  const {
    totalHeight,
    virtualItems,
    measureElement,
  } = useVariableVirtualList({
    count: messages.length,
    itemKeys,
    containerRef,
    autoScrollEnabled,
    onAtBottomStateChange,
    estimateHeight: ESTIMATE_MESSAGE_HEIGHT,
    overscan: OVERSCAN_COUNT,
  })

  return (
    <div ref={containerRef} className='h-full overflow-auto py-2'>
      <div className='relative w-full' style={{ height: `${totalHeight}px` }}>
        {virtualItems.map((item) => {
          const message = messages[item.index]
          if (!message) return null

          const streaming = Boolean(generating && message.role === 'assistant' && message.id === latestAssistantId)
          return (
            <VirtualMessageRow
              key={message.id}
              item={item}
              message={message}
              streaming={streaming}
              top={item.top}
              measureElement={measureElement}
              onRegenerate={onRegenerate}
            />
          )
        })}
      </div>
    </div>
  )
}
