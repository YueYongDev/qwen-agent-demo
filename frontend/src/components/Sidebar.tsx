import React, { useState } from 'react';

const Sidebar: React.FC = () => {
  const [conversations, setConversations] = useState([
    { id: '1', title: 'New Chat' },
    { id: '2', title: 'Qwen Guide' },
    { id: '3', title: 'Travel Planning' }
  ]);

  const [isCreating, setIsCreating] = useState(false);

  const handleCreateNewChat = () => {
    setIsCreating(true);
    // In a real app, this would call the backend to create a new conversation
    const newConversation = {
      id: Date.now().toString(),
      title: 'New Chat'
    };
    setConversations([newConversation, ...conversations]);
    setIsCreating(false);
  };

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h2>Conversations</h2>
        <button 
          onClick={handleCreateNewChat} 
          disabled={isCreating}
          className="new-chat-button"
        >
          {isCreating ? 'Creating...' : '+ New Chat'}
        </button>
      </div>
      <div className="conversation-list">
        {conversations.map((conversation) => (
          <div key={conversation.id} className="conversation-item">
            {conversation.title}
          </div>
        ))}
      </div>
    </div>
  );
};

export default Sidebar;