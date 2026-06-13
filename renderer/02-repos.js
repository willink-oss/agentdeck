'use strict';

// ---- repository panel ------------------------------------------------------
function normRepoPath(p) { return Repos.normalizePath(p); }
/** Persisted repos plus the pinned synthetic Home entry (Home first, deduped).
 *  Pure list logic lives in lib/repos.js (CI-covered); these just bind state. */
function effectiveRepos() { return Repos.effectiveRepos(repos, homeRepo); }
function findEff(id) { return Repos.findEff(repos, homeRepo, id); }
function repoIdForCwd(dir) {
  const hit = findEff(normRepoPath(dir));
  return hit ? hit.id : null;
}
/** Re-derive every live session's repoId from its launch dir, so sessions snap
 *  into (or out of) a repo group whenever the registry changes. */
function retagSessions() {
  for (const s of sessions.values()) s.repoId = repoIdForCwd(s.launchCwd);
}
function flashRepoMsg(text) {
  if (!repoMsgEl) return;
  repoMsgEl.textContent = text;
  repoMsgEl.hidden = false;
  clearTimeout(flashRepoMsg._t);
  flashRepoMsg._t = setTimeout(() => { repoMsgEl.hidden = true; }, 4500);
}

/** Signature of the git-derived fields, to skip re-renders when nothing changed. */
let reposSig = '';
function computeSig(list) {
  return JSON.stringify((list || []).map((r) => ({ id: r.id, branch: r.branch, stat: r.stat, worktrees: r.worktrees })));
}
function setRepos(list) { repos = list || []; reposSig = computeSig(repos); }

async function loadReposUI() {
  try { const res = await window.deck.reposList(); setRepos((res && res.repos) || []); }
  catch (_) { setRepos([]); }
  retagSessions();
  renderRepos();
}
async function addRepoFlow() {
  const dir = await window.deck.openDir();
  if (!dir) return;
  // The home dir is already pinned as the synthetic Home entry; registering it
  // would persist a duplicate that Home shadows and hides the remove button on.
  if (homeRepo && normRepoPath(dir) === homeRepo.id) {
    flashRepoMsg(t('repo.homeAlways')); return;
  }
  const res = await window.deck.reposAdd(dir);
  setRepos((res && res.repos) || []);
  retagSessions();
  if (res && res.ok === false) { flashRepoMsg(t('repo.saveFailed', { error: res.error || '' })); renderRepos(); return; }
  renderRepos();
  const added = Repos.findRepo(repos, normRepoPath(dir));
  if (added) selectRepo(added.id);
}
async function removeRepoFromList(id) {
  const res = await window.deck.reposRemove(id);
  setRepos((res && res.repos) || []);
  if (activeRepoId === id) activeRepoId = null;
  retagSessions();
  if (res && res.ok === false) flashRepoMsg(t('repo.saveFailed', { error: res.error || '' }));
  else disableSchedulesForRepo(id); // FR-10: schedules pointing here go dormant, not lost
  renderRepos();
}
/** Poll/refresh git status (branch + diff stats + worktrees); re-render only on change.
 *  Skipped while the window is blurred — the focus listener refreshes on return. */
