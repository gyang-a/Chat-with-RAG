// application module
// File: C:\Users\yango\Desktop\Chat\src\components\sidebar\ConversationList.jsx
import { useState } from 'react'
import { MoreHorizontal, Pencil, Pin, Trash2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { useChatStore } from '@/stores/chatStore'
import { useUIStore } from '@/stores/uiStore'
import { truncateText } from '@/lib/utils'
import { cn } from '@/lib/utils'

export function ConversationList({ conversations, collapsed, mobile }) {
  const [editingId, setEditingId] = useState('')
  const [editingTitle, setEditingTitle] = useState('')

  const currentConversationId = useChatStore((s) => s.currentConversationId)
  const setCurrentConversation = useChatStore((s) => s.setCurrentConversation)
  const renameConversation = useChatStore((s) => s.renameConversation)
  const deleteConversation = useChatStore((s) => s.deleteConversation)
  const togglePinConversation = useChatStore((s) => s.togglePinConversation)
  const setMobileSidebarOpen = useUIStore((s) => s.setMobileSidebarOpen)

  const startRename = (id, title) => {
    setEditingId(id)
    setEditingTitle(title)
  }

  const submitRename = () => {
    if (!editingId) return
    renameConversation(editingId, editingTitle)
    setEditingId('')
    setEditingTitle('')
  }

  return (
    <div className='min-h-0 flex-1 overflow-y-auto p-2'>
      <ul className='space-y-1'>
        {conversations.map((item) => {
          const active = item.id === currentConversationId
          return (
            <li key={item.id}>
              <div
                role='button'
                tabIndex={0}
                className={cn(
                  'group w-full rounded-xl border px-3 py-2 text-left transition duration-200',
                  active
                    ? 'border-primary/40 bg-primary/10 text-foreground'
                    : 'border-transparent hover:border-sidebar-border hover:bg-card',
                )}
                onClick={() => {
                  setCurrentConversation(item.id)
                  if (mobile) setMobileSidebarOpen(false)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setCurrentConversation(item.id)
                    if (mobile) setMobileSidebarOpen(false)
                  }
                }}
              >
                {collapsed ? (
                  <div className='text-center text-xs font-medium'>{item.title.slice(0, 1)}</div>
                ) : (
                  <div className='flex items-start gap-2'>
                    <div className='min-w-0 flex-1'>
                      {editingId === item.id ? (
                        <input
                          autoFocus
                          value={editingTitle}
                          onChange={(e) => setEditingTitle(e.target.value)}
                          onBlur={submitRename}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') submitRename()
                          }}
                          className='w-full rounded bg-background px-1.5 py-1 text-sm outline-none'
                        />
                      ) : (
                        <p className='truncate text-sm font-medium'>{item.pinned ? '📌 ' : ''}{truncateText(item.title, 24)}</p>
                      )}
                      <p className='mt-0.5 truncate text-xs text-muted-foreground'>{truncateText(item.lastPreview || '暂无消息', 34)}</p>
                    </div>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size='icon'
                          variant='ghost'
                          className='h-7 w-7 opacity-0 transition group-hover:opacity-100'
                          onClick={(e) => {
                            e.stopPropagation()
                          }}
                          onKeyDown={(e) => {
                            e.stopPropagation()
                          }}
                        >
                          <MoreHorizontal className='h-3.5 w-3.5' />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align='end'>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation()
                            startRename(item.id, item.title)
                          }}
                        >
                          <Pencil className='mr-2 h-3.5 w-3.5' />重命名
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation()
                            togglePinConversation(item.id)
                          }}
                        >
                          <Pin className='mr-2 h-3.5 w-3.5' />{item.pinned ? '取消置顶' : '置顶'}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className='text-red-500'
                          onClick={(e) => {
                            e.stopPropagation()
                            deleteConversation(item.id)
                          }}
                        >
                          <Trash2 className='mr-2 h-3.5 w-3.5' />删除
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
