// 模块说明：RAG 服务核心，负责文档入库、切块向量化、检索召回与引用聚合。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import process from 'node:process'
import { Buffer } from 'node:buffer'
import iconv from 'iconv-lite'
import jschardet from 'jschardet'
import mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'
import WordExtractor from 'word-extractor'

const DEFAULT_KB_ID = 'default'
const MAX_CANDIDATES_TEXT = 200
const MAX_CANDIDATES_RECENT = 200
const DOC_MIME = 'application/msword'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const wordExtractor = new WordExtractor()

// 注意：index.js 在导入本模块后才加载 .env.server，因此这里必须动态读取环境变量。
function getMaxIngestConcurrency() {
  return Math.max(1, Number(process.env.KB_INGEST_CONCURRENCY || 2))
}

function getMaxIngestQueueSize() {
  return Math.max(1, Number(process.env.KB_INGEST_QUEUE_SIZE || 80))
}

function getEmbeddingApiUrl() {
  return String(process.env.EMBEDDING_API_URL || '').trim()
}

function getEmbeddingApiKey() {
  return String(process.env.EMBEDDING_API_KEY || '').trim()
}

function getEmbeddingModel() {
  return String(process.env.EMBEDDING_MODEL || '').trim()
}

function getEmbeddingBatchSize() {
  return Math.max(1, Number(process.env.EMBEDDING_BATCH_SIZE || 16))
}

function getEmbeddingEncodingFormat() {
  return String(process.env.EMBEDDING_ENCODING_FORMAT || 'float').trim() || 'float'
}

function getVectorSearchEnabled() {
  return String(process.env.MONGODB_VECTOR_SEARCH_ENABLED || 'false').toLowerCase() === 'true'
}

function getVectorSearchIndexName() {
  return String(process.env.MONGODB_VECTOR_INDEX_NAME || 'kb_chunks_vector_index').trim()
}

function getVectorSearchLimit() {
  return Math.max(1, Number(process.env.MONGODB_VECTOR_SEARCH_LIMIT || 40))
}

function getVectorSearchNumCandidates() {
  return Math.max(20, Number(process.env.MONGODB_VECTOR_SEARCH_NUM_CANDIDATES || 160))
}

function getRagRouteMinConfidence() {
  return Math.min(1, Math.max(0, Number(process.env.RAG_ROUTE_MIN_CONFIDENCE || 0.32)))
}

function getRagRouteMinConfidenceText() {
  return Math.min(1, Math.max(0, Number(process.env.RAG_ROUTE_MIN_CONFIDENCE_TEXT || 0.12)))
}

function getRagRoutePinnedBoostEnabled() {
  return String(process.env.RAG_ROUTE_PINNED_BOOST_ENABLED || 'true').toLowerCase() !== 'false'
}

function getRagRouteShortQueryHardMaxLen() {
  return Math.max(1, Number(process.env.RAG_ROUTE_SHORT_QUERY_HARD_MAX_LEN || 2))
}

function getRagRouteShortQuerySoftMaxLen() {
  return Math.max(getRagRouteShortQueryHardMaxLen(), Number(process.env.RAG_ROUTE_SHORT_QUERY_SOFT_MAX_LEN || 4))
}

function getRagRouteShortQueryMaxTerms() {
  return Math.max(1, Number(process.env.RAG_ROUTE_SHORT_QUERY_MAX_TERMS || 1))
}

function getRagRouteMinTopScoreText() {
  return clamp01(Number(process.env.RAG_ROUTE_MIN_TOP_SCORE_TEXT || 0.2))
}

function getRagRouteMinTopScoreSemantic() {
  return clamp01(Number(process.env.RAG_ROUTE_MIN_TOP_SCORE_SEMANTIC || 0.24))
}

function getRagRouteMinTopScoreHybrid() {
  return clamp01(Number(process.env.RAG_ROUTE_MIN_TOP_SCORE_HYBRID || 0.22))
}

function getRagContextTopK() {
  return Math.max(1, Number(process.env.RAG_CONTEXT_TOP_K || 6))
}

function getRagKeywordRecallLimit() {
  return Math.max(1, Number(process.env.RAG_KEYWORD_RECALL_LIMIT || 120))
}

function getRagKeywordRecallMinHits() {
  return Math.max(1, Number(process.env.RAG_KEYWORD_RECALL_MIN_HITS || 1))
}

function getRagKeywordRecallMaxTerms() {
  return Math.max(1, Number(process.env.RAG_KEYWORD_RECALL_MAX_TERMS || 64))
}

// 将数值限制在 0 到 1 区间，避免评分计算越界。
function clamp01(value) {
  return Math.min(1, Math.max(0, Number(value || 0)))
}

// 检查是否已配置向量化依赖（URL 与模型名）。
function isEmbeddingEnabled() {
  return Boolean(getEmbeddingApiUrl() && getEmbeddingModel())
}

// 计算向量 L2 范数，用于余弦相似度计算。
function safeVectorNorm(vector = []) {
  if (!Array.isArray(vector) || vector.length === 0) return 0
  let sum = 0
  for (const value of vector) {
    const n = Number(value || 0)
    sum += n * n
  }
  return Math.sqrt(sum)
}

// 计算余弦相似度；输入非法时返回 0。
function cosineSimilarity(queryVector = [], queryNorm = 0, chunkVector = [], chunkNorm = 0) {
  if (!Array.isArray(queryVector) || !Array.isArray(chunkVector)) return 0
  if (!queryNorm || !chunkNorm) return 0
  if (queryVector.length !== chunkVector.length) return 0

  let dot = 0
  for (let i = 0; i < queryVector.length; i += 1) {
    dot += Number(queryVector[i] || 0) * Number(chunkVector[i] || 0)
  }
  return dot / (queryNorm * chunkNorm)
}

