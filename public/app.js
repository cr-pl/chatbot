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
const chatCard = document.querySelector('.chat-card');
const dropOverlay = document.getElementById('dropOverlay');
const attachmentsContainer = document.getElementById('attachments');
const conversationTitle = document.getElementById('conversationTitle');
const conversationList = document.getElementById('conversationList');
const newConversationButton = document.getElementById('newConversationButton');
const deleteConversationButton = document.getElementById('deleteConversationButton');

const SETTINGS_STORAGE_KEY = 'chatbot-settings';
const LEGACY_MODEL_STORAGE_KEY = 'chatbot-selected-model';
const CONVERSATIONS_STORAGE_KEY = 'chatbot-conversations';
const ACTIVE_CONVERSATION_STORAGE_KEY = 'chatbot-active-conversation';

const MAX_ATTACHMENTS = 5;
const MAX_TEXT_FILE_BYTES = 100 * 1024;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.json', '.js', '.ts', '.jsx', '.tsx', '.py', '.html', '.css',
  '.csv', '.xml', '.yaml', '.yml', '.env', '.sql', '.sh', '.bat', '.ps1', '.log',
  '.toml', '.ini', '.cfg', '.c', '.cpp', '.h', '.java', '.go', '.rs', '.php', '.rb'
]);

let providersData = [];
let selectedProvider = null;
let selectedModel = null;
let attachments = [];
let dragDepth = 0;
let conversations = [];
let activeConversationId = null;
let isSending = false;

function createConversation() {
  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    title: 'New chat',
    createdAt: now,
    updatedAt: now,
    messages: [],
    history: []
  };
}

function normalizeConversation(conversation) {
  return {
    id: typeof conversation.id === 'string' ? conversation.id : crypto.randomUUID(),
    title:
      typeof conversation.title === 'string' && conversation.title.trim()
        ? conversation.title
        : 'New chat',
    createdAt: conversation.createdAt || new Date().toISOString(),
    updatedAt: conversation.updatedAt || conversation.createdAt || new Date().toISOString(),
    messages: Array.isArray(conversation.messages) ? conversation.messages : [],
    history: Array.isArray(conversation.history) ? conversation.history : []
  };
}

function loadConversations() {
  try {
    const raw = localStorage.getItem(CONVERSATIONS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];

    if (Array.isArray(parsed)) {
      conversations = parsed.map(normalizeConversation);
    }
  } catch {
    conversations = [];
  }

  if (!conversations.length) {
    conversations = [createConversation()];
  }

  const storedActiveId = localStorage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY);
  activeConversationId = conversations.some((item) => item.id === storedActiveId)
    ? storedActiveId
    : conversations[0].id;
}

function saveConversations() {
  localStorage.setItem(CONVERSATIONS_STORAGE_KEY, JSON.stringify(conversations));
  localStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, activeConversationId);
}

function getActiveConversation() {
  return conversations.find((conversation) => conversation.id === activeConversationId);
}

function formatConversationDate(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function createConversationTitle(message, sentAttachments) {
  const text = message.trim();

  if (text) {
    return text.length > 42 ? `${text.slice(0, 39)}...` : text;
  }

  const firstAttachment = sentAttachments[0];

  if (firstAttachment) {
    return firstAttachment.name.length > 42
      ? `${firstAttachment.name.slice(0, 39)}...`
      : firstAttachment.name;
  }

  return 'New chat';
}

function renderConversationList() {
  conversationList.innerHTML = '';

  const sortedConversations = [...conversations].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  for (const conversation of sortedConversations) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'conversation-item';
    button.disabled = isSending;
    button.classList.toggle('is-active', conversation.id === activeConversationId);
    button.addEventListener('click', () => {
      activeConversationId = conversation.id;
      saveConversations();
      renderActiveConversation();
    });

    const title = document.createElement('span');
    title.className = 'conversation-item-title';
    title.textContent = conversation.title;

    const meta = document.createElement('span');
    meta.className = 'conversation-item-meta';
    meta.textContent = formatConversationDate(conversation.updatedAt);

    button.append(title, meta);
    conversationList.appendChild(button);
  }
}

