import React, { useState, useRef, useEffect } from 'react';
import MessageBubble from './MessageBubble';
import ChatInput from './ChatInput';
import ModelSelector from './ModelSelector';
import Sidebar from './Sidebar';
import type { ToolEvent } from '../types';

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

interface ChatInterfaceProps {
  models: Model[];
  currentModel: Model;
  onModelChange: (modelId: string) => void;
  onSendMessage: (message: string) => void;
  messages: Message[];
  isStreaming: boolean;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({
  models,
  currentModel,
  onModelChange,
  onSendMessage,
  messages,
  isStreaming
}) => {
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    if (inputValue.trim() && !isStreaming) {
      onSendMessage(inputValue);
      setInputValue('');
    }
  };

  return (
    <div className="chat-interface">
      <Sidebar />
      <div className="main-content">
        <div className="header">
          <ModelSelector 
            models={models} 
            currentModel={currentModel} 
            onModelChange={onModelChange} 
          />
        </div>
        <div className="messages-container">
          {messages.map((message) => (
            <MessageBubble 
              key={message.id} 
              message={message} 
            />
          ))}
          <div ref={messagesEndRef} />
        </div>
        <ChatInput 
          value={inputValue}
          onChange={setInputValue}
          onSend={handleSend}
          disabled={isStreaming}
        />
      </div>
    </div>
  );
};

export default ChatInterface;