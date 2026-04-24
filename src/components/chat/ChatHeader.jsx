// application module
// File: C:\Users\yango\Desktop\Chat\src\components\chat\ChatHeader.jsx
import { Menu, PanelRight, Share2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useChatStore } from '@/stores/chatStore'
import { useUIStore } from '@/stores/uiStore'
import { cn } from '@/lib/utils'

export function ChatHeader({
  availableModels = [],
  selectedModel = '',
  onSelectModel,
  modelsLoading = false,
}) {
  const conversation = useChatStore((s) => s.getCurrentConversation())
  const clearCurrentConversationMessages = useChatStore((s) => s.clearCurrentConversationMessages)
  const toggleRightPanel = useUIStore((s) => s.toggleRightPanel)
  const rightPanelOpen = useUIStore((s) => s.rightPanelOpen)
  const setMobileSidebarOpen = useUIStore((s) => s.setMobileSidebarOpen)

  return (
    <header className='h-16 border-b border-border/80 bg-background/95 px-3 backdrop-blur md:px-5'>
      <div className='mx-auto flex h-full w-full max-w-[1050px] items-center justify-between gap-2'>
        <div className='flex min-w-0 items-center gap-2'>
          <Button
            size='icon'
            variant='ghost'
            className='h-9 w-9 rounded-xl md:hidden'
            aria-label='打开侧边栏'
            onClick={() => setMobileSidebarOpen(true)}
          >
            <Menu className='h-4 w-4' />
          </Button>

          <label className='flex h-9 items-center gap-2 rounded-xl border border-border bg-card px-3 text-xs text-muted-foreground'>
            <span className='hidden whitespace-nowrap sm:inline'>模型</span>
            {/* 顶栏模型选择：与发送链路共享同一状态。 */}
            <select
              value={selectedModel}
              onChange={(event) => onSelectModel?.(event.target.value)}
              disabled={modelsLoading || availableModels.length === 0}
              className='max-w-[210px] bg-transparent text-sm text-foreground outline-none disabled:opacity-60'
              title={selectedModel || '选择模型'}
            >
              {availableModels.length === 0 ? (
                <option value=''>{modelsLoading ? '模型加载中...' : '无可用模型'}</option>
              ) : (
                availableModels.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))
              )}
            </select>
          </label>

          <h1 className='hidden max-w-[34vw] truncate text-sm font-semibold text-foreground lg:block'>
            {conversation?.title || '新对话'}
          </h1>
        </div>

        <div className='flex items-center gap-1'>
          <Button size='sm' variant='ghost' className='hidden h-9 rounded-xl px-3 md:inline-flex'>
            <Share2 className='mr-1 h-4 w-4' />分享
          </Button>
          <Button size='sm' variant='ghost' className='h-9 rounded-xl px-2.5' onClick={clearCurrentConversationMessages}>
            <Trash2 className='h-4 w-4' />
            <span className='ml-1 hidden text-xs md:inline'>清空</span>
          </Button>
          <Button
            size='sm'
            variant='ghost'
            onClick={toggleRightPanel}
            aria-label='切换RAG辅助面板'
            className={cn(
              'h-9 gap-1 rounded-xl px-2.5',
              rightPanelOpen && 'bg-primary/10 text-primary hover:bg-primary/12',
            )}
          >
            <PanelRight className='h-4 w-4' />
            <span className='text-xs font-medium'>RAG</span>
          </Button>
        </div>
      </div>
    </header>
  )
}
