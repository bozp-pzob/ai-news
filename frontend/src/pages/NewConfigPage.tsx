// frontend/src/pages/NewConfigPage.tsx

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { AuthGuard } from '../components/auth/AuthGuard';
import { configApi, userApi, ConfigVisibility, StorageType, UserLimits } from '../services/api';
import { AppHeader } from '../components/AppHeader';

/**
 * Step indicator
 */
function Steps({ 
  steps, 
  currentStep 
}: { 
  steps: string[];
  currentStep: number;
}) {
  return (
    <div className="flex items-center justify-center mb-8">
      {steps.map((step, i) => (
        <React.Fragment key={i}>
          <div className={`flex items-center ${i <= currentStep ? 'text-emerald-600' : 'text-stone-400'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
              i < currentStep ? 'bg-emerald-600 text-white' :
              i === currentStep ? 'border-2 border-emerald-500 text-emerald-600' :
              'border-2 border-stone-300 text-stone-400'
            }`}>
              {i < currentStep ? (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                i + 1
              )}
            </div>
            <span className="ml-2 text-sm hidden sm:block">{step}</span>
          </div>
          {i < steps.length - 1 && (
            <div className={`w-12 h-0.5 mx-2 ${i < currentStep ? 'bg-emerald-600' : 'bg-stone-200'}`} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

/**
 * Step 1: Basic Info
 */
function BasicInfoStep({
  name,
  setName,
  description,
  setDescription,
  visibility,
  setVisibility,
  limits,
  onNext,
}: {
  name: string;
  setName: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  visibility: ConfigVisibility;
  setVisibility: (v: ConfigVisibility) => void;
  limits: UserLimits | null;
  onNext: () => void;
}) {
  const canBePrivate = limits?.limits.canCreatePrivate;

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-stone-600 mb-1">
          Config Name <span className="text-red-400">*</span>
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Community Context"
          className="w-full px-3 py-2 bg-white border border-stone-300 rounded-lg text-stone-800 placeholder-stone-400 focus:border-emerald-500 focus:outline-none"
        />
        <p className="text-stone-400 text-xs mt-1">
          This will be the display name for your config
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-stone-600 mb-1">
          Description
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe what context this config aggregates..."
          rows={3}
          className="w-full px-3 py-2 bg-white border border-stone-300 rounded-lg text-stone-800 placeholder-stone-400 focus:border-emerald-500 focus:outline-none resize-none"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-stone-600 mb-1">
          Visibility
        </label>
        <div className="space-y-2">
          {(['public', 'unlisted', 'private'] as ConfigVisibility[]).map((v) => (
            <label
              key={v}
              className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                visibility === v
                  ? 'border-emerald-500 bg-emerald-50'
                  : 'border-stone-200 hover:border-stone-300'
              } ${v === 'private' && !canBePrivate ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <input
                type="radio"
                name="visibility"
                value={v}
                checked={visibility === v}
                onChange={() => canBePrivate || v !== 'private' ? setVisibility(v) : null}
                disabled={v === 'private' && !canBePrivate}
                className="mt-1"
              />
              <div>
                <div className="font-medium text-stone-800 capitalize">{v}</div>
                <div className="text-stone-500 text-sm">
                  {v === 'public' && 'Anyone can discover and query this config'}
                  {v === 'unlisted' && 'Only people with the link can access'}
                  {v === 'private' && (canBePrivate ? 'Only you can access this config' : 'Upgrade to Pro for private configs')}
                </div>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={onNext}
          disabled={!name.trim()}
          className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-stone-100 disabled:text-stone-400 text-white rounded-lg font-medium transition-colors"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

/**
 * Step 2: Storage Setup
 */
function StorageStep({
  storageType,
  setStorageType,
  externalDbUrl,
  setExternalDbUrl,
  limits,
  onBack,
  onNext,
}: {
  storageType: StorageType;
  setStorageType: (v: StorageType) => void;
  externalDbUrl: string;
  setExternalDbUrl: (v: string) => void;
  limits: UserLimits | null;
  onBack: () => void;
  onNext: () => void;
}) {
  const isFree = limits?.tier === 'free';
  const [isValidating, setIsValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Free tier uses platform storage (no choice)
  useEffect(() => {
    if (isFree) {
      setStorageType('platform');
    }
  }, [isFree, setStorageType]);

  const handleNext = async () => {
    if (storageType === 'external' && externalDbUrl) {
      // Validate DB URL format
      if (!externalDbUrl.startsWith('postgresql://') && !externalDbUrl.startsWith('postgres://')) {
        setValidationError('URL must start with postgresql:// or postgres://');
        return;
      }
    }
    onNext();
  };

  // For free tier, show simplified storage info
  if (isFree) {
    return (
      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-stone-600 mb-3">
            Storage Location
          </label>
          <div className="p-4 rounded-lg border border-emerald-300 bg-emerald-50">
            <div className="flex items-center gap-2 mb-2">
              <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" />
              </svg>
              <span className="font-medium text-stone-800">Platform Storage</span>
            </div>
            <p className="text-stone-500 text-sm">
              Your data will be stored securely on our platform. This includes PostgreSQL with pgvector for semantic search capabilities.
            </p>
            <p className="text-stone-400 text-xs mt-3">
              Upgrade to Pro for external database support and unlimited storage.
            </p>
          </div>
        </div>

        <div className="flex justify-between">
          <button
            onClick={onBack}
            className="px-6 py-2 text-stone-400 hover:text-stone-800 transition-colors"
          >
            Back
          </button>
          <button
            onClick={onNext}
            className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors"
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  // For paid/admin users, show full storage selection
  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-stone-600 mb-3">
          Storage Location
        </label>
        <div className="space-y-2">
          <label
            className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
              storageType === 'platform'
                ? 'border-emerald-500 bg-emerald-50'
                : 'border-stone-200 hover:border-stone-300'
            }`}
          >
            <input
              type="radio"
              name="storageType"
              value="platform"
              checked={storageType === 'platform'}
              onChange={() => setStorageType('platform')}
              className="mt-1"
            />
            <div className="flex-1">
              <div className="font-medium text-stone-800">Platform Storage</div>
              <div className="text-stone-500 text-sm mt-1">
                We handle everything - PostgreSQL with pgvector, backups, and scaling.
              </div>
            </div>
          </label>

          <label
            className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
              storageType === 'external'
                ? 'border-emerald-500 bg-emerald-50'
                : 'border-stone-200 hover:border-stone-300'
            }`}
          >
            <input
              type="radio"
              name="storageType"
              value="external"
              checked={storageType === 'external'}
              onChange={() => setStorageType('external')}
              className="mt-1"
            />
            <div className="flex-1">
              <div className="font-medium text-stone-800">Your Own Database</div>
              <div className="text-stone-500 text-sm mt-1">
                Provide your PostgreSQL database with pgvector extension.
              </div>
            </div>
          </label>
        </div>
      </div>

      {storageType === 'external' && (
        <div>
          <label className="block text-sm font-medium text-stone-600 mb-1">
            Database URL <span className="text-red-400">*</span>
          </label>
          <input
            type="password"
            value={externalDbUrl}
            onChange={(e) => {
              setExternalDbUrl(e.target.value);
              setValidationError(null);
            }}
            placeholder="postgresql://user:password@host:5432/database"
            className="w-full px-3 py-2 bg-white border border-stone-300 rounded-lg text-stone-800 placeholder-stone-400 focus:border-emerald-500 focus:outline-none font-mono text-sm"
          />
          {validationError && (
            <p className="text-red-400 text-sm mt-1">{validationError}</p>
          )}
          <p className="text-stone-400 text-xs mt-2">
            Your database must have the pgvector extension installed. 
            <a href="/docs/external-database" className="text-emerald-600 hover:underline ml-1">
              Learn more
            </a>
          </p>
        </div>
      )}

      <div className="flex justify-between">
        <button
          onClick={onBack}
          className="px-6 py-2 text-stone-400 hover:text-stone-800 transition-colors"
        >
          Back
        </button>
        <button
          onClick={handleNext}
          disabled={storageType === 'external' && !externalDbUrl.trim()}
          className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-stone-100 disabled:text-stone-400 text-white rounded-lg font-medium transition-colors"
        >
          {isValidating ? 'Validating...' : 'Continue'}
        </button>
      </div>
    </div>
  );
}

/**
 * Step 3: Data Sources
 */
function SourcesStep({
  configJson,
  setConfigJson,
  onBack,
  onNext,
}: {
  configJson: any;
  setConfigJson: (v: any) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const [jsonText, setJsonText] = useState(JSON.stringify(configJson, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);

  const handleJsonChange = (text: string) => {
    setJsonText(text);
    try {
      const parsed = JSON.parse(text);
      setConfigJson(parsed);
      setJsonError(null);
    } catch (e) {
      setJsonError('Invalid JSON');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-stone-600">
            Configuration JSON
          </label>
          <a 
            href="/docs/config-schema" 
            target="_blank"
            className="text-emerald-600 text-sm hover:underline"
          >
            View schema docs
          </a>
        </div>
        <textarea
          value={jsonText}
          onChange={(e) => handleJsonChange(e.target.value)}
          rows={20}
          className={`w-full px-3 py-2 bg-white border rounded-lg text-stone-800 font-mono text-sm focus:outline-none resize-none ${
            jsonError ? 'border-red-500' : 'border-stone-300 focus:border-emerald-500'
          }`}
          spellCheck={false}
        />
        {jsonError && (
          <p className="text-red-400 text-sm mt-1">{jsonError}</p>
        )}
        <p className="text-stone-400 text-xs mt-2">
          Define your sources, enrichers, generators, and storage plugins. 
          You can use the visual editor later to modify this.
        </p>
      </div>

      <div className="flex justify-between">
        <button
          onClick={onBack}
          className="px-6 py-2 text-stone-400 hover:text-stone-800 transition-colors"
        >
          Back
        </button>
        <button
          onClick={onNext}
          disabled={!!jsonError}
          className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-stone-100 disabled:text-stone-400 text-white rounded-lg font-medium transition-colors"
        >
          Create Config
        </button>
      </div>
    </div>
  );
}

/**
 * New config page content
 */
function NewConfigContent() {
  const navigate = useNavigate();
  const { authToken } = useAuth();
  
  const [step, setStep] = useState(0);
  const [limits, setLimits] = useState<UserLimits | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<ConfigVisibility>('public');
  const [storageType, setStorageType] = useState<StorageType>('platform');
  const [externalDbUrl, setExternalDbUrl] = useState('');
  const [configJson, setConfigJson] = useState({
    settings: { runOnce: true },
    sources: [],
    enrichers: [],
    generators: [],
    storage: [],
    ai: [],
  });

  // Load user limits
  useEffect(() => {
    async function loadLimits() {
      if (!authToken) return;
      try {
        const limitsRes = await userApi.getMyLimits(authToken);
        setLimits(limitsRes);
        
        // Set default storage based on tier
        if (limitsRes.tier === 'free') {
          setStorageType('external');
        }
      } catch (err) {
        console.error('Error loading limits:', err);
      }
    }
    loadLimits();
  }, [authToken]);

  // Check if can create
  if (limits && !limits.canCreateConfig) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center">
        <svg 
          className="w-16 h-16 mx-auto text-stone-600 mb-4"
          fill="none" 
          viewBox="0 0 24 24" 
          stroke="currentColor"
        >
          <path 
            strokeLinecap="round" 
            strokeLinejoin="round" 
            strokeWidth={1} 
            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" 
          />
        </svg>
        <h2 className="text-xl font-bold text-stone-800 mb-2">Config Limit Reached</h2>
        <p className="text-stone-500 mb-6">
          You've reached the maximum number of configs for the free tier.
        </p>
        <a
          href="/upgrade"
          className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors inline-block"
        >
          Upgrade to Pro
        </a>
      </div>
    );
  }

  const handleCreate = async () => {
    if (!authToken) return;
    
    setIsCreating(true);
    setError(null);
    
    try {
      const config = await configApi.create(authToken, {
        name,
        description,
        visibility,
        storageType,
        externalDbUrl: storageType === 'external' ? externalDbUrl : undefined,
        configJson,
      });
      
      navigate(`/configs/${config.id}`);
    } catch (err) {
      console.error('Error creating config:', err);
      setError(err instanceof Error ? err.message : 'Failed to create config');
      setIsCreating(false);
    }
  };

  const steps = ['Basic Info', 'Storage', 'Sources'];

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-stone-800">Create New Config</h1>
        <p className="text-stone-500 mt-1">
          Set up a new context aggregation pipeline
        </p>
      </div>

      {/* Steps */}
      <Steps steps={steps} currentStep={step} />

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <p className="text-red-400">{error}</p>
        </div>
      )}

      {/* Step Content */}
      <div className="bg-white rounded-lg border border-stone-200 p-6 shadow-sm">
        {step === 0 && (
          <BasicInfoStep
            name={name}
            setName={setName}
            description={description}
            setDescription={setDescription}
            visibility={visibility}
            setVisibility={setVisibility}
            limits={limits}
            onNext={() => setStep(1)}
          />
        )}
        {step === 1 && (
          <StorageStep
            storageType={storageType}
            setStorageType={setStorageType}
            externalDbUrl={externalDbUrl}
            setExternalDbUrl={setExternalDbUrl}
            limits={limits}
            onBack={() => setStep(0)}
            onNext={() => setStep(2)}
          />
        )}
        {step === 2 && (
          <SourcesStep
            configJson={configJson}
            setConfigJson={setConfigJson}
            onBack={() => setStep(1)}
            onNext={handleCreate}
          />
        )}
      </div>

      {/* Creating overlay */}
      {isCreating && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 text-center shadow-lg">
            <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-stone-800">Creating your config...</p>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * New config page with auth guard
 */
export default function NewConfigPage() {
  return (
    <div className="min-h-screen bg-stone-50">
      <AppHeader />

      {/* Main content with auth guard */}
      <AuthGuard>
        <NewConfigContent />
      </AuthGuard>
    </div>
  );
}
