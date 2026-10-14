import React from 'react';
import { IconFolder } from './Icons.jsx';
import './EmptyState.scss';

export function EmptyState({
  title = 'No records found',
  description = 'No items match your active search or filters.',
  action = null,
  icon: CustomIcon = null,
}) {
  const IconComponent = CustomIcon || IconFolder;

  return (
    <div className="empty-state">
      <div className="empty-state__icon-wrap">
        <IconComponent size={28} className="empty-state__icon" />
      </div>
      <h3 className="empty-state__title">{title}</h3>
      {description && <p className="empty-state__description">{description}</p>}
      {action && <div className="empty-state__action">{action}</div>}
    </div>
  );
}
