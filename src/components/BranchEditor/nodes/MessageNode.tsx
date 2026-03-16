import React, { memo, useCallback } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import useStore from '@store/store';
import { MessageNodeData } from '../useBranchEditorLayout';

const roleBadgeColors: Record<string, string> = {
  user: 'bg-blue-500',
  assistant: 'bg-green-500',
  system: 'bg-purple-500',
};

const MessageNode = memo(({ data, id }: NodeProps<MessageNodeData>) => {
  const hoveredNodeId = useStore((state) => state.hoveredNodeId);
  const setHoveredNodeId = useStore((state) => state.setHoveredNodeId);

  const isHovered = hoveredNodeId === id;

  const handleMouseEnter = useCallback(() => {
    setHoveredNodeId(id);
  }, [id, setHoveredNodeId]);

  const handleMouseLeave = useCallback(() => {
    setHoveredNodeId(null);
  }, [setHoveredNodeId]);

  const borderColor = data.isActive
    ? data.conversationColor || '#3b82f6'
    : undefined;

  return (
    <div
      className={`px-3 py-2 rounded-lg border-2 shadow-md w-[280px] cursor-pointer transition-shadow duration-150 ${
        data.isActive
          ? 'bg-white dark:bg-gray-700'
          : 'border-gray-400 dark:border-gray-500 bg-gray-100 dark:bg-gray-800 opacity-50'
      } ${isHovered ? 'outline outline-[3px] outline-blue-400 outline-offset-0' : ''}`}
      style={data.isActive ? { borderColor } : undefined}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <Handle type='target' position={Position.Top} className='!bg-gray-400' />
      <div className='flex items-center gap-2 mb-1'>
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded text-white font-medium ${
            roleBadgeColors[data.role] || 'bg-gray-500'
          }`}
        >
          {data.role}
        </span>
        {data.label && (
          <span className='text-[10px] text-gray-500 dark:text-gray-400 truncate'>
            {data.label}
          </span>
        )}
      </div>
      <p className='text-xs text-gray-700 dark:text-gray-300 line-clamp-2 leading-relaxed'>
        {data.contentPreview || '(empty)'}
      </p>
      <Handle
        type='source'
        position={Position.Bottom}
        className='!bg-gray-400'
      />
    </div>
  );
});

export default MessageNode;
