/**
 * Secret Sanitizer Utility
 * 
 * Provides functions to detect and remove actual secrets from config objects.
 * Preserves lookup variables like $SECRET:uuid$, process.env.X, and ALL_CAPS references.
 * 
 * This utility is used to ensure secrets are never stored in the config JSON in the database.
 * Secrets should only be stored in the encrypted 'secrets' column.
 */

/**
 * Parameter names that are considered sensitive and should be checked for actual secrets.
 */
const SENSITIVE_PARAM_PATTERNS = [
  'api_key', 'apikey', 'key', 'token', 'secret', 'password', 'auth', 'credential',
  'access_token', 'access_key', 'private_key', 'client_secret', 'security',
  'connectionstring', 'connection_string'
];

/**
 * Check if a parameter name is considered sensitive based on naming patterns.
 */
export function isSensitiveParam(paramName: string): boolean {
  const lowerName = paramName.toLowerCase();
  return SENSITIVE_PARAM_PATTERNS.some(pattern => lowerName.includes(pattern));
}

/**
 * Check if a value is a lookup variable (allowed in config).
 * 
 * Lookup variables are:
 * - $SECRET:uuid$ format (reference to SecretManager)
 * - process.env.VARIABLE_NAME format (environment variable reference)
 * - ALL_CAPS format like DISCORD_TOKEN, MY_API_KEY (environment variable name)
 * - Empty/undefined values
 * 
 * @param value - The value to check
 * @returns true if the value is a lookup variable (allowed), false if it's an actual secret
 */
export function isLookupVariable(value: string): boolean {
  // Empty or non-string values are OK
  if (!value || typeof value !== 'string') return true;
  
  // Trim whitespace
  const trimmed = value.trim();
  if (!trimmed) return true;
  
  // $SECRET:uuid$ format (reference to browser SecretManager)
  if (/^\$SECRET:[a-f0-9-]+\$$/.test(trimmed)) return true;
  
  // process.env.VARIABLE_NAME format
  if (/^process\.env\.\w+$/.test(trimmed)) return true;
  
  // ALL_CAPS format (like DISCORD_TOKEN, MY_API_KEY, OPENAI_API_KEY)
  // Must start with a letter, can contain letters, numbers, and underscores
  if (/^[A-Z][A-Z0-9_]*$/.test(trimmed)) return true;
  
  return false;
}

/**
 * Sanitizes a config object by removing actual secrets from sensitive fields.
 * Preserves lookup variables like $SECRET:uuid$, process.env.X, and ALL_CAPS references.
 * 
 * @param configJson - The config JSON object to sanitize
 * @returns Object containing the sanitized config and list of paths where secrets were removed
 */
export function sanitizeConfigSecrets(configJson: any): { 
  sanitizedConfig: any; 
  removedSecrets: string[];
} {
  const removedSecrets: string[] = [];
  
  /**
   * Recursively sanitize params object
   */
  const sanitizeParams = (params: Record<string, any>, path: string): Record<string, any> => {
    const sanitized: Record<string, any> = {};
    
    for (const [key, value] of Object.entries(params)) {
      const currentPath = path ? `${path}.${key}` : key;
      
      if (isSensitiveParam(key) && typeof value === 'string') {
        if (isLookupVariable(value)) {
          // Keep lookup variables - they're safe to store
          sanitized[key] = value;
        } else {
          // This is an actual secret - replace with empty string
          sanitized[key] = '';
          removedSecrets.push(currentPath);
        }
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        // Recurse into nested objects
        sanitized[key] = sanitizeParams(value, currentPath);
      } else {
        // Keep non-sensitive values as-is
        sanitized[key] = value;
      }
    }
    
    return sanitized;
  };
  
  // Create a deep copy of the config
  const sanitizedConfig = JSON.parse(JSON.stringify(configJson));
  
  // Sanitize each plugin array (sources, ai, enrichers, generators, storage)
  const pluginArrays = ['sources', 'ai', 'enrichers', 'generators', 'storage'];
  
  for (const arrayName of pluginArrays) {
    if (Array.isArray(sanitizedConfig[arrayName])) {
      sanitizedConfig[arrayName] = sanitizedConfig[arrayName].map((plugin: any, index: number) => {
        if (plugin.params) {
          return {
            ...plugin,
            params: sanitizeParams(plugin.params, `${arrayName}[${index}].params`)
          };
        }
        return plugin;
      });
    }
  }
  
  return { sanitizedConfig, removedSecrets };
}
