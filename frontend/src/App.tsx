import {
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import './App.css'
import { marked } from 'marked'
marked.setOptions({ async: false })
import DOMPurify from 'dompurify'

const renderMarkdownToHtml = (src: string): string => {
  const parsed = marked.parse(src)
  return typeof parsed === 'string' ? parsed : ''
}

type Role = 'user' | 'assistant'

type Message = {
  id: string
  role: Role
  content: string
}

type ConversationSettings = {
  deepThinking: boolean
  allowWebSearch: boolean
  allowImageTool: boolean
}

type ToolEvent = {
  tool_name: string
  arguments: unknown
  result: unknown
}

type Conversation = {
  id: string
  title: string
  modeId: ModeId
  modelId: ModelId
  pinned: boolean
  archived: boolean
  messages: Message[]
  toolEvents: ToolEvent[]
  settings: ConversationSettings
  createdAt: string
  updatedAt: string
}

type StreamPayload =
  | { type: 'chunk'; delta: string }
  | { type: 'tools'; tool_events: ToolEvent[] }
  | { type: 'error'; detail: string }

type ModeId = 'default' | 'research' | 'image' | 'agent' | 'files'

type ModeConfig = {
  id: ModeId
  label: string
  icon: string
  description: string
  placeholder: string
  suggestions: string[]
  options: ConversationSettings
}

type ModelId = string

type ModelConfig = {
  id: ModelId
  name: string
  description: string
  tags: string[]
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'
const CONVERSATION_STORAGE_KEY = 'qwen-agent.conversations'
const DEFAULT_MODEL_STORAGE_KEY = 'qwen-agent.default-model'
const DEFAULT_CONVERSATION_TITLE = '新的对话'
const PREVIEW_LENGTH = 36
const DEFAULT_MODE_ID: ModeId = 'default'
const DEFAULT_MODEL_ID: ModelId = 'qwen3-max'

const MODES: ModeConfig[] = [
  {
    id: 'default',
    label: '对话',
    icon: '💬',
    description: '日常问答、写作和思路整理',
    placeholder: '询问任何问题',
    suggestions: [
      '帮我写一段产品更新公告',
      '如何向初学者解释向量数据库？',
      '总结这周团队会议的重点行动项',
    ],
    options: {
      deepThinking: false,
      allowWebSearch: true,
      allowImageTool: true,
    },
  },
  {
    id: 'research',
    label: '研究',
    icon: '📡',
    description: '长篇调研与资料搜集',
    placeholder: '你正在研究什么？',
    suggestions: [
      '为我整理当前 AI 安全领域的主要进展',
      '做一个关于电动车行业竞争格局的分析',
      '汇总无代码平台的评测文章并列出优缺点',
    ],
    options: {
      deepThinking: true,
      allowWebSearch: true,
      allowImageTool: false,
    },
  },
  {
    id: 'image',
    label: '创作图片',
    icon: '🎨',
    description: '生成插画、海报等视觉内容',
    placeholder: '描述你想要的图像',
    suggestions: [
      '创作一张宇航员拥抱橘猫的儿童绘本插画',
      '设计一个赛博朋克风格的夜市街景海报',
      '生成一张带标题的科技播客封面图',
    ],
    options: {
      deepThinking: false,
      allowWebSearch: false,
      allowImageTool: true,
    },
  },
  {
    id: 'agent',
    label: '代理模式',
    icon: '🧩',
    description: '多步骤推理与工具组合',
    placeholder: '告诉 Qwen 你要解决的复杂任务',
    suggestions: [
      '规划一次上海到北京的商务旅行行程',
      '帮我整理并对比几个开源数据标注工具',
      '用步骤说明如何搭建一个个人知识库',
    ],
    options: {
      deepThinking: true,
      allowWebSearch: true,
      allowImageTool: true,
    },
  },
  {
    id: 'files',
    label: '文件助手',
    icon: '📎',
    description: '上传文件后进行分析和总结',
    placeholder: '先描述你想处理的文件内容',
    suggestions: [
      '总结一下会议纪要的重点行动项',
      '帮我提炼这份财报需要关注的指标',
      '分析市场调研问卷并提炼洞察',
    ],
    options: {
      deepThinking: true,
      allowWebSearch: false,
      allowImageTool: false,
    },
  },
]

const FEATURE_ACTIONS = [
  { label: '上传文档', icon: '📎' },
]

const MODE_MAP = MODES.reduce<Record<ModeId, ModeConfig>>((acc, mode) => {
  acc[mode.id] = mode
  return acc
}, {} as Record<ModeId, ModeConfig>)

const MODELS: ModelConfig[] = [
  {
    id: 'qwen3-max',
    name: 'Qwen3-Max',
    description: '旗舰模型，兼顾复杂任务与创作场景。',
    tags: ['旗舰', '综合', '多模态'],
  },
  {
    id: 'qwen2.5-72b',
    name: 'Qwen2.5-72B',
    description: '超大参数量，更擅长复杂推理与代码。',
    tags: ['推理', '代码'],
  },
  {
    id: 'qwen2.5-32b',
    name: 'Qwen2.5-32B',
    description: '平衡性能与成本，适合日常办公与总结。',
    tags: ['办公', '总结'],
  },
  {
    id: 'qwen2.5-coder',
    name: 'Qwen2.5-Coder',
    description: '针对编程任务优化，代码生成与解读体验更佳。',
    tags: ['代码', '重构'],
  },
]



// 当模型列表更新后，若默认或当前会话模型不在新列表中，则回退到首个模型


const generateId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const loadDefaultModelId = (): ModelId => {
  if (typeof window === 'undefined') return DEFAULT_MODEL_ID
  const stored = window.localStorage.getItem(DEFAULT_MODEL_STORAGE_KEY)
  if (stored) {
    return stored as ModelId
  }
  return DEFAULT_MODEL_ID
}

const sanitizeSettings = (
  value: unknown,
  fallback: ConversationSettings
): ConversationSettings => {
  if (!value || typeof value !== 'object') {
    return { ...fallback }
  }
  const data = value as Record<string, unknown>
  return {
    deepThinking:
      typeof data.deepThinking === 'boolean'
        ? data.deepThinking
        : fallback.deepThinking,
    allowWebSearch:
      typeof data.allowWebSearch === 'boolean'
        ? data.allowWebSearch
        : fallback.allowWebSearch,
    allowImageTool:
      typeof data.allowImageTool === 'boolean'
        ? data.allowImageTool
        : fallback.allowImageTool,
  }
}

const sanitizeMessages = (value: unknown): Message[] => {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (
      item &&
      typeof item === 'object' &&
      'role' in item &&
      'content' in item &&
      typeof (item as { role: unknown }).role === 'string' &&
      typeof (item as { content: unknown }).content === 'string'
    ) {
      const roleValue = (item as { role: string }).role
      if (roleValue === 'user' || roleValue === 'assistant') {
        return [
          {
            id:
              typeof (item as { id?: unknown }).id === 'string'
                ? ((item as { id: string }).id ?? generateId())
                : generateId(),
            role: roleValue,
            content: (item as { content: string }).content,
          } satisfies Message,
        ]
      }
    }
    return []
  })
}

const sanitizeToolEvents = (value: unknown): ToolEvent[] => {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (item && typeof item === 'object' && 'tool_name' in item) {
      const event = item as Record<string, unknown>
      if (typeof event.tool_name === 'string') {
        return [
          {
            tool_name: event.tool_name,
            arguments: event.arguments ?? {},
            result: event.result ?? '',
          } satisfies ToolEvent,
        ]
      }
    }
    return []
  })
}

const createConversation = (overrides?: Partial<Conversation>): Conversation => {
  const now = new Date().toISOString()
  const modeId = overrides?.modeId ?? DEFAULT_MODE_ID
  const mode = MODE_MAP[modeId] ?? MODE_MAP[DEFAULT_MODE_ID]
  const defaultModelId = overrides?.modelId ?? loadDefaultModelId()
  const model = MODELS.find((m) => m.id === defaultModelId)
    ?? MODELS.find((m) => m.id === DEFAULT_MODEL_ID)
    ?? MODELS[0]

  return {
    id: overrides?.id ?? generateId(),
    title: overrides?.title ?? DEFAULT_CONVERSATION_TITLE,
    modeId,
    modelId: model.id,
    pinned: overrides?.pinned ?? false,
    archived: overrides?.archived ?? false,
    messages: overrides?.messages ?? [],
    toolEvents: overrides?.toolEvents ?? [],
    settings: sanitizeSettings(overrides?.settings, { ...mode.options, allowWebSearch: false }),
    createdAt: overrides?.createdAt ?? now,
    updatedAt: overrides?.updatedAt ?? now,
  }
}

const loadStoredConversations = (): Conversation[] => {
  if (typeof window === 'undefined') return []
  const raw = window.localStorage.getItem(CONVERSATION_STORAGE_KEY)
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    return parsed
      .map((item) => {
        if (!item || typeof item !== 'object') return null
        const data = item as Record<string, unknown>
        const modeIdValue =
          typeof data.modeId === 'string' && data.modeId in MODE_MAP
            ? (data.modeId as ModeId)
            : DEFAULT_MODE_ID
        const mode = MODE_MAP[modeIdValue] ?? MODE_MAP[DEFAULT_MODE_ID]
        const createdAt =
          typeof data.createdAt === 'string' && !Number.isNaN(Date.parse(data.createdAt))
            ? (data.createdAt as string)
            : new Date().toISOString()
        const updatedAt =
          typeof data.updatedAt === 'string' && !Number.isNaN(Date.parse(data.updatedAt))
            ? (data.updatedAt as string)
            : createdAt
        const modelIdValue =
          typeof data.modelId === 'string'
            ? (data.modelId as ModelId)
            : DEFAULT_MODEL_ID

        return createConversation({
          id:
            typeof data.id === 'string' && data.id
              ? (data.id as string)
              : generateId(),
          title:
            typeof data.title === 'string' && data.title.trim()
              ? (data.title as string)
              : DEFAULT_CONVERSATION_TITLE,
          modeId: mode.id,
          modelId: modelIdValue,
          pinned: typeof data.pinned === 'boolean' ? (data.pinned as boolean) : false,
          archived:
            typeof data.archived === 'boolean' ? (data.archived as boolean) : false,
          messages: sanitizeMessages(data.messages),
          toolEvents: sanitizeToolEvents(data.toolEvents),
          settings: sanitizeSettings(data.settings, mode.options),
          createdAt,
          updatedAt,
        })
      })
      .filter((conversation): conversation is Conversation => conversation !== null)
  } catch {
    return []
  }
}

const conversationDisplayTitle = (conversation: Conversation): string => {
  return conversation.title.trim() || DEFAULT_CONVERSATION_TITLE
}

const conversationPreview = (conversation: Conversation): string => {
  if (conversation.messages.length === 0) return '暂未开始对话'
  const lastMessage = conversation.messages[conversation.messages.length - 1]
  const cleaned = lastMessage.content.trim().replace(/\s+/g, ' ')
  if (!cleaned) return ''
  if (cleaned.length <= PREVIEW_LENGTH) return cleaned
  return `${cleaned.slice(0, PREVIEW_LENGTH)}…`
}

const encodeOptions = (settings: ConversationSettings) => ({
  deep_thinking: settings.deepThinking,
  allow_web_search: settings.allowWebSearch,
  allow_image_tool: settings.allowImageTool,
})

