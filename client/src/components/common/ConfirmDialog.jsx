import React, { useEffect } from 'react';
import { IconAlertTriangle, IconClose } from './Icons.jsx';
import './ConfirmDialog.scss';

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  isDangerous = false,
  isLoading = false,
  onConfirm,
  onCancel,
}) {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !isLoading) {
        onCancel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isLoading, onCancel]);

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={isLoading ? undefined : onCancel} role="dialog" aria-modal="true">
      <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-dialog__header">
          <div className="confirm-dialog__header-left">
            {isDangerous && (
              <div className="confirm-dialog__icon-badge" aria-hidden="true">
                <IconAlertTriangle size={16} />
              </div>
            )}
            <h3 className="confirm-dialog__title">{title}</h3>
          </div>
          <button
            type="button"
            className="confirm-dialog__close-btn"
            onClick={onCancel}
            disabled={isLoading}
            aria-label="Close dialog"
          >
            <IconClose size={16} />
          </button>
        </div>

        <div className="confirm-dialog__body">
          <p className="confirm-dialog__message">{message}</p>
        </div>

        <div className="confirm-dialog__footer">
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={onCancel}
            disabled={isLoading}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn ${isDangerous ? 'btn--danger' : 'btn--primary'} btn--sm`}
            onClick={onConfirm}
            disabled={isLoading}
          >
            {isLoading ? 'Processing...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
