require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ==================== IN-MEMORY STATE ====================

// Secret for token signing
const AUTH_SECRET = 'tms_secret_key_2026';

// Users
const USERS = [
  {
    id: 1,
    username: 'web',
    password: 'web123',
    role: 'superadmin',
    displayName: 'Super Admin'
  },
  {
    id: 2,
    username: 'banti',
    password: 'banti123',
    role: 'admin',
    displayName: 'Banti'
  }
];

// Cache for Pastebin data to avoid rate limits
let tokenCache = {
  data: null,
  lastFetch: 0,
  ttl: 3000 // 3 seconds cache
};

// ==================== PASTEBIN INTEGRATION ====================

function generateTokenId(tokenValue) {
  if (!tokenValue || tokenValue.length < 20) {
    const hash = crypto.createHash('md5').update(tokenValue || '').digest('hex');
    return Buffer.from(hash).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);
  }
  const first10 = tokenValue.substring(0, 10);
  const last10 = tokenValue.substring(tokenValue.length - 10);
  return Buffer.from(first10 + last10).toString('base64').replace(/[^a-zA-Z0-9]/g, '');
}

function parseTokensFromText(text) {
  if (!text || !text.trim()) return [];
  const lines = text.trim().split('\n');
  const tokens = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split('\t');
    if (parts.length >= 2) {
      const name = parts[0] || '';
      const value = parts[1] || '';
      const tag = parts[2] || '';
      const date = parts[3] || new Date().toISOString();
      const category = parts[4] || '';
      tokens.push({
        id: generateTokenId(value),
        name: name,
        value: value,
        tag: tag,
        category: category,
        createdAt: date
      });
    }
  }
  return tokens;
}

function tokensToText(tokens) {
  return tokens.map(t => {
    return [
      t.name || '',
      t.value || '',
      t.tag || '',
      t.createdAt || new Date().toISOString(),
      t.category || ''
    ].join('\t');
  }).join('\n');
}

// Find the latest paste key by listing user's pastes
async function findLatestPasteKey() {
  const apiKey = process.env.PASTEBIN_API_KEY;
  const userKey = process.env.PASTEBIN_USER_KEY || '';
  const pasteName = process.env.PASTEBIN_PASTE_KEY || 'token_data';

  if (!apiKey || !userKey) return null;

  try {
    const response = await axios.post('https://pastebin.com/api/api_post.php', new URLSearchParams({
      api_dev_key: apiKey,
      api_user_key: userKey,
      api_option: 'list',
      api_results_limit: '100'
    }).toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10000
    });

    const xml = response.data;
    if (!xml || typeof xml !== 'string' || xml.includes('No pastes found')) return null;

    // Parse XML to find paste with matching name
    const pasteBlocks = xml.split('<paste>').slice(1);
    let latestKey = null;
    let latestDate = 0;

    for (const block of pasteBlocks) {
      const nameMatch = block.match(/<paste_title>(.*?)<\/paste_title>/);
      const keyMatch = block.match(/<paste_key>(.*?)<\/paste_key>/);
      const dateMatch = block.match(/<paste_date>(.*?)<\/paste_date>/);

      if (nameMatch && keyMatch && nameMatch[1] === pasteName) {
        const date = parseInt(dateMatch ? dateMatch[1] : '0');
        if (date >= latestDate) {
          latestDate = date;
          latestKey = keyMatch[1];
        }
      }
    }

    if (latestKey) {
      console.log(`[Pastebin] Found latest paste key: ${latestKey}`);
    }
    return latestKey;
  } catch (error) {
    console.error('[Pastebin] List pastes error:', error.message);
    return null;
  }
}

async function fetchTokensFromPastebin() {
  const now = Date.now();
  if (tokenCache.data !== null && (now - tokenCache.lastFetch) < tokenCache.ttl) {
    return tokenCache.data;
  }

  const apiKey = process.env.PASTEBIN_API_KEY;
  if (!apiKey || apiKey === 'your_pastebin_api_dev_key') {
    console.log('[Pastebin] No API key configured, returning empty array');
    tokenCache.data = [];
    tokenCache.lastFetch = now;
    return [];
  }

  try {
    // First try to find the latest paste by listing user's pastes
    const latestKey = await findLatestPasteKey();
    const pasteKey = latestKey || process.env.PASTEBIN_PASTE_KEY;

    if (!pasteKey || pasteKey === 'paste_key_to_read_and_update') {
      console.log('[Pastebin] No paste found, returning empty array');
      tokenCache.data = [];
      tokenCache.lastFetch = now;
      return [];
    }

    const url = `https://pastebin.com/raw/${pasteKey}`;
    const response = await axios.get(url, { timeout: 10000 });
    const tokens = parseTokensFromText(response.data);
    tokenCache.data = tokens;
    tokenCache.lastFetch = now;
    console.log(`[Pastebin] Fetched ${tokens.length} tokens from paste ${pasteKey}`);
    return tokens;
  } catch (error) {
    if (error.response && error.response.status === 404) {
      console.log('[Pastebin] Paste not found, returning empty');
      tokenCache.data = [];
      tokenCache.lastFetch = now;
      return [];
    }
    console.error('[Pastebin] Fetch error:', error.message);
    if (tokenCache.data !== null) return tokenCache.data;
    return [];
  }
}

