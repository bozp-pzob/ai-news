/**
 * Validation for LLM-generated parser output.
 *
 * Checks that a parser's extracted data contains a sufficient percentage
 * of the expected fields. If an objectTypeString (TypeScript interface) is
 * provided, only **top-level** field names are extracted from it — nested
 * sub-interface fields are ignored since the parser may return them inside
 * parent objects/arrays rather than at the root.
 *
 * Optional fields (marked with `?` in the interface) are scored separately
 * and don't block validation on their own.
 *
 * @module helpers/parserValidator
 */

// ============================================
// TYPES
// ============================================

export interface ValidationOptions {
  /** Minimum fraction of fields that must be present and non-empty (default 0.5) */
  threshold?: number;
  /** Explicit list of required fields (if set, these must ALL be present regardless of threshold) */
  requiredFields?: string[];
  /** TypeScript interface string to extract expected field names from */
  objectTypeString?: string;
}

export interface ValidationResult {
  /** Whether the output passes the threshold */
  valid: boolean;
  /** Fraction of expected fields that are present (0-1) */
  score: number;
  /** Fields that were present and non-empty */
  presentFields: string[];
  /** Fields that were missing or empty */
  missingFields: string[];
  /** Total expected fields */
  totalFields: number;
}

// ============================================
// DEFAULT EXPECTED FIELDS
// ============================================

/**
 * Standard fields expected from a generic web page extraction.
 * Used when no objectTypeString is provided.
 */
const DEFAULT_EXPECTED_FIELDS = [
  'title',
  'description',
  'text',
  'author',
  'date',
  'tags',
];

// ============================================
// VALIDATION
// ============================================

/**
 * Validate that a parser's output contains a sufficient percentage of expected fields.
 *
 * Scoring works as follows:
 * - Required fields (no `?` in the interface) are weighted 1.0
 * - Optional fields (`?` in the interface) are weighted 0.5
 * - Score = weighted present / weighted total
 * - If explicit requiredFields are set, they must ALL be present
 *
 * @param output - The parsed data object from executeParser()
 * @param options - Validation configuration
 * @returns ValidationResult with pass/fail, score, and field details
 */
export function validateParserOutput(
  output: Record<string, any>,
  options: ValidationOptions = {},
): ValidationResult {
  const threshold = options.threshold ?? 0.5;

  // Determine expected fields
  let fieldInfo: FieldInfo[];
  if (options.objectTypeString) {
    fieldInfo = extractTopLevelFields(options.objectTypeString);
  } else {
    fieldInfo = DEFAULT_EXPECTED_FIELDS.map(f => ({ name: f, optional: false }));
  }

  // If explicit required fields are specified, merge them in
  if (options.requiredFields) {
    for (const field of options.requiredFields) {
      if (!fieldInfo.some(f => f.name === field)) {
        fieldInfo.push({ name: field, optional: false });
      }
    }
  }

  if (fieldInfo.length === 0) {
    // No fields to check — consider it valid if the output has any keys
    return {
      valid: Object.keys(output).length > 0,
      score: Object.keys(output).length > 0 ? 1 : 0,
      presentFields: Object.keys(output),
      missingFields: [],
      totalFields: 0,
    };
  }

  const presentFields: string[] = [];
  const missingFields: string[] = [];

  let weightedPresent = 0;
  let weightedTotal = 0;

  for (const field of fieldInfo) {
    const weight = field.optional ? 0.5 : 1.0;
    weightedTotal += weight;

    if (isFieldPresent(output, field.name)) {
      presentFields.push(field.name);
      weightedPresent += weight;
    } else {
      missingFields.push(field.name);
    }
  }

  const score = weightedTotal > 0 ? weightedPresent / weightedTotal : 0;

  // Check if explicit required fields are all present
  let requiredFieldsMet = true;
  if (options.requiredFields) {
    for (const field of options.requiredFields) {
      if (!presentFields.includes(field)) {
        requiredFieldsMet = false;
        break;
      }
    }
  }

  return {
    valid: score >= threshold && requiredFieldsMet,
    score,
    presentFields,
    missingFields,
    totalFields: fieldInfo.length,
  };
}

// ============================================
// FIELD EXTRACTION FROM TYPESCRIPT INTERFACES
// ============================================

interface FieldInfo {
  name: string;
  optional: boolean;
}

/**
 * Extract only TOP-LEVEL field names from a TypeScript interface string.
 *
 * Tracks brace depth to avoid pulling in fields from nested sub-interfaces
 * or inline object types. Only fields at depth 1 (directly inside the main
 * interface body) are returned.
 *
 * Also distinguishes required vs optional fields (marked with `?`).
 *
 * @param interfaceStr - A TypeScript interface definition string
 * @returns Array of FieldInfo with name and optional flag
 */
