// 模块说明：侧边栏用户入口，承载头像上传、主题切换与账号操作菜单。
import { useRef, useState } from 'react'
import { ChevronDown, ImageUp, Info, LogOut, Moon, Sun, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogConfirmButton,
} from '@/components/ui/alert-dialog'
import { useChatStore } from '@/stores/chatStore'
import { useAuthStore } from '@/stores/authStore'
import { useUIStore } from '@/stores/uiStore'

export function UserEntry({ collapsed }) {
  const clearCurrentUserHistoryBucket = useChatStore((s) => s.clearCurrentUserHistoryBucket)
  const username = useAuthStore((s) => s.username)
  const avatarUrl = useAuthStore((s) => s.avatarUrl)
  const logout = useAuthStore((s) => s.logout)
  const uploadAvatar = useAuthStore((s) => s.uploadAvatar)
  const darkMode = useUIStore((s) => s.darkMode)
  const toggleDarkMode = useUIStore((s) => s.toggleDarkMode)
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const avatarInputRef = useRef(null)

  const displayName = username || '用户'
  const avatarLabel = displayName.slice(0, 1).toUpperCase()
  // 使用后端返回的相对路径，交给同域静态资源路由 /uploads 解析
  const resolvedAvatarUrl = avatarUrl || ''

  // 头像选择后校验并上传，上传结果由 authStore 写回全局状态。
  const handleSelectAvatar = async (event) => {
    // 选择文件后立即清空 input，保证同一文件可重复选择触发 onChange
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    const isImage = file.type.startsWith('image/')
    if (!isImage) {
      toast.error('仅支持上传图片格式头像')
      return
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error('头像大小不能超过 10MB')
      return
    }

    // 上传状态用于禁用重复点击，并给用户明确反馈
    setUploadingAvatar(true)
    try {
      await uploadAvatar(file)
      toast.success('头像上传成功')
    } catch (error) {
      toast.error(error?.message || '头像上传失败，请重试')
    } finally {
      setUploadingAvatar(false)
    }
  }

  return (
    <>
      <div className='border-t border-sidebar-border p-3'>
        {/* 隐藏 file input，通过菜单项触发点击，保持交互统一 */}
        <input
          ref={avatarInputRef}
          type='file'
          accept='image/png,image/jpeg,image/webp,image/gif'
          className='hidden'
          onChange={handleSelectAvatar}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className='flex w-full items-center gap-2 rounded-2xl border border-sidebar-border bg-card px-2 py-2 transition hover:border-primary/30'>
              <Avatar className='h-9 w-9'>
                {/* 有头像时优先显示图片，加载失败时自动回退到首字母 */}
                <AvatarImage src={resolvedAvatarUrl} alt={`${displayName}头像`} />
                <AvatarFallback>{avatarLabel}</AvatarFallback>
              </Avatar>
              {!collapsed && (
                <>
                  <div className='min-w-0 flex-1 text-left'>
                    <p className='truncate text-sm font-medium'>{displayName}</p>
                    <p className='truncate text-xs text-muted-foreground'>个人账号</p>
                  </div>
                  <span className='rounded-full bg-primary/12 px-2 py-0.5 text-[10px] font-semibold text-primary'>
                    Pro
                  </span>
                  <ChevronDown className='h-4 w-4 text-muted-foreground' />
                </>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' className='w-52'>
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault()
                // 使用菜单项触发隐藏 input，避免额外按钮破坏菜单结构
                if (uploadingAvatar) return
                avatarInputRef.current?.click()
              }}
            >
              <ImageUp className='mr-2 h-3.5 w-3.5' />
              {uploadingAvatar ? '头像上传中...' : '上传头像'}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setClearConfirmOpen(true)}>
              <Trash2 className='mr-2 h-3.5 w-3.5' />清空当前账号历史
            </DropdownMenuItem>
            <DropdownMenuItem onClick={toggleDarkMode}>
              {darkMode ? (
                <>
                  <Sun className='mr-2 h-3.5 w-3.5' />浅色模式
                </>
              ) : (
                <>
                  <Moon className='mr-2 h-3.5 w-3.5' />暗黑模式
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <Info className='mr-2 h-3.5 w-3.5' />关于
            </DropdownMenuItem>
            <DropdownMenuItem onClick={logout}>
              <LogOut className='mr-2 h-3.5 w-3.5' />退出登录
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <AlertDialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认清空当前账号历史？</AlertDialogTitle>
            <AlertDialogDescription>
              该操作仅影响当前账号，不会删除其他账号的历史记录。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancelButton>取消</AlertDialogCancelButton>
            <AlertDialogConfirmButton
              onClick={() => {
                clearCurrentUserHistoryBucket()
                setClearConfirmOpen(false)
              }}
            >
              确认清空
            </AlertDialogConfirmButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