async function saveTokensToPastebin(tokens) {
  const apiKey = process.env.PASTEBIN_API_KEY;
  const userKey = process.env.PASTEBIN_USER_KEY || '';
  const pasteName = process.env.PASTEBIN_PASTE_KEY || 'token_data';

  if (!apiKey || apiKey === 'your_pastebin_api_dev_key') {
    console.log('[Pastebin] No API key configured, storing in cache only');
    tokenCache.data = tokens;
    tokenCache.lastFetch = Date.now();
    return true;
  }

  const textContent = tokensToText(tokens);

  try {
    // Delete ALL old pastes with same name first
    if (userKey) {
      try {
        const listResp = await axios.post('https://pastebin.com/api/api_post.php', new URLSearchParams({
          api_dev_key: apiKey,
          api_user_key: userKey,
          api_option: 'list',
          api_results_limit: '100'
        }).toString(), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 10000
        });

        const xml = listResp.data;
        if (xml && typeof xml === 'string' && !xml.includes('No pastes found')) {
          const pasteBlocks = xml.split('<paste>').slice(1);
          for (const block of pasteBlocks) {
            const nameMatch = block.match(/<paste_title>(.*?)<\/paste_title>/);
            const keyMatch = block.match(/<paste_key>(.*?)<\/paste_key>/);
            if (nameMatch && keyMatch && nameMatch[1] === pasteName) {
              try {
                await axios.post('https://pastebin.com/api/api_post.php', new URLSearchParams({
                  api_dev_key: apiKey,
                  api_option: 'delete',
                  api_paste_key: keyMatch[1],
                  api_user_key: userKey
                }).toString(), {
                  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                  timeout: 10000
                });
                console.log(`[Pastebin] Deleted old paste: ${keyMatch[1]}`);
              } catch (e) { /* ignore */ }
            }
          }
        }
      } catch (e) { /* ignore list errors */ }
    }

    // Create new paste with same name
    const params = new URLSearchParams({
      api_dev_key: apiKey,
      api_option: 'paste',
      api_paste_code: textContent || ' ',
      api_paste_private: '1',
      api_paste_name: pasteName,
      api_paste_format: 'text'
    });

    if (userKey) {
      params.append('api_user_key', userKey);
    }

    const response = await axios.post('https://pastebin.com/api/api_post.php', params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10000
    });

    const newPasteUrl = response.data;
    if (newPasteUrl && newPasteUrl.includes('pastebin.com/')) {
      const newKey = newPasteUrl.split('/').pop();
      console.log(`[Pastebin] Saved ${tokens.length} tokens. New paste key: ${newKey}`);
    }

    tokenCache.data = tokens;
    tokenCache.lastFetch = Date.now();
    return true;
  } catch (error) {
    console.error('[Pastebin] Save error:', error.response?.data || error.message);
    tokenCache.data = tokens;
    tokenCache.lastFetch = Date.now();
    return false;
  }
}

// ==================== AUTH MIDDLEWARE ====================

function generateAuthToken(user) {
  const payload = JSON.stringify(user);
  const encoded = Buffer.from(payload).toString('base64');
  const signature = crypto.createHmac('sha256', AUTH_SECRET).update(encoded).digest('hex');
  return `${encoded}.${signature}`;
}

function verifyAuthToken(token) {
  try {
    const [encoded, signature] = token.split('.');
    if (!encoded || !signature) return null;
    const expectedSig = crypto.createHmac('sha256', AUTH_SECRET).update(encoded).digest('hex');
    if (signature !== expectedSig) return null;
    const payload = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    return payload;
  } catch {
    return null;
  }
}

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  const token = authHeader.split(' ')[1];
  const user = verifyAuthToken(token);
  if (!user) {
    return res.status(401).json({ success: false, message: 'Invalid or expired session' });
  }

  req.user = user;
  req.sessionToken = token;
  next();
}

function superAdminOnly(req, res, next) {
  if (req.user.role !== 'superadmin') {
    return res.status(403).json({ success: false, message: 'Super Admin access required' });
  }
  next();
}

function enforceAdminTagRestriction(req, res, next) {
  if (req.user.role === 'admin') {
    if (req.body && typeof req.body === 'object') {
      req.body.tag = 'banti';
    }
  }
  next();
}

