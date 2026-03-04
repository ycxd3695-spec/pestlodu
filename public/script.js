// ==================== GLOBAL STATE ====================

let allTokens = [];
let filteredTokens = [];
let selectedTokenIds = new Set();
let parsedWhatsAppTokens = [];
let bulkDeleteMatchedIds = [];
let currentUser = null;
let authToken = null;
let darkMode = false;
let bannerTimeout = null;

// ==================== INITIALIZATION ====================

document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
  initDarkMode();
  initSearchListener();
  setDefaultDate();
});

function checkAuth() {
  authToken = localStorage.getItem('authToken');
  const userStr = localStorage.getItem('user');

  if (!authToken || !userStr) {
    window.location.href = '/login.html';
    return;
  }

  try {
    currentUser = JSON.parse(userStr);
  } catch {
    window.location.href = '/login.html';
    return;
  }

  // Use stored user info directly (stateless auth - no need to verify with server)
  setupUI();
  fetchTokens();
}

function setupUI() {
  // Set user info
  const userName = document.getElementById('userName');
  const roleBadge = document.getElementById('roleBadge');

  userName.textContent = currentUser.displayName;

  if (currentUser.role === 'superadmin') {
    roleBadge.textContent = '👑 Super Admin';
    roleBadge.className = 'text-xs px-2 py-0.5 rounded-full font-medium bg-yellow-100 text-yellow-800';
  } else {
    roleBadge.textContent = '🛡️ Admin';
    roleBadge.className = 'text-xs px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-800';
  }

  // Handle admin restrictions
  if (currentUser.role === 'admin') {
    // Lock tag field in add form
    document.getElementById('tagFieldContainer').classList.add('hidden');
    document.getElementById('tagLockedContainer').classList.remove('hidden');

    // Lock tag field in edit modal
    document.getElementById('editTagFieldContainer').classList.add('hidden');
    document.getElementById('editTagLockedContainer').classList.remove('hidden');

    // Hide WhatsApp tag selector for admin
    const whatsappTag = document.getElementById('whatsappTag');
    if (whatsappTag) {
      whatsappTag.value = 'banti';
      whatsappTag.disabled = true;
    }
  }
}

function setDefaultDate() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const local = new Date(now.getTime() - offset * 60000);
  const str = local.toISOString().slice(0, 16);
  document.getElementById('tokenDate').value = str;
}

// ==================== API HELPER ====================