async function refreshReposGit() {
  if (!windowFocused) return;
  let res;
  try { res = await window.deck.reposList(); } catch (_) { return; }
  const next = (res && res.repos) || [];
  if (computeSig(next) === reposSig) return;
  setRepos(next);
  retagSessions();
  renderRepos();
}
function updateLaunchLabel() {
  const r = activeRepoId ? findEff(activeRepoId) : null;
  launchBtn.textContent = r ? t('repo.launchFor', { repo: r.name }) : t('repo.launch');
}
function updateActiveHighlight() {
  for (const el of repoListEl.querySelectorAll('.repo-item[data-repo-id]')) {
    el.classList.toggle('active', el.dataset.repoId === activeRepoId);
  }
}
function setEmptyState(filteredRepoName) {
  if (filteredRepoName == null) {
    emptyTitleEl.textContent = t('empty.title');
    emptyDescEl.textContent = t('empty.desc');
  } else {
    emptyTitleEl.textContent = filteredRepoName;
    emptyDescEl.textContent = t('empty.forRepo');
  }
}
/** Apply the repo focus-filter to the terminal grid, the filter pill, and the empty state. */
function updateStage() {
  let total = 0, visible = 0;
  for (const s of sessions.values()) {
    total++;
    const show = !activeRepoId || s.repoId === activeRepoId;
    s.el.style.display = show ? '' : 'none';
    if (show) visible++;
  }
  const r = activeRepoId ? findEff(activeRepoId) : null;
  if (r && total > 0 && visible < total) {
    stageFilterLabel.textContent = t('repo.onlyShowing', { repo: r.name });
    stageFilterEl.hidden = false;
  } else {
    stageFilterEl.hidden = true;
  }
  if (total === 0) { setEmptyState(null); emptyState.style.display = 'flex'; }
  else if (visible === 0) { setEmptyState(r ? r.name : null); emptyState.style.display = 'flex'; }
  else { emptyState.style.display = 'none'; }
  refreshRestoreButton();
}
function clearRepoSelection() {
  activeRepoId = null;
  updateActiveHighlight();
  updateLaunchLabel();
  updateStage();
}
function selectRepo(id) {
  activeRepoId = id;
  const r = findEff(id);
  if (r) { cwdInput.value = r.path; refreshRepoHint(); }
  updateActiveHighlight();
  updateLaunchLabel();
  updateStage();
}
/** Set the active session and reflect it as the highlighted (.active) pane. */
function markActive(id) {
  activeSessionId = id;
  for (const el of grid.querySelectorAll('.pane.active')) el.classList.remove('active');
  const s = sessions.get(id);
  if (s) s.el.classList.add('active');
}
function focusSession(id) {
  const s = sessions.get(id);
  if (!s) return;
  try { s.el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (_) {}
  try { s.term.focus(); } catch (_) {}
  markActive(id);
  clearAttention(s);
}

// --- rendering: full rebuild (structural) + in-place state refresh ----------
let repoRowEls = new Map();   // session id -> session row element
let repoBadgeEls = new Map(); // group key   -> repo count badge element

function groupKeyForSession(s) {
  return (s.repoId && findEff(s.repoId)) ? s.repoId : '';
}
function sessionDotClass(s) {
  return 'status-dot' + (s.alive ? (s.attention ? ' waiting' : ' live') : '');
}
function sessionRow(id, s) {
  const row = document.createElement('div');
  row.className = 'repo-session' + (s.alive ? '' : ' exited') + (s.attention ? ' attention' : '');
  const dot = document.createElement('span');
  dot.className = sessionDotClass(s);
  const nm = document.createElement('span');
  nm.className = 'repo-session-name';
  nm.textContent = s.name;
  row.appendChild(dot);
  row.appendChild(nm);
  row.addEventListener('click', (e) => { e.stopPropagation(); focusSession(id); });
  repoRowEls.set(id, row);
  return row;
}
function sessionsByRepo() {
  const byRepo = new Map();
  for (const [id, s] of sessions) {
    const key = groupKeyForSession(s);
    if (!byRepo.has(key)) byRepo.set(key, []);
    byRepo.get(key).push([id, s]);
  }
  return byRepo;
}
/** "+X" / "-Y" coloured chip, or null when there are no line changes. */
function statBadge(stat) {
  if (!GitStat.formatStat(stat)) return null;
  const st = document.createElement('span');
  st.className = 'repo-stat';
  if (stat.insertions) {
    const a = document.createElement('span');
    a.className = 'stat-add'; a.textContent = '+' + stat.insertions; st.appendChild(a);
  }
  if (stat.deletions) {
    const d = document.createElement('span');
    d.className = 'stat-del'; d.textContent = '-' + stat.deletions; st.appendChild(d);
  }
  return st;
}
/** A git worktree row (branch + diff stat) under a repo. Informational. */
function worktreeRow(w) {
  const row = document.createElement('div');
  row.className = 'repo-worktree' + (w.isAgentdeck ? ' is-agentdeck' : '');
  const icon = document.createElement('span');
  icon.className = 'wt-icon'; icon.textContent = '⎇';
  const br = document.createElement('span');
  br.className = 'wt-branch';
  br.textContent = w.branch || '(detached)';
  br.title = w.path;
  row.appendChild(icon);
  row.appendChild(br);
  const st = statBadge(w.stat);
  if (st) row.appendChild(st);
  return row;
}
/** Build one group box — a registered repo, or the orphan "Other" group. */
function buildGroup({ key, name, nameDim, path, branch, repoId, stat, worktrees, home, sessList }) {
  const item = document.createElement('div');
  item.className = 'repo-item' + (repoId && repoId === activeRepoId ? ' active' : '') + (home ? ' is-home' : '');
  if (repoId) item.dataset.repoId = repoId;

  const row = document.createElement('div');
  row.className = 'repo-row';
  if (home) {
    const ic = document.createElement('span');
    ic.className = 'repo-home-icon'; ic.textContent = '⌂';
    row.appendChild(ic);
  }
  const nameEl = document.createElement('span');
  nameEl.className = 'repo-name';
  nameEl.textContent = name;
  if (nameDim) nameEl.style.color = 'var(--text-dim)';
  if (path) nameEl.title = path;
  row.appendChild(nameEl);
  if (branch) {
    const b = document.createElement('span');
    b.className = 'repo-branch';
    b.textContent = '⎇ ' + branch;
    b.title = branch;
    row.appendChild(b);
  }
  const st = statBadge(stat);
  if (st) row.appendChild(st);
  if (sessList.length) {
    const c = document.createElement('span');
    c.className = 'repo-count' + (sessList.some(([, s]) => s.attention) ? ' attention' : '');
    c.textContent = String(sessList.length);
    row.appendChild(c);
    repoBadgeEls.set(key, c);
  }
  if (repoId) {
    const sc = document.createElement('button');
    sc.className = 'repo-sched';
    sc.textContent = '⏰';
    sc.title = t('repo.schedAdd');
    sc.addEventListener('click', (e) => { e.stopPropagation(); openScheduleManagerForRepo(repoId); });
    row.appendChild(sc);
  }
  if (repoId && !home) {
    const rm = document.createElement('button');
    rm.className = 'repo-remove';
    rm.textContent = '×';
    rm.title = t('repo.remove');
    rm.addEventListener('click', (e) => { e.stopPropagation(); removeRepoFromList(repoId); });
    row.appendChild(rm);
  }
  item.appendChild(row);

  if (path) {
    const pathEl = document.createElement('div');
    pathEl.className = 'repo-path';
    pathEl.textContent = path;
    item.appendChild(pathEl);
  }
  if (worktrees && worktrees.length) {
    const wtWrap = document.createElement('div');
    wtWrap.className = 'repo-worktrees';
    for (const w of worktrees) wtWrap.appendChild(worktreeRow(w));
    item.appendChild(wtWrap);
  }
  if (sessList.length) {
    const wrap = document.createElement('div');
    wrap.className = 'repo-sessions';
    for (const [id, s] of sessList) wrap.appendChild(sessionRow(id, s));
    item.appendChild(wrap);
  }
  if (repoId) {
    item.addEventListener('click', () => selectRepo(repoId));
    // double-click = launch the current Agent straight into this repo
    item.addEventListener('dblclick', () => { selectRepo(repoId); launch(currentLaunchOpts(path)); });
  }
  return item;
}
/** Full structural rebuild — use on add/remove/select repo and launch/kill session. */
function renderRepos() {
  repoRowEls = new Map();
  repoBadgeEls = new Map();
  repoListEl.innerHTML = '';
  repoEmptyEl.style.display = repos.length ? 'none' : 'block';
  const byRepo = sessionsByRepo();
  for (const repo of effectiveRepos()) {
    repoListEl.appendChild(buildGroup({
      key: repo.id, name: repo.name, path: repo.path, branch: repo.branch,
      repoId: repo.id, stat: repo.stat, worktrees: repo.worktrees,
      home: !!repo.isHome, sessList: byRepo.get(repo.id) || [],
    }));
  }
  const orphans = byRepo.get('') || [];
  if (orphans.length) {
    repoListEl.appendChild(buildGroup({ key: '', name: 'Other', nameDim: true, sessList: orphans }));
  }
  updateLaunchLabel();
  updateStage();
}
/** In-place update for attention/exit transitions — avoids a full tree rebuild. */
function refreshSessionState(s) {
  if (!s) return;
  const row = repoRowEls.get(s.id);
  if (!row) return; // not currently rendered (e.g. just killed)
  row.className = 'repo-session' + (s.alive ? '' : ' exited') + (s.attention ? ' attention' : '');
  const dot = row.querySelector('.status-dot');
  if (dot) dot.className = sessionDotClass(s);
  const key = groupKeyForSession(s);
  const badge = repoBadgeEls.get(key);
  if (badge) {
    let attn = false;
    for (const o of sessions.values()) {
      if (groupKeyForSession(o) === key && o.attention) { attn = true; break; }
    }
    badge.classList.toggle('attention', attn);
  }
}

$('#repo-add').addEventListener('click', addRepoFlow);
$('#repo-refresh').addEventListener('click', refreshReposGit);
stageAllBtn.addEventListener('click', clearRepoSelection);
setInterval(refreshReposGit, 7000);
window.addEventListener('focus', refreshReposGit);
