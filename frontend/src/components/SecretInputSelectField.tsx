import React, { useState, useEffect, useRef } from 'react';
import { SecretInputField } from './SecretInputField';
import { secretManager } from '../services/SecretManager';

interface SecretInputSelectFieldProps {
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
}

export const SecretInputSelectField: React.FC<SecretInputSelectFieldProps> = (props) => {
  const [showingSelect, setShowingSelect] = useState(false);
  const [availableSecrets, setAvailableSecrets] = useState<Array<{ id: string; type: string; expiresAt: number; description?: string }>>([]);
  const [selectedSecretInfo, setSelectedSecretInfo] = useState<{id: string; description: string} | null>(null);
  const [displayValue, setDisplayValue] = useState('');
  const initialRender = useRef(true);
  
  // Load available secrets when the component mounts or secrets dialog is closed
  const loadSecrets = () => {
    // Get list of secrets from the secret manager
    const secretsList = secretManager.listSecrets();
    setAvailableSecrets(secretsList);
  };
  
  // Check if the initial value matches a secret name
  useEffect(() => {
    if (initialRender.current && props.value) {
      initialRender.current = false;
      
      // Check both direct and process.env. prefixed formats
      let secretName = props.value;
      let displayWithEnvPrefix = false;
      
      // If it starts with process.env., extract the name
      if (props.value.startsWith('process.env.')) {
        secretName = props.value.replace('process.env.', '');
        displayWithEnvPrefix = true;
      }
      
      // First check if it's a direct secret reference pattern (backwards compatibility)
      const secretPattern = /\$SECRET:([a-f0-9-]+)\$/;
      const match = props.value?.match(secretPattern);
      
      if (match && match[1]) {
        const secretId = match[1];
        // Find secret description from available secrets
        const secret = availableSecrets.find(s => s.id === secretId);
        if (secret) {
          setSelectedSecretInfo({
            id: secretId,
            description: secret.description || 'Unnamed Secret'
          });
          setDisplayValue(`process.env.${secret.description || 'ENV_VAR'}`);
          
          // Update the parent with just the secret name
          if (secret.description) {
            props.onChange(secret.description);
          }
        } else {
          // Try to get info from secretManager
          const secretsList = secretManager.listSecrets();
          const secretFromManager = secretsList.find(s => s.id === secretId);
          if (secretFromManager) {
            setSelectedSecretInfo({
              id: secretId,
              description: secretFromManager.description || 'Unnamed Secret'
            });
            setDisplayValue(`process.env.${secretFromManager.description || 'ENV_VAR'}`);
            
            // Update the parent with just the secret name
            if (secretFromManager.description) {
              props.onChange(secretFromManager.description);
            }
          } else {
            setDisplayValue(props.value);
          }
        }
      } 
      // Try to find a secret with matching name
      else {
        const secretsList = secretManager.listSecrets();
        const secretWithMatchingName = secretsList.find(s => 
          s.description?.toLowerCase() === secretName.toLowerCase()
        );
        
        if (secretWithMatchingName) {
          // Found a secret with this name, link to it
          setSelectedSecretInfo({
            id: secretWithMatchingName.id,
            description: secretWithMatchingName.description || 'Unnamed Secret'
          });
          
          // Set display value
          if (displayWithEnvPrefix || !props.value.startsWith('process.env.')) {
            setDisplayValue(`process.env.${secretName}`);
          } else {
            setDisplayValue(props.value);
          }
        } else {
          // No matching secret, just use the value as is
          setDisplayValue(props.value);
        }
      }
    }
  }, [props.value, availableSecrets, props.onChange]);
  
  // Load secrets on component mount
  useEffect(() => {
    loadSecrets();
    
    // Add event listener to reload secrets when the secrets dialog is closed
    const handleClick = (e: MouseEvent) => {
      // If the clicked element is the close button for the secrets manager
      if ((e.target as HTMLElement).closest('[aria-label="Close"]') && 
          document.querySelector('.bg-stone-800 h2')?.textContent?.includes('Secrets Manager')) {
        // Wait a moment for the dialog to close and secrets to be saved
        setTimeout(() => {
          loadSecrets();
          // If we have a selected secret, refresh its information
          if (selectedSecretInfo) {
            const secretsList = secretManager.listSecrets();
            const updatedSecret = secretsList.find(s => s.id === selectedSecretInfo.id);
            if (updatedSecret) {
              setSelectedSecretInfo({
                id: selectedSecretInfo.id,
                description: updatedSecret.description || 'Unnamed Secret'
              });
              setDisplayValue(`process.env.${updatedSecret.description || 'ENV_VAR'}`);
            }
          }
        }, 300);
      }
    };
    
    document.addEventListener('click', handleClick);
    return () => {
      document.removeEventListener('click', handleClick);
    };
  }, [selectedSecretInfo]);

  // Handle selecting a secret from the dropdown
  const handleSelectSecret = (secretId: string, description?: string) => {
    // Store the secret name/description in the parent component instead of the reference
    const secretName = description || 'ENV_VAR';
    
    // Update the selected secret info (for internal tracking)
    setSelectedSecretInfo({
      id: secretId,
      description: secretName
    });
    
    // Set display value to process.env format
    setDisplayValue(`process.env.${secretName}`);
    
    // Update the parent component with just the secret name
    props.onChange(secretName);
    
    // If a callback for secret changes is provided, call it
    if (props.onSecretChange) {
      props.onSecretChange(secretId, true);
    }
    
    // Hide the select dropdown
    setShowingSelect(false);
  };
  
  // Handle direct input change
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setDisplayValue(newValue);
    
    // Check for process.env. pattern
    let envVarName = newValue;
    
    // If it starts with process.env., extract the variable name
    if (newValue.startsWith('process.env.')) {
      envVarName = newValue.replace('process.env.', '');
    }
    
    // Try to find a secret with matching name (either exact match or after process.env.)
    const secretsList = secretManager.listSecrets();
    const secretWithMatchingName = secretsList.find(s => 
      s.description?.toLowerCase() === envVarName.toLowerCase() ||
      s.description?.toLowerCase() === newValue.toLowerCase()
    );
    
    if (secretWithMatchingName) {
      // We found a matching secret, track it internally
      setSelectedSecretInfo({
        id: secretWithMatchingName.id,
        description: secretWithMatchingName.description || 'Unnamed Secret'
      });
      
      // Return just the secret name to parent
      props.onChange(envVarName);
      return;
    }
    
    // No matching secret, clear selection
    setSelectedSecretInfo(null);
    
    // Pass the raw value to parent
    props.onChange(newValue);
  };

  // Open the secrets manager dialog
  const openSecretsManager = () => {
    const secretsButton = document.querySelector<HTMLButtonElement>('[title="Manage Secrets"]');
    if (secretsButton) {
      secretsButton.click();
    }
  };

  return (
    <div className={`mb-4 ${props.className || ''}`}>
      <label className="block text-sm font-medium text-gray-300 mb-1" htmlFor={props.id}>
        {props.label}
        {props.required && <span className="text-red-500 ml-1">*</span>}
      </label>
      
      <div className="relative">
        {/* Input field with direct text input */}
        <input
          id={props.id}
          type="text"
          value={displayValue}
          onChange={handleInputChange}
          placeholder={props.placeholder || "process.env.SECRET_NAME"}
          autoFocus={props.autoFocus}
          className={`p-2 w-full pr-14 rounded-md border-gray-600 bg-stone-700 text-gray-200 shadow-sm focus:border-amber-500 focus:ring-amber-500 ${showingSelect ? 'opacity-50 pointer-events-none' : ''}`}
          required={props.required}
        />
        
        {/* Clear button */}
        <button
          type="button"
          onClick={() => {
            setDisplayValue('');
            setSelectedSecretInfo(null);
            props.onChange('');
          }}
          className="absolute right-1 top-1/2 transform -translate-y-1/2 w-8 h-8 flex items-center justify-center text-gray-400 hover:text-red-400 focus:outline-none focus:text-red-500"
          aria-label="Clear value"
          tabIndex={-1}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        
        {/* Show/hide select dropdown button */}
        <button
          type="button"
          onClick={() => {
            setShowingSelect(!showingSelect);
            if (!showingSelect) {
              // Refresh the secrets list when opening the dropdown
              loadSecrets();
            }
          }}
          className="absolute right-10 top-1/2 transform -translate-y-1/2 w-8 h-8 flex items-center justify-center text-gray-400 hover:text-amber-400 focus:outline-none focus:text-amber-500"
          aria-label="Select from existing secrets"
          title="Select from existing secrets"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>
      
      {/* Description row with secret link info */}
      <div className="mt-1 flex justify-between items-center">
        {/* Component description (left side) */}
        {props.description && (
          <p className="text-xs text-gray-400">{props.description}</p>
        )}
        
        {/* Secret link indicator (right side) */}
        {selectedSecretInfo && (
          <div className="text-xs text-amber-400 flex items-center flex-shrink-0 ml-2">
            <svg className="h-3 w-3 inline-block mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Linked to secret: {selectedSecretInfo.description}
          </div>
        )}
        
        {/* If no description but we have a selected secret, ensure proper spacing */}
        {!props.description && selectedSecretInfo && <div className="flex-grow"></div>}
      </div>
      
      {/* Secret selection dropdown */}
      {showingSelect && (
        <div className="mt-1 p-2 bg-stone-800 border border-stone-600 rounded-md shadow-lg max-h-60 overflow-y-auto z-10">
          {availableSecrets.length === 0 ? (
            <div className="p-2 text-gray-400 text-sm">
              <p>No secrets found.</p>
              <button 
                onClick={openSecretsManager}
                className="mt-1 text-amber-400 hover:text-amber-300 text-xs underline"
              >
                Manage Secrets
              </button>
            </div>
          ) : (
            <>
              <div className="p-2 border-b border-stone-700 flex justify-between items-center">
                <span className="text-xs font-medium text-gray-300">Select a Secret</span>
                <button 
                  onClick={openSecretsManager}
                  className="text-amber-400 hover:text-amber-300 text-xs underline"
                >
                  Manage Secrets
                </button>
              </div>
              <ul className="py-1">
                {availableSecrets.map((secret) => (
                  <li key={secret.id}>
                    <button
                      type="button"
                      onClick={() => handleSelectSecret(secret.id, secret.description)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-stone-700 rounded focus:outline-none focus:ring-1 focus:ring-amber-500"
                    >
                      <div className="font-medium text-amber-300">
                        process.env.{secret.description || 'ENV_VAR'}
                      </div>
                      <div className="text-xs text-gray-400 truncate">
                        ID: {secret.id.substring(0, 8)}...
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}; 