async function apiRequest(method, url, body = null) {
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`
    }
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  return response.json();
}

// ==================== AUTH ====================

async function handleLogout() {
  // Clear local storage first, then redirect immediately
  const token = localStorage.getItem('authToken');
  localStorage.removeItem('authToken');
  localStorage.removeItem('user');
  
  // Try API logout in background, don't wait
  if (token) {
    fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
    }).catch(() => {});
  }

  window.location.href = '/login.html';
}

// ==================== DARK MODE ====================

function initDarkMode() {
  const saved = localStorage.getItem('darkMode');
  if (saved === 'true') {
    darkMode = true;
    document.body.classList.add('dark-mode');
    document.getElementById('darkModeIcon').className = 'fas fa-sun text-yellow-400';
  }
}

function toggleDarkMode() {
  darkMode = !darkMode;
  document.body.classList.toggle('dark-mode', darkMode);
  localStorage.setItem('darkMode', darkMode);

  const icon = document.getElementById('darkModeIcon');
  if (darkMode) {
    icon.className = 'fas fa-sun text-yellow-400';
  } else {
    icon.className = 'fas fa-moon text-gray-600 dark-text';
  }
}

// ==================== STATUS BANNER ====================

function showBanner(message, type = 'success') {
  const banner = document.getElementById('statusBanner');
  const content = document.getElementById('statusContent');
  const icon = document.getElementById('statusIcon');
  const text = document.getElementById('statusText');

  content.className = `px-6 py-3 text-white text-center font-medium text-sm flex items-center justify-center gap-2 banner-${type}`;

  if (type === 'success') {
    icon.className = 'fas fa-check-circle';
  } else if (type === 'error') {
    icon.className = 'fas fa-exclamation-circle';
  } else {
    icon.className = 'fas fa-info-circle';
  }

  text.textContent = message;
  banner.classList.remove('-translate-y-full');
  banner.classList.add('translate-y-0');

  if (bannerTimeout) clearTimeout(bannerTimeout);
  bannerTimeout = setTimeout(hideBanner, 5000);
}

function hideBanner() {
  const banner = document.getElementById('statusBanner');
  banner.classList.remove('translate-y-0');
  banner.classList.add('-translate-y-full');
}

// ==================== FETCH TOKENS ====================

async function fetchTokens() {
  showLoading(true);

  try {
    const data = await apiRequest('GET', '/api/tokens');
    if (data.success) {
      allTokens = data.tokens || [];
      document.getElementById('tokenCount').textContent = `(${allTokens.length})`;
      applyFilters();
      showBanner(`Loaded ${allTokens.length} tokens`, 'info');
    } else {
      showBanner(data.message || 'Failed to fetch tokens', 'error');
      allTokens = [];
      applyFilters();
    }
  } catch (error) {
    showBanner('Connection error. Please try again.', 'error');
    allTokens = [];
    applyFilters();
  }

  showLoading(false);
}

async function refreshTokens() {
  const icon = document.getElementById('refreshIcon');
  icon.classList.add('fa-spin');
  await fetchTokens();
  setTimeout(() => icon.classList.remove('fa-spin'), 500);
}

function showLoading(show) {
  document.getElementById('loadingState').classList.toggle('hidden', !show);
  document.getElementById('tokensTableWrapper').classList.toggle('hidden', show);
  document.getElementById('emptyState').classList.add('hidden');
}

// ==================== ADD TOKEN ====================

async function addToken() {
  const name = document.getElementById('tokenName').value.trim();
  const value = document.getElementById('tokenValue').value.trim();
  const tag = currentUser.role === 'admin' ? 'banti' : document.getElementById('tokenTag').value;
  const category = document.getElementById('tokenCategory').value;
  const date = document.getElementById('tokenDate').value;

  if (!name) {
    showBanner('Please enter a name', 'error');
    return;
  }
  if (!value) {
    showBanner('Please enter a token value', 'error');
    return;
  }

  try {
    const data = await apiRequest('POST', '/api/tokens', {
      name,
      token: value,
      tag,
      category,
      createdAt: date ? new Date(date).toISOString() : new Date().toISOString()
    });

    if (data.success) {
      showBanner('Token added successfully!', 'success');
      // Clear form
      document.getElementById('tokenName').value = '';
      document.getElementById('tokenValue').value = '';
      if (currentUser.role !== 'admin') document.getElementById('tokenTag').value = '';
      document.getElementById('tokenCategory').value = '';
      setDefaultDate();
      await fetchTokens();
    } else {
      showBanner(data.message || 'Failed to add token', 'error');
    }
  } catch (error) {
    showBanner('Connection error. Please try again.', 'error');
  }
}

// ==================== SEARCH & FILTER ====================

function initSearchListener() {
  const searchInput = document.getElementById('searchInput');
  let searchTimer;

  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      applyFilters();
    }, 300);

    // Show/hide clear button
    document.getElementById('clearSearchBtn').classList.toggle('hidden', !searchInput.value);
  });
}

function clearSearch() {
  document.getElementById('searchInput').value = '';
  document.getElementById('clearSearchBtn').classList.add('hidden');
  applyFilters();
}

function applyFilters() {
  const search = document.getElementById('searchInput').value.toLowerCase().trim();
  const tagFilter = document.getElementById('filterTag').value;
  const categoryFilter = document.getElementById('filterCategory').value;
  const expiryFilter = document.getElementById('filterExpiry').value;
  const dateRange = document.getElementById('filterDateRange').value;
  const sort = document.getElementById('sortFilter').value;

  const now = new Date();

  filteredTokens = allTokens.filter(token => {
    // Search filter
    if (search) {
      const matchName = (token.name || '').toLowerCase().includes(search);
      const matchValue = (token.value || '').toLowerCase().includes(search);
      if (!matchName && !matchValue) return false;
    }

    // Tag filter
    if (tagFilter) {
      if (tagFilter === 'none') {
        if (token.tag && token.tag.trim() !== '') return false;
      } else {
        if (token.tag !== tagFilter) return false;
      }
    }

    // Category filter
    if (categoryFilter) {
      if (categoryFilter === 'none') {
        if (token.category && token.category.trim() !== '') return false;
      } else {
        if (token.category !== categoryFilter) return false;
      }
    }

    // Expiry filter
    if (expiryFilter) {
      const created = new Date(token.createdAt);
      const daysDiff = Math.floor((now - created) / (1000 * 60 * 60 * 24));
      if (expiryFilter === 'expired' && daysDiff < 30) return false;
      if (expiryFilter === 'expiring' && (daysDiff < 25 || daysDiff >= 30)) return false;
      if (expiryFilter === 'active' && daysDiff > 24) return false;
    }

    // Date range filter
    if (dateRange) {
      const created = new Date(token.createdAt);
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      if (dateRange === 'today') {
        if (created < todayStart) return false;
      } else if (dateRange === '7days') {
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        if (created < weekAgo) return false;
      } else if (dateRange === '30days') {
        const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        if (created < monthAgo) return false;
      } else if (dateRange === '90days') {
        const qtrAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        if (created < qtrAgo) return false;
      }
    }

    return true;
  });

  // Sort
  filteredTokens.sort((a, b) => {
    if (sort === 'newest') return new Date(b.createdAt) - new Date(a.createdAt);
    if (sort === 'oldest') return new Date(a.createdAt) - new Date(b.createdAt);
    if (sort === 'name-az') return (a.name || '').localeCompare(b.name || '');
    if (sort === 'name-za') return (b.name || '').localeCompare(a.name || '');
    return 0;
  });

  updateFilterStats();
  renderTable();
}

function updateFilterStats() {
  const statsDiv = document.getElementById('filterStats');
  const resultText = document.getElementById('filterResultText');
  const expiredCountEl = document.getElementById('expiredCount');
  const expiringCountEl = document.getElementById('expiringCount');

  const now = new Date();
  let expiredNum = 0;
  let expiringNum = 0;

  allTokens.forEach(t => {
    const days = Math.floor((now - new Date(t.createdAt)) / (1000 * 60 * 60 * 24));
    if (days >= 30) expiredNum++;
    else if (days >= 25) expiringNum++;
  });

  const hasFilters = filteredTokens.length !== allTokens.length;

  if (hasFilters || expiredNum > 0 || expiringNum > 0) {
    statsDiv.classList.remove('hidden');
    resultText.textContent = `Showing ${filteredTokens.length} of ${allTokens.length} tokens`;

    if (expiredNum > 0) {
      expiredCountEl.classList.remove('hidden');
      expiredCountEl.querySelector('span').textContent = expiredNum;
    } else {
      expiredCountEl.classList.add('hidden');
    }

    if (expiringNum > 0) {
      expiringCountEl.classList.remove('hidden');
      expiringCountEl.querySelector('span').textContent = expiringNum;
    } else {
      expiringCountEl.classList.add('hidden');
    }
  } else {
    statsDiv.classList.add('hidden');
  }
}

// ==================== RENDER TABLE ====================

function renderTable() {
  const tbody = document.getElementById('tokensTableBody');
  const wrapper = document.getElementById('tokensTableWrapper');
  const empty = document.getElementById('emptyState');

  if (filteredTokens.length === 0) {
    wrapper.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }

  wrapper.classList.remove('hidden');
  empty.classList.add('hidden');

  const now = new Date();

  tbody.innerHTML = filteredTokens.map(token => {
    const isSelected = selectedTokenIds.has(token.id);
    const truncated = token.value.length > 20 ? token.value.substring(0, 20) + '...' : token.value;

    // Date formatting
    const created = new Date(token.createdAt);
    const dateStr = formatDate(created);
    const daysAgo = Math.floor((now - created) / (1000 * 60 * 60 * 24));
    const daysText = daysAgo === 0 ? 'Today' : daysAgo === 1 ? '1 day ago' : `${daysAgo} days ago`;

    // Expiry status
    let expiryClass, expiryTitle;
    if (daysAgo >= 30) {
      expiryClass = 'expiry-expired';
      expiryTitle = 'Expired (30+ days)';
    } else if (daysAgo >= 25) {
      expiryClass = 'expiry-warning';
      expiryTitle = 'Expiring Soon (25-29 days)';
    } else {
      expiryClass = 'expiry-active';
      expiryTitle = 'Active (0-24 days)';
    }

    // Tag badge
    const tagHtml = getTagBadge(token.tag);
    const catHtml = getCategoryBadge(token.category);

    return `
      <tr class="${isSelected ? 'selected-row' : ''} hover:bg-gray-50 transition-colors" data-id="${token.id}">
        <td class="px-3 py-3">
          <input type="checkbox" ${isSelected ? 'checked' : ''} onchange="toggleSelect('${token.id}')" class="rounded border-gray-300">
        </td>
        <td class="px-3 py-3">
          <div class="flex items-center gap-2">
            <i class="fas fa-user-circle text-gray-400"></i>
            <span class="font-medium text-gray-800 dark-text text-sm">${escapeHtml(token.name)}</span>
          </div>
        </td>
        <td class="px-3 py-3">
          <div class="flex items-center gap-2">
            <code class="text-xs text-gray-600 dark-text-muted bg-gray-100 px-2 py-1 rounded font-mono" style="background: ${darkMode ? '#374151' : '#f3f4f6'}">${escapeHtml(truncated)}</code>
            <button onclick="copyToken('${escapeAttr(token.value)}', this)" class="copy-btn text-gray-400 hover:text-indigo-600 transition" title="Copy token">
              <i class="fas fa-copy text-xs"></i>
            </button>
          </div>
        </td>
        <td class="px-3 py-3">${tagHtml}</td>
        <td class="px-3 py-3">${catHtml}</td>
        <td class="px-3 py-3">
          <div class="text-xs">
            <div class="flex items-center gap-1 text-gray-700 dark-text">
              <span class="expiry-dot ${expiryClass}" title="${expiryTitle}"></span>
              ${dateStr}
            </div>
            <div class="text-gray-400 dark-text-muted mt-0.5">${daysText}</div>
          </div>
        </td>
        <td class="px-3 py-3">
          <div class="flex items-center gap-1">
            <button onclick="openEditModal('${token.id}')" class="p-1.5 text-green-600 hover:bg-green-50 rounded-lg transition" title="Edit">
              <i class="fas fa-edit text-sm"></i>
            </button>
            <button onclick="deleteToken('${token.id}', '${escapeAttr(token.name)}')" class="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition" title="Delete">
              <i class="fas fa-trash text-sm"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  updateBulkActionsBar();
  updateSelectAllCheckbox();
}

