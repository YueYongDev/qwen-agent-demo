# Qwen Agent Demo

使用 [qwen-agent](https://github.com/QwenLM/qwen-agent) 打造的前后端分离 Demo。后端基于 FastAPI，整合了 **生图**、**DuckDuckGo 搜索**、**本地 RAG 检索** 以及 **MCP 扩展工具**；前端使用 React + Vite 提供对话界面并展示最新的工具调用结果。默认通过本地 Ollama 的 `qwen3` 模型驱动对话。

## 功能概览

- 🤖 **Qwen 对话**：默认走本地 Ollama (`http://localhost:11434/v1`) 的 `qwen3` 模型，可切换至 DashScope 或其它 OpenAI 兼容推理服务。
- 🎨 **生图工具**：使用 Pollinations 公共 API，根据提示词生成插画并返回图片链接及可选的 Base64 预览。
- 🔎 **搜索工具**：封装 DuckDuckGo 搜索，获取最新网页资讯摘要。
- 📚 **RAG 检索**：对 `backend/data/knowledge_base.json` 中的样例知识库执行 TF-IDF 相似度检索，提供结构化上下文。
- 🔌 **MCP 工具**：可选对接 Model Context Protocol server，将外部能力作为工具注入对话。

## 环境要求

- Python 3.11+
- Node.js ≥ 20.19（Vite 7 要求）
- 已安装并运行中的 [Ollama](https://ollama.com/)（需提前执行 `ollama pull qwen3`）
- 可选：`DASHSCOPE_API_KEY`（当改用 DashScope 时）
- 可选：Node.js/npm 环境用于运行本地 MCP server（例如官方 memory server）

## 大模型配置

后端通过环境变量控制 qwen-agent 的模型与后端服务：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `LLM_MODEL_TYPE` | `oai` | `oai` 走 OpenAI 兼容协议（Ollama 适用），`qwen_dashscope` 对接 DashScope。 |
| `LLM_MODEL_NAME` | `qwen3` | Ollama 中的模型名称；切换 DashScope 时可改为 `qwen-max` 等。 |
| `LLM_API_BASE` | `http://localhost:11434/v1` | OpenAI 兼容服务地址，Ollama 默认即可。 |
| `LLM_API_KEY` | 空 | OpenAI 兼容服务所需的 API Key（Ollama 可不填）。 |
| `DASHSCOPE_API_KEY` | 空 | 当 `LLM_MODEL_TYPE=qwen_dashscope` 时需要配置。 |

示例 `.env`（位于 `backend/.env`）：

```env
LLM_MODEL_TYPE=oai
LLM_MODEL_NAME=qwen3
LLM_API_BASE=http://localhost:11434/v1
# LLM_API_KEY=sk-...
```

## 后端启动

1. 安装依赖：

   ```bash
   cd backend
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   ```

2. 配置环境变量（可在 `backend/.env` 写入，参考上文示例）：

   ```bash
   export LLM_MODEL_TYPE=oai
   export LLM_MODEL_NAME=qwen3
   export LLM_API_BASE=http://localhost:11434/v1
   # 若切换 DashScope：
   # export LLM_MODEL_TYPE=qwen_dashscope
   # export LLM_MODEL_NAME=qwen-max
   # export DASHSCOPE_API_KEY=<your-key>
   # 可选：自定义 CORS
   # export CORS_ALLOW_ORIGINS=http://localhost:5173
   ```

3. 启动 FastAPI：

   ```bash
   cd ..
   PYTHONPATH=backend uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
   ```

   健康检查：访问 `http://localhost:8000/health`

## MCP 工具接入（可选）

qwen-agent 原生支持 [Model Context Protocol](https://github.com/modelcontextprotocol) 工具。通过下述方式开启：

1. 按需准备配置文件，例如使用内存示例：

   ```bash
   cp backend/configs/mcp.memory.example.json backend/mcp.config.json
   ```

2. 将配置路径写入环境变量：

   ```bash
   export MCP_CONFIG_PATH=backend/mcp.config.json
   ```

   也可直接提供 JSON 字符串：

   ```bash
   export MCP_SERVERS_JSON='{"mcpServers":{"memory":{"command":"npx","args":["-y","@modelcontextprotocol/server-memory"]}}}'
   ```

3. 重启后端。成功后，MCP server 暴露的工具会出现在工具面板中。

> 提醒：部分 MCP server 需要额外依赖（如 `npx`、后端数据库等），请根据服务说明先行安装。

## 前端启动

1. 安装依赖并运行开发服务器：

   ```bash
   cd frontend
   npm install
   npm run dev
   ```

2. 可通过环境变量覆盖后端地址，默认指向 `http://localhost:8000`：

   ```bash
   # frontend/.env.local
   VITE_API_BASE_URL=http://localhost:8000
   ```

3. 访问 Vite 提示的地址（默认 `http://localhost:5173`），开始对话体验。

> 构建产物：`npm run build` 会在 `frontend/dist` 输出静态文件，可配合任意静态服务器（如 `npm install -g serve && serve -s dist`）。

## 代码结构

```
backend/
  app/
    config.py              # 配置加载与缓存
    main.py                # FastAPI 入口
    models.py              # 请求/响应 Pydantic 模型
    services/agent_service.py
    tools/                 # 生图、搜索、RAG、MCP 工具封装
    rag/vector_store.py    # 轻量 TF-IDF 检索
  configs/mcp.memory.example.json
  data/knowledge_base.json
frontend/
  src/App.tsx              # React 主界面
  src/App.css              # 样式
  ...
```

## 注意事项

- 未启动 Ollama 或未提前拉取 `qwen3` 时，后端调用会失败，前端会显示错误提示。
- 切换至 DashScope 时，需要设置 `LLM_MODEL_TYPE=qwen_dashscope` 与 `DASHSCOPE_API_KEY`。
- Pollinations 等第三方服务为公网接口，若在内网或受限环境中使用需额外配置代理。
- 开发环境 Node.js 版本低于 20.19 会有警告，建议升级以获得最佳体验。
- 使用 MCP 时，确保相应 server 的命令能在后端环境中正常执行。

欢迎根据自己的业务扩展知识库、接入更多自定义工具或替换模型后端。祝玩得开心！ 🎉
