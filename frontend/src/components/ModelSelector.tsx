import React, { useState } from 'react';

interface Model {
  id: string;
  name: string;
  description: string;
}

interface ModelSelectorProps {
  models: Model[];
  currentModel: Model;
  onModelChange: (modelId: string) => void;
}

const ModelSelector: React.FC<ModelSelectorProps> = ({
  models,
  currentModel,
  onModelChange
}) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="model-selector">
      <div className="current-model" onClick={() => setIsOpen(!isOpen)}>
        <span>{currentModel.name}</span>
        <span className="arrow">{isOpen ? '▲' : '▼'}</span>
      </div>
      {isOpen && (
        <div className="model-dropdown">
          {models.map((model) => (
            <div
              key={model.id}
              className={`model-option ${model.id === currentModel.id ? 'selected' : ''}`}
              onClick={() => {
                onModelChange(model.id);
                setIsOpen(false);
              }}
            >
              <div className="model-name">{model.name}</div>
              <div className="model-description">{model.description}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ModelSelector;