export function extractTopLevelFields(interfaceStr: string): FieldInfo[] {
  const fields: FieldInfo[] = [];
  const seen = new Set<string>();

  let depth = 0;
  let insideMainBody = false;
  const lines = interfaceStr.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Count braces to track depth
    for (const ch of trimmed) {
      if (ch === '{') {
        depth++;
        if (depth === 1) insideMainBody = true;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) insideMainBody = false;
      }
    }

    // Only extract fields at depth 1 (top-level inside the interface)
    // After brace counting, depth may have changed — we want lines where
    // the field declaration is at depth 1
    if (!insideMainBody || depth !== 1) continue;

    // Match field declaration: fieldName?: type  or  fieldName: type
    const fieldMatch = trimmed.match(/^(\w+)(\?)?(?:\s*):(?!\s*:)/);
    if (fieldMatch) {
      const fieldName = fieldMatch[1];
      const isOptional = fieldMatch[2] === '?';

      // Skip TS keywords that might appear
      if (['interface', 'export', 'type', 'extends', 'readonly', 'constructor'].includes(fieldName)) {
        continue;
      }

      if (!seen.has(fieldName)) {
        seen.add(fieldName);
        fields.push({ name: fieldName, optional: isOptional });
      }
    }
  }

  return fields;
}

/**
 * Extract field names from a TypeScript interface string (flat list).
 * Convenience wrapper around extractTopLevelFields.
 */
export function extractFieldsFromInterface(interfaceStr: string): string[] {
  return extractTopLevelFields(interfaceStr).map(f => f.name);
}

// ============================================
// GOLD-STANDARD VALIDATION
// ============================================

/**
 * Validate parser output against a gold-standard LLM extraction result.
 *
 * Compares field-by-field: for each non-empty field in the gold standard,
 * checks whether the parser output also has that field non-empty.
 * Score = matched fields / gold-standard non-empty fields.
 *
 * @param parserOutput - The data extracted by the generated parser
 * @param goldStandard - The data extracted by direct LLM extraction
 * @param threshold - Minimum fraction of gold-standard fields to match (default 0.5)
 * @returns ValidationResult
 */
export function validateAgainstExample(
  parserOutput: Record<string, any>,
  goldStandard: Record<string, any>,
  threshold: number = 0.5,
): ValidationResult {
  // Get all non-empty fields from the gold standard
  const goldFields = Object.keys(goldStandard).filter(k => isValueNonEmpty(goldStandard[k]));

  if (goldFields.length === 0) {
    return {
      valid: Object.keys(parserOutput).length > 0,
      score: Object.keys(parserOutput).length > 0 ? 1 : 0,
      presentFields: Object.keys(parserOutput),
      missingFields: [],
      totalFields: 0,
    };
  }

  const presentFields: string[] = [];
  const missingFields: string[] = [];

  for (const field of goldFields) {
    if (isFieldPresent(parserOutput, field)) {
      presentFields.push(field);
    } else {
      missingFields.push(field);
    }
  }

  const score = presentFields.length / goldFields.length;

  return {
    valid: score >= threshold,
    score,
    presentFields,
    missingFields,
    totalFields: goldFields.length,
  };
}

/**
 * Simple validation for cached parser results (no gold-standard available).
 *
 * Just checks that the output has a minimum number of non-empty fields.
 * Catches site redesigns where the parser returns an empty or near-empty object.
 *
 * @param output - The parsed data object
 * @param minFields - Minimum number of non-empty fields required (default 3)
 * @returns ValidationResult
 */
export function validateMinimumFields(
  output: Record<string, any>,
  minFields: number = 3,
): ValidationResult {
  const allKeys = Object.keys(output);
  const presentFields = allKeys.filter(k => isValueNonEmpty(output[k]));
  const missingFields = allKeys.filter(k => !isValueNonEmpty(output[k]));

  return {
    valid: presentFields.length >= minFields,
    score: presentFields.length,
    presentFields,
    missingFields,
    totalFields: allKeys.length,
  };
}

// ============================================
// HELPERS
// ============================================

/**
 * Check if a value is non-empty (not null, undefined, empty string, or empty array).
 */
function isValueNonEmpty(value: any): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string' && value.trim() === '') return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
}

/**
 * Check if a field is present and non-empty in the output object.
 *
 * Considers a field "present" if:
 * - It exists in the object (possibly nested with dot notation)
 * - Its value is not null, undefined, empty string, or empty array
 * - For objects: considers present if the object has at least one key
 * - For arrays: considers present if the array has at least one element
 */
function isFieldPresent(obj: Record<string, any>, field: string): boolean {
  // Support dot-notation for nested fields
  const parts = field.split('.');
  let current: any = obj;

  for (const part of parts) {
    if (current == null || typeof current !== 'object') return false;

    // Try exact match first
    if (part in current) {
      current = current[part];
      continue;
    }

    // Try case-insensitive match (LLM might use different casing)
    const lowerPart = part.toLowerCase();
    const key = Object.keys(current).find(k => k.toLowerCase() === lowerPart);
    if (key) {
      current = current[key];
      continue;
    }

    return false;
  }

  // Check that the value is non-empty
  if (current === null || current === undefined) return false;
  if (typeof current === 'string' && current.trim() === '') return false;
  if (Array.isArray(current) && current.length === 0) return false;

  return true;
}
