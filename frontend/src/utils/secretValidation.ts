/**
 * Secret Validation Utility
 * 
 * Provides functions to detect lookup variables vs actual secrets in config values.
 * Used to validate that users don't accidentally save actual secrets in config fields.
 * 
 * Lookup variables (allowed in config):
 * - $SECRET:uuid$ format (reference to SecretManager)
 * - process.env.VARIABLE_NAME format (environment variable reference)  
 * - ALL_CAPS format like DISCORD_TOKEN, MY_API_KEY (environment variable name)
 * - Empty/undefined values
 */

/**
 * Parameter names that are considered sensitive and should be checked.
 */
export const SENSITIVE_PARAM_PATTERNS = [
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
 * Validate that a config doesn't contain actual secrets in sensitive fields.
 * 
 * @param params - The params object to validate
 * @param constructorInterface - The plugin's constructor interface with parameter definitions
 * @returns Array of field names that contain actual secrets (empty if all valid)
 */
export function validateNoSecretsInParams(
  params: Record<string, any>,
  constructorInterface?: { parameters: Array<{ name: string; secret?: boolean }> }
): string[] {
  const violations: string[] = [];
  
  for (const [key, value] of Object.entries(params)) {
    // Check if this field is sensitive
    const paramDef = constructorInterface?.parameters?.find(p => p.name === key);
    const isSensitive = paramDef?.secret === true || isSensitiveParam(key);
    
    if (isSensitive && typeof value === 'string' && !isLookupVariable(value)) {
      violations.push(key);
    }
  }
  
  return violations;
}
