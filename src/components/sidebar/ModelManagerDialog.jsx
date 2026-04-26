// 模块说明：模型管理弹窗，支持新增/查看/删除用户自定义模型。
import { useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  createCustomModel,
  deleteCustomModel,
  fetchCustomModels,
  createCustomEmbeddingModel,
  deleteCustomEmbeddingModel,
  setDefaultEmbeddingModel,
  fetchCustomEmbeddingModels,
  fetchEmbeddingModelSource,
  updateEmbeddingModelSource,
} from '@/services/modelApi'

function formatTime(value) {
  const time = Number(value || 0)
  if (!time) return '--'
  const date = new Date(time)
  if (Number.isNaN(date.getTime())) return '--'
  return date.toLocaleString('zh-CN', { hour12: false })
}

export function ModelManagerDialog({ open, onOpenChange }) {
  const [activeTab, setActiveTab] = useState('chat') // 'chat' | 'embedding'

  // 语言模型相关 state
  const [endpoint, setEndpoint] = useState('')
  const [modelName, setModelName] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [models, setModels] = useState([])

  // 嵌入模型相关 state
  const [embEndpoint, setEmbEndpoint] = useState('')
  const [embModelName, setEmbModelName] = useState('')
  const [embApiKey, setEmbApiKey] = useState('')
  const [embModels, setEmbModels] = useState([])
  const [embSelectedSource, setEmbSelectedSource] = useState('auto')
  const [embEffectiveSource, setEmbEffectiveSource] = useState('global')

  // 通用 state
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [deletingName, setDeletingName] = useState('')
  const [switchingEmbSource, setSwitchingEmbSource] = useState(false)

  const canSubmitChat = useMemo(() => {
    return endpoint.trim().length > 0 && modelName.trim().length > 0 && apiKey.trim().length > 0 && !submitting
  }, [apiKey, endpoint, modelName, submitting])

  const canSubmitEmb = useMemo(() => {
    return embEndpoint.trim().length > 0 && embModelName.trim().length > 0 && !submitting
  }, [embEndpoint, embModelName, submitting])

  const refreshModels = async () => {
    setLoading(true)
    try {
      const list = await fetchCustomModels()
      setModels(Array.isArray(list) ? list : [])
    } catch (error) {
      toast.error(error?.message || '读取自定义模型失败')
    } finally {
      setLoading(false)
    }
  }

  const refreshEmbeddingModels = async () => {
    setLoading(true)
    try {
      const list = await fetchCustomEmbeddingModels()
      setEmbModels(Array.isArray(list) ? list : [])
    } catch (error) {
      toast.error(error?.message || '读取自定义嵌入模型失败')
    } finally {
      setLoading(false)
    }
  }

  const refreshEmbeddingSource = async () => {
    try {
      const data = await fetchEmbeddingModelSource()
      setEmbSelectedSource(data.selectedSource || 'auto')
      setEmbEffectiveSource(data.effectiveSource || 'global')
    } catch (error) {
      toast.error(error?.message || '读取嵌入模型来源失败')
    }
  }

  useEffect(() => {
    if (!open) return
    if (activeTab === 'chat') {
      refreshModels().catch(() => null)
    } else {
      refreshEmbeddingModels().catch(() => null)
      refreshEmbeddingSource().catch(() => null)
    }
  }, [open, activeTab])

  const notifyModelsUpdated = () => {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new Event('kria:models-updated'))
  }

  const handleSubmitChat = async () => {
    if (!canSubmitChat) return

    setSubmitting(true)
    try {
      const result = await createCustomModel({
        modelName: modelName.trim(),
        apiKey: apiKey.trim(),
        endpoint: endpoint.trim(),
      })
      toast.success(result?.updated ? '模型已更新' : '模型已添加')
      setApiKey('')
      setEndpoint('')
      setModelName('')
      await refreshModels()
      notifyModelsUpdated()
    } catch (error) {
      toast.error(error?.message || '保存模型失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleSubmitEmb = async () => {
    if (!canSubmitEmb) return

    setSubmitting(true)
    try {
      const result = await createCustomEmbeddingModel({
        modelName: embModelName.trim(),
        apiKey: embApiKey.trim(),
        endpoint: embEndpoint.trim(),
      })
      toast.success(result?.updated ? '嵌入模型已更新' : '嵌入模型已添加')
      setEmbApiKey('')
      setEmbEndpoint('')
      setEmbModelName('')
      await refreshEmbeddingModels()
      await refreshEmbeddingSource()
      window.dispatchEvent(new Event('kria:embedding-models-updated'))
    } catch (error) {
      toast.error(error?.message || '保存嵌入模型失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteChat = async (name = '') => {
    if (!name) return
    setDeletingName(name)
    try {
      await deleteCustomModel(name)
      toast.success('模型已删除')
      await refreshModels()
      notifyModelsUpdated()
    } catch (error) {
      toast.error(error?.message || '删除模型失败')
    } finally {
      setDeletingName('')
    }
  }

  const handleDeleteEmb = async (name = '') => {
    if (!name) return
    setDeletingName(name)
    try {
      await deleteCustomEmbeddingModel(name)
      toast.success('嵌入模型已删除')
      await refreshEmbeddingModels()
      await refreshEmbeddingSource()
      window.dispatchEvent(new Event('kria:embedding-models-updated'))
    } catch (error) {
      toast.error(error?.message || '删除嵌入模型失败')
    } finally {
      setDeletingName('')
    }
  }

  const handleSetDefaultEmb = async (name = '') => {
    if (!name) return
    try {
      await setDefaultEmbeddingModel(name)
      toast.success('已设为默认嵌入模型')
      await refreshEmbeddingModels()
      await refreshEmbeddingSource()
      // 通知嵌入模型配置已更新
      window.dispatchEvent(new Event('kria:embedding-models-updated'))
    } catch (error) {
      toast.error(error?.message || '设置默认失败')
    }
  }

  const handleSwitchEmbeddingSource = async (source) => {
    if (!source || switchingEmbSource) return

    setSwitchingEmbSource(true)
    try {
      const result = await updateEmbeddingModelSource(source)
      setEmbSelectedSource(result.selectedSource || source)
      setEmbEffectiveSource(result.effectiveSource || 'global')
      toast.success(source === 'global' ? '已切换为 env 嵌入模型，请对旧文档执行重建索引' : '已切换为自定义嵌入模型，请对旧文档执行重建索引')
      window.dispatchEvent(new Event('kria:embedding-models-updated'))
    } catch (error) {
      toast.error(error?.message || '切换嵌入模型来源失败')
    } finally {
      setSwitchingEmbSource(false)
    }
  }

  const renderModelList = (list, onDelete) =>
    loading ? (
      <p className='text-xs text-muted-foreground'>加载中...</p>
    ) : list.length === 0 ? (
      <p className='text-xs text-muted-foreground'>还没有自定义模型，先添加一个吧。</p>
    ) : (
      list.map((item) => (
        <div key={item.name} className='rounded-lg border border-border bg-card px-3 py-2'>
          <div className='flex items-center justify-between gap-2'>
            <div className='min-w-0'>
              <p className='truncate text-sm font-medium'>{item.name}</p>
              <p className='text-[11px] text-muted-foreground'>更新时间: {formatTime(item.updatedAt)}</p>
            </div>
            <Button
              size='sm'
              variant='ghost'
              className='h-7 px-2 text-xs text-red-500 hover:text-red-500'
              disabled={Boolean(deletingName) && deletingName === item.name}
              onClick={() => onDelete(item.name)}
            >
              <Trash2 className='mr-1 h-3.5 w-3.5' />
              {deletingName === item.name ? '删除中' : '删除'}
            </Button>
          </div>
        </div>
      ))
    )

  const renderEmbModelList = (list) =>
    loading ? (
      <p className='text-xs text-muted-foreground'>加载中...</p>
    ) : list.length === 0 ? (
      <p className='text-xs text-muted-foreground'>还没有自定义嵌入模型，先添加一个吧。</p>
    ) : (
      list.map((item) => (
        <div key={item.name} className='rounded-lg border border-border bg-card px-3 py-2'>
          <div className='flex items-center justify-between gap-2'>
            <div className='min-w-0'>
              <div className='flex items-center gap-1.5'>
                <p className='truncate text-sm font-medium'>{item.name}</p>
                {item.isDefault && (
                  <span className='rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary'>
                    默认
                  </span>
                )}
              </div>
              <p className='text-[11px] text-muted-foreground'>更新时间: {formatTime(item.updatedAt)}</p>
            </div>
            <div className='flex items-center gap-1'>
              {!item.isDefault && (
                <Button
                  size='sm'
                  variant='ghost'
                  className='h-7 px-2 text-xs text-primary hover:text-primary'
                  onClick={() => handleSetDefaultEmb(item.name)}
                >
                  设为默认
                </Button>
              )}
              <Button
                size='sm'
                variant='ghost'
                className='h-7 px-2 text-xs text-red-500 hover:text-red-500'
                disabled={Boolean(deletingName) && deletingName === item.name}
                onClick={() => handleDeleteEmb(item.name)}
              >
                <Trash2 className='mr-1 h-3.5 w-3.5' />
                {deletingName === item.name ? '删除中' : '删除'}
              </Button>
            </div>
          </div>
        </div>
      ))
    )

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className='max-w-[560px]'>
        <AlertDialogHeader>
          <AlertDialogTitle>模型管理</AlertDialogTitle>
          <AlertDialogDescription>配置语言模型和嵌入模型。</AlertDialogDescription>
        </AlertDialogHeader>

        {/* Tab 切换 */}
        <div className='flex border-b'>
          <button
            className={`px-4 py-2 text-sm transition-colors ${
              activeTab === 'chat'
                ? 'border-b-2 border-primary font-medium text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setActiveTab('chat')}
          >
            语言模型
          </button>
          <button
            className={`px-4 py-2 text-sm transition-colors ${
              activeTab === 'embedding'
                ? 'border-b-2 border-primary font-medium text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setActiveTab('embedding')}
          >
            嵌入模型
          </button>
        </div>

        {/* 语言模型 Tab */}
        {activeTab === 'chat' && (
          <div className='space-y-3'>
            <label className='space-y-1'>
              <span className='text-xs text-muted-foreground'>接口地址</span>
              <input
                value={endpoint}
                onChange={(event) => setEndpoint(event.target.value)}
                placeholder='例如: http://localhost:11434/v1/chat/completions'
                className='h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground'
              />
            </label>

            <div className='grid grid-cols-1 gap-2 md:grid-cols-[1.4fr,1fr]'>
              <label className='space-y-1'>
                <span className='text-xs text-muted-foreground'>模型名称</span>
                <input
                  value={modelName}
                  onChange={(event) => setModelName(event.target.value)}
                  placeholder='例如: qwen3.5:4b'
                  className='h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground'
                />
              </label>

              <label className='space-y-1'>
                <span className='text-xs text-muted-foreground'>API Key</span>
                <input
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder='本地模型可填任意值'
                  className='h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground'
                  type='password'
                />
              </label>
            </div>

            <div className='flex justify-end'>
              <Button size='sm' className='h-8 rounded-lg' disabled={!canSubmitChat} onClick={handleSubmitChat}>
                {submitting ? (
                  <>
                    <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' />保存中
                  </>
                ) : (
                  <>
                    <Plus className='mr-1.5 h-3.5 w-3.5' />保存模型
                  </>
                )}
              </Button>
            </div>

            <div className='max-h-[260px] space-y-2 overflow-y-auto rounded-lg border border-border bg-muted/25 p-2'>
              {renderModelList(models, handleDeleteChat)}
            </div>
          </div>
        )}

        {/* 嵌入模型 Tab */}
        {activeTab === 'embedding' && (
          <div className='space-y-3'>
            <div className='rounded-lg border border-border bg-muted/25 p-2'>
              <p className='mb-2 text-xs text-muted-foreground'>当前来源: {embEffectiveSource === 'custom' ? '自定义嵌入模型' : 'env 全局嵌入模型'}</p>
              <div className='flex flex-wrap gap-2'>
                <Button
                  size='sm'
                  variant={embSelectedSource === 'custom' ? 'default' : 'outline'}
                  className='h-7 px-2 text-xs'
                  disabled={switchingEmbSource}
                  onClick={() => handleSwitchEmbeddingSource('custom')}
                >
                  使用自定义
                </Button>
                <Button
                  size='sm'
                  variant={embSelectedSource === 'global' ? 'default' : 'outline'}
                  className='h-7 px-2 text-xs'
                  disabled={switchingEmbSource}
                  onClick={() => handleSwitchEmbeddingSource('global')}
                >
                  使用 env
                </Button>
                <Button
                  size='sm'
                  variant={embSelectedSource === 'auto' ? 'default' : 'outline'}
                  className='h-7 px-2 text-xs'
                  disabled={switchingEmbSource}
                  onClick={() => handleSwitchEmbeddingSource('auto')}
                >
                  自动
                </Button>
              </div>
            </div>

            <label className='space-y-1'>
              <span className='text-xs text-muted-foreground'>接口地址</span>
              <input
                value={embEndpoint}
                onChange={(event) => setEmbEndpoint(event.target.value)}
                placeholder='例如: http://localhost:11434/v1/embeddings'
                className='h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground'
              />
            </label>

            <div className='grid grid-cols-1 gap-2 md:grid-cols-[1.4fr,1fr]'>
              <label className='space-y-1'>
                <span className='text-xs text-muted-foreground'>模型名称</span>
                <input
                  value={embModelName}
                  onChange={(event) => setEmbModelName(event.target.value)}
                  placeholder='例如: nomic-embed-text'
                  className='h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground'
                />
              </label>

              <label className='space-y-1'>
                <span className='text-xs text-muted-foreground'>API Key</span>
                <input
                  value={embApiKey}
                  onChange={(event) => setEmbApiKey(event.target.value)}
                  placeholder='可留空（本地模型通常不需要）'
                  className='h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground'
                  type='password'
                />
              </label>
            </div>

            <div className='flex justify-end'>
              <Button size='sm' className='h-8 rounded-lg' disabled={!canSubmitEmb} onClick={handleSubmitEmb}>
                {submitting ? (
                  <>
                    <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' />保存中
                  </>
                ) : (
                  <>
                    <Plus className='mr-1.5 h-3.5 w-3.5' />保存嵌入模型
                  </>
                )}
              </Button>
            </div>

            <div className='max-h-[260px] space-y-2 overflow-y-auto rounded-lg border border-border bg-muted/25 p-2'>
              {renderEmbModelList(embModels)}
            </div>
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancelButton>关闭</AlertDialogCancelButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
