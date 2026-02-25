import React, { useState, useEffect, useRef } from 'react';
import { Config } from '../types';
import { useToast } from './ToastProvider';
import { configStateManager } from '../services/ConfigStateManager';

interface ConfigJsonEditorProps {
  config: Config;
  onConfigUpdate: (config: Config) => void;
  saveConfig?: () => Promise<boolean>;
  readOnly?: boolean;
}

export const ConfigJsonEditor: React.FC<ConfigJsonEditorProps> = ({ 
  config, 
  onConfigUpdate,
  saveConfig,
  readOnly = false
}) => {
  const [jsonText, setJsonText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [errorLine, setErrorLine] = useState<number | null>(null);
  const [cursorPosition, setCursorPosition] = useState<number>(0);
  const [currentLine, setCurrentLine] = useState<number>(1);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState<boolean>(false);
  const { showToast } = useToast();
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const isInternalUpdate = useRef<boolean>(false);
  const lastParsedConfig = useRef<string>('');
  const lastConfigProp = useRef<string>('');

  // Format the JSON with proper indentation when component mounts or config changes
  useEffect(() => {
    // If this update was triggered internally, skip processing
    if (isInternalUpdate.current) return;

    try {
      // Get the JSON string representation of the current config
      const configString = JSON.stringify(config);
      
      // Store the current config prop for comparison with future updates
      const previousConfigProp = lastConfigProp.current;
      lastConfigProp.current = configString;
      
      // If this is exactly the same config we already processed, skip entirely
      if (lastParsedConfig.current === configString) {
        return;
      }
      
      // Check if there's stored editor text from a previous editing session
      const storedText = configStateManager.getCurrentEditorText();
      
      // If we have no stored text, this is initial load, or the config has completely changed
      // (determined by comparing with previous config prop)
      if (!storedText || !storedText.trim() || (previousConfigProp && previousConfigProp !== configString)) {
        // Use the formatted config
        const formatted = JSON.stringify(config, null, 2);
        setJsonText(formatted);
        
        // Update our reference of the last parsed config
        lastParsedConfig.current = configString;
        
        // Reset error states
        setError(null);
        setErrorLine(null);
        setHasUnsavedChanges(false);
        
        // Store the initial text in the state manager
        configStateManager.setCurrentEditorText(formatted);
        
        // Update line numbers after text changes
        setTimeout(updateLineNumbers, 0);
        return;
      }
      
      // We have stored text from a previous session, check if it's valid
      try {
        // Try to parse the stored text
        const parsed = JSON.parse(storedText);
        const parsedString = JSON.stringify(parsed);
        
        // Keep using the stored text
        setJsonText(storedText);
        
        // But update our last parsed config reference
        lastParsedConfig.current = parsedString;
        
        // Clear any previous errors
        setError(null);
        setErrorLine(null);
        
        // Check if the stored text represents a different config
        setHasUnsavedChanges(configString !== parsedString);
      } catch (parseErr: any) {
        // The stored text has invalid JSON syntax
        
        // Still use it in the editor (user might be in the middle of editing)
        setJsonText(storedText);
        
        // But show the error
        setError(`JSON syntax error: ${parseErr.message}`);
        setErrorLine(extractErrorLineNumber(parseErr.message));
        setHasUnsavedChanges(true);
      }
      
      // Update line numbers after text changes
      setTimeout(updateLineNumbers, 0);
    } catch (err) {
      setError('Error parsing configuration');
      console.error('Error parsing configuration:', err);
    }
  }, [config]);

  // Update line numbers whenever the text changes
  useEffect(() => {
    updateLineNumbers();
  }, [jsonText, currentLine, errorLine]);

  // Scroll line numbers in sync with textarea
  useEffect(() => {
    const textArea = textAreaRef.current;
    const lineNumbers = lineNumbersRef.current;
    
    if (!textArea || !lineNumbers) return;
    
    const handleScroll = () => {
      if (lineNumbers) {
        lineNumbers.scrollTop = textArea.scrollTop;
      }
    };
    
    textArea.addEventListener('scroll', handleScroll);
    return () => {
      textArea.removeEventListener('scroll', handleScroll);
    };
  }, []);

  // Get the current line number from cursor position
  const getCurrentLineNumber = (text: string, cursorPos: number): number => {
    // Count newlines before cursor position
    const textBeforeCursor = text.substring(0, cursorPos);
    return (textBeforeCursor.match(/\n/g) || []).length + 1;
  };

  // Extract line number from JSON parse error message
  const extractErrorLineNumber = (errorMessage: string): number | null => {
    // Look for patterns like "at line 2 column 3" or "in JSON at position 42"
    const lineMatch = errorMessage.match(/at line (\d+)/i);
    if (lineMatch && lineMatch[1]) {
      return parseInt(lineMatch[1], 10);
    }
    
    // If position is mentioned, we can calculate the line
    const posMatch = errorMessage.match(/at position (\d+)/i);
    if (posMatch && posMatch[1]) {
      const position = parseInt(posMatch[1], 10);
      return getCurrentLineNumber(jsonText, position);
    }
    
    return null;
  };

  // Generate and update line numbers
  const updateLineNumbers = () => {
    if (!lineNumbersRef.current) return;
    
    const lines = jsonText.split('\n');
    const lineCount = lines.length;
    
    // Create a container for better layout control
    let lineNumbersHTML = '<div style="position: relative; height: 100%;">';
    
    // Add each line number with exact positioning
    for (let i = 0; i < lineCount; i++) {
      const lineNum = i + 1;
      const isCurrentLine = lineNum === currentLine;
      const isErrorLine = lineNum === errorLine;
      
      // Set different classes based on line status
      let lineClass = "text-stone-400";
      let bgClass = "";
      
      if (isErrorLine) {
        lineClass = "text-red-500 font-bold";
        bgClass = "bg-red-50";
      } else if (isCurrentLine) {
        lineClass = "text-emerald-600";
        bgClass = "bg-emerald-50/50";
      }
      
      lineNumbersHTML += `<div class="text-right pr-2 select-none ${lineClass} ${bgClass}" 
                             style="position: absolute; width: 100%; top: ${i * 1.5}rem; height: 1.5rem; line-height: 1.5rem;">
                             ${lineNum}
                         </div>`;
    }
    
    lineNumbersHTML += '</div>';
    lineNumbersRef.current.innerHTML = lineNumbersHTML;
  };

  // Handle text change with syntax highlighting
  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    // Skip all processing if in read-only mode
    if (readOnly) return;
    
    // Get the new text
    const newText = e.target.value;
    const prevText = jsonText;
    
    // Skip processing if the text hasn't changed
    if (prevText === newText) return;
    
    // Set flag to ignore updates from ConfigStateManager
    isInternalUpdate.current = true;
    
    try {
      // Always update the text in the editor
      setJsonText(newText);
      
      // Always store the current text in ConfigStateManager
      configStateManager.setCurrentEditorText(newText);
      
      // Update cursor position
      if (textAreaRef.current) {
        const cursorPos = textAreaRef.current.selectionStart;
        setCursorPosition(cursorPos);
        setCurrentLine(getCurrentLineNumber(newText, cursorPos));
      }
      
      // Try to parse the JSON to see if it's valid
      let parsedJson;
      let isValidJson = false;
      
      try {
        parsedJson = JSON.parse(newText);
        isValidJson = true;
        setError(null);
        setErrorLine(null);
      } catch (parseErr: any) {
        // Only show errors for non-empty text
        if (newText.trim()) {
          setError(`JSON syntax error: ${parseErr.message}`);
          setErrorLine(extractErrorLineNumber(parseErr.message));
        } else {
          setError(null);
          setErrorLine(null);
        }
        
        // For invalid JSON, just mark as having unsaved changes and exit
        setHasUnsavedChanges(true);
        return;
      }
      
      // At this point we have valid JSON
      
      // Helper function to check if a change is just whitespace formatting
      const isWhitespaceOnlyChange = (oldText: string, newText: string): boolean => {
        if (!oldText || !newText) return false;
        try {
          // Parse both texts to objects then stringify without formatting
          const oldObj = JSON.parse(oldText);
          const newObj = JSON.parse(newText);
          return JSON.stringify(oldObj) === JSON.stringify(newObj);
        } catch {
          // If parsing fails, assume it's a significant change
          return false;
        }
      };
      
      // Check if this is just a whitespace/formatting change
      if (isWhitespaceOnlyChange(prevText, newText)) {
        // Just a formatting change, don't trigger config update
        // Still mark as having unsaved changes if it differs from original config
        const configString = JSON.stringify(config);
        const parsedString = JSON.stringify(parsedJson);
        setHasUnsavedChanges(configString !== parsedString);
        return;
      }
      
      // We have a substantive change to the JSON
      const configString = JSON.stringify(config);
      const parsedString = JSON.stringify(parsedJson);
      
      // Check if the change actually affects the config
      if (configString === parsedString) {
        // The parsed JSON matches the current config, no need to update
        setHasUnsavedChanges(false);
        return;
      }
      
      // Get the last successfully parsed config for comparison
      const lastConfigString = lastParsedConfig.current;
      
      // Only update if different from the last parsed config we sent
      if (lastConfigString !== parsedString) {
        // Update our reference to prevent duplicate updates
        lastParsedConfig.current = parsedString;
        
        // Update config state manager
        configStateManager.tryUpdateConfigFromText(newText);
        
        // Update unsaved changes flag
        setHasUnsavedChanges(true);
        
        // Notify parent component - but only once per unique config
        onConfigUpdate(parsedJson);
      }
    } finally {
      // Reset the flag after a delay
      setTimeout(() => {
        isInternalUpdate.current = false;
      }, 50);
    }
  };

  // Handle cursor position changes
  const handleCursorChange = (e: React.MouseEvent<HTMLTextAreaElement> | React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (textAreaRef.current) {
      const cursorPos = textAreaRef.current.selectionStart;
      setCursorPosition(cursorPos);
      setCurrentLine(getCurrentLineNumber(jsonText, cursorPos));
    }
  };

  // Save changes with validation
  const handleSaveToServer = async () => {
    // Skip in read-only mode
    if (readOnly) return;
    
    // Set the flag to prevent handling our own update events
    isInternalUpdate.current = true;
    
    try {
      // Try parsing the JSON
      let parsedConfig;
      
      try {
        parsedConfig = JSON.parse(jsonText);
      } catch (parseErr: any) {
        // Invalid JSON - show error and return
        setError(`Invalid JSON: ${parseErr.message}`);
        setErrorLine(extractErrorLineNumber(parseErr.message));
        showToast('Failed to save configuration. Please check for errors.', 'error');
        
        // Store the current text state even with invalid JSON
        configStateManager.setCurrentEditorText(jsonText);
        return;
      }
      
      // Stringify the parsed config for comparison
      const parsedString = JSON.stringify(parsedConfig);
      
      // Get current config string for comparison
      const configString = JSON.stringify(config);
      
      // Get the last known config string
      const lastConfigString = lastParsedConfig.current;
      
      // Check if there's any change from current config
      const hasConfigChanged = configString !== parsedString;
      
      // Check if this is a new parsed config we haven't sent yet
      const isNewParsedConfig = lastConfigString !== parsedString;
      
      // Only update the config if it has actually changed and we haven't processed it
      if (hasConfigChanged && isNewParsedConfig) {
        // Update our reference to last parsed config
        lastParsedConfig.current = parsedString;
        
        // Update the config in the state manager
        configStateManager.tryUpdateConfigFromText(jsonText);
        
        // Only now notify parent component
        onConfigUpdate(parsedConfig);
      }
      
      // If a save function is provided, call it to save to server
      if (saveConfig) {
        try {
          // Call the save function - it may return true/false or undefined
          const result = await saveConfig();
          
          // If result is explicitly false, show error
          if (result === false) {
            showToast('Failed to save configuration. Please try again.', 'error');
          } else {
            // Show success message - either result is true or undefined (void promise succeeded)
            showToast(`Configuration saved successfully`, 'success');
            
            // Reset unsaved changes flag
            setHasUnsavedChanges(false);
          }
        } catch (saveError) {
          console.error('Error saving configuration:', saveError);
          showToast('Failed to save configuration. Please try again.', 'error');
        }
      } else {
        // If no save function, just show a simple message
        showToast('Configuration updated locally', 'info');
        setHasUnsavedChanges(false);
      }
    } finally {
      // Always reset the processing flag
      setTimeout(() => {
        isInternalUpdate.current = false;
      }, 50);
    }
  };

  // Handle keyboard shortcuts
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Update cursor position
    handleCursorChange(e);
    
    // Only handle events when not read-only
    if (readOnly) return;
    
    // Helper function to check if a change is just whitespace
    const isWhitespaceOnlyChange = (oldText: string, newText: string) => {
      const oldWithoutWhitespace = oldText.replace(/\s/g, '');
      const newWithoutWhitespace = newText.replace(/\s/g, '');
      return oldWithoutWhitespace === newWithoutWhitespace;
    };
    
    // Handle Enter key to prevent cursor jumping to the bottom
    if (e.key === 'Enter') {
      e.preventDefault();
      const textarea = textAreaRef.current;
      if (!textarea) return;
      
      // Set flag to ignore updates from ConfigStateManager
      isInternalUpdate.current = true;
      
      try {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        
        // Insert newline at cursor position
        const newText = 
          jsonText.substring(0, start) + 
          '\n' + 
          jsonText.substring(end);
        
        setJsonText(newText);
        
        // Always store the current text
        configStateManager.setCurrentEditorText(newText);
        
        // Move cursor position after the inserted newline
        setTimeout(() => {
          if (textarea) {
            textarea.selectionStart = textarea.selectionEnd = start + 1;
            // Update current line
            setCurrentLine(getCurrentLineNumber(newText, start + 1));
          }
        }, 0);
      } finally {
        // Reset the update flag after a short delay
        setTimeout(() => {
          isInternalUpdate.current = false;
        }, 0);
      }
      
      return;
    }
    
    // Handle tab key for indentation
    if (e.key === 'Tab') {
      e.preventDefault();
      const textarea = textAreaRef.current;
      if (!textarea) return;
      
      // Set flag to ignore updates from ConfigStateManager
      isInternalUpdate.current = true;
      
      try {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        
        // Insert 2 spaces at cursor position
        const newText = 
          jsonText.substring(0, start) + 
          '  ' + 
          jsonText.substring(end);
        
        setJsonText(newText);
        
        // Always store the current text
        configStateManager.setCurrentEditorText(newText);
        
        // This is a whitespace change, so no need to update the config
        
        // Move cursor position
        setTimeout(() => {
          if (textarea) {
            textarea.selectionStart = textarea.selectionEnd = start + 2;
            // Update current line
            setCurrentLine(getCurrentLineNumber(newText, start + 2));
          }
        }, 0);
      } finally {
        // Reset the update flag after a short delay
        setTimeout(() => {
          isInternalUpdate.current = false;
        }, 0);
      }
    }
    
    // Save on Ctrl+S or Command+S
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      if (hasUnsavedChanges && !error) {
        handleSaveToServer();
      }
    }
    
    // Auto-close brackets and quotes
    const pairs: Record<string, string> = {
      '{': '}',
      '[': ']',
      '"': '"'
    };
    
    if (pairs[e.key]) {
      const textarea = textAreaRef.current;
      if (!textarea) return;
      
      // Set flag to ignore updates from ConfigStateManager
      isInternalUpdate.current = true;
      
      try {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        
        // If text is selected, wrap it with brackets or quotes
        if (start !== end) {
          e.preventDefault();
          const selectedText = jsonText.substring(start, end);
          const newText = 
            jsonText.substring(0, start) + 
            e.key + selectedText + pairs[e.key] + 
            jsonText.substring(end);
          
          setJsonText(newText);
          
          // This is a meaningful change, try to update the config
          configStateManager.setCurrentEditorText(newText);
          
          if (!isWhitespaceOnlyChange(jsonText, newText)) {
            configStateManager.tryUpdateConfigFromText(newText);
          }
          
          // Place cursor after the closing bracket
          setTimeout(() => {
            if (textarea) {
              textarea.selectionStart = textarea.selectionEnd = end + 2;
              // Update current line
              setCurrentLine(getCurrentLineNumber(newText, end + 2));
            }
          }, 0);
        }
        // Otherwise, just insert the closing bracket after the cursor
        else if (e.key === '{' || e.key === '[') {
          e.preventDefault();
          const newText = 
            jsonText.substring(0, start) + 
            e.key + pairs[e.key] + 
            jsonText.substring(end);
          
          setJsonText(newText);
          
          // This is a meaningful change, try to update the config
          configStateManager.setCurrentEditorText(newText);
          
          if (!isWhitespaceOnlyChange(jsonText, newText)) {
            configStateManager.tryUpdateConfigFromText(newText);
          }
          
          // Place cursor between the brackets
          setTimeout(() => {
            if (textarea) {
              textarea.selectionStart = textarea.selectionEnd = start + 1;
              // Update current line
              setCurrentLine(getCurrentLineNumber(newText, start + 1));
            }
          }, 0);
        }
      } finally {
        // Reset the update flag after a short delay
        setTimeout(() => {
          isInternalUpdate.current = false;
        }, 0);
      }
    }
  };

  // Simple JSON pretty formatter
  const formatJson = () => {
    // Skip in read-only mode
    if (readOnly) return;
    
    // Set the flag to prevent handling our own update events
    isInternalUpdate.current = true;
    
    try {
      // Check if current text is valid JSON before formatting
      let obj;
      try {
        obj = JSON.parse(jsonText);
      } catch (parseErr: any) {
        // Can't format invalid JSON - show error and return
        setError(`Cannot format: ${parseErr.message}`);
        setErrorLine(extractErrorLineNumber(parseErr.message));
        return;
      }
      
      // Get string representation of the parsed object for comparison
      const formattedString = JSON.stringify(obj);
      
      // Format with indentation for display
      const formatted = JSON.stringify(obj, null, 2);
      
      // If the formatted text is exactly the same as current text, nothing to do
      if (formatted === jsonText) {
        return;
      }
      
      // Update editor text with formatted JSON
      setJsonText(formatted);
      
      // Clear any previous errors
      setError(null);
      setErrorLine(null);
      
      // Store the formatted text regardless of config changes
      configStateManager.setCurrentEditorText(formatted);
      
      // Get current config string for comparison
      const configString = JSON.stringify(config);
      
      // Check if the formatted content is different from the current config
      if (configString === formattedString) {
        // No actual data change, just formatting
        setHasUnsavedChanges(false);
        return;
      }
      
      // Get the last known config string for comparison
      const lastConfigString = lastParsedConfig.current;
      
      // Only if the formatted content is different from the last parsed config
      if (lastConfigString !== formattedString) {
        // Update our last parsed config reference first
        lastParsedConfig.current = formattedString;
        
        // Update the config in the state manager
        configStateManager.tryUpdateConfigFromText(formatted);
        
        // Mark as having unsaved changes
        setHasUnsavedChanges(true);
        
        // Now notify parent component with the formatted object
        onConfigUpdate(obj);
      }
    } finally {
      // Always reset the processing flag
      setTimeout(() => {
        isInternalUpdate.current = false;
      }, 50);
    }
  };

  return (
    <div className="h-full flex flex-col bg-white text-stone-700">
      <div className="absolute top-4 right-4 z-10 flex items-center justify-end opacity-0">
        <div className="flex space-x-2">
          {!readOnly && (
            <button
              onClick={formatJson}
              className="json-editor-format-button w-10 h-10 bg-white/90 text-emerald-600 border-stone-200 rounded hover:bg-stone-50 focus:outline-none flex items-center justify-center border border-emerald-300"
              title="Format JSON with proper indentation"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" />
              </svg>
            </button>
          )}
        </div>
      </div>
      
      <div className="flex-1 flex flex-col pt-16">
        {error && (
          <div className="mx-4 mt-2 mb-2 p-3 bg-red-50 border border-red-200 text-red-600 rounded-md text-sm">
            {error}
            {errorLine && (
              <div className="mt-1 font-medium">
                Error at line {errorLine}
              </div>
            )}
          </div>
        )}
        
        <div className="flex-1 flex mx-4 bg-stone-50 rounded-md border border-stone-200 overflow-hidden">
          {/* Line numbers column */}
          <div 
            ref={lineNumbersRef}
            className="py-4 pl-2 pr-0 bg-stone-100 text-xs font-mono border-r border-stone-200 overflow-hidden w-14 flex-shrink-0"
            style={{ lineHeight: '1.5rem' }}
          />
          
          <div className="flex-1 relative p-0 overflow-hidden">
            {/* Editor textarea */}
            <textarea
              ref={textAreaRef}
              className="absolute w-full h-full p-4 bg-transparent font-mono text-sm
                        border-none focus:outline-none resize-none overflow-auto text-stone-800"
              value={jsonText}
              onChange={handleTextChange}
              onKeyDown={handleKeyDown}
              onMouseUp={handleCursorChange}
              onMouseDown={handleCursorChange}
              onKeyUp={handleCursorChange}
              onClick={handleCursorChange}
              disabled={readOnly}
              spellCheck={false}
              style={{ 
                lineHeight: '1.5rem',
                tabSize: 2,
                paddingTop: '1rem',
              }}
            />
          </div>
        </div>
      </div>
      
      {/* Status indicator */}
      <div className="px-4 py-2 bg-stone-50 text-xs text-stone-500 flex items-center border-t border-stone-200">
        <span className={`w-2 h-2 rounded-full mr-2 ${error ? 'bg-red-500' : hasUnsavedChanges ? 'bg-emerald-500' : 'bg-green-500'}`}></span>
        <span>
          {error 
            ? "JSON Error" 
            : hasUnsavedChanges
              ? "Unsaved changes"
              : `Line: ${currentLine} | Changes will be saved in the node graph`}
        </span>
      </div>
    </div>
  );
};