function App() {
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    const stored = loadStoredConversations()
    if (stored.length > 0) return stored
    return [createConversation()]
  })
  const [models, setModels] = useState<ModelConfig[]>(MODELS)
useEffect(() => {
  let cancelled = false
  ;(async () => {
    try {
      const resp = await fetch(`${API_BASE}/api/models`)
      if (!resp.ok) return
      const data = (await resp.json()) as { models: Array<{ id: string; name?: string; description?: string; tags?: string[] }> }
      const fetched: ModelConfig[] = (data?.models ?? []).map((m) => ({
        id: String(m.id),
        name: String(m.name ?? m.id ?? 'unknown'),
        description: String(m.description ?? ''),
        tags: Array.isArray(m.tags) ? m.tags.map(String) : [],
      }))
      if (!cancelled && fetched.length > 0) {
        setModels(fetched)
      }
    } catch {
      // ignore, keep fallback MODELS
    }
  })()
  return () => { cancelled = true }
}, [])

const modelMap = useMemo(() => {
  return models.reduce((acc, m) => {
    acc[m.id] = m
    return acc
  }, {} as Record<ModelId, ModelConfig>)
}, [models])

// 当模型列表更新后，若默认或当前会话模型不在新列表中，则回退到首个模型


const [defaultModelId, setDefaultModelId] = useState<ModelId>(() => loadDefaultModelId())
  const [activeConversationId, setActiveConversationId] = useState<string>(
    () => conversations[0]?.id ?? ''
  )
  const [searchTerm, setSearchTerm] = useState('')
  const [input, setInput] = useState('')
  const [isModeMenuOpen, setIsModeMenuOpen] = useState(false)
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false)
  const [isFeatureMenuOpen, setIsFeatureMenuOpen] = useState(false)
  const [openConversationMenuId, setOpenConversationMenuId] = useState<string | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const messageEndRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const modeBtnRef = useRef<HTMLButtonElement | null>(null)
  const modelMenuRef = useRef<HTMLDivElement | null>(null)
  const modelBtnRef = useRef<HTMLButtonElement | null>(null)
  const featureBtnRef = useRef<HTMLButtonElement | null>(null)
  const featureMenuRef = useRef<HTMLDivElement | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const streamingConversationRef = useRef<string | null>(null)
  const streamingAssistantMessageRef = useRef<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(
      CONVERSATION_STORAGE_KEY,
      JSON.stringify(conversations)
    )
  }, [conversations])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(DEFAULT_MODEL_STORAGE_KEY, defaultModelId)
  }, [defaultModelId])

  useEffect(() => {
    if (!isModeMenuOpen) return
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node
      if (
        menuRef.current &&
        !menuRef.current.contains(target) &&
        modeBtnRef.current &&
        !modeBtnRef.current.contains(target)
      ) {
        setIsModeMenuOpen(false)
      }
    }
    window.addEventListener('click', handleClick)
    return () => window.removeEventListener('click', handleClick)
  }, [isModeMenuOpen])

  useEffect(() => {
    if (!isModelMenuOpen) return
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node
      if (
        modelMenuRef.current &&
        !modelMenuRef.current.contains(target) &&
        modelBtnRef.current &&
        !modelBtnRef.current.contains(target)
      ) {
        setIsModelMenuOpen(false)
      }
    }
    window.addEventListener('click', handleClick)
    return () => window.removeEventListener('click', handleClick)
  }, [isModelMenuOpen])

  useEffect(() => {
    if (!openConversationMenuId) return
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Element | null
      if (
        target &&
        (target.closest('.conversation-menu') ||
          target.closest('.conversation-menu-trigger'))
      ) {
        return
      }
      setOpenConversationMenuId(null)
    }
    window.addEventListener('click', handleClick)
    return () => window.removeEventListener('click', handleClick)
  }, [openConversationMenuId])

  useEffect(() => {
    if (!isFeatureMenuOpen) return
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node
      if (
        featureMenuRef.current &&
        !featureMenuRef.current.contains(target) &&
        featureBtnRef.current &&
        !featureBtnRef.current.contains(target)
      ) {
        setIsFeatureMenuOpen(false)
      }
    }
    window.addEventListener('click', handleClick)
    return () => window.removeEventListener('click', handleClick)
  }, [isFeatureMenuOpen])

  useEffect(() => {
    requestAnimationFrame(() => {
      messageEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    })
  }, [activeConversationId, conversations, isStreaming])

  useEffect(() => {
    setError(null)
  }, [activeConversationId])

  useEffect(() => {
    if (!info) return
    const timer = setTimeout(() => setInfo(null), 2000)
    return () => clearTimeout(timer)
  }, [info])

  const activeConversation = useMemo(
    () => conversations.find((item) => item.id === activeConversationId) ?? null,
    [conversations, activeConversationId]
  )

  // 校验并在模型列表变化后做回退，需位于 activeConversation 定义之后，避免 TDZ
  useEffect(() => {
    const firstId = models[0]?.id
    if (!firstId) return
    const stored = localStorage.getItem(DEFAULT_MODEL_STORAGE_KEY)
    if (stored && !modelMap[stored]) {
      localStorage.setItem(DEFAULT_MODEL_STORAGE_KEY, firstId)
      setDefaultModelId(firstId)
    }
    if (activeConversation && !modelMap[activeConversation.modelId]) {
      handleModelChange(firstId)
    }
  }, [models, modelMap, activeConversation])

  const currentModel = useMemo(() => {
    if (!activeConversation) return modelMap[DEFAULT_MODEL_ID] ?? models[0] ?? MODELS[0]
    return modelMap[activeConversation.modelId] ?? modelMap[DEFAULT_MODEL_ID] ?? models[0] ?? MODELS[0]
  }, [activeConversation, modelMap, models])

  const currentMode = useMemo(() => {
    if (!activeConversation) return MODE_MAP[DEFAULT_MODE_ID]
    return MODE_MAP[activeConversation.modeId] ?? MODE_MAP[DEFAULT_MODE_ID]
  }, [activeConversation])

  const messages = activeConversation?.messages ?? []

  const splitAssistantContent = (text: string) => {
    const finalPattern = /(Final\s*Answer|最终回答|最终答案|答案)\s*[:：]?/i
    const match = finalPattern.exec(text)
    if (!match) {
      return { thought: '', final: text.trim() }
    }
    const thought = text.slice(0, match.index).trim()
    const final = text.slice(match.index + match[0].length).trim()
    return { thought, final }
  }
  const latestToolEvents = activeConversation?.toolEvents ?? []
  const hasMessages = messages.length > 0

  const renderObservation = (data: unknown) => {
    if (typeof data === 'string') {
      return <pre className="thinking-pre">{data}</pre>
    }
    try {
      const obj = data as any
      if (obj && Array.isArray(obj.results)) {
        return (
          <div className="kb-results">
            {obj.results.map((item: any, i: number) => (
              <div key={`kb-${i}`} className="kb-result">
                {'title' in item && <div className="kb-title">{String(item.title)}</div>}
                {'content' in item && (
                  <div className="kb-content">{String(item.content)}</div>
                )}
                <div className="kb-meta">
                  {'id' in item && <span>id: {String(item.id)}</span>}
                  {'score' in item && <span>score: {String(item.score)}</span>}
                </div>
              </div>
            ))}
          </div>
        )
      }
    } catch {}
    return <pre className="thinking-pre">{JSON.stringify(data, null, 2)}</pre>
  }

  const filteredConversations = useMemo(() => {
    const search = searchTerm.trim().toLowerCase()
    const matches = conversations.filter((conversation) => {
      if (!search) return true
      const title = conversationDisplayTitle(conversation).toLowerCase()
      const preview = conversationPreview(conversation).toLowerCase()
      return title.includes(search) || preview.includes(search)
    })
    return matches.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      if (a.archived !== b.archived) return a.archived ? 1 : -1
      return Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
    })
  }, [conversations, searchTerm])

  const updateConversation = (
    conversationId: string,
    updater: (conversation: Conversation) => Conversation
  ) => {
    setConversations((prev) =>
      prev.map((conversation) =>
        conversation.id === conversationId ? updater(conversation) : conversation
      )
    )
  }

  const appendAssistantContent = (
    conversationId: string,
    messageId: string,
    delta: string
  ) => {
    if (!delta) return
    updateConversation(conversationId, (conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) =>
        message.id === messageId && message.role === 'assistant'
          ? { ...message, content: message.content + delta }
          : message
      ),
    }))
  }

  const setAssistantMessage = (
    conversationId: string,
    messageId: string,
    content: string
  ) => {
    updateConversation(conversationId, (conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) =>
        message.id === messageId && message.role === 'assistant'
          ? { ...message, content }
          : message
      ),
    }))
  }

  const appendToolEvents = (conversationId: string, events: ToolEvent[]) => {
    if (events.length === 0) return
    updateConversation(conversationId, (conversation) => ({
      ...conversation,
      toolEvents: [...conversation.toolEvents, ...events],
    }))
  }

  const stopStreaming = () => {
    controllerRef.current?.abort()
    controllerRef.current = null
    streamingConversationRef.current = null
    streamingAssistantMessageRef.current = null
  }

  const handleCreateConversation = () => {
    const newConversation = createConversation({ modelId: defaultModelId })
    setConversations((prev) => [newConversation, ...prev])
    setActiveConversationId(newConversation.id)
    setInput('')
    setError(null)
    setIsModeMenuOpen(false)
    setIsModelMenuOpen(false)
    setIsFeatureMenuOpen(false)
    setOpenConversationMenuId(null)
    stopStreaming()
  }

  const handleSelectConversation = (conversationId: string) => {
    if (conversationId === activeConversationId) return
    stopStreaming()
    setActiveConversationId(conversationId)
    setInput('')
    setError(null)
    setIsModeMenuOpen(false)
    setIsModelMenuOpen(false)
    setIsFeatureMenuOpen(false)
    setOpenConversationMenuId(null)
  }

  const handleModeChange = (modeId: ModeId) => {
    if (!activeConversation) return
    if (activeConversation.modeId === modeId) {
      setIsModeMenuOpen(false)
      setIsFeatureMenuOpen(false)
      return
    }
    const mode = MODE_MAP[modeId] ?? MODE_MAP[DEFAULT_MODE_ID]
    updateConversation(activeConversation.id, (conversation) => ({
      ...conversation,
      modeId: mode.id,
      settings: sanitizeSettings(mode.options, mode.options),
      updatedAt: new Date().toISOString(),
    }))
    setIsModeMenuOpen(false)
    setIsFeatureMenuOpen(false)
    setOpenConversationMenuId(null)
  }

  const handleModelChange = (modelId: ModelId) => {
    if (!activeConversation) return
    if (activeConversation.modelId === modelId) {
      setIsModelMenuOpen(false)
      return
    }
    updateConversation(activeConversation.id, (conversation) => ({
      ...conversation,
      modelId,
      updatedAt: new Date().toISOString(),
    }))
    setIsModelMenuOpen(false)
    setOpenConversationMenuId(null)
  }

  const handleSetDefaultModel = (modelId: ModelId) => {
    setDefaultModelId(modelId)
    setIsModelMenuOpen(false)
  }

  const handleDeleteConversation = () => {
    if (!activeConversation) return
    handleDeleteConversationById(activeConversation.id)
  }

  const handleDeleteConversationById = (conversationId: string) => {
    const target = conversations.find((item) => item.id === conversationId)
    if (!target) {
      setOpenConversationMenuId(null)
      return
    }
    const confirmed =
      typeof window !== 'undefined'
        ? window.confirm(`确定要删除「${conversationDisplayTitle(target)}」对话吗？`)
        : true
    if (!confirmed) {
      setOpenConversationMenuId(null)
      return
    }

    if (conversationId === activeConversationId) {
      stopStreaming()
      setError(null)
      setInput('')
    }

    setIsModeMenuOpen(false)
    setIsModelMenuOpen(false)
    setIsFeatureMenuOpen(false)
    setOpenConversationMenuId(null)

    setConversations((prev) => {
      const remaining = prev.filter((conversation) => conversation.id !== conversationId)
      if (remaining.length === 0) {
        const fresh = createConversation({ modelId: defaultModelId })
        setActiveConversationId(fresh.id)
        return [fresh]
      }

      if (activeConversationId === conversationId) {
        const fallback =
          remaining.find((conversation) => !conversation.archived) ?? remaining[0]
        setActiveConversationId(fallback.id)
      }
      return remaining
    })
  }

  const handleSuggestionClick = (value: string) => {
    setInput(value)
    setIsFeatureMenuOpen(false)
  }

  const copyConversationTranscript = async (conversation: Conversation) => {
    const transcript = conversation.messages
      .map((message) => {
        const speaker = message.role === 'user' ? '你' : 'Qwen'
        return `【${speaker}】\n${message.content}`
      })
      .join('\n\n')
      .trim()

    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(transcript || '暂未开始对话')
      } else {
        throw new Error('Clipboard unavailable')
      }
    } catch (clipError) {
      console.warn('Clipboard copy failed', clipError)
      if (typeof window !== 'undefined') {
        window.prompt('复制对话内容', transcript || '暂未开始对话')
      }
    }
  }

  const handleTogglePinConversation = (conversationId: string) => {
    const now = new Date().toISOString()
    updateConversation(conversationId, (conversation) => ({
      ...conversation,
      pinned: !conversation.pinned,
      updatedAt: now,
    }))
    setOpenConversationMenuId(null)
  }

  const handleRenameConversation = (conversationId: string) => {
    const target = conversations.find((item) => item.id === conversationId)
    if (!target) return
    const nextTitle =
      typeof window !== 'undefined'
        ? window.prompt('输入新的对话标题', conversationDisplayTitle(target))
        : null
    if (nextTitle === null) return
    const trimmed = nextTitle.trim()
    updateConversation(conversationId, (conversation) => ({
      ...conversation,
      title: trimmed || DEFAULT_CONVERSATION_TITLE,
      updatedAt: new Date().toISOString(),
    }))
    setOpenConversationMenuId(null)
  }

  const handleDuplicateConversation = (conversationId: string) => {
    const source = conversations.find((item) => item.id === conversationId)
    if (!source) return
    const now = new Date().toISOString()
    const duplicateMessages = source.messages.map((message) => ({
      ...message,
      id: generateId(),
    }))
    const duplicate = createConversation({
      title: `${conversationDisplayTitle(source)} (副本)`,
      modeId: source.modeId,
      modelId: source.modelId,
      messages: duplicateMessages,
      toolEvents: [...source.toolEvents],
      settings: source.settings,
      createdAt: now,
      updatedAt: now,
    })
    setConversations((prev) => [duplicate, ...prev])
    setActiveConversationId(duplicate.id)
    setOpenConversationMenuId(null)
  }

  const handleArchiveConversation = (conversationId: string) => {
    setConversations((prev) => {
      const target = prev.find((item) => item.id === conversationId)
      if (!target) return prev
      const willArchive = !target.archived
      const now = new Date().toISOString()
      const updated = prev.map((conversation) =>
        conversation.id === conversationId
          ? { ...conversation, archived: willArchive, updatedAt: now }
          : conversation
      )
      if (willArchive && activeConversationId === conversationId) {
        const fallback = updated.find(
          (conversation) => conversation.id !== conversationId && !conversation.archived
        )
        if (fallback) {
          setActiveConversationId(fallback.id)
          return updated
        }
        const fresh = createConversation({ modelId: defaultModelId })
        setActiveConversationId(fresh.id)
        return [fresh, ...updated]
      }
      return updated
    })
    setOpenConversationMenuId(null)
  }

  const handleShareConversation = async (conversationId: string) => {
    const target = conversations.find((item) => item.id === conversationId)
    if (!target) return
    await copyConversationTranscript(target)
    if (typeof window !== 'undefined') {
      window.alert('对话内容已复制到剪贴板。')
    }
    setOpenConversationMenuId(null)
  }

  const handleDownloadConversation = (conversationId: string) => {
    const target = conversations.find((item) => item.id === conversationId)
    if (!target) return

    const filenameBase = conversationDisplayTitle(target)
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 40)
    const filename = `${filenameBase || 'conversation'}.json`

    const blob = new Blob([JSON.stringify(target, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    setOpenConversationMenuId(null)
  }

  const handleToggleDeepThinking = () => {
    if (!activeConversation || isStreaming) return
    const next = !activeConversation.settings.deepThinking
    updateConversation(activeConversation.id, (conversation) => ({
      ...conversation,
      settings: { ...conversation.settings, deepThinking: next },
      updatedAt: new Date().toISOString(),
    }))
  }

  const handleToggleWebSearch = () => {
    if (!activeConversation || isStreaming) return
    const next = !activeConversation.settings.allowWebSearch
    updateConversation(activeConversation.id, (conversation) => ({
      ...conversation,
      settings: { ...conversation.settings, allowWebSearch: next },
      updatedAt: new Date().toISOString(),
    }))
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void sendMessage()
    }
  }

  const sendMessage = async () => {
    if (!activeConversation || isStreaming) return
    const trimmed = input.trim()
    if (!trimmed) return

    const conversationId = activeConversation.id
    const now = new Date().toISOString()
    const userMessage: Message = {
      id: generateId(),
      role: 'user',
      content: trimmed,
    }
    const assistantMessageId = generateId()
    const assistantPlaceholder: Message = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
    }
    const requestMessages = [
      ...activeConversation.messages,
      userMessage,
    ].map((message) => ({
      role: message.role,
      content: message.content,
    }))

    updateConversation(conversationId, (conversation) => {
      const shouldUpdateTitle =
        conversation.title === DEFAULT_CONVERSATION_TITLE ||
        conversation.messages.length === 0
      return {
        ...conversation,
        title: shouldUpdateTitle
          ? conversationPreview({
              ...conversation,
              messages: [...conversation.messages, userMessage],
            }) || DEFAULT_CONVERSATION_TITLE
          : conversation.title,
        messages: [...conversation.messages, userMessage, assistantPlaceholder],
        updatedAt: now,
      }
    })

    setInput('')
    setError(null)
    setIsStreaming(true)
    streamingConversationRef.current = conversationId
    streamingAssistantMessageRef.current = assistantMessageId
    setIsFeatureMenuOpen(false)

    const controller = new AbortController()
    controllerRef.current = controller

    try {
      const response = await fetch(`${API_BASE}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: activeConversation.modelId,
          mode: activeConversation.modeId,
          messages: requestMessages,
          options: { ...encodeOptions(activeConversation.settings), deep_thinking: activeConversation.settings.deepThinking, enable_search: activeConversation.settings.allowWebSearch },
        }),
        signal: controller.signal,
      })

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.detail ?? response.statusText)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder('utf-8')
      let buffer = ''
      const collectedToolEvents: ToolEvent[] = []
      let finished = false

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        let boundary = buffer.indexOf('\n\n')
        while (boundary !== -1) {
          const rawChunk = buffer.slice(0, boundary).trim()
          buffer = buffer.slice(boundary + 2)

          if (rawChunk.startsWith('data:')) {
            const data = rawChunk.slice(5).trim()
            if (data === '[DONE]') {
              buffer = ''
              finished = true
              boundary = -1
              break
            }

            try {
              const payload = JSON.parse(data) as StreamPayload
              if (
                payload.type === 'chunk' &&
                streamingConversationRef.current === conversationId &&
                streamingAssistantMessageRef.current === assistantMessageId
              ) {
                appendAssistantContent(conversationId, assistantMessageId, payload.delta)
              } else if (payload.type === 'tools') {
                collectedToolEvents.push(...sanitizeToolEvents(payload.tool_events))
              } else if (payload.type === 'error') {
                throw new Error(payload.detail ?? 'Streaming error')
              }
            } catch (streamErr) {
              console.error('Failed to parse stream payload', streamErr)
            }
          }

          boundary = buffer.indexOf('\n\n')
        }

        if (finished) break
      }

      reader.releaseLock()

      if (!finished && buffer.trim().length > 0 && buffer.startsWith('data:')) {
        const data = buffer.slice(5).trim()
        if (data !== '[DONE]') {
          try {
            const payload = JSON.parse(data) as StreamPayload
            if (
              payload.type === 'chunk' &&
              streamingConversationRef.current === conversationId &&
              streamingAssistantMessageRef.current === assistantMessageId
            ) {
              appendAssistantContent(conversationId, assistantMessageId, payload.delta)
            } else if (payload.type === 'tools') {
              collectedToolEvents.push(...sanitizeToolEvents(payload.tool_events))
            }
          } catch (streamErr) {
            console.error('Failed to parse trailing payload', streamErr)
          }
        }
      }

      if (collectedToolEvents.length > 0) {
        appendToolEvents(conversationId, collectedToolEvents)
      }
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') {
        setError('已停止当前回答。')
        setAssistantMessage(conversationId, assistantMessageId, '回答已停止。')
      } else {
        const detail = err instanceof Error ? err.message : 'Unexpected error'
        setError(detail)
        setAssistantMessage(
          conversationId,
          assistantMessageId,
          `抱歉，发生错误：${detail}`
        )
      }
    } finally {
      setIsStreaming(false)
      controllerRef.current = null
      streamingConversationRef.current = null
      streamingAssistantMessageRef.current = null
    }
  }

  const greetingText = hasMessages ? '继续探索下一个问题吧。' : '在时刻准备着。'

  const mainPanelClass = `main-panel${hasMessages ? '' : ' empty'}`

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-top">
          <div className="brand">
            <span className="brand-mark">Q</span>
            <span className="brand-name">Qwen</span>
          </div>
          <button className="sidebar-icon" type="button" aria-label="设置">
            ⚙️
          </button>
        </div>

        <button className="new-chat-btn" type="button" onClick={handleCreateConversation}>
          <span>＋ 新建对话</span>
        </button>

        <div className="sidebar-search">
          <input
            placeholder="搜索对话"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </div>

        <div className="conversation-nav">
          <p className="nav-title">所有对话</p>
          {filteredConversations.length === 0 ? (
            <div className="conversation-empty">
              {conversations.length === 0
                ? '尚无对话，点击“新建对话”开始。'
                : '没有匹配的对话。'}
            </div>
          ) : (
            <ul className="conversation-list">
              {filteredConversations.map((conversation) => {
                const isActive = conversation.id === activeConversationId
                const isMenuOpen = openConversationMenuId === conversation.id
                return (
                  <li key={conversation.id} className="conversation-list-item">
                    <div
                      className={`conversation-item${isActive ? ' active' : ''}${
                        conversation.archived ? ' archived' : ''
                      }`}
                    >
                      <button
                        type="button"
                        className="conversation-main"
                        onClick={() => handleSelectConversation(conversation.id)}
                      >
                        <span className="conversation-title">
                          {conversationDisplayTitle(conversation)}
                          {conversation.pinned && (
                            <span className="conversation-pin" aria-label="已置顶">
                              📌
                            </span>
                          )}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="conversation-menu-trigger"
                        onClick={() =>
                          setOpenConversationMenuId((prev) =>
                            prev === conversation.id ? null : conversation.id
                          )
                        }
                        aria-label="更多操作"
                      >
                        ⋯
                      </button>
                      {isMenuOpen && (
                        <div className="conversation-menu">
                          <button
                            type="button"
                            onClick={() => handleTogglePinConversation(conversation.id)}
                          >
                            {conversation.pinned ? '取消置顶' : '置顶'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRenameConversation(conversation.id)}
                          >
                            重命名
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDuplicateConversation(conversation.id)}
                          >
                            复制
                          </button>
                          <button
                            type="button"
                            onClick={() => handleArchiveConversation(conversation.id)}
                          >
                            {conversation.archived ? '取消归档' : '归档'}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleShareConversation(conversation.id)}
                          >
                            分享
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDownloadConversation(conversation.id)}
                          >
                            下载
                          </button>
                          <button
                            type="button"
                            className="danger"
                            onClick={() => handleDeleteConversationById(conversation.id)}
                          >
                            删除
                          </button>
                        </div>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </aside>

      <div className={mainPanelClass}>
        <div className="content-container">
          <div className="model-banner">
            <div className="model-switcher">
              <button
                ref={modelBtnRef}
                type="button"
                className="model-trigger"
                onClick={() => setIsModelMenuOpen((prev) => !prev)}
              >
                <div className="model-trigger-info">
                  <span className="model-trigger-name">{currentModel.name}</span>
                  <span className="model-trigger-sub">
                    {currentModel.id === defaultModelId ? '默认模型' : '当前对话'}
                  </span>
                </div>
                <span className="model-trigger-chevron">⌄</span>
              </button>
              {isModelMenuOpen && (
                <div ref={modelMenuRef} className="model-menu">
                  <header className="model-menu-header">
                    <span>选择模型</span>
                    <button
                      type="button"
                      className="model-default-btn"
                      onClick={() => handleSetDefaultModel(currentModel.id)}
                      disabled={currentModel.id === defaultModelId}
                    >
                      设为默认
                    </button>
                  </header>
                  <div className="model-list">
                    {(models.length > 0 ? models : MODELS).map((model) => {
                      const isActive = model.id === currentModel.id
                      const isDefault = model.id === defaultModelId
                      return (
                        <button
                          key={model.id}
                          type="button"
                          className={`model-option${isActive ? ' active' : ''}`}
                          onClick={() => handleModelChange(model.id)}
                        >
                          <div className="model-option-header">
                            <span className="model-option-name">{model.name}</span>
                            {isDefault && <span className="model-badge">默认</span>}
                          </div>
                          <span className="model-option-desc">{model.description}</span>
                          <div className="model-option-tags">
                            {model.tags.map((tag) => (
                              <span key={`${model.id}-${tag}`} className="model-tag">
                                {tag}
                              </span>
                            ))}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="main-header">
            <div className="header-row">
              <div className="header-text">
                <h1 className="header-title">{greetingText}</h1>
                <p className="header-subtitle">
                  {currentMode.description}。在这里和 Qwen 对话、创作或进行快速研究。
                </p>
              </div>
            </div>
          </div>

          <main className={`conversation ${hasMessages ? 'has-messages' : ''}`}>
        {messages.map((message) => (
          <div key={message.id} className={`bubble ${message.role}`}>
            <span className="bubble-role">
              {message.role === 'user' ? '你' : 'Qwen'}
            </span>
            <div className="bubble-content">
              {message.role === 'assistant' ? (
                (() => {
                  const parts = splitAssistantContent(message.content)
                  return (
                    <div className="assistant-content">
                      {activeConversation?.settings.deepThinking && parts.thought && (
                        <details className="assistant-thought">
                          <summary className="assistant-thought-header">
                            <span className="assistant-thought-icon">●</span>
                            <span className="assistant-thought-label">{parts.final ? '思考完成' : '正在思考...'}</span>
                          </summary>
                          <div className="assistant-thought-body">
                            {parts.thought.split('\n').map((line, index) => (
                              <p key={`${message.id}-thought-${index}`}>{line}</p>
                            ))}
                          </div>
                        </details>
                      )}
                      {parts.final && (
                        <div className="assistant-final">
                          <div className="assistant-final-label">最终回答</div>
                          <div
                            className="assistant-final-md"
                            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(renderMarkdownToHtml(parts.final)) }}
                          />
                        </div>
                      )}
                    {(!parts.final && !parts.thought && isStreaming && messages.length > 0 && messages[messages.length - 1].id === message.id) && (
                        <div className="assistant-typing"><span className="typing-indicator"><span /><span /><span /></span><p>正在生成回答…</p></div>
                      )}
                    </div>
                  )
                })()
              ) : (
                message.content.split('\\n').map((line, index) => (
                  <p key={`${message.id}-${index}`}>{line}</p>
                ))
              )}
            </div>
          </div>
        ))}
            {false && (
              <div className="bubble assistant thinking">
                <span className="bubble-role">Qwen</span>
                <div className="bubble-content">
                  <span className="typing-indicator">
                    <span />
                    <span />
                    <span />
                  </span>
                  <p>正在生成回答…</p>
                </div>
              </div>
            )}
            <div ref={messageEndRef} />
          </main>


          <footer className="composer-area">
            <div className="prompt-wrapper">
              <div className="prompt-bar">
                <div className="prompt-top">
                  <button
                    ref={featureBtnRef}
                    type="button"
                    className="prompt-prefix"
                    onClick={() => setIsFeatureMenuOpen((prev) => !prev)}
                    aria-label="选择功能"
                  >
                    ＋
                  </button>
                  <input
                    id="docUploadInput"
                    type="file"
                    style={{ display: 'none' }}
                    accept="application/pdf,.pdf,.doc,.docx,.txt,.md,.rtf,.ppt,.pptx,.xls,.xlsx"
                    multiple
                    onChange={(event) => {
                      const files = event.target.files
                      if (!files || files.length === 0) return
                      const names = Array.from(files).map((f) => f.name).join(', ')

                      setIsFeatureMenuOpen(false)
                      event.target.value = ''
                    }}
                  />
                  <input
                    id="imageUploadInput"
                    type="file"
                    style={{ display: 'none' }}
                    accept="image/*"
                    multiple
                    onChange={(event) => {
                      const files = event.target.files
                      if (!files || files.length === 0) return
                      const names = Array.from(files).map((f) => f.name).join(', ')

                      setIsFeatureMenuOpen(false)
                      event.target.value = ''
                    }}
                  />
                  <textarea
                    className="prompt-input"
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={currentMode.placeholder || '询问任何问题'}
                    disabled={isStreaming}
                  />
                  <div className="prompt-actions">
                    {isStreaming ? (
                      <button
                        type="button"
                        className="action-btn stop"
                        onClick={stopStreaming}
                        aria-label="停止生成"
                      >
                        ⏹
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="action-btn voice"
                        onClick={() => void sendMessage()}
                        disabled={input.trim().length === 0}
                        aria-label="语音发送"
                      >
                        🎙
                      </button>
                    )}
                  </div>
                </div>
                <div className="prompt-tools">
                  <button
                    type="button"
                    className={`toggle-chip${activeConversation?.settings.deepThinking ? ' active' : ''}`}
                    onClick={handleToggleDeepThinking}
                  >
                    深度思考
                  </button>
                  <button
                    type="button"
                    className={`toggle-chip${activeConversation?.settings.allowWebSearch ? ' active' : ''}`}
                    onClick={handleToggleWebSearch}
                  >
                    搜索
                  </button>
                </div>
              </div>

              {isFeatureMenuOpen && (
                <div ref={featureMenuRef} className="feature-menu">
                  {FEATURE_ACTIONS.map((action) => (
                    <button
                      key={action.label}
                      type="button"
                      onClick={() => document.getElementById('docUploadInput')?.click()}
                    >
                      <span className="feature-icon">{action.icon}</span>
                      <span className="feature-label">{action.label}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => document.getElementById('imageUploadInput')?.click()}
                  >
                    <span className="feature-icon">🖼</span>
                    <span className="feature-label">上传图片</span>
                  </button>
                </div>
              )}

              {currentMode.suggestions.length > 0 && !hasMessages && (
                <div className="suggestion-panel">
                  {currentMode.suggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => handleSuggestionClick(suggestion)}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}

              {error && <div className="error-toast">{error}</div>}
              {info && <div className="info-toast">{info}</div>}
            </div>
          </footer>
        </div>
      </div>
      <aside className="tools-sidebar">
        <div className="tools-scroll">
        {activeConversation?.settings.deepThinking ? (
          (() => {
            const lastAssistant = messages.filter(m => m.role === 'assistant').slice(-1)[0]
            if (!lastAssistant) {
              return (
                <section className="thinking-panel">
                  <header className="thinking-panel-title"><span>思考过程</span></header>
                  <div className="thinking-empty">暂无思考</div>
                </section>
              )
            }
            const parts = splitAssistantContent(lastAssistant.content)
            return (
              <section className="thinking-panel">
                <header className="thinking-panel-title">
                  <span>{parts.final ? '思考完成' : '正在思考...'}</span>
                </header>
                <div className="thinking-panel-content">
                {parts.thought && (
                  <details className="thinking-section" open>
                    <summary className="thinking-section-summary">Thought</summary>
                    <div className="thinking-section-body">
                      {parts.thought.split('\n').map((line, idx) => (
                        <p key={`thinking-th-${idx}`}>{line}</p>
                      ))}
                    </div>
                  </details>
                )}
                {latestToolEvents.length > 0 && (
                  <details className="thinking-section">
                    <summary className="thinking-section-summary">Actions</summary>
                    <div className="thinking-section-body">
                      {latestToolEvents.map((evt, idx) => (
                        <div key={`thinking-action-${idx}`} className="thinking-action-item">
                          <p className="thinking-action-name">{String((evt as any).tool_name || '')}</p>
                          <pre className="thinking-pre">{typeof (evt as any).arguments === 'string' ? (evt as any).arguments : JSON.stringify((evt as any).arguments, null, 2)}</pre>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
                {latestToolEvents.length > 0 && (
                  <details className="thinking-section">
                    <summary className="thinking-section-summary">Observations</summary>
                    <div className="thinking-section-body">
                      {latestToolEvents.map((evt, idx) => (
                        <div key={`thinking-ob-${idx}`} className="thinking-observation-item">
                          {renderObservation((evt as any).result)}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
                </div>
              </section>
            )
          })()
        ) : (
          <section className="thinking-panel">
            <header className="thinking-panel-title"><span>思考过程</span></header>
            <div className="thinking-empty">未开启深度思考</div>
          </section>
        )}
        </div>
      </aside>
    </div>
  )
}

export default App
