import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  chatWithProvider,
  fetchProviderSnapshot,
  getEnabledProviders,
  getProviderLabel,
  isProviderEnabled,
  supportsVision
} from './providers.js';

dotenv.config({ override: true });

const app = express();

const PORT = Number(process.env.PORT) || 3000;
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'llama3.1';

let currentProvider = 'ollama';
let currentModel = DEFAULT_MODEL;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function normalizeAttachments(attachments) {
  if (!Array.isArray(attachments)) {
    return [];
  }

  return attachments
    .filter((attachment) => attachment && typeof attachment === 'object')
    .map((attachment) => ({
      kind: attachment.kind,
      name: typeof attachment.name === 'string' ? attachment.name : 'file',
      content: attachment.content,
      dataUrl: attachment.dataUrl,
      mimeType: attachment.mimeType
    }));
}

app.get('/api/health', async (req, res) => {
  try {
    const enabled = getEnabledProviders();
    const providers = await Promise.all(
      enabled.map((provider) => fetchProviderSnapshot(provider.id))
    );

    const activeProvider = providers.find(
      (provider) => provider.id === currentProvider
    );
    const hasActiveSelection =
      activeProvider?.connected &&
      activeProvider.models.includes(currentModel);

    res.json({
      ok: providers.some((provider) => provider.connected),
      provider: currentProvider,
      model: currentModel,
      visionSupported: supportsVision(currentProvider, currentModel),
      defaults: {
        provider: 'ollama',
        model: DEFAULT_MODEL
      },
      providers,
      selectionValid: Boolean(hasActiveSelection)
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: 'Could not load providers',
      error: error.message
    });
  }
});

app.post('/api/settings', (req, res) => {
  const { provider, model } = req.body;

  if (!provider || typeof provider !== 'string') {
    return res.status(400).json({
      error: 'Provider is required'
    });
  }

  if (!model || typeof model !== 'string') {
    return res.status(400).json({
      error: 'Model is required'
    });
  }

  if (!isProviderEnabled(provider.trim())) {
    return res.status(400).json({
      error: 'Provider is not available. Check your API keys in .env'
    });
  }

  currentProvider = provider.trim();
  currentModel = model.trim();

  res.json({
    provider: currentProvider,
    model: currentModel
  });
});

app.post('/api/model', (req, res) => {
  const { model } = req.body;

  if (!model || typeof model !== 'string') {
    return res.status(400).json({
      error: 'Model name is required'
    });
  }

  currentModel = model.trim();

  res.json({
    provider: currentProvider,
    model: currentModel
  });
});

app.post('/api/chat', async (req, res) => {
  try {
    const {
      message = '',
      history = [],
      model,
      provider,
      attachments = []
    } = req.body;

    const activeProvider =
      typeof provider === 'string' && provider.trim()
        ? provider.trim()
        : currentProvider;
    const activeModel =
      typeof model === 'string' && model.trim() ? model.trim() : currentModel;
    const normalizedAttachments = normalizeAttachments(attachments);
    const textMessage = typeof message === 'string' ? message : '';

    if (!textMessage.trim() && !normalizedAttachments.length) {
      return res.status(400).json({
        error: 'Message or attachments are required'
      });
    }

    if (!isProviderEnabled(activeProvider)) {
      return res.status(400).json({
        error: 'Provider is not available'
      });
    }

    const cleanHistory = history.filter(
      (entry) =>
        entry &&
        (entry.role === 'user' || entry.role === 'assistant') &&
        typeof entry.content === 'string'
    );

    const reply = await chatWithProvider(
      activeProvider,
      activeModel,
      cleanHistory,
      textMessage,
      normalizedAttachments
    );

    res.json({ reply });
  } catch (error) {
    res.status(500).json({
      error: 'Server error',
      details: error.message
    });
  }
});

export function getPort() {
  return PORT;
}

export function startServer() {
  return new Promise((resolve, reject) => {
    const server = app.listen(PORT, () => {
      const enabledLabels = getEnabledProviders()
        .map((provider) => provider.label)
        .join(', ');

      console.log(`Chatbot server running on http://localhost:${PORT}`);
      console.log(`Providers: ${enabledLabels}`);
      console.log(`Active: ${getProviderLabel(currentProvider)} · ${currentModel}`);

      resolve({
        port: PORT,
        server,
        url: `http://localhost:${PORT}`
      });
    });

    server.on('error', reject);
  });
}

const isMainModule =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMainModule) {
  startServer().catch((error) => {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  });
}