// 调用 Embedding 接口批量向量化文本。
async function requestEmbeddings(textList = []) {
  if (!isEmbeddingEnabled()) return []
  const embeddingApiUrl = getEmbeddingApiUrl()
  const embeddingApiKey = getEmbeddingApiKey()
  const embeddingModel = getEmbeddingModel()
  const embeddingEncodingFormat = getEmbeddingEncodingFormat()
  const list = Array.isArray(textList) ? textList.filter((item) => String(item || '').trim()) : []
  if (list.length === 0) return []

  const response = await fetch(embeddingApiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(embeddingApiKey ? { Authorization: `Bearer ${embeddingApiKey}` } : {}),
    },
    body: JSON.stringify({
      encoding_format: embeddingEncodingFormat,
      model: embeddingModel,
      input: list,
    }),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Embedding 请求失败: ${response.status} ${detail}`)
  }

  const data = await response.json()
  const vectors = Array.isArray(data?.data)
    ? data.data.map((item) => (Array.isArray(item?.embedding) ? item.embedding : null))
    : []
  if (vectors.length !== list.length) {
    throw new Error('Embedding 返回数量异常')
  }

  return vectors
}

// 对切块文本按批次生成 embedding 与范数元数据。
async function buildChunkEmbeddings(chunks = []) {
  if (!isEmbeddingEnabled()) {
    return chunks.map(() => ({
      embedding: null,
      embeddingNorm: 0,
      embeddingStatus: 'none',
    }))
  }

  const results = chunks.map(() => ({
    embedding: null,
    embeddingNorm: 0,
    embeddingStatus: 'failed',
  }))

  const embeddingBatchSize = getEmbeddingBatchSize()

  for (let start = 0; start < chunks.length; start += embeddingBatchSize) {
    const slice = chunks.slice(start, start + embeddingBatchSize)
    const vectors = await requestEmbeddings(slice)
    for (let i = 0; i < vectors.length; i += 1) {
      const embedding = vectors[i]
      const norm = safeVectorNorm(embedding || [])
      results[start + i] = {
        embedding: Array.isArray(embedding) ? embedding : null,
        embeddingNorm: norm,
        embeddingStatus: Array.isArray(embedding) && norm > 0 ? 'ready' : 'failed',
      }
    }
  }

  return results
}

// 通过 Mongo 向量检索召回候选 chunk。
async function retrieveVectorCandidates({ chunksCollection, username, kbId, queryVector }) {
  if (!getVectorSearchEnabled()) return []
  if (!Array.isArray(queryVector) || queryVector.length === 0) return []

  const vectorSearchIndexName = getVectorSearchIndexName()
  const vectorSearchLimit = getVectorSearchLimit()
  const vectorSearchNumCandidates = getVectorSearchNumCandidates()

  // 仅在支持 $vectorSearch 的 Mongo 环境（如 Atlas）启用；本地环境失败会自动回退。
  const pipeline = [
    {
      $vectorSearch: {
        index: vectorSearchIndexName,
        path: 'embedding',
        queryVector,
        numCandidates: vectorSearchNumCandidates,
        limit: vectorSearchLimit,
        filter: {
          username,
          kbId,
        },
      },
    },
    {
      $project: {
        _id: 0,
        chunkId: 1,
        chunkIndex: 1,
        docId: 1,
        docName: 1,
        sourceUrl: 1,
        preview: 1,
        content: 1,
        keywords: 1,
        embedding: 1,
        embeddingNorm: 1,
        embeddingStatus: 1,
        score: { $meta: 'vectorSearchScore' },
      },
    },
  ]

  return chunksCollection.aggregate(pipeline).toArray()
}

// 生成稳定 docId/chunkId 所需的 SHA1 哈希。
function sha1(text = '') {
  return crypto.createHash('sha1').update(String(text)).digest('hex')
}

async function sha1File(filePath = '') {
  const safePath = String(filePath || '').trim()
  if (!safePath) return ''
  const buffer = await fs.promises.readFile(safePath)
  return crypto.createHash('sha1').update(buffer).digest('hex')
}

function buildStableDocId({ username = '', kbId = DEFAULT_KB_ID, fileSha1 = '', storedFileName = '' }) {
  const safeUsername = String(username || '').trim()
  const safeKbId = String(kbId || DEFAULT_KB_ID).trim() || DEFAULT_KB_ID
  const safeFileSha1 = String(fileSha1 || '').trim()
  const safeStoredFileName = String(storedFileName || '').trim()
  return sha1(`${safeUsername}:${safeKbId}:${safeFileSha1 || safeStoredFileName}`)
}

// 文本归一化：清理空字节、换行与多余空白，便于后续切块与检索。
function normalizeText(text = '') {
  // Some extracted files contain embedded NULL bytes; normalize them safely.
  const withoutNullByte = String(text || '').split('\0').join(' ')

  return withoutNullByte
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \f\v]+/g, ' ')
    .trim()
}

// 尝试多编码解码并按质量评分选择最佳结果。
function decodeBestEffort(buffer) {
  const candidates = []
  try {
    candidates.push({ codec: 'utf8', text: buffer.toString('utf8') })
  } catch {
    // ignore decoding failure for this encoding
  }
  try {
    candidates.push({ codec: 'gb18030', text: iconv.decode(buffer, 'gb18030') })
  } catch {
    // ignore decoding failure for this encoding
  }
  try {
    candidates.push({ codec: 'latin1', text: iconv.decode(buffer, 'latin1') })
  } catch {
    // ignore decoding failure for this encoding
  }

  if (candidates.length === 0) return ''

  return candidates
    .sort((a, b) => {
      const aScore = getTextQualityScore(a.text) + (a.codec === 'utf8' ? 8 : 0)
      const bScore = getTextQualityScore(b.text) + (b.codec === 'utf8' ? 8 : 0)
      return bScore - aScore
    })
    .map((item) => item.text)[0]
}
// 使用内置分词器（若运行时支持）提升中文词边界识别。
const zhWordSegmenter =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter('zh-Hans', { granularity: 'word' })
    : null

// 中文分词兜底：当内置分词不可用时，退回到双字切分。
function tokenizeChineseFallback(normalizedText = '') {
  const terms = []
  const cjkBlocks = String(normalizedText || '').match(/[\u4e00-\u9fff]{2,}/g) || []
  for (const block of cjkBlocks) {
    if (block.length <= 2) {
      terms.push(block)
      continue
    }
    for (let i = 0; i < block.length - 1; i += 1) {
      terms.push(block.slice(i, i + 2))
    }
  }
  return terms
}

// 生成“原始词流”（保留重复），用于后续频次统计。
function collectTokenStream(text = '') {
  const normalized = String(text || '').toLowerCase()
  const terms = []

  // 英文词支持连字符，如 ai-agent、real-time；纯连字符或过短词会被过滤。
  const englishMatches = normalized.match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) || []
  for (const word of englishMatches) {
    const compact = word.replace(/-/g, '')
    if (compact.length >= 2) {
      terms.push(word)
    }
  }

  if (zhWordSegmenter) {
    for (const piece of zhWordSegmenter.segment(normalized)) {
      const segment = String(piece?.segment || '').trim()
      const hasCjk = /[\u4e00-\u9fff]/.test(segment)
      if (!hasCjk) continue
      if (piece?.isWordLike === false) continue
      if (segment.length >= 2) {
        terms.push(segment)
      }
    }
  } else {
    terms.push(...tokenizeChineseFallback(normalized))
  }

  return terms
}

// 分词函数：返回去重词项，便于后续快速匹配。
function tokenize(text = '') {
  return [...new Set(collectTokenStream(text))]
}
// 构建关键词集合：按频次截断，作为轻量检索特征。
function buildKeywordSet(text = '') {
  const dedupedTerms = tokenize(text)
  if (dedupedTerms.length === 0) return []

  const terms = collectTokenStream(text)
  const freq = new Map()
  for (const term of terms) {
    freq.set(term, (freq.get(term) || 0) + 1)
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 200)
    .map(([term]) => term)
}

// 判断文本是否包含常见乱码信号。
function hasMojibakeSignals(text = '') {
  const value = String(text || '')
  if (!value) return false

  const length = Math.max(1, value.length)
  const replacement = (value.match(/�/g) || []).length
  const latinNoise = (value.match(/[ÃÂÅÆÇÐÑØÞßà-ÿ]/g) || []).length
  const cjk = (value.match(/[\u4e00-\u9fff]/g) || []).length
  const ascii = (value.match(/[a-zA-Z0-9]/g) || []).length
  const garbledRatio = (replacement + latinNoise) / length

  if (garbledRatio >= 0.08) return true
  if (replacement > 0 && replacement / length >= 0.01) return true
  if (latinNoise >= 10 && latinNoise > (cjk + ascii) * 0.2) return true
  return false
}

// 清理不可见控制字符，降低渲染和索引噪声。
function stripControlChars(text = '') {
  let output = ''
  const value = String(text || '')
  for (const ch of value) {
    const code = ch.charCodeAt(0)
    if ((code >= 0 && code <= 8) || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127) {
      output += ' '
    } else {
      output += ch
    }
  }
  return output
}

// 评估文本可读性质量分数，分值越高表示越可信。
function getTextQualityScore(text = '') {
  const value = String(text || '')
  if (!value) return -Infinity
  const cjk = (value.match(/[\u4e00-\u9fff]/g) || []).length
  const ascii = (value.match(/[a-zA-Z0-9]/g) || []).length
  const replacement = (value.match(/�/g) || []).length
  const latinNoise = (value.match(/[ÃÂÅÆÇÐÑØÞßà-ÿ]/g) || []).length
  let control = 0
  for (const ch of value) {
    const code = ch.charCodeAt(0)
    if ((code >= 0 && code <= 8) || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127) {
      control += 1
    }
  }
  return cjk * 4 + ascii * 0.6 - replacement * 8 - latinNoise * 2 - control * 6
}
// 文本修复：仅在疑似乱码时尝试转码纠偏，减少误修风险。
function repairExtractedText(text = '') {
  const normalized = normalizeText(text)
  if (!normalized) return ''

  // 仅在疑似乱码时做转码修复，避免把原本正确的 UTF-8 文本“修坏”。
  if (!hasMojibakeSignals(normalized)) return normalized

  const candidates = [normalized]
  try {
    candidates.push(Buffer.from(normalized, 'latin1').toString('utf8'))
  } catch {
    // 忽略转换失败
  }
  try {
    candidates.push(iconv.decode(Buffer.from(normalized, 'latin1'), 'gb18030'))
  } catch {
    // 忽略转换失败
  }

  const deduped = [...new Set(candidates.map((item) => normalizeText(item)).filter(Boolean))]
  if (deduped.length === 0) return normalized

  return deduped.sort((a, b) => getTextQualityScore(b) - getTextQualityScore(a))[0]
}
// 乱码门禁：文本质量过低时拒绝入索引，防止污染检索结果。
function isLikelyGarbledText(text = '') {
  const value = String(text || '')
  if (!value) return false

  if (!hasMojibakeSignals(value)) return false

  const length = Math.max(1, value.length)
  const replacement = (value.match(/�/g) || []).length
  const latinNoise = (value.match(/[ÃÂÅÆÇÐÑØÞßà-ÿ]/g) || []).length
  const cjk = (value.match(/[\u4e00-\u9fff]/g) || []).length
  const ascii = (value.match(/[a-zA-Z0-9]/g) || []).length

  const garbledRatio = (replacement + latinNoise) / length
  const readableSignal = cjk + ascii

  if (getTextQualityScore(value) < -2) return true
  if (garbledRatio >= 0.18) return true
  if (latinNoise >= 24 && latinNoise > readableSignal * 0.6) return true
  return false
}

// 标准化引用片段文本并按长度截断。
function normalizeSnippetText(text = '', maxLength = 260) {
  const raw = normalizeText(text)
  if (!raw) return ''

  let repaired = raw
  if (hasMojibakeSignals(raw)) {
    try {
      repaired = Buffer.from(raw, 'latin1').toString('utf8')
    } catch {
      repaired = raw
    }
  }
  const better = getTextQualityScore(repaired) > getTextQualityScore(raw) ? repaired : raw

  const cleaned = better
    .split('\n')
    .map((line) => stripControlChars(line))
    .join('\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()

  return cleaned.slice(0, Math.max(1, Number(maxLength || 260)))
}

// 构建对外可展示的引用片段，并在低质量时给出兜底提示。
function buildSafeCitationSnippet({ snippet = '', docName = '' }) {
  const normalized = normalizeSnippetText(snippet, 260)
  if (!normalized) {
    return `文档《${String(docName || '未命名文档')}》暂无可展示片段，请重建索引后重试。`
  }

  // 质量阈值兜底：避免把不可读乱码直接展示给用户。
  if (getTextQualityScore(normalized) < 2) {
    return `文档《${String(docName || '未命名文档')}》片段编码异常，建议在知识库执行“重建索引”（优先使用 TXT/MD 原文）。`
  }

  return normalized
}

// 计算查询词在内容中的覆盖率。
function lexicalCoverage(normalizedContent = '', queryTerms = []) {
  if (!normalizedContent) return 0
  const terms = [...new Set(Array.isArray(queryTerms) ? queryTerms : [])].filter(Boolean).slice(0, 48)
  if (terms.length === 0) return 0

  let hit = 0
  for (const term of terms) {
    if (normalizedContent.includes(term)) hit += 1
  }
  return hit / terms.length
}

// 判断来源是否为 Word 文档，用于预览路由选择。
function isWordDocumentFile(nameOrUrl = '') {
  const lower = String(nameOrUrl || '').toLowerCase()
  return lower.endsWith('.doc') || lower.endsWith('.docx')
}

// 估算检索证据置信度，供路由策略决定是否注入 RAG 上下文。
function estimateRagConfidence({ chunk, query = '', queryTerms = [], mode = 'hybrid' }) {
  const normalizedContent = String(chunk?.content || '').toLowerCase()
  const keywordSet = new Set(Array.isArray(chunk?.keywords) ? chunk.keywords : [])
  const safeQuery = String(query || '').toLowerCase()

  let overlapCount = 0
  for (const term of queryTerms) {
    if (keywordSet.has(term)) overlapCount += 1
  }

  const overlapScore = queryTerms.length > 0 ? overlapCount / queryTerms.length : 0
  const lexicalScore = lexicalCoverage(normalizedContent, queryTerms)
  const phraseScore = safeQuery && normalizedContent.includes(safeQuery) ? 1 : 0
  const semanticScore = clamp01(chunk?._semanticScore)
  const textScore = clamp01(Number(chunk?.score || 0) / 8)

  if (mode === 'text') {
    return clamp01(overlapScore * 0.4 + lexicalScore * 0.35 + phraseScore * 0.1 + textScore * 0.15)
  }

  if (mode === 'semantic') {
    return clamp01(semanticScore * 0.7 + overlapScore * 0.1 + lexicalScore * 0.1 + phraseScore * 0.1)
  }

  return clamp01(overlapScore * 0.15 + lexicalScore * 0.15 + semanticScore * 0.5 + phraseScore * 0.1 + textScore * 0.1)
}

function shouldForceDirectAnswer(query = '') {
  const text = String(query || '').trim()
  if (!text) return false

  // 用户在“改话题/停止某主题”时，不应继续强制检索旧知识库内容。
  const topicSwitchPattern = /(不要再|别再|不再|不用|不需要|停止|别说|不要说|换个话题|换话题|不谈|别聊)/
  if (!topicSwitchPattern.test(text)) return false

  // 若同时包含明确提问意图，则仍允许进入检索链路。
  const explicitQuestionPattern = /(什么|如何|怎么|为什么|是否|多少|几|哪|请解释|介绍|原理|步骤|\?|？)/
  return !explicitQuestionPattern.test(text)
}

function isShortAmbiguousQuery(query = '', queryTerms = []) {
  const text = String(query || '').trim()
  if (!text) return true

  const compact = text.replace(/\s+/g, '')
  const safeTerms = Array.isArray(queryTerms) ? queryTerms.filter(Boolean) : []
  const hardMaxLen = getRagRouteShortQueryHardMaxLen()
  const softMaxLen = getRagRouteShortQuerySoftMaxLen()
  const maxTerms = getRagRouteShortQueryMaxTerms()

  // 极短输入（如“无人”“电机”）语义不完整，检索容易被误召回放大。
  if (compact.length <= hardMaxLen) return true

  // 具备明确提问/任务意图时，允许继续检索链路。
  const explicitIntentPattern = /(什么|如何|怎么|为什么|是否|区别|对比|介绍|解释|原理|步骤|总结|概述|给我|请|帮我|\?|？)/
  if (explicitIntentPattern.test(compact)) return false

  return compact.length <= softMaxLen && safeTerms.length <= maxTerms
}
// 切块函数：按语义断点优先切分，并保留 overlap 提升上下文连续性。
function splitIntoChunks(text = '', chunkSize = 520, overlap = 90) {
  const cleaned = normalizeText(text)
  if (!cleaned) return []

  const chunks = []
  let start = 0

  while (start < cleaned.length) {
    const targetEnd = Math.min(cleaned.length, start + chunkSize)
    let end = targetEnd

    if (targetEnd < cleaned.length) {
      const window = cleaned.slice(start, targetEnd)
      const breakIndex = Math.max(
        window.lastIndexOf('\n\n'),
        window.lastIndexOf('\n'),
        window.lastIndexOf('。'),
        window.lastIndexOf('！'),
        window.lastIndexOf('？'),
        window.lastIndexOf('. '),
      )
      if (breakIndex > 120) {
        end = start + breakIndex + 1
      }
    }

    const segment = cleaned.slice(start, end).trim()
    if (segment) chunks.push(segment)

    if (end >= cleaned.length) break
    start = Math.max(start + 1, end - overlap)
  }

  return chunks
}

// 去除 UTF-8 BOM，避免文本前缀污染。
function stripUtf8Bom(text = '') {
  const value = String(text || '')
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value
}

// 严格按 UTF-8 解码，非法字节直接失败并返回空字符串。
function decodeTextBufferAsUtf8(buffer) {
  try {
    // fatal=true: 仅当字节序列是合法 UTF-8 才返回，避免误把其它编码当 UTF-8。
    const decoder = new TextDecoder('utf-8', { fatal: true })
    return stripUtf8Bom(decoder.decode(buffer))
  } catch {
    return ''
  }
}

// 归一化探测到的编码名称，兼容别名场景。
function normalizeDetectedEncoding(encoding = '') {
  const safe = String(encoding || '').trim().toLowerCase()
  if (!safe) return ''
  if (safe === 'ascii') return 'utf-8'
  if (safe === 'gb2312' || safe === 'gbk') return 'gb18030'
  return safe
}
// TXT 编码解析：结合探测结果按编码解码文本。
function decodeTextBufferByDetectedEncoding(buffer) {
  const detected = jschardet.detect(buffer)
  const normalizedEncoding = normalizeDetectedEncoding(detected?.encoding)
  const confidence = Number(detected?.confidence || 0)
  if (!normalizedEncoding || confidence < 0.25) return ''
  if (!iconv.encodingExists(normalizedEncoding)) return ''

  try {
    return normalizeText(stripUtf8Bom(iconv.decode(buffer, normalizedEncoding)))
  } catch {
    return ''
  }
}
// 文件解析：按文件类型走对应解析器，统一返回可用纯文本。
async function extractTextByFileType({ filePath, mimeType = '', ext = '' }) {
  const safeExt = String(ext || '').toLowerCase()
  const safeMime = String(mimeType || '').toLowerCase()

  if (safeExt === '.pdf' || safeMime === 'application/pdf') {
    const buffer = await fs.promises.readFile(filePath)
    // pdf-parse v2 exposes class API; always destroy parser to release resources.
    const parser = new PDFParse({ data: buffer })
    try {
      const parsed = await parser.getText()
      return normalizeText(parsed?.text || '')
    } finally {
      await parser.destroy().catch(() => null)
    }
  }

  if (safeExt === '.docx' || safeMime === DOCX_MIME) {
    // DOCX 走结构化解析，避免按纯文本读取导致乱码。
    const parsed = await mammoth.extractRawText({ path: filePath })
    return normalizeText(parsed?.value || '')
  }

  if (safeExt === '.doc' || safeMime === DOC_MIME) {
    // DOC 使用二进制文档解析器读取正文。
    const parsed = await wordExtractor.extract(filePath)
    return normalizeText(parsed?.getBody?.() || '')
  }

  const buffer = await fs.promises.readFile(filePath)
  const strictUtf8 = normalizeText(decodeTextBufferAsUtf8(buffer))
  const detectedText = decodeTextBufferByDetectedEncoding(buffer)

  // TXT/MD 优先按 UTF-8 读取；仅在 UTF-8 非法时才回退到自动探测。
  if (safeExt === '.txt' || safeExt === '.md' || safeMime === 'text/plain' || safeMime === 'text/markdown') {
    if (strictUtf8 && !hasMojibakeSignals(strictUtf8)) return strictUtf8
    if (detectedText) return detectedText
    if (strictUtf8) return strictUtf8
    return normalizeText(decodeBestEffort(buffer))
  }

  if (strictUtf8 && !hasMojibakeSignals(strictUtf8)) {
    return strictUtf8
  }
  return normalizeText(decodeBestEffort(buffer))
}

export function createRagService({ db, uploadsDir }) {
  // 创建 RAG 服务实例：绑定集合、队列与各业务能力函数。
  const docsCollection = db.collection('kb_docs')
  const chunksCollection = db.collection('kb_chunks')
  const runningIngestJobKeys = new Set()
  const queuedIngestJobKeys = new Set()
  const pendingIngestJobs = []

  async function findExistingDocByFileSha1({ username, kbId = DEFAULT_KB_ID, fileSha1 }) {
    const safeUsername = String(username || '').trim()
    const safeKbId = String(kbId || DEFAULT_KB_ID).trim() || DEFAULT_KB_ID
    const safeFileSha1 = String(fileSha1 || '').trim()
    if (!safeUsername || !safeFileSha1) return null

    const activeStatuses = ['queued', 'parsing', 'indexed']
    const projection = {
      _id: 0,
      docId: 1,
      kbId: 1,
      parseStatus: 1,
      parseError: 1,
      chunkCount: 1,
      storedFileName: 1,
      updatedAt: 1,
    }

    const exact = await docsCollection.findOne(
      {
        username: safeUsername,
        kbId: safeKbId,
        fileSha1: safeFileSha1,
        parseStatus: { $in: activeStatuses },
      },
      {
        projection,
        sort: { updatedAt: -1 },
      },
    )
    if (exact?.docId) return exact

    // 兼容历史老数据：部分文档在去重功能上线前没有 fileSha1，按文件内容回填后再判重。
    const legacyCandidates = await docsCollection
      .find(
        {
          username: safeUsername,
          kbId: safeKbId,
          parseStatus: { $in: activeStatuses },
          $or: [
            { fileSha1: { $exists: false } },
            { fileSha1: null },
            { fileSha1: '' },
          ],
        },
        { projection },
      )
      .sort({ updatedAt: -1 })
      .limit(120)
      .toArray()

    for (const item of legacyCandidates) {
      const storedFileName = String(item?.storedFileName || '')
      if (!storedFileName || !uploadsDir) continue
      const candidatePath = path.resolve(uploadsDir, storedFileName)
      if (!candidatePath.startsWith(uploadsDir) || !fs.existsSync(candidatePath)) continue

      let candidateSha1 = ''
      try {
        candidateSha1 = await sha1File(candidatePath)
      } catch {
        candidateSha1 = ''
      }
      if (!candidateSha1) continue

      await docsCollection.updateOne(
        { username: safeUsername, docId: String(item.docId || '') },
        { $set: { fileSha1: candidateSha1 } },
      )

      if (candidateSha1 === safeFileSha1) {
        return {
          ...item,
          fileSha1: candidateSha1,
        }
      }
    }

    return null
  }

  async function collapseDuplicateDocsByFileSha1({
    username,
    kbId = DEFAULT_KB_ID,
    fileSha1,
    keepDocId,
    keepStoredFileName = '',
  }) {
    const safeUsername = String(username || '').trim()
    const safeKbId = String(kbId || DEFAULT_KB_ID).trim() || DEFAULT_KB_ID
    const safeFileSha1 = String(fileSha1 || '').trim()
    const safeKeepDocId = String(keepDocId || '').trim()
    if (!safeUsername || !safeFileSha1 || !safeKeepDocId) return

    const duplicates = await docsCollection
      .find(
        {
          username: safeUsername,
          kbId: safeKbId,
          fileSha1: safeFileSha1,
          docId: { $ne: safeKeepDocId },
        },
        { projection: { _id: 0, docId: 1, storedFileName: 1 } },
      )
      .toArray()

    const duplicateDocIds = duplicates.map((item) => String(item?.docId || '')).filter(Boolean)
    if (duplicateDocIds.length === 0) return

    await docsCollection.deleteMany({
      username: safeUsername,
      kbId: safeKbId,
      docId: { $in: duplicateDocIds },
    })
    await chunksCollection.deleteMany({
      username: safeUsername,
      kbId: safeKbId,
      docId: { $in: duplicateDocIds },
    })

    // 清理重复记录关联的冗余文件，保留当前主记录对应文件。
    if (uploadsDir) {
      const safeKeepStoredFileName = String(keepStoredFileName || '').trim()
      for (const item of duplicates) {
        const stored = String(item?.storedFileName || '').trim()
        if (!stored || stored === safeKeepStoredFileName) continue
        const filePath = path.resolve(uploadsDir, stored)
        if (!filePath.startsWith(uploadsDir) || !fs.existsSync(filePath)) continue
        await fs.promises.unlink(filePath).catch(() => null)
      }
    }
  }

  // 消费入库队列并控制并发，避免高并发解析拖垮服务。
  function runNextIngestJobs() {
    while (runningIngestJobKeys.size < getMaxIngestConcurrency() && pendingIngestJobs.length > 0) {
      const job = pendingIngestJobs.shift()
      if (!job) break

      queuedIngestJobKeys.delete(job.jobKey)
      runningIngestJobKeys.add(job.jobKey)

      Promise.resolve()
        .then(job.run)
        .finally(() => {
          runningIngestJobKeys.delete(job.jobKey)
          runNextIngestJobs()
        })
    }
  }

  // 统一写入文档元信息，便于前端展示解析状态与错误信息。
  async function upsertDocMeta({
    username,
    kbId = DEFAULT_KB_ID,
    docId,
    name,
    storedFileName,
    fileSha1 = '',
    mimeType,
    ext,
    size,
    url,
    parseStatus,
    parseError = '',
    chunkCount,
    charCount,
  }) {
    const now = Date.now()
    await docsCollection.updateOne(
      { username, docId },
      {
        $set: {
          username,
          kbId,
          docId,
          name,
          storedFileName,
          fileSha1: String(fileSha1 || ''),
          mimeType,
          ext,
          size,
          url,
          parseStatus,
          parseError,
          chunkCount,
          charCount,
          updatedAt: now,
        },
        $setOnInsert: {
          createdAt: now,
        },
      },
      { upsert: true },
    )
  }
  // 索引初始化：文档检索、文本检索与向量检索所需索引。
  async function ensureIndexes() {
    await docsCollection.createIndex({ username: 1, kbId: 1, updatedAt: -1 })
    await docsCollection.createIndex({ username: 1, docId: 1 }, { unique: true })
    await docsCollection.createIndex({ username: 1, kbId: 1, fileSha1: 1 })
    await chunksCollection.createIndex({ username: 1, kbId: 1, updatedAt: -1 })
    await chunksCollection.createIndex({ username: 1, kbId: 1, keywords: 1, updatedAt: -1 })
    await chunksCollection.createIndex({ username: 1, kbId: 1, embeddingStatus: 1, updatedAt: -1 })
    await chunksCollection.createIndex({ username: 1, docId: 1, chunkIndex: 1 }, { unique: true })
    await chunksCollection.createIndex({ content: 'text', docName: 'text' }, { default_language: 'none' })
  }
  // 解析入库主流程：抽取文本 -> 修复/门禁 -> 切块 -> 向量化 -> 落库。
  async function ingestUploadedFile({
    username,
    filePath,
    storedFileName,
    originalName,
    docId: upstreamDocId = '',
    fileSha1 = '',
    mimeType,
    size,
    url,
    kbId = DEFAULT_KB_ID,
  }) {
    const safeUsername = String(username || '').trim()
    if (!safeUsername) {
      throw new Error('缺少用户名，无法入库知识文档')
    }

    const safeFileSha1 = String(fileSha1 || '').trim()
    const docId = String(upstreamDocId || buildStableDocId({
      username: safeUsername,
      kbId,
      fileSha1: safeFileSha1,
      storedFileName,
    }))
    const ext = path.extname(String(originalName || storedFileName || '')).toLowerCase()
    const docName = String(originalName || storedFileName || '未命名文档')
    const safeMimeType = String(mimeType || '')
    const safeUrl = String(url || '')
    const safeSize = Number(size || 0)

    // 进入解析阶段，前端可据此显示“解析中”。
    await upsertDocMeta({
      username: safeUsername,
      kbId,
      docId,
      name: docName,
      storedFileName: String(storedFileName || ''),
      fileSha1: safeFileSha1,
      mimeType: safeMimeType,
      ext,
      size: safeSize,
      url: safeUrl,
      parseStatus: 'parsing',
      parseError: '',
      chunkCount: 0,
      charCount: 0,
    })

    let text = ''
    let parseStatus = 'indexed'
    let parseError = ''
    try {
      text = await extractTextByFileType({ filePath, mimeType, ext })
      text = repairExtractedText(text)
      // 入库前的质量门禁：疑似乱码时不写入 chunk，避免污染检索库。
      if (text && isLikelyGarbledText(text)) {
        parseStatus = 'failed'
        parseError = '文档文本疑似乱码，建议转为 UTF-8 的 TXT/MD 后重新上传或重建索引'
        text = ''
      }
      if (!text && parseStatus !== 'failed') {
        parseStatus = 'indexed'
      }
    } catch {
      parseStatus = 'failed'
      parseError = '文档解析失败，请检查文件内容或格式'
      text = ''
    }

    const now = Date.now()
    const chunks = splitIntoChunks(text)
    let embeddingError = ''
    let embeddingMetaList = chunks.map(() => ({
      embedding: null,
      embeddingNorm: 0,
      embeddingStatus: 'none',
    }))

    if (chunks.length > 0) {
      try {
        embeddingMetaList = await buildChunkEmbeddings(chunks)
      } catch (error) {
        // 向量化失败不阻断入库，回退到关键词检索链路。
        embeddingError = error?.message || '向量化失败'
      }
    }

    await upsertDocMeta({
      username: safeUsername,
      kbId,
      docId,
      name: docName,
      storedFileName: String(storedFileName || ''),
      fileSha1: safeFileSha1,
      mimeType: safeMimeType,
      ext,
      size: safeSize,
      url: safeUrl,
      parseStatus,
      parseError: [parseError, embeddingError].filter(Boolean).join('；'),
      chunkCount: chunks.length,
      charCount: text.length,
    })

    await chunksCollection.deleteMany({ username: safeUsername, docId })
  // chunk 写入数据库：作为后续检索的最小语义单元。
    if (chunks.length > 0) {
      await chunksCollection.insertMany(
        chunks.map((content, index) => {
          const embeddingMeta = embeddingMetaList[index] || {
            embedding: null,
            embeddingNorm: 0,
            embeddingStatus: 'none',
          }

          return {
            username: safeUsername,
            kbId,
            docId,
            chunkId: `${docId}_${index}`,
            chunkIndex: index,
            docName: String(originalName || storedFileName || '未命名文档'),
            storedFileName: String(storedFileName || ''),
            sourceUrl: String(url || ''),
            content,
            preview: normalizeSnippetText(content, 260),
            keywords: buildKeywordSet(content),
            embedding: embeddingMeta.embedding,
            embeddingNorm: Number(embeddingMeta.embeddingNorm || 0),
            embeddingStatus: embeddingMeta.embeddingStatus || 'none',
            updatedAt: now,
            createdAt: now,
          }
        }),
        { ordered: false },
      )
    }

    return {
      docId,
      kbId,
      parseStatus,
      parseError,
      chunkCount: chunks.length,
      indexed: chunks.length > 0,
      textSnippet: text.slice(0, 1200),
      textSnippetTruncated: text.length > 1200,
    }
  }
  // 入队函数：快速返回 queued 状态，后台异步执行重解析。
  async function enqueueIngestUploadedFile({
    username,
    filePath,
    storedFileName,
    originalName,
    docId: upstreamDocId = '',
    fileSha1,
    mimeType,
    size,
    url,
    kbId = DEFAULT_KB_ID,
    bypassDedup = false,
  }) {
    const safeUsername = String(username || '').trim()
    if (!safeUsername) {
      throw new Error('缺少用户名，无法入库知识文档')
    }

    const safeFileSha1 = String(fileSha1 || '').trim() || await sha1File(filePath)
    const docId = String(upstreamDocId || buildStableDocId({
      username: safeUsername,
      kbId,
      fileSha1: safeFileSha1,
      storedFileName,
    }))
    const ext = path.extname(String(originalName || storedFileName || '')).toLowerCase()

    // 重建索引场景可显式跳过去重短路，确保重新切块与关键词重算。
    if (safeFileSha1 && !bypassDedup) {
      const existed = await findExistingDocByFileSha1({
        username: safeUsername,
        kbId,
        fileSha1: safeFileSha1,
      })

      if (existed?.docId) {
        await collapseDuplicateDocsByFileSha1({
          username: safeUsername,
          kbId,
          fileSha1: safeFileSha1,
          keepDocId: String(existed.docId || ''),
          keepStoredFileName: String(existed.storedFileName || ''),
        })

        // 命中重复文档时，清理本次上传副本，避免磁盘和向量重复占用。
        const duplicatedPath = path.resolve(uploadsDir, String(storedFileName || ''))
        const existedPath = path.resolve(uploadsDir, String(existed.storedFileName || ''))
        if (duplicatedPath !== existedPath && duplicatedPath.startsWith(uploadsDir) && fs.existsSync(duplicatedPath)) {
          fs.unlink(duplicatedPath, () => null)
        }

        return {
          docId: String(existed.docId),
          kbId: String(existed.kbId || kbId),
          parseStatus: String(existed.parseStatus || 'indexed'),
          parseError: String(existed.parseError || ''),
          chunkCount: Number(existed.chunkCount || 0),
          indexed: String(existed.parseStatus || '') === 'indexed',
          textSnippet: '',
          textSnippetTruncated: false,
          deduplicated: true,
        }
      }
    }

    // 先写入 queued，接口可立即返回，解析在后台继续。
    await upsertDocMeta({
      username: safeUsername,
      kbId,
      docId,
      name: String(originalName || storedFileName || '未命名文档'),
      storedFileName: String(storedFileName || ''),
      fileSha1: safeFileSha1,
      mimeType: String(mimeType || ''),
      ext,
      size: Number(size || 0),
      url: String(url || ''),
      parseStatus: 'queued',
      parseError: '',
      chunkCount: 0,
      charCount: 0,
    })

    const jobKey = safeFileSha1
      ? `${safeUsername}:${String(kbId || DEFAULT_KB_ID)}:sha1:${safeFileSha1}`
      : `${safeUsername}:${docId}`
    if (!runningIngestJobKeys.has(jobKey) && !queuedIngestJobKeys.has(jobKey)) {
      if (pendingIngestJobs.length >= getMaxIngestQueueSize()) {
        throw new Error('知识库解析队列繁忙，请稍后再试')
      }

      queuedIngestJobKeys.add(jobKey)
      pendingIngestJobs.push({
        jobKey,
        run: async () => {
          try {
            await ingestUploadedFile({
              username: safeUsername,
              filePath,
              storedFileName,
              originalName,
              docId,
              fileSha1: safeFileSha1,
              mimeType,
              size,
              url,
              kbId,
            })
          } catch (error) {
            await upsertDocMeta({
              username: safeUsername,
              kbId,
              docId,
              name: String(originalName || storedFileName || '未命名文档'),
              storedFileName: String(storedFileName || ''),
              fileSha1: safeFileSha1,
              mimeType: String(mimeType || ''),
              ext,
              size: Number(size || 0),
              url: String(url || ''),
              parseStatus: 'failed',
              parseError: error?.message || '后台解析失败',
              chunkCount: 0,
              charCount: 0,
            })
          }
        },
      })
      // 触发队列消费：控制并发并避免短时间创建过多解析任务。
      runNextIngestJobs()
    }

    return {
      docId,
      kbId,
      parseStatus: 'queued',
      parseError: '',
      chunkCount: 0,
      indexed: false,
      textSnippet: '',
      textSnippetTruncated: false,
    }
  }

  // 综合评分：融合文本命中、语义相似度、短语命中与置顶文档加权。
  function scoreChunk({ chunk, query, queryTerms, textScore = 0, pinnedDocIds = new Set() }) {
    const normalizedContent = String(chunk?.content || '').toLowerCase()
    const keywordSet = new Set(Array.isArray(chunk?.keywords) ? chunk.keywords : [])

    let overlapCount = 0
    for (const term of queryTerms) {
      if (keywordSet.has(term)) overlapCount += 1
    }

    const overlapScore = queryTerms.length > 0 ? overlapCount / queryTerms.length : 0
    const lexicalScore = lexicalCoverage(normalizedContent, queryTerms)
    const phraseScore = normalizedContent.includes(String(query || '').toLowerCase()) ? 1 : 0
    const semanticScore = Math.max(0, Number(chunk?._semanticScore || 0))
    const pinnedBoost = pinnedDocIds.has(String(chunk?.docId || '')) ? 0.2 : 0

    return textScore * 0.28 + overlapScore * 0.14 + lexicalScore * 0.28 + phraseScore * 0.1 + semanticScore * 0.2 + pinnedBoost
  }
  // 检索主流程：多策略召回 + 综合排序，确保在不同环境下都能有较好表现。
  async function retrieveContext({
    username,
    query,
    pinnedDocIds = [],
    kbId = DEFAULT_KB_ID,
    retrievalMode = 'hybrid',
    topK,
    limit,
  }) {
      // 优先使用请求级 Top K；未传时回退环境变量配置。
      const rawTopK = topK ?? limit
      const contextTopK = Math.min(20, Math.max(1, Number(rawTopK || getRagContextTopK())))

    const safeUsername = String(username || '').trim()
    const safeQuery = normalizeText(query)
    const mode = ['text', 'semantic', 'hybrid', 'direct'].includes(String(retrievalMode || '').toLowerCase())
      ? String(retrievalMode || '').toLowerCase()
      : 'hybrid'

    // 直答模式：跳过检索链路，避免常识问答触发无效 RAG 召回。
    if (mode === 'direct') {
      return {
        refs: [],
        contextDocs: [],
        promptContext: '',
        retrievalModeUsed: 'none',
      }
    }

    if (!safeUsername || !safeQuery) {
      return {
        refs: [],
        contextDocs: [],
        promptContext: '',
        retrievalModeUsed: 'none',
      }
    }

    if (shouldForceDirectAnswer(safeQuery)) {
      return {
        refs: [],
        contextDocs: [],
        promptContext: '',
        retrievalModeUsed: 'none',
      }
    }
  // 构建查询词集合，供后续多策略评分使用。
    const queryTerms = buildKeywordSet(safeQuery)
    const shortAmbiguousQuery = isShortAmbiguousQuery(safeQuery, queryTerms)
    const pinnedSet = new Set((Array.isArray(pinnedDocIds) ? pinnedDocIds : []).map((item) => String(item)))
    // 模式选择：文本、语义、混合。
    const useTextRetrieval = mode === 'text' || mode === 'hybrid'
    const useSemanticRetrieval = mode === 'semantic' || mode === 'hybrid'
    let textSignalHit = false
    let semanticSignalHit = false
    let queryVector = []
    let queryVectorNorm = 0

    if (useSemanticRetrieval && isEmbeddingEnabled()) {
      try {
        const vectors = await requestEmbeddings([safeQuery])
        queryVector = Array.isArray(vectors?.[0]) ? vectors[0] : []
        queryVectorNorm = safeVectorNorm(queryVector)
      } catch (error) {
        // 查询向量化失败时记录原因，便于排查 key/model/endpoint 配置问题。
        const reason = String(error?.message || 'unknown error')
        console.warn(`[RAG] query embedding failed, fallback to non-vector path: ${reason}`)
        queryVector = []
        queryVectorNorm = 0
      }
    }

    // 在重新排序之前，从多种召回策略中聚合候选对象
    const scoredCandidates = new Map()

    if (useSemanticRetrieval && queryVectorNorm > 0) {
      try {
        const vectorHits = await retrieveVectorCandidates({
          chunksCollection,
          username: safeUsername,
          kbId,
          queryVector,
        })

        for (const item of vectorHits) {
          const semanticScore = Math.max(0, Number(item?.score || 0))
          if (semanticScore > 0) semanticSignalHit = true
          const withSemantic = {
            ...item,
            _semanticScore: semanticScore,
          }
          const score = scoreChunk({
            chunk: withSemantic,
            query: safeQuery,
            queryTerms,
            textScore: 0,
            pinnedDocIds: pinnedSet,
          })
          scoredCandidates.set(String(item.chunkId), { ...withSemantic, _ragScore: score })
        }
      } catch (error) {
        // 向量检索分支失败时记录原因，并回退到文本检索 + 本地余弦打分。
        const reason = String(error?.message || 'unknown error')
        console.warn(`[RAG] vector search failed, fallback to text/recent path: ${reason}`)
      }
    }

    if (useTextRetrieval) {
      try {
      const textHits = await chunksCollection
        .find(
          {
            username: safeUsername,
            kbId,
            $text: { $search: safeQuery },
          },
          {
            projection: {
              _id: 0,
              chunkId: 1,
              chunkIndex: 1,
              docId: 1,
              docName: 1,
              sourceUrl: 1,
              preview: 1,
              content: 1,
              keywords: 1,
              embedding: 1,
              embeddingNorm: 1,
              embeddingStatus: 1,
              score: { $meta: 'textScore' },
            },
          },
        )
        .sort({ score: { $meta: 'textScore' } })
        .limit(MAX_CANDIDATES_TEXT)
        .toArray()

      for (const item of textHits) {
        const normalizedContent = String(item?.content || '').toLowerCase()
        const lexicalScore = lexicalCoverage(normalizedContent, queryTerms)
        if (Number(item?.score || 0) > 0 || lexicalScore > 0.08) textSignalHit = true
        const existing = scoredCandidates.get(String(item.chunkId))
        item._semanticScore = useSemanticRetrieval
          ? cosineSimilarity(
              queryVector,
              queryVectorNorm,
              item?.embedding || [],
              Number(item?.embeddingNorm || 0),
            )
          : 0
        if (existing && Number(existing._semanticScore || 0) > Number(item._semanticScore || 0)) {
          item._semanticScore = Number(existing._semanticScore || 0)
        }
        const score = scoreChunk({
          chunk: item,
          query: safeQuery,
          queryTerms,
          textScore: Number(item.score || 0),
          pinnedDocIds: pinnedSet,
        })
        scoredCandidates.set(String(item.chunkId), { ...item, _ragScore: score })
      }
      } catch (error) {
        // 某些本地 Mongo 环境可能未启用 text index 查询，失败时记录原因并继续走 recent 兜底链路。
        const reason = String(error?.message || 'unknown error')
        console.warn(`[RAG]文本检索回退至近期召回: ${reason}`)
      }

      // 关键词粗召回：与全文检索并行补充候选，再统一进入同一重排池。
      try {
        const keywordTerms = [...new Set(queryTerms)].filter(Boolean).slice(0, getRagKeywordRecallMaxTerms())
        if (keywordTerms.length > 0) {
          const keywordHits = await chunksCollection
            .find(
              {
                username: safeUsername,
                kbId,
                keywords: { $in: keywordTerms },
              },
              {
                projection: {
                  _id: 0,
                  chunkId: 1,
                  chunkIndex: 1,
                  docId: 1,
                  docName: 1,
                  sourceUrl: 1,
                  preview: 1,
                  content: 1,
                  keywords: 1,
                  embedding: 1,
                  embeddingNorm: 1,
                  embeddingStatus: 1,
                  updatedAt: 1,
                },
              },
            )
            .sort({ updatedAt: -1 })
            .limit(getRagKeywordRecallLimit())
            .toArray()

          const minKeywordHits = getRagKeywordRecallMinHits()
          for (const item of keywordHits) {
            const keywordSet = new Set(Array.isArray(item?.keywords) ? item.keywords : [])
            let hitCount = 0
            for (const term of keywordTerms) {
              if (keywordSet.has(term)) hitCount += 1
            }
            if (hitCount < minKeywordHits) continue

            const overlapScore = hitCount / keywordTerms.length
            const normalizedContent = String(item?.content || '').toLowerCase()
            const lexicalScore = lexicalCoverage(normalizedContent, keywordTerms)
            if (overlapScore > 0 || lexicalScore > 0.08) textSignalHit = true

            const existing = scoredCandidates.get(String(item.chunkId))
            item._semanticScore = useSemanticRetrieval
              ? cosineSimilarity(
                  queryVector,
                  queryVectorNorm,
                  item?.embedding || [],
                  Number(item?.embeddingNorm || 0),
                )
              : 0
            if (existing && Number(existing._semanticScore || 0) > Number(item._semanticScore || 0)) {
              item._semanticScore = Number(existing._semanticScore || 0)
            }

            // 给关键词粗召回一个温和的文本分，避免压过全文检索原生 textScore。
            const keywordTextScore = Math.min(2, overlapScore * 1.5 + lexicalScore * 0.5)
            item.score = Math.max(Number(item?.score || 0), keywordTextScore)

            const score = scoreChunk({
              chunk: item,
              query: safeQuery,
              queryTerms,
              textScore: keywordTextScore,
              pinnedDocIds: pinnedSet,
            })

            if (!existing || score > Number(existing._ragScore || 0)) {
              scoredCandidates.set(String(item.chunkId), { ...item, _ragScore: score })
            }
          }
        }
      } catch {
        // 关键词粗召回失败不影响主链路，继续后续兜底流程。
      }
    }

    // Fallback recall: 最新文本块 + 轻量级关键词重叠评分.
    const recentHits = await chunksCollection
      .find(
        {
          username: safeUsername,
          kbId,
        },
        {
          projection: {
            _id: 0,
            chunkId: 1,
            chunkIndex: 1,
            docId: 1,
            docName: 1,
            sourceUrl: 1,
            preview: 1,
            content: 1,
            keywords: 1,
            embedding: 1,
            embeddingNorm: 1,
            embeddingStatus: 1,
            updatedAt: 1,
          },
        },
      )
      .sort({ updatedAt: -1 })
      .limit(Math.max(MAX_CANDIDATES_RECENT, queryVectorNorm > 0 ? 400 : MAX_CANDIDATES_RECENT))
      .toArray()

    for (const item of recentHits) {
      const key = String(item.chunkId)
      item._semanticScore = useSemanticRetrieval
        ? cosineSimilarity(
            queryVector,
            queryVectorNorm,
            item?.embedding || [],
            Number(item?.embeddingNorm || 0),
          )
        : 0
      if (Number(item._semanticScore || 0) > 0) semanticSignalHit = true
      const existing = scoredCandidates.get(key)
      if (existing && Number(existing._semanticScore || 0) > Number(item._semanticScore || 0)) {
        item._semanticScore = Number(existing._semanticScore || 0)
      }
      const score = scoreChunk({
        chunk: item,
        query: safeQuery,
        queryTerms,
        textScore: 0,
        pinnedDocIds: pinnedSet,
      })
      if (score > 0 && (mode === 'text' || mode === 'hybrid')) {
        textSignalHit = true
      }
      if (score <= 0) continue
      if (!existing || score > Number(existing._ragScore || 0)) {
        scoredCandidates.set(key, { ...item, _ragScore: score })
      }
    }

    const topChunks = [...scoredCandidates.values()]
      .sort((a, b) => Number(b._ragScore || 0) - Number(a._ragScore || 0))
      .slice(0, contextTopK)
      .map((item) => ({
        ...item,
        // 统一对外展示口径：routeConfidence 与路由判定阈值保持一致。
        _routeConfidence: estimateRagConfidence({
          chunk: item,
          query: safeQuery,
          queryTerms,
          mode,
        }),
      }))

    const hasRagEvidence = topChunks.length > 0
    const topChunk = topChunks[0] || null
    const topRagScore = Number(topChunk?._ragScore || 0)
    const topConfidence = clamp01(Number(topChunk?._routeConfidence || 0))
    const pinnedMatched = topChunks.some((item) => pinnedSet.has(String(item?.docId || '')))
    const minConfidence = mode === 'text' ? getRagRouteMinConfidenceText() : getRagRouteMinConfidence()
    const minTopScore =
      mode === 'text'
        ? getRagRouteMinTopScoreText()
        : mode === 'semantic'
          ? getRagRouteMinTopScoreSemantic()
          : getRagRouteMinTopScoreHybrid()
    // 路由策略：仅在检索证据置信度达标（或命中用户手动钉住文档）时才注入RAG上下文。
    // 文本模式更偏向“命中即用”，阈值单独放低，避免知识库问答被误判为模型直答。
    const shouldUseRag =
      hasRagEvidence &&
      !shortAmbiguousQuery &&
      (topConfidence >= minConfidence || (getRagRoutePinnedBoostEnabled() && pinnedMatched)) &&
      (topRagScore >= minTopScore || (getRagRoutePinnedBoostEnabled() && pinnedMatched))

    // 根据检索命中信号确定最终展示给前端的检索模式标签。
    const resolveModeUsed = () => {
      if (!shouldUseRag) return 'none'

      if (mode === 'text') return 'text'

      if (mode === 'semantic') {
        // 语义模式下如果向量不可用/无命中，则回退为文本链路。
        return semanticSignalHit ? 'semantic' : 'text'
      }

      // 混合模式根据实际命中信号决定展示文案。
      if (semanticSignalHit && textSignalHit) return 'hybrid'
      if (semanticSignalHit) return 'semantic'
      return 'text'
    }

    const retrievalModeUsed = resolveModeUsed()

    if (!shouldUseRag) {
      return {
        refs: [],
        contextDocs: [],
        promptContext: '',
        retrievalModeUsed,
      }
    }

    // refs is for evidence panel; contextDocs is for session context panel.
    const refs = topChunks.map((item) => ({
      viewUrl:
        isWordDocumentFile(item.docName) || isWordDocumentFile(item.sourceUrl)
          ? `/api/kb/docs/${encodeURIComponent(String(item.docId || ''))}/view`
          : '',
      url: item.sourceUrl || '',
      snippet: buildSafeCitationSnippet({
        snippet: item.preview || item.content || '',
        docName: item.docName || '未命名文档',
      }),
      score: clamp01(Number(item._routeConfidence || 0)),
      docId: String(item.docId || ''),
      chunkId: String(item.chunkId || ''),
      name: String(item.docName || '未命名文档'),
    }))

    const docAgg = new Map()
    for (const item of topChunks) {
      const key = String(item.docId || '')
      const current = docAgg.get(key) || {
        docId: key,
        name: String(item.docName || '未命名文档'),
        score: 0,
        hitChunks: 0,
      }
      current.score = Math.max(current.score, clamp01(Number(item._routeConfidence || 0)))
      current.hitChunks += 1
      docAgg.set(key, current)
    }

    const contextDocs = [...docAgg.values()]
      .sort((a, b) => b.score - a.score)
      .map((item) => ({
        docId: item.docId,
        name: item.name,
        score: item.score,
        hitChunks: item.hitChunks,
      }))

    const promptContext = topChunks
      .map((item, index) => {
        const rank = index + 1
        return `[${rank}] 文档: ${item.docName}\n片段: ${item.content}`
      })
      .join('\n\n-----\n\n')

    return {
      refs,
      contextDocs,
      promptContext,
      retrievalModeUsed,
    }
  }

  // 文档列表查询：用于知识库面板展示。
  async function listDocuments({ username, kbId = DEFAULT_KB_ID, limit = 200 }) {
    const safeUsername = String(username || '').trim()
    if (!safeUsername) return []

    return docsCollection
      .find({ username: safeUsername, kbId }, { projection: { _id: 0 } })
      .sort({ updatedAt: -1 })
      .limit(Number(limit || 200))
      .toArray()
  }

  // 删除单文档：同时清理 docs 与 chunks，必要时删除源文件。
  async function deleteDocument({ username, docId, removeFile = true }) {
    const safeUsername = String(username || '').trim()
    const safeDocId = String(docId || '').trim()
    if (!safeUsername || !safeDocId) {
      throw new Error('缺少用户或文档标识，无法删除知识文档')
    }

    const doc = await docsCollection.findOne(
      { username: safeUsername, docId: safeDocId },
      { projection: { _id: 0, storedFileName: 1 } },
    )

    await docsCollection.deleteOne({ username: safeUsername, docId: safeDocId })
    await chunksCollection.deleteMany({ username: safeUsername, docId: safeDocId })

    // 默认同时尝试清理本地上传文件，失败不影响接口成功返回。
    if (removeFile && doc?.storedFileName && uploadsDir) {
      const filePath = path.resolve(uploadsDir, String(doc.storedFileName || ''))
      if (filePath.startsWith(uploadsDir) && fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath).catch(() => null)
      }
    }

    return { ok: true }
  }

  // 批量清理失败文档：用于回收无效记录和残留文件。
  async function clearFailedDocuments({ username, kbId = DEFAULT_KB_ID, removeFile = true }) {
    const safeUsername = String(username || '').trim()
    if (!safeUsername) {
      throw new Error('缺少用户标识，无法清理失败文档')
    }

    const failedDocs = await docsCollection
      .find(
        { username: safeUsername, kbId, parseStatus: 'failed' },
        { projection: { _id: 0, docId: 1, storedFileName: 1 } },
      )
      .toArray()

    const docIds = failedDocs.map((item) => String(item.docId || '')).filter(Boolean)
    if (docIds.length === 0) {
      return { deletedCount: 0 }
    }

    await docsCollection.deleteMany({ username: safeUsername, kbId, docId: { $in: docIds } })
    await chunksCollection.deleteMany({ username: safeUsername, kbId, docId: { $in: docIds } })

    if (removeFile && uploadsDir) {
      await Promise.all(
        failedDocs.map(async (doc) => {
          const stored = String(doc?.storedFileName || '')
          if (!stored) return
          const filePath = path.resolve(uploadsDir, stored)
          if (!filePath.startsWith(uploadsDir) || !fs.existsSync(filePath)) return
          await fs.promises.unlink(filePath).catch(() => null)
        }),
      )
    }

    return { deletedCount: docIds.length }
  }

  // 重建索引：校验文档与文件后重新入队解析。
  async function reindexDocument({ username, docId, kbId = DEFAULT_KB_ID }) {
    const safeUsername = String(username || '').trim()
    const safeDocId = String(docId || '').trim()
    if (!safeUsername || !safeDocId) {
      throw new Error('缺少用户或文档标识，无法重建索引')
    }

    const doc = await docsCollection.findOne(
      { username: safeUsername, docId: safeDocId },
      {
        projection: {
          _id: 0,
          storedFileName: 1,
          name: 1,
          mimeType: 1,
          size: 1,
          url: 1,
        },
      },
    )

    if (!doc) {
      throw new Error('文档不存在或已被删除')
    }

    if (!uploadsDir) {
      throw new Error('服务端未配置上传目录，无法重建索引')
    }

    const filePath = path.resolve(uploadsDir, String(doc.storedFileName || ''))
    if (!filePath.startsWith(uploadsDir) || !fs.existsSync(filePath)) {
      throw new Error('原始文件不存在，无法重建索引')
    }

    // 重建走异步入队，避免接口阻塞并保持状态流一致。
    return enqueueIngestUploadedFile({
      username: safeUsername,
      filePath,
      storedFileName: String(doc.storedFileName || ''),
      originalName: String(doc.name || doc.storedFileName || '未命名文档'),
      docId: safeDocId,
      mimeType: String(doc.mimeType || ''),
      size: Number(doc.size || 0),
      url: String(doc.url || ''),
      kbId,
      bypassDedup: true,
    })
  }

  // 原文预览：按 chunkIndex 顺序拼接，供前端查看完整文本。
  async function getDocumentView({ username, docId, kbId = DEFAULT_KB_ID, maxChars = 450000 }) {
    const safeUsername = String(username || '').trim()
    const safeDocId = String(docId || '').trim()
    if (!safeUsername || !safeDocId) {
      throw new Error('缺少用户或文档标识')
    }

    const doc = await docsCollection.findOne(
      { username: safeUsername, kbId, docId: safeDocId },
      { projection: { _id: 0, docId: 1, name: 1, ext: 1, mimeType: 1, url: 1 } },
    )
    if (!doc) {
      throw new Error('文档不存在或无权访问')
    }

    const chunks = await chunksCollection
      .find(
        { username: safeUsername, kbId, docId: safeDocId },
        { projection: { _id: 0, content: 1, chunkIndex: 1 } },
      )
      .sort({ chunkIndex: 1 })
      .toArray()

    const joined = chunks.map((item) => String(item?.content || '')).join('\n\n')
    const safeMaxChars = Math.max(10000, Number(maxChars || 450000))

    return {
      docId: String(doc.docId || ''),
      name: String(doc.name || '未命名文档'),
      ext: String(doc.ext || ''),
      mimeType: String(doc.mimeType || ''),
      sourceUrl: String(doc.url || ''),
      content: joined.slice(0, safeMaxChars),
      truncated: joined.length > safeMaxChars,
    }
  }

  return {
    ensureIndexes,
    ingestUploadedFile,
    enqueueIngestUploadedFile,
    retrieveContext,
    listDocuments,
    deleteDocument,
    clearFailedDocuments,
    reindexDocument,
    getDocumentView,
  }
}
