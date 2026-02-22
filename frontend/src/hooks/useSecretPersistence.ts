import { useState, useEffect, useCallback } from 'react';
import { secretManager } from '../services/SecretManager';

// Declare custom event on WindowEventMap (also declared in Sidebar.tsx; duplicated here for standalone usage)
declare global {
  interface WindowEventMap {
    'secret-persistence-change': CustomEvent<{ enabled: boolean; passwordProtected: boolean }>;
  }
}

// Utility function to hash passwords before storing
const hashPassword = async (password: string): Promise<string> => {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

// Utility function to verify a password against a saved hash
const verifyPassword = async (password: string, savedHash: string): Promise<boolean> => {
  const hashedPassword = await hashPassword(password);
  return hashedPassword === savedHash;
};

export interface SecretPersistenceState {
  // Toggle states
  isPersistenceEnabled: boolean;
  setIsPersistenceEnabled: (v: boolean) => void;
  isPasswordProtected: boolean;
  setIsPasswordProtected: (v: boolean) => void;

  // Password fields
  password: string;
  setPassword: (v: string) => void;
  confirmPassword: string;
  setConfirmPassword: (v: string) => void;
  oldPassword: string;
  setOldPassword: (v: string) => void;

  // UI states
  isChangingPassword: boolean;
  setIsChangingPassword: (v: boolean) => void;
  loading: boolean;
  error: string | null;
  success: string | null;
  showRemovePasswordConfirm: boolean;
  setShowRemovePasswordConfirm: (v: boolean) => void;
  hasSavedPassword: boolean;
  needsDatabaseUnlock: boolean;
  isDatabaseLocked: boolean;

  // Actions
  handleSavePersistence: () => Promise<void>;
  handleRemovePasswordConfirm: () => Promise<void>;
  handlePasswordProtectedToggle: (checked: boolean) => void;
}

/**
 * Encapsulates all secret-persistence state & logic that was previously
 * inlined in the Sidebar component (~250 lines of state + effects + handlers).
 */
export function useSecretPersistence(
  activeTab: string,
  showToast: (msg: string, type: 'success' | 'error' | 'warning' | 'info', duration?: number) => void,
): SecretPersistenceState {
  // ── State ──────────────────────────────────────────────────────────────
  const [isPersistenceEnabled, setIsPersistenceEnabled] = useState(false);
  const [isPasswordProtected, setIsPasswordProtected] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [oldPassword, setOldPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showRemovePasswordConfirm, setShowRemovePasswordConfirm] = useState(false);
  const [hasSavedPassword, setHasSavedPassword] = useState(false);
  const [needsDatabaseUnlock, setNeedsDatabaseUnlock] = useState(false);
  const [isDatabaseLocked, setIsDatabaseLocked] = useState(false);

  // ── Helpers ────────────────────────────────────────────────────────────

  /** Read the saved password hash from sessionStorage, or null */
  const getSavedHash = (): string | null => {
    try {
      const raw = sessionStorage.getItem('secretManagerSettings');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed.password || null;
    } catch {
      return null;
    }
  };

  /** Persist settings to sessionStorage */
  const saveSessionSettings = async (opts: {
    persistenceEnabled: boolean;
    passwordProtected: boolean;
    passwordPlaintext?: string;
  }) => {
    const settingsToSave = {
      persistenceEnabled: opts.persistenceEnabled,
      passwordProtected: opts.passwordProtected,
      password: opts.passwordProtected && opts.passwordPlaintext
        ? await hashPassword(opts.passwordPlaintext)
        : '',
    };
    sessionStorage.setItem('secretManagerSettings', JSON.stringify(settingsToSave));
  };

  /** Refresh component state from the actual SecretManager status */
  const syncFromManager = () => {
    const status = {
      enabled: secretManager.persistenceState?.enabled || false,
      passwordProtected: secretManager.persistenceState?.passwordProtected || false,
    };
    setIsPersistenceEnabled(status.enabled);
    setIsPasswordProtected(status.passwordProtected);

    if (status.enabled && status.passwordProtected) {
      const secrets = secretManager.listSecrets();
      setIsDatabaseLocked(secrets.length === 0);
    } else {
      setIsDatabaseLocked(false);
    }
    return status;
  };

  // ── Effects ────────────────────────────────────────────────────────────

  // Initialize SecretManager when secrets tab is opened
  useEffect(() => {
    if (activeTab !== 'secrets') return;

    const init = async () => {
      console.log('Initializing secret manager for secrets tab');
      const initialStatus = {
        persistenceEnabled: secretManager.persistenceState?.enabled || false,
        passwordProtected: secretManager.persistenceState?.passwordProtected || false,
      };
      console.log('Initial persistence status:', initialStatus);

      if (initialStatus.persistenceEnabled && initialStatus.passwordProtected) {
        const secrets = secretManager.listSecrets();
        const isLocked = secrets.length === 0;
        setIsDatabaseLocked(isLocked);

        if (isLocked) {
          console.log('Database is password-protected but appears to be locked');
          try {
            const raw = sessionStorage.getItem('secretManagerSettings');
            if (raw) {
              const s = JSON.parse(raw);
              if (s.persistenceEnabled && s.passwordProtected) {
                console.log('Need to unlock the password-protected database');
                setNeedsDatabaseUnlock(true);
                setHasSavedPassword(true);
                setIsPersistenceEnabled(true);
                setIsPasswordProtected(true);
                setError('Please enter your password to unlock your secret database');
                showToast('Please enter your password to unlock your secret database', 'info');
              }
            }
          } catch (e) {
            console.error('Error parsing session settings:', e);
          }
        }
      } else {
        setIsDatabaseLocked(false);
      }

      setIsPersistenceEnabled(initialStatus.persistenceEnabled);
      setIsPasswordProtected(initialStatus.passwordProtected);

      if (!initialStatus.persistenceEnabled) {
        try {
          const raw = sessionStorage.getItem('secretManagerSettings');
          if (raw) {
            const s = JSON.parse(raw);
            if (s.persistenceEnabled && s.passwordProtected && s.password) {
              console.log('Found saved persistence settings in session storage');
              setHasSavedPassword(true);
              setIsChangingPassword(true);
            }
          }
        } catch (e) {
          console.error('Error parsing session settings:', e);
        }
      }
    };

    init();
  }, [activeTab, showToast]);

  // Initialize persistence on mount (regardless of active tab)
  useEffect(() => {
    const init = async () => {
      try {
        const raw = sessionStorage.getItem('secretManagerSettings');
        let settingsFromSession: { persistenceEnabled?: boolean; passwordProtected?: boolean; password?: string } | null = null;

        if (raw) {
          try {
            settingsFromSession = JSON.parse(raw);
            console.log('Found session settings:', settingsFromSession);
            const hasPassword = !!settingsFromSession?.password;
            setHasSavedPassword(hasPassword);
            if (hasPassword && settingsFromSession?.passwordProtected) {
              setIsChangingPassword(true);
            } else {
              setIsChangingPassword(false);
            }
          } catch (e) {
            console.error('Failed to parse session settings:', e);
          }
        }

        if (!secretManager.initialized) {
          console.log('Initializing secret manager...');
          await secretManager.initialize();
        }

        if (settingsFromSession?.persistenceEnabled) {
          console.log('Applying session settings to secret manager');
          try {
            await secretManager.enablePersistence({
              passwordProtected: settingsFromSession.passwordProtected,
              password: settingsFromSession.password,
            });
            console.log('Persistence settings applied successfully');
          } catch (e) {
            console.error('Failed to apply persistence settings:', e);
          }
        }

        const initialStatus = {
          persistenceEnabled: secretManager.persistenceState?.enabled || false,
          passwordProtected: secretManager.persistenceState?.passwordProtected || false,
        };
        console.log('Initial status after initialization:', initialStatus);
        setIsPersistenceEnabled(initialStatus.persistenceEnabled);
        setIsPasswordProtected(initialStatus.passwordProtected);

        try {
          if (raw) {
            const parsed = JSON.parse(raw);
            setHasSavedPassword(!!parsed.password);
          }
        } catch (e) {
          console.error('Error checking for saved password:', e);
        }
      } catch (err) {
        console.error('Failed to initialize secret manager:', err);
      }
    };

    init();

    const handlePersistenceChange = (event: CustomEvent<{ enabled: boolean; passwordProtected: boolean }>) => {
      setIsPersistenceEnabled(event.detail.enabled);
      setIsPasswordProtected(event.detail.passwordProtected);
    };

    window.addEventListener('secret-persistence-change', handlePersistenceChange);
    return () => {
      window.removeEventListener('secret-persistence-change', handlePersistenceChange);
    };
  }, []);

  // ── Handlers ───────────────────────────────────────────────────────────

  /** Called when the "Password protect" checkbox changes */
  const handlePasswordProtectedToggle = useCallback((checked: boolean) => {
    setIsPasswordProtected(checked);
    if (checked && hasSavedPassword && secretManager.persistenceState?.passwordProtected) {
      setIsChangingPassword(true);
    } else if (checked && !hasSavedPassword) {
      setIsChangingPassword(false);
    }
  }, [hasSavedPassword]);

  /** Called when user confirms the "Remove Password Protection" dialog */
  const handleRemovePasswordConfirm = useCallback(async () => {
    setShowRemovePasswordConfirm(false);
    setIsPasswordProtected(false);
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      await secretManager.resetDatabase();

      await secretManager.enablePersistence({
        passwordProtected: false,
        clearExisting: true,
      });

      await saveSessionSettings({
        persistenceEnabled: true,
        passwordProtected: false,
      });

      setHasSavedPassword(false);
      setSuccess('Password protection removed and encrypted data cleared');
      showToast(
        'Password protection removed. Secrets can now be viewed by anyone with access to this browser.',
        'warning',
        8000,
      );

      setPassword('');
      setConfirmPassword('');
      setOldPassword('');
      setIsChangingPassword(false);
    } catch (err) {
      console.error('Error removing password protection:', err);
      const msg = `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  /** Main save handler */
  const handleSavePersistence = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      // Check if removing password protection that was previously enabled
      if (
        isPersistenceEnabled &&
        !isPasswordProtected &&
        hasSavedPassword &&
        secretManager.persistenceState?.passwordProtected
      ) {
        setLoading(false);
        setShowRemovePasswordConfirm(true);
        return;
      }

      if (isPersistenceEnabled) {
        // ── Enable persistence ──
        if (isPasswordProtected) {
          // With password protection
          if (password !== confirmPassword) {
            setError('Passwords do not match');
            showToast('Passwords do not match', 'error');
            setLoading(false);
            return;
          }
          if (password.length < 8) {
            setError('Password must be at least 8 characters long');
            showToast('Password must be at least 8 characters long', 'error');
            setLoading(false);
            return;
          }

          if (hasSavedPassword && isChangingPassword) {
            const savedHash = getSavedHash();
            if (savedHash) {
              const oldHashMatches = await verifyPassword(oldPassword, savedHash);
              if (!oldHashMatches) {
                setError('Your current password is incorrect');
                showToast('Your current password is incorrect', 'error');
                setLoading(false);
                return;
              }
            }
            console.log('Changing password with verification');
            const succeeded = await secretManager.changePassword(password, oldPassword);
            if (!succeeded) {
              setError('Failed to change password. Please check your current password.');
              showToast('Failed to change password. Please check your current password.', 'error');
              setLoading(false);
              return;
            }
            setSuccess('Password changed successfully');
            showToast('Password changed successfully', 'success');
          } else {
            if (hasSavedPassword && !isChangingPassword) {
              const savedHash = getSavedHash();
              if (savedHash) {
                const newHashMatches = await verifyPassword(password, savedHash);
                if (!newHashMatches) {
                  setError('The password entered does not match your saved password');
                  showToast('The password entered does not match your saved password', 'error');
                  setLoading(false);
                  return;
                }
              }
            }
            console.log('Enabling persistence with password protection for the first time');
            await secretManager.enablePersistence({
              passwordProtected: true,
              password,
              clearExisting: true,
            });
            setSuccess('Encrypted persistence enabled with password protection');
            showToast('Encrypted persistence enabled with password protection', 'success');
          }
        } else {
          // Without password protection
          if (hasSavedPassword) {
            const savedHash = getSavedHash();
            if (savedHash && oldPassword) {
              const oldHashMatches = await verifyPassword(oldPassword, savedHash);
              if (!oldHashMatches) {
                setError('Your current password is incorrect');
                showToast('Your current password is incorrect', 'error');
                setLoading(false);
                return;
              }
            } else if (savedHash) {
              setError('Please enter your current password to remove protection');
              showToast('Please enter your current password to remove protection', 'error');
              setLoading(false);
              return;
            }
            await secretManager.resetDatabase();
          }

          await secretManager.enablePersistence({
            passwordProtected: false,
            clearExisting: hasSavedPassword,
          });
          console.log('Enabling persistence without password protection');
          setSuccess('Persistence enabled without password protection');
          showToast(
            'Secrets stored without password protection can be viewed by anyone with access to this browser. Consider enabling password protection for better security.',
            'warning',
            8000,
          );
          setHasSavedPassword(false);
          setPassword('');
          setConfirmPassword('');
          setOldPassword('');
        }

        await saveSessionSettings({
          persistenceEnabled: true,
          passwordProtected: isPasswordProtected,
          passwordPlaintext: isPasswordProtected ? password : undefined,
        });
      } else {
        // ── Disable persistence ──
        console.log('Disabling persistence');
        await secretManager.disablePersistence(true);
        console.log('After disablePersistence call, status:', secretManager.persistenceState);
        setSuccess('Persistence disabled and storage cleared');
        showToast('Persistence disabled and storage cleared', 'success');
        setHasSavedPassword(false);
        setPassword('');
        setConfirmPassword('');
        setOldPassword('');
        setIsChangingPassword(false);
        console.log('Removing settings from session storage');
        sessionStorage.removeItem('secretManagerSettings');
      }

      // Sync from actual manager state
      const currentStatus = syncFromManager();
      console.log('Current secret manager status:', currentStatus);

      // Dispatch change event
      console.log('Dispatching persistence change event:', currentStatus);
      window.dispatchEvent(
        new CustomEvent('secret-persistence-change', { detail: currentStatus }),
      );
    } catch (err) {
      console.error('Error saving persistence settings:', err);
      const msg = `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  }, [
    isPersistenceEnabled,
    isPasswordProtected,
    hasSavedPassword,
    isChangingPassword,
    password,
    confirmPassword,
    oldPassword,
    showToast,
  ]);

  return {
    isPersistenceEnabled,
    setIsPersistenceEnabled,
    isPasswordProtected,
    setIsPasswordProtected,
    password,
    setPassword,
    confirmPassword,
    setConfirmPassword,
    oldPassword,
    setOldPassword,
    isChangingPassword,
    setIsChangingPassword,
    loading,
    error,
    success,
    showRemovePasswordConfirm,
    setShowRemovePasswordConfirm,
    hasSavedPassword,
    needsDatabaseUnlock,
    isDatabaseLocked,
    handleSavePersistence,
    handleRemovePasswordConfirm,
    handlePasswordProtectedToggle,
  };
}
