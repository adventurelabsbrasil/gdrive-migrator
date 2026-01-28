
import React from 'react';
import { DriveFile } from '../types';

interface DriveItemProps {
  item: DriveFile;
  isSelected: boolean;
  onToggle: (id: string) => void;
  onNavigate?: (id: string) => void;
}

const DriveItem: React.FC<DriveItemProps> = ({ item, isSelected, onToggle, onNavigate }) => {
  const isFolder = item.mimeType === 'application/vnd.google-apps.folder';

  return (
    <div 
      className={`flex items-center p-3 hover:bg-slate-100 border-b border-slate-200 cursor-pointer transition-colors ${isSelected ? 'bg-blue-50' : ''}`}
      onClick={() => onToggle(item.id)}
    >
      <input 
        type="checkbox" 
        checked={isSelected} 
        onChange={() => onToggle(item.id)}
        className="w-4 h-4 rounded text-blue-600 mr-4 cursor-pointer"
        onClick={(e) => e.stopPropagation()}
      />
      
      <div className="mr-4 text-2xl">
        {isFolder ? '📁' : '📄'}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center">
          <p className="font-medium text-slate-800 truncate">{item.name}</p>
          {isFolder && onNavigate && (
            <button 
              onClick={(e) => { e.stopPropagation(); onNavigate(item.id); }}
              className="ml-2 text-xs text-blue-600 hover:underline px-2 py-1 rounded bg-blue-100"
            >
              Abrir
            </button>
          )}
        </div>
        <p className="text-xs text-slate-500 truncate">{item.mimeType}</p>
      </div>

      <div className="text-xs text-slate-400 whitespace-nowrap ml-4">
        {item.size ? `${(parseInt(item.size) / 1024 / 1024).toFixed(2)} MB` : '--'}
      </div>
    </div>
  );
};

export default DriveItem;
