import React from 'react';
import './LoadingState.scss';

export function LoadingState({ message = 'Loading records...' }) {
  return (
    <div className="loading-state" role="status" aria-live="polite">
      <div className="loading-state__spinner" aria-hidden="true" />
      <span className="loading-state__message">{message}</span>
    </div>
  );
}
