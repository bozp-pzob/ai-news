// frontend/src/components/CreateConfigDialog.tsx

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { configApi, templatesApi, ConfigTemplate, TemplateField, ConfigVisibility, UserLimits } from '../services/api';
import { localConfigStorage } from '../services/localConfigStorage';

interface CreateConfigDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (configId: string, isLocal: boolean) => void;
  limits?: UserLimits | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Set a value at a dot-path like "sources[0].params.repos" in a nested object.
 * Supports array index notation (e.g. [0]).
 */
function setNestedValue(obj: any, path: string, value: any): void {
  const segments = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    const key = segments[i];
    const nextKey = segments[i + 1];
    if (current[key] === undefined) {
      // Create array or object depending on next key
      current[key] = /^\d+$/.test(nextKey) ? [] : {};
    }
    current = current[key];
  }
  current[segments[segments.length - 1]] = value;
}

/**
 * Parse a GitHub repo input into "owner/repo" format.
 * Accepts full URLs (https://github.com/owner/repo) or shorthand (owner/repo).
 */
function parseGitHubRepo(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Handle full URL
  const urlMatch = trimmed.match(/github\.com\/([^\/]+)\/([^\/\.\s]+)/);
  if (urlMatch) {
    return `${urlMatch[1]}/${urlMatch[2]}`;
  }

  // Handle shorthand: owner/repo
  const parts = trimmed.split('/');
  if (parts.length === 2 && parts[0] && parts[1]) {
    return `${parts[0]}/${parts[1]}`;
  }

  return null;
}

// ── Icon Component ───────────────────────────────────────────────────────────

function TemplateIcon({ icon, className = 'w-8 h-8' }: { icon: string; className?: string }) {
  switch (icon) {
    case 'discord':
      return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor">
          <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.947 2.418-2.157 2.418z" />
        </svg>
      );
    case 'telegram':
      return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor">
          <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
        </svg>
      );
    case 'github':
      return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
        </svg>
      );
    case 'market':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
        </svg>
      );
    case 'multi':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
        </svg>
      );
    default:
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      );
  }
}

// ── List Field Input Component ───────────────────────────────────────────────

interface ListFieldInputProps {
  field: TemplateField;
  values: string[];
  onChange: (values: string[]) => void;
}

function ListFieldInput({ field, values, onChange }: ListFieldInputProps) {
  const [inputValue, setInputValue] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);

  const isUrlList = field.type === 'url-list';

  const handleAdd = useCallback(() => {
    const raw = inputValue.trim();
    if (!raw) return;

    if (isUrlList) {
      // For url-list, parse as GitHub repo
      const parsed = parseGitHubRepo(raw);
      if (!parsed) {
        setInputError('Invalid format. Use "owner/repo" or a GitHub URL.');
        return;
      }
      if (values.includes(parsed)) {
        setInputError('Already added.');
        return;
      }
      onChange([...values, parsed]);
    } else {
      // For string-list, support comma-separated input
      const items = raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .filter((s) => !values.includes(s));
      if (items.length === 0) {
        setInputError('Already added or empty.');
        return;
      }
      onChange([...values, ...items]);
    }

    setInputValue('');
    setInputError(null);
  }, [inputValue, values, onChange, isUrlList]);

  const handleRemove = (item: string) => {
    onChange(values.filter((v) => v !== item));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <div>
      <label className="block text-sm font-medium text-stone-300 mb-1">
        {field.label} {field.required && <span className="text-red-400">*</span>}
      </label>

      <div className="flex gap-2">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            setInputError(null);
          }}
          onKeyDown={handleKeyDown}
          placeholder={field.placeholder}
          className="flex-1 px-3 py-2 bg-stone-800 border border-stone-600 rounded-lg text-white placeholder-stone-500 focus:border-amber-500 focus:outline-none text-sm"
        />
        <button
          type="button"
          onClick={handleAdd}
          className="px-3 py-2 bg-stone-700 hover:bg-stone-600 text-stone-300 hover:text-white rounded-lg text-sm font-medium transition-colors border border-stone-600"
        >
          Add
        </button>
      </div>

      {inputError && <p className="mt-1 text-xs text-red-400">{inputError}</p>}

      {field.helpText && !inputError && (
        <p className="mt-1 text-xs text-stone-500">{field.helpText}</p>
      )}

      {/* Added items list */}
      {values.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {values.map((item) => (
            <div
              key={item}
              className="flex items-center justify-between px-3 py-1.5 bg-stone-800 rounded-lg border border-stone-700"
            >
              <div className="flex items-center gap-2 min-w-0">
                {isUrlList && (
                  <svg className="w-3.5 h-3.5 text-stone-500 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                  </svg>
                )}
                <span className="text-sm text-stone-300 truncate">{item}</span>
              </div>
              <button
                type="button"
                onClick={() => handleRemove(item)}
                className="p-0.5 text-stone-500 hover:text-red-400 transition-colors shrink-0 ml-2"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {values.length === 0 && field.required && (
        <p className="mt-2 text-xs text-amber-400/80">Add at least one item to continue</p>
      )}
    </div>
  );
}

// ── Text Field Input Component ───────────────────────────────────────────────

interface TextFieldInputProps {
  field: TemplateField;
  value: string;
  onChange: (value: string) => void;
}

function TextFieldInput({ field, value, onChange }: TextFieldInputProps) {
  return (
    <div>
      <label className="block text-sm font-medium text-stone-300 mb-1">
        {field.label} {field.required && <span className="text-red-400">*</span>}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder}
        className="w-full px-3 py-2 bg-stone-800 border border-stone-600 rounded-lg text-white placeholder-stone-500 focus:border-amber-500 focus:outline-none text-sm"
      />
      {field.helpText && (
        <p className="mt-1 text-xs text-stone-500">{field.helpText}</p>
      )}
    </div>
  );
}

// ── Main Dialog ──────────────────────────────────────────────────────────────

export function CreateConfigDialog({ open, onClose, onSuccess, limits }: CreateConfigDialogProps) {
  const { isAuthenticated, authToken } = useAuth();

  const [step, setStep] = useState<'choose' | 'details'>('choose');
  const [templates, setTemplates] = useState<ConfigTemplate[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<ConfigTemplate | null>(null);
  const [isBlank, setIsBlank] = useState(false);

  // Form fields
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<ConfigVisibility>('public');

  // Template-specific field values
  // For list types (url-list, string-list): string[]
  // For text type: string[] with single element
  const [fieldValues, setFieldValues] = useState<Record<string, string[]>>({});

  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canBePrivate = limits?.limits.canCreatePrivate;

  // Fetch templates when dialog opens
  useEffect(() => {
    if (!open) return;
    // Reset state
    setStep('choose');
    setSelectedTemplate(null);
    setIsBlank(false);
    setName('');
    setDescription('');
    setVisibility('public');
    setFieldValues({});
    setError(null);

    setIsLoadingTemplates(true);
    templatesApi
      .list()
      .then(setTemplates)
      .catch(() => setTemplates([]))
      .finally(() => setIsLoadingTemplates(false));
  }, [open]);

  if (!open) return null;

  const handleSelectBlank = () => {
    setIsBlank(true);
    setSelectedTemplate(null);
    setFieldValues({});
    setStep('details');
  };

  const handleSelectTemplate = (t: ConfigTemplate) => {
    setSelectedTemplate(t);
    setIsBlank(false);
    // Initialize field values
    const initial: Record<string, string[]> = {};
    for (const field of t.fields || []) {
      initial[field.key] = [];
    }
    setFieldValues(initial);
    setStep('details');
  };

  const handleBack = () => {
    setStep('choose');
    setError(null);
  };

  const templateFields = selectedTemplate?.fields || [];
  const hasTemplateFields = templateFields.length > 0;

  /**
   * Inject field values into a deep-cloned config object.
   */
  const injectFieldValues = (configJson: any): any => {
    const cloned = JSON.parse(JSON.stringify(configJson));
    for (const field of templateFields) {
      const values = fieldValues[field.key] || [];
      if (field.type === 'text') {
        setNestedValue(cloned, field.injectPath, values[0] || '');
      } else {
        setNestedValue(cloned, field.injectPath, values);
      }
    }
    return cloned;
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      setError('Config name is required');
      return;
    }

    // Validate required template fields
    if (hasTemplateFields) {
      for (const field of templateFields) {
        if (field.required) {
          const values = fieldValues[field.key] || [];
          if (field.type === 'text' && !values[0]?.trim()) {
            setError(`${field.label} is required`);
            return;
          }
          if ((field.type === 'url-list' || field.type === 'string-list') && values.length === 0) {
            setError(`Add at least one item to ${field.label}`);
            return;
          }
        }
      }
    }

    setIsCreating(true);
    setError(null);

    try {
      if (isAuthenticated && authToken) {
        // Platform mode - create in database
        let configJson = isBlank
          ? getBlankPlatformConfig()
          : selectedTemplate?.configJson;

        // Inject template field values
        if (!isBlank && hasTemplateFields && configJson) {
          configJson = injectFieldValues(configJson);
        }

        const created = await configApi.create(authToken, {
          name: name.trim(),
          description: description.trim(),
          visibility,
          storageType: 'platform',
          configJson,
        });
        onSuccess(created.id, false);
      } else {
        // Local mode - create in localStorage
        let configJson = isBlank
          ? getBlankLocalConfig()
          : selectedTemplate?.localConfigJson;

        // Inject template field values (into localConfigJson)
        if (!isBlank && hasTemplateFields && configJson) {
          configJson = injectFieldValues(configJson);
        }

        const local = localConfigStorage.create({
          name: name.trim(),
          description: description.trim(),
          configJson,
        });
        onSuccess(local.id, true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create config');
      setIsCreating(false);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/70 z-50" onClick={onClose} />

      {/* Dialog */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="bg-stone-900 rounded-xl shadow-2xl border border-stone-700 w-full max-w-2xl max-h-[85vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-stone-700">
            <div className="flex items-center gap-3">
              {step === 'details' && (
                <button
                  onClick={handleBack}
                  className="p-1 text-stone-400 hover:text-white transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
              )}
              <h2 className="text-lg font-semibold text-white">
                {step === 'choose' ? 'Create New Config' : isBlank ? 'New Blank Config' : selectedTemplate?.name}
              </h2>
            </div>
            <button
              onClick={onClose}
              className="p-1 text-stone-400 hover:text-white transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {step === 'choose' ? (
              <div className="space-y-4">
                {/* Blank config option */}
                <button
                  onClick={handleSelectBlank}
                  className="w-full text-left p-4 rounded-lg border border-stone-600 hover:border-amber-500 hover:bg-stone-800/50 transition-colors group"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-lg bg-stone-800 border border-stone-600 group-hover:border-amber-500 flex items-center justify-center text-stone-400 group-hover:text-amber-400 transition-colors">
                      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                    </div>
                    <div>
                      <div className="font-medium text-white">Start from scratch</div>
                      <div className="text-sm text-stone-400">
                        Create a blank config and add sources manually
                      </div>
                    </div>
                  </div>
                </button>

                {/* Templates section */}
                <div className="pt-2">
                  <h3 className="text-sm font-medium text-stone-400 mb-3">Or start from a template</h3>

                  {isLoadingTemplates ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {[1, 2, 3, 4].map((i) => (
                        <div key={i} className="p-4 rounded-lg border border-stone-700 animate-pulse">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-stone-700" />
                            <div className="flex-1">
                              <div className="h-4 bg-stone-700 rounded w-24 mb-2" />
                              <div className="h-3 bg-stone-700 rounded w-36" />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : templates.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {templates.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => handleSelectTemplate(t)}
                          className="text-left p-4 rounded-lg border border-stone-700 hover:border-amber-500 hover:bg-stone-800/50 transition-colors group"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-stone-800 flex items-center justify-center text-stone-400 group-hover:text-amber-400 transition-colors">
                              <TemplateIcon icon={t.icon} className="w-5 h-5" />
                            </div>
                            <div className="min-w-0">
                              <div className="font-medium text-white text-sm">{t.name}</div>
                              <div className="text-xs text-stone-400 truncate">{t.description}</div>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-stone-500 text-sm">No templates available</p>
                  )}
                </div>
              </div>
            ) : (
              /* Step 2: Config details */
              <div className="space-y-5">
                {/* Name */}
                <div>
                  <label className="block text-sm font-medium text-stone-300 mb-1">
                    Config Name <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="My Community Context"
                    autoFocus
                    className="w-full px-3 py-2 bg-stone-800 border border-stone-600 rounded-lg text-white placeholder-stone-500 focus:border-amber-500 focus:outline-none"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="block text-sm font-medium text-stone-300 mb-1">
                    Description
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Describe what this config aggregates..."
                    rows={2}
                    className="w-full px-3 py-2 bg-stone-800 border border-stone-600 rounded-lg text-white placeholder-stone-500 focus:border-amber-500 focus:outline-none resize-none"
                  />
                </div>

                {/* Template-specific fields */}
                {hasTemplateFields && (
                  <div className="space-y-4 pt-1">
                    <div className="border-t border-stone-700/50 pt-4">
                      <h3 className="text-sm font-medium text-stone-400 mb-3">
                        {selectedTemplate?.name} Settings
                      </h3>
                      {templateFields.map((field) =>
                        field.type === 'text' ? (
                          <TextFieldInput
                            key={field.key}
                            field={field}
                            value={(fieldValues[field.key] || [])[0] || ''}
                            onChange={(val) =>
                              setFieldValues((prev) => ({ ...prev, [field.key]: [val] }))
                            }
                          />
                        ) : (
                          <ListFieldInput
                            key={field.key}
                            field={field}
                            values={fieldValues[field.key] || []}
                            onChange={(vals) =>
                              setFieldValues((prev) => ({ ...prev, [field.key]: vals }))
                            }
                          />
                        )
                      )}
                    </div>
                  </div>
                )}

                {/* Visibility - only for authenticated users */}
                {isAuthenticated && (
                  <div>
                    <label className="block text-sm font-medium text-stone-300 mb-2">
                      Visibility
                    </label>
                    <div className="space-y-2">
                      {(['public', 'unlisted', 'private'] as ConfigVisibility[]).map((v) => (
                        <label
                          key={v}
                          className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                            visibility === v
                              ? 'border-amber-500 bg-amber-900/20'
                              : 'border-stone-600 hover:border-stone-500'
                          } ${v === 'private' && !canBePrivate ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                          <input
                            type="radio"
                            name="visibility"
                            value={v}
                            checked={visibility === v}
                            onChange={() =>
                              canBePrivate || v !== 'private' ? setVisibility(v) : null
                            }
                            disabled={v === 'private' && !canBePrivate}
                            className="mt-0.5 accent-amber-500"
                          />
                          <div>
                            <div className="font-medium text-white capitalize text-sm">{v}</div>
                            <div className="text-stone-400 text-xs">
                              {v === 'public' && 'Anyone can discover and query this config'}
                              {v === 'unlisted' && 'Only people with the link can access'}
                              {v === 'private' &&
                                (canBePrivate
                                  ? 'Only you can access this config'
                                  : 'Upgrade to Pro for private configs')}
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {/* Local mode notice */}
                {!isAuthenticated && (
                  <div className="p-3 bg-stone-800 rounded-lg border border-stone-700">
                    <p className="text-stone-400 text-sm">
                      This config will be stored in your browser. Sign in to save configs to the cloud and run them on the platform.
                    </p>
                  </div>
                )}

                {/* Error */}
                {error && (
                  <div className="p-3 bg-red-900/20 border border-red-800 rounded-lg">
                    <p className="text-red-400 text-sm">{error}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer - only show on details step */}
          {step === 'details' && (
            <div className="px-6 py-4 border-t border-stone-700 flex justify-end gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-stone-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={isCreating || !name.trim()}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-stone-700 disabled:text-stone-500 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
              >
                {isCreating ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create Config'
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// Blank config for platform mode
function getBlankPlatformConfig() {
  return {
    settings: { runOnce: true },
    sources: [],
    ai: [
      {
        type: 'OpenAIProvider',
        name: 'OpenAIProvider',
        pluginName: 'OpenAIProvider',
        params: { usePlatformAI: true },
      },
    ],
    enrichers: [],
    storage: [
      {
        type: 'PostgresStorage',
        name: 'PostgresStorage',
        pluginName: 'PostgresStorage',
        params: { usePlatformStorage: true },
      },
    ],
    generators: [],
  };
}

// Blank config for local mode
function getBlankLocalConfig() {
  return {
    settings: { runOnce: true },
    sources: [],
    ai: [],
    enrichers: [],
    storage: [],
    generators: [],
  };
}

export default CreateConfigDialog;
