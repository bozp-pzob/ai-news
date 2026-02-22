import React from 'react';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  confirmColor?: 'amber' | 'red' | 'purple' | 'green';
  onConfirm: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
}

/**
 * Reusable confirmation modal with customizable color and optional children.
 */
export function ConfirmModal({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  confirmColor = 'amber',
  onConfirm,
  onCancel,
  children,
}: ConfirmModalProps) {
  if (!isOpen) return null;

  const buttonStyles = {
    amber: 'bg-amber-600 hover:bg-amber-700',
    red: 'bg-red-600 hover:bg-red-700',
    purple: 'bg-purple-600 hover:bg-purple-700',
    green: 'bg-green-600 hover:bg-green-700',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-stone-900 rounded-xl border border-stone-700 max-w-md w-full p-6">
        <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
        <p className="text-stone-400 text-sm mb-4">{message}</p>
        {children}
        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-stone-700 hover:bg-stone-600 text-white rounded-lg text-sm"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 ${buttonStyles[confirmColor]} text-white rounded-lg text-sm`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
