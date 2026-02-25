import React, { useState, useEffect } from 'react';
import { secretManager } from '../services/SecretManager';

interface UnlockDatabaseDialogProps {
  open: boolean;
  onClose: () => void;
  onUnlocked?: () => void;
}

export const UnlockDatabaseDialog: React.FC<UnlockDatabaseDialogProps> = ({ 
  open, 
  onClose,
  onUnlocked
}) => {
  const [password, setPassword] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [attemptCount, setAttemptCount] = useState<number>(0);

  useEffect(() => {
    if (open) {
      // Reset the form when the dialog opens
      setPassword('');
      setError(null);
      setLoading(false);
    }
  }, [open]);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!password.trim()) {
      setError('Please enter a password');
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      // Get persistence status to check if it's password protected
      const persistenceSettings = secretManager.persistenceState;
      if (!persistenceSettings?.enabled || !persistenceSettings?.passwordProtected) {
        setError('Database is not password protected');
        setLoading(false);
        return;
      }
      
      // Unlock the database using the password
      const unlockResult = await secretManager.unlockDatabase(password);
      
      if (unlockResult.success) {
        // Database unlocked successfully
        setPassword('');
        setError(null);
        
        // Call the onUnlocked callback if provided
        if (onUnlocked) {
          onUnlocked();
        }
        
        // Close the dialog after a short delay
        setTimeout(() => {
          onClose();
        }, 1000);
      } else {
        // Incorrect password
        setAttemptCount(prev => prev + 1);
        setError(unlockResult.message || 'Incorrect password');
      }
    } catch (err) {
      // Handle any errors
      setError(`Error unlocking database: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setAttemptCount(prev => prev + 1);
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 text-stone-800">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium flex items-center">
            <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
              <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd"></path>
            </svg>
            Unlock Database
          </h2>
          <button 
            onClick={onClose} 
            className="text-stone-400 hover:text-stone-800"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>
        
        {error && (
          <div className="bg-red-50 border border-red-300 text-red-600 px-4 py-3 rounded mb-4">
            {error}
            {attemptCount > 2 && (
              <div className="text-xs mt-1">
                If you've forgotten your password, you may need to clear the database and set it up again.
              </div>
            )}
          </div>
        )}
        
        <p className="text-sm text-stone-500 mb-4">
          Your database is encrypted with a password. Please enter your password to unlock it.
        </p>
        
        <form onSubmit={handleUnlock} className="space-y-4">
          <div className="flex flex-col">
            <label htmlFor="password" className="text-sm font-medium mb-1">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              disabled={loading}
              required
              className="bg-white border border-stone-300 rounded px-3 py-2 text-stone-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              placeholder="Enter your password"
            />
          </div>
          
          <div className="mt-6 flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 bg-stone-100 text-stone-700 rounded hover:bg-stone-200 focus:outline-none focus:ring-2 focus:ring-stone-300"
            >
              Cancel
            </button>
            
            <button
              type="submit"
              disabled={loading || !password}
              className={`px-4 py-2 rounded focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                loading ? 'bg-emerald-300 text-emerald-700' : 'bg-emerald-600 text-white hover:bg-emerald-500'
              }`}
            >
              {loading ? (
                <span className="flex items-center">
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Unlocking...
                </span>
              ) : (
                'Unlock'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}; 