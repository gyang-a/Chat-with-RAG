/* eslint-env node */
import express from 'express'
import cors from 'cors'
import multer from 'multer'
import dotenv from 'dotenv'
import compression from 'compression'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import iconv from 'iconv-lite'
import crypto from 'node:crypto'
import process from 'node:process'
import { Buffer } from 'node:buffer'
import { MongoClient } from 'mongodb'
import { buildModelRegistry } from './modelRegistry.js'
import { createRagService } from './ragService.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const uploadsDir = path.resolve(rootDir, 'uploads')
// 头像单独放在 avatars 子目录，便于权限控制与后续清理策略。
const avatarUploadsDir = path.resolve(uploadsDir, 'avatars')

// 优先读取 .env.server；未命中时再回退 .env
dotenv.config({ path: path.resolve(rootDir, '.env.server') })
dotenv.config()

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true })
}

if (!fs.existsSync(avatarUploadsDir)) {
  // 启动时确保头像目录存在，避免首次上传报路径不存在。
  fs.mkdirSync(avatarUploadsDir, { recursive: true })
}

const app = express()
const port = Number(process.env.SERVER_PORT || 3000)
const upstreamTimeoutMs = Number(process.env.UPSTREAM_TIMEOUT_MS || 120000)
const upstreamTemperature = Number(process.env.UPSTREAM_TEMPERATURE || 1)
const upstreamTopP = Number(process.env.UPSTREAM_TOP_P || 1)
const upstreamAuthMode = (process.env.UPSTREAM_AUTH_MODE || 'auto').toLowerCase()
const authUsername = (process.env.AUTH_USERNAME || 'admin').trim()
const authPassword = (process.env.AUTH_PASSWORD || '123456').trim()
const authSecret = (process.env.AUTH_SECRET || 'kira_dev_secret').trim()
const authTokenTtlMs = Number(process.env.AUTH_TOKEN_TTL_MS || 7 * 24 * 60 * 60 * 1000)
const mongodbUri = (process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017').trim()
const mongodbDbName = (process.env.MONGODB_DB_NAME || 'chat_app').trim()
const systemPrompt =
  process.env.UPSTREAM_SYSTEM_PROMPT || '你是一个专业、简洁、准确的中文 AI 助手。'
const attachmentTextCache = new Map()
const preferredAuthStrategyCache = new Map()
const serverVersion = '2026-03-24-auth-fallback-v4'
const maxContextMessages = Number(process.env.UPSTREAM_CONTEXT_MAX_MESSAGES || 20)
let mongodbClient = null
let usersCollection = null
let conversationsCollection = null
let messagesCollection = null
let ragService = null
const modelRegistry = buildModelRegistry()

function toOpenAICompatEndpoint(url = '') {
  // 兼容“基地址”与“完整 /chat/completions 地址”两种输入。
  const trimmed = String(url || '').trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  if (trimmed.endsWith('/chat/completions')) return trimmed
  return `${trimmed}/chat/completions`
}

function normalizeCustomModelName(value = '') {
  const name = String(value || '').trim()
  // 仅允许常见模型命名字符，避免注入与不可见字符污染。
  if (!/^[A-Za-z0-9._:-]{1,80}$/.test(name)) return ''
  return name
}

function getCustomModelEndpoint() {
  // 自定义模型默认走 OpenAI 兼容地址，可通过环境变量覆盖。
  const fromEnv = String(process.env.CUSTOM_MODEL_ENDPOINT || process.env.UPSTREAM_CHAT_URL || '').trim()
  const fromActiveProvider = String(modelRegistry?.activeProvider?.endpoint || '').trim()
  const fromAnyProvider = String(modelRegistry?.providers?.find((item) => item?.endpoint)?.endpoint || '').trim()
  return toOpenAICompatEndpoint(fromEnv || fromActiveProvider || fromAnyProvider)
}

function normalizeUserCustomModels(rawList = []) {
  if (!Array.isArray(rawList)) return []

  const seen = new Set()
  const list = []
  for (const item of rawList) {
    const name = normalizeCustomModelName(item?.name)
    const apiKey = String(item?.apiKey || '').trim()
    if (!name || !apiKey) continue
    const uniqueKey = name.toLowerCase()
    if (seen.has(uniqueKey)) continue
    seen.add(uniqueKey)

    list.push({
      name,
      apiKey,
      updatedAt: Number(item?.updatedAt || Date.now()),
      createdAt: Number(item?.createdAt || Date.now()),
    })
  }

  return list
}

async function getUserCustomModels(username) {
  const user = await getAuthUser(username)
  return normalizeUserCustomModels(user?.customModels || [])
}

async function upsertUserCustomModel({ username, name, apiKey }) {
  if (!usersCollection) {
    throw new Error('数据库未初始化')
  }

  const safeUsername = String(username || '').trim()
  const safeName = normalizeCustomModelName(name)
  const safeApiKey = String(apiKey || '').trim()
  if (!safeUsername || !safeName || !safeApiKey) {
    throw new Error('模型名称与 API Key 为必填')
  }

  const current = await getUserCustomModels(safeUsername)
  const existsIndex = current.findIndex((item) => item.name.toLowerCase() === safeName.toLowerCase())
  const next = [...current]
  const now = Date.now()

  if (existsIndex >= 0) {
    next[existsIndex] = {
      ...next[existsIndex],
      name: safeName,
      apiKey: safeApiKey,
      updatedAt: now,
    }
  } else {
    if (next.length >= 30) {
      throw new Error('自定义模型数量已达上限（30）')
    }
    next.push({
      name: safeName,
      apiKey: safeApiKey,
      createdAt: now,
      updatedAt: now,
    })
  }

  await usersCollection.updateOne(
    { username: safeUsername },
    {
      $set: {
        customModels: next,
      },
    },
  )

  return {
    name: safeName,
    updated: existsIndex >= 0,
  }
}

async function deleteUserCustomModel({ username, modelName }) {
  if (!usersCollection) {
    throw new Error('数据库未初始化')
  }

  const safeUsername = String(username || '').trim()
  const safeName = normalizeCustomModelName(modelName)
  if (!safeUsername || !safeName) {
    throw new Error('模型名称不能为空')
  }

  const current = await getUserCustomModels(safeUsername)
  const next = current.filter((item) => item.name.toLowerCase() !== safeName.toLowerCase())

  await usersCollection.updateOne(
    { username: safeUsername },
    {
      $set: {
        customModels: next,
      },
    },
  )
}

async function getAvailableModelsForUser(username) {
  const customModels = await getUserCustomModels(username)
  const names = [...modelRegistry.allModels]
  const builtInLower = new Set(names.map((item) => String(item || '').toLowerCase()))

  for (const item of customModels) {
    const lower = item.name.toLowerCase()
    if (builtInLower.has(lower)) continue
    names.push(item.name)
  }

  return {
    models: names,
    defaultModel: modelRegistry.defaultModel || names[0] || '',
    customModels: customModels.map((item) => ({
      name: item.name,
      updatedAt: item.updatedAt,
      createdAt: item.createdAt,
    })),
  }
}

async function resolveSelectionForUser(username, inputModel) {
  const requestedModel = String(inputModel || '').trim()
  if (!requestedModel) {
    return modelRegistry.resolveSelection(requestedModel)
  }

  const customModels = await getUserCustomModels(username)
  const hit = customModels.find((item) => item.name.toLowerCase() === requestedModel.toLowerCase())
  if (hit) {
    const endpoint = getCustomModelEndpoint()
    return {
      provider: {
        id: `user-model:${requestedModel}`,
        mode: 'openai',
        endpoint,
        apiKey: hit.apiKey,
        authMode: 'auto',
        requestModel: hit.name,
        defaultModel: hit.name,
        models: [hit.name],
      },
      model: hit.name,
    }
  }

  return modelRegistry.resolveSelection(requestedModel)
}

function toBeijingISOString(input = Date.now()) {
  const utcMs = input instanceof Date ? input.getTime() : Number(input)
  const beijingMs = utcMs + 8 * 60 * 60 * 1000
  return new Date(beijingMs).toISOString().replace('Z', '+08:00')
}

async function initMongoDB() {
  const client = new MongoClient(mongodbUri)
  await client.connect()
  const db = client.db(mongodbDbName)
  const users = db.collection('users')
  const conversations = db.collection('conversations')
  const messages = db.collection('messages')

  await users.createIndex({ username: 1 }, { unique: true })
  await conversations.createIndex({ username: 1, conversationId: 1 }, { unique: true })
  await conversations.createIndex({ username: 1, updatedAt: -1 })
  await messages.createIndex({ username: 1, conversationId: 1, createdAt: 1 })
  await users.updateOne(
    { username: authUsername },
    {
      $setOnInsert: {
        username: authUsername,
        password: authPassword,
        avatarUrl: '',
        createdAt: toBeijingISOString(),
      },
    },
    { upsert: true },
  )

  // 补齐历史用户缺失的头像字段，避免前端读取时出现 undefined。
  await users.updateMany(
    {
      $or: [{ avatarUrl: { $exists: false } }, { avatarUrl: null }],
    },
    {
      $set: { avatarUrl: '' },
    },
  )

  // 补齐历史用户缺失的自定义模型字段。
  await users.updateMany(
    {
      $or: [{ customModels: { $exists: false } }, { customModels: null }],
    },
    {
      $set: { customModels: [] },
    },
  )

  const usersWithCreatedAt = await users.find({ createdAt: { $exists: true } }).project({ _id: 1, createdAt: 1 }).toArray()
  const bulkTimeFix = usersWithCreatedAt
    .map((item) => {
      const raw = item?.createdAt
      if (typeof raw === 'string' && raw.endsWith('+08:00')) return null
      if (!raw) return null

      const parsed = raw instanceof Date ? raw : new Date(raw)
      if (Number.isNaN(parsed.getTime())) return null

      return {
        updateOne: {
          filter: { _id: item._id },
          update: {
            $set: {
              createdAt: toBeijingISOString(parsed),
            },
          },
        },
      }
    })
    .filter(Boolean)

  if (bulkTimeFix.length > 0) {
    await users.bulkWrite(bulkTimeFix)
  }

  usersCollection = users
  conversationsCollection = conversations
  messagesCollection = messages
  ragService = createRagService({ db, uploadsDir })
  await ragService.ensureIndexes()
  mongodbClient = client
}

async function getAuthUser(username) {
  // 按用户名查询用户文档，统一入口便于后续加缓存或投影
  if (!usersCollection) return null
  const safeUsername = String(username || '').trim()
  if (!safeUsername) return null
  return usersCollection.findOne({ username: safeUsername })
}

async function createAuthUser(username, password) {
  if (!usersCollection) {
    throw new Error('数据库未初始化')
  }

  const safeUsername = String(username || '').trim()
  const safePassword = String(password || '')
  // 新用户默认无头像
  return usersCollection.insertOne({
    username: safeUsername,
    password: safePassword,
    avatarUrl: '',
    createdAt: toBeijingISOString(),
  })
}

// 仅允许服务端托管的 /uploads 路径，阻断外部 URL 注入。
function normalizeAvatarUrl(value = '') {
  const text = String(value || '').trim()
  if (!text) return ''
  if (text.startsWith('/uploads/')) return text
  return ''
}

// 统一对外用户数据结构，避免在各接口重复拼装字段。
function buildAuthUserPayload(user = {}) {
  return {
    username: String(user?.username || '').trim(),
    avatarUrl: normalizeAvatarUrl(user?.avatarUrl),
  }
}

// 将公开访问路径映射为磁盘绝对路径，用于删除旧头像文件。
function resolveLocalPathFromPublicUploadUrl(url = '') {
  const safeUrl = String(url || '').trim()
  if (!safeUrl.startsWith('/uploads/')) return ''
  const relativePath = safeUrl.replace(/^\/+/, '')
  return path.resolve(rootDir, relativePath)
}

function normalizeConversationSnapshot(conversations = []) {
  if (!Array.isArray(conversations)) return []
  return conversations
    .filter((item) => item && typeof item === 'object' && item.id)
    .map((item) => ({
      id: String(item.id),
      title: String(item.title || '新对话'),
      pinned: Boolean(item.pinned),
      updatedAt: Number(item.updatedAt || Date.now()),
      createdAt: Number(item.createdAt || Date.now()),
      lastPreview: String(item.lastPreview || ''),
      contextDocs: Array.isArray(item.contextDocs) ? item.contextDocs : [],
      refs: Array.isArray(item.refs) ? item.refs : [],
    }))
}

function normalizeMessagesSnapshot(messagesByConversation = {}) {
  const next = {}
  if (!messagesByConversation || typeof messagesByConversation !== 'object') return next

  for (const [conversationId, list] of Object.entries(messagesByConversation)) {
    next[String(conversationId)] = Array.isArray(list)
      ? list
          .filter((message) => message && typeof message === 'object' && message.id)
          .map((message) => ({
            id: String(message.id),
            role: String(message.role || 'assistant'),
            content: message.content == null ? '' : String(message.content),
            attachments: Array.isArray(message.attachments) ? message.attachments : [],
            createdAt: Number(message.createdAt || Date.now()),
            refs: Array.isArray(message.refs) ? message.refs : [],
            contextDocs: Array.isArray(message.contextDocs) ? message.contextDocs : [],
            retrievalModeUsed: String(message.retrievalModeUsed || ''),
            feedback: String(message.feedback || 'none'),
          }))
      : []
  }

  return next
}

async function loadHistorySnapshot(username) {
  if (!conversationsCollection || !messagesCollection) {
    throw new Error('数据库未初始化')
  }

  const conversations = await conversationsCollection
    .find({ username })
    .project({ _id: 0, username: 0 })
    .sort({ pinned: -1, updatedAt: -1 })
    .toArray()

  const normalizedConversations = normalizeConversationSnapshot(
    conversations.map((item) => ({
      ...item,
      id: item?.id || item?.conversationId,
    })),
  )
  const currentConversationId = normalizedConversations[0]?.id || null

  const rawMessages = await messagesCollection
    .find({ username })
    .project({ _id: 0, conversationId: 1, id: 1, role: 1, content: 1, attachments: 1, createdAt: 1, refs: 1, contextDocs: 1, retrievalModeUsed: 1, feedback: 1 })
    .sort({ createdAt: 1 })
    .toArray()

  const messagesByConversation = {}
  for (const item of rawMessages) {
    const key = String(item.conversationId || '')
    if (!key) continue
    if (!messagesByConversation[key]) messagesByConversation[key] = []
    messagesByConversation[key].push({
      id: String(item.id),
      role: String(item.role || 'assistant'),
      content: item.content == null ? '' : String(item.content),
      attachments: Array.isArray(item.attachments) ? item.attachments : [],
      createdAt: Number(item.createdAt || Date.now()),
      refs: Array.isArray(item.refs) ? item.refs : [],
      contextDocs: Array.isArray(item.contextDocs) ? item.contextDocs : [],
      retrievalModeUsed: String(item.retrievalModeUsed || ''),
      feedback: String(item.feedback || 'none'),
    })
  }

  return {
    conversations: normalizedConversations,
    currentConversationId,
    messagesByConversation,
  }
}

async function saveHistorySnapshot(username, payload = {}) {
  if (!conversationsCollection || !messagesCollection) {
    throw new Error('数据库未初始化')
  }

  const conversations = normalizeConversationSnapshot(payload.conversations || [])
  const messagesByConversation = normalizeMessagesSnapshot(payload.messagesByConversation || {})
  const conversationIds = conversations.map((item) => item.id)

  if (conversationIds.length > 0) {
    await conversationsCollection.deleteMany({
      username,
      conversationId: { $nin: conversationIds },
    })
    await messagesCollection.deleteMany({
      username,
      conversationId: { $nin: conversationIds },
    })
  } else {
    await conversationsCollection.deleteMany({ username })
    await messagesCollection.deleteMany({ username })
    return
  }

  await conversationsCollection.bulkWrite(
    conversations.map((item) => ({
      updateOne: {
        filter: { username, conversationId: item.id },
        update: {
          $set: {
            username,
            conversationId: item.id,
            title: item.title,
            pinned: item.pinned,
            updatedAt: item.updatedAt,
            createdAt: item.createdAt,
            lastPreview: item.lastPreview,
            contextDocs: item.contextDocs,
            refs: item.refs,
          },
        },
        upsert: true,
      },
    })),
  )

  await messagesCollection.deleteMany({
    username,
    conversationId: { $in: conversationIds },
  })

  const flattenedMessages = []
  for (const [conversationId, list] of Object.entries(messagesByConversation)) {
    if (!conversationIds.includes(conversationId)) continue
    for (const message of list) {
      flattenedMessages.push({
        ...message,
        username,
        conversationId,
      })
    }
  }

  if (flattenedMessages.length > 0) {
    await messagesCollection.insertMany(flattenedMessages, { ordered: false })
  }
}

app.use(
  cors({
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true,
    credentials: true,
  }),
)
app.use(
  compression({
    filter: (req, res) => {
      if (req.path === '/api/chat/stream') return false
      return compression.filter(req, res)
    },
  }),
)
app.use(express.json({ limit: '2mb' }))
app.use('/uploads', express.static(uploadsDir))

const allowedMime = new Set([
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])
const allowedExt = new Set(['.pdf', '.txt', '.md', '.doc', '.docx'])

function decodeUploadFileName(name = '') {
  try {
    // 修复部分 multipart 实现把 UTF-8 文件名按 latin1 解码导致的乱码
    const decoded = Buffer.from(name, 'latin1').toString('utf8')
    // 仅在明显乱码特征时使用解码结果，避免把正常中文再错误转换
    const mojibakePattern = /[ÃÂæåç¤¿]/
    if (mojibakePattern.test(name) && !mojibakePattern.test(decoded)) {
      return decoded
    }
    return name
  } catch {
    return name
  }
}

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadsDir),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname)
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`)
  },
})

const upload = multer({
  storage,
  limits: {
    fileSize: Number(process.env.UPLOAD_MAX_SIZE || 10 * 1024 * 1024),
  },
  fileFilter: (_, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    if (allowedMime.has(file.mimetype) || allowedExt.has(ext)) {
      cb(null, true)
      return
    }
    cb(new Error('仅支持 PDF/TXT/Markdown/DOC/DOCX 文件'))
  },
})

// 头像上传限制：仅允许常见图片类型。
const allowedAvatarMime = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const allowedAvatarExt = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif'])

const avatarStorage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, avatarUploadsDir),
  filename: (_, file, cb) => {
    // 使用时间戳+随机串，避免同名覆盖。
    const decodedName = decodeUploadFileName(file.originalname)
    const ext = path.extname(decodedName).toLowerCase() || '.png'
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`)
  },
})

