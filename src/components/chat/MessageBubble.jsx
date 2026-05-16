// application module
// File: C:\Users\yango\Desktop\Chat\src\components\chat\MessageBubble.jsx
import { lazy, Suspense } from 'react'
import { Bot } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { MessageActions } from '@/components/chat/MessageActions'
import { LoadingDots } from '@/components/chat/LoadingDots'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'

const MarkdownRenderer = lazy(() =>
  import('@/components/markdown/MarkdownRenderer').then((module) => ({ default: module.MarkdownRenderer })),
)

function normalizeDisplayText(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map((item) => normalizeDisplayText(item)).join('')
  if (typeof value === 'object') {
    if (typeof value.text === 'string') return value.text
    if (typeof value.content === 'string') return value.content
    if (Array.isArray(value.content)) return value.content.map((item) => normalizeDisplayText(item)).join('')
    return ''
  }
  return ''
}

function retrievalModeLabel(mode = '') {
  if (mode === 'none') return '模型直答'
  if (mode === 'semantic') return '语义检索'
  if (mode === 'hybrid') return '混合检索'
  if (mode === 'text') return '文本检索'
  return ''
}

export function MessageBubble({ message, onRegenerate, streaming = false }) {
  const isUser = message.role === 'user'
  const retrievalLabel = retrievalModeLabel(String(message?.retrievalModeUsed || ''))
  const avatarUrl = useAuthStore((s) => s.avatarUrl)
  const username = useAuthStore((s) => s.username)
  const displayLabel = String(username || 'U').slice(0, 1).toUpperCase()
  const normalizedContent = normalizeDisplayText(message.content || '')
  const streamingMinHeight =
    streaming && Number.isFinite(Number(message?.streamLayoutHeight))
      ? Math.max(46, Number(message.streamLayoutHeight))
      : undefined

  if (isUser) {
    const attachments = message.attachments || []
    return (
      <div className='animate-bubble-in mx-auto w-full max-w-[1050px] px-4 py-1.5 md:px-6'>
        <div className='flex w-full items-start gap-3'>
          <div className='ml-auto' />
          <div
            className={cn(
              'ml-auto w-fit max-w-[88%] whitespace-pre-wrap break-words rounded-2xl rounded-br-[4px] border border-border bg-muted px-4 py-3 text-sm text-foreground shadow-soft md:max-w-[72%]',
            )}
          >
            {message.content}
            {attachments.length > 0 && (
              <div className='mt-2 space-y-1'>
                {attachments.map((file, index) => (
                  <div
                    key={`${file.fileId || file.name}_${index}`}
                    className='rounded-md bg-background px-2 py-1 text-xs text-muted-foreground'
                  >
                    附件: {file.name || '未命名文件'}
                  </div>
                ))}
              </div>
            )}
          </div>
          <Avatar className='mt-1 h-8 w-8 flex-shrink-0'>
            <AvatarImage src={avatarUrl} alt='用户头像' />
            <AvatarFallback className='text-xs'>{displayLabel}</AvatarFallback>
          </Avatar>
        </div>
      </div>
    )
  }

  return (
    <div className='group animate-bubble-in mx-auto w-full max-w-[1050px] px-4 py-1.5 md:px-6'>
      <div className='flex w-full items-start gap-3'>
        <Avatar className='mt-1 h-8 w-8 border border-border'>
          {/* 头像使用站点图标，确保 public 目录存在 favicon.png */}
          <AvatarImage src='/assistant.png' alt='Kira AI' />
          {/* 后备头像使用 Bot 图标，维持视觉一致性 */}
          <AvatarFallback className='bg-card text-primary'>
            <Bot className='h-4 w-4' />
          </AvatarFallback>
        </Avatar>
        <div
          className={cn(
            'w-fit min-w-0 max-w-[88%] rounded-2xl rounded-bl-[4px] border border-border bg-card px-4 py-3 text-base text-foreground shadow-soft md:max-w-[76%]',
          )}
          style={streamingMinHeight ? { minHeight: `${streamingMinHeight}px` } : undefined}
        >
          {streaming && (
            <div className='mb-2 flex items-center text-muted-foreground'>
              <LoadingDots />
            </div>
          )}
          {retrievalLabel && (
            <div className='mb-2 inline-flex items-center rounded-md border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground'>
              当前回答: {retrievalLabel}
            </div>
          )}
          <Suspense
            fallback={<pre className='whitespace-pre-wrap break-words font-sans text-sm leading-7'>{normalizedContent}</pre>}
          >
            <MarkdownRenderer content={normalizedContent} />
          </Suspense>
          
          {!streaming && message.refs && message.refs.length > 0 && (
            <div className='mt-3 space-y-1.5 border-t border-border pt-3'>
              <div className='text-xs font-semibold text-muted-foreground'>参考来源：</div>
              <div className='flex flex-wrap gap-2'>
                {message.refs.map((r, i) => (
                  <a 
                    key={i} 
                    href={r.url || '#'} 
                    target='_blank' 
                    rel='noreferrer'
                    className='inline-flex max-w-[200px] items-center gap-1 overflow-hidden rounded-md border border-border bg-muted/50 px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted md:max-w-[300px]'
                    title={r.snippet}
                  >
                    <span className='truncate'>{r.name || '外部来源'}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
          
          <MessageActions message={message} onRegenerate={onRegenerate} />
        </div>
      </div>
    </div>
  )
}
