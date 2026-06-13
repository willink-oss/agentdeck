'use strict';

// ---- scheduled launches (⏰): manager modal + fire handler -------------------
// The main process owns the schedule store + timer; this file is only the UI and
// the schedule:fire -> launch() bridge (launch needs the renderer's PRESETS/grid).
const Schedule = window.Schedule;

const schedOverlay = $('#sched-overlay');
const schedListEl = $('#sched-list');
const schedForm = $('#sched-form');
const schedRepoSel = $('#sched-repo');
const schedTimeInput = $('#sched-time');
const schedRepeatSel = $('#sched-repeat');
const schedDateInput = $('#sched-date');
const schedDaysEl = $('#sched-days');
const schedPresetSel = $('#sched-preset');
const schedCommandInput = $('#sched-command');
const schedNameInput = $('#sched-name');
const schedWtEnable = $('#sched-wt');
const schedWtPrefix = $('#sched-wt-prefix');
const schedSubmitBtn = $('#sched-submit');
const schedCancelBtn = $('#sched-cancel');
const schedFormMsg = $('#sched-form-msg');

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
let schedules = [];
let editingScheduleId = null;

// ---- fire handler ------------------------------------------------------------
window.deck.onScheduleFire(({ schedule }) => {
  const repo = findEff(schedule.repoId);
  if (!repo) {
    flashRepoMsg(`⏰ スケジュールのリポジトリが見つかりません: ${schedule.repoId}`);
    return;
  }
  const L = schedule.launch;
  launch({
    presetKey: L.presetKey,
    command: L.command,
    name: L.name || `⏰ ${repo.name} ${schedule.time}`,
    cwd: repo.path,
    worktree: L.worktree,
    // a fresh minute-stamped branch per firing, so repeats never collide (FR-4)
    branch: L.worktree ? Schedule.uniqueBranch(L.branchPrefix, L.presetKey, Date.now()) : '',
  });
  notify(`⏰ ${repo.name} でスケジュールセッションを起動しました`);
});

/** Disable every schedule pointing at a just-unregistered repo (FR-10). */
async function disableSchedulesForRepo(repoId) {
  try {
    const res = await window.deck.schedulesList();
    for (const s of (res && res.schedules) || []) {
      if (s.repoId === repoId && s.enabled) await window.deck.schedulesToggle(s.id, false);
    }
  } catch (_) {}
}

// ---- manager modal -----------------------------------------------------------
function fmtFireAt(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()}(${DAY_LABELS[d.getDay()]}) ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function repeatLabel(rep) {
  if (rep.type === 'once') return rep.date;
  if (rep.type === 'daily') return '毎日';
  return (rep.days || []).map((d) => DAY_LABELS[d]).join('');
}

function buildSchedRepoOptions(selectedId) {
  schedRepoSel.innerHTML = '';
  for (const r of effectiveRepos()) {
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = r.isHome ? '⌂ Home' : r.name;
    opt.title = r.path;
    schedRepoSel.appendChild(opt);
  }
  if (selectedId && findEff(selectedId)) schedRepoSel.value = selectedId;
}
function buildSchedPresetOptions(selectedKey) {
  schedPresetSel.innerHTML = '';
  for (const [key, p] of Object.entries(PRESETS)) {
    const opt = document.createElement('option');
    opt.value = key; opt.textContent = p.label;
    schedPresetSel.appendChild(opt);
  }
  schedPresetSel.value = PRESETS[selectedKey] ? selectedKey : 'claude';
}

function selectedDays() {
  return [...schedDaysEl.querySelectorAll('.day-chip.on')].map((b) => Number(b.dataset.day));
}
function setSelectedDays(days) {
  for (const b of schedDaysEl.querySelectorAll('.day-chip')) {
    b.classList.toggle('on', (days || []).includes(Number(b.dataset.day)));
  }
}
function refreshRepeatFields() {
  const t = schedRepeatSel.value;
  schedDateInput.hidden = t !== 'once';
  schedDaysEl.hidden = t !== 'weekly';
}

function resetSchedForm(prefill) {
  const p = prefill || {};
  editingScheduleId = null;
  schedForm.reset();
  buildSchedRepoOptions(p.repoId || activeRepoId);
  buildSchedPresetOptions(p.presetKey || presetSel.value);
  schedCommandInput.value = p.command != null ? p.command : commandInput.value;
  schedNameInput.value = p.name || '';
  schedWtEnable.checked = !!p.worktree;
  schedWtPrefix.disabled = !schedWtEnable.checked;
  schedRepeatSel.value = 'daily';
  setSelectedDays([1, 2, 3, 4, 5]);
  refreshRepeatFields();
  schedSubmitBtn.textContent = '＋ 追加';
  schedCancelBtn.hidden = true;
  schedFormMsg.hidden = true;
}

function startSchedEdit(s) {
  editingScheduleId = s.id;
  buildSchedRepoOptions(s.repoId);
  buildSchedPresetOptions(s.launch.presetKey);
  schedTimeInput.value = s.time;
  schedRepeatSel.value = s.repeat.type;
  schedDateInput.value = s.repeat.date || '';
  setSelectedDays(s.repeat.type === 'weekly' ? s.repeat.days : [1, 2, 3, 4, 5]);
  refreshRepeatFields();
  schedCommandInput.value = s.launch.command;
  schedNameInput.value = s.launch.name;
  schedWtEnable.checked = s.launch.worktree;
  schedWtPrefix.value = s.launch.branchPrefix;
  schedWtPrefix.disabled = !s.launch.worktree;
  schedSubmitBtn.textContent = '保存';
  schedCancelBtn.hidden = false;
  schedFormMsg.hidden = true;
  schedTimeInput.focus();
}