const avatarUpload = multer({
  storage: avatarStorage,
  limits: {
    // 默认头像大小上限 10MB，可通过环境变量覆盖。
    fileSize: Number(process.env.AVATAR_MAX_SIZE || 10 * 1024 * 1024),
  },
  fileFilter: (_, file, cb) => {
    // 同时支持 mime 与后缀校验，兼容不同浏览器上传差异
    const ext = path.extname(file.originalname).toLowerCase()
    if (allowedAvatarMime.has(file.mimetype) || allowedAvatarExt.has(ext)) {
      cb(null, true)
      return
    }
    cb(new Error('仅支持 JPG/PNG/WEBP/GIF 图片'))
  },
})

function sendSSE(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`)
}

function sendSSEDone(res) {
  res.write('data: [DONE]\n\n')
}

function escapeHtml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function splitSafeChunks(text = '', size = 6) {
  return text.match(new RegExp(`.{1,${size}}`, 'g')) || []
}

function normalizeHistoryMessages(messages = []) {
  if (!Array.isArray(messages)) return []

  return messages
    .map((item) => ({
      role: String(item?.role || '').trim(),
      content: item?.content == null ? '' : String(item.content).trim(),
    }))
    .filter((item) => (item.role === 'user' || item.role === 'assistant') && item.content)
}

async function loadConversationHistoryMessages({ username, conversationId }) {
  if (!messagesCollection) return []
  const safeUsername = String(username || '').trim()
  const safeConversationId = String(conversationId || '').trim()
  if (!safeUsername || !safeConversationId) return []

  const list = await messagesCollection
    .find({ username: safeUsername, conversationId: safeConversationId })
    .project({ _id: 0, role: 1, content: 1, createdAt: 1 })
    .sort({ createdAt: 1 })
    .toArray()

  return normalizeHistoryMessages(list)
}

function buildUpstreamMessages({ historyMessages = [], userContent = '' }) {
  const safeUserContent = String(userContent || '').trim()
  const normalizedHistory = normalizeHistoryMessages(historyMessages)
  const tailHistory = maxContextMessages > 0
    ? normalizedHistory.slice(-maxContextMessages)
    : normalizedHistory

  // 防止历史里已包含当前用户输入时重复拼接同一条消息。
  const dedupedHistory = [...tailHistory]
  if (dedupedHistory.length > 0) {
    const last = dedupedHistory[dedupedHistory.length - 1]
    if (last.role === 'user' && last.content === safeUserContent) {
      dedupedHistory.pop()
    }
  }

  return [
    { role: 'system', content: systemPrompt },
    ...dedupedHistory,
    { role: 'user', content: safeUserContent },
  ]
}

function parseMaybeJSON(text = '') {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function normalizeMojibake(text = '') {
  const mojibakePattern = /[ÃÂæåç¤¿]/
  if (!mojibakePattern.test(text)) return text
  try {
    const decoded = Buffer.from(text, 'latin1').toString('utf8')
    return decoded || text
  } catch {
    return text
  }
}

function scoreReadableText(text = '') {
  if (!text) return -1
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length
  const replacement = (text.match(/�/g) || []).length
  const ascii = (text.match(/[a-zA-Z0-9]/g) || []).length
  return cjk * 4 + ascii - replacement * 8
}

function decodeBestEffort(buffer) {
  const candidates = []
  try {
    candidates.push(buffer.toString('utf8'))
  } catch {
    // ignore utf8 decode failures and try other encodings
  }
  try {
    candidates.push(iconv.decode(buffer, 'gb18030'))
  } catch {
    // ignore gb18030 decode failures and try other encodings
  }
  try {
    candidates.push(iconv.decode(buffer, 'latin1'))
  } catch {
    // ignore latin1 decode failures and keep best available candidate
  }

  if (candidates.length === 0) return ''

  let best = candidates[0]
  let bestScore = scoreReadableText(best)
  for (const candidate of candidates.slice(1)) {
    const score = scoreReadableText(candidate)
    if (score > bestScore) {
      best = candidate
      bestScore = score
    }
  }

  return normalizeMojibake(best)
}

async function extractTextSnippet(filePath, limit = 8000) {
  try {
    const buffer = await fs.promises.readFile(filePath)
    const raw = decodeBestEffort(buffer)
    const snippet = normalizeMojibake(raw.slice(0, limit).trim())
    return {
      snippet,
      truncated: raw.length > limit,
    }
  } catch {
    return {
      snippet: '',
      truncated: false,
    }
  }
}

function setAttachmentCache(fileName, payload) {
  if (!fileName) return
  attachmentTextCache.set(fileName, {
    ...payload,
    updatedAt: Date.now(),
  })
}

function getAttachmentCache(fileName) {
  if (!fileName) return null
  return attachmentTextCache.get(fileName) || null
}

function ensureUpstreamConfigured(provider) {
  return Boolean(provider?.endpoint)
}

function readExtraHeaders() {
  const raw = process.env.UPSTREAM_HEADERS_JSON
  if (!raw) return {}
  const parsed = parseMaybeJSON(raw)
  return parsed && typeof parsed === 'object' ? parsed : {}
}

function base64UrlEncode(input) {
  const raw = typeof input === 'string' ? Buffer.from(input) : input
  return raw
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function base64UrlDecode(input = '') {
  if (!input) return ''
  const padded = `${input}`.replace(/-/g, '+').replace(/_/g, '/')
  const padLength = (4 - (padded.length % 4)) % 4
  return Buffer.from(`${padded}${'='.repeat(padLength)}`, 'base64').toString('utf8')
}

function signAuthPayload(payloadSegment) {
  return base64UrlEncode(crypto.createHmac('sha256', authSecret).update(payloadSegment).digest())
}

function issueAuthToken(username) {
  const payload = {
    username,
    exp: Date.now() + authTokenTtlMs,
    iat: Date.now(),
  }
  const payloadSegment = base64UrlEncode(JSON.stringify(payload))
  const signature = signAuthPayload(payloadSegment)
  return `${payloadSegment}.${signature}`
}

function verifyAuthToken(token = '') {
  const [payloadSegment, signature] = String(token || '').split('.')
  if (!payloadSegment || !signature) {
    return { ok: false, message: 'Token 格式非法' }
  }

  const expectedSign = signAuthPayload(payloadSegment)
  if (expectedSign !== signature) {
    return { ok: false, message: 'Token 签名无效' }
  }

  const payloadText = base64UrlDecode(payloadSegment)
  const payload = parseMaybeJSON(payloadText)
  if (!payload || typeof payload !== 'object') {
    return { ok: false, message: 'Token 内容非法' }
  }

  if (!payload.exp || Number(payload.exp) <= Date.now()) {
    return { ok: false, message: 'Token 已过期' }
  }

  if (!payload.username || String(payload.username).trim().length === 0) {
    return { ok: false, message: 'Token 缺少用户名' }
  }

  return {
    ok: true,
    username: String(payload.username).trim(),
    exp: Number(payload.exp),
  }
}

function resolveBearerToken(req) {
  const raw = String(req.headers?.authorization || '')
  if (!raw.toLowerCase().startsWith('bearer ')) return ''
  return raw.slice(7).trim()
}

function requireAuth(req, res, next) {
  const token = resolveBearerToken(req)
  if (!token) {
    res.status(401).json({ message: '未登录或登录已失效，请先登录' })
    return
  }

  const verified = verifyAuthToken(token)
  if (!verified.ok) {
    res.status(401).json({ message: verified.message || '登录已失效，请重新登录' })
    return
  }

  req.auth = {
    username: verified.username,
    exp: verified.exp,
  }
  next()
}

function requirePreviewAuth(req, res, next) {
  // 预览页支持 query token，解决新标签页无法附带 Authorization 头的问题。
  const queryToken = String(req.query?.access_token || '').trim()
  const token = resolveBearerToken(req) || queryToken
  if (!token) {
    res.status(401).send('未登录或登录已失效，请先登录')
    return
  }

  const verified = verifyAuthToken(token)
  if (!verified.ok) {
    res.status(401).send(verified.message || '登录已失效，请重新登录')
    return
  }

  req.auth = {
    username: verified.username,
    exp: verified.exp,
  }
  next()
}

function createZhipuJwtFromApiKey(apiKey) {
  const parts = String(apiKey || '').split('.')
  if (parts.length < 2) return ''

  const id = parts[0]
  const secret = parts.slice(1).join('.')
  const nowMs = Date.now()
  const header = {
    alg: 'HS256',
    sign_type: 'SIGN',
    typ: 'JWT',
  }
  const payload = {
    api_key: id,
    exp: nowMs + 5 * 60 * 1000,
    timestamp: nowMs,
  }

  const h = base64UrlEncode(JSON.stringify(header))
  const p = base64UrlEncode(JSON.stringify(payload))
  const data = `${h}.${p}`
  const sign = crypto.createHmac('sha256', secret).update(data).digest()
  return `${data}.${base64UrlEncode(sign)}`
}

function resolveAuthorizationCandidates(endpoint, apiKey, authMode = upstreamAuthMode) {
  const key = String(apiKey || '').trim()
  if (!key) return [{ token: '', strategy: 'none' }]

  const isZhipu = /open\.bigmodel\.cn/i.test(String(endpoint || ''))
  const mode = authMode
  const jwt = createZhipuJwtFromApiKey(key)
  const cacheKey = `${String(endpoint || '').trim()}::${key}`
  const preferred = preferredAuthStrategyCache.get(cacheKey)

  const withPreferredFirst = (list) => {
    if (!preferred) return list
    const idx = list.findIndex((item) => item.strategy === preferred)
    if (idx <= 0) return list
    const ordered = [...list]
    const [first] = ordered.splice(idx, 1)
    ordered.unshift(first)
    return ordered
  }

  if (mode === 'bearer') {
    return withPreferredFirst([{ token: key, strategy: 'bearer' }])
  }

  if (mode === 'zhipu-jwt') {
    return withPreferredFirst([{ token: jwt || key, strategy: 'zhipu-jwt' }])
  }

  if (isZhipu && key.includes('.')) {
    const candidates = [{ token: key, strategy: 'bearer' }]
    if (jwt && jwt !== key) {
      candidates.push({ token: jwt, strategy: 'zhipu-jwt' })
    }
    return withPreferredFirst(candidates)
  }

  return withPreferredFirst([{ token: key, strategy: 'bearer' }])
}

function setPreferredAuthStrategy(endpoint, apiKey, strategy) {
  const key = String(apiKey || '').trim()
  const endpointText = String(endpoint || '').trim()
  if (!key || !endpointText || !strategy || strategy === 'none') return
  preferredAuthStrategyCache.set(`${endpointText}::${key}`, strategy)
}

function shouldRetryWithAlternateAuth(status, responseText) {
  if (status !== 401) return false
  const parsed = parseMaybeJSON(responseText)
  const code = String(parsed?.error?.code || '')
  if (!code) return true
  return code === '1000' || code === '1004'
}

function buildAuthHeaders(baseHeaders, candidate) {
  const headers = { ...baseHeaders }
  if (candidate?.token) {
    headers.Authorization = `Bearer ${candidate.token}`
  }
  return headers
}

function toTextFromUnknown(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)

  if (Array.isArray(value)) {
    return value.map((item) => toTextFromUnknown(item)).join('')
  }

  if (typeof value === 'object') {
    if (typeof value.text === 'string') return value.text
    if (typeof value.content === 'string') return value.content
    if (Array.isArray(value.content)) return value.content.map((item) => toTextFromUnknown(item)).join('')
    return ''
  }

  return ''
}

function collectTextLeaves(value, out = []) {
  if (value == null) return out
  if (typeof value === 'string') {
    out.push(value)
    return out
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    out.push(String(value))
    return out
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectTextLeaves(item, out)
    }
    return out
  }
  if (typeof value === 'object') {
    if (typeof value.text === 'string') out.push(value.text)
    if (typeof value.value === 'string') out.push(value.value)
    if (typeof value.content === 'string') out.push(value.content)
    if (Array.isArray(value.content)) collectTextLeaves(value.content, out)
    if (Array.isArray(value.parts)) collectTextLeaves(value.parts, out)
  }
  return out
}

function extractDeltaText(payload) {
  const choice = payload?.choices?.[0]
  const candidates = [
    choice?.delta?.content,
    choice?.message?.content,
    payload?.delta,
    payload?.content,
  ]

  for (const value of candidates) {
    const text = toTextFromUnknown(value)
    if (text) return text

    const deepText = collectTextLeaves(value).join('')
    if (deepText) return deepText
  }

  return ''
}

function resolveUploadedFileName(attachment) {
  if (attachment?.fileId) {
    return path.basename(String(attachment.fileId))
  }

  if (attachment?.url) {
    const fromUrl = String(attachment.url).split('/').pop()
    if (fromUrl) return path.basename(fromUrl)
  }

  return ''
}

function resolveAttachmentDisplayName(attachment) {
  const raw = attachment?.name || attachment?.fileId || '未命名文件'
  return decodeUploadFileName(String(raw))
}

function resolveAttachmentExt(attachment) {
  const displayName = resolveAttachmentDisplayName(attachment)
  const fromDisplay = path.extname(displayName).toLowerCase()
  if (fromDisplay) return fromDisplay

  if (attachment?.fileId) {
    const fromFileId = path.extname(String(attachment.fileId)).toLowerCase()
    if (fromFileId) return fromFileId
  }

  if (attachment?.url) {
    const fromUrl = path.extname(String(attachment.url)).toLowerCase()
    if (fromUrl) return fromUrl
  }

  return ''
}

async function buildAttachmentContext(attachments = []) {
  if (!Array.isArray(attachments) || attachments.length === 0) return ''

  const items = attachments.slice(0, 5)
  const blocks = []

  for (const item of items) {
    const name = resolveAttachmentDisplayName(item)
    const mimeType = String(item?.mimeType || '').toLowerCase()
    const fileName = resolveUploadedFileName(item)
    const ext = resolveAttachmentExt(item)
    const isTextLike =
      mimeType.startsWith('text/') ||
      ext === '.txt' ||
      ext === '.md' ||
      (mimeType === 'application/octet-stream' && (ext === '.txt' || ext === '.md'))

    let section = `附件名称: ${name}`

    if (isTextLike && item?.textSnippet) {
      section += `\n附件内容节选:\n${item.textSnippet}${item.textSnippetTruncated ? '\n...(内容已截断)' : ''}`
    } else if (isTextLike && fileName) {
      const cached = getAttachmentCache(fileName)
      if (cached?.textSnippet) {
        section += `\n附件内容节选:\n${cached.textSnippet}${cached.textSnippetTruncated ? '\n...(内容已截断)' : ''}`
        blocks.push(section)
        continue
      }

      try {
        const filePath = path.resolve(uploadsDir, fileName)
        if (filePath.startsWith(uploadsDir) && fs.existsSync(filePath)) {
          const raw = await fs.promises.readFile(filePath, 'utf-8')
          const snippet = raw.slice(0, 8000).trim()
          section += `\n附件内容节选:\n${snippet || '(空文本)'}${raw.length > 8000 ? '\n...(内容已截断)' : ''}`
        }
      } catch {
        section += '\n附件内容读取失败。'
      }
    } else if (ext === '.pdf' || mimeType === 'application/pdf') {
      section += '\n说明: 当前未启用 PDF 文本解析，模型仅可看到该文件名。'
    } else if (attachments.length > 0) {
      section += '\n说明: 当前附件未识别为可解析文本，已仅传递文件元信息。'
    }

    blocks.push(section)
  }

  return `请结合以下附件信息回答问题：\n\n${blocks.join('\n\n-----\n\n')}`
}

async function pipeOpenAICompatStream({
  endpoint,
  apiKey,
  authMode,
  historyMessages = [],
  message,
  model,
  attachments = [],
  ragContext = '',
  res,
  signal,
}) {
  const baseHeaders = {
    'Content-Type': 'application/json',
    ...readExtraHeaders(),
  }
  const authCandidates = resolveAuthorizationCandidates(endpoint, apiKey, authMode)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), upstreamTimeoutMs)
  signal?.addEventListener('abort', () => controller.abort(), { once: true })

  try {
    const attachmentContext = await buildAttachmentContext(attachments)
    const contextBlocks = []
    if (ragContext) {
      contextBlocks.push(`请优先依据以下知识库片段回答，若证据不足请明确说明：\n\n${ragContext}`)
    }
    if (attachmentContext) {
      contextBlocks.push(attachmentContext)
    }
    const userContent =
      contextBlocks.length > 0
        ? `${message}\n\n${contextBlocks.join('\n\n=====\n\n')}`
        : message

    const requestBody = JSON.stringify({
      model,
      stream: true,
      temperature: upstreamTemperature,
      top_p: upstreamTopP,
      messages: buildUpstreamMessages({
        historyMessages,
        userContent,
      }),
    })

    let response = null
    let lastFailedText = ''
    let lastStatus = 0
    let usedStrategy = 'none'

    for (let i = 0; i < authCandidates.length; i += 1) {
      const candidate = authCandidates[i]
      usedStrategy = candidate?.strategy || 'none'

      response = await fetch(endpoint, {
        method: 'POST',
        headers: buildAuthHeaders(baseHeaders, candidate),
        body: requestBody,
        signal: controller.signal,
      })

      if (response.ok && response.body) {
        setPreferredAuthStrategy(endpoint, apiKey, usedStrategy)
        break
      }

      lastStatus = response.status
      const failedText = await response.text().catch(() => '')
      lastFailedText = failedText
      const shouldRetry =
        i < authCandidates.length - 1 && shouldRetryWithAlternateAuth(response.status, failedText)

      if (!shouldRetry) {
        sendSSE(res, { error: `上游请求失败: ${response.status} ${failedText}` })
        sendSSEDone(res)
        return
      }
    }

    if (!response || !response.ok || !response.body) {
      sendSSE(res, { error: `上游请求失败: ${lastStatus} ${lastFailedText}` })
      sendSSEDone(res)
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line || !line.startsWith('data:')) continue

        const payloadText = line.replace(/^data:\s?/, '')
        if (payloadText === '[DONE]') {
          sendSSEDone(res)
          return
        }

        const payload = parseMaybeJSON(payloadText)
        if (!payload) continue

        const delta = extractDeltaText(payload)

        if (delta) {
          sendSSE(res, { delta })
        }
      }
    }

    sendSSEDone(res)
  } catch (error) {
    if (error.name !== 'AbortError') {
      sendSSE(res, { error: error.message || '上游流式调用失败' })
      sendSSEDone(res)
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function pipeGenericSSEJSONStream({
  endpoint,
  conversationId,
  historyMessages = [],
  message,
  model,
  apiKey,
  attachments = [],
  ragContext = '',
  res,
  signal,
}) {
  const headers = {
    'Content-Type': 'application/json',
    ...readExtraHeaders(),
  }
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), upstreamTimeoutMs)
  signal?.addEventListener('abort', () => controller.abort(), { once: true })

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        conversationId,
        message,
        model,
        attachments,
        ragContext,
        historyMessages,
      }),
      signal: controller.signal,
    })

    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => '')
      sendSSE(res, { error: `上游请求失败: ${response.status} ${text}` })
      sendSSEDone(res)
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split('\n\n')
      buffer = parts.pop() || ''

      for (const part of parts) {
        const lines = part
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.startsWith('data:'))

        for (const line of lines) {
          const text = line.replace(/^data:\s?/, '')
          if (text === '[DONE]') {
            sendSSEDone(res)
            return
          }

          const payload = parseMaybeJSON(text)
          if (payload) {
            sendSSE(res, payload)
          } else {
            sendSSE(res, { delta: text })
          }
        }
      }
    }

    sendSSEDone(res)
  } catch (error) {
    if (error.name !== 'AbortError') {
      sendSSE(res, { error: error.message || '上游流式调用失败' })
      sendSSEDone(res)
    }
  } finally {
    clearTimeout(timeout)
  }
}

app.get('/api/health', (_, res) => {
  res.json({ ok: true, service: 'chat-backend', version: serverVersion, timestamp: Date.now() })
})

app.post('/api/auth/login', async (req, res) => {
  const username = String(req.body?.username || '').trim()
  const password = String(req.body?.password || '')

  if (!username || !password) {
    res.status(400).json({ message: '用户名和密码不能为空' })
    return
  }

  const user = await getAuthUser(username)
  if (!user || String(user.password || '') !== password) {
    res.status(401).json({ message: '用户名或密码错误' })
    return
  }

  const token = issueAuthToken(username)
  // 登录回包统一带 user 结构，前端可直接拿到头像地址
  res.json({
    ok: true,
    token,
    user: buildAuthUserPayload(user),
    expiresAt: Date.now() + authTokenTtlMs,
  })
})

app.post('/api/auth/register', async (req, res) => {
  const username = String(req.body?.username || '').trim()
  const password = String(req.body?.password || '')

  if (!username || !password) {
    res.status(400).json({ message: '用户名和密码不能为空' })
    return
  }

  if (username.length < 3) {
    res.status(400).json({ message: '用户名至少 3 个字符' })
    return
  }

  if (password.length < 6) {
    res.status(400).json({ message: '密码至少 6 位' })
    return
  }

  try {
    await createAuthUser(username, password)
  } catch (error) {
    if (error?.code === 11000) {
      res.status(409).json({ message: '用户名已存在，请更换后重试' })
      return
    }
    throw error
  }

  const token = issueAuthToken(username)
  const user = await getAuthUser(username)
  // 注册后直接返回登录态，减少一次额外登录请求
  res.json({
    ok: true,
    token,
    user: buildAuthUserPayload(user || { username }),
    expiresAt: Date.now() + authTokenTtlMs,
  })
})

app.get('/api/auth/me', requireAuth, async (req, res) => {
  // 当前登录用户资料查询（用于前端刷新头像/昵称等信息）。
  const username = String(req.auth?.username || '').trim()
  const user = await getAuthUser(username)
  if (!user) {
    res.status(404).json({ message: '用户不存在' })
    return
  }

  res.json({
    ok: true,
    user: buildAuthUserPayload(user),
  })
})

app.post('/api/auth/avatar', requireAuth, avatarUpload.single('avatar'), async (req, res) => {
  // 头像上传成功后写入用户资料，并清理旧头像文件。
  if (!req.file) {
    res.status(400).json({ message: '缺少头像文件' })
    return
  }

  const username = String(req.auth?.username || '').trim()
  const user = await getAuthUser(username)
  if (!user) {
    res.status(404).json({ message: '用户不存在' })
    return
  }

  const nextAvatarUrl = `/uploads/avatars/${req.file.filename}`
  const previousAvatarUrl = normalizeAvatarUrl(user?.avatarUrl)

  await usersCollection.updateOne(
    { username },
    {
      $set: {
        avatarUrl: nextAvatarUrl,
      },
    },
  )

  // 仅删除受控目录中的旧头像文件，防止误删其他上传内容。
  if (previousAvatarUrl.startsWith('/uploads/avatars/')) {
    const oldPath = resolveLocalPathFromPublicUploadUrl(previousAvatarUrl)
    if (oldPath && fs.existsSync(oldPath)) {
      // 删除失败不阻断主流程，避免影响用户本次上传结果。
      fs.unlink(oldPath, () => null)
    }
  }

  res.json({
    ok: true,
    user: {
      username,
      avatarUrl: nextAvatarUrl,
    },
  })
})

app.post('/api/auth/logout', (_, res) => {
  res.json({ ok: true })
})

app.get('/api/models', requireAuth, async (req, res) => {
  const username = String(req.auth?.username || '').trim()
  const result = await getAvailableModelsForUser(username)
  res.json({
    ok: true,
    models: result.models,
    defaultModel: result.defaultModel,
  })
})

app.get('/api/models/custom', requireAuth, async (req, res) => {
  const username = String(req.auth?.username || '').trim()
  const result = await getAvailableModelsForUser(username)
  res.json({
    ok: true,
    models: result.customModels,
  })
})

app.post('/api/models/custom', requireAuth, async (req, res) => {
  const username = String(req.auth?.username || '').trim()
  const modelName = String(req.body?.modelName || '').trim()
  const apiKey = String(req.body?.apiKey || '').trim()

  if (!modelName || !apiKey) {
    res.status(400).json({ message: '模型名称和 API Key 为必填' })
    return
  }

  const normalizedName = normalizeCustomModelName(modelName)
  if (!normalizedName) {
    res.status(400).json({ message: '模型名称仅支持字母、数字、点、下划线、中划线和冒号（1-80位）' })
    return
  }

  if (modelRegistry.allModels.some((item) => item.toLowerCase() === normalizedName.toLowerCase())) {
    res.status(400).json({ message: '模型名称与系统内置模型冲突，请更换名称' })
    return
  }

  const result = await upsertUserCustomModel({
    username,
    name: normalizedName,
    apiKey,
  })

  res.json({ ok: true, model: result })
})

app.delete('/api/models/custom/:modelName', requireAuth, async (req, res) => {
  const username = String(req.auth?.username || '').trim()
  const modelName = String(req.params?.modelName || '').trim()
  if (!modelName) {
    res.status(400).json({ message: '缺少模型名称' })
    return
  }

  await deleteUserCustomModel({ username, modelName })
  res.json({ ok: true })
})

app.get('/api/kb/docs', requireAuth, async (req, res) => {
  const username = String(req.auth?.username || '').trim()
  const docs = await ragService.listDocuments({ username })
  res.json({ ok: true, docs })
})

app.get('/api/kb/docs/:docId/view', requirePreviewAuth, async (req, res) => {
  const username = String(req.auth?.username || '').trim()
  const docId = String(req.params?.docId || '').trim()
  if (!docId) {
    res.status(400).send('缺少文档标识')
    return
  }

  const payload = await ragService.getDocumentView({ username, docId })
  const title = escapeHtml(payload?.name || '文档预览')
  const body = escapeHtml(payload?.content || '该文档暂无可预览内容')
  const hint = payload?.truncated
    ? '<p style="margin:0 0 12px;color:#b45309;font-size:12px;">文档内容较长，当前仅展示前 450000 字符。</p>'
    : ''

  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.send(`<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title} - 原文预览</title>
  </head>
  <body style="margin:0;padding:20px;background:#f8fafc;color:#0f172a;font-family:'Microsoft YaHei UI','PingFang SC','Segoe UI',sans-serif;">
    <main style="max-width:980px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;">
      <h1 style="margin:0 0 12px;font-size:18px;line-height:1.4;">${title}</h1>
      ${hint}
      <pre style="white-space:pre-wrap;word-break:break-word;line-height:1.72;font-size:14px;margin:0;">${body}</pre>
    </main>
  </body>
