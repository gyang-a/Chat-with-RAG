// 模块说明：聊天主窗口容器，负责消息区、错误提示与输入区编排。
import { useMemo } from 'react'
import { useChatStore } from '@/stores/chatStore'
import { ChatHeader } from '@/components/chat/ChatHeader'
import { MessageList } from '@/components/chat/MessageList'
import { ChatInput } from '@/components/chat/ChatInput'
import { Button } from '@/components/ui/button'

const EMPTY_MESSAGES = []

export function ChatWindow({
  autoScrollEnabled,
  onAtBottomStateChange,
  onSend,
  onStop,
  onRegenerate,
  availableModels,
  selectedModel,
  onSelectModel,
  modelsLoading,
}) {
  const currentConversationId = useChatStore((s) => s.currentConversationId)
  const messagesByConversation = useChatStore((s) => s.messagesByConversation)
  const quickCards = useChatStore((s) => s.quickCards)
  const generating = useChatStore((s) => s.generating)
  const streamError = useChatStore((s) => s.streamError)

  const messages = useMemo(() => {
    if (!currentConversationId) return EMPTY_MESSAGES
    return messagesByConversation[currentConversationId] || EMPTY_MESSAGES
  }, [currentConversationId, messagesByConversation])

  return (
    <section className='flex min-h-0 min-w-0 flex-1 flex-col'>
      <ChatHeader
        availableModels={availableModels}
        selectedModel={selectedModel}
        onSelectModel={onSelectModel}
        modelsLoading={modelsLoading}
      />

      <main className='relative flex min-h-0 flex-1 flex-col'>
        {messages.length === 0 ? (
          <div className='mx-auto flex h-full w-full max-w-[1050px] flex-col items-center justify-center px-5'>
            <h2 className='bg-gradient-to-r from-[#3f5eff] to-[#429ef8] bg-clip-text text-4xl font-semibold text-transparent'>
              你好，我是灵犀
            </h2>
            <p className='mt-3 text-sm text-muted-foreground'>今天想一起聊点什么？</p>
            <div className='mt-6 grid w-full max-w-[760px] grid-cols-1 gap-3 sm:grid-cols-2'>
              {quickCards.map((card) => (
                <button
                  key={card}
                  className='rounded-2xl border border-border bg-card/92 px-4 py-3 text-left text-sm transition hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-soft'
                  onClick={() => onSend({ text: card, model: selectedModel })}
                >
                  {card}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <MessageList
              messages={messages}
              generating={generating}
              autoScrollEnabled={autoScrollEnabled}
              onAtBottomStateChange={onAtBottomStateChange}
              onRegenerate={onRegenerate}
            />
            {streamError && (
              <div className='px-4 pb-2 md:px-6'>
                <div className='flex items-center justify-between rounded-lg border border-red-300/60 bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950/30 dark:text-red-300'>
                  <span>{streamError}</span>
                  <Button size='sm' variant='outline' className='h-7 px-2 text-xs' onClick={onRegenerate}>
                    重试
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      <ChatInput
        onSend={onSend}
        onStop={onStop}
        selectedModel={selectedModel}
      />
    </section>
  )
}
