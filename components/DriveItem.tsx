
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

  const itemStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    padding: '12px',
    borderBottom: '1px solid #f1f5f9',
    cursor: 'pointer',
    backgroundColor: isSelected ? '#eff6ff' : 'white',
    transition: 'background-color 0.2s'
  };

  return (
    <div 
      style={itemStyle}
      onClick={() => onToggle(item.id)}
      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = '#f8fafc'; }}
      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = 'white'; }}
    >
      <input 
        type="checkbox" 
        checked={isSelected} 
        onChange={() => onToggle(item.id)}
        style={{ width: '16px', height: '16px', marginRight: '12px', cursor: 'pointer' }}
        onClick={(e) => e.stopPropagation()}
      />
      
      <div style={{ marginRight: '12px', fontSize: '20px' }}>
        {isFolder ? '📁' : '📄'}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <p style={{ margin: 0, fontWeight: 600, fontSize: '13px', color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.name}
          </p>
          {isFolder && onNavigate && (
            <button 
              onClick={(e) => { e.stopPropagation(); onNavigate(item.id); }}
              style={{ marginLeft: '8px', fontSize: '10px', background: '#dbeafe', color: '#1e40af', border: 'none', padding: '2px 8px', borderRadius: '4px', cursor: 'pointer', fontWeight: 700 }}
            >
              ABRIR
            </button>
          )}
        </div>
        <p style={{ margin: 0, fontSize: '11px', color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.mimeType.split('.').pop()}
        </p>
      </div>

      <div style={{ fontSize: '11px', color: '#94a3b8', whiteSpace: 'nowrap', marginLeft: '12px', fontWeight: 500 }}>
        {item.size ? `${(parseInt(item.size) / 1024 / 1024).toFixed(2)} MB` : isFolder ? '--' : '0 MB'}
      </div>
    </div>
  );
};

export default DriveItem;
