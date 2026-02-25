import React from 'react';

interface ResetDialogProps {
  onClose: () => void;
  onConfirm: () => void;
}

export const ResetDialog: React.FC<ResetDialogProps> = ({
  onClose,
  onConfirm,
}) => {
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full text-stone-600">
        <div className="px-6 py-4 border-b border-stone-200">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-medium text-stone-800">Reset Configuration</h3>
            <button
              onClick={onClose}
              className="text-stone-400 hover:text-stone-600"
            >
              <span className="sr-only">Close</span>
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        <div className="px-6 py-4">
          <p className="text-stone-500 mb-4">
            Are you sure you want to reset the configuration? This will discard all unsaved changes and restore the last saved state.
          </p>
          <div className="mt-6 flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-stone-600 bg-white border border-stone-300 rounded-md hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white focus:ring-emerald-500"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white focus:ring-red-500"
            >
              Reset
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}; 