// application module
// File: C:\Users\yango\Desktop\Chat\src\components\sidebar\Sidebar.jsx
import { useMemo, useState } from 'react'
import { ChevronsLeft, Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConversationList } from '@/components/sidebar/ConversationList'
import { UserEntry } from '@/components/sidebar/UserEntry'
import { useChatStore } from '@/stores/chatStore'
import { useUIStore } from '@/stores/uiStore'
import { cn } from '@/lib/utils'

export function Sidebar({ mobile = false }) {
  const [keyword, setKeyword] = useState('')
  const conversations = useChatStore((s) => s.conversations)
  const createConversation = useChatStore((s) => s.createConversation)
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const setMobileSidebarOpen = useUIStore((s) => s.setMobileSidebarOpen)

  const list = useMemo(() => {
    const sorted = [...conversations].sort(
      (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt,
    )

    if (!keyword.trim()) return sorted
    return sorted.filter((item) => item.title.includes(keyword) || item.lastPreview?.includes(keyword))
  }, [conversations, keyword])

  const collapsed = mobile ? false : sidebarCollapsed

  return (
    <aside
      className={cn(
        'flex h-full flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-all duration-300',
        collapsed ? 'w-[78px]' : 'w-[290px]',
      )}
    >
      <div className='border-b border-sidebar-border p-3'>
        <div className='mb-3 flex items-center justify-between'>
          <div className='flex items-center gap-2 overflow-hidden'>
            <img
              src='/favicon.png'
              alt='Kira AI'
              className='h-8 w-8 shrink-0 rounded-lg object-cover'
            />
            {!collapsed && <span className='truncate text-sm font-semibold'>Kira</span>}
          </div>

          {!mobile && (
            <Button size='icon' variant='ghost' className='h-8 w-8' onClick={toggleSidebar}>
              <ChevronsLeft className={cn('h-4 w-4 transition-transform', collapsed && 'rotate-180')} />
            </Button>
          )}
        </div>

        <Button
          className='h-10 w-full justify-start rounded-xl'
          onClick={() => {
            createConversation()
            if (mobile) setMobileSidebarOpen(false)
          }}
        >
          <Plus className='mr-2 h-4 w-4' />
          {!collapsed && '新建对话'}
        </Button>

        {!collapsed && (
          <label className='mt-3 flex items-center gap-2 rounded-lg border border-sidebar-border bg-card px-2 py-2'>
            <Search className='h-4 w-4 text-muted-foreground' />
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder='搜索会话'
              className='w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground'
            />
          </label>
        )}
      </div>

      <ConversationList conversations={list} collapsed={collapsed} mobile={mobile} />
      <UserEntry collapsed={collapsed} />
    </aside>
  )
}
