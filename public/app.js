const chatForm = document.getElementById('chatForm');
const messageInput = document.getElementById('messageInput');
const chatMessages = document.getElementById('chatMessages');
const sendButton = document.getElementById('sendButton');
const statusElement = document.getElementById('status');
const providerSelect = document.getElementById('providerSelect');
const modelSelect = document.getElementById('modelSelect');
const settingsHint = document.getElementById('settingsHint');
const settingsToggle = document.getElementById('settingsToggle');
const settingsClose = document.getElementById('settingsClose');
const settingsPanel = document.getElementById('settingsPanel');
const settingsBackdrop = document.getElementById('settingsBackdrop');

const history = [];
const SETTINGS_STORAGE_KEY = 'chatbot-settings';
const LEGACY_MODEL_STORAGE_KEY = 'chatbot-selected-model';

let providersData = [];
let selectedProvider = null;
let selectedModel = null;

function openSettings() {
  settingsPanel.classList.add('is-open');
  settingsBackdrop.classList.add('is-open');
  settingsBackdrop.hidden = false;
  settingsPanel.setAttribute('aria-hidden', 'false');
  settingsToggle.setAttribute('aria-expanded', 'true');
}

function closeSettings() {
  settingsPanel.classList.remove('is-open');
  settingsBackdrop.classList.remove('is-open');
  settingsBackdrop.hidden = true;
  settingsPanel.setAttribute('aria-hidden', 'true');
  settingsToggle.setAttribute('aria-expanded', 'false');
  settingsToggle.focus();
}

settingsToggle.addEventListener('click', () => {
  if (settingsPanel.classList.contains('is-open')) {
    closeSettings();
  } else {
    openSettings();
  }
});

settingsClose.addEventListener('click', closeSettings);
settingsBackdrop.addEventListener('click', closeSettings);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && settingsPanel.classList.contains('is-open')) {
    closeSettings();
  }
});

function addMessage(role, content) {
  const messageElement = document.createElement('div');
  messageElement.classList.add('message', role === 'user' ? 'user' : 'bot');

  const bubbleElement = document.createElement('div');
  bubbleElement.classList.add('bubble');
  bubbleElement.textContent = content;

  messageElement.appendChild(bubbleElement);
  chatMessages.appendChild(messageElement);

  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function setLoading(isLoading) {
  sendButton.disabled = isLoading;
  messageInput.disabled = isLoading;
  providerSelect.disabled = isLoading;
  modelSelect.disabled = isLoading;
  sendButton.textContent = isLoading ? 'Sending...' : 'Send';
}

function getStoredSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {
    // ignore invalid JSON
  }

  const legacyModel = localStorage.getItem(LEGACY_MODEL_STORAGE_KEY);
  if (legacyModel) {
    return { provider: 'ollama', model: legacyModel };
  }

  return null;
}

function saveSettings() {
  localStorage.setItem(
    SETTINGS_STORAGE_KEY,
    JSON.stringify({
      provider: selectedProvider,
      model: selectedModel
    })
  );
}

function getProviderData(providerId) {
  return providersData.find((provider) => provider.id === providerId);
}

function showSettingsHint(message) {
  if (!message) {
    settingsHint.hidden = true;
    settingsHint.textContent = '';
    return;
  }

  settingsHint.hidden = false;
  settingsHint.textContent = message;
}

function updateStatus() {
  if (!selectedProvider || !selectedModel) {
    statusElement.textContent = 'No provider configured.';
    return;
  }

  const provider = getProviderData(selectedProvider);

  if (!provider) {
    statusElement.textContent = 'Provider unavailable.';
    return;
  }

  const label = provider.label || selectedProvider;

  if (!provider.connected) {
    statusElement.textContent = `${label} · not connected`;
    return;
  }

  statusElement.textContent = `${label} · ${selectedModel}`;
}

function populateProviderSelect() {
  providerSelect.innerHTML = '';

  if (!providersData.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No providers available';
    providerSelect.appendChild(option);
    providerSelect.disabled = true;
    return;
  }

  for (const provider of providersData) {
    const option = document.createElement('option');
    option.value = provider.id;
    option.textContent = provider.label;
    providerSelect.appendChild(option);
  }

  providerSelect.disabled = false;
}

function populateModelSelect(providerId, preferredModel) {
  modelSelect.innerHTML = '';
  const provider = getProviderData(providerId);

  if (!provider) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Provider not found';
    modelSelect.appendChild(option);
    modelSelect.disabled = true;
    return;
  }

  if (!provider.connected) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Not connected';
    modelSelect.appendChild(option);
    modelSelect.disabled = true;
    showSettingsHint(provider.error || `${provider.label} is not available.`);
    return;
  }

  if (!provider.models.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No models available';
    modelSelect.appendChild(option);
    modelSelect.disabled = true;
    return;
  }

  for (const name of provider.models) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    modelSelect.appendChild(option);
  }

  const activeModel =
    (preferredModel && provider.models.includes(preferredModel) && preferredModel) ||
    (provider.models.includes(selectedModel) && selectedModel) ||
    provider.models[0];

  modelSelect.value = activeModel;
  modelSelect.disabled = false;
  showSettingsHint(null);
}

function resolveInitialSelection(healthData) {
  const stored = getStoredSettings();
  const connectedProviders = healthData.providers.filter(
    (provider) => provider.connected && provider.models.length > 0
  );

  if (!connectedProviders.length) {
    return null;
  }

  if (
    stored?.provider &&
    stored?.model &&
    connectedProviders.some(
      (provider) =>
        provider.id === stored.provider && provider.models.includes(stored.model)
    )
  ) {
    return { provider: stored.provider, model: stored.model };
  }

  if (
    healthData.selectionValid &&
    connectedProviders.some((provider) => provider.id === healthData.provider)
  ) {
    const provider = connectedProviders.find(
      (item) => item.id === healthData.provider
    );
    if (provider.models.includes(healthData.model)) {
      return { provider: healthData.provider, model: healthData.model };
    }
  }

  const ollama = connectedProviders.find((provider) => provider.id === 'ollama');
  const first = ollama || connectedProviders[0];

  const defaultModel =
    (healthData.defaults?.provider === first.id &&
      first.models.includes(healthData.defaults.model) &&
      healthData.defaults.model) ||
    first.models[0];

  return { provider: first.id, model: defaultModel };
}

async function setActiveSettings(provider, model, { persist = true } = {}) {
  const response = await fetch('/api/settings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ provider, model })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Failed to update settings');
  }

  selectedProvider = data.provider;
  selectedModel = data.model;
  providerSelect.value = selectedProvider;
  populateModelSelect(selectedProvider, selectedModel);

  if (persist) {
    saveSettings();
  }

  updateStatus();
}

async function checkHealth() {
  providerSelect.disabled = true;
  modelSelect.disabled = true;

  try {
    const response = await fetch('/api/health');
    const data = await response.json();

    if (!data.providers?.length) {
      updateStatus();
      showSettingsHint('No providers are configured.');
      return;
    }

    providersData = data.providers;
    populateProviderSelect();

    const initial = resolveInitialSelection(data);

    if (!initial) {
      showSettingsHint('No provider is connected. Check Ollama or your API keys.');
      updateStatus();
      return;
    }

    providerSelect.value = initial.provider;
    populateModelSelect(initial.provider, initial.model);
    await setActiveSettings(initial.provider, modelSelect.value);
  } catch (error) {
    providerSelect.innerHTML = '<option value="">Connection error</option>';
    modelSelect.innerHTML = '<option value="">Connection error</option>';
    statusElement.textContent = 'The server is not reachable.';
    showSettingsHint(error.message);
  }
}

providerSelect.addEventListener('change', async () => {
  const previousProvider = selectedProvider;
  const previousModel = selectedModel;

  try {
    providerSelect.disabled = true;
    modelSelect.disabled = true;

    const provider = getProviderData(providerSelect.value);
    populateModelSelect(providerSelect.value);

    if (!provider?.connected || !modelSelect.value) {
      updateStatus();
      return;
    }

    await setActiveSettings(providerSelect.value, modelSelect.value);
  } catch (error) {
    if (previousProvider) {
      providerSelect.value = previousProvider;
      populateModelSelect(previousProvider, previousModel);
    }
    showSettingsHint(error.message);
  } finally {
    providerSelect.disabled = false;
    modelSelect.disabled = false;
  }
});

modelSelect.addEventListener('change', async () => {
  const previousModel = selectedModel;

  try {
    providerSelect.disabled = true;
    modelSelect.disabled = true;
    await setActiveSettings(providerSelect.value, modelSelect.value);
  } catch (error) {
    if (previousModel) {
      modelSelect.value = previousModel;
    }
    showSettingsHint(error.message);
  } finally {
    providerSelect.disabled = false;
    modelSelect.disabled = false;
  }
});

chatForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const message = messageInput.value.trim();

  if (!message) {
    return;
  }

  if (!selectedProvider || !selectedModel) {
    addMessage('bot', 'Error: choose a provider and model in Settings.');
    return;
  }

  addMessage('user', message);

  history.push({
    role: 'user',
    content: message
  });

  messageInput.value = '';
  setLoading(true);

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message,
        history: history.slice(-10),
        provider: selectedProvider,
        model: selectedModel
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || data.details || 'Request failed');
    }

    const reply = data.reply;

    addMessage('bot', reply);

    history.push({
      role: 'assistant',
      content: reply
    });
  } catch (error) {
    addMessage('bot', `Error: ${error.message}`);
  } finally {
    setLoading(false);
    messageInput.focus();
  }
});

messageInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

checkHealth();
