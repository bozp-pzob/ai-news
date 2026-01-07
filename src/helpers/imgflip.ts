/**
 * Imgflip API helper for meme generation.
 *
 * Environment variables:
 *   IMGFLIP_USERNAME - Imgflip account username
 *   IMGFLIP_PASSWORD - Imgflip account password
 */

const BASE_URL = "https://api.imgflip.com";

export interface MemeResult {
  success: boolean;
  url?: string;
  pageUrl?: string;
  templateName?: string;
  templateId?: string;
  error?: string;
}

function getCredentials(): { username: string; password: string } {
  const username = process.env.IMGFLIP_USERNAME;
  const password = process.env.IMGFLIP_PASSWORD;
  if (!username || !password) {
    throw new Error("IMGFLIP_USERNAME and IMGFLIP_PASSWORD must be set");
  }
  return { username, password };
}

/**
 * Auto-generate meme with neural network template selection.
 * Best for short text (3-15 words).
 */
export async function automeme(text: string, noWatermark = true): Promise<MemeResult> {
  const { username, password } = getCredentials();

  const response = await fetch(`${BASE_URL}/automeme`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      username,
      password,
      text,
      no_watermark: noWatermark.toString(),
    }),
  });

  const data = await response.json();

  if (!data.success) {
    return { success: false, error: data.error_message || "Automeme failed" };
  }

  return {
    success: true,
    url: data.data.url,
    pageUrl: data.data.page_url,
    templateName: data.data.template?.name,
    templateId: data.data.template?.id,
  };
}

/**
 * Generate meme with AI model (GPT or classic neural net).
 */
export async function aiMeme(
  options: {
    model?: "openai" | "classic";
    templateId?: string;
    prefixText?: string;
    noWatermark?: boolean;
  } = {}
): Promise<MemeResult> {
  const { username, password } = getCredentials();
  const { model = "openai", templateId, prefixText, noWatermark = true } = options;

  const params: Record<string, string> = {
    username,
    password,
    model,
    no_watermark: noWatermark.toString(),
  };

  if (templateId) params.template_id = templateId;
  if (prefixText) params.prefix_text = prefixText.slice(0, 64);

  const response = await fetch(`${BASE_URL}/ai_meme`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });

  const data = await response.json();

  if (!data.success) {
    return { success: false, error: data.error_message || "AI meme failed" };
  }

  return {
    success: true,
    url: data.data.url,
    pageUrl: data.data.page_url,
    templateName: data.data.template?.name,
    templateId: data.data.template?.id,
  };
}

/**
 * Generate meme with fallback: automeme → ai_meme
 */
export async function generateMeme(text: string): Promise<MemeResult> {
  // Try automeme first (works best with 3-15 words)
  if (text.length <= 80) {
    const result = await automeme(text);
    if (result.success) return result;
  }

  // Fallback to ai_meme with prefix
  const result = await aiMeme({ prefixText: text.slice(0, 64) });
  if (result.success) return result;

  return { success: false, error: "All generation methods failed" };
}