function renderStoredMessage(message) {
  addMessage(message.role, message.content, message.attachments || [], { persist: false });
}

function renderActiveConversation() {
  const conversation = getActiveConversation();
  chatMessages.innerHTML = '';

  if (!conversation) {
    return;
  }

  conversationTitle.textContent = conversation.title;
  deleteConversationButton.disabled =
    isSending || (conversations.length <= 1 && !conversation.messages.length);

  for (const message of conversation.messages) {
    renderStoredMessage(message);
  }

  renderConversationList();
}

function startNewConversation() {
  const conversation = createConversation();
  conversations.unshift(conversation);
  activeConversationId = conversation.id;
  attachments = [];
  renderAttachments();
  saveConversations();
  renderActiveConversation();
  messageInput.focus();
}

function deleteActiveConversation() {
  const conversation = getActiveConversation();

  if (!conversation) {
    return;
  }

  if (conversation.messages.length && !confirm('Delete this conversation?')) {
    return;
  }

  conversations = conversations.filter((item) => item.id !== activeConversationId);

  if (!conversations.length) {
    conversations = [createConversation()];
  }

  activeConversationId = conversations[0].id;
  attachments = [];
  renderAttachments();
  saveConversations();
  renderActiveConversation();
  messageInput.focus();
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileExtension(name) {
  const dotIndex = name.lastIndexOf('.');
  return dotIndex === -1 ? '' : name.slice(dotIndex).toLowerCase();
}

function isTextFile(file) {
  if (file.type.startsWith('text/')) {
    return true;
  }

  if (
    file.type === 'application/json' ||
    file.type === 'application/javascript' ||
    file.type === 'application/xml'
  ) {
    return true;
  }

  return TEXT_EXTENSIONS.has(getFileExtension(file.name));
}

function isImageFile(file) {
  return file.type.startsWith('image/');
}

function canSubmitMessage(message) {
  return Boolean(message.trim()) || attachments.length > 0;
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsText(file);
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

async function createAttachmentFromFile(file) {
  if (attachments.length >= MAX_ATTACHMENTS) {
    throw new Error(`Maximum ${MAX_ATTACHMENTS} files per message.`);
  }

  if (isTextFile(file)) {
    if (file.size > MAX_TEXT_FILE_BYTES) {
      throw new Error(`${file.name} is too large (max ${formatBytes(MAX_TEXT_FILE_BYTES)}).`);
    }

    const content = await readFileAsText(file);

    return {
      id: crypto.randomUUID(),
      name: file.name,
      kind: 'text',
      size: file.size,
      content
    };
  }

  if (isImageFile(file)) {
    if (file.size > MAX_IMAGE_BYTES) {
      throw new Error(`${file.name} is too large (max ${formatBytes(MAX_IMAGE_BYTES)}).`);
    }

    const previewUrl = await readFileAsDataUrl(file);

    return {
      id: crypto.randomUUID(),
      name: file.name,
      kind: 'image',
      size: file.size,
      mimeType: file.type,
      previewUrl
    };
  }

  throw new Error(`${file.name} is not supported. Use text/code or image files.`);
}

function renderAttachments() {
  attachmentsContainer.innerHTML = '';

  if (!attachments.length) {
    attachmentsContainer.hidden = true;
    return;
  }

  attachmentsContainer.hidden = false;

  for (const attachment of attachments) {
    const chip = document.createElement('div');
    chip.className = 'attachment-chip';

    if (attachment.kind === 'image') {
      const img = document.createElement('img');
      img.src = attachment.previewUrl;
      img.alt = attachment.name;
      chip.appendChild(img);
    }

    const name = document.createElement('span');
    name.className = 'attachment-name';
    name.textContent = `${attachment.name} (${formatBytes(attachment.size)})`;
    chip.appendChild(name);

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'attachment-remove';
    removeButton.setAttribute('aria-label', `Remove ${attachment.name}`);
    removeButton.textContent = '×';
    removeButton.addEventListener('click', () => {
      attachments = attachments.filter((item) => item.id !== attachment.id);
      renderAttachments();
    });
    chip.appendChild(removeButton);

    attachmentsContainer.appendChild(chip);
  }
}

function buildHistorySummary(userMessage, sentAttachments) {
  const parts = [];

  if (userMessage.trim()) {
    parts.push(userMessage.trim());
  }

  for (const attachment of sentAttachments) {
    if (attachment.kind === 'text') {
      parts.push(`[Attached file: ${attachment.name}]`);
    } else if (attachment.kind === 'image') {
      parts.push(`[Attached image: ${attachment.name}]`);
    }
  }

  return parts.join('\n') || 'Sent attachments';
}

function serializeAttachmentsForApi(sentAttachments) {
  return sentAttachments.map((attachment) => ({
    kind: attachment.kind,
    name: attachment.name,
    content: attachment.content,
    dataUrl: attachment.previewUrl || attachment.dataUrl,
    mimeType: attachment.mimeType
  }));
}

function buildDisplayMessage(userMessage) {
  return userMessage.trim() || (attachments.length ? 'Sent attachments' : '');
}

function setDropActive(isActive) {
  dropOverlay.hidden = !isActive;
  dropOverlay.classList.toggle('is-active', isActive);
  chatCard.classList.toggle('is-dragover', isActive);
}

async function addFilesFromList(fileList) {
  const files = Array.from(fileList || []);

  if (!files.length) {
    return;
  }

  const errors = [];

  for (const file of files) {
    try {
      const attachment = await createAttachmentFromFile(file);
      attachments.push(attachment);
    } catch (error) {
      errors.push(error.message);
    }
  }

  renderAttachments();

  if (errors.length) {
    addMessage('bot', `Error: ${errors.join(' ')}`);
  }
}

function setupDragAndDrop() {
  chatCard.addEventListener('dragenter', (event) => {
    if (!event.dataTransfer?.types?.includes('Files')) {
      return;
    }

    event.preventDefault();
    dragDepth += 1;
    setDropActive(true);
  });

  chatCard.addEventListener('dragover', (event) => {
    if (!event.dataTransfer?.types?.includes('Files')) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDropActive(true);
  });

  chatCard.addEventListener('dragleave', (event) => {
    if (!event.dataTransfer?.types?.includes('Files')) {
      return;
    }

    dragDepth = Math.max(0, dragDepth - 1);

    if (dragDepth === 0) {
      setDropActive(false);
    }
  });

  chatCard.addEventListener('drop', async (event) => {
    if (!event.dataTransfer?.files?.length) {
      return;
    }

    event.preventDefault();
    dragDepth = 0;
    setDropActive(false);

    await addFilesFromList(event.dataTransfer.files);
    messageInput.focus();
  });
}

setupDragAndDrop();

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
newConversationButton.addEventListener('click', startNewConversation);
deleteConversationButton.addEventListener('click', deleteActiveConversation);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && settingsPanel.classList.contains('is-open')) {
    closeSettings();
  }
});

