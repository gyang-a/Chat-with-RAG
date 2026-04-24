// 模块说明：右侧 RAG 控制台，集中展示检索设置、命中结果与知识库概览。
import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Info } from 'lucide-react'
import { KnowledgeBasePanel } from '@/components/panel/KnowledgeBasePanel'
import { fetchKbDocuments } from '@/services/kbApi'
import { useChatStore } from '@/stores/chatStore'
import { useUIStore } from '@/stores/uiStore'
import { cn } from '@/lib/utils'

function formatTime(value) {
  const time = Number(value || 0)
  if (!time) return '--'
  const date = new Date(time)
  if (Number.isNaN(date.getTime())) return '--'
  return date.toLocaleString('zh-CN', { hour12: false })
}

function resolveScore(item = {}, fallback = 0) {
  const score = Number(item?.score ?? item?.similarity ?? fallback ?? 0)
  if (!Number.isFinite(score)) return 0
  return Math.min(1, Math.max(0, score))
}

export function AuxPanel({ mobile = false }) {
  const rightPanelOpen = useUIStore((s) => s.rightPanelOpen)
  const retrievalMode = useUIStore((s) => s.retrievalMode)
  const setRetrievalMode = useUIStore((s) => s.setRetrievalMode)
  const ragEnabled = useUIStore((s) => s.ragEnabled)
  const setRagEnabled = useUIStore((s) => s.setRagEnabled)
  const ragTopK = useUIStore((s) => s.ragTopK)
  const setRagTopK = useUIStore((s) => s.setRagTopK)
  const conversation = useChatStore((s) => s.getCurrentConversation())
  const [showManager, setShowManager] = useState(false)
  const [stats, setStats] = useState({ docCount: 0, chunkCount: 0, updatedAt: 0 })

  const refs = useMemo(() => conversation?.refs || [], [conversation?.refs])
  const docs = useMemo(() => conversation?.contextDocs || [], [conversation?.contextDocs])

  // 仅在面板可见时拉取统计，避免隐藏状态下持续请求。
  useEffect(() => {
    if (!mobile && !rightPanelOpen) return

    let cancelled = false
    fetchKbDocuments()
      .then((list) => {
        if (cancelled) return
        const safeList = Array.isArray(list) ? list : []
        const chunkCount = safeList.reduce((sum, item) => sum + Number(item?.chunkCount || 0), 0)
        const updatedAt = safeList.reduce((max, item) => Math.max(max, Number(item?.updatedAt || 0)), 0)
        setStats({
          docCount: safeList.length,
          chunkCount,
          updatedAt,
        })
      })
      .catch(() => null)

    return () => {
      cancelled = true
    }
  }, [mobile, rightPanelOpen])

  const results = useMemo(() => {
    const fromRefs = refs.map((item, index) => ({
      id: `${item?.docId || item?.url || index}`,
      title: item?.name || `命中文档 ${index + 1}`,
      source: item?.url ? '知识库 / 外部引用' : '知识库 / 本地文档',
      score: resolveScore(item, 0.72),
    }))

    if (fromRefs.length > 0) return fromRefs.slice(0, ragTopK)

    return docs.slice(0, ragTopK).map((item, index) => ({
      id: `${item?.docId || item?.name || index}`,
      title: item?.name || `上下文文档 ${index + 1}`,
      source: '上下文 / 当前会话',
      score: resolveScore(item, 0.64),
    }))
  }, [docs, ragTopK, refs])

  const panelContent = (
    <div className='space-y-3 p-3.5'>
      <section className='rounded-2xl border border-border bg-card/95 p-3 shadow-soft'>
        <div className='mb-3 flex items-center justify-between'>
          <div className='inline-flex items-center gap-1.5 text-sm font-semibold'>
            <span>RAG</span>
            <Info className='h-3.5 w-3.5 text-muted-foreground' />
          </div>

          <button
            type='button'
            onClick={() => setRagEnabled(!ragEnabled)}
            className={cn(
              'relative h-6 w-11 rounded-full border transition',
              ragEnabled ? 'border-primary/50 bg-primary' : 'border-border bg-muted',
            )}
            aria-label='启用RAG'
          >
            <span
              className={cn(
                'absolute left-0.5 top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow transition-transform',
                ragEnabled && 'translate-x-5',
              )}
            />
          </button>
        </div>

        <div className='space-y-3'>
          <div>
            <p className='mb-1 text-xs text-muted-foreground'>知识库</p>
            <div className='rounded-xl border border-border bg-background px-3 py-2 text-sm'>个人知识库</div>
          </div>

          <div>
            <p className='mb-1 text-xs text-muted-foreground'>检索方式</p>
            <select
              value={ragEnabled ? retrievalMode : 'direct'}
              onChange={(event) => setRetrievalMode(event.target.value)}
              disabled={!ragEnabled}
              className='h-9 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-60'
            >
              <option value='hybrid'>混合检索（向量 + 关键词）</option>
              <option value='semantic'>语义检索</option>
              <option value='text'>文本检索</option>
              <option value='direct'>模型直答</option>
            </select>
          </div>

          <div>
            <div className='mb-1 flex items-center justify-between text-xs text-muted-foreground'>
              <span>Top K</span>
              <span className='rounded-md bg-primary/10 px-1.5 py-0.5 text-primary'>{ragTopK}</span>
            </div>
            <input
              type='range'
              min={1}
              max={10}
              value={ragTopK}
              onChange={(event) => setRagTopK(event.target.value)}
              className='w-full accent-primary'
              disabled={!ragEnabled}
            />
          </div>

          <button
            type='button'
            onClick={() => setShowManager((value) => !value)}
            className='inline-flex items-center text-xs text-primary'
          >
            管理知识库
            <ChevronDown className={cn('ml-1 h-3.5 w-3.5 transition-transform', showManager && 'rotate-180')} />
          </button>
        </div>
      </section>

      <section className='rounded-2xl border border-border bg-card/95 p-3 shadow-soft'>
        <h3 className='mb-2 text-sm font-semibold'>检索结果 ({results.length})</h3>
        <div className='space-y-2'>
          {results.length === 0 ? (
            <p className='rounded-xl border border-border bg-background px-3 py-2 text-xs text-muted-foreground'>
              暂无命中结果，发送一条问题后会展示相关文档。
            </p>
          ) : (
            results.map((item) => (
              <div key={item.id} className='rounded-xl border border-border bg-background px-3 py-2'>
                <p className='truncate text-xs font-medium text-foreground'>{item.title}</p>
                <div className='mt-1 flex items-center justify-between gap-2'>
                  <p className='truncate text-[11px] text-muted-foreground'>{item.source}</p>
                  <span className='text-[11px] font-semibold text-emerald-600'>
                    {item.score.toFixed(2)}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className='rounded-2xl border border-border bg-card/95 p-3 shadow-soft'>
        <h3 className='mb-2 text-sm font-semibold'>知识库概览</h3>
        <div className='space-y-1.5 text-xs text-muted-foreground'>
          <p className='flex items-center justify-between'>
            <span>文档数量</span>
            <span className='font-semibold text-foreground'>{stats.docCount}</span>
          </p>
          <p className='flex items-center justify-between'>
            <span>分块数量</span>
            <span className='font-semibold text-foreground'>{stats.chunkCount}</span>
          </p>
          <p className='flex items-center justify-between'>
            <span>更新时间</span>
            <span className='font-semibold text-foreground'>{formatTime(stats.updatedAt)}</span>
          </p>
          <p className='flex items-center justify-between'>
            <span>嵌入模型</span>
            <span className='font-semibold text-foreground'>text-embedding-3-large</span>
          </p>
        </div>
      </section>

      {showManager && (
        <section className='rounded-2xl border border-border bg-card/95 p-3 shadow-soft'>
          <KnowledgeBasePanel compact />
        </section>
      )}
    </div>
  )

  if (mobile) {
    return <div className='h-full overflow-y-auto bg-background text-foreground'>{panelContent}</div>
  }

  return (
    <aside
      className={cn(
        'hidden h-full border-l border-border bg-background transition-all duration-300 xl:block',
        rightPanelOpen ? 'w-[350px] opacity-100' : 'w-0 opacity-0',
      )}
    >
      {rightPanelOpen && <div className='h-full overflow-y-auto'>{panelContent}</div>}
    </aside>
  )
}
