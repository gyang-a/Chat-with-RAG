// application module
// File: C:\Users\yango\Desktop\Chat\src\components\chat\ChatHeader.jsx
import { Menu, PanelRight, Share2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useChatStore } from '@/stores/chatStore'
import { useUIStore } from '@/stores/uiStore'
import { cn } from '@/lib/utils'

export function ChatHeader() {
  const conversation = useChatStore((s) => s.getCurrentConversation())
  const clearCurrentConversationMessages = useChatStore((s) => s.clearCurrentConversationMessages)
  const toggleRightPanel = useUIStore((s) => s.toggleRightPanel)
  const rightPanelOpen = useUIStore((s) => s.rightPanelOpen)
  const setMobileSidebarOpen = useUIStore((s) => s.setMobileSidebarOpen)

  return (
    <header className='h-14 border-b border-border bg-background px-3 md:px-5'>
      <div className='mx-auto flex h-full w-full max-w-[980px] items-center justify-between'>
        <div className='flex items-center gap-2'>
          <Button
            size='icon'
            variant='ghost'
            className='md:hidden'
            aria-label='打开侧边栏'
            onClick={() => setMobileSidebarOpen(true)}
          >
            <Menu className='h-4 w-4' />
          </Button>
          <h1 className='max-w-[42vw] truncate text-sm font-semibold text-foreground md:max-w-none md:text-base'>
            {conversation?.title || '新对话'}
          </h1>
        </div>

        <div className='flex items-center gap-1'>
          <Button size='sm' variant='ghost' className='hidden md:inline-flex'>
            <Share2 className='mr-1 h-4 w-4' />分享会话
          </Button>
          <Button size='sm' variant='ghost' onClick={clearCurrentConversationMessages}>
            <Trash2 className='mr-1 h-4 w-4' />清空对话
          </Button>
          <Button
            size='sm'
            variant='ghost'
            onClick={toggleRightPanel}
            aria-label='切换RAG辅助面板'
            className={cn('gap-1 px-2', rightPanelOpen && 'bg-accent text-accent-foreground')}
          >
            <PanelRight className='h-4 w-4' />
            <span className='text-xs font-medium'>RAG</span>
          </Button>
        </div>
      </div>
    </header>
  )
}
