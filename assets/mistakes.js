// Mistake Log: wrong answers from checked work and corrections the teacher adds, with retries.
// One remembered toggle per skill; the status chips switch between entries to review and cleared ones.
// "Print / Save as PDF" prints the list that is showing (every toggle opened), each entry with a blank
// "Try again" line; an answer prints only if it is visible on the page (revealed or cleared).
(() => {
  const N = window.Yy, A = N.A, app = document.getElementById('app');
  const S = { list: [], skills: [], show: 'open', open: {} };

  function card(m) {
    const cleared = m.status === 'cleared';
    const from = [m.taskLabel, m.n ? 'Q' + m.n : ''].filter(Boolean).join(' | ');
    const options = m.options && m.options.length ? `<ol type="A" class="ctx">${m.options.map((o) => `<li>${N.esc(o)}</li>`).join('')}</ol>` : '';
    const shown = cleared || S.open[m.id];
    const answer = m.correct || m.why
      ? (shown
        ? `${m.correct ? `<dt>Correct</dt><dd class="good">${N.esc(m.correct)}</dd>` : ''}${m.why ? `<dt>Why</dt><dd>${N.esc(m.why)}</dd>` : ''}`
        : '')
      : '';
    let retry = '';
    if (!cleared) {
      if (m.awaitingSelfCheck) {
        retry = `<p class="yp-note">Compare your new answer with the correction. Did you get it right this time?</p><div class="yp-actions"><button class="yp-btn" type="button" data-self="yes" data-id="${m.id}">I had it</button><button class="yp-btn alt" type="button" data-self="no" data-id="${m.id}">Not yet</button></div>`;
      } else {
        retry = `<div class="yp-retry">${m.mc
          ? `<input type="text" maxlength="1" placeholder="A, B, C..." data-attempt="${m.id}" aria-label="Your new answer">`
          : `<textarea rows="2" placeholder="Try again: write your answer again" data-attempt="${m.id}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"></textarea>`}
          <button class="yp-btn" type="button" data-check="${m.id}">Check</button>
          ${(m.correct || m.why) && !shown ? `<button class="yp-btn quiet" type="button" data-reveal="${m.id}">Show answer</button>` : ''}</div>`;
      }
    }
    return `<article class="yp-mistake${cleared ? ' is-cleared' : ''}" data-mistake="${m.id}">
      <h3><span class="yp-pill ${cleared ? 'good' : 'bad'}">${cleared ? 'Cleared' : 'To review'}</span> ${N.esc(m.skill)}${m.type ? ' | ' + N.esc(m.type) : ''}</h3>
      <p class="yp-meta">${N.esc(from)}${from ? ' | ' : ''}${N.esc(N.when(m.at))}${m.attempts ? ` | ${m.attempts} ${m.attempts === 1 ? 'retry' : 'retries'}` : ''}</p>
      ${m.context ? `<p class="ctx">${N.esc(m.context)}</p>` : ''}${options}
      <dl><dt>You wrote</dt><dd class="bad">${N.esc(m.answer || '(no answer)')}</dd>${m.lastAttempt && !cleared ? `<dt>Last retry</dt><dd>${N.esc(m.lastAttempt)}</dd>` : ''}${answer}</dl>
      ${retry}<p class="yp-msg" data-msg="${m.id}" role="status"></p></article>`;
  }

  function render() {
    const open = S.list.filter((m) => m.status === 'open'), cleared = S.list.filter((m) => m.status === 'cleared');
    const shown = S.show === 'open' ? open : cleared;
    const chip = (label, pressed, attrs) => `<button class="yp-chip" type="button" aria-pressed="${pressed}" ${attrs}>${N.esc(label)}</button>`;
    const bySkill = S.skills.map((skill) => [skill, shown.filter((m) => m.skill === skill)])
      .concat([['Other', shown.filter((m) => S.skills.indexOf(m.skill) < 0)]]).filter(([, l]) => l.length);
    app.innerHTML = `
      <p class="yp-kicker">Singapore Secondary 3 | English Language</p>
      <h1>Mistake Log</h1>
      <p class="yp-lead">Questions you got wrong in checked work, and corrections your teacher adds. Try each one again before you look at the answer; when you get it right it moves to Cleared.</p>
      <div class="yp-chips" role="group" aria-label="Status">${chip(`To review (${open.length})`, S.show === 'open', 'data-show="open"')}${chip(`Cleared (${cleared.length})`, S.show === 'cleared', 'data-show="cleared"')}</div>
      <p class="yp-print-only">${S.show === 'open' ? 'To review' : 'Cleared'} | ${shown.length} ${shown.length === 1 ? 'entry' : 'entries'}</p>
      ${shown.length ? '<div class="yp-actions yp-printbar"><button class="yp-btn quiet" type="button" data-print-page>Print / Save as PDF</button></div>' : ''}
      ${bySkill.length ? N.foldBar() : ''}
      ${bySkill.length ? bySkill.map(([skill, l]) => `<details class="yp-section yp-fold" data-fold="${S.show}:${N.esc(skill)}"><summary><h2>${N.esc(skill)} <small>${l.length}</small></h2></summary>${l.map(card).join('')}</details>`).join('')
        : `<p class="yp-empty">${S.show === 'open' ? 'Nothing to review. Mistakes from checked work will appear here.' : 'Nothing cleared yet.'}</p>`}`;
    N.folds(app, 'mistakes');
  }

  async function refresh() {
    const data = await A.request('getMistakes', {});
    N.previewNote(data.env);
    S.list = data.mistakes; S.skills = data.skills;
    render();
  }

  const say = (id, text, kind) => {
    const el = app.querySelector(`[data-msg="${id}"]`);
    if (el) { el.textContent = text; el.className = 'yp-msg' + (kind ? ' ' + kind : ''); }
  };

  app.addEventListener('click', async (event) => {
    const show = event.target.closest('[data-show]');
    if (show) { S.show = show.dataset.show; render(); return; }
    const printButton = event.target.closest('[data-print-page]');
    if (printButton) { printButton.disabled = true; window.YyPrint.print({}).catch(() => window.print()).finally(() => { printButton.disabled = false; }); return; }
    const reveal = event.target.closest('[data-reveal]');
    if (reveal) { S.open[reveal.dataset.reveal] = true; render(); return; }
    const check = event.target.closest('[data-check]'), self = event.target.closest('[data-self]');
    if (!check && !self) return;
    const id = check ? check.dataset.check : self.dataset.id;
    const button = check || self;
    button.disabled = true;
    try {
      if (check) {
        const attempt = app.querySelector(`[data-attempt="${id}"]`).value.trim();
        if (!attempt) { say(id, 'Write your new answer first.', 'error'); button.disabled = false; return; }
        say(id, 'Checking...');
        const result = await A.post('redoMistake', { mistakeId: id, attempt, submissionOrigin: await N.origin() });
        if (result.outcome === 'self-check') S.open[id] = true;
        await refresh();
        if (result.outcome === 'incorrect') say(id, 'Not yet. Look at the question again and try once more.', 'error');
      } else {
        await A.post('redoMistake', { mistakeId: id, selfMark: self.dataset.self, submissionOrigin: await N.origin() });
        if (self.dataset.self === 'no') delete S.open[id];
        await refresh();
      }
    } catch (error) {
      say(id, (error && error.message) || 'Please try again.', 'error');
      button.disabled = false;
    }
  });

  A.ready.then(() => { N.warmOrigin(); return refresh(); }).catch((error) => N.fail(app, error));
})();
