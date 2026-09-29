(() => {
  const API = '/api';

  // ---------------------------------------------------------------------
  // Session state (kept in memory only — no localStorage per platform norms
  // for this kind of demo; a real deployment might use a secure cookie)
  // ---------------------------------------------------------------------
  const state = {
    aadhaarHash: null,     // returned after OTP request
    verifiedToken: null,   // set once OTP is confirmed
    reports: [],
    votedIds: new Set(),
  };

  // ---------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------
  function $(sel) { return document.querySelector(sel); }
  function $all(sel) { return Array.from(document.querySelectorAll(sel)); }

  function categoryBadgeClass(category) {
    return {
      'Deforestation': 'badge--deforestation',
      'Corruption': 'badge--corruption',
      'Fake Fees': 'badge--fakefees',
      'Environment': 'badge--environment',
    }[category] || 'badge--environment';
  }

  function evidenceIcons(list) {
    const map = { photo: '📷', audio: '🎙️', video: '🎬' };
    return (list || []).map((e) => map[e] || '').join(' ');
  }

  function evidenceMediaHtml(files) {
    if (!files || files.length === 0) return '';
    return `<div class="evidence-media">${files.map((f) => {
      if (f.kind === 'photo') return `<img src="${f.url}" alt="Evidence photo" loading="lazy" />`;
      if (f.kind === 'audio') return `<audio controls src="${f.url}"></audio>`;
      if (f.kind === 'video') return `<video controls src="${f.url}"></video>`;
      return '';
    }).join('')}</div>`;
  }

  function animateCount(el, target) {
    const duration = 900;
    const start = performance.now();
    function tick(now) {
      const progress = Math.min(1, (now - start) / duration);
      el.textContent = Math.floor(progress * target).toLocaleString('en-IN');
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // ---------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------
  async function loadStats() {
    try {
      const res = await fetch(`${API}/stats`);
      const data = await res.json();
      if (!data.ok) return;
      animateCount($('#statReports'), data.totalReports);
      animateCount($('#statVotes'), data.totalVotes);
      animateCount($('#statForwarded'), data.highlighted);
    } catch (e) {
      console.error('Failed to load stats', e);
    }
  }

  // ---------------------------------------------------------------------
  // Live feed
  // ---------------------------------------------------------------------
  function renderReports(reports) {
    const grid = $('#feedGrid');
    grid.innerHTML = '';

    if (reports.length === 0) {
      grid.innerHTML = '<p style="grid-column:1/-1;color:var(--text-faint)">No reports in this category yet — be the first to file one.</p>';
      return;
    }

    for (const report of reports) {
      const card = document.createElement('div');
      card.className = 'report-card' + (report.highlighted ? ' report-card--highlighted' : '');
      card.innerHTML = `
        <div class="report-card__top">
          <span class="badge ${categoryBadgeClass(report.category)}">${report.category}</span>
          <span class="evidence-icons">${evidenceIcons(report.evidence)}</span>
        </div>
        <h3>${escapeHtml(report.title)}</h3>
        <p class="report-card__loc">📍 ${escapeHtml(report.location)}</p>
        <p class="report-card__desc">${escapeHtml(report.description)}</p>
        ${evidenceMediaHtml(report.evidenceFiles)}
        ${report.highlighted ? '<p class="flag-forwarded">⚑ Forwarded to judiciary</p>' : ''}
        <div class="report-card__footer">
          <button class="vote-btn ${state.votedIds.has(report.id) ? 'voted' : ''}" data-id="${report.id}">
            ▲ <span class="vote-count">${report.votes}</span>
          </button>
          <span style="font-family:var(--font-mono);font-size:11px;color:var(--text-faint)">${report.id}</span>
        </div>
      `;
      grid.appendChild(card);
    }

    $all('.vote-btn').forEach((btn) => btn.addEventListener('click', onVoteClick));
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  async function loadReports() {
    const category = $('#categoryFilter').value;
    const sort = $('#sortFilter').value;
    try {
      const res = await fetch(`${API}/reports?category=${encodeURIComponent(category)}&sort=${sort}`);
      const data = await res.json();
      if (!data.ok) return;
      state.reports = data.reports;
      renderReports(state.reports);
    } catch (e) {
      console.error('Failed to load reports', e);
      $('#feedGrid').innerHTML = '<p style="grid-column:1/-1;color:var(--red)">Could not reach the server. Is the backend running?</p>';
    }
  }

  async function onVoteClick(e) {
    const btn = e.currentTarget;
    const id = btn.dataset.id;

    if (!state.verifiedToken) {
      alert('Please verify with Aadhaar (see "File a report" section) before voting — this enforces one Aadhaar, one vote.');
      document.getElementById('report').scrollIntoView({ behavior: 'smooth' });
      return;
    }
    if (state.votedIds.has(id)) return;

    btn.disabled = true;
    try {
      const res = await fetch(`${API}/reports/${id}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voterToken: state.verifiedToken }),
      });
      const data = await res.json();
      if (!data.ok) {
        alert(data.error || 'Could not register vote.');
        btn.disabled = false;
        return;
      }
      state.votedIds.add(id);
      btn.classList.add('voted');
      btn.querySelector('.vote-count').textContent = data.report.votes;
      loadStats();
    } catch (err) {
      console.error(err);
      btn.disabled = false;
    }
  }

  $('#categoryFilter').addEventListener('change', loadReports);
  $('#sortFilter').addEventListener('change', loadReports);

  // ---------------------------------------------------------------------
  // Aadhaar-verified report flow
  // ---------------------------------------------------------------------
  function goToStep(n) {
    $all('.step-panel').forEach((p) => p.classList.remove('step-panel--active'));
    $(`#panel-${n}`).classList.add('step-panel--active');
    $all('.step').forEach((s) => {
      const step = Number(s.dataset.step);
      s.classList.toggle('step--active', step === n);
      s.classList.toggle('step--done', step < n);
    });
  }

  $('#btnRequestOtp').addEventListener('click', async () => {
    const aadhaar = $('#aadhaarInput').value.replace(/\s/g, '');
    const errEl = $('#aadhaarError');
    errEl.textContent = '';
    try {
      const res = await fetch(`${API}/auth/request-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aadhaar }),
      });
      const data = await res.json();
      if (!data.ok) { errEl.textContent = data.error; return; }
      state.aadhaarHash = data.aadhaarHash;
      $('#otpHint').innerHTML = `Demo mode — your OTP is <strong style="color:var(--saffron)">${data.demoOtp}</strong> (in a real deployment this would be sent by SMS instead).`;
      goToStep(2);
    } catch (e) {
      errEl.textContent = 'Could not reach server.';
    }
  });

  $('#btnVerifyOtp').addEventListener('click', async () => {
    const otp = $('#otpInput').value.trim();
    const errEl = $('#otpError');
    errEl.textContent = '';
    try {
      const res = await fetch(`${API}/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aadhaarHash: state.aadhaarHash, otp }),
      });
      const data = await res.json();
      if (!data.ok) { errEl.textContent = data.error; return; }
      state.verifiedToken = data.token;
      goToStep(3);
    } catch (e) {
      errEl.textContent = 'Could not reach server.';
    }
  });

  // Real file upload: each selected file is uploaded immediately to
  // POST /api/upload, and we keep the returned {url, kind, originalName}
  // objects to attach to the report on submit.
  const uploadedFiles = [];

  function renderEvidenceList() {
    const list = $('#evidenceList');
    list.innerHTML = '';
    uploadedFiles.forEach((f, idx) => {
      const row = document.createElement('div');
      row.className = `evidence-item evidence-item--${f.status}`;
      const icon = { photo: '📷', audio: '🎙️', video: '🎬' }[f.kind] || '📎';
      row.innerHTML = `
        <span>${icon} ${escapeHtml(f.originalName || 'file')} ${f.status === 'uploading' ? '· uploading…' : f.status === 'error' ? '· failed' : '· uploaded'}</span>
        <button type="button" aria-label="Remove">✕</button>
      `;
      row.querySelector('button').addEventListener('click', () => {
        uploadedFiles.splice(idx, 1);
        renderEvidenceList();
      });
      list.appendChild(row);
    });
  }

  $('#fileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = ''; // allow re-selecting the same file later

    const entry = { status: 'uploading', originalName: file.name, kind: null, url: null };
    uploadedFiles.push(entry);
    renderEvidenceList();

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(`${API}/upload`, { method: 'POST', body: formData });
      const data = await res.json();
      if (!data.ok) {
        entry.status = 'error';
        renderEvidenceList();
        alert(data.error || 'Upload failed.');
        return;
      }
      entry.status = 'done';
      entry.url = data.file.url;
      entry.kind = data.file.kind;
      renderEvidenceList();
    } catch (err) {
      entry.status = 'error';
      renderEvidenceList();
      alert('Could not reach server to upload the file.');
    }
  });

  $('#btnSubmitReport').addEventListener('click', async () => {
    const title = $('#titleInput').value.trim();
    const category = $('#categoryInput').value;
    const location = $('#locationInput').value.trim();
    const description = $('#descInput').value.trim();
    const errEl = $('#reportError');
    errEl.textContent = '';

    if (!title || !location || !description) {
      errEl.textContent = 'Please fill in title, location and description.';
      return;
    }
    if (uploadedFiles.some((f) => f.status === 'uploading')) {
      errEl.textContent = 'Please wait for the file upload to finish.';
      return;
    }

    const readyFiles = uploadedFiles.filter((f) => f.status === 'done');

    try {
      const res = await fetch(`${API}/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title, category, location, description,
          evidence: [...new Set(readyFiles.map((f) => f.kind))],
          evidenceFiles: readyFiles.map((f) => ({ url: f.url, kind: f.kind, originalName: f.originalName })),
          reporterToken: state.verifiedToken,
        }),
      });
      const data = await res.json();
      if (!data.ok) { errEl.textContent = data.error; return; }

      $('#successReportId').textContent = `Case ID — ${data.report.id}`;
      goToStep(4);
      loadReports();
      loadStats();
    } catch (e) {
      errEl.textContent = 'Could not reach server.';
    }
  });

  $('#btnFileAnother').addEventListener('click', () => {
    $('#titleInput').value = '';
    $('#locationInput').value = '';
    $('#descInput').value = '';
    uploadedFiles.length = 0;
    renderEvidenceList();
    goToStep(3);
  });

  $('#navReportBtn').addEventListener('click', () => {
    document.getElementById('report').scrollIntoView({ behavior: 'smooth' });
  });

  // Extra Verhoeff-valid test Aadhaar numbers — since re-using the same
  // number correctly triggers "one Aadhaar, one vote", testers who want to
  // simulate multiple citizens need fresh numbers per session.
  const EXTRA_TEST_NUMBERS = [
    '434974823792', '713846278552', '867251558966', '410760195133', '764603056080',
    '591407869838', '379365179485', '851646619939', '569032156488', '670946183713',
  ];
  $('#btnMoreNumbers').addEventListener('click', () => {
    const list = $('#moreNumbersList');
    list.innerHTML = 'More test numbers (each simulates a different citizen): <br><strong style="color:var(--saffron)">' + EXTRA_TEST_NUMBERS.join(' &nbsp;·&nbsp; ') + '</strong>';
    list.style.display = 'block';
  });

  // ---------------------------------------------------------------------
  // AI Assistant — streams progressively via Server-Sent Events
  // ---------------------------------------------------------------------
  const chatHistory = [];

  function appendMessage(role, text) {
    const wrap = document.createElement('div');
    wrap.className = `chat__msg chat__msg--${role === 'user' ? 'user' : 'bot'}`;
    wrap.innerHTML = `
      <span class="chat__avatar">${role === 'user' ? '🙋' : '👁️'}</span>
      <div class="chat__bubble"></div>
    `;
    $('#chatMessages').appendChild(wrap);
    $('#chatMessages').scrollTop = $('#chatMessages').scrollHeight;
    return wrap.querySelector('.chat__bubble');
  }

  $('#chatForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#chatInput');
    const message = input.value.trim();
    if (!message) return;
    input.value = '';

    appendMessage('user', message).textContent = message;
    chatHistory.push({ role: 'user', text: message });

    const botBubble = appendMessage('bot', '');
    botBubble.innerHTML = '<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>';

    try {
      const res = await fetch(`${API}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history: chatHistory.slice(-10) }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        botBubble.textContent = data.error || 'Something went wrong. Please try again.';
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';
      let firstChunk = true;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload) continue;
          try {
            const parsed = JSON.parse(payload);
            if (parsed.type === 'chunk') {
              if (firstChunk) { botBubble.textContent = ''; firstChunk = false; }
              fullText += parsed.text;
              botBubble.textContent = fullText;
              $('#chatMessages').scrollTop = $('#chatMessages').scrollHeight;
            } else if (parsed.type === 'error') {
              botBubble.textContent = parsed.error;
            }
          } catch (err) { /* ignore partial fragments */ }
        }
      }

      chatHistory.push({ role: 'assistant', text: fullText });
    } catch (err) {
      console.error(err);
      botBubble.textContent = 'Connection error. Please try again.';
    }
  });

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------
  loadStats();
  loadReports();
})();
