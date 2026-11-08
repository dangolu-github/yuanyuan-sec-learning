// Print only content already present in the authorised learner page.
// Answer values are copied to temporary text nodes; the editable controls and fold choices are restored.
(() => {
  let state = null;
  let printing = false;
  const root = () => document.getElementById('app') || document.querySelector('main') || document.body;

  function prepare(options = {}) {
    if (state) return;
    const app = root();
    state = { details: [], controls: [], added: [], classes: [], labels: [], lineFits: [], blank: Boolean(options.blank) };
    document.body.classList.add('yp-printing');
    document.body.classList.toggle('yp-print-blank', state.blank);
    // A reading task's passages sit in their own pane on screen; on paper each goes back to its own place in
    // the task, after the instructions that introduce it (task.js leaves a hidden slot there). A mock with
    // several passages therefore prints in the paper's order, not with the passages gathered at the front.
    state.texts = [];
    app.querySelectorAll('.yp-split-texts > [data-text]').forEach((text) => {
      const slot = app.querySelector('[data-text-slot="' + text.dataset.text + '"]');
      if (!slot) return;
      state.texts.push(text);
      slot.after(text);
    });
    app.querySelectorAll('details').forEach((node) => {
      state.details.push([node, node.open]);
      // A listening script prints only if the learner opened it; closed, print.css leaves it out.
      if (!node.matches('[data-print-if-open]')) node.open = true;
    });

    // Reading passages keep the paper's printed lines (one <li> per line). Record each passage's
    // widest line in em; print.css then shrinks that passage so every paper line prints on one line.
    // System fonts change letter spacing with size, so measure near the printed size: first at 12px,
    // then at the size that width gives on A4 (about 685px of text beside the line numbers).
    app.querySelectorAll('ol.yp-lines').forEach((list) => {
      const lines = Array.from(list.children).filter((node) => node.tagName === 'LI');
      if (!lines.length) return;
      list.classList.add('yp-measure-lines');
      const widestAt = (px) => {
        list.style.setProperty('--yp-measure-size', px + 'px');
        return Math.max(...lines.map((line) => {
          const range = document.createRange();
          range.selectNodeContents(line);
          return range.getBoundingClientRect().width / px;
        }));
      };
      let widest = widestAt(12);
      if (widest > 0) widest = Math.max(widest, widestAt(Math.min(13.6, 685 / widest)));
      list.classList.remove('yp-measure-lines');
      list.style.removeProperty('--yp-measure-size');
      // Above 72em even the 7pt floor would overflow A4; such a passage keeps wrapping.
      if (widest > 0 && widest <= 72) {
        list.style.setProperty('--yp-line-em', widest.toFixed(2));
        list.classList.add('yp-fit-lines');
        state.lineFits.push(list);
      }
    });

    app.querySelectorAll('textarea[data-input], input[type="text"][data-input], .yp-q input[type="radio"], .yp-q input[type="checkbox"]').forEach((control) => {
      // Checked paper work already has its faithful original (with error spans) in the feedback.
      // Do not print a second copy from the hidden form value. A clean question sheet still needs space.
      if (!state.blank && control.hasAttribute('data-paper-original')) {
        control.classList.add('yp-print-control');
        state.controls.push(control);
        return;
      }
      const mark = control.type === 'radio' || control.type === 'checkbox';
      const node = document.createElement(control.tagName === 'TEXTAREA' ? 'div' : 'span');
      node.className = 'yp-print-value' + (mark ? ' yp-print-mark' : control.tagName === 'TEXTAREA' ? ' yp-print-answer' : ' yp-print-inline');
      if (mark) {
        node.textContent = !state.blank && control.checked ? '●' : '○';
        node.setAttribute('aria-hidden', 'true');
      } else {
        node.textContent = state.blank ? '' : control.value;
        if (!node.textContent.trim()) {
          node.classList.add('yp-print-empty');
          // Supply bounded working room, not a full mostly blank essay page.
          if (control.tagName === 'TEXTAREA') node.classList.add(Number(control.rows) > 3 ? 'yp-print-long-space' : 'yp-print-short-space');
          else node.textContent = '\u00a0';
        }
      }
      control.classList.add('yp-print-control');
      control.insertAdjacentElement('afterend', node);
      state.controls.push(control);
      state.added.push(node);
    });

    // A mistake-log entry still to review gets a blank line to try it again on paper.
    app.querySelectorAll('.yp-retry').forEach((retry) => {
      const line = document.createElement('p');
      line.className = 'yp-print-value yp-print-retry';
      line.textContent = 'Try again:';
      retry.insertAdjacentElement('afterend', line);
      state.added.push(line);
    });

    // The live counter is UI; its authored word-range guidance belongs on paper.
    app.querySelectorAll('.yp-count[data-min][data-max]').forEach((counter) => {
      const min = Number(counter.dataset.min), max = Number(counter.dataset.max);
      if (!Number.isFinite(min) || !Number.isFinite(max) || max <= 0) return;
      const guide = document.createElement('p');
      guide.className = 'yp-print-value yp-print-guide';
      guide.textContent = `Suggested length: ${min}-${max} words`;
      counter.insertAdjacentElement('afterend', guide);
      state.added.push(guide);
    });

    // Measure the text that will actually print: full answer surrogates and released
    // feedback count; hidden controls and blank-print corrections do not.
    if (state.blank && app.classList.contains('yp-extra-task')) {
      app.querySelectorAll('.yp-prompt-line').forEach(prompt => {
        prompt.childNodes.forEach(node => {
          if (node.nodeType === Node.TEXT_NODE && /^\s*Answer:\s*$/.test(node.textContent)) {
            state.labels.push([node, node.textContent]); node.textContent = '';
          }
        });
      });
    }
    const questions = Array.from(app.querySelectorAll('.yp-q'));
    const shortQuestions = new Set();
    questions.forEach((question) => {
      const copy = question.cloneNode(true);
      copy.querySelectorAll('[hidden], [data-no-print], .no-print, .yp-print-control, .yp-count, .yp-msg').forEach(node => node.remove());
      if (state.blank) copy.querySelectorAll('.yp-verdict, [data-print-feedback], .yp-paper-review, .yp-review').forEach(node => node.remove());
      const text = copy.textContent;
      const longAnswer = Array.from(question.querySelectorAll('textarea')).some(node => Number(node.rows) > 3);
      if (question.querySelector('textarea') && !longAnswer) {
        question.classList.add('yp-print-short-answer');
        state.classes.push([question, 'yp-print-short-answer']);
      }
      if (text.length < 1000 && text.split('\n').length < 18 && !copy.querySelector('table, img') && !longAnswer) {
        question.classList.add('yp-print-short');
        state.classes.push([question, 'yp-print-short']);
        if (text.length < 700) shortQuestions.add(question);
      }
    });
    const blocks = app.querySelector('[data-blocks]');
    const blockQuestions = blocks ? Array.from(blocks.querySelectorAll('.yp-q')) : [];
    // A passage with the paper's own lines needs the full page width, so it never goes into columns.
    if (blocks && !blocks.querySelector('.yp-doc, .yp-pages, ol.yp-lines, table, img') &&
        blockQuestions.length >= 6 && blockQuestions.every(question => shortQuestions.has(question))) {
      blocks.classList.add('yp-print-columns');
      state.classes.push([blocks, 'yp-print-columns']);
    }
    document.dispatchEvent(new CustomEvent('yy:print-prepared', { detail: { blank: state.blank } }));
  }

  function restore() {
    if (!state) return;
    const previous = state;
    state = null;
    previous.labels.forEach(([node, text]) => { node.textContent = text; });
    previous.added.forEach((node) => node.remove());
    previous.controls.forEach((node) => node.classList.remove('yp-print-control'));
    previous.classes.forEach(([node, name]) => node.classList.remove(name));
    previous.lineFits.forEach((list) => { list.classList.remove('yp-fit-lines'); list.style.removeProperty('--yp-line-em'); });
    previous.details.forEach(([node, open]) => { node.open = open; });
    const pane = document.querySelector('.yp-split-texts');
    if (pane) (previous.texts || []).forEach((text) => pane.append(text));
    document.body.classList.remove('yp-printing', 'yp-print-blank');
    document.dispatchEvent(new CustomEvent('yy:print-restored'));
  }

  async function readyImages() {
    const images = Array.from(root().querySelectorAll('img')).filter((image) =>
      !image.closest('[hidden], [data-no-print]') &&
      !(state && state.blank && image.closest('.yp-verdict, .yp-result, .yp-banner, [data-print-feedback], .yp-paper-review, .yp-review')));
    await Promise.all(images.map(async (image) => {
      if (image.decode) {
        try { await image.decode(); } catch (error) { throw new Error('A picture could not be loaded. Please reload it before printing.'); }
      } else if (!image.complete) {
        await new Promise((resolve, reject) => {
          image.addEventListener('load', resolve, { once: true });
          image.addEventListener('error', () => reject(new Error('A picture could not be loaded.')), { once: true });
        });
      }
      if (!image.naturalWidth) throw new Error('A picture could not be loaded. Please reload it before printing.');
    }));
  }

  async function print(options = {}) {
    if (printing) return;
    printing = true;
    try {
      prepare(options);
      // The task renderer supplies its private figure-loading promise here.
      if (typeof options.prepare === 'function') await options.prepare();
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      await readyImages();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      window.print();
    } catch (error) {
      restore();
      throw error;
    } finally {
      printing = false;
      // Standard print dialogs fire afterprint on close. A focus fallback covers browsers that omit it.
    }
  }

  window.addEventListener('beforeprint', () => prepare());
  window.addEventListener('afterprint', restore);
  window.addEventListener('focus', () => {
    if (state && !printing && !window.matchMedia('print').matches) restore();
  });
  window.YyPrint = { print, prepare, restore, get active() { return Boolean(state); } };
})();
