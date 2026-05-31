import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE_PATH = path.join(__dirname, '.env');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const PROVIDER_CHECK_TIMEOUT_MS =
  Number(process.env.PROVIDER_CHECK_TIMEOUT_MS) || 15000;
const OLLAMA_CHAT_TIMEOUT_MS =
  Number(process.env.OLLAMA_CHAT_TIMEOUT_MS) || 600000;
const CLOUD_CHAT_TIMEOUT_MS =
  Number(process.env.CLOUD_CHAT_TIMEOUT_MS) || 120000;

async function fetchWithTimeout(url, options = {}, timeoutMs = PROVIDER_CHECK_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') {
      const seconds = Math.round(timeoutMs / 1000);
      throw new Error(`Request timed out after ${seconds}s`);
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const PROVIDERS = {
  ollama: {
    id: 'ollama',
    label: 'Ollama',
    alwaysOn: true
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    envKey: 'GROQ_API_KEY',
    baseUrl: 'https://api.groq.com/openai/v1'
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    envKey: 'OPENAI_API_KEY',
    baseUrl: 'https://api.openai.com/v1'
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini',
    envKey: 'GEMINI_API_KEY',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta'
  }
};

let envFileCache = null;

function parseEnvFile() {
  const vars = {};

  if (!fs.existsSync(ENV_FILE_PATH)) {
    return vars;
  }

  for (const line of fs.readFileSync(ENV_FILE_PATH, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const eqIndex = trimmed.indexOf('=');

    if (eqIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    vars[key] = value;
  }

  return vars;
}

function getEnvFileVars() {
  if (!envFileCache) {
    envFileCache = parseEnvFile();
  }

  return envFileCache;
}

function getApiKeyValue(envKey) {
  const fromFile = getEnvFileVars();

  if (Object.prototype.hasOwnProperty.call(fromFile, envKey)) {
    return fromFile[envKey].trim();
  }

  return (process.env[envKey] || '').trim();
}

function isValidApiKey(value) {
  if (!value) {
    return false;
  }

  const lower = value.toLowerCase();

  if (lower === 'null' || lower === 'undefined' || lower === 'none') {
    return false;
  }

  if (/^your[-_]?/i.test(value) || /^x+$/i.test(value)) {
    return false;
  }

  return value.length >= 10;
}

function hasApiKey(envKey) {
  return isValidApiKey(getApiKeyValue(envKey));
}

function requireApiKey(envKey) {
  const value = getApiKeyValue(envKey);

  if (!isValidApiKey(value)) {
    throw new Error(`Missing or invalid ${envKey} in .env`);
  }

  return value;
}

export function getEnabledProviders() {
  return Object.values(PROVIDERS).filter((provider) => {
    if (provider.alwaysOn) {
      return true;
    }

    return hasApiKey(provider.envKey);
  });
}

export function isProviderEnabled(providerId) {
  return getEnabledProviders().some((provider) => provider.id === providerId);
}

export function getProviderLabel(providerId) {
  return PROVIDERS[providerId]?.label || providerId;
}

export function supportsVision(providerId, modelName) {
  const model = modelName.toLowerCase();

  switch (providerId) {
    case 'gemini':
      return model.includes('gemini');
    case 'groq':
      return model.includes('vision') || model.includes('llama-4');
    case 'openai':
      return (
        model.includes('gpt-4o') ||
        model.includes('gpt-4-turbo') ||
        model.includes('gpt-4.1') ||
        model.includes('vision') ||
        model.startsWith('o1') ||
        model.startsWith('o3') ||
        model.startsWith('o4')
      );
    case 'ollama':
      return /llava|vision|moondream|bakllava|minicpm-v|gemma.*vision|llama3\.2.*vision/i.test(
        model
      );
    default:
      return false;
  }
}

function parseDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);

  if (!match) {
    return null;
  }

  return {
    mimeType: match[1],
    base64: match[2]
  };
}

function normalizeAttachments(attachments = []) {
  return attachments
    .filter((attachment) => attachment && typeof attachment === 'object')
    .map((attachment) => ({
      kind: attachment.kind,
      name: attachment.name || 'file',
      content: attachment.content,
      dataUrl: attachment.dataUrl,
      mimeType: attachment.mimeType
    }));
}

function formatTextAttachment(attachment) {
  return `### ${attachment.name}\n\`\`\`\n${attachment.content}\n\`\`\``;
}

function buildTextSections(message, attachments) {
  const parts = [];

  if (message?.trim()) {
    parts.push(message.trim());
  }

  for (const attachment of attachments) {
    if (attachment.kind === 'text' && attachment.content) {
      parts.push(formatTextAttachment(attachment));
    }
  }

  return parts.join('\n\n');
}

function buildOpenAiUserContent(message, attachments) {
  const parts = [];

  if (message?.trim()) {
    parts.push({ type: 'text', text: message.trim() });
  }

  for (const attachment of attachments) {
    if (attachment.kind === 'text' && attachment.content) {
      parts.push({ type: 'text', text: formatTextAttachment(attachment) });
      continue;
    }

    if (attachment.kind === 'image' && attachment.dataUrl) {
      parts.push({
        type: 'image_url',
        image_url: { url: attachment.dataUrl }
      });
    }
  }

  if (!parts.length) {
    return 'Describe the attached image(s).';
  }

  if (parts.length === 1 && parts[0].type === 'text') {
    return parts[0].text;
  }

  return parts;
}

function buildOllamaUserMessage(message, attachments) {
  const textContent = buildTextSections(message, attachments);
  const imageAttachments = attachments.filter(
    (attachment) => attachment.kind === 'image' && attachment.dataUrl
  );
  const userMessage = {
    role: 'user',
    content: textContent || 'Describe the attached image(s).'
  };

  if (imageAttachments.length) {
    userMessage.images = imageAttachments.map((attachment) => {
      const parsed = parseDataUrl(attachment.dataUrl);
      return parsed?.base64 || attachment.dataUrl.replace(/^data:[^;]+;base64,/, '');
    });
  }

  return userMessage;
}

function buildGeminiParts(message, attachments) {
  const parts = [];

  if (message?.trim()) {
    parts.push({ text: message.trim() });
  }

  for (const attachment of attachments) {
    if (attachment.kind === 'text' && attachment.content) {
      parts.push({ text: formatTextAttachment(attachment) });
      continue;
    }

    if (attachment.kind === 'image' && attachment.dataUrl) {
      const parsed = parseDataUrl(attachment.dataUrl);

      if (parsed) {
        parts.push({
          inline_data: {
            mime_type: parsed.mimeType,
            data: parsed.base64
          }
        });
      }
    }
  }

  return parts.length ? parts : [{ text: 'Describe the attached image(s).' }];
}

export function buildProviderMessages(providerId, history, message, attachments = []) {
  const normalizedAttachments = normalizeAttachments(attachments);
  const systemMessage = {
    role: 'system',
    content: 'You are a helpful AI chatbot. Answer clearly and concisely.'
  };
  const cleanHistory = history.filter(
    (entry) => entry.role === 'user' || entry.role === 'assistant'
  );

  switch (providerId) {
    case 'ollama':
      return [
        systemMessage,
        ...cleanHistory.map((entry) => ({
          role: entry.role,
          content: entry.content
        })),
        buildOllamaUserMessage(message, normalizedAttachments)
      ];
    case 'groq':
    case 'openai':
      return [
        systemMessage,
        ...cleanHistory.map((entry) => ({
          role: entry.role,
          content: entry.content
        })),
        {
          role: 'user',
          content: buildOpenAiUserContent(message, normalizedAttachments)
        }
      ];
    case 'gemini':
      return {
        systemText: systemMessage.content,
        contents: [
          ...cleanHistory.map((entry) => ({
            role: entry.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: entry.content }]
          })),
          {
            role: 'user',
            parts: buildGeminiParts(message, normalizedAttachments)
          }
        ]
      };
    default:
      throw new Error(`Unknown provider: ${providerId}`);
  }
}

async function listOllamaModels() {
  const response = await fetchWithTimeout(`${OLLAMA_URL}/api/tags`);

  if (!response.ok) {
    throw new Error('Ollama is not responding');
  }

  const data = await response.json();
  return data.models?.map((model) => model.name) || [];
}

async function listOpenAiCompatibleModels(baseUrl, apiKey) {
  const response = await fetchWithTimeout(`${baseUrl}/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'Failed to list models');
  }

  const data = await response.json();
  return (data.data || []).map((model) => model.id).sort();
}

async function listGeminiModels(apiKey) {
  const response = await fetchWithTimeout(
    `${PROVIDERS.gemini.baseUrl}/models?key=${encodeURIComponent(apiKey)}`
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'Failed to list Gemini models');
  }

  const data = await response.json();
  return (data.models || [])
    .map((model) => model.name.replace(/^models\//, ''))
    .filter((name) => name.includes('gemini'))
    .sort();
}

export async function listModelsForProvider(providerId) {
  switch (providerId) {
    case 'ollama':
      return listOllamaModels();
    case 'groq':
      return listOpenAiCompatibleModels(
        PROVIDERS.groq.baseUrl,
        requireApiKey('GROQ_API_KEY')
      );
    case 'openai':
      return listOpenAiCompatibleModels(
        PROVIDERS.openai.baseUrl,
        requireApiKey('OPENAI_API_KEY')
      );
    case 'gemini':
      return listGeminiModels(requireApiKey('GEMINI_API_KEY'));
    default:
      throw new Error(`Unknown provider: ${providerId}`);
  }
}

export async function fetchProviderSnapshot(providerId) {
  try {
    const models = await listModelsForProvider(providerId);
    return {
      id: providerId,
      label: getProviderLabel(providerId),
      connected: true,
      models,
      error: null
    };
  } catch (error) {
    return {
      id: providerId,
      label: getProviderLabel(providerId),
      connected: false,
      models: [],
      error: error.message
    };
  }
}

async function chatOllama(model, messages) {
  const response = await fetchWithTimeout(
    `${OLLAMA_URL}/api/chat`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages,
        stream: false
      })
    },
    OLLAMA_CHAT_TIMEOUT_MS
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'Ollama request failed');
  }

  const data = await response.json();
  return data.message?.content || 'No response from model';
}

async function chatOpenAiCompatible(baseUrl, apiKey, model, messages) {
  const response = await fetchWithTimeout(
    `${baseUrl}/chat/completions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages,
        stream: false
      })
    },
    CLOUD_CHAT_TIMEOUT_MS
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'Chat request failed');
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || 'No response from model';
}

async function chatGemini(model, geminiPayload) {
  const apiKey = requireApiKey('GEMINI_API_KEY');
  const modelId = model.startsWith('models/') ? model : `models/${model}`;
  const body = { contents: geminiPayload.contents };

  if (geminiPayload.systemText) {
    body.systemInstruction = { parts: [{ text: geminiPayload.systemText }] };
  }

  const response = await fetchWithTimeout(
    `${PROVIDERS.gemini.baseUrl}/${modelId}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    },
    CLOUD_CHAT_TIMEOUT_MS
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'Gemini request failed');
  }

  const data = await response.json();
  return (
    data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text)
      .join('') || 'No response from model'
  );
}

export async function chatWithProvider(
  providerId,
  model,
  history,
  message,
  attachments = []
) {
  const normalizedAttachments = normalizeAttachments(attachments);
  const hasImages = normalizedAttachments.some(
    (attachment) => attachment.kind === 'image'
  );

  if (hasImages && !supportsVision(providerId, model)) {
    throw new Error(
      `Model "${model}" does not support images. Choose a vision model (Groq: *vision*, OpenAI: gpt-4o, Gemini: gemini-2.0-flash).`
    );
  }

  const payload = buildProviderMessages(
    providerId,
    history,
    message,
    normalizedAttachments
  );

  switch (providerId) {
    case 'ollama':
      return chatOllama(model, payload);
    case 'groq':
      return chatOpenAiCompatible(
        PROVIDERS.groq.baseUrl,
        requireApiKey('GROQ_API_KEY'),
        model,
        payload
      );
    case 'openai':
      return chatOpenAiCompatible(
        PROVIDERS.openai.baseUrl,
        requireApiKey('OPENAI_API_KEY'),
        model,
        payload
      );
    case 'gemini':
      return chatGemini(model, payload);
    default:
      throw new Error(`Unknown provider: ${providerId}`);
  }
}
