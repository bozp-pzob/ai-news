import React, { useState, useEffect, useRef } from 'react';
import { secretManager } from '../services/SecretManager';

interface SecretInputFieldProps {
  id: string;
  label: string;
  value?: string;
  onChange: (value: string) => void;
  onSecretChange?: (secretId: string, hasValue: boolean) => void;
  placeholder?: string;
  required?: boolean;
  description?: string;
  secretType: string;
  autoFocus?: boolean;
  className?: string;
  customSecretManager?: {
    openSecretsManager: () => void;
  };
  allowPlainText?: boolean;
}

/**
 * A secure input field for sensitive data that stores the actual value in memory
 * and provides only a reference ID to the parent component.
 */
export const SecretInputField: React.FC<SecretInputFieldProps> = ({
  id,
  label,
  value = '',
  onChange,
  onSecretChange,
  placeholder = '',
  required = false,
  description,
  secretType,
  autoFocus = false,
  className = '',
  customSecretManager,
  allowPlainText = false,
}) => {
  // State for the display value (shown in the UI)
  const [displayValue, setDisplayValue] = useState('');
  // State to track if the input has been edited 
  const [isEdited, setIsEdited] = useState(false);
  // State to track if the secret is already stored
  const [hasStoredSecret, setHasStoredSecret] = useState(false);
  // Reference to track if this is the initial mount
  const isInitialMount = useRef(true);

  // Check if the initial value is a secret reference
  useEffect(() => {
    const checkInitialValue = async () => {
      // Check if value contains a secret reference pattern
      const secretPattern = /\$SECRET:([a-f0-9-]+)\$/;
      const match = value.match(secretPattern);
      
      if (match && match[1]) {
        const secretId = match[1];
        // Check if the secret exists
        if (secretManager.hasValidSecret(secretId)) {
          // Set a placeholder to indicate a secret is stored
          setDisplayValue('••••••••••••••');
          setHasStoredSecret(true);
          setIsEdited(false);
          return;
        }
      } 
      
      // If no valid secret or no secret reference, use the actual value
      if (value && value !== '' && !isEdited) {
        setDisplayValue(value);
        // If this is the initial mount and there's a value, we should store it as a secret only if not in plain text mode
        if (isInitialMount.current && !allowPlainText) {
          storeSecret(value);
        }
      }
    };
    
    checkInitialValue();
    
    // After the first render, this is no longer the initial mount
    if (isInitialMount.current) {
      isInitialMount.current = false;
    }
  }, [value, allowPlainText]);

  // Store a new secret and return the reference
  const storeSecret = async (secretValue: string) => {
    if (!secretValue || secretValue === '') {
      // If clearing the field, notify parent (if needed)
      if (hasStoredSecret && onSecretChange) {
        onSecretChange('', false);
      }
      setHasStoredSecret(false);
      return '';
    }
    
    try {
      // Store the secret and get its reference ID
      const secretId = await secretManager.storeSecret(
        secretValue,
        secretType,
        undefined, // use default TTL
        `${label} for ${id}` // description
      );
      
      // Create a reference string
      const secretRef = `$SECRET:${secretId}$`;
      
      // Notify the parent component about the new secret
      onChange(secretRef);
      if (onSecretChange) {
        onSecretChange(secretId, true);
      }
      
      setHasStoredSecret(true);
      return secretRef;
    } catch (error) {
      console.error('Failed to store secret:', error);
      return secretValue; // fallback to the plain value
    }
  };
  
  // Handle input change
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setDisplayValue(newValue);
    setIsEdited(true);
    
    // If we're allowing plain text, update the parent directly with the plain text value
    if (allowPlainText) {
      onChange(newValue);
    }
    // Otherwise, don't update the actual value until blur (to reduce unnecessary secret creation)
  };
  
  // Handle blur event - when field loses focus
  const handleBlur = async () => {
    if (isEdited) {
      if (allowPlainText) {
        // In plain text mode, we don't need to store as a secret
        setIsEdited(false);
      } else {
        // Store the secret and get a reference
        await storeSecret(displayValue);
        setIsEdited(false);
        
        // If we successfully stored a secret, replace with placeholder
        if (displayValue !== '') {
          setDisplayValue('••••••••••••••');
        }
      }
    }
  };
  
  // Handle clearing the input
  const handleClear = () => {
    setDisplayValue('');
    setIsEdited(true);
    setHasStoredSecret(false);
    onChange('');
    if (onSecretChange) {
      onSecretChange('', false);
    }
  };

  // Determine the input type based on whether it's being edited or secured
  const getInputType = () => {
    // When allowing plain text or while editing, show as text
    if (allowPlainText || isEdited) {
      return 'text';
    }
    // Otherwise, show as password
    return 'password';
  };
  
  // Handle opening the Secrets Manager
  const openSecretsManager = () => {
    if (customSecretManager) {
      // Use the provided custom function if available
      customSecretManager.openSecretsManager();
    } else {
      // Default behavior for backward compatibility
      const secretsButton = document.querySelector<HTMLButtonElement>('[title="Manage Secrets"]');
      if (secretsButton) {
        secretsButton.click();
      } else {
        // Fallback to the old settings button if the new one isn't found
        const settingsButton = document.querySelector<HTMLButtonElement>('[title="Manage Secret Storage Settings"]');
        if (settingsButton) {
          settingsButton.click();
        }
      }
    }
  };

  return (
    <div className={`mb-4 ${className}`}>
      <label className="block text-sm font-medium text-gray-300 mb-1" htmlFor={id}>
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>
      
      <div className="relative">
        <input
          id={id}
          type={getInputType()}
          value={displayValue}
          onChange={handleChange}
          onBlur={handleBlur}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className="p-2 w-full pr-14 rounded-md border-gray-600 bg-stone-700 text-gray-200 shadow-sm focus:border-amber-500 focus:ring-amber-500"
          required={required}
        />
        
        {/* Visual indicator when a secret is stored */}
        {hasStoredSecret && !isEdited && !allowPlainText && (
          <span className="absolute right-10 top-1/2 transform -translate-y-1/2 text-xs px-1.5 py-0.5 rounded-full bg-green-800 text-green-200">
            Secured
          </span>
        )}
        
        {/* Clear button */}
        <button
          type="button"
          onClick={handleClear}
          className="absolute right-1 top-1/2 transform -translate-y-1/2 w-8 h-8 flex items-center justify-center text-gray-400 hover:text-red-400 focus:outline-none focus:text-red-500"
          aria-label="Clear value"
          tabIndex={-1}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      
      {description && (
        <p className="mt-1 text-xs text-gray-400">{description}</p>
      )}
      
      {/* Security notice - only show when not in plain text mode */}
      {!allowPlainText && (
        <p className="mt-1 text-xs text-emerald-400">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 inline-block mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          Secured in memory by default. <span className="cursor-pointer font-medium hover:underline" onClick={openSecretsManager}>
            Manage Secrets
          </span> or configure <span className="cursor-pointer font-medium hover:underline" onClick={() => {
            const settingsButton = document.querySelector<HTMLButtonElement>('[title="Manage Secret Storage Settings"]');
            if (settingsButton) {
              settingsButton.click();
            }
          }}>persistence settings</span>.
        </p>
      )}
    </div>
  );
}; 