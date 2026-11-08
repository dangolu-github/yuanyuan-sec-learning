// Task player: one task answered fully on the page.
// Typed answers save on this device at once and sync a moment later; uploaded files are sent as soon as they
// are chosen. Submitting is deliberate and final; feedback appears only when released.
// Print-first (2026-10-24): every task can be printed ("Print questions / PDF"), done on paper and handed in as a
// PDF and/or photos in the "Hand in on paper" panel, or answered on this page. Either route is enough; uploading
// only saves the pages, and "Submit" hands them in. The pages travel in one task-level envelope, `__paper`.
// Blocks may name an outer section (`sec`, e.g. "Exercise 2") and an inner group (`fold`, e.g. "Questions 7(a)–(i)");
// each becomes a remembered toggle. Recordings stay above the toggles so they keep playing while you answer.
(() => {
  const N = window.Yy, A = N.A, app = document.getElementById('app');
  const taskId = new URLSearchParams(location.search).get('id') || '';
  const S = { task: null, control: null, env: '', responses: {}, files: {}, submission: null, saveId: '', submissionId: '', clientUpdatedAt: '', secondsUsed: 0,
    dirty: false, saving: false, syncedSeconds: -1, blocked: '', uploads: 0, batches: 0, uploadErrors: {}, submitting: false, timer: null, retryDelay: 4000, pageLoads: [],
    // One upload that has not been confirmed yet keeps its own ID here, so sending it again asks the course
    // for the *same* upload instead of a new one, and the file it already saved is reused rather than
    // copied. Kept until that upload is confirmed; a different file is a different upload.
    pending: {} };
  const PAPER = '__paper';
  const paperMode = () => Boolean(S.responses[PAPER] && S.responses[PAPER].mode === 'paper');
  const paperAllowed = () => Boolean(S.task.paperUpload && S.task.paperUpload.paperMode);
  const maxFiles = () => (S.task && ((S.task.paperUpload && S.task.paperUpload.maxFiles) || S.task.maxFiles)) || 20;
  const paperFiles = () => ((S.responses[PAPER] || {}).files || []);
  const storeKey = () => `yy-sec-task:${S.env}:${taskId}:v${S.control.resetVersion}`;
  const items = () => S.task.blocks.filter((b) => b.type === 'q');
  const hasAnswer = (v) => v != null && (typeof v === 'string' ? v.trim() !== '' : Boolean(v.file) || Boolean(v.files && v.files.length));
  const units = () => {
    const grouped = {};
    (S.task.requireAny || []).forEach((g) => g.forEach((id) => { grouped[id] = true; }));
    return items().filter((q) => !grouped[q.id] && !q.optional).map((q) => [q.id]).concat(S.task.requireAny || []);
  };
  const answered = () => units().filter((u) => u.some((id) => hasAnswer(S.responses[id]))).length;
  const readOnly = () => Boolean(S.submission) || Boolean(S.blocked) || S.submitting;

  function readLocal() {
    try { return JSON.parse(localStorage.getItem(storeKey()) || 'null'); } catch (error) { return null; }
  }
  function writeLocal() {
    try {
      localStorage.setItem(storeKey(), JSON.stringify({ saveId: S.saveId, submissionId: S.submissionId, responses: S.responses, files: S.files, clientUpdatedAt: S.clientUpdatedAt, secondsUsed: S.secondsUsed, uploadErrors: S.uploadErrors, pending: S.pending }));
    } catch (error) { /* private mode: the server copy still saves */ }
  }
  // An upload's ID has to outlive this page, not just this moment in it: a first upload that starts with
  // nothing written down on the device is exactly the one that comes back as a second copy, because a
  // reload loses the ID and the next attempt asks for a new one. So before anything is sent, the ID is
  // read back out of the device's own storage - never out of S.pending, which would answer for storage and
  // hide the very fault this guards. An ID that is already stored is enough even if a later write fails.
  function storedPending() {
    try {
      const saved = JSON.parse(localStorage.getItem(storeKey()) || 'null');
      return (saved && saved.pending) || {};
    } catch (error) { return null; }
  }
  const durablePending = (slot, fileId) => { const stored = storedPending(); return Boolean(stored && stored[slot] === fileId); };
  const STORAGE_OFF = 'This browser is not saving data for this page, so no new copy of this file was sent. Please allow this site to save data, keep this page open, then choose the same file again.';

  async function load() {
    const data = await A.request('getTask', { taskId });
    S.task = data.task; S.control = data.control; S.env = data.env; S.submission = data.submission; S.files = data.files || {};
    S.blocked = '';
    N.previewNote(S.env);
    document.title = S.task.label + ' | Yuanyuan | SEC English';
    const local = readLocal() || {};
    S.saveId = local.saveId || N.newId('save');
    S.submissionId = local.submissionId || '';
    S.uploadErrors = S.submission ? {} : local.uploadErrors || {};
    S.pending = S.submission ? {} : local.pending || {};
    if (S.submission) {
      S.responses = S.submission.responses || {};
      S.secondsUsed = S.submission.secondsUsed || 0;
    } else {
      const server = data.draft;
      const localNewer = local.responses && (!server || String(local.clientUpdatedAt || '') >= String(server.clientUpdatedAt || ''));
      S.responses = localNewer ? local.responses : server ? server.responses : {};
      S.clientUpdatedAt = localNewer ? local.clientUpdatedAt || '' : server ? server.clientUpdatedAt || '' : '';
      S.secondsUsed = Math.max(Number(local.secondsUsed) || 0, server ? server.secondsUsed || 0 : 0);
      if (localNewer) { S.files = Object.assign({}, local.files || {}, S.files); S.dirty = !server || local.clientUpdatedAt !== server.clientUpdatedAt; }
      if (!S.control.receiving) S.blocked = 'This task is closed. New answers are not being accepted.';
      // A photo or PDF chosen earlier in a question's own upload box (e.g. the writing tasks) moves into the
      // paper hand-in panel unchanged, so there is one place for paper pages.
      if (!S.responses[PAPER] && paperAllowed()) {
        const older = items().filter((q) => q.kind === 'file').flatMap((q) => ((S.responses[q.id] || {}).files || []));
        if (older.length) {
          S.responses[PAPER] = { mode: 'paper', files: [...new Set(older)] };
          items().filter((q) => q.kind === 'file').forEach((q) => { delete S.responses[q.id]; });
          S.dirty = true;
        }
      }
    }
    render();
    if (S.dirty && !readOnly()) schedule(800);
  }

  // ---------- rendering ----------

  const optionalTag = (q) => (q.optional ? '<span class="yp-optional">(optional)</span>' : '');
  const number = (q) => (q.n ? `<span class="yp-n">${N.esc(q.n)}</span>` : '');
  const text = (id) => (!paperMode() && typeof S.responses[id] === 'string' ? S.responses[id] : '');
  const off = () => (readOnly() || paperMode() ? ' disabled' : '');
  const plain = ' autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"';

  function questionHtml(q) {
    if (q.kind === 'mc') {
      // `inline`: letters in one row (picture options, matching with the statements listed above).
      return `<fieldset class="yp-q${q.inline ? ' yp-inline' : ''}" data-q="${q.id}"><legend>${number(q)}${q.prompt}</legend><div class="yp-opts">${q.options.map((option, i) => {
        const letter = 'ABCDEFGH'.charAt(i);
        return `<label class="yp-opt"><input type="radio" name="q-${q.id}" value="${letter}"${!paperMode() && S.responses[q.id] === letter ? ' checked' : ''}${off()}><span class="yp-letter">${letter}</span>${option ? `<span>${option}</span>` : ''}</label>`;
      }).join('')}</div></fieldset>`;
    }
    if (q.kind === 'gap') {
      const input = `<input type="text" data-input="${q.id}" value="${N.esc(text(q.id))}" aria-label="Answer ${N.esc(q.n)}"${plain}${off()}>`;
      const parts = q.prompt.split(/_{4,}/);
      const line = parts.length > 1 ? parts[0] + input + parts.slice(1).join('') : q.prompt + ' ' + input;
      return `<div class="yp-q yp-gap" data-q="${q.id}">${number(q)}<span class="yp-gap-line">${line}</span></div>`;
    }
    if (q.kind === 'short' || q.kind === 'long') {
      const rows = q.rows || (q.kind === 'short' ? 2 : 12);
      const guide = q.wordGuide ? ` data-min="${q.wordGuide[0]}" data-max="${q.wordGuide[1]}"` : '';
      return `<div class="yp-q" data-q="${q.id}"><div class="yp-prompt-line">${number(q)}${q.prompt}${optionalTag(q)}</div><textarea rows="${rows}" data-input="${q.id}"${plain}${off()}>${N.esc(text(q.id))}</textarea>${q.kind === 'long' ? `<p class="yp-count" data-count="${q.id}"${guide}></p>` : ''}</div>`;
    }
    if (q.kind === 'file') {
      return `<div class="yp-q yp-file" data-q="${q.id}" data-no-print><div class="yp-prompt-line">${number(q)}${q.prompt}${optionalTag(q)}</div><ul class="yp-files" data-files="${q.id}"></ul>${readOnly() ? '' : `<label class="yp-drop"><input type="file" multiple accept="image/*,application/pdf,.pdf,.heic,.heif" data-pick="${q.id}"><strong>Choose photos or a PDF</strong><span>Up to ${maxFiles()} files | 12 MB per file</span></label><div class="yp-progress" hidden><i></i></div>`}<p class="yp-msg" data-filemsg="${q.id}" role="status"></p></div>`;
    }
    if (q.kind === 'speak') {
      // A spoken answer (Yuanyuan, 2026-11-08): record in the browser, or choose a voice memo made on the phone.
      const rec = S.responses[q.id] && S.responses[q.id].file;
      const meta = rec ? (S.files[rec] || {}) : null;
      const saved = rec ? `<p class="yp-speak-saved">Recording saved: ${N.esc(meta.name || 'recording')}${meta.bytes ? ' | ' + N.size(meta.bytes) : ''} <button class="yp-linkbtn" type="button" data-play-rec="${rec}">Play</button>${readOnly() ? '' : `<button class="yp-linkbtn" type="button" data-remove-rec="${q.id}">Remove</button>`}</p><div data-rec-player="${rec}"></div>` : '';
      const controls = readOnly() ? '' : `<div class="yp-actions"><button class="yp-btn" type="button" data-rec-start="${q.id}">${rec ? 'Record again' : 'Start recording'}</button><button class="yp-btn quiet" type="button" data-rec-stop="${q.id}" hidden>Stop</button><span class="yp-rec-clock" data-rec-clock="${q.id}"></span></div>
        <label class="yp-drop"><input type="file" accept="audio/*,.m4a,.mp3,.wav,.aac,.ogg,.webm" data-pick-audio="${q.id}"><strong>Or choose an audio file</strong><span>For example a voice memo from your phone, up to 12 MB</span></label>`;
      return `<div class="yp-q yp-speak" data-q="${q.id}" data-no-print><div class="yp-prompt-line">${number(q)}${q.prompt}${optionalTag(q)}</div>${saved}${controls}<p class="yp-msg" data-recmsg="${q.id}" role="status"></p></div>`;
    }
    return `<div class="yp-q" data-q="${q.id}"><p class="yp-note">This question type is not available on this page yet.</p></div>`;
  }

  function blockHtml(b) {
    if (b.type === 'html' && b.title) return `<details class="yp-block yp-doc yp-fold" data-fold="${N.esc('doc:' + b.title)}"><summary>${N.esc(b.title)}</summary><div class="yp-rich yp-doc-body">${b.html}</div></details>`;
    if (b.type === 'html') return `<div class="yp-block ${b.sheet ? 'yp-sheet ' : ''}yp-rich">${b.html}</div>`;
    if (b.type === 'audio' && b.missing) return `<div class="yp-block yp-audio"><div class="yp-audio-head"><span>${N.esc(b.label || 'Recording')}</span></div><p class="yp-note">Your teacher will add this soon.</p></div>`;
    if (b.type === 'pages' && b.missing) return `<div class="yp-block yp-figure-box"><p class="yp-note">${N.esc(b.label || 'Picture')}: your teacher will add this soon.</p></div>`;
    if (b.type === 'audio') return `<div class="yp-block yp-audio" data-audio="${N.esc(b.media)}" data-no-print><div class="yp-audio-head"><span>${N.esc(b.label || 'Recording')}</span></div><div data-audio-body></div><p class="yp-msg" role="status"></p></div>`;
    if (b.type === 'pages') return `<div class="yp-block yp-figure-box" data-pages="${N.esc(b.media.join(','))}"><div class="yp-pages-body"><p class="yp-note">Loading the pictures...</p></div></div>`;
    if (b.type === 'q') return questionHtml(b);
    return '';
  }

  // The reading passages of this task, in the catalogue's order (2026-11-04). A passage is an html block whose
  // toggle is named "Text ..." / "Texts A–D ..." and that carries the catalogue's article heading. A listening
  // task's "Questions 19–26 | Bees" heading uses the same heading class but is not a passage, and a writing
  // prompt is not one either: neither gets a text pane. Nothing else about the block is changed.
  function readingTexts(t) {
    return t.blocks.filter((b) => b.type === 'html' && /^Texts?\b/.test(b.fold || '') && /yp-text-title/.test(b.html || ''));
  }

  // Blocks in order; consecutive blocks with the same `sec` share an outer toggle and, inside it, consecutive
  // blocks with the same `fold` share an inner toggle.
  function blocksHtml(blocks, texts) {
    const groups = t => (t.requireAny || []);
    let html = '', i = 0;
    const isSecond = (b) => b.type === 'q' && groups(S.task).some((g) => g.indexOf(b.id) > 0);
    // New work hands in paper pages through the one task-level panel; a question's own upload box shows only
    // on work submitted that way before (its files stay part of that receipt).
    // (Only when the backend offers the panel, so the site and the backend can be released in either order.)
    const hidden = (b) => b.type === 'q' && b.kind === 'file' && Boolean(S.task.paperUpload) && !(S.submission && hasAnswer(S.responses[b.id]));
    // A passage is drawn in the texts pane instead. Its own place keeps a hidden slot, so printing puts each
    // passage back exactly where the paper has it, however many passages a mock interleaves (print.js).
    const isText = (b) => texts.indexOf(b) >= 0;
    const slot = (b) => `<div data-text-slot="${texts.indexOf(b)}" hidden></div>`;
    const one = (b) => (isText(b) ? slot(b) : hidden(b) ? '' : (isSecond(b) ? '<p class="yp-or">OR</p>' : '') + blockHtml(b));
    const inner = (list) => {
      let out = '', k = 0;
      while (k < list.length) {
        const fold = list[k].fold;
        if (!fold) { out += one(list[k]); k += 1; continue; }
        const run = [];
        while (k < list.length && list[k].fold === fold) { run.push(list[k]); k += 1; }
        // The passage's own toggle is not drawn here: the pane holds it open under a sticky heading, so
        // Open all / Close all cannot close the text the questions are about.
        if (run.every(isText)) { out += run.map(slot).join(''); continue; }
        out += `<details class="yp-group yp-fold" data-fold="${N.esc((run[0].sec || '') + '›' + fold)}"><summary>${N.esc(fold)}</summary><div class="yp-group-body">${run.map(one).join('')}</div></details>`;
      }
      return out;
    };
    while (i < blocks.length) {
      const sec = blocks[i].sec;
      if (!sec) {
        const run = [];
        while (i < blocks.length && !blocks[i].sec) { run.push(blocks[i]); i += 1; }
        html += inner(run);
        continue;
      }
      const run = [];
      while (i < blocks.length && blocks[i].sec === sec) { run.push(blocks[i]); i += 1; }
      html += `<details class="yp-sec yp-fold" data-fold="${N.esc('sec›' + sec)}"><summary><h2>${N.esc(sec)}</h2></summary><div class="yp-sec-body">${inner(run)}</div></details>`;
    }
    return html;
  }

  function render() {
    const t = S.task;
    // Recordings first, outside the toggles.
    const audio = t.blocks.filter((b) => b.type === 'audio');
    const rest = t.blocks.filter((b) => b.type !== 'audio');
    const texts = readingTexts(t);
    const back = t.classId ? `<a href="${N.root}class/?id=${encodeURIComponent(t.classId)}">Back to class</a> | ` : '';
    const kind = t.group === 'mock' ? 'Full mock exam' : t.group === 'homework' ? 'Homework' : t.setId ? 'Practice by paper' : 'Practice by question type';
    // Reading: the passages on one side, everything the learner works with — recording, instructions,
    // questions, feedback, hand-in panel and the submit bar — on the other (reading-split-pane rule 5).
    const work = `<div data-top></div>
      ${audio.map(blockHtml).join('')}
      ${N.foldBar()}
      <div data-blocks>${blocksHtml(rest, texts)}</div>
      <div data-handin></div><div class="yp-submit" data-submit></div>`;
    const textsHtml = texts.map((b, i) => `<section class="yp-split-text-item" data-text="${i}">
      <h2 class="yp-split-text-head">${N.esc(b.fold || 'Text')}${b.sec ? `<small>${N.esc(b.sec)}</small>` : ''}</h2>
      <div class="yp-block yp-rich yp-split-text-body">${b.html}</div></section>`).join('');
    app.innerHTML = `
      <p class="yp-back">${back}<a href="${N.root}">Home</a></p>
      <p class="yp-kicker">${N.esc(kind)} | ${t.source && t.source.indexOf(t.paperLabel) === 0 ? N.esc(t.source) : N.esc(t.paperLabel) + (t.source ? ' | ' + N.esc(t.source) : '')}</p>
      <h1>${N.esc(t.label)}</h1>
      <div class="yp-taskbar"><span data-time></span><span data-progress></span><span class="grow"></span><span data-status role="status"></span><button class="yp-linkbtn" type="button" data-print="blank">Print questions / PDF</button>${S.submission ? '<button class="yp-linkbtn" type="button" data-print="review">Print my work / PDF</button>' : ''}</div>
      ${texts.length ? `<div class="yp-split"><section class="yp-split-pane yp-split-texts" aria-label="Texts 文章">${textsHtml}</section><div class="yp-split-pane yp-split-questions">${work}</div></div>` : work}`;
    document.body.classList.toggle('yp-split-page', texts.length > 0);
    app.classList.toggle('yp-paper-mode', paperMode());
    // Native question tables keep their column relationships and use the standard answer controls.
    app.querySelectorAll('[data-answer-slot]').forEach((slot) => {
      const id = slot.dataset.answerSlot;
      const field = Array.from(app.querySelectorAll('[data-q]')).find((node) => node.dataset.q === id);
      if (field) slot.append(field);
    });
    // As on the paper: the question first, then its pictures, then the letters.
    app.querySelectorAll('.yp-figure-box').forEach((figure) => {
      const next = figure.nextElementSibling;
      if (next && next.matches('fieldset.yp-inline')) next.querySelector('legend').after(figure);
    });
    N.folds(app, 'task:' + t.id);
    renderTop();
    renderHandin();
    renderSubmit();
    items().forEach((q) => {
      if (q.kind === 'long') updateCount(q.id);
      if (q.kind === 'file') drawFiles(q.id);
    });
    mountAudio();
    mountPages();
    if (S.submission) showFeedback();
    updateBar();
  }

  function renderTop() {
    const top = app.querySelector('[data-top]');
    if (S.submission) {
      const r = S.submission.result || {};
      let html = `<p class="yp-banner" data-print-feedback>Submitted | ${N.esc(N.when(S.submission.submittedAt))}<small>${r.released ? (r.pending ? 'Some answers are still waiting for your teacher. Your other results are below.' : 'Your feedback is below.') : 'Your teacher will check this.'}</small></p>`;
      if (paperMode()) {
        const names = paperFiles().map((f, i) => `${i + 1}. ${(S.files[f] || {}).name || 'File'}`).join(' | ');
        html += `<p class="yp-paper-receipt" data-print-feedback>Handed in on paper | ${paperFiles().length} file${paperFiles().length === 1 ? '' : 's'}: ${N.esc(names)}</p>`;
      }
      if (r.released && (r.outOf !== '' || r.overall)) {
        html += `<div class="yp-result"><h2>Feedback</h2>${r.outOf !== '' ? `<p class="yp-score">${N.esc(r.score)} / ${N.esc(r.outOf)}${r.pending ? ' <small>so far</small>' : ''}</p>` : ''}${r.overall ? `<p class="yp-pre">${N.esc(r.overall)}</p>` : ''}</div>`;
      }
      // Listening: the original script, closed on every visit; only its own toggle opens it (not Open all), and it prints only while open.
      if (S.submission.transcriptHtml) html += `<details class="yp-fold yp-script" data-print-feedback data-print-if-open><summary>Listening script</summary><div class="yp-fold-body yp-rich">${S.submission.transcriptHtml}</div></details>`;
      top.innerHTML = html;
    } else if (S.blocked) top.innerHTML = `<p class="yp-banner warn">${N.esc(S.blocked)}</p>`;
    else if (paperAllowed()) top.innerHTML = `<p class="yp-handin-hint" data-no-print>Two ways to hand in: answer on this page, or press <b>Print questions / PDF</b>, write your answers on paper and upload photos or a PDF under <a href="#handin">Hand in on paper</a>. Either one is enough.</p>`;
    else top.innerHTML = '';
  }

  // The paper route: choose how to hand in, upload the pages in order, then press Submit. After submission the
  // same panel is the receipt: the files that belong to this attempt, in order, each one can be opened.
  function renderHandin() {
    const area = app.querySelector('[data-handin]');
    if (!S.task.paperUpload || (S.submission && !paperFiles().length) || (S.blocked && !paperFiles().length)) { area.innerHTML = ''; return; }
    const fileBox = questionHtml({ id: PAPER, kind: 'file', prompt: 'Your paper pages, in order (photos or one PDF):', optional: false });
    const choice = paperAllowed()
      ? `<div class="yp-method" role="radiogroup" aria-label="How to hand in"><label><input type="radio" name="answer-method" value="online"${paperMode() ? '' : ' checked'}${readOnly() ? ' disabled' : ''}> Answer on this page</label><label><input type="radio" name="answer-method" value="paper"${paperMode() ? ' checked' : ''}${readOnly() ? ' disabled' : ''}> Hand in on paper</label></div><p class="yp-note">Print the questions with <b>Print questions / PDF</b>, write on the paper, then take a clear photo of each page (or scan them into one PDF). You do not need to type your answers again.</p>`
      : '<p class="yp-note">You may attach photos or a PDF of your notes.</p>';
    area.innerHTML = `<details class="yp-fold yp-handin" id="handin" data-no-print${paperMode() || S.submission ? ' open' : ''}><summary>${S.submission ? 'Submitted paper pages' : 'Hand in on paper'}</summary><div class="yp-fold-body">${S.submission ? '' : choice}${fileBox}${S.submission ? '<p class="yp-note">These files belong to this submitted attempt. Your teacher checks them and types your answers into the questions above.</p>' : '<p class="yp-note">Uploading saves the pages. Press <b>Submit answers</b> below to hand them in.</p>'}</div></details>`;
    drawFiles(PAPER);
  }

  function renderSubmit() {
    const area = app.querySelector('[data-submit]');
    if (S.submission || S.blocked) { area.innerHTML = ''; return; }
    area.innerHTML = `<div class="yp-actions"><button class="yp-btn" type="button" data-send>Submit answers<small>You cannot change them afterwards</small></button></div><p class="yp-msg" data-sendmsg role="status"></p>`;
  }

  function showFeedback() {
    const r = S.submission.result || {};
    if (!r.released) return;
    const labels = { correct: 'Correct', evaluated: 'Marked', wrong: 'Not correct', partial: 'Partly correct', blank: 'Not answered', pending: 'Waiting for your teacher', skipped: '' };
    (r.items || []).forEach((i) => {
      const box = app.querySelector(`[data-q="${i.id}"]`);
      if (!box || !labels[i.verdict]) return;
      const extra = [];
      if (Object.prototype.hasOwnProperty.call(i, 'original')) {
        // Paper work: the teacher's faithful copy of what was written, with wrong words marked; the receipt is unchanged.
        box.classList.add('yp-paper-reviewed');
        const input = box.querySelector('textarea, input[type=text]');
        if (input) { input.value = i.original; input.dataset.paperOriginal = '1'; }
        // A letter answer from the paper is shown ticked, as it would be online (display only; the receipt is the pages).
        const letter = String(i.original || '').trim().toUpperCase();
        const option = /^[A-H]$/.test(letter) ? box.querySelector(`input[type=radio][value="${letter}"]`) : null;
        if (option) option.checked = true;
        extra.push(`<div class="yp-pre yp-original"><span class="label">Your answer (from your paper):</span> ${annotatedOriginal(i.original, i.spans) || '<i>(blank)</i>'}${i.uncertain ? '<small> [?] Your teacher could not read part of this.</small>' : ''}</div>`);
      }
      // Marked original (teacher, 2026-10-30): the learner's own words with the wrong part struck through and the new words in red; no rewritten version.
      if (i.marked) extra.push(`<div class="yp-pre yp-marked"><span class="label">Marked:</span> ${markedHtml(i.marked)}</div>`);
      if (i.correct) extra.push(`<p class="yp-pre"><span class="label">Correction:</span> ${N.esc(i.correct)}</p>`);
      if (i.comment) extra.push(`<p class="yp-pre"><span class="label">Comment:</span> ${N.esc(i.comment)}</p>`);
      if (i.key) extra.push(`<p><span class="label">Answer:</span> ${N.esc(i.key)}</p>`);
      if (i.accept) extra.push(`<p><span class="label">Answer:</span> ${i.accept.map(N.esc).join(' &nbsp;/&nbsp; ')}</p>`);
      if (i.points) extra.push(`<div><span class="label">Acceptable points (one mark each):</span><ul>${i.points.map((p) => `<li>${N.esc(p)}</li>`).join('')}</ul></div>`);
      // The explanation arrives only while the task's Show explanations switch is on; off, there is no field
      // here at all, so nothing of it is in the page source, the DOM or the printed copy. It starts folded.
      if (i.explain) extra.push(`<details class="yp-explain"><summary>Explanation 解析</summary><div class="yp-rich">${i.explain}</div></details>`);
      if (i.model) extra.push(`<details><summary>Model answer</summary><div class="yp-rich">${i.model}</div></details>`);
      box.insertAdjacentHTML('beforeend', `<div class="yp-verdict ${i.verdict}" data-print-feedback><p class="label">${labels[i.verdict]}</p>${extra.join('')}</div>`);
    });
  }

  // Teacher markup inside a marked original: [-struck out-] and {+added+}; everything else is shown as written.
  function markedHtml(text) {
    return N.esc(String(text || '')).replace(/\[-([\s\S]*?)-\]/g, '<del class="yp-del">$1</del>').replace(/\{\+([\s\S]*?)\+\}/g, '<ins class="yp-ins">$1</ins>');
  }

  function annotatedOriginal(original, spans) {
    const value = String(original || ''); let cursor = 0, html = '';
    (spans || []).forEach((span) => {
      if (!Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < cursor || span.end <= span.start || span.end > value.length) return;
      html += N.esc(value.slice(cursor, span.start)) + `<del class="yp-del">${N.esc(value.slice(span.start, span.end))}</del>` + (span.replacement ? `<ins class="yp-ins">${N.esc(span.replacement)}</ins>` : '');
      cursor = span.end;
    });
    return html + N.esc(value.slice(cursor));
  }

  // ---------- status bar and timing ----------

  function updateBar() {
    const t = S.task;
    const timeEl = app.querySelector('[data-time]');
    if (!timeEl) return;
    // Time is counted and kept, never enforced: no task locks when the time is up.
    const guide = t.minutes ? (t.strictTime ? ` | exam time ${t.minutes} min` : ` | suggested ${t.minutes} min`) : '';
    timeEl.innerHTML = `Time used <b>${N.clock(S.secondsUsed)}</b>${guide}`;
    app.querySelector('[data-progress]').innerHTML = paperMode() ? `On paper | <b>${paperFiles().length}</b> file${paperFiles().length === 1 ? '' : 's'} attached` : `<b>${answered()}</b> / ${units().length} answered`;
  }

  function setStatus(message) {
    const el = app.querySelector('[data-status]');
    if (el) el.textContent = message;
  }

  setInterval(() => {
    if (!S.task || readOnly() || document.hidden) return;
    S.secondsUsed += 1;
    if (S.secondsUsed % 15 === 0) writeLocal();
    // Once a minute the time used is saved with the draft, so the work can be continued anywhere.
    if (S.secondsUsed % 60 === 0 && S.secondsUsed !== S.syncedSeconds && !S.submission && !S.blocked) { S.dirty = true; schedule(500); }
    updateBar();
  }, 1000);

  // ---------- saving ----------

  function changed() {
    S.clientUpdatedAt = new Date().toISOString();
    S.dirty = true;
    writeLocal();
    updateBar();
    setStatus('Saved on this device');
    schedule(1500);
  }

  function schedule(delay) {
    clearTimeout(S.timer);
    S.timer = setTimeout(sync, delay);
  }

  // Leaving the page (closing it, switching app, locking the phone): send what is not yet saved.
  function flush() {
    if (!S.task || S.submission || S.blocked || !S.saveId) return;
    if (!S.dirty && S.secondsUsed === S.syncedSeconds) return;
    writeLocal();
    A.fire('saveDraft', { taskId, saveId: S.saveId, responses: S.responses, clientUpdatedAt: S.clientUpdatedAt, secondsUsed: S.secondsUsed });
    S.syncedSeconds = S.secondsUsed;
  }
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });

  async function sync() {
    if (S.saving || S.submitting || !S.dirty || S.submission || S.blocked) return;
    S.saving = true; S.dirty = false;
    try {
      const seconds = S.secondsUsed;
      await A.post('saveDraft', { taskId, saveId: S.saveId, responses: S.responses, clientUpdatedAt: S.clientUpdatedAt, secondsUsed: seconds });
      S.syncedSeconds = seconds;
      S.retryDelay = 4000;
      if (!S.dirty) setStatus('Saved | ' + new Date().toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' }));
    } catch (error) {
      const message = (error && error.message) || '';
      if (/closed|already submitted|not open|reopened/i.test(message)) {
        S.blocked = /already submitted/i.test(message) ? '' : message;
        S.saving = false;
        if (!S.blocked) { await load(); return; }
        render();
        return;
      }
      S.dirty = true;
      setStatus('Saved on this device | not sent yet');
      S.retryDelay = Math.min(60000, S.retryDelay * 2);
    }
    S.saving = false;
    if (S.dirty) schedule(S.retryDelay);
  }

  async function waitForSave() {
    clearTimeout(S.timer);
    for (let i = 0; i < 60 && S.saving; i += 1) await N.sleep(250);
  }

  async function submit() {
    const message = app.querySelector('[data-sendmsg]');
    const button = app.querySelector('[data-send]');
    if (S.submitting) return;
    if (S.uploads || S.batches) { message.textContent = 'Wait for the upload to finish first.'; message.className = 'yp-msg error'; return; }
    if (Object.keys(S.uploadErrors).length) { message.textContent = 'Some selected files were not uploaded. Retry them or keep only the files listed.'; message.className = 'yp-msg error'; return; }
    const onPaper = paperMode();
    const missing = onPaper ? 0 : units().length - answered();
    if (onPaper ? !paperFiles().length : !items().some((q) => hasAnswer(S.responses[q.id]))) {
      message.textContent = onPaper ? 'There is nothing to submit yet: upload your paper pages first.' : 'There is nothing to submit yet.'; message.className = 'yp-msg error'; return;
    }
    const question = onPaper
      ? `Hand in these ${paperFiles().length} file${paperFiles().length === 1 ? '' : 's'}? Check that every page is there and in order. You cannot change them afterwards.`
      : missing
        ? `${missing} answer${missing === 1 ? ' is' : 's are'} still empty. Submit anyway? You cannot change your answers afterwards.`
        : 'Submit your answers? You cannot change them afterwards.';
    if (!window.confirm(question)) return;
    S.submitting = true;
    button.disabled = true;
    message.textContent = 'Submitting...'; message.className = 'yp-msg';
    await waitForSave();
    if (!S.submissionId) { S.submissionId = N.newId('sub'); writeLocal(); }
    try {
      const submissionOrigin = await N.origin();
      // A paper hand-in is the pages only; answers typed before switching to paper stay in the draft, not the receipt.
      const sent = JSON.parse(JSON.stringify(onPaper ? { [PAPER]: S.responses[PAPER] } : S.responses));
      const receipt = await A.post('submitTask', { taskId, saveId: S.saveId, submissionId: S.submissionId, resetVersion: S.control.resetVersion, responses: sent, secondsUsed: S.secondsUsed, submissionOrigin });
      for (const [id, value] of Object.entries(sent)) {
        if (value && value.files && JSON.stringify(value.files) !== JSON.stringify(((receipt.responses || {})[id] || {}).files || [])) throw new Error('The receipt did not confirm every attachment. Reload to check the submitted version before retrying.');
      }
      S.dirty = false;
      S.submitting = false;
      await load();
      window.scrollTo({ top: 0 });
    } catch (error) {
      S.submitting = false;
      message.textContent = (error && error.message) || 'The answers could not be submitted. Please try again.';
      message.className = 'yp-msg error';
      button.disabled = false;
    }
  }

  // ---------- typed answers ----------

  function updateCount(id) {
    const el = app.querySelector(`[data-count="${id}"]`);
    if (!el) return;
    const count = N.words(text(id));
    const min = Number(el.dataset.min || 0), max = Number(el.dataset.max || 0);
    el.textContent = `${count} word${count === 1 ? '' : 's'}${max ? ` | write about ${min}-${max}` : ''}`;
    el.classList.toggle('ok', Boolean(max) && count >= min && count <= max);
  }

  app.addEventListener('input', (event) => {
    const input = event.target.closest('[data-input]');
    if (!input || readOnly()) return;
    const id = input.dataset.input;
    if (input.value.trim()) S.responses[id] = input.value; else delete S.responses[id];
    updateCount(id);
    changed();
  });
  app.addEventListener('change', (event) => {
    if (readOnly()) return;
    const radio = event.target.closest('input[type=radio]');
    if (radio && radio.name === 'answer-method') {
      if (S.batches) return;
      S.responses[PAPER] = { mode: radio.value, files: paperFiles() };
      changed(); render();
      const panel = app.querySelector('[data-handin] details');
      if (panel) panel.open = true;
      return;
    }
    if (radio && radio.name.indexOf('q-') === 0) { S.responses[radio.name.slice(2)] = radio.value; changed(); return; }
    const pick = event.target.closest('[data-pick]');
    if (pick && pick.files.length) uploadFiles(pick.dataset.pick, Array.from(pick.files), pick);
    const audioPick = event.target.closest('[data-pick-audio]');
    if (audioPick && audioPick.files.length) {
      const file = audioPick.files[0];
      const type = file.type || (/\.m4a$/i.test(file.name) ? 'audio/mp4' : /\.mp3$/i.test(file.name) ? 'audio/mpeg' : /\.wav$/i.test(file.name) ? 'audio/wav' : 'audio/mp4');
      if (!/^(audio|video)\//.test(type)) { sayRec(audioPick.dataset.pickAudio, `${file.name} is not an audio file.`, 'error'); audioPick.value = ''; return; }
      sendAudio(audioPick.dataset.pickAudio, file, type, file.name);
    }
  });
  app.addEventListener('click', (event) => {
    // "Hand in on paper" link in the top note: open the panel even when the address already ends in #handin.
    if (event.target.closest('a[href="#handin"]')) { const panel = app.querySelector('#handin'); if (panel) panel.open = true; }
    if (event.target.closest('[data-send]')) submit();
    const recStart = event.target.closest('[data-rec-start]');
    if (recStart && !readOnly()) startRecording(recStart.dataset.recStart);
    const recStop = event.target.closest('[data-rec-stop]');
    if (recStop) stopRecording(recStop.dataset.recStop);
    const recPlay = event.target.closest('[data-play-rec]');
    if (recPlay) playRecording(recPlay);
    const recRemove = event.target.closest('[data-remove-rec]');
    if (recRemove && !readOnly() && !S.batches) { delete S.responses[recRemove.dataset.removeRec]; changed(); render(); }
    else if (event.target.closest('[data-print]')) {
      const button = event.target.closest('[data-print]'); button.disabled = true;
      window.YyPrint.print({ blank: button.dataset.print === 'blank', prepare: async () => { await Promise.all(S.pageLoads.map((start) => start())); } })
        .catch((e) => { setStatus(e.message || 'Printing could not start.'); }).finally(() => { button.disabled = false; });
    }
    const acceptFiles = event.target.closest('[data-keep-uploaded]');
    if (acceptFiles && !readOnly()) { delete S.uploadErrors[acceptFiles.dataset.keepUploaded]; writeLocal(); drawFiles(acceptFiles.dataset.keepUploaded); }
    const viewFile = event.target.closest('[data-open-file]');
    if (viewFile) openFile(viewFile.dataset.openFile, viewFile);
    const move = event.target.closest('[data-file-move]');
    if (move && !readOnly() && !S.batches) {
      const id = move.dataset.item, files = ((S.responses[id] || {}).files || []).slice(), from = files.indexOf(move.dataset.file), to = from + Number(move.dataset.fileMove);
      if (from >= 0 && to >= 0 && to < files.length) { [files[from], files[to]] = [files[to], files[from]]; S.responses[id] = Object.assign({}, S.responses[id], { files }); changed(); drawFiles(id); }
    }
    const remove = event.target.closest('[data-remove]');
    if (remove && !readOnly() && !S.batches) {
      const id = remove.dataset.item;
      const left = ((S.responses[id] || {}).files || []).filter((f) => f !== remove.dataset.remove);
      if (id === PAPER) S.responses[id] = Object.assign({}, S.responses[id], { files: left });
      else if (left.length) S.responses[id] = { files: left }; else delete S.responses[id];
      drawFiles(id);
      changed();
    }
  });
  window.addEventListener('beforeunload', (event) => {
    if (S.uploads || S.batches) { event.preventDefault(); event.returnValue = ''; }
  });

  // ---------- spoken answers ----------

  const REC = {};
  function sayRec(id, textValue, kind) {
    const m = app.querySelector(`[data-recmsg="${id}"]`);
    if (m) { m.textContent = textValue; m.className = 'yp-msg' + (kind ? ' ' + kind : ''); }
  }
  function recButtons(id, recording) {
    const start = app.querySelector(`[data-rec-start="${id}"]`), stop = app.querySelector(`[data-rec-stop="${id}"]`);
    if (start) start.hidden = recording;
    if (stop) stop.hidden = !recording;
    if (!recording) { const c = app.querySelector(`[data-rec-clock="${id}"]`); if (c) c.textContent = ''; }
  }
  async function startRecording(id) {
    if (REC[id] || S.batches) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      sayRec(id, 'Recording is not available in this browser. Record a voice memo on your phone and choose the file below.', 'error'); return;
    }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (error) { sayRec(id, 'The microphone could not be opened. Allow the microphone, or choose an audio file below.', 'error'); return; }
    const mime = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks = [], q = items().find((x) => x.id === id), limit = (q && q.maxSeconds) || 150, started = Date.now();
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      clearInterval(REC[id].timer);
      stream.getTracks().forEach((track) => track.stop());
      delete REC[id];
      recButtons(id, false);
      const type = String(recorder.mimeType || mime || 'audio/webm').split(';')[0];
      const blob = new Blob(chunks, { type });
      if (!blob.size) { sayRec(id, 'Nothing was recorded. Please try again.', 'error'); return; }
      sendAudio(id, blob, type, 'recording.' + (/mp4/.test(type) ? 'm4a' : /ogg/.test(type) ? 'ogg' : 'webm'));
    };
    REC[id] = { recorder, timer: setInterval(() => {
      const seconds = (Date.now() - started) / 1000, clock = app.querySelector(`[data-rec-clock="${id}"]`);
      if (clock) clock.textContent = `Recording ${N.clock(seconds)} of ${N.clock(limit)}`;
      if (seconds >= limit) stopRecording(id);
    }, 250) };
    recorder.start(1000);
    recButtons(id, true);
    sayRec(id, '');
  }
  function stopRecording(id) {
    const r = REC[id];
    if (r && r.recorder.state !== 'inactive') r.recorder.stop();
  }
  async function sendAudio(id, blob, type, name) {
    if (blob.size > 12 * 1024 * 1024) { sayRec(id, 'This recording is larger than 12 MB. Please keep it under 2 minutes.', 'error'); return; }
    sayRec(id, 'Saving the recording...');
    S.batches += 1;
    try {
      const sent = await sendFile(id, blob, type, name, `${name}|${blob.size}`);
      S.responses[id] = { file: sent.fileId };
      changed();
      sent.release();
      render();
      sayRec(id, 'Recording saved. Press Submit answers when you are ready.', 'good');
    } catch (error) {
      sayRec(id, (error && error.message) || 'The recording could not be saved. Please try again.', 'error');
    } finally { S.batches -= 1; }
  }
  async function playRecording(button) {
    const id = button.dataset.playRec, box = app.querySelector(`[data-rec-player="${id}"]`);
    button.disabled = true;
    try {
      const blob = await N.loadMedia('upload:' + id);
      box.innerHTML = `<audio controls src="${URL.createObjectURL(blob)}"></audio>`;
      box.querySelector('audio').play().catch(() => {});
    } catch (error) { setStatus((error && error.message) || 'The recording could not be loaded.'); }
    finally { button.disabled = false; }
  }

  // ---------- photos and PDF of handwritten work ----------

  // `slot` names this one logical upload (one chosen file). Its upload ID is written down before the
  // upload starts and kept until the file is attached to this page's answers, so every retry - including
  // after a reload, and including after something went wrong on this page *after* the course had already
  // saved the file - is the same upload, and the course reuses the file it already made.
  //
  // The ID is never let go because an upload failed. An upload whose outcome we do not know is exactly the
  // case where asking for a new ID would create a second copy of one page, so a failure keeps the ID and
  // the next attempt finishes the same upload. A genuinely different file is a different slot and gets its
  // own ID without any of this.
  async function sendFile(itemId, blob, type, name, slotKey) {
    const slot = slotKey ? `${itemId}|${slotKey}` : '';
    const fileId = (slot && S.pending[slot]) || N.newId('file');
    if (slot && S.pending[slot] !== fileId) { S.pending[slot] = fileId; writeLocal(); }
    if (slot && !durablePending(slot, fileId)) {
      // A write the browser refused earlier is tried again here, so allowing storage and choosing the same
      // page again records the ID this page is already holding instead of starting a second upload. The ID
      // stays in memory either way: the retry is this same upload.
      writeLocal();
      if (!durablePending(slot, fileId)) throw new Error(STORAGE_OFF);
    }
    S.uploads += 1;
    try {
      const data = await N.toBase64(blob), submissionOrigin = await N.origin();
      const result = await A.post('uploadFile', { taskId, itemId, fileId, type, name, kind: 'uploaded', seconds: 0, data, submissionOrigin });
      S.files[fileId] = { name: result.name || name, mime: type, bytes: result.bytes || blob.size, kind: 'uploaded' };
      // release() belongs to the caller: it runs only once this file is in S.responses and written to this
      // device. Releasing here instead would drop the identity of a file that the answers do not reference
      // yet, and the next attempt would then ask for a second copy of it.
      return { fileId, release: () => { if (slot) { delete S.pending[slot]; writeLocal(); } } };
    } finally { S.uploads -= 1; }
  }

  function drawFiles(id) {
    const list = app.querySelector(`[data-files="${id}"]`);
    if (!list) return;
    const files = (S.responses[id] || {}).files || [];
    list.innerHTML = files.map((f, index) => {
      const meta = S.files[f] || {};
      return `<li><span>${index + 1}. ${N.esc(meta.name || 'File')}${meta.bytes ? ' | ' + N.size(meta.bytes) : ''}</span><button class="yp-linkbtn" type="button" data-open-file="${f}">View</button>${readOnly() ? '' : `<button class="yp-linkbtn" type="button" data-file-move="-1" data-file="${f}" data-item="${id}"${index ? '' : ' disabled'}>Up</button><button class="yp-linkbtn" type="button" data-file-move="1" data-file="${f}" data-item="${id}"${index < files.length - 1 ? '' : ' disabled'}>Down</button><button class="yp-linkbtn" type="button" data-remove="${f}" data-item="${id}">Remove</button>`}</li>`;
    }).join('');
    const message = app.querySelector(`[data-filemsg="${id}"]`);
    if (message && S.uploadErrors[id]) message.innerHTML = `${N.esc(S.uploadErrors[id])} <button type="button" class="yp-linkbtn" data-keep-uploaded="${id}">Keep only the files listed above</button>`;
    else if (message) message.textContent = '';
  }

  async function openFile(id, button) {
    button.disabled = true;
    try { await N.viewUpload(id, S.files[id]); }
    catch (e) { setStatus(e.message || 'The file could not be opened.'); }
    finally { button.disabled = false; }
  }

  const prepare = N.preparePage;
  // One chosen file, named by what the browser knows about it. Choosing the same file again after a failed
  // upload is a retry of that upload; choosing a different file is a different upload.
  const fileSlot = (file) => `${file.name}|${file.size}|${file.lastModified || 0}|${file.type || ''}`;
  // A retry must send the same bytes, or the course refuses the ID as a different file. Phone photos are
  // re-encoded before sending, so the prepared blob of an unconfirmed upload is kept for this page's life.
  const prepared = new Map();

  async function uploadFiles(id, files, input) {
    if (S.batches || readOnly()) { input.value = ''; return; }
    const message = app.querySelector(`[data-filemsg="${id}"]`);
    const bar = input.closest('.yp-q').querySelector('.yp-progress');
    const say = (textValue, kind) => { message.textContent = textValue; message.className = 'yp-msg' + (kind ? ' ' + kind : ''); };
    const bad = files.find((f) => !/^image\//.test(f.type) && f.type !== 'application/pdf' && !/\.(pdf|heic|heif|jpe?g|png|webp)$/i.test(f.name));
    const failSelection = (textValue) => { S.uploadErrors[id] = textValue; writeLocal(); drawFiles(id); input.value = ''; };
    if (bad) { failSelection(`${bad.name} is not a photo or PDF.`); return; }
    // Retrying a part-finished selection sends its already-attached pages again. Those are the same pages,
    // not extra ones, so they are not counted against the limit twice - otherwise a hand-in that filled
    // the limit could never be retried.
    const attached = ((S.responses[id] || {}).files || []);
    const adding = files.filter((f) => {
      const known = S.pending[`${id}|${fileSlot(f)}`];
      return !known || attached.indexOf(known) < 0;
    }).length;
    if (attached.length + adding > maxFiles()) { failSelection(`Choose no more than ${maxFiles()} files in total. No files from this selection were added.`); return; }
    if (id === PAPER) {
      // Choosing pages means handing in on paper: the on-page answers are set aside (kept in the draft, not sent).
      S.responses[PAPER] = Object.assign({ files: [] }, S.responses[PAPER] || {}, { mode: paperAllowed() ? 'paper' : 'online' });
      app.querySelectorAll('[name=answer-method]').forEach((r) => { r.checked = r.value === S.responses[PAPER].mode; });
      if (paperMode()) app.querySelectorAll('[data-blocks] [data-input], [data-blocks] input[type=radio]').forEach((el) => {
        el.disabled = true;
        if (el.type === 'radio') el.checked = false;
        else el.value = '';
      });
      app.classList.toggle('yp-paper-mode', paperMode());
    }
    S.batches += 1; input.disabled = true;
    bar.hidden = false;
    const fill = bar.querySelector('i');
    fill.style.width = '5%';
    // Each page's upload identity is released only when the whole selection has gone through. A page that
    // arrives early must keep its identity while a later page of the same selection is still failing:
    // letting it go would mean the next press asked for a new upload ID for a page that is already saved,
    // and that is exactly how the second copy appeared.
    const done = [];
    try {
      for (let i = 0; i < files.length; i += 1) {
        say(`Sending ${i + 1} of ${files.length}... Keep this page open.`);
        const slot = fileSlot(files[i]);
        const ready = prepared.get(slot) || await prepare(files[i]);
        prepared.set(slot, ready);
        if (ready.blob.size > 12 * 1024 * 1024) throw new Error(`${files[i].name} is larger than 12 MB. Take the photo again at a smaller size.`);
        const sent = await sendFile(id, ready.blob, ready.type, ready.name, slot);
        // Retrying a part-finished selection sends its already-saved pages again, and each of those comes
        // back as the same file. It is listed once: a retry must not show a page twice or submit it twice.
        const current = ((S.responses[id] || {}).files || []).slice();
        if (current.indexOf(sent.fileId) < 0) current.push(sent.fileId);
        S.responses[id] = Object.assign({}, S.responses[id] || {}, { files: current });
        drawFiles(id);
        changed();
        done.push({ slot, release: sent.release });
        fill.style.width = Math.round(((i + 1) / files.length) * 100) + '%';
      }
      // Every page is attached and written to this device, so this selection is finished with its IDs.
      done.forEach((page) => { page.release(); prepared.delete(page.slot); });
      if (S.uploadErrors[id]) drawFiles(id);
      else say(`Uploaded ${files.length} file${files.length === 1 ? '' : 's'}. Check the list and the order, then press Submit answers.`, 'success');
    } catch (error) {
      S.uploadErrors[id] = ((error && error.message) || 'The upload did not finish.')
        + ' Choose the same files and press again to finish this upload.';
      writeLocal(); drawFiles(id); message.classList.add('error');
    } finally {
      S.batches -= 1; input.disabled = readOnly();
      input.value = '';
      setTimeout(() => { bar.hidden = true; }, 1200);
    }
  }

  // ---------- private audio and pictures ----------

  function mountAudio() {
    app.querySelectorAll('[data-audio]').forEach((box) => {
      const mediaId = box.dataset.audio;
      const body = box.querySelector('[data-audio-body]'), message = box.querySelector('.yp-msg');
      const isVideo = /video/i.test(box.querySelector('.yp-audio-head').textContent);
      body.innerHTML = `<div class="yp-actions"><button class="yp-btn" type="button" data-load>${isVideo ? 'Load the video' : 'Load the recording'}</button></div><div class="yp-progress" hidden><i></i></div>`;
      body.querySelector('[data-load]').addEventListener('click', async (event) => {
        const button = event.currentTarget, bar = body.querySelector('.yp-progress'), fill = bar.querySelector('i');
        button.disabled = true; bar.hidden = false; message.textContent = 'Loading...'; message.className = 'yp-msg';
        try {
          const blob = await N.loadMedia(mediaId, (fraction) => { fill.style.width = Math.round(fraction * 100) + '%'; });
          message.textContent = '';
          body.innerHTML = /^video\//.test(blob.type)
            ? `<video class="yp-video" controls playsinline preload="auto" src="${URL.createObjectURL(blob)}"></video>`
            : `<audio controls preload="auto" src="${URL.createObjectURL(blob)}"></audio>`;
        } catch (error) {
          button.disabled = false; bar.hidden = true;
          message.textContent = (error && error.message) || 'The recording could not be loaded.'; message.className = 'yp-msg error';
        }
      });
    });
  }

  function mountPages() {
    S.pageLoads = [];
    app.querySelectorAll('[data-pages]').forEach((box) => {
      const body = box.querySelector('.yp-pages-body');
      let loading = null;
      const start = () => {
        if (loading) return loading;
        loading = (async () => {
          const urls = [];
          for (const mediaId of box.dataset.pages.split(',')) urls.push(URL.createObjectURL(await N.loadMedia(mediaId)));
          body.innerHTML = urls.map((url, i) => `<img src="${url}" alt="Answer options, picture ${i + 1}">`).join('');
          await Promise.all(Array.from(body.querySelectorAll('img')).map((img) => img.decode()));
        })().catch((error) => {
          loading = null;
          body.innerHTML = `<p class="yp-msg error">${N.esc((error && error.message) || 'The pictures could not be loaded.')}</p>`;
          throw error;
        });
        return loading;
      };
      S.pageLoads.push(start);
      // Pictures load when their toggle is opened, and all of them before printing.
      const fold = box.closest('details');
      if (!fold || fold.open) start().catch(() => {});
      if (fold) fold.addEventListener('toggle', () => { if (fold.open) start().catch(() => {}); });
    });
  }

  A.ready.then(() => { N.warmOrigin(); return load(); }).catch((error) => N.fail(app, error));
})();