// ==================== HELPERS ====================

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  if (!str) return '';
  return str.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function formatDate(date) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[date.getMonth()];
  const day = date.getDate();
  const year = date.getFullYear();
  let hours = date.getHours();
  const mins = String(date.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${month} ${day}, ${year} ${hours}:${mins} ${ampm}`;
}

function getTagBadge(tag) {
  const tags = {
    'banti': { label: '🔴 Banti', class: 'tag-banti' },
    'development': { label: '🟢 Development', class: 'tag-development' },
    'testing': { label: '🟡 Testing', class: 'tag-testing' },
    'staging': { label: '🟠 Staging', class: 'tag-staging' },
    'personal': { label: '🔵 Personal', class: 'tag-personal' }
  };

  if (tag && tags[tag]) {
    return `<span class="tag-badge ${tags[tag].class}">${tags[tag].label}</span>`;
  }
  return `<span class="tag-badge tag-none">No Tag</span>`;
}

function getCategoryBadge(category) {
  const cats = {
    'shakti': { label: '💪 Shakti', class: 'cat-shakti' },
    'gt': { label: '🎯 GT', class: 'cat-gt' },
    'cadbury': { label: '🍫 Cadbury', class: 'cat-cadbury' },
    'rs': { label: '💰 RS', class: 'cat-rs' },
    'other_apk': { label: '📦 Other APK', class: 'cat-other_apk' },
    'personal_apk': { label: '📱 Personal APK', class: 'cat-personal_apk' }
  };

  if (category && cats[category]) {
    return `<span class="tag-badge ${cats[category].class}">${cats[category].label}</span>`;
  }
  return `<span class="text-gray-400 text-xs">-</span>`;
}

// ==================== COPY TOKEN ====================

function copyToken(value, btn) {
  navigator.clipboard.writeText(value).then(() => {
    const icon = btn.querySelector('i');
    icon.className = 'fas fa-check text-xs';
    btn.classList.add('copied');
    setTimeout(() => {
      icon.className = 'fas fa-copy text-xs';
      btn.classList.remove('copied');
    }, 2000);
  }).catch(() => {
    // Fallback
    const textarea = document.createElement('textarea');
    textarea.value = value;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);

    const icon = btn.querySelector('i');
    icon.className = 'fas fa-check text-xs';
    btn.classList.add('copied');
    setTimeout(() => {
      icon.className = 'fas fa-copy text-xs';
      btn.classList.remove('copied');
    }, 2000);
  });
}

// ==================== SELECT / BULK ACTIONS ====================

function toggleSelect(id) {
  if (selectedTokenIds.has(id)) {
    selectedTokenIds.delete(id);
  } else {
    selectedTokenIds.add(id);
  }
  renderTable();
}

function toggleSelectAll() {
  const checkbox = document.getElementById('selectAllCheckbox');
  if (checkbox.checked) {
    filteredTokens.forEach(t => selectedTokenIds.add(t.id));
  } else {
    filteredTokens.forEach(t => selectedTokenIds.delete(t.id));
  }
  renderTable();
}

function updateSelectAllCheckbox() {
  const checkbox = document.getElementById('selectAllCheckbox');
  if (filteredTokens.length === 0) {
    checkbox.checked = false;
    checkbox.indeterminate = false;
    return;
  }

  const allSelected = filteredTokens.every(t => selectedTokenIds.has(t.id));
  const someSelected = filteredTokens.some(t => selectedTokenIds.has(t.id));

  checkbox.checked = allSelected;
  checkbox.indeterminate = someSelected && !allSelected;
}

function updateBulkActionsBar() {
  const bar = document.getElementById('bulkActionsBar');
  const countEl = document.getElementById('selectedCount');

  if (selectedTokenIds.size > 0) {
    bar.classList.remove('hidden');
    countEl.textContent = `${selectedTokenIds.size} selected`;
  } else {
    bar.classList.add('hidden');
  }
}

function deselectAll() {
  selectedTokenIds.clear();
  renderTable();
}

// ==================== DELETE TOKEN ====================

async function deleteToken(id, name) {
  if (!confirm(`Are you sure you want to delete token "${name}"?`)) return;

  try {
    const data = await apiRequest('DELETE', `/api/tokens/${id}`);
    if (data.success) {
      showBanner('Token deleted successfully!', 'success');
      selectedTokenIds.delete(id);
      await fetchTokens();
    } else {
      showBanner(data.message || 'Failed to delete token', 'error');
    }
  } catch (error) {
    showBanner('Connection error. Please try again.', 'error');
  }
}

async function deleteSelected() {
  const count = selectedTokenIds.size;
  if (count === 0) return;
  if (!confirm(`Are you sure you want to delete ${count} selected tokens?`)) return;

  let success = 0;
  let failed = 0;

  for (const id of [...selectedTokenIds]) {
    try {
      const data = await apiRequest('DELETE', `/api/tokens/${id}`);
      if (data.success) {
        success++;
        selectedTokenIds.delete(id);
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }

  showBanner(`Deleted: ${success} | Failed: ${failed}`, success > 0 ? 'success' : 'error');
  await fetchTokens();
}

// ==================== EDIT TOKEN MODAL ====================

function openEditModal(id) {
  const token = allTokens.find(t => t.id === id);
  if (!token) return;

  document.getElementById('editTokenId').value = id;
  document.getElementById('editName').value = token.name || '';
  document.getElementById('editValue').value = token.value || '';

  if (currentUser.role !== 'admin') {
    document.getElementById('editTag').value = token.tag || '';
  }

  document.getElementById('editCategory').value = token.category || '';

  // Set date
  if (token.createdAt) {
    const d = new Date(token.createdAt);
    const offset = d.getTimezoneOffset();
    const local = new Date(d.getTime() - offset * 60000);
    document.getElementById('editDate').value = local.toISOString().slice(0, 16);
  }

  document.getElementById('editModal').classList.remove('hidden');
}

function closeEditModal() {
  document.getElementById('editModal').classList.add('hidden');
}

async function saveEdit() {
  const id = document.getElementById('editTokenId').value;
  const name = document.getElementById('editName').value.trim();
  const value = document.getElementById('editValue').value.trim();
  const tag = currentUser.role === 'admin' ? 'banti' : document.getElementById('editTag').value;
  const category = document.getElementById('editCategory').value;
  const date = document.getElementById('editDate').value;

  if (!name || !value) {
    showBanner('Name and token value are required', 'error');
    return;
  }

  try {
    const data = await apiRequest('PUT', `/api/tokens/${id}`, {
      name,
      token: value,
      tag,
      category,
      createdAt: date ? new Date(date).toISOString() : undefined
    });

    if (data.success) {
      showBanner('Token updated successfully!', 'success');
      closeEditModal();
      await fetchTokens();
    } else {
      showBanner(data.message || 'Failed to update token', 'error');
    }
  } catch (error) {
    showBanner('Connection error. Please try again.', 'error');
  }
}

// ==================== BULK UPDATE MODALS ====================

// Bulk Tag Update
function showBulkTagModal() {
  if (currentUser.role === 'admin') {
    showBanner('Admin users cannot use bulk tag update', 'error');
    return;
  }
  if (selectedTokenIds.size === 0) return;
  document.getElementById('bulkTagModal').classList.remove('hidden');
}

function closeBulkTagModal() {
  document.getElementById('bulkTagModal').classList.add('hidden');
}

async function executeBulkTagUpdate() {
  const tag = document.getElementById('bulkTagSelect').value;
  if (!confirm(`Update tag to "${tag || 'No Tag'}" for ${selectedTokenIds.size} tokens?`)) return;

  closeBulkTagModal();
  let success = 0, failed = 0;

  for (const id of [...selectedTokenIds]) {
    try {
      const token = allTokens.find(t => t.id === id);
      if (!token) { failed++; continue; }
      const data = await apiRequest('PUT', `/api/tokens/${id}`, {
        name: token.name,
        token: token.value,
        tag: tag,
        category: token.category,
        createdAt: token.createdAt
      });
      if (data.success) success++;
      else failed++;
    } catch { failed++; }
  }

  showBanner(`Tag updated: ${success} | Failed: ${failed}`, success > 0 ? 'success' : 'error');
  await fetchTokens();
}

// Bulk Category Update
function showBulkCategoryModal() {
  if (selectedTokenIds.size === 0) return;
  document.getElementById('bulkCategoryModal').classList.remove('hidden');
}

function closeBulkCategoryModal() {
  document.getElementById('bulkCategoryModal').classList.add('hidden');
}

async function executeBulkCategoryUpdate() {
  const category = document.getElementById('bulkCategorySelect').value;
  if (!confirm(`Update category to "${category || 'No Category'}" for ${selectedTokenIds.size} tokens?`)) return;

  closeBulkCategoryModal();
  let success = 0, failed = 0;

  for (const id of [...selectedTokenIds]) {
    try {
      const token = allTokens.find(t => t.id === id);
      if (!token) { failed++; continue; }
      const data = await apiRequest('PUT', `/api/tokens/${id}`, {
        name: token.name,
        token: token.value,
        tag: token.tag,
        category: category,
        createdAt: token.createdAt
      });
      if (data.success) success++;
      else failed++;
    } catch { failed++; }
  }

  showBanner(`Category updated: ${success} | Failed: ${failed}`, success > 0 ? 'success' : 'error');
  await fetchTokens();
}

// Bulk Date Update
function showBulkDateModal() {
  if (selectedTokenIds.size === 0) return;
  // Set default date to now
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const local = new Date(now.getTime() - offset * 60000);
  document.getElementById('bulkDateSelect').value = local.toISOString().slice(0, 16);
  document.getElementById('bulkDateModal').classList.remove('hidden');
}

function closeBulkDateModal() {
  document.getElementById('bulkDateModal').classList.add('hidden');
}

async function executeBulkDateUpdate() {
  const dateStr = document.getElementById('bulkDateSelect').value;
  if (!dateStr) {
    showBanner('Please select a date', 'error');
    return;
  }
  if (!confirm(`Update date for ${selectedTokenIds.size} tokens?`)) return;

  closeBulkDateModal();
  const isoDate = new Date(dateStr).toISOString();
  let success = 0, failed = 0;

  for (const id of [...selectedTokenIds]) {
    try {
      const token = allTokens.find(t => t.id === id);
      if (!token) { failed++; continue; }
      const data = await apiRequest('PUT', `/api/tokens/${id}`, {
        name: token.name,
        token: token.value,
        tag: token.tag,
        category: token.category,
        createdAt: isoDate
      });
      if (data.success) success++;
      else failed++;
    } catch { failed++; }
  }

  showBanner(`Date updated: ${success} | Failed: ${failed}`, success > 0 ? 'success' : 'error');
  await fetchTokens();
}

// ==================== WHATSAPP IMPORT ====================

function toggleWhatsAppImport() {
  const section = document.getElementById('whatsappSection');
  section.classList.toggle('hidden');
  if (!section.classList.contains('hidden')) {
    document.getElementById('bulkDeleteSection').classList.add('hidden');
  }
}

function parseWhatsApp() {
  const text = document.getElementById('whatsappText').value.trim();
  if (!text) {
    showBanner('Please paste WhatsApp messages', 'error');
    return;
  }

  parsedWhatsAppTokens = [];
  const lines = text.split('\n');

  // Pattern: [MM/DD/YYYY HH:MM AM/PM] Name: token_value
  // Also try: [M/D/YYYY, H:MM:SS AM/PM] Name: token_value
  const patterns = [
    /\[(\d{1,2}\/\d{1,2}\/\d{4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?)\]\s+([^:]+):\s+(.+)/,
    /(\d{1,2}\/\d{1,2}\/\d{4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?)\s*-\s*([^:]+):\s+(.+)/
  ];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let matched = false;
    for (const pattern of patterns) {
      const match = trimmed.match(pattern);
      if (match) {
        const dateStr = match[1];
        const timeStr = match[2];
        const name = match[3].trim();
        const tokenValue = match[4].trim();

        // Parse date
        let parsedDate;
        try {
          parsedDate = new Date(`${dateStr} ${timeStr}`);
          if (isNaN(parsedDate.getTime())) {
            parsedDate = new Date();
          }
        } catch {
          parsedDate = new Date();
        }

        if (tokenValue && tokenValue.length > 5) {
          parsedWhatsAppTokens.push({
            name: name,
            value: tokenValue,
            date: parsedDate.toISOString()
          });
        }
        matched = true;
        break;
      }
    }

    // If no pattern matched, try to extract just name: token
    if (!matched) {
      const simpleMatch = trimmed.match(/^([^:]+):\s+(\S+.*)$/);
      if (simpleMatch) {
        const name = simpleMatch[1].trim();
        const tokenValue = simpleMatch[2].trim();
        if (tokenValue.length > 5 && !name.includes('[') && !name.match(/^\d{1,2}\/\d{1,2}\/\d{4}/)) {
          parsedWhatsAppTokens.push({
            name: name,
            value: tokenValue,
            date: new Date().toISOString()
          });
        }
      }
    }
  }

  // Show preview
  const preview = document.getElementById('whatsappPreview');
  const count = document.getElementById('whatsappPreviewCount');
  const list = document.getElementById('whatsappPreviewList');
  const importBtn = document.getElementById('importWhatsAppBtn');

  if (parsedWhatsAppTokens.length > 0) {
    preview.classList.remove('hidden');
    importBtn.classList.remove('hidden');
    count.textContent = parsedWhatsAppTokens.length;
    list.innerHTML = parsedWhatsAppTokens.map((t, i) => `
      <div class="flex items-center gap-2 p-1.5 bg-gray-50 rounded dark-card">
        <span class="text-gray-400 w-6">${i + 1}.</span>
        <span class="font-medium text-gray-700 dark-text">${escapeHtml(t.name)}</span>
        <span class="text-gray-400">→</span>
        <code class="text-xs text-gray-500 dark-text-muted">${escapeHtml(t.value.substring(0, 30))}${t.value.length > 30 ? '...' : ''}</code>
      </div>
    `).join('');
  } else {
    preview.classList.add('hidden');
    importBtn.classList.add('hidden');
    showBanner('No tokens detected. Check the message format.', 'error');
  }
}

async function importWhatsApp() {
  if (parsedWhatsAppTokens.length === 0) return;

  const tag = currentUser.role === 'admin' ? 'banti' : document.getElementById('whatsappTag').value;
  const category = document.getElementById('whatsappCategory').value;

  if (!confirm(`Import ${parsedWhatsAppTokens.length} tokens?`)) return;

  let success = 0, failed = 0, duplicates = 0;

  for (const t of parsedWhatsAppTokens) {
    try {
      const data = await apiRequest('POST', '/api/tokens', {
        name: t.name,
        token: t.value,
        tag: tag,
        category: category,
        createdAt: t.date
      });

      if (data.success) {
        success++;
      } else if (data.message && data.message.includes('already exists')) {
        duplicates++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }

  showBanner(`Imported: ${success} | Duplicates: ${duplicates} | Failed: ${failed}`, success > 0 ? 'success' : 'error');

  // Reset
  document.getElementById('whatsappText').value = '';
  document.getElementById('whatsappPreview').classList.add('hidden');
  document.getElementById('importWhatsAppBtn').classList.add('hidden');
  parsedWhatsAppTokens = [];

  await fetchTokens();
}

// ==================== BULK DELETE ====================

function toggleBulkDelete() {
  const section = document.getElementById('bulkDeleteSection');
  section.classList.toggle('hidden');
  if (!section.classList.contains('hidden')) {
    document.getElementById('whatsappSection').classList.add('hidden');
  }
}

function findBulkDeleteTokens() {
  const text = document.getElementById('bulkDeleteText').value.trim();
  if (!text) {
    showBanner('Please paste token values', 'error');
    return;
  }

  // Split by newlines, spaces, commas
  const values = text.split(/[\n\r\s,]+/).map(v => v.trim()).filter(v => v.length > 0);
  bulkDeleteMatchedIds = [];
  let foundCount = 0;
  let notFoundCount = 0;
  const matchedItems = [];
  const notFoundItems = [];

  for (const val of values) {
    const token = allTokens.find(t => t.value === val);
    if (token) {
      bulkDeleteMatchedIds.push(token.id);
      matchedItems.push(token);
      foundCount++;
    } else {
      notFoundItems.push(val);
      notFoundCount++;
    }
  }

  const preview = document.getElementById('bulkDeletePreview');
  const foundEl = document.getElementById('bulkDeleteFoundCount');
  const notFoundEl = document.getElementById('bulkDeleteNotFoundCount');
  const list = document.getElementById('bulkDeletePreviewList');
  const execBtn = document.getElementById('executeBulkDeleteBtn');

  preview.classList.remove('hidden');
  foundEl.textContent = foundCount;
  notFoundEl.textContent = notFoundCount;

  let html = '';
  if (matchedItems.length > 0) {
    html += matchedItems.map(t => `
      <div class="flex items-center gap-2 p-1.5 bg-red-50 rounded text-red-700">
        <i class="fas fa-check-circle text-green-500"></i>
        <span class="font-medium">${escapeHtml(t.name)}</span>
        <code class="text-xs">${escapeHtml(t.value.substring(0, 25))}...</code>
      </div>
    `).join('');
  }
  if (notFoundItems.length > 0) {
    html += notFoundItems.slice(0, 10).map(v => `
      <div class="flex items-center gap-2 p-1.5 bg-gray-50 rounded text-gray-500">
        <i class="fas fa-times-circle text-red-400"></i>
        <code class="text-xs">${escapeHtml(v.substring(0, 30))}...</code>
        <span class="text-xs italic">Not found</span>
      </div>
    `).join('');
    if (notFoundItems.length > 10) {
      html += `<div class="text-gray-400 text-xs p-1">...and ${notFoundItems.length - 10} more not found</div>`;
    }
  }

  list.innerHTML = html;

  if (bulkDeleteMatchedIds.length > 0) {
    execBtn.classList.remove('hidden');
  } else {
    execBtn.classList.add('hidden');
  }
}

async function executeBulkDelete() {
  if (bulkDeleteMatchedIds.length === 0) return;
  if (!confirm(`Delete ${bulkDeleteMatchedIds.length} matched tokens? This cannot be undone.`)) return;

  let success = 0, failed = 0;

  for (const id of bulkDeleteMatchedIds) {
    try {
      const data = await apiRequest('DELETE', `/api/tokens/${id}`);
      if (data.success) success++;
      else failed++;
    } catch { failed++; }
  }

  showBanner(`Deleted: ${success} | Failed: ${failed}`, success > 0 ? 'success' : 'error');

  // Reset
  document.getElementById('bulkDeleteText').value = '';
  document.getElementById('bulkDeletePreview').classList.add('hidden');
  document.getElementById('executeBulkDeleteBtn').classList.add('hidden');
  bulkDeleteMatchedIds = [];

  await fetchTokens();
}

// ==================== EXPORT ====================

function toggleExportDropdown() {
  const dropdown = document.getElementById('exportDropdown');
  dropdown.classList.toggle('hidden');

  // Close on click outside
  const closeHandler = (e) => {
    if (!dropdown.contains(e.target) && !e.target.closest('[onclick="toggleExportDropdown()"]')) {
      dropdown.classList.add('hidden');
      document.removeEventListener('click', closeHandler);
    }
  };

  if (!dropdown.classList.contains('hidden')) {
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
  }
}

function exportCSV() {
  const tokens = filteredTokens.length > 0 ? filteredTokens : allTokens;
  if (tokens.length === 0) {
    showBanner('No tokens to export', 'error');
    return;
  }

  const headers = ['Name', 'Token', 'Tag', 'Category', 'Created At'];
  const rows = tokens.map(t => [
    `"${(t.name || '').replace(/"/g, '""')}"`,
    `"${(t.value || '').replace(/"/g, '""')}"`,
    `"${(t.tag || '').replace(/"/g, '""')}"`,
    `"${(t.category || '').replace(/"/g, '""')}"`,
    `"${(t.createdAt || '').replace(/"/g, '""')}"`
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  downloadFile(csv, 'tokens_export.csv', 'text/csv');
  showBanner(`Exported ${tokens.length} tokens as CSV`, 'success');

  document.getElementById('exportDropdown').classList.add('hidden');
}

