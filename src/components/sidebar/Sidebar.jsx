// application module
// File: C:\Users\yango\Desktop\Chat\src\components\sidebar\Sidebar.jsx
import { useMemo, useState } from 'react'
import {
  Bot,
  Boxes,
  ChevronsLeft,
  Database,
  MessageSquareText,
  Plus,
  Search,
  Settings,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConversationList } from '@/components/sidebar/ConversationList'
import { ModelManagerDialog } from '@/components/sidebar/ModelManagerDialog'
import { UserEntry } from '@/components/sidebar/UserEntry'
import { useChatStore } from '@/stores/chatStore'
import { useUIStore } from '@/stores/uiStore'
import { cn } from '@/lib/utils'

// 侧栏一级导航目前用于新界面展示，后续可按路由逐项接入真实页面。
const NAV_ITEMS = [
  { key: 'chat', label: '对话', icon: MessageSquareText },
  { key: 'kb', label: '知识库', icon: Database },
  { key: 'agent', label: '智能体', icon: Bot },
  { key: 'model', label: '模型管理', icon: Boxes },
  { key: 'settings', label: '设置', icon: Settings },
]

export function Sidebar({ mobile = false }) {
  const [keyword, setKeyword] = useState('')
  const [modelDialogOpen, setModelDialogOpen] = useState(false)
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
        collapsed ? 'w-[82px]' : 'w-[268px]',
      )}
    >
      <div className='border-b border-sidebar-border/80 px-3 pb-3 pt-4'>
        <div className='mb-4 flex items-center justify-between'>
          <div className='flex items-center gap-2 overflow-hidden px-1'>
            <img
              src='/favicon.png'
              alt='ChatAI'
              className='h-8 w-8 shrink-0 rounded-xl object-cover shadow-sm'
            />
            {!collapsed && <span className='truncate text-[19px] font-semibold tracking-tight'>ChatAI</span>}
          </div>

          {!mobile && (
            <Button size='icon' variant='ghost' className='h-8 w-8' onClick={toggleSidebar}>
              <ChevronsLeft className={cn('h-4 w-4 transition-transform', collapsed && 'rotate-180')} />
            </Button>
          )}
        </div>

        <Button
          className='h-10 w-full justify-start rounded-xl bg-[linear-gradient(135deg,#6578ff,#5b5df2)] text-white shadow-[0_8px_24px_rgba(84,95,234,0.32)] hover:brightness-105'
          onClick={() => {
            createConversation()
            if (mobile) setMobileSidebarOpen(false)
          }}
        >
          <Plus className='mr-2 h-4 w-4' />
          {!collapsed && '新建对话'}
        </Button>
      </div>

      <div className='px-3 py-2'>
        <ul className='space-y-1'>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon
            const isActive = item.key === 'chat' || (item.key === 'model' && modelDialogOpen)
            return (
              <li key={item.key}>
                <button
                  type='button'
                  onClick={() => {
                    if (item.key === 'model') {
                      setModelDialogOpen(true)
                    }
                  }}
                  className={cn(
                    'flex h-9 w-full items-center rounded-xl px-3 text-left text-sm transition',
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'text-sidebar-foreground/75 hover:bg-card hover:text-sidebar-foreground',
                    collapsed && 'justify-center px-0',
                  )}
                >
                  <Icon className={cn('h-4 w-4 shrink-0', !collapsed && 'mr-2.5')} />
                  {!collapsed && <span className='truncate'>{item.label}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      {!collapsed && (
        <div className='px-4 pb-1 pt-1'>
          <div className='mb-2 flex items-center justify-between text-[12px] font-semibold text-muted-foreground'>
            <span>最近对话</span>
            <Search className='h-3.5 w-3.5' />
          </div>
          <label className='flex items-center gap-2 rounded-xl border border-sidebar-border bg-card px-2 py-1.5'>
            <Search className='h-3.5 w-3.5 text-muted-foreground' />
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder='搜索会话'
              className='w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground'
            />
          </label>
        </div>
      )}

      <ConversationList conversations={list} collapsed={collapsed} mobile={mobile} />
      <UserEntry collapsed={collapsed} />
      <ModelManagerDialog open={modelDialogOpen} onOpenChange={setModelDialogOpen} />
    </aside>
  )
}