// ==================== AUTH ROUTES ====================

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;

  const user = USERS.find(u => u.username === username && u.password === password);
  if (!user) {
    return res.status(401).json({ success: false, message: 'Invalid username or password' });
  }

  const userInfo = {
    id: user.id,
    username: user.username,
    role: user.role,
    displayName: user.displayName
  };

  const authToken = generateAuthToken(userInfo);

  console.log(`[Auth] User '${user.username}' logged in (${user.role})`);

  res.json({
    success: true,
    message: 'Login successful',
    token: authToken,
    user: userInfo
  });
});

app.post('/api/auth/logout', authenticate, (req, res) => {
  console.log(`[Auth] User '${req.user.username}' logged out`);
  res.json({ success: true, message: 'Logged out successfully' });
});

app.get('/api/auth/me', authenticate, (req, res) => {
  res.json({ success: true, user: req.user });
});

// ==================== HEALTH ====================

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    pasteKey: process.env.PASTEBIN_PASTE_KEY || 'not configured'
  });
});

// ==================== TOKEN ROUTES ====================

// Get all tokens
app.get('/api/tokens', authenticate, async (req, res) => {
  try {
    const tokens = await fetchTokensFromPastebin();
    res.json({ success: true, tokens });
  } catch (error) {
    console.error('[API] GET /api/tokens error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to fetch tokens' });
  }
});

// Add new token
app.post('/api/tokens', authenticate, enforceAdminTagRestriction, async (req, res) => {
  try {
    const { name, token: tokenValue, tag, category, createdAt } = req.body;

    if (!name || !tokenValue) {
      return res.status(400).json({ success: false, message: 'Name and token value are required' });
    }

    const tokens = await fetchTokensFromPastebin();

    // Duplicate check
    const duplicate = tokens.find(t => t.value === tokenValue);
    if (duplicate) {
      return res.status(409).json({ success: false, message: 'Token value already exists', existingToken: duplicate.name });
    }

    const newToken = {
      id: generateTokenId(tokenValue),
      name: name.trim(),
      value: tokenValue.trim(),
      tag: (tag || '').trim().toLowerCase(),
      category: (category || '').trim().toLowerCase(),
      createdAt: createdAt || new Date().toISOString()
    };

    tokens.push(newToken);
    await saveTokensToPastebin(tokens);

    res.json({ success: true, message: 'Token added successfully', token: newToken });
  } catch (error) {
    console.error('[API] POST /api/tokens error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to add token' });
  }
});

// Update token
app.put('/api/tokens/:id', authenticate, enforceAdminTagRestriction, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, token: tokenValue, tag, category, createdAt } = req.body;

    const tokens = await fetchTokensFromPastebin();
    const index = tokens.findIndex(t => t.id === id);

    if (index === -1) {
      return res.status(404).json({ success: false, message: 'Token not found' });
    }

    // Duplicate check (excluding current token)
    if (tokenValue) {
      const duplicate = tokens.find((t, i) => i !== index && t.value === tokenValue);
      if (duplicate) {
        return res.status(409).json({ success: false, message: 'Token value already exists', existingToken: duplicate.name });
      }
    }

    // If token value changed, regenerate ID
    const newValue = tokenValue ? tokenValue.trim() : tokens[index].value;
    const newId = generateTokenId(newValue);

    tokens[index] = {
      ...tokens[index],
      id: newId,
      name: name !== undefined ? name.trim() : tokens[index].name,
      value: newValue,
      tag: tag !== undefined ? (tag || '').trim().toLowerCase() : tokens[index].tag,
      category: category !== undefined ? (category || '').trim().toLowerCase() : tokens[index].category,
      createdAt: createdAt || tokens[index].createdAt
    };

    await saveTokensToPastebin(tokens);

    res.json({ success: true, message: 'Token updated successfully', token: tokens[index] });
  } catch (error) {
    console.error('[API] PUT /api/tokens error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to update token' });
  }
});

// Delete token
app.delete('/api/tokens/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const tokens = await fetchTokensFromPastebin();
    const index = tokens.findIndex(t => t.id === id);

    if (index === -1) {
      return res.status(404).json({ success: false, message: 'Token not found' });
    }

    const deleted = tokens.splice(index, 1)[0];
    await saveTokensToPastebin(tokens);

    res.json({ success: true, message: 'Token deleted successfully', token: deleted });
  } catch (error) {
    console.error('[API] DELETE /api/tokens error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to delete token' });
  }
});

// ==================== FALLBACK ROUTES ====================

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== START SERVER ====================

app.listen(PORT, () => {
  console.log(`\n🚀 Token Management System running on http://localhost:${PORT}`);
  console.log(`📋 Login page: http://localhost:${PORT}/login.html`);
  console.log(`📊 Dashboard: http://localhost:${PORT}/index.html`);
  console.log(`💾 Pastebin Paste Key: ${process.env.PASTEBIN_PASTE_KEY || 'NOT CONFIGURED'}`);
  console.log(`🔑 Pastebin API Key: ${process.env.PASTEBIN_API_KEY ? 'SET' : 'NOT SET'}\n`);
});