function exportJSON() {
  const tokens = filteredTokens.length > 0 ? filteredTokens : allTokens;
  if (tokens.length === 0) {
    showBanner('No tokens to export', 'error');
    return;
  }

  const json = JSON.stringify(tokens, null, 2);
  downloadFile(json, 'tokens_export.json', 'application/json');
  showBanner(`Exported ${tokens.length} tokens as JSON`, 'success');

  document.getElementById('exportDropdown').classList.add('hidden');
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ==================== IMPORT ====================

async function importJSON(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const tokens = JSON.parse(e.target.result);

      if (!Array.isArray(tokens)) {
        showBanner('Invalid JSON file. Expected an array of tokens.', 'error');
        return;
      }

      if (!confirm(`Import ${tokens.length} tokens from file?`)) return;

      let success = 0, failed = 0, duplicates = 0;

      for (const t of tokens) {
        try {
          const data = await apiRequest('POST', '/api/tokens', {
            name: t.name || 'Imported',
            token: t.value || t.token || '',
            tag: t.tag || '',
            category: t.category || '',
            createdAt: t.createdAt || new Date().toISOString()
          });

          if (data.success) {
            success++;
          } else if (data.message && data.message.includes('already exists')) {
            duplicates++;
          } else {
            failed++;
          }
        } catch {
          failed++;
        }
      }

      showBanner(`Imported: ${success} | Duplicates: ${duplicates} | Failed: ${failed}`, success > 0 ? 'success' : 'error');
      await fetchTokens();
    } catch {
      showBanner('Failed to parse JSON file', 'error');
    }
  };

  reader.readAsText(file);
  // Reset file input
  event.target.value = '';
}
