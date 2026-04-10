// application module
// File: C:\Users\yango\Desktop\Chat\src\components\chat\MessageList.jsx
import { useMemo } from 'react'
import { Virtuoso } from 'react-virtuoso'
import { MessageBubble } from '@/components/chat/MessageBubble'

export function MessageList({
  messages,
  generating,
  autoScrollEnabled,
  onAtBottomStateChange,
  onRegenerate,
}) {
  const latestAssistantId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]?.role === 'assistant') return messages[i].id
    }
    return null
  }, [messages])

  return (
    <Virtuoso
      className='h-full'
      data={messages}
      atBottomStateChange={onAtBottomStateChange}
      followOutput={autoScrollEnabled ? (generating ? 'auto' : 'smooth') : false}
      overscan={220}
      itemContent={(_, item) => {
        const streaming = Boolean(generating && item.role === 'assistant' && item.id === latestAssistantId)
        return <MessageBubble key={item.id} message={item} onRegenerate={onRegenerate} streaming={streaming} />
      }}
    />
  )
}
