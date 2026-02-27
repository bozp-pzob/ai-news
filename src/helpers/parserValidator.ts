/**
 * Validation for LLM-generated parser output.
 *
 * Two validation modes:
 * - **Gold-standard comparison** (`validateAgainstExample`): Compares parser output
 *   field-by-field against a known-good LLM extraction result. Used when generating
 *   a new parser to verify it reproduces the expected output.
 * - **Minimum-fields check** (`validateMinimumFields`): Simple check that the output
 *   has enough non-empty fields. Used for cached parser validation on subsequent visits
 *   where no gold-standard is available.
 *
 * @module helpers/parserValidator
 */

// ============================================
// TYPES
// ============================================

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
