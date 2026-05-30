import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE_PATH = path.join(__dirname, '.env');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

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

async function listOllamaModels() {
  const response = await fetch(`${OLLAMA_URL}/api/tags`);

  if (!response.ok) {
    throw new Error('Ollama is not responding');
  }

  const data = await response.json();
  return data.models?.map((model) => model.name) || [];
}

async function listOpenAiCompatibleModels(baseUrl, apiKey) {
  const response = await fetch(`${baseUrl}/models`, {
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
  const response = await fetch(
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
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages,
      stream: false
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'Ollama request failed');
  }

  const data = await response.json();
  return data.message?.content || 'No response from model';
}

async function chatOpenAiCompatible(baseUrl, apiKey, model, messages) {
  const response = await fetch(`${baseUrl}/chat/completions`, {
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
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'Chat request failed');
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || 'No response from model';
}

function toGeminiContents(messages) {
  const contents = [];
  let systemText = '';

  for (const message of messages) {
    if (message.role === 'system') {
      systemText += `${message.content}\n`;
      continue;
    }

    contents.push({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }]
    });
  }

  return { contents, systemText: systemText.trim() };
}

async function chatGemini(model, messages) {
  const apiKey = requireApiKey('GEMINI_API_KEY');
  const { contents, systemText } = toGeminiContents(messages);
  const modelId = model.startsWith('models/') ? model : `models/${model}`;

  const body = { contents };

  if (systemText) {
    body.systemInstruction = { parts: [{ text: systemText }] };
  }

  const response = await fetch(
    `${PROVIDERS.gemini.baseUrl}/${modelId}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    }
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

export async function chatWithProvider(providerId, model, messages) {
  switch (providerId) {
    case 'ollama':
      return chatOllama(model, messages);
    case 'groq':
      return chatOpenAiCompatible(
        PROVIDERS.groq.baseUrl,
        requireApiKey('GROQ_API_KEY'),
        model,
        messages
      );
    case 'openai':
      return chatOpenAiCompatible(
        PROVIDERS.openai.baseUrl,
        requireApiKey('OPENAI_API_KEY'),
        model,
        messages
      );
    case 'gemini':
      return chatGemini(model, messages);
    default:
      throw new Error(`Unknown provider: ${providerId}`);
  }
}
