// application module
// File: C:\Users\yango\Desktop\Chat\src\components\chat\MessageActions.jsx
import { Copy, RefreshCcw, ThumbsDown, ThumbsUp } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useChatStore } from '@/stores/chatStore'

export function MessageActions({ message, onRegenerate }) {
  const setMessageFeedback = useChatStore((s) => s.setMessageFeedback)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content || '')
    toast.success('已复制到剪贴板')
  }

  return (
    <div className='mt-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100'>
      <Button size='sm' variant='ghost' className='h-7 px-2 text-xs' onClick={handleCopy}>
        <Copy className='mr-1 h-3.5 w-3.5' />复制
      </Button>
      <Button size='sm' variant='ghost' className='h-7 px-2 text-xs' onClick={onRegenerate}>
        <RefreshCcw className='mr-1 h-3.5 w-3.5' />重试
      </Button>
      <Button
        size='icon'
        variant='ghost'
        className={message.feedback === 'up' ? 'h-7 w-7 text-primary' : 'h-7 w-7'}
        onClick={() => setMessageFeedback(message.id, 'up')}
      >
        <ThumbsUp className='h-3.5 w-3.5' />
      </Button>
      <Button
        size='icon'
        variant='ghost'
        className={message.feedback === 'down' ? 'h-7 w-7 text-red-500' : 'h-7 w-7'}
        onClick={() => setMessageFeedback(message.id, 'down')}
      >
        <ThumbsDown className='h-3.5 w-3.5' />
      </Button>
    </div>
  )
}