function renderSchedList() {
  schedListEl.innerHTML = '';
  if (!schedules.length) {
    const li = document.createElement('li');
    li.className = 'sched-empty';
    li.textContent = 'スケジュールはありません。下のフォームから追加できます。';
    schedListEl.appendChild(li);
    return;
  }
  for (const s of schedules) {
    const repo = findEff(s.repoId);
    const li = document.createElement('li');
    li.className = 'preset-row sched-row' + (s.enabled ? '' : ' off');

    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = !!s.enabled;
    toggle.title = s.enabled ? '無効にする' : '有効にする';
    toggle.addEventListener('change', async () => {
      const res = await window.deck.schedulesToggle(s.id, toggle.checked);
      applySchedules(res);
    });

    const nm = document.createElement('span');
    nm.className = 'preset-row-name';
    nm.textContent = repo ? (repo.isHome ? '⌂ Home' : repo.name) : s.repoId;
    nm.title = s.repoId;

    const when = document.createElement('span');
    when.className = 'sched-row-when';
    when.textContent = `${s.time} · ${repeatLabel(s.repeat)}`;

    const meta = document.createElement('span');
    meta.className = 'preset-row-cmd';
    if (!repo) {
      meta.textContent = '⚠ リポジトリ未登録';
      meta.classList.add('sched-warn');
      meta.title = `${s.repoId} はリポジトリ一覧にありません`;
    } else {
      meta.textContent = s.enabled ? `次回 ${fmtFireAt(s.nextFireAt)}` : '無効';
      meta.title = `${PRESETS[s.launch.presetKey] ? PRESETS[s.launch.presetKey].label : s.launch.presetKey}` +
        (s.launch.worktree ? ' · worktree 隔離' : '');
    }

    const edit = document.createElement('button');
    edit.type = 'button'; edit.className = 'ghost-btn'; edit.textContent = '編集';
    edit.addEventListener('click', () => startSchedEdit(s));
    const del = document.createElement('button');
    del.type = 'button'; del.className = 'ghost-btn'; del.textContent = '削除';
    del.addEventListener('click', async () => {
      const res = await window.deck.schedulesRemove(s.id);
      if (editingScheduleId === s.id) resetSchedForm();
      applySchedules(res);
    });

    li.append(toggle, nm, when, meta, edit, del);
    schedListEl.appendChild(li);
  }
}

function applySchedules(res) {
  if (res && res.ok === false && res.error) {
    schedFormMsg.textContent = res.error;
    schedFormMsg.hidden = false;
  }
  schedules = (res && res.schedules) || [];
  renderSchedList();
}

async function refreshSchedules() {
  try { applySchedules(await window.deck.schedulesList()); }
  catch (_) { schedules = []; renderSchedList(); }
}

function openScheduleManager(prefill) {
  schedOverlay.hidden = false;
  resetSchedForm(prefill);
  refreshSchedules();
  schedTimeInput.focus();
}
/** Sidebar entry point (FR-11): the repo row's ⏰ pre-fills repo + current form. */
function openScheduleManagerForRepo(repoId) {
  const cur = currentLaunchOpts();
  openScheduleManager({ repoId, presetKey: cur.presetKey, command: cur.command, name: cur.name, worktree: cur.worktree });
}
function closeScheduleManager() { schedOverlay.hidden = true; }

schedForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const type = schedRepeatSel.value;
  const raw = {
    repoId: schedRepoSel.value,
    time: schedTimeInput.value,
    repeat: type === 'once' ? { type, date: schedDateInput.value }
      : type === 'weekly' ? { type, days: selectedDays() }
      : { type },
    launch: {
      presetKey: schedPresetSel.value,
      command: schedCommandInput.value,
      name: schedNameInput.value.trim(),
      worktree: schedWtEnable.checked,
      branchPrefix: schedWtPrefix.value.trim(),
    },
  };
  const res = editingScheduleId
    ? await window.deck.schedulesUpdate(editingScheduleId, raw)
    : await window.deck.schedulesAdd(raw);
  if (res && res.ok === false) {
    schedFormMsg.textContent = res.error || '保存に失敗しました';
    schedFormMsg.hidden = false;
    return;
  }
  resetSchedForm();
  applySchedules(res);
});

schedDaysEl.addEventListener('click', (e) => {
  const b = e.target.closest('.day-chip');
  if (b) b.classList.toggle('on');
});
schedRepeatSel.addEventListener('change', refreshRepeatFields);
schedWtEnable.addEventListener('change', () => {
  schedWtPrefix.disabled = !schedWtEnable.checked;
  if (schedWtEnable.checked) schedWtPrefix.focus();
});
schedCancelBtn.addEventListener('click', () => resetSchedForm());
$('#sched-manage').addEventListener('click', () => openScheduleManager());
$('#sched-close').addEventListener('click', closeScheduleManager);
$('#sched-backdrop').addEventListener('click', closeScheduleManager);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !schedOverlay.hidden) closeScheduleManager();
});
