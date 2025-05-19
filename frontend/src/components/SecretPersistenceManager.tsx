import React, { useState, useEffect } from 'react';
import { secretManager } from '../services/SecretManager';

interface SecretPersistenceManagerProps {
  open: boolean;
  onClose: () => void;
}

export const SecretPersistenceManager: React.FC<SecretPersistenceManagerProps> = ({ open, onClose }) => {
  const [isPersistenceEnabled, setIsPersistenceEnabled] = useState<boolean>(false);
  const [isPasswordProtected, setIsPasswordProtected] = useState<boolean>(false);
  const [password, setPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [oldPassword, setOldPassword] = useState<string>('');
  const [isChangingPassword, setIsChangingPassword] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Get initial persistence status from secretManager
  useEffect(() => {
    if (open) {
      const initialStatus = {
        persistenceEnabled: (secretManager as any).persistence?.enabled || false,
        passwordProtected: (secretManager as any).persistence?.passwordProtected || false
      };
      
      setIsPersistenceEnabled(initialStatus.persistenceEnabled);
      setIsPasswordProtected(initialStatus.passwordProtected);
      setPassword('');
      setConfirmPassword('');
      setOldPassword('');
      setIsChangingPassword(false);
      setError(null);
      setSuccess(null);
    }
  }, [open]);

  const handleSave = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    
    try {
      if (isPersistenceEnabled) {
        // Enable persistence
        if (isPasswordProtected) {
          // Validate password
          if (password !== confirmPassword) {
            setError('Passwords do not match');
            setLoading(false);
            return;
          }
          
          if (password.length < 8) {
            setError('Password must be at least 8 characters long');
            setLoading(false);
            return;
          }
          
          // Handle password change if already password protected
          if (isChangingPassword) {
            const succeeded = await secretManager.changePassword(password, oldPassword);
            if (!succeeded) {
              setError('Failed to change password. Please check your old password.');
              setLoading(false);
              return;
            }
            setSuccess('Password changed successfully');
          } else {
            // Enable with password protection
            await secretManager.enablePersistence({
              passwordProtected: true,
              password
            });
            setSuccess('Encrypted persistence enabled with password protection');
          }
        } else {
          // Enable without password protection
          await secretManager.enablePersistence({
            passwordProtected: false
          });
          setSuccess('Persistence enabled without password protection');
        }
      } else {
        // Disable persistence
        await secretManager.disablePersistence(true);
        setSuccess('Persistence disabled and storage cleared');
      }
      
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err) {
      setError(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-stone-800 rounded-lg shadow-xl max-w-md w-full p-6 text-white">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium flex items-center">
            <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
              <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd"></path>
            </svg>
            Secret Persistence Settings
          </h2>
          <button 
            onClick={onClose} 
            className="text-gray-400 hover:text-white"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>
        
        {error && (
          <div className="bg-red-900/30 border border-red-500 text-red-200 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}
        
        {success && (
          <div className="bg-green-900/30 border border-green-500 text-green-200 px-4 py-3 rounded mb-4">
            {success}
          </div>
        )}
        
        <p className="text-sm text-gray-300 mb-4">
          By default, secrets are only stored in memory and will be lost when you refresh or close the page.
          You can enable secure persistence to keep your secrets available between browser sessions.
        </p>
        
        <div className="space-y-4">
          <div className="flex items-center">
            <input
              id="enablePersistence"
              type="checkbox"
              checked={isPersistenceEnabled}
              onChange={(e) => setIsPersistenceEnabled(e.target.checked)}
              disabled={loading}
              className="rounded text-amber-500 focus:ring-amber-500 h-4 w-4 mr-2"
            />
            <label htmlFor="enablePersistence" className="text-sm font-medium">
              Enable secret persistence
            </label>
          </div>
          
          {isPersistenceEnabled && (
            <>
              <div className="bg-blue-900/20 border border-blue-500/30 text-blue-200 px-4 py-3 rounded mb-4 text-sm">
                Secrets will be stored in your browser using encrypted storage.
                They will never be sent to any server except when needed for API calls.
              </div>
              
              <div className="flex items-center">
                <input
                  id="passwordProtect"
                  type="checkbox"
                  checked={isPasswordProtected}
                  onChange={(e) => setIsPasswordProtected(e.target.checked)}
                  disabled={loading}
                  className="rounded text-amber-500 focus:ring-amber-500 h-4 w-4 mr-2"
                />
                <label htmlFor="passwordProtect" className="text-sm font-medium">
                  Protect with password (recommended)
                </label>
              </div>
              
              {isPasswordProtected && (
                <div className="pl-6 space-y-3">
                  {(secretManager as any).persistence?.passwordProtected && (
                    <>
                      <div className="flex flex-col">
                        <label htmlFor="oldPassword" className="text-sm font-medium mb-1">
                          Old Password
                        </label>
                        <input
                          id="oldPassword"
                          type="password"
                          value={oldPassword}
                          onChange={(e) => setOldPassword(e.target.value)}
                          disabled={loading}
                          required
                          className="bg-stone-700 border border-stone-600 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500"
                        />
                      </div>
                      <p className="text-xs text-gray-400">
                        Enter a new password to change it, or leave blank to keep the current one.
                      </p>
                    </>
                  )}
                  
                  <div className="flex flex-col">
                    <label htmlFor="password" className="text-sm font-medium mb-1">
                      Password
                    </label>
                    <input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={loading}
                      required
                      className="bg-stone-700 border border-stone-600 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                  
                  <div className="flex flex-col">
                    <label htmlFor="confirmPassword" className="text-sm font-medium mb-1">
                      Confirm Password
                    </label>
                    <input
                      id="confirmPassword"
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      disabled={loading}
                      required
                      className="bg-stone-700 border border-stone-600 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                  
                  <p className="text-xs text-gray-400">
                    This password will be used to encrypt your secrets. It will not be stored anywhere.
                    <strong> If you forget this password, you will lose access to your stored secrets.</strong>
                  </p>
                </div>
              )}
            </>
          )}
        </div>
        
        <div className="mt-6 flex justify-end space-x-3">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 bg-stone-700 text-white rounded hover:bg-stone-600 focus:outline-none focus:ring-2 focus:ring-stone-500"
          >
            Cancel
          </button>
          
          <button
            onClick={handleSave}
            disabled={loading || (isPasswordProtected && password !== confirmPassword)}
            className={`px-4 py-2 rounded focus:outline-none focus:ring-2 focus:ring-amber-500 flex items-center ${
              loading ? 'bg-amber-700 text-amber-200' : 'bg-amber-500 text-black hover:bg-amber-400'
            }`}
          >
            {loading && (
              <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            )}
            {loading ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}; 