function addMessage(role, content, messageAttachments = [], { persist = true } = {}) {
  const messageElement = document.createElement('div');
  messageElement.classList.add('message', role === 'user' ? 'user' : 'bot');

  const bubbleElement = document.createElement('div');
  bubbleElement.classList.add('bubble');
  bubbleElement.textContent = content;

  if (messageAttachments.length) {
    const filesElement = document.createElement('div');
    filesElement.classList.add('message-files');

    for (const attachment of messageAttachments) {
      const tag = document.createElement('span');
      tag.classList.add('message-file-tag');
      tag.textContent = attachment.name;

      if (attachment.kind === 'image' && attachment.previewUrl) {
        const img = document.createElement('img');
        img.src = attachment.previewUrl;
        img.alt = attachment.name;
        tag.appendChild(document.createElement('br'));
        tag.appendChild(img);
      }

      filesElement.appendChild(tag);
    }

    bubbleElement.appendChild(filesElement);
  }

  messageElement.appendChild(bubbleElement);
  chatMessages.appendChild(messageElement);

  chatMessages.scrollTop = chatMessages.scrollHeight;

  if (!persist) {
    return;
  }

  const conversation = getActiveConversation();

  if (!conversation) {
    return;
  }

  conversation.messages.push({
    role,
    content,
    attachments: messageAttachments.map((attachment) => ({
      kind: attachment.kind,
      name: attachment.name,
      previewUrl: attachment.previewUrl,
      size: attachment.size
    }))
  });
  conversation.updatedAt = new Date().toISOString();
  saveConversations();
  renderConversationList();
}

