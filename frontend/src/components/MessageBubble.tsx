import React from 'react';
import type { ToolEvent } from '../types';
import { marked } from 'marked';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolEvents?: ToolEvent[];
}

interface MessageBubbleProps {
  message: Message;
}

// 创建一个安全的HTML渲染函数
const renderMarkdown = (content: string) => {
  return marked(content);
};

interface ParsedSection {
  type: string;
  content: string;
  start: number;
  end: number;
}

const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  // 解析内容中的Thought、Action、Action Input和Observation区块
  const parseContent = (content: string) => {
    const sections: ParsedSection[] = [];
    let currentIndex = 0;
    
    // 定义区块类型和对应的正则表达式
    const patterns = [
      { type: 'thought', regex: /Thought:\s*(.*?)(?=\n(?:Action|Final Answer|Observation):|\n\w+:|$)/gs },
      { type: 'action', regex: /Action:\s*(.*?)(?=\n(?:Action Input|Observation|Final Answer):|\n\w+:|$)/gs },
      { type: 'action-input', regex: /Action Input:\s*(.*?)(?=\n(?:Observation|Final Answer):|\n\w+:|$)/gs },
      { type: 'observation', regex: /Observation:\s*(.*?)(?=\n(?:Thought|Action|Final Answer):|\n\w+:|$)/gs }
    ];
    
    // 找到所有匹配的区块
    const matches: ParsedSection[] = [];
    
    patterns.forEach(pattern => {
      let match;
      while ((match = pattern.regex.exec(content)) !== null) {
        matches.push({
          type: pattern.type,
          content: match[1].trim(),
          start: match.index,
          end: match.index + match[0].length
        });
      }
    });
    
    // 按照在文本中出现的顺序排序
    matches.sort((a, b) => a.start - b.start);
    
    // 过滤掉重叠的匹配项，只保留最先开始的
    const filteredMatches: ParsedSection[] = [];
    let lastEnd = 0;
    
    matches.forEach(match => {
      if (match.start >= lastEnd) {
        filteredMatches.push(match);
        lastEnd = match.end;
      }
    });
    
    // 处理匹配结果，添加文本区块
    filteredMatches.forEach(match => {
      // 添加之前的文本
      if (match.start > currentIndex) {
        sections.push({
          type: 'text',
          content: content.substring(currentIndex, match.start),
          start: currentIndex,
          end: match.start
        });
      }
      
      // 添加当前匹配的区块
      sections.push({
        type: match.type,
        content: match.content,
        start: match.start,
        end: match.end
      });
      
      currentIndex = match.end;
    });
    
    // 添加剩余的文本
    if (currentIndex < content.length) {
      sections.push({
        type: 'text',
        content: content.substring(currentIndex),
        start: currentIndex,
        end: content.length
      });
    }
    
    return sections;
  };
  
  // 渲染内容区块
  const renderContentSections = (content: string) => {
    const sections = parseContent(content);
    
    return sections.map((section, index) => {
      switch (section.type) {
        case 'thought':
          return (
            <div key={index} className="content-section thought-section">
              <div className="section-label">Thought:</div>
              <div
                className="section-content markdown-content"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(section.content) }}
              />
            </div>
          );
        case 'action':
          return (
            <div key={index} className="content-section action-section">
              <div className="section-label">Action:</div>
              <div
                className="section-content markdown-content"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(section.content) }}
              />
            </div>
          );
        case 'action-input':
          return (
            <div key={index} className="content-section action-input-section">
              <div className="section-label">Action Input:</div>
              <div
                className="section-content markdown-content"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(section.content) }}
              />
            </div>
          );
        case 'observation':
          return (
            <div key={index} className="content-section observation-section">
              <div className="section-label">Observation:</div>
              <div
                className="section-content markdown-content"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(section.content) }}
              />
            </div>
          );
        default:
          return (
            <div key={index} className="content-section text-section">
              <div
                className="markdown-content"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(section.content) }}
              />
            </div>
          );
      }
    });
  };
  
  return (
    <div className={`message-bubble ${message.role}`}>
      <div className="message-sender">
        {message.role === 'user' ? 'You' : 'Qwen'}
      </div>
      <div className="message-content">
        {renderContentSections(message.content)}
        {message.toolEvents && message.toolEvents.length > 0 && (
          <div className="tool-events">
            <h4>工具调用详情:</h4>
            {message.toolEvents.map((event, index) => (
              <div key={index} className="tool-event">
                <div className="tool-name">工具: {event.tool_name}</div>
                <div className="tool-arguments">
                  <div className="section-label">参数:</div>
                  <pre>{JSON.stringify(event.arguments, null, 2)}</pre>
                </div>
                <div className="tool-result">
                  <div className="section-label">结果:</div>
                  <pre>{JSON.stringify(event.result, null, 2)}</pre>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default MessageBubble;