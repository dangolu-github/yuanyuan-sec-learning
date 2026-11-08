// Home: what to do next and the Class Logbook (newest class first).
(() => {
  const N = window.Yy, app = document.getElementById('app');
  N.A.ready.then(async () => {
    try {
      const data = await N.A.request('getHome', {});
      N.previewNote(data.env);
      const todo = data.todo.length
        ? `<div class="yp-cards">${data.todo.map(N.taskCard).join('')}</div>`
        : '<p class="yp-empty">No homework is waiting.</p>';
      const logItem = (c) => `<li><a href="class/?id=${encodeURIComponent(c.id)}"><span class="num">${N.esc(c.number)}</span><span><strong>${N.esc(c.title)}</strong><span class="date">Class ${N.esc(c.number)} | ${N.esc(N.longDate(c.date))}${c.focus ? ' | ' + N.esc(c.focus) : ''}</span></span><span class="go">Open</span></a></li>`;
      const classes = data.classes.length
        ? `<ol class="yp-log">${data.classes.map(logItem).join('')}</ol>`
        : '<p class="yp-empty">Class records will appear here after each class.</p>';
      // Classes and homework already gone over in class; still open to read and print.
      const archive = data.archive || { classes: [], tasks: [] };
      const archived = archive.classes.length + archive.tasks.length;
      const archiveBody = (archive.classes.length ? `<ol class="yp-log">${archive.classes.map(logItem).join('')}</ol>` : '') +
        (archive.tasks.length ? `<div class="yp-cards">${archive.tasks.map(N.taskCard).join('')}</div>` : '');
      app.innerHTML = `
        <p class="yp-kicker">Singapore Secondary 3 | English Language</p>
        <h1>Welcome, Yuanyuan</h1>
        <p class="yp-lead">Your class handouts, class summaries and homework, all in one place.</p>
        <div class="yp-tiles">
          <a class="yp-tile" href="mistake-log/"><b>${data.counts.mistakesOpen}</b><strong>Mistake Log</strong><span>Mistakes to review</span></a>
        </div>
        ${N.foldBar()}
        <details class="yp-section yp-fold" data-fold="todo"><summary><h2>To do <small>${data.todo.length}</small></h2></summary>${todo}</details>
        <details class="yp-section yp-fold" data-fold="classes"><summary><h2>Class Logbook <small>${data.classes.length}</small></h2></summary>${classes}</details>
        ${archived ? `<details class="yp-section yp-fold" data-fold="archive"><summary><h2>Archive <small>${archived}</small></h2></summary>${archiveBody}</details>` : ''}`;
      N.folds(app, 'home');
    } catch (error) { N.fail(app, error); }
  });
})();
