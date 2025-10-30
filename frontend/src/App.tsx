import {
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import './App.css'

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

type ModelId = 'qwen3-max' | 'qwen2.5-72b' | 'qwen2.5-32b' | 'qwen2.5-coder'

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
  { label: '添加照片和文件', icon: '📎' },
  { label: '深度研究', icon: '📡' },
  { label: '创建图片', icon: '🎨' },
  { label: '代理模式', icon: '🧩' },
  { label: '添加源', icon: '🔗' },
  { label: '更多', icon: '⋯' },
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

const MODEL_MAP = MODELS.reduce<Record<ModelId, ModelConfig>>((acc, model) => {
  acc[model.id] = model
  return acc
}, {} as Record<ModelId, ModelConfig>)

const generateId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const loadDefaultModelId = (): ModelId => {
  if (typeof window === 'undefined') return DEFAULT_MODEL_ID
  const stored = window.localStorage.getItem(DEFAULT_MODEL_STORAGE_KEY)
  if (stored && stored in MODEL_MAP) {
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
  const model = MODEL_MAP[defaultModelId] ?? MODEL_MAP[DEFAULT_MODEL_ID]

  return {
    id: overrides?.id ?? generateId(),
    title: overrides?.title ?? DEFAULT_CONVERSATION_TITLE,
    modeId,
    modelId: model.id,
    pinned: overrides?.pinned ?? false,
    archived: overrides?.archived ?? false,
    messages: overrides?.messages ?? [],
    toolEvents: overrides?.toolEvents ?? [],
    settings: sanitizeSettings(overrides?.settings, mode.options),
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
          typeof data.modelId === 'string' && data.modelId in MODEL_MAP
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

  const activeConversation = useMemo(
    () => conversations.find((item) => item.id === activeConversationId) ?? null,
    [conversations, activeConversationId]
  )

  const currentModel = useMemo(() => {
    if (!activeConversation) return MODEL_MAP[DEFAULT_MODEL_ID]
    return MODEL_MAP[activeConversation.modelId] ?? MODEL_MAP[DEFAULT_MODEL_ID]
  }, [activeConversation])

  const currentMode = useMemo(() => {
    if (!activeConversation) return MODE_MAP[DEFAULT_MODE_ID]
    return MODE_MAP[activeConversation.modeId] ?? MODE_MAP[DEFAULT_MODE_ID]
  }, [activeConversation])

  const messages = activeConversation?.messages ?? []
  const latestToolEvents = activeConversation?.toolEvents ?? []
  const hasMessages = messages.length > 0

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
          options: encodeOptions(activeConversation.settings),
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
              reader.releaseLock()
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
      }

      if (buffer.trim().length > 0 && buffer.startsWith('data:')) {
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
                    {MODELS.map((model) => {
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
                <span className="header-tag">
                  {currentMode.icon} {currentMode.label}
                </span>
                <h1 className="header-title">{greetingText}</h1>
                <p className="header-subtitle">
                  {currentMode.description}。在这里和 Qwen 对话、创作或进行快速研究。
                </p>
              </div>
              <div className="header-actions">
                <div className="mode-selector">
                  <button
                    ref={modeBtnRef}
                    type="button"
                    className="model-button"
                    onClick={() => setIsModeMenuOpen((prev) => !prev)}
                  >
                    <span className="model-icon">{currentMode.icon}</span>
                    <span className="model-label">{currentMode.label}</span>
                    <span className="model-chevron">⌄</span>
                  </button>
                  {isModeMenuOpen && (
                    <div ref={menuRef} className="mode-menu">
                      {MODES.map((mode) => (
                        <button
                          key={mode.id}
                          type="button"
                          className={`mode-item${mode.id === currentMode.id ? ' active' : ''}`}
                          onClick={() => handleModeChange(mode.id)}
                        >
                          <span className="mode-item-icon">{mode.icon}</span>
                          <span className="mode-item-info">
                            <span className="mode-item-label">{mode.label}</span>
                            <span className="mode-item-desc">{mode.description}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className="header-btn primary"
                  onClick={handleCreateConversation}
                >
                  ＋ 新建对话
                </button>
                <button
                  type="button"
                  className="header-btn ghost"
                  onClick={handleDeleteConversation}
                >
                  🗑 删除对话
                </button>
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
                  {message.content.split('\n').map((line, index) => (
                    <p key={`${message.id}-${index}`}>{line}</p>
                  ))}
                </div>
              </div>
            ))}
            {isStreaming && (
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

          {latestToolEvents.length > 0 && (
            <section className="tool-history">
              <header>
                <span>最新工具调用</span>
              </header>
              <div className="tool-scroller">
                {[...latestToolEvents].slice(-5).map((event, index) => (
                  <article key={`${event.tool_name}-${index}`} className="tool-chip">
                    <strong>{event.tool_name}</strong>
                    <pre>{JSON.stringify(event.arguments, null, 2)}</pre>
                  </article>
                ))}
              </div>
            </section>
          )}

          <footer className="composer-area">
            <div className="prompt-wrapper">
              <div className="prompt-bar">
                <button
                  ref={featureBtnRef}
                  type="button"
                  className="prompt-prefix"
                  onClick={() => setIsFeatureMenuOpen((prev) => !prev)}
                  aria-label="选择功能"
                >
                  ＋
                </button>
                <textarea
                  className="prompt-input"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={currentMode.placeholder}
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
                      className="action-btn send"
                      onClick={() => void sendMessage()}
                      disabled={input.trim().length === 0}
                      aria-label="发送"
                    >
                      🚀
                    </button>
                  )}
            </div>
          </div>

              {isFeatureMenuOpen && (
                <div ref={featureMenuRef} className="feature-menu">
                  {FEATURE_ACTIONS.map((action) => (
                    <button
                      key={action.label}
                      type="button"
                      onClick={() => handleSuggestionClick(action.label)}
                    >
                      <span className="feature-icon">{action.icon}</span>
                      <span className="feature-label">{action.label}</span>
                    </button>
                  ))}
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
            </div>
          </footer>
        </div>
      </div>
    </div>
  )
}

export default App
