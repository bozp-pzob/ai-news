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
    amber: 'bg-emerald-600 hover:bg-emerald-700',
    red: 'bg-red-600 hover:bg-red-700',
    purple: 'bg-purple-600 hover:bg-purple-700',
    green: 'bg-green-600 hover:bg-green-700',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-xl border border-stone-200 max-w-md w-full p-6">
        <h3 className="text-lg font-semibold text-stone-800 mb-2">{title}</h3>
        <p className="text-stone-500 text-sm mb-4">{message}</p>
        {children}
        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-lg text-sm"
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