function setLoading(isLoading) {
  isSending = isLoading;
  sendButton.disabled = isLoading;
  messageInput.disabled = isLoading;
  providerSelect.disabled = isLoading;
  modelSelect.disabled = isLoading;
  newConversationButton.disabled = isLoading;
  deleteConversationButton.disabled =
    isLoading ||
    (conversations.length <= 1 && !getActiveConversation()?.messages.length);
  sendButton.textContent = isLoading ? 'Sending...' : 'Send';
  renderConversationList();
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
  statusElement.textContent = 'Checking connection...';

  try {
    const response = await fetch('/api/health');
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || data.error || 'Health check failed');
    }

    if (!data.providers?.length) {
      statusElement.textContent = 'No providers configured.';
      showSettingsHint('No providers are configured.');
      return;
    }

    providersData = data.providers;
    populateProviderSelect();

    const initial = resolveInitialSelection(data);

    if (!initial) {
      statusElement.textContent = 'No provider connected.';
      showSettingsHint('No provider is connected. Check Ollama or your API keys.');
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
  } finally {
    providerSelect.disabled = false;
    modelSelect.disabled = false;
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

  if (!canSubmitMessage(message)) {
    return;
  }

  if (!selectedProvider || !selectedModel) {
    addMessage('bot', 'Error: choose a provider and model in Settings.');
    return;
  }

  const sentAttachments = attachments.map((attachment) => ({ ...attachment }));
  const displayMessage = buildDisplayMessage(message);
  const historySummary = buildHistorySummary(message, sentAttachments);
  const activeConversation = getActiveConversation();

  if (!activeConversation) {
    addMessage('bot', 'Error: no active conversation.');
    return;
  }

  addMessage('user', displayMessage, sentAttachments);

  if (activeConversation.title === 'New chat') {
    activeConversation.title = createConversationTitle(message, sentAttachments);
    conversationTitle.textContent = activeConversation.title;
  }

  activeConversation.history.push({
    role: 'user',
    content: historySummary
  });
  activeConversation.updatedAt = new Date().toISOString();
  saveConversations();
  renderConversationList();

  messageInput.value = '';
  attachments = [];
  renderAttachments();
  setLoading(true);

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message,
        attachments: serializeAttachmentsForApi(sentAttachments),
        history: activeConversation.history.slice(0, -1).slice(-10),
        provider: selectedProvider,
        model: selectedModel
      })
    });

    const data = await response.json();

    if (!response.ok) {
      const details = data.details ? `: ${data.details}` : '';
      throw new Error((data.error || 'Request failed') + details);
    }

    const reply = data.reply;

    addMessage('bot', reply);

    activeConversation.history.push({
      role: 'assistant',
      content: reply
    });
    activeConversation.updatedAt = new Date().toISOString();
    saveConversations();
    renderConversationList();
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

loadConversations();
renderActiveConversation();
checkHealth();
