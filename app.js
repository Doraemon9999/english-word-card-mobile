(() => {
  'use strict';

  const APP_VERSION = '2.0.1';
  const WORDS = Array.isArray(self.WORDS) ? self.WORDS : [];
  if (WORDS.length !== 2027 || WORDS[0]?.id !== 1 || WORDS.at(-1)?.id !== 2027) {
    document.body.innerHTML = '<p style="padding:24px">単語データを読み込めませんでした。ファイル一式を同じフォルダー構成で配置してください。</p>';
    return;
  }

  const $ = id => document.getElementById(id);
  const isLocalPreview = () => location.protocol === 'http:' && (location.hostname === '127.0.0.1' || location.hostname === 'localhost');
  const storage = {
    get(key, fallback) {
      try { const value = localStorage.getItem(key); return value === null ? fallback : JSON.parse(value); }
      catch (_) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; }
      catch (_) { return false; }
    }
  };

  const localDateKey = () => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const savedDailyStats = storage.get('ewc_daily_stats', {});

  const state = {
    wrong: new Set(storage.get('ewc_wrong_ids', [])),
    dailyStats: savedDailyStats.date === localDateKey()
      ? savedDailyStats
      : { date: localDateKey(), reviewed: 0, known: 0, again: 0 },
    cardDeck: [],
    cardIndex: 0,
    cardRevealed: false,
    touchStartX: 0,
    touchStartY: 0,
    test: null,
    pdfCache: new Map(),
    fontBytes: null
  };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || min));
  const rangeWords = (start, end) => {
    const first = clamp(start, 1, WORDS.length);
    const last = clamp(end, 1, WORDS.length);
    const low = Math.min(first, last);
    const high = Math.max(first, last);
    return WORDS.slice(low - 1, high);
  };
  const shuffle = input => {
    const result = [...input];
    const random = new Uint32Array(1);
    for (let i = result.length - 1; i > 0; i -= 1) {
      crypto.getRandomValues(random);
      const j = random[0] % (i + 1);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  };

  function switchView(name) {
    document.querySelectorAll('.tab').forEach(button => {
      const active = button.dataset.view === name;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));
    $(`${name}View`).classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function rebuildCardDeck() {
    const all = rangeWords($('cardStart').value, $('cardEnd').value);
    const selected = $('wrongOnly').checked ? all.filter(word => state.wrong.has(word.id)) : all;
    state.cardDeck = shuffle(selected);
    state.cardIndex = 0;
    $('cardRangeInfo').textContent = selected.length ? `対象 ${selected.length.toLocaleString()}語` : '対象になる単語がありません';
    const first = all[0]?.id ?? '—';
    const last = all.at(-1)?.id ?? '—';
    $('rangeSummary').textContent = `${$('wrongOnly').checked ? '復習・' : ''}No.${first}〜${last}`;
    renderCard();
  }

  function renderCard() {
    const word = state.cardDeck[state.cardIndex];
    $('wordCard').setAttribute('aria-disabled', String(!word));
    $('speakWord').disabled = !word;
    $('markWrong').disabled = true;
    $('markKnown').disabled = true;
    $('wordCard').setAttribute('aria-expanded', 'false');
    if (!word) {
      $('cardNumber').textContent = 'No. —';
      $('cardPrompt').textContent = $('wrongOnly').checked ? '復習対象はありません' : '範囲を確認してください';
      $('cardHint').textContent = '';
      $('cardAnswer').hidden = true;
      $('cardProgressBar').style.width = '0%';
      return;
    }
    const enToJa = $('cardDirection').value === 'en-ja';
    state.cardRevealed = false;
    $('cardNumber').textContent = `No. ${word.id} ・ ${state.cardIndex + 1}/${state.cardDeck.length}`;
    $('cardPrompt').textContent = enToJa ? word.word : word.meaning;
    $('cardAnswer').textContent = enToJa ? word.meaning : word.word;
    $('cardAnswer').hidden = true;
    $('cardHint').textContent = 'タップして答えを見る';
    $('cardProgressBar').style.width = `${((state.cardIndex + 1) / state.cardDeck.length) * 100}%`;
  }

  function revealCard() {
    if (!state.cardDeck[state.cardIndex] || state.cardRevealed) return;
    state.cardRevealed = true;
    $('cardAnswer').hidden = false;
    $('cardHint').textContent = '覚えたかを選んで次へ';
    $('wordCard').setAttribute('aria-expanded', 'true');
    $('markWrong').disabled = false;
    $('markKnown').disabled = false;
  }

  function gradeCard(isKnown) {
    const word = state.cardDeck[state.cardIndex];
    if (!word || !state.cardRevealed) return;
    if (isKnown) state.wrong.delete(word.id); else state.wrong.add(word.id);
    storage.set('ewc_wrong_ids', [...state.wrong]);
    $('wrongCount').textContent = state.wrong.size.toLocaleString();
    state.dailyStats.reviewed += 1;
    state.dailyStats[isKnown ? 'known' : 'again'] += 1;
    storage.set('ewc_daily_stats', state.dailyStats);
    renderDailyStats();
    state.cardIndex = (state.cardIndex + 1) % state.cardDeck.length;
    renderCard();
  }

  function renderDailyStats() {
    const stats = state.dailyStats;
    $('todayCount').textContent = stats.reviewed.toLocaleString();
    if (stats.reviewed === 0) {
      $('todayAccuracy').textContent = '—';
      $('accuracyUnit').textContent = '';
      return;
    }
    $('todayAccuracy').textContent = Math.round((stats.known / stats.reviewed) * 100).toLocaleString();
    $('accuracyUnit').textContent = '%';
  }

  function pronounceCurrentWord() {
    const word = state.cardDeck[state.cardIndex];
    if (!word) return;
    if (!('speechSynthesis' in window)) {
      showToast('この端末では発音機能を利用できません');
      return;
    }
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(word.word);
    utterance.lang = 'en-US';
    utterance.rate = 0.82;
    const voice = speechSynthesis.getVoices().find(item => item.lang.toLowerCase().startsWith('en'));
    if (voice) utterance.voice = voice;
    speechSynthesis.speak(utterance);
  }

  let toastTimer;
  function showToast(message) {
    clearTimeout(toastTimer);
    $('swipeToast').textContent = message;
    $('swipeToast').hidden = false;
    toastTimer = setTimeout(() => { $('swipeToast').hidden = true; }, 1400);
  }

  function handleSwipe(endX, endY) {
    const deltaX = endX - state.touchStartX;
    const deltaY = endY - state.touchStartY;
    if (!state.cardRevealed || Math.abs(deltaX) < 65 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.2) return;
    const known = deltaX > 0;
    const card = $('wordCard');
    card.classList.add(known ? 'swipe-right' : 'swipe-left');
    if (navigator.vibrate) navigator.vibrate(20);
    showToast(known ? '覚えた ✓' : '復習リストへ ↻');
    setTimeout(() => {
      card.classList.remove('swipe-right', 'swipe-left');
      gradeCard(known);
    }, 120);
  }

  function createTest() {
    const pool = rangeWords($('testStart').value, $('testEnd').value);
    const count = Number($('questionCount').value);
    if (pool.length < count) {
      showResult($('sendResult'), `指定範囲には${pool.length}語しかありません。範囲を広げてください。`, true);
      return;
    }
    const random = new Uint32Array(2);
    crypto.getRandomValues(random);
    const seed = (random[0] & 0xffff).toString(16).toUpperCase().padStart(4, '0');
    const requestId = `${Date.now().toString(36)}_${random[0].toString(36)}_${random[1].toString(36)}`;
    state.test = {
      items: shuffle(pool).slice(0, count),
      direction: $('testDirection').value,
      start: Math.min(...pool.map(word => word.id)),
      end: Math.max(...pool.map(word => word.id)),
      seed,
      requestId,
      createdAt: new Date().toISOString()
    };
    state.pdfCache.clear();
    renderTest();
  }

  function renderTest() {
    const test = state.test;
    if (!test) return;
    $('testEmpty').hidden = true;
    $('testResult').hidden = false;
    $('testStatus').textContent = `${test.items.length}問`;
    $('testTitle').textContent = `英単語テスト No.${test.start}〜${test.end}`;
    $('testSeed').textContent = `ID: ${test.seed}`;
    $('questionList').replaceChildren(...test.items.map(word => {
      const li = document.createElement('li');
      li.textContent = test.direction === 'en-ja' ? `${word.word}（No.${word.id}）` : `${word.meaning}（No.${word.id} / ${word.word[0]}…）`;
      return li;
    }));
    $('sendResult').hidden = true;
  }

  async function loadFont() {
    if (state.fontBytes) return state.fontBytes;
    const response = await fetch('fonts/NotoSansJP-PrintBold.ttf');
    if (!response.ok) throw new Error('PDF用日本語フォントを読み込めませんでした。');
    state.fontBytes = await response.arrayBuffer();
    return state.fontBytes;
  }

  function wrapText(text, font, size, maxWidth, maxLines = 2) {
    const chars = [...String(text)];
    const lines = [];
    let line = '';
    for (const char of chars) {
      const candidate = line + char;
      if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
        lines.push(line);
        line = char;
        if (lines.length === maxLines - 1) break;
      } else {
        line = candidate;
      }
    }
    if (lines.length < maxLines && line) lines.push(line);
    const consumed = lines.join('').length;
    if (consumed < chars.length) {
      let final = lines.at(-1) || '';
      while (final && font.widthOfTextAtSize(final + '…', size) > maxWidth) final = final.slice(0, -1);
      lines[lines.length - 1] = final + '…';
    }
    return lines;
  }

  async function buildPdf(kind) {
    if (!state.test) throw new Error('先にテストを作成してください。');
    const cached = state.pdfCache.get(kind);
    if (cached) return cached;

    const { PDFDocument, StandardFonts, rgb } = PDFLib;
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const font = await pdf.embedFont(await loadFont());
    // 欧文は合字（fi / fl / ff）による不自然な字間を避ける専用フォントを使う。
    const latinFont = await pdf.embedFont(StandardFonts.HelveticaBold);
    const pageWidth = 595.28;
    const pageHeight = 841.89;
    const page = pdf.addPage([pageWidth, pageHeight]);
    // 家庭用プリンターでも薄くならないよう、太字フォントと純黒1色を使う。
    const printBlack = rgb(0, 0, 0);
    const test = state.test;
    const title = kind === 'questions' ? '英単語テスト【問題】' : '英単語テスト【解答】';

    pdf.setTitle(`${title} No.${test.start}-${test.end}`);
    pdf.setAuthor('英単語カード');
    pdf.setSubject(`${test.items.length}問 / ID ${test.seed}`);
    page.drawText(title, { x: 36, y: 792, size: 20, font, color: printBlack });
    page.drawText('範囲', { x: 36, y: 769, size: 9.5, font, color: printBlack });
    page.drawText(`No.${test.start}-${test.end}`, { x: 63, y: 769, size: 9.5, font: latinFont, color: printBlack });
    page.drawText(`${test.items.length}`, { x: 135, y: 769, size: 9.5, font: latinFont, color: printBlack });
    page.drawText('問', { x: 149, y: 769, size: 9.5, font, color: printBlack });
    page.drawText(`ID: ${test.seed}`, { x: 166, y: 769, size: 9.5, font: latinFont, color: printBlack });
    if (kind === 'answers') {
      page.drawText('得点：', { x: 438, y: 769, size: 9.5, font, color: printBlack });
      page.drawText(`/ ${test.items.length}`, { x: 542, y: 769, size: 9.5, font: latinFont, color: printBlack });
    }

    const margin = 36;
    const gutter = 22;
    const columns = test.items.length > 10 ? 2 : 1;
    const rows = Math.ceil(test.items.length / columns);
    const colWidth = (pageWidth - margin * 2 - gutter * (columns - 1)) / columns;
    const rowHeight = Math.min(columns === 1 ? 58 : 61, 700 / rows);
    const topY = 744;

    test.items.forEach((word, index) => {
      const column = Math.floor(index / rows);
      const row = index % rows;
      const x = margin + column * (colWidth + gutter);
      const y = topY - row * rowHeight;
      page.drawText(`${index + 1}.  No.${word.id}`, { x, y, size: 9, font: latinFont, color: printBlack });

      if (kind === 'questions') {
        const prompt = test.direction === 'en-ja' ? word.word : word.meaning;
        const size = test.direction === 'en-ja' ? 13 : 10;
        const promptFont = test.direction === 'en-ja' ? latinFont : font;
        wrapText(prompt, promptFont, size, colWidth - 8, 2).forEach((text, lineIndex) => {
          page.drawText(text, { x: x + 4, y: y - 18 - lineIndex * (size + 3), size, font: promptFont, color: printBlack });
        });
        if (test.direction === 'ja-en') page.drawText(`ヒント: ${word.word[0]}…`, { x: x + 4, y: y - rowHeight + 25, size: 8, font, color: printBlack });
        page.drawLine({ start: { x: x + 4, y: y - rowHeight + 17 }, end: { x: x + colWidth - 4, y: y - rowHeight + 17 }, thickness: 1, color: printBlack });
      } else {
        page.drawText(word.word, { x: x + 4, y: y - 19, size: 12.5, font: latinFont, color: printBlack });
        wrapText(word.meaning, font, 9, colWidth - 8, 2).forEach((text, lineIndex) => {
          page.drawText(text, { x: x + 4, y: y - 34 - lineIndex * 11.5, size: 9, font, color: printBlack });
        });
      }
    });

    page.drawText('英単語カード', { x: margin, y: 20, size: 7.5, font, color: printBlack });
    const bytes = await pdf.save();
    state.pdfCache.set(kind, bytes);
    return bytes;
  }

  function dateStamp() {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  }

  function pdfFilename(kind) {
    return `英単語テスト_${kind === 'questions' ? '問題' : '解答'}_${dateStamp()}_${state.test.seed}.pdf`;
  }

  function downloadBytes(bytes, filename) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async function downloadPdf(kind) {
    try {
      setBusy(true, `${kind === 'questions' ? '問題' : '解答'}PDFを作成しています…`);
      downloadBytes(await buildPdf(kind), pdfFilename(kind));
    } catch (error) {
      showResult($('sendResult'), error.message || 'PDFを作成できませんでした。', true);
    } finally {
      setBusy(false);
    }
  }

  function bytesToBase64(bytes) {
    const chunk = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    return btoa(binary);
  }

  function getSettings() {
    return {
      recipient: $('recipientEmail').value.trim(),
      gasUrl: $('gasUrl').value.trim(),
      sharedKey: $('sharedKey').value
    };
  }

  function saveSettings() {
    const settings = getSettings();
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.recipient);
    const validUrl = /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec(?:\?.*)?$/.test(settings.gasUrl);
    if (!validEmail || !validUrl || !settings.sharedKey) {
      showResult($('settingsResult'), 'メールアドレス、末尾が /exec のGAS URL、共有キーを確認してください。', true);
      return false;
    }
    if (!storage.set('ewc_mail_settings', settings)) {
      showResult($('settingsResult'), '設定を保存できませんでした。ブラウザのプライベートモードや保存設定を確認してください。', true);
      return false;
    }
    showResult($('settingsResult'), 'この端末に設定を保存しました。', false);
    return true;
  }

  function waitForGasStatus(gasUrl, requestId, maxWait = 15000) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      let finished = false;

      const finish = (callback, value) => {
        if (finished) return;
        finished = true;
        callback(value);
      };
      const poll = () => {
        if (finished) return;
        if (Date.now() - started >= maxWait) {
          finish(reject, new Error('STATUS_TIMEOUT'));
          return;
        }

        const callbackName = `__ewcStatus_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        const script = document.createElement('script');
        let answered = false;
        const cleanup = () => {
          script.remove();
          try { delete window[callbackName]; } catch (_) { window[callbackName] = undefined; }
        };
        const retry = () => {
          cleanup();
          setTimeout(poll, 1200);
        };

        window[callbackName] = result => {
          answered = true;
          cleanup();
          if (!result || result.requestId !== requestId || result.state === 'pending') {
            setTimeout(poll, 1200);
            return;
          }
          finish(resolve, result);
        };
        script.async = true;
        script.src = `${gasUrl}${gasUrl.includes('?') ? '&' : '?'}action=status&requestId=${encodeURIComponent(requestId)}&callback=${encodeURIComponent(callbackName)}&_=${Date.now()}`;
        script.onload = () => { if (!answered) retry(); };
        script.onerror = retry;
        document.head.appendChild(script);
      };

      poll();
    });
  }

  async function postToGas(settings, payload) {
    await fetch(settings.gasUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow'
    });

    try {
      return await waitForGasStatus(settings.gasUrl, payload.requestId);
    } catch (_) {
      return {
        ok: true,
        pending: true,
        message: '送信処理を受け付けました。数分後に受信箱をご確認ください。'
      };
    }
  }

  async function sendEmail() {
    if (!state.test) return;
    if (!navigator.onLine) {
      showResult($('sendResult'), 'メール送信にはインターネット接続が必要です。', true);
      return;
    }
    const settings = getSettings();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.recipient) || !/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec(?:\?.*)?$/.test(settings.gasUrl) || !settings.sharedKey) {
      switchView('settings');
      showResult($('settingsResult'), '送信前にメールアドレス、GAS URL、共有キーを保存してください。', true);
      return;
    }

    try {
      setBusy(true, 'PDFを作成してメール送信しています…');
      const [questions, answers] = await Promise.all([buildPdf('questions'), buildPdf('answers')]);
      const payload = {
        action: 'send_test_pdfs',
        requestId: state.test.requestId,
        recipient: settings.recipient,
        sharedKey: settings.sharedKey,
        testTitle: `英単語テスト No.${state.test.start}〜${state.test.end} / ${state.test.items.length}問`,
        questionFilename: pdfFilename('questions'),
        answerFilename: pdfFilename('answers'),
        questionPdfBase64: bytesToBase64(questions),
        answerPdfBase64: bytesToBase64(answers)
      };
      const result = await postToGas(settings, payload);
      if (!result.ok) throw new Error(result.message || 'メール送信に失敗しました。');
      showResult($('sendResult'), result.message || `${settings.recipient}へ送信しました。`, false);
    } catch (error) {
      const message = error.message || '送信できませんでした。設定と通信状態を確認してください。';
      showResult($('sendResult'), message, true);
    } finally {
      setBusy(false);
    }
  }

  function showResult(element, message, isError) {
    element.textContent = message;
    element.classList.toggle('error', Boolean(isError));
    element.hidden = false;
  }

  function setBusy(active, text = '処理中です…') {
    $('busyText').textContent = text;
    $('busyOverlay').hidden = !active;
    document.body.style.overflow = active ? 'hidden' : '';
  }

  function updateNetwork() {
    const online = navigator.onLine;
    $('networkBadge').textContent = online ? 'オンライン' : 'オフライン';
    $('networkBadge').className = `network-badge ${online ? 'online' : 'offline'}`;
  }

  function configurePlatformUi() {
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    const userAgent = navigator.userAgent.toLowerCase();
    const isIos = /iphone|ipad|ipod/.test(userAgent);
    const isAndroid = /android/.test(userAgent);

    document.title = `英単語カード スマホ版 v${APP_VERSION}`;
    $('saveSettings').textContent = 'この端末に保存';
    $('appPlatform').textContent = 'スマホ/PWA版';
    $('appVersion').textContent = `v${APP_VERSION}`;

    if (standalone) {
      $('standaloneInfo').textContent = 'ホーム画面からアプリとして起動中です。';
      return;
    }

    if (isIos) {
      $('platformGuideStep1').textContent = 'このページをSafariで開きます。';
      $('platformGuideStep2').textContent = '共有ボタンを押し、「ホーム画面に追加」を選びます。';
      $('standaloneInfo').textContent = 'iPhone / iPadではSafariの共有メニューから追加できます。';
    } else if (isAndroid) {
      $('platformGuideStep1').textContent = 'このページをChromeで開きます。';
      $('platformGuideStep2').textContent = '右上のメニューから「アプリをインストール」または「ホーム画面に追加」を選びます。';
      $('standaloneInfo').textContent = 'AndroidではChromeのメニューから追加できます。';
    } else if (isLocalPreview()) {
      $('standaloneInfo').textContent = 'PC上でスマホ版をプレビューしています。公開後はスマートフォンのホーム画面へ追加できます。';
    } else {
      $('standaloneInfo').textContent = 'ブラウザの共有またはメニューからホーム画面へ追加できます。';
    }
  }

  function init() {
    configurePlatformUi();
    $('wordTotal').textContent = WORDS.length.toLocaleString();
    $('wrongCount').textContent = state.wrong.size.toLocaleString();
    renderDailyStats();
    const settings = storage.get('ewc_mail_settings', {});
    $('recipientEmail').value = settings.recipient || '';
    $('gasUrl').value = settings.gasUrl || '';
    $('sharedKey').value = settings.sharedKey || '';

    document.querySelectorAll('.tab').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
    ['cardStart', 'cardEnd'].forEach(id => $(id).addEventListener('change', rebuildCardDeck));
    $('cardDirection').addEventListener('change', renderCard);
    $('wrongOnly').addEventListener('change', rebuildCardDeck);
    $('shuffleCards').addEventListener('click', rebuildCardDeck);
    $('wordCard').addEventListener('click', revealCard);
    $('wordCard').addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        revealCard();
      }
    });
    $('wordCard').addEventListener('touchstart', event => {
      const touch = event.changedTouches[0];
      state.touchStartX = touch.clientX;
      state.touchStartY = touch.clientY;
    }, { passive: true });
    $('wordCard').addEventListener('touchend', event => {
      const touch = event.changedTouches[0];
      handleSwipe(touch.clientX, touch.clientY);
    }, { passive: true });
    $('speakWord').addEventListener('click', pronounceCurrentWord);
    $('markWrong').addEventListener('click', () => gradeCard(false));
    $('markKnown').addEventListener('click', () => gradeCard(true));
    $('createTest').addEventListener('click', createTest);
    $('downloadQuestions').addEventListener('click', () => downloadPdf('questions'));
    $('downloadAnswers').addEventListener('click', () => downloadPdf('answers'));
    $('sendEmail').addEventListener('click', sendEmail);
    $('saveSettings').addEventListener('click', saveSettings);
    $('showSharedKey').addEventListener('change', event => { $('sharedKey').type = event.target.checked ? 'text' : 'password'; });
    window.addEventListener('online', updateNetwork);
    window.addEventListener('offline', updateNetwork);

    updateNetwork();
    rebuildCardDeck();

    if ('serviceWorker' in navigator && (location.protocol === 'https:' || isLocalPreview())) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }

  init();
})();
