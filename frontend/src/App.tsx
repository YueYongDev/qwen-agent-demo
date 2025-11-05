import React, { useState, useEffect } from 'react';
import ChatInterface from './components/ChatInterface';
import './styles/main.css';
import type { ToolEvent } from './types';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolEvents?: ToolEvent[];
}

interface Model {
  id: string;
  name: string;
  description: string;
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [models, setModels] = useState<Model[]>([]);
  const [currentModelId, setCurrentModelId] = useState('qwen3-max');

  useEffect(() => {
    // Fetch available models from the backend
    const fetchModels = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/models`);
        if (response.ok) {
          const data = await response.json();
          setModels(data.models || []);
        }
      } catch (error) {
        console.error('Failed to fetch models:', error);
        // Fallback to default models if API call fails
        setModels([
          { id: 'qwen3-max', name: 'Qwen3-Max', description: '旗舰模型，兼顾复杂任务与创作场景。' },
          { id: 'qwen2.5-72b', name: 'Qwen2.5-72B', description: '超大参数量，更擅长复杂推理与代码。' },
          { id: 'qwen2.5-32b', name: 'Qwen2.5-32B', description: '平衡性能与成本，适合日常办公与总结。' }
        ]);
      }
    };

    fetchModels();
  }, []);

  const currentModel = models.find(model => model.id === currentModelId) || 
    models[0] || 
    { id: 'qwen3-max', name: 'Qwen3-Max', description: '默认模型' };

  const handleModelChange = (modelId: string) => {
    setCurrentModelId(modelId);
  };

  const handleSendMessage = async (content: string) => {
    // Add user message to the chat
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content
    };

    setMessages(prev => [...prev, userMessage]);
    setIsStreaming(true);

    try {
      // Send message to the backend
      const response = await fetch(`${API_BASE}/api/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: currentModelId,
          messages: [...messages, userMessage].map(msg => ({
            role: msg.role,
            content: msg.content
          }))
        })
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Process the streaming response
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let assistantMessage: Message = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: ''
      };

      setMessages(prev => [...prev, assistantMessage]);

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n\n');

          for (const line of lines) {
            if (line.startsWith('data:')) {
              const data = line.slice(5).trim();
              if (data === '[DONE]') {
                break;
              }

              try {
                const payload = JSON.parse(data);
                if (payload.type === 'chunk') {
                  assistantMessage = {
                    ...assistantMessage,
                    content: assistantMessage.content + payload.delta
                  };
                  setMessages(prev =>
                    prev.map(msg =>
                      msg.id === assistantMessage.id ? assistantMessage : msg
                    )
                  );
                } else if (payload.type === 'tools') {
                  // 处理工具事件
                  assistantMessage = {
                    ...assistantMessage,
                    toolEvents: payload.tool_events
                  };
                  setMessages(prev =>
                    prev.map(msg =>
                      msg.id === assistantMessage.id ? assistantMessage : msg
                    )
                  );
                }
              } catch (parseError) {
                console.error('Error parsing JSON:', parseError);
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      console.error('Error sending message:', error);
      const errorMessage: Message = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: 'Sorry, I encountered an error processing your request.'
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsStreaming(false);
    }
  };

  return (
    <div className="app">
      <ChatInterface
        models={models}
        currentModel={currentModel}
        onModelChange={handleModelChange}
        onSendMessage={handleSendMessage}
        messages={messages}
        isStreaming={isStreaming}
      />
    </div>
  );
}

export default App;
