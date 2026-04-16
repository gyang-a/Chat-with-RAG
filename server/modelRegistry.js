// 模块说明：模型注册中心，统一管理前端展示模型与上游 provider 的映射关系。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const localSecretsPath = path.resolve(__dirname, 'modelSecrets.local.json')

function loadLocalModelSecrets() {
  // 读取本地私有密钥覆盖文件，避免把 API Key 写入仓库版本。
  try {
    if (!fs.existsSync(localSecretsPath)) return {}
    const raw = fs.readFileSync(localSecretsPath, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function toOpenAICompatEndpoint(url = '') {
  // 兼容“仅填 baseUrl”与“已是 /chat/completions 完整路径”两种配置。
  const trimmed = String(url || '').trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  if (trimmed.endsWith('/chat/completions')) return trimmed
  return `${trimmed}/chat/completions`
}

// 统一模型配置中心：
// key = 前端展示和请求使用的模型名
// value.endpoint = 模型地址（OpenAI兼容地址可填基地址或/chat/completions完整地址）
// value.apiKey = 对应模型的 API Key
// value.model 可选：实际传给上游的模型 ID（不填则默认使用 key）
// value.mode 可选：openai | deepseek | sse_json，默认 openai
// value.authMode 可选：auto | bearer | zhipu-jwt，默认 auto（sse_json 默认 bearer）
export const MODEL_CATALOG = {
  'GLM-5.1': {
    endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    apiKey: '',
    model: 'glm-5.1',
    mode: 'openai',
    authMode: 'zhipu-jwt',
  },
  'GLM-4.7-Flash': {
    endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    apiKey: '',
    model: 'glm-4.7-flash',
    mode: 'openai',
    authMode: 'zhipu-jwt',
  },
  'DeepSeek': {
    endpoint: 'https://api.deepseek.com/chat/completions',
    apiKey: '',
    model: 'deepseek-chat',
    mode: 'deepseek',
    authMode: 'bearer',
  },
  'DeepSeek-Reasoner': {
    endpoint: 'https://api.deepseek.com/chat/completions',
    apiKey: '',
    model: 'deepseek-reasoner',
    mode: 'deepseek',
    authMode: 'bearer',
  },
}

export const DEFAULT_MODEL = 'GLM-5.1'

function normalizeMode(rawMode) {
  // 归一化 provider 模式，未知值默认回退 openai。
  const mode = String(rawMode || 'openai').trim().toLowerCase()
  if (mode === 'sse_json') return 'sse_json'
  if (mode === 'deepseek') return 'deepseek'
  return 'openai'
}

export function buildModelRegistry() {
  // 构建运行时可用的模型索引与解析函数。
  const localSecrets = loadLocalModelSecrets()

  const modelEntries = Object.entries(MODEL_CATALOG)
    .map(([modelName, config]) => {
      const displayModel = modelName.trim()
      const mode = normalizeMode(config?.mode)
      const endpointRaw = String(config?.endpoint || '').trim()
      const endpoint = mode === 'sse_json' ? endpointRaw : toOpenAICompatEndpoint(endpointRaw)
      const secretApiKey = String(localSecrets?.[displayModel]?.apiKey || '').trim()
      const apiKey = secretApiKey || String(config?.apiKey || '').trim()
      const requestModel = String(config?.model || displayModel).trim()
      const authMode = String(config?.authMode || (mode === 'sse_json' ? 'bearer' : 'auto')).toLowerCase()

      if (!displayModel) return null

      return {
        modelName: displayModel,
        provider: {
          id: `model:${displayModel}`,
          mode,
          endpoint,
          apiKey,
          authMode,
          requestModel,
          defaultModel: displayModel,
          models: [displayModel],
        },
      }
    })
    .filter(Boolean)

  const modelToProvider = new Map(modelEntries.map((item) => [item.modelName, item.provider]))
  const allModels = modelEntries.map((item) => item.modelName)
  const defaultModel = modelToProvider.has(DEFAULT_MODEL) ? DEFAULT_MODEL : allModels[0] || ''
  const activeProvider = defaultModel ? modelToProvider.get(defaultModel) : null
  const providers = modelEntries.map((item) => item.provider)

  const resolveSelection = (inputModel) => {
    // 根据前端选择模型解析出 provider 配置和实际请求模型名。
    const requestedModel = String(inputModel || '').trim()
    const selectedUiModel = requestedModel || defaultModel
    const provider = modelToProvider.get(selectedUiModel)
    if (!provider) return null
    return { provider, model: provider.requestModel || selectedUiModel }
  }

  return {
    mode: activeProvider?.mode || 'openai',
    providers,
    activeProvider,
    allModels,
    defaultModel,
    resolveSelection,
  }
}