</html>`)
})

app.post('/api/kb/docs/:docId/reindex', requireAuth, async (req, res) => {
  const username = String(req.auth?.username || '').trim()
  const docId = String(req.params?.docId || '').trim()
  if (!docId) {
    res.status(400).json({ message: '缺少文档标识' })
    return
  }

  const result = await ragService.reindexDocument({ username, docId })
  res.json({ ok: true, result })
})

app.delete('/api/kb/docs/:docId', requireAuth, async (req, res) => {
  const username = String(req.auth?.username || '').trim()
  const docId = String(req.params?.docId || '').trim()
  if (!docId) {
    res.status(400).json({ message: '缺少文档标识' })
    return
  }

  // 删除知识库记录时默认清理对应上传文件。
  await ragService.deleteDocument({ username, docId, removeFile: true })
  res.json({ ok: true })
})

app.delete('/api/kb/docs', requireAuth, async (req, res) => {
  const username = String(req.auth?.username || '').trim()
  const status = String(req.query?.status || '').trim().toLowerCase()

  if (status !== 'failed') {
    res.status(400).json({ message: '仅支持按 failed 状态清理' })
    return
  }

  // 批量清理失败文档，便于快速回收无效记录。
  const result = await ragService.clearFailedDocuments({ username, removeFile: true })
  res.json({ ok: true, result })
})

app.get('/api/history', requireAuth, async (req, res) => {
  const username = String(req.auth?.username || '').trim()
  const snapshot = await loadHistorySnapshot(username)
  res.json({ ok: true, ...snapshot })
})

app.put('/api/history', requireAuth, async (req, res) => {
  const username = String(req.auth?.username || '').trim()
  await saveHistorySnapshot(username, req.body || {})
  res.json({ ok: true })
})

async function ingestUploadedKnowledgeFile({ username, file }) {
  const safeOriginalName = decodeUploadFileName(file.originalname)
  const filePath = path.resolve(uploadsDir, file.filename)
  const fileUrl = `/uploads/${file.filename}`

  let ragResult = {
    docId: '',
    parseStatus: 'queued',
    parseError: '',
    textSnippet: '',
    textSnippetTruncated: false,
  }

  try {
    ragResult = await ragService.enqueueIngestUploadedFile({
      username,
      filePath,
      storedFileName: file.filename,
      originalName: safeOriginalName,
      mimeType: file.mimetype,
      size: file.size,
      url: fileUrl,
    })
  } catch {
    // 入队失败时，仍回落为文件可用信息，避免前端流程被完全阻断。
    const parsed = await extractTextSnippet(filePath)
    ragResult.textSnippet = parsed.snippet
    ragResult.textSnippetTruncated = parsed.truncated
    ragResult.parseStatus = 'failed'
    ragResult.parseError = '知识库任务创建失败'
  }

  setAttachmentCache(file.filename, {
    textSnippet: ragResult.textSnippet || '',
    textSnippetTruncated: Boolean(ragResult.textSnippetTruncated),
    originalName: safeOriginalName,
    mimeType: file.mimetype,
    docId: ragResult.docId || '',
  })

  return {
    version: serverVersion,
    originalName: safeOriginalName,
    fileName: file.filename,
    size: file.size,
    mimeType: file.mimetype,
    url: fileUrl,
    textSnippet: ragResult.textSnippet || '',
    textSnippetTruncated: Boolean(ragResult.textSnippetTruncated),
    docId: ragResult.docId || '',
    parseStatus: ragResult.parseStatus || 'queued',
    parseError: ragResult.parseError || '',
    indexed: Boolean(ragResult.indexed),
    chunkCount: Number(ragResult.chunkCount || 0),
  }
}

async function buildChatAttachmentFile({ file }) {
  const safeOriginalName = decodeUploadFileName(file.originalname)
  const filePath = path.resolve(uploadsDir, file.filename)
  const fileUrl = `/uploads/${file.filename}`
  const ext = path.extname(safeOriginalName).toLowerCase()
  const storedExt = path.extname(file.filename).toLowerCase()
  const isTextLike =
    file.mimetype.startsWith('text/') ||
    ext === '.txt' ||
    ext === '.md' ||
    storedExt === '.txt' ||
    storedExt === '.md'

  let textSnippet = ''
  let textSnippetTruncated = false
  if (isTextLike) {
    const parsed = await extractTextSnippet(filePath)
    textSnippet = parsed.snippet
    textSnippetTruncated = parsed.truncated
  }

  // 聊天附件仅用于当前会话，不写入知识库索引。
  setAttachmentCache(file.filename, {
    textSnippet,
    textSnippetTruncated,
    originalName: safeOriginalName,
    mimeType: file.mimetype,
    docId: '',
  })

  return {
    version: serverVersion,
    originalName: safeOriginalName,
    fileName: file.filename,
    size: file.size,
    mimeType: file.mimetype,
    url: fileUrl,
    textSnippet,
    textSnippetTruncated,
    docId: '',
    indexed: false,
    chunkCount: 0,
  }
}

app.post('/api/kb/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ message: '缺少文件' })
    return
  }

  const username = String(req.auth?.username || '').trim()
  const file = await ingestUploadedKnowledgeFile({ username, file: req.file })
  res.json({ ok: true, file })
})

app.post('/api/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ message: '缺少文件' })
    return
  }

  const file = await buildChatAttachmentFile({ file: req.file })
  res.json({ ok: true, file })
})

app.post('/api/chat/stream', requireAuth, async (req, res) => {
  const username = String(req.auth?.username || '').trim()
  const {
    conversationId,
    message,
    model,
    attachments = [],
    recentMessages = [],
    retrievalMode = 'hybrid',
    ragTopK,
  } = req.body || {}
  if (!conversationId || !message) {
    res.status(400).json({ message: 'conversationId 和 message 为必填' })
    return
  }

  const selection = await resolveSelectionForUser(username, model)
  if (!selection) {
    const available = await getAvailableModelsForUser(username)
    res.status(400).json({
      message: `模型不可用，请从已配置模型中选择：${available.models.join(', ')}`,
    })
    return
  }

  const { provider, model: resolvedModel } = selection

  if (!ensureUpstreamConfigured(provider)) {
    res.status(500).json({
      message: '当前模型对应上游地址未配置，请检查模型提供商配置',
    })
    return
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()
  // 发送首包注释，确保客户端尽快进入流式读取状态，避免空响应体误判
  res.write(': connected\n\n')

  const normalizedRecentMessages = normalizeHistoryMessages(recentMessages)
  const historyMessages =
    normalizedRecentMessages.length > 0
      ? normalizedRecentMessages
      : await loadConversationHistoryMessages({ username, conversationId })

  const pinnedDocIds = (attachments || [])
    .map((item) => String(item?.docId || '').trim())
    .filter(Boolean)

  // Top K 来自前端可调参数，服务端再次收敛范围避免异常输入。
  const requestTopK = (() => {
    const n = Number(ragTopK)
    if (!Number.isFinite(n)) return undefined
    return Math.min(20, Math.max(1, Math.floor(n)))
  })()
    
  const ragPayload = await ragService.retrieveContext({
    username,
    query: String(message || ''),
    pinnedDocIds,
    retrievalMode: String(retrievalMode || 'hybrid').toLowerCase(),
    topK: requestTopK,
  })

  if (ragPayload.refs.length > 0 || ragPayload.contextDocs.length > 0) {
    sendSSE(res, {
      refs: ragPayload.refs,
      contextDocs: ragPayload.contextDocs,
      retrievalModeUsed: ragPayload.retrievalModeUsed || 'none',
    })
  } else {
    sendSSE(res, {
      retrievalModeUsed: ragPayload.retrievalModeUsed || 'none',
    })
  }

  const abortController = new AbortController()

  // 仅在客户端真正中止请求时中断上游调用，避免请求完成后被误判为close
  req.on('aborted', () => {
    abortController.abort()
  })
  res.on('close', () => {
    if (!res.writableEnded) {
      abortController.abort()
    }
  })

  if (provider.mode === 'sse_json') {
    await pipeGenericSSEJSONStream({
      endpoint: provider.endpoint,
      conversationId,
      historyMessages,
      message,
      model: resolvedModel,
      apiKey: provider.apiKey,
      attachments,
      ragContext: ragPayload.promptContext,
      res,
      signal: abortController.signal,
    })
  } else if (provider.mode === 'openai' || provider.mode === 'deepseek') {
    const endpoint = provider.endpoint
    if (!endpoint) {
      sendSSE(res, { error: '上游接口地址不能为空，请检查 UPSTREAM_CHAT_URL 或 DEEPSEEK_BASE_URL 配置' })
      sendSSEDone(res)
      res.end()
      return
    }
    await pipeOpenAICompatStream({
      endpoint,
      apiKey: provider.apiKey,
      authMode: provider.authMode,
      historyMessages,
      message,
      model: resolvedModel,
      attachments,
      ragContext: ragPayload.promptContext,
      res,
      signal: abortController.signal,
    })
  } else {
    const chunks = splitSafeChunks(`不支持的 provider: ${provider.mode}`)
    for (const chunk of chunks) {
      sendSSE(res, { delta: chunk })
    }
    sendSSEDone(res)
  }

  res.end()
})

// eslint-disable-next-line no-unused-vars
app.use((error, _req, res, _next) => {
  res.status(500).json({ message: error?.message || '服务异常' })
})

async function bootstrap() {
  await initMongoDB()
  app.listen(port, () => {
    console.log(`[backend] listening on http://localhost:${port}`)
  })
}

bootstrap().catch((error) => {
  console.error('[backend] 启动失败:', error?.message || error)
  mongodbClient?.close().catch(() => null)
  process.exit(1)
})
