'use strict';
/**
 * OLYMPIA APP – O LAN
 * Server là nguồn dữ liệu duy nhất: điểm, câu hỏi, đồng hồ, chuông đều do server quyết định.
 */
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Server } = require('socket.io');

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const readJSON = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const config = readJSON(path.join(ROOT, 'config.json'));
const PORT = Number(process.env.PORT || config.port);
let Q = readJSON(path.join(DATA, 'questions.json'));

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const page = f => (req, res) => res.sendFile(path.join(ROOT, 'public', f));
app.use('/static', express.static(path.join(ROOT, 'public')));
app.use('/media', express.static(path.join(ROOT, 'media')));
app.get('/', page('index.html'));
app.get('/admin', page('admin.html'));
app.get('/led', page('led.html'));
app.get('/team/:id', page('team.html'));
app.get('/api/info', (req, res) => res.json({
  port: PORT,
  ips: lanIPs(),
  teams: config.teams.map((t, i) => ({ id: i + 1, name: t.name })),
  competition: config.competition || {}
}));

function lanIPs() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  return out;
}

/* ------------------------------------------------------------------ STATE */
const ROUND_NAMES = {
  idle: 'Chờ bắt đầu', kdrieng: 'Khởi động – Lượt riêng', khoidong: 'Khởi động – Lượt chung',
  vcnv: 'Vượt chướng ngại vật', tangtoc: 'Tăng tốc', vedich: 'Về đích', phu: 'Câu hỏi phụ'
};
// Điểm được cộng dồn theo từng phần thi; hai lượt Khởi động chung một phần thi
const PART = { kdrieng: 'khoidong', khoidong: 'khoidong', vcnv: 'vcnv', tangtoc: 'tangtoc', vedich: 'vedich', phu: 'phu' };
const PART_NAMES = { khoidong: 'Khởi động', vcnv: 'Vượt chướng ngại vật', tangtoc: 'Tăng tốc', vedich: 'Về đích', phu: 'Câu hỏi phụ', khac: 'Điều chỉnh' };
const emptyParts = () => ({ khoidong: 0, vcnv: 0, tangtoc: 0, vedich: 0, phu: 0, khac: 0 });
const SFILE = path.join(DATA, 'state.json');
const LOGFILE = path.join(DATA, 'log.jsonl');

function freshState() {
  return {
    mode: config.mode || 'PRACTICE',
    teams: config.teams.map((t, i) => ({ id: i + 1, name: t.name, score: 0, starUsed: false, parts: emptyParts() })),
    showTotal: false,
    kdrieng: { current: 1, bedOn: false },
    transitioning: false,
    round: 'idle', qIndex: -1,
    showQuestion: false, showAnswer: false, revealAnswers: false,
    timer: { duration: 0, remaining: 0, running: false, label: '' },
    buzzer: { open: false, winner: null, locked: [], purpose: null },
    accepting: false, qStart: 0,
    answers: {},
    judged: [],      // chống chấm điểm hai lần cho cùng một câu
    tangtocScored: false,
    vcnv: { rows: [], tiles: [false, false, false, false], keyword: false, kwOpen: [], eliminated: [] },
    vedich: { order: [], current: null, value: 0, star: false, used: { 10: [], 20: [], 30: [] }, q: null, stealing: false, count: 0,
      pkg: null,        // { value: 40, items: [{ v: 10, i: 2 }, …], pos: 0 }
      screen: null },   // 'choose' khi LED đang hiện màn hình chọn gói
    effect: 'flip',
    banner: '',
    history: []
  };
}

let state = freshState();
try {
  const saved = readJSON(SFILE);
  if (saved.mode) state.mode = saved.mode;
  (saved.teams || []).forEach(s => {
    const t = team(s.id);
    if (t) { t.score = s.score; t.starUsed = s.starUsed; t.parts = { ...emptyParts(), ...(s.parts || {}) }; }
  });
} catch { /* chưa có state lưu */ }

function team(id) { return state.teams.find(t => t.id === Number(id)); }
function persist() {
  fs.writeFileSync(SFILE, JSON.stringify({
    mode: state.mode,
    teams: state.teams.map(({ id, score, starUsed, parts }) => ({ id, score, starUsed, parts }))
  }, null, 2));
}
function log(type, data = {}) {
  const e = { t: new Date().toISOString(), mode: state.mode, round: state.round, q: state.qIndex, type, ...data };
  fs.appendFileSync(LOGFILE, JSON.stringify(e) + '\n');
  state.history.unshift(e);
  if (state.history.length > 40) state.history.length = 40;
}

function roundList(r = state.round) {
  if (r === 'kdrieng') return (Q.kdrieng && Q.kdrieng[String(state.kdrieng.current)]) || [];
  if (r === 'khoidong') return Q.khoidong || [];
  if (r === 'vcnv') return (Q.vcnv && Q.vcnv.rows) || [];
  if (r === 'tangtoc') return Q.tangtoc || [];
  if (r === 'phu') return Q.phu || [];
  return [];
}
function currentQ() {
  if (state.round === 'vedich') return state.vedich.q;
  return roundList()[state.qIndex] || null;
}
const kwLetters = () => [...String((Q.vcnv && Q.vcnv.keyword) || '').normalize('NFC').replace(/\s+/g, '')];
const pattern = s => String(s || '').normalize('NFC').trim().split(/\s+/).filter(Boolean).map(w => [...w].length);

function addScore(teamId, delta, reason) {
  const t = team(teamId);
  if (!t || !delta) return;
  t.score += delta;
  const part = PART[state.round] || 'khac';
  t.parts[part] = (t.parts[part] || 0) + delta;
  persist();
  log('score', { teamId: t.id, delta, reason, part, total: t.score });
  io.emit('score', { teamId: t.id, delta });
}

function clearQuestion() {
  cancelTransition();
  state.showQuestion = false; state.showAnswer = false; state.revealAnswers = false;
  state.answers = {}; state.accepting = false; state.tangtocScored = false;
  state.judged = [];
  state.buzzer = { open: false, winner: null, locked: [], purpose: null };
}

/* ------------------------------------------------------------------ SOUND */
// Âm thanh chỉ phát trên màn hình LED (loa sân khấu). Tên file theo config.sounds.
const SND = config.sounds || {};
const SDIR = SND.dir || '/media/sound/';
const SOUND_DIR = path.join(ROOT, 'media', 'sound');
const srcOf = f => (f ? SDIR + f : null);

// Tra cứu theo phần thi, không có thì lấy mục common; "" nghĩa là tắt hẳn.
function sndLookup(key, round = state.round) {
  const r = SND[round] || {};
  if (Object.prototype.hasOwnProperty.call(r, key)) return { v: r[key], off: r[key] === '' };
  const c = SND.common || {};
  if (Object.prototype.hasOwnProperty.call(c, key)) return { v: c[key], off: c[key] === '' };
  return { v: null, off: false };
}
function sfx(key, extra = {}) {
  const { v, off } = sndLookup(key);
  io.to('led').emit('sfx', { key, src: typeof v === 'string' ? srcOf(v) : null, off, ...extra });
}
// Nhạc đồng hồ: chọn file có số giây bằng hoặc gần nhất lớn hơn thời gian đếm ngược,
// rồi tua tới đúng điểm để nhạc kết thúc cùng lúc với đồng hồ.
function timerMusic(sec, kind) {
  const { v } = sndLookup(kind === 'answer' ? 'answerTimer' : 'timer');
  if (!v || typeof v !== 'object') return null;
  const keys = Object.keys(v).map(Number).filter(n => n > 0 && v[n]).sort((a, b) => a - b);
  const k = keys.find(n => n >= sec) ?? keys[keys.length - 1];
  if (k === undefined) return null;
  return { src: srcOf(v[k]), offset: Math.max(0, k - sec) };
}
function soundFiles() {
  try { return fs.readdirSync(SOUND_DIR).filter(f => /\.(mp3|wav|ogg)$/i.test(f)).sort((a, b) => a.localeCompare(b, 'vi', { numeric: true })); }
  catch { return []; }
}
// Danh sách file cần nạp sẵn trên LED để phát không bị trễ
function preloadList() {
  const out = new Set();
  const walk = v => {
    if (typeof v === 'string') { if (/\.(mp3|wav|ogg)$/i.test(v)) out.add(srcOf(v)); }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => { if (!k.startsWith('_')) walk(x); });
  };
  walk(SND);
  return [...out];
}

/* Chuyển cảnh trước khi hiện câu hỏi: LED chạy video, câu hỏi chỉ hiện (trên LED và máy đội)
   khi video xong, rồi mới chạy then() — đồng hồ không bị tính trong lúc chuyển cảnh. */
let transTimer = null;
function cancelTransition() {
  if (transTimer) { clearTimeout(transTimer); io.to('led').emit('scene', { cmd: 'stop' }); }
  transTimer = null;
  state.transitioning = false;
}
function lockFor(sec) {
  cancelTransition();
  state.transitioning = true;
  transTimer = setTimeout(() => { transTimer = null; state.transitioning = false; broadcast(); }, (Number(sec) || 0) * 1000 + 150);
}
function revealQuestion(then, scene) {
  if (state.showQuestion) { if (then) then(); return; }
  const tr = scene !== undefined ? scene : (config.transitions || {})[state.round];
  if (tr && tr.src) {
    state.transitioning = true;
    if (!tr.noEmit) io.to('led').emit('scene', { cmd: 'play', src: tr.src });
    transTimer = setTimeout(() => {
      transTimer = null;
      state.transitioning = false;
      state.showQuestion = true;
      if (then) then();
      broadcast();
    }, (Number(tr.sec) || 4) * 1000 + 150);
  } else {
    state.showQuestion = true;
    sfx('question');
    if (then) then();
  }
}
// Nhạc nền cả lượt (Khởi động lượt riêng): chạy khi đồng hồ chạy, tạm dừng giữa các câu.
function bed(cmd) {
  if (cmd === 'stop') {
    if (state.kdrieng.bedOn) io.to('led').emit('bed', { cmd: 'stop' });
    state.kdrieng.bedOn = false;
    return;
  }
  if (state.round !== 'kdrieng' && state.round !== 'khoidong') return;
  if (cmd === 'run') {
    if (state.kdrieng.bedOn) return io.to('led').emit('bed', { cmd: 'resume' });
    const { v } = sndLookup('bed');
    if (typeof v !== 'string' || !v) return;
    state.kdrieng.bedOn = true;
    io.to('led').emit('bed', { cmd: 'play', src: srcOf(v) });
  } else if (state.kdrieng.bedOn) io.to('led').emit('bed', { cmd });
}

function playIntro() {
  const r = state.round;
  if (r === 'idle') return;
  const part = PART[r];
  const intros = config.intros || {};
  const { v } = sndLookup('intro');
  const vid = intros[r] !== undefined ? intros[r] : intros[part];
  if (vid === 'off') { if (typeof v === 'string' && v) io.to('led').emit('sfx', { key: 'intro', src: srcOf(v) }); return; }
  io.to('led').emit('intro', {
    round: r,
    title: PART_NAMES[part] || ROUND_NAMES[r],
    subtitle: r === 'kdrieng' ? 'Lượt riêng' : r === 'khoidong' ? 'Lượt chung' : '',
    video: intros[r] || intros[part] || null,
    sound: typeof v === 'string' ? srcOf(v) : null   // nhạc mở đầu, phát sau video intro
  });
}

/* ------------------------------------------------------------------ TIMER */
let tEnd = 0, tHandle = null, tLastSec = -1, tOnEnd = null;
function startTimer(sec, label, onEnd, kind = 'think') {
  haltTimer();
  if (!sec) return;
  tEnd = Date.now() + sec * 1000;
  tOnEnd = onEnd || null;
  tLastSec = -1;
  state.timer = { duration: sec, remaining: sec * 1000, running: true, label };
  const m = timerMusic(sec, kind);
  if (m) io.to('led').emit('music', { cmd: 'play', ...m });
  tHandle = setInterval(tick, 100);
  tick();
}
function tick() {
  const rem = Math.max(0, tEnd - Date.now());
  state.timer.remaining = rem;
  const s = Math.ceil(rem / 1000);
  if (s !== tLastSec) { tLastSec = s; io.emit('tick', { ...state.timer }); }
  if (rem <= 0) {
    clearInterval(tHandle); tHandle = null;
    state.timer.running = false;
    const cb = tOnEnd; tOnEnd = null;
    if (cb) cb();
    bed('pause');
    io.emit('timeup');
    broadcast();
  }
}
function pauseTimer() {
  if (!tHandle) return;
  clearInterval(tHandle); tHandle = null;
  state.timer.remaining = Math.max(0, tEnd - Date.now());
  state.timer.running = false;
  io.emit('tick', { ...state.timer });
  io.to('led').emit('music', { cmd: 'pause' });
  bed('pause');
}
function resumeTimer() {
  if (tHandle || state.timer.remaining <= 0) return;
  tEnd = Date.now() + state.timer.remaining;
  state.timer.running = true;
  tHandle = setInterval(tick, 100);
  io.to('led').emit('music', { cmd: 'resume' });
  bed('resume');
}
function haltTimer() {
  const wasRunning = !!tHandle;
  if (tHandle) clearInterval(tHandle);
  tHandle = null; tOnEnd = null;
  state.timer.running = false;
  // Dừng nhạc đồng hồ khi đồng hồ bị dừng giữa chừng (đã có người trả lời, chuyển câu…)
  if (wasRunning || state.timer.remaining > 0) io.to('led').emit('music', { cmd: 'stop' });
  if (wasRunning) bed('pause');
}

/* ----------------------------------------------------------------- BUZZER */
function openBuzzer(purpose, locked = []) {
  state.buzzer = { open: true, winner: null, locked: [...locked], purpose };
}
function onBuzz(teamId) {
  const b = state.buzzer;
  // Người bấm đầu tiên là gói tin đến server đầu tiên — client không có quyền quyết định.
  if (!b.open || b.winner || b.locked.includes(teamId)) return;
  if (state.round === 'vcnv' && state.vcnv.eliminated.includes(teamId)) return;
  b.winner = teamId; b.open = false;
  b.atMs = Date.now() - state.qStart;
  log('buzz', { teamId, purpose: b.purpose, atMs: b.atMs });
  io.emit('buzz', { teamId, name: team(teamId).name, purpose: b.purpose });
  sfx('buzz');
  startTimer(config.answerTime, 'Trả lời', null, 'answer');
  broadcast();
}

/* ----------------------------------------------------------------- ANSWER */
function onAnswer(teamId, text) {
  if (!state.accepting) return;
  if (state.round === 'vcnv' && state.vcnv.eliminated.includes(teamId)) return;
  text = String(text || '').slice(0, 200).trim();
  if (!text) return;
  // Tăng tốc: tính theo thời điểm gửi đáp án cuối cùng
  state.answers[teamId] = { text, ms: Date.now() - state.qStart, verdict: null, pts: 0 };
  log('answer', { teamId, text });
  broadcast();
}

/* ------------------------------------------------------------------ JUDGE */
function judge(teamId, correct) {
  if (judgeCore(teamId, correct) === false) return;
  sfx(correct ? 'correct' : 'wrong');
  const last = state.qIndex === roundList().length - 1;
  if ((state.round === 'kdrieng' && last) || (state.round === 'khoidong' && last && correct)) {
    bed('stop');
    sfx('finish', { after: true });
  }
}
function judgeCore(teamId, correct) {
  teamId = Number(teamId);
  const r = state.round, q = currentQ(), b = state.buzzer, S = config.scoring;
  if (!team(teamId)) return false;
  const once = key => { if (state.judged.includes(key)) return false; state.judged.push(key); return true; };

  if (r === 'kdrieng') {
    // Lượt riêng: chỉ đội đang thi được chấm; đúng +10, sai hoặc bỏ qua 0 điểm
    if (teamId !== state.kdrieng.current || !q || !once('t' + teamId)) return false;
    if (correct) addScore(teamId, q.points || config.scoring.kdrieng.correct, 'Lượt riêng đúng');
    else log('judge', { teamId, correct: false, reason: 'Lượt riêng sai/bỏ qua' });
    haltTimer();
  } else if (r === 'khoidong' || r === 'phu') {
    if (!once('t' + teamId)) return false;
    if (correct) addScore(teamId, (q && q.points) || S.khoidong.correct, 'Trả lời đúng');
    else { addScore(teamId, -S.khoidong.wrong, 'Trả lời sai'); b.locked.push(teamId); }
    b.winner = null; haltTimer();
  } else if (r === 'vcnv') {
    if (b.purpose === 'keyword' && b.winner === teamId) {
      if (correct) {
        const opened = state.vcnv.rows.filter(s => s === 'open').length;
        const table = S.vcnv.keywordByRowsOpened;
        addScore(teamId, table[Math.min(opened, table.length - 1)], 'Giải từ khóa');
        state.vcnv.keyword = true;
        state.vcnv.tiles = state.vcnv.tiles.map(() => true);
      } else {
        state.vcnv.eliminated.push(teamId);
      }
      b.winner = null; haltTimer();
    } else {
      const a = state.answers[teamId];
      if (!a || a.verdict !== null) return false; // chỉ chấm một lần
      a.verdict = correct;
      if (correct) { a.pts = S.vcnv.row; addScore(teamId, S.vcnv.row, 'Hàng ngang đúng'); }
    }
  } else if (r === 'tangtoc') {
    const a = state.answers[teamId];
    if (!a || state.tangtocScored) return false;
    a.verdict = correct;
  } else if (r === 'vedich') {
    const vd = state.vedich, val = vd.value;
    if (!vd.q) return false;
    if (teamId === vd.current) {
      if (!once('t' + teamId)) return false;
      if (vd.star) team(teamId).starUsed = true;
      if (correct) addScore(teamId, val * (vd.star ? 2 : 1), vd.star ? 'Đúng + Ngôi sao hy vọng' : 'Về đích đúng');
      else if (vd.star) addScore(teamId, -val, 'Sai khi dùng Ngôi sao hy vọng');
      else log('judge', { teamId, correct });
      persist(); haltTimer();
    } else {
      // Đội khác giành quyền trả lời (bấm chuông cướp điểm hoặc MC cho trả lời): không khóa, chấm theo luật cướp điểm
      if (!once('s' + teamId)) return false;
      if (correct) {
        addScore(teamId, val, 'Cướp điểm thành công');
        addScore(vd.current, -val, 'Bị cướp điểm');
      } else {
        addScore(teamId, -Math.round(val * S.vedich.stealWrongRatio), 'Cướp điểm sai');
      }
      vd.stealing = false; b.winner = null; b.open = false; haltTimer();
    }
  }
  io.emit('judge', { teamId, correct });
}

/* ---------------------------------------------------------- ADMIN ACTIONS */
const A = {
  setMode({ mode }) {
    if (['PRACTICE', 'DEMO', 'OFFICIAL'].includes(mode)) { state.mode = mode; persist(); log('mode', { mode }); }
  },
  setRound({ round }) {
    if (!ROUND_NAMES[round]) return;
    haltTimer(); clearQuestion(); bed('stop');
    state.round = round; state.qIndex = -1; state.banner = '';
    if (round === 'vcnv') {
      state.vcnv = { rows: roundList('vcnv').map(() => 'hidden'), tiles: [false, false, false, false], keyword: false, kwOpen: [], eliminated: [] };
    }
    if (round === 'vedich') {
      const vd = state.vedich;
      vd.order = [...state.teams].sort((a, b) => a.score - b.score || a.id - b.id).map(t => t.id);
      vd.current = vd.order[0]; vd.value = 0; vd.q = null; vd.star = false; vd.stealing = false;
      vd.pkg = null; vd.screen = null;
    }
    if (round === 'kdrieng') state.kdrieng.current = state.teams[0].id;
    state.showTotal = false;
    log('round', { round });
    io.emit('round', { round, name: ROUND_NAMES[round] });
    io.to('led').emit('sfx-stop');
    io.to('led').emit('pkg', { cmd: 'close' });
    playIntro();
  },
  load({ index }) {
    index = Number(index);
    if (!roundList()[index]) return;
    haltTimer(); clearQuestion();
    state.qIndex = index;
    state.timer = { duration: roundList()[index].time || 0, remaining: (roundList()[index].time || 0) * 1000, running: false, label: '' };
    if (state.round === 'vcnv' && state.vcnv.rows[index] === 'hidden') state.vcnv.rows[index] = 'selected';
    sfx('select');
  },
  show() {
    if (!currentQ() || state.showQuestion || state.transitioning) return;
    revealQuestion();
  },
  // Bắt đầu: hiện câu hỏi (kèm chuyển cảnh nếu có) rồi mới chạy đồng hồ / mở chuông
  start() {
    const q = currentQ();
    if (!q || state.transitioning || state.timer.running) return;
    revealQuestion(() => beginQuestion(q));
  },
  pause() { pauseTimer(); },
  resume() { resumeTimer(); },
  stop() { haltTimer(); state.accepting = false; state.buzzer.open = false; },
  toggleAnswer() {
    state.showAnswer = !state.showAnswer;
    if (state.showAnswer) sfx('answer');
  },
  toggleReveal() {
    state.revealAnswers = !state.revealAnswers;
    if (state.revealAnswers) sfx('answers');
  },
  openBuzzer({ purpose }) {
    const locked = purpose === 'answer' ? state.buzzer.locked : [];
    openBuzzer(purpose || 'answer', locked);
  },
  resetBuzzer() { haltTimer(); state.buzzer = { open: false, winner: null, locked: [], purpose: null }; },
  judge({ teamId, correct }) { judge(teamId, !!correct); },
  adjust({ teamId, delta }) { addScore(teamId, Math.trunc(Number(delta)) || 0, 'Điều chỉnh thủ công'); },

  // Vượt chướng ngại vật
  revealRow({ row }) {
    if (state.vcnv.rows[row] === undefined) return;
    const tileWasClosed = !state.vcnv.tiles[row];
    state.vcnv.rows[row] = 'open';
    state.vcnv.tiles[row] = true;
    io.emit('reveal', { row });
    sfx('reveal');
    if (tileWasClosed) sfx('tile', { delay: 700 });
    log('revealRow', { row });
  },
  failRow({ row }) { if (state.vcnv.rows[row] !== undefined) state.vcnv.rows[row] = 'failed'; },
  revealTile({ tile }) {
    if (state.vcnv.tiles[tile] === undefined || state.vcnv.tiles[tile]) return;
    state.vcnv.tiles[tile] = true;
    io.emit('reveal', { tile });
    sfx('tile');
  },
  // Mở / đóng lại từng chữ cái của từ khóa (i = vị trí chữ, không tính khoảng trắng)
  revealKwLetter({ i }) {
    i = Number(i);
    const n = kwLetters().length;
    if (!(i >= 0 && i < n) || state.vcnv.keyword) return;
    const o = state.vcnv.kwOpen;
    if (o.includes(i)) { o.splice(o.indexOf(i), 1); return; }
    o.push(i);
    io.emit('reveal', { kwLetter: i });
    sfx('kwLetter');
    log('revealKwLetter', { text: kwLetters()[i] });
    // Mở đủ mọi chữ thì coi như đã công bố từ khóa
    if (o.length === n) {
      state.vcnv.keyword = true;
      state.vcnv.tiles = state.vcnv.tiles.map(() => true);
      sfx('keyword', { after: true });
    }
  },
  revealKeyword() {
    if (state.vcnv.keyword) return;
    state.vcnv.keyword = true;
    state.vcnv.tiles = state.vcnv.tiles.map(() => true);
    io.emit('reveal', { keyword: true });
    sfx('keyword');
    log('revealKeyword', {});
  },
  // Lật toàn bộ hình (không công bố từ khóa)
  revealPicture() {
    if (state.vcnv.tiles.every(Boolean)) return;
    state.vcnv.tiles = state.vcnv.tiles.map(() => true);
    io.emit('reveal', { picture: true });
    sfx('picture');
    log('revealPicture', {});
  },
  eliminate({ teamId }) {
    teamId = Number(teamId);
    const e = state.vcnv.eliminated;
    const i = e.indexOf(teamId);
    if (i >= 0) e.splice(i, 1); else e.push(teamId);
  },
  setEffect({ effect }) { if (['flip', 'fade', 'zoom', 'slide'].includes(effect)) state.effect = effect; },

  // Tăng tốc
  scoreTangtoc() {
    if (state.round !== 'tangtoc' || state.tangtocScored) return;
    const pts = config.scoring.tangtoc;
    const right = Object.entries(state.answers)
      .filter(([, a]) => a.verdict === true)
      .sort((a, b) => a[1].ms - b[1].ms);
    right.forEach(([id, a], i) => {
      a.pts = pts[i] || 0;
      addScore(id, a.pts, `Tăng tốc hạng ${i + 1}`);
    });
    state.tangtocScored = true;
    state.revealAnswers = true;
  },

  // Về đích
  vdCurrent({ teamId }) {
    const vd = state.vedich;
    if (!team(teamId)) return;
    haltTimer(); clearQuestion();
    vd.current = Number(teamId); vd.q = null; vd.value = 0; vd.star = false; vd.stealing = false;
    vd.pkg = null;
    if (vd.screen) { vd.screen = null; io.to('led').emit('pkg', { cmd: 'close' }); }
    sfx('turn');
  },
  // Màn hình chọn gói trên LED (bấm lần nữa để ẩn)
  vdChooseScreen() {
    const vd = state.vedich;
    if (vd.screen === 'choose') { vd.screen = null; io.to('led').emit('pkg', { cmd: 'close' }); io.to('led').emit('sfx-stop'); return; }
    haltTimer(); clearQuestion();
    vd.q = null; vd.value = 0; vd.star = false; vd.stealing = false;
    vd.screen = 'choose';
    const sc = (config.packageScreens || {}).choose || {};
    io.to('led').emit('pkg', { cmd: 'choose', src: sc.src || null, packages: pkgValues(),
      plans: pkgValues().map(k => ({ value: k, plan: pkgPlan(k) })), team: team(vd.current)?.name || '' });
    sfx('packages');
    sfx('choosing', { after: true });
  },
  // Chọn gói: lấy đủ câu theo cơ cấu gói, hiện ngay câu đầu tiên
  vdPackage({ value }) {
    const vd = state.vedich, key = String(Number(value));
    const plan = pkgPlan(key);
    if (!plan) return;
    const items = [];
    for (const v of plan) {
      const pool = (Q.vedich && Q.vedich[String(v)]) || [];
      vd.used[v] = vd.used[v] || [];
      const i = pool.findIndex((_, k) => !vd.used[v].includes(k) && !items.some(it => it.v === v && it.i === k));
      if (i < 0) { state.notice = `Không đủ câu ${v} điểm trong ngân hàng cho gói ${key}. Thêm câu ở Ngân hàng câu hỏi → Về đích ${v} điểm.`; return; }
      items.push({ v, i });
    }
    items.forEach(it => vd.used[it.v].push(it.i));
    haltTimer(); clearQuestion();
    vd.pkg = { value: Number(key), items, pos: 0 };
    vd.screen = null;
    loadVd(items[0].v, items[0].i);
    log('package', { teamId: vd.current, text: 'Gói ' + key });
    const sc = (config.packageScreens || {})[key] || {};
    io.to('led').emit('sfx-stop');
    io.to('led').emit('pkg', { cmd: 'chosen', value: Number(key), src: sc.src || null });
    if (!sc.src) sfx('packagePick');   // video chọn gói đã có tiếng riêng
    // Hiện câu hỏi ngay khi hiệu ứng chọn gói (2 gói kia ẩn, rồi gói được chọn ẩn) kết thúc
    const animSec = sc.src ? sc.sec : Number((config.packageScreens || {}).animSec ?? 2.6);
    // Trong lúc hiệu ứng chọn gói chạy, chặn Bắt đầu để câu hỏi không hiện dưới lớp hiệu ứng
    lockFor(animSec);
  },
  vdNext() {
    const vd = state.vedich, p = vd.pkg;
    if (!p || p.pos >= p.items.length - 1) return;
    haltTimer(); clearQuestion();
    p.pos++;
    loadVd(p.items[p.pos].v, p.items[p.pos].i);
  },
  // Câu lẻ (ngoài gói), dùng khi cần thay câu
  vdValue({ value }) {
    const vd = state.vedich, v = Number(value);
    const pool = (Q.vedich && Q.vedich[String(v)]) || [];
    vd.used[v] = vd.used[v] || [];
    const i = pool.findIndex((_, k) => !vd.used[v].includes(k));
    if (i < 0) { state.notice = `Hết câu ${v} điểm trong ngân hàng.`; return; }
    haltTimer(); clearQuestion();
    vd.used[v].push(i);
    vd.pkg = null;
    loadVd(v, i);
  },
  vdStar() {
    const vd = state.vedich, t = team(vd.current);
    if (!t || t.starUsed || !vd.q) return;
    vd.star = !vd.star;
    if (vd.star) { io.emit('star', { teamId: t.id }); sfx('star'); }
  },
  vdSteal() {
    const vd = state.vedich;
    if (!vd.q) return;
    vd.stealing = true;
    openBuzzer('steal', [vd.current]);
    startTimer(config.stealWindow, 'Cướp điểm', () => { state.buzzer.open = false; }, 'answer');
  },

  // Khởi động – lượt riêng
  kdTeam({ teamId }) {
    if (!team(teamId)) return;
    haltTimer(); clearQuestion(); bed('stop');
    state.kdrieng.current = Number(teamId); state.qIndex = -1;
    state.timer = { duration: 0, remaining: 0, running: false, label: '' };
    sfx('turn');
  },
  toggleTotal() {
    state.showTotal = !state.showTotal;
    if (state.showTotal) {
      io.emit('total'); log('total', {});
      const { v } = sndLookup('rank');
      sfx('total', { rank: Array.isArray(v) ? v.map(srcOf) : [] });
    } else io.to('led').emit('sfx-stop');
  },
  intro() { playIntro(); },
  skipIntro() { io.to('led').emit('intro-skip'); },
  programIntro() {
    if (!config.programIntro) return;
    io.to('led').emit('intro', { round: 'program', title: '', subtitle: '', video: config.programIntro, sound: null });
    log('programIntro', {});
  },
  // Bảng âm thanh: Admin phát tay bất kỳ file nào trong media/sound
  playSound({ file }) {
    if (!soundFiles().includes(file)) return;
    io.to('led').emit('sfx', { key: 'manual', src: srcOf(file) });
    log('sound', { text: file });
  },
  stopSound() { io.to('led').emit('sfx-stop'); io.to('led').emit('music', { cmd: 'stop' }); bed('stop'); },

  banner({ text }) { state.banner = String(text || '').slice(0, 120); },
  media({ cmd }) { io.to('led').emit('media', { cmd }); },
  reloadQuestions() { Q = readJSON(QFILE); log('reload', {}); io.to('admin').emit('bank', Q); },
  resetGame({ password }) {
    if (state.mode === 'OFFICIAL' && password !== config.adminPassword) { state.banner = ''; return; }
    haltTimer(); cancelTransition(); bed('stop');
    const mode = state.mode;
    state = freshState(); state.mode = mode;
    persist(); log('reset', {});
  }
};

function beginQuestion(q) {
  state.answers = {};
  state.qStart = Date.now();
  const r = state.round;
  if (r === 'kdrieng') {
    startTimer(q.time || 10, 'Suy nghĩ');
    bed('run');
  } else if (r === 'khoidong' || r === 'phu') {
    openBuzzer('answer');
    startTimer(q.time || 10, 'Bấm chuông', () => { state.buzzer.open = false; });
    if (r === 'khoidong') bed('run');
  } else if (r === 'vcnv' || r === 'tangtoc') {
    state.accepting = true;
    startTimer(q.time || 10, 'Trả lời', () => { state.accepting = false; });
  } else if (r === 'vedich') {
    startTimer(q.time || 15, 'Trả lời');
  }
  io.to('led').emit('media', { cmd: 'play' });
  log('start', {});
}

// Về đích: cơ cấu gói và nạp một câu
function pkgPlan(key) {
  const p = (config.vedichPackages || {})[String(key)];
  return Array.isArray(p) && p.length ? p.map(Number) : null;
}
function pkgValues() {
  return Object.keys(config.vedichPackages || {}).filter(k => !k.startsWith('_') && pkgPlan(k)).map(Number);
}
function loadVd(v, i) {
  const vd = state.vedich;
  vd.q = { ...Q.vedich[String(v)][i], points: v };
  vd.value = v; vd.star = false; vd.stealing = false;
  state.qIndex = vd.count++;
  state.timer = { duration: vd.q.time || 15, remaining: (vd.q.time || 15) * 1000, running: false, label: '' };
}

/* ---------------------------------------------------------- QUESTION BANK */
const QFILE = path.join(DATA, 'questions.json');
const MEDIA_DIRS = {
  image: { dir: 'images', ext: ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg'] },
  video: { dir: 'video', ext: ['.mp4', '.webm'] },
  audio: { dir: 'audio', ext: ['.mp3', '.wav', '.ogg'] }
};
const SECTION_NAMES = {
  'kdrieng:1': 'Lượt riêng – Đội 1', 'kdrieng:2': 'Lượt riêng – Đội 2', 'kdrieng:3': 'Lượt riêng – Đội 3', 'kdrieng:4': 'Lượt riêng – Đội 4',
  khoidong: 'Khởi động – Lượt chung', vcnv: 'Vượt chướng ngại vật', tangtoc: 'Tăng tốc',
  'vedich:10': 'Về đích 10 điểm', 'vedich:20': 'Về đích 20 điểm', 'vedich:30': 'Về đích 30 điểm', phu: 'Câu hỏi phụ'
};

function saveQ() {
  // Giữ bản trước đó làm dự phòng, ghi qua file tạm để không hỏng file khi mất điện giữa chừng
  if (fs.existsSync(QFILE)) fs.copyFileSync(QFILE, path.join(DATA, 'questions.bak.json'));
  const tmp = QFILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(Q, null, 2));
  fs.renameSync(tmp, QFILE);
}
function sectionArr(section) {
  if (['khoidong', 'tangtoc', 'phu'].includes(section)) return (Q[section] = Q[section] || []);
  if (section === 'vcnv') { Q.vcnv = Q.vcnv || { image: '', keyword: '', rows: [] }; return (Q.vcnv.rows = Q.vcnv.rows || []); }
  const k = /^kdrieng:([1-9])$/.exec(section || '');
  if (k) { Q.kdrieng = Q.kdrieng || {}; return (Q.kdrieng[k[1]] = Q.kdrieng[k[1]] || []); }
  const m = /^vedich:(10|20|30)$/.exec(section || '');
  if (m) { Q.vedich = Q.vedich || {}; return (Q.vedich[m[1]] = Q.vedich[m[1]] || []); }
  return null;
}
function fail(msg) { throw new Error(msg); }
function cleanMediaSrc(src) {
  src = String(src || '').trim();
  if (!src) return '';
  if (!src.startsWith('/media/') || src.includes('..')) fail('Đường dẫn media phải bắt đầu bằng /media/.');
  return src;
}
function cleanQ(section, d = {}) {
  const text = String(d.text || '').trim().slice(0, 1000);
  const answer = String(d.answer || '').normalize('NFC').trim().slice(0, 300);
  if (!text) fail('Nội dung câu hỏi không được để trống.');
  if (!answer) fail('Đáp án không được để trống.');
  const time = Math.round(Number(d.time));
  if (!(time >= 1 && time <= 600)) fail('Thời gian phải từ 1 đến 600 giây.');
  const q = { text, answer, time };
  if (section === 'vcnv') {
    q.answer = answer.toUpperCase().replace(/\s+/g, ' ');
    if (!/^[\p{L}\p{N} ]+$/u.test(q.answer)) fail('Đáp án hàng ngang chỉ gồm chữ, số và khoảng trắng.');
  }
  if (section === 'khoidong' || section === 'phu' || /^kdrieng:/.test(section)) {
    const pts = Math.round(Number(d.points));
    if (!(pts >= 1 && pts <= 1000)) fail('Điểm phải từ 1 đến 1000.');
    q.points = pts;
  }
  if (d.media && d.media.type && d.media.src) {
    if (!MEDIA_DIRS[d.media.type]) fail('Loại media không hợp lệ.');
    q.media = { type: d.media.type, src: cleanMediaSrc(d.media.src) };
  }
  return q;
}
const isLive = section =>
  (['khoidong', 'tangtoc', 'phu', 'vcnv'].includes(section) && state.round === section) ||
  (state.round === 'kdrieng' && section === 'kdrieng:' + state.kdrieng.current);

const BANK = {
  add({ section, data }) {
    if (section === 'vcnv') fail('Vượt chướng ngại vật cố định 4 hàng ngang — chỉ sửa, không thêm.');
    const arr = sectionArr(section) || fail('Phần thi không hợp lệ.');
    arr.push(cleanQ(section, data));
    return `Thêm câu ${arr.length} vào ${SECTION_NAMES[section]}`;
  },
  update({ section, index, data }) {
    const arr = sectionArr(section) || fail('Phần thi không hợp lệ.');
    if (!arr[index]) fail('Không tìm thấy câu hỏi.');
    const q = cleanQ(section, data);
    // Sửa trực tiếp object để câu đang chiếu cập nhật ngay
    for (const k of Object.keys(arr[index])) delete arr[index][k];
    Object.assign(arr[index], q);
    return `Sửa câu ${index + 1} ${SECTION_NAMES[section]}`;
  },
  delete({ section, index }) {
    if (section === 'vcnv') fail('Vượt chướng ngại vật cố định 4 hàng ngang — chỉ sửa, không xóa.');
    const arr = sectionArr(section) || fail('Phần thi không hợp lệ.');
    if (!arr[index]) fail('Không tìm thấy câu hỏi.');
    if (isLive(section) && state.qIndex === index) fail('Câu này đang được chọn trên sân khấu. Chọn câu khác trước khi xóa.');
    arr.splice(index, 1);
    if (isLive(section) && state.qIndex > index) state.qIndex--;
    const v = section.split(':')[1];
    if (v) state.vedich.used[v] = (state.vedich.used[v] || []).filter(i => i !== index).map(i => (i > index ? i - 1 : i));
    return `Xóa câu ${index + 1} ${SECTION_NAMES[section]}`;
  },
  move({ section, index, dir }) {
    if (section === 'vcnv') fail('Không đổi thứ tự hàng ngang vì mỗi hàng gắn với một ô hình.');
    const arr = sectionArr(section) || fail('Phần thi không hợp lệ.');
    const j = index + (dir < 0 ? -1 : 1);
    if (!arr[index] || !arr[j]) return null;
    [arr[index], arr[j]] = [arr[j], arr[index]];
    if (isLive(section)) {
      if (state.qIndex === index) state.qIndex = j; else if (state.qIndex === j) state.qIndex = index;
    }
    const v = section.split(':')[1];
    if (v) state.vedich.used[v] = (state.vedich.used[v] || []).map(i => (i === index ? j : i === j ? index : i));
    return `Đổi thứ tự câu ${index + 1} ↔ ${j + 1} ${SECTION_NAMES[section]}`;
  },
  vcnvMeta({ keyword, image }) {
    sectionArr('vcnv');
    const kw = String(keyword || '').normalize('NFC').trim().toUpperCase().replace(/\s+/g, ' ');
    if (!kw) fail('Từ khóa không được để trống.');
    if (!/^[\p{L}\p{N} ]+$/u.test(kw)) fail('Từ khóa chỉ gồm chữ, số và khoảng trắng.');
    Q.vcnv.keyword = kw;
    state.vcnv.kwOpen = [];   // đổi từ khóa thì các chữ đã mở không còn đúng vị trí
    Q.vcnv.image = cleanMediaSrc(image);
    return 'Sửa từ khóa và hình Vượt chướng ngại vật';
  }
};

/* Media: upload và liệt kê — chỉ admin */
const adminOnly = (req, res, next) =>
  req.get('x-admin-password') === config.adminPassword ? next() : res.status(401).json({ error: 'Cần đăng nhập quản trị.' });

app.get('/api/media', adminOnly, (req, res) => {
  const out = {};
  for (const [type, { dir, ext }] of Object.entries(MEDIA_DIRS)) {
    const full = path.join(ROOT, 'media', dir);
    fs.mkdirSync(full, { recursive: true });
    out[type] = fs.readdirSync(full).filter(f => ext.includes(path.extname(f).toLowerCase())).sort().map(f => `/media/${dir}/${f}`);
  }
  res.json(out);
});

app.post('/api/media/:type', adminOnly, express.raw({ type: () => true, limit: '500mb' }), (req, res) => {
  const spec = MEDIA_DIRS[req.params.type];
  if (!spec) return res.status(400).json({ error: 'Loại media không hợp lệ.' });
  const orig = String(req.query.name || 'file');
  const ext = path.extname(orig).toLowerCase();
  if (!spec.ext.includes(ext)) return res.status(400).json({ error: `Chỉ nhận ${spec.ext.join(', ')}.` });
  if (!req.body || !req.body.length) return res.status(400).json({ error: 'File rỗng.' });
  const base = path.basename(orig, path.extname(orig)).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'file';
  const dir = path.join(ROOT, 'media', spec.dir);
  fs.mkdirSync(dir, { recursive: true });
  let name = base + ext, n = 1;
  while (fs.existsSync(path.join(dir, name))) name = `${base}-${n++}${ext}`;
  fs.writeFileSync(path.join(dir, name), req.body);
  log('upload', { text: name });
  res.json({ src: `/media/${spec.dir}/${name}` });
});

/* ------------------------------------------------------------------- VIEW */
function view(role, teamId) {
  const q = currentQ(), admin = role === 'admin';
  const online = new Set();
  for (const s of io.sockets.sockets.values()) if (s.data.role === 'team') online.add(s.data.teamId);

  const v = {
    role, teamId,
    mode: state.mode,
    teams: state.teams.map(t => ({
      ...t, online: online.has(t.id),
      partScore: t.parts[PART[state.round]] || 0,
      // LED và máy đội chỉ thấy điểm tổng sau khi Admin công bố
      score: (admin || state.showTotal) ? t.score : null
    })),
    ranking: (admin || state.showTotal)
      ? [...state.teams].sort((a, b) => b.score - a.score || a.id - b.id).map(t => ({ id: t.id, name: t.name, score: t.score }))
      : null,
    round: state.round, roundName: ROUND_NAMES[state.round],
    qIndex: state.qIndex, qCount: state.round === 'vedich' ? null : roundList().length,
    showQuestion: state.showQuestion, showAnswer: state.showAnswer, revealAnswers: state.revealAnswers,
    timer: { ...state.timer },
    buzzer: { ...state.buzzer },
    accepting: state.accepting,
    banner: state.banner, effect: state.effect,
    tangtocScored: state.tangtocScored,
    part: PART[state.round] || null, partName: PART_NAMES[PART[state.round]] || '',
    showTotal: state.showTotal,
    kdrieng: state.round === 'kdrieng' ? { current: state.kdrieng.current, bedOn: state.kdrieng.bedOn } : null,
    transitioning: state.transitioning,
    q: null, answers: {}
  };
  if (q && (admin || state.showQuestion)) {
    v.q = { text: q.text, media: q.media || null, time: q.time, points: q.points };
    if (admin || state.showAnswer) v.q.answer = q.answer;
  }
  if (admin || (role === 'led' && state.revealAnswers)) v.answers = state.answers;
  else if (role === 'team' && state.answers[teamId]) v.answers = { [teamId]: state.answers[teamId] };

  if (state.round === 'vcnv' && Q.vcnv) {
    v.vcnv = {
      image: Q.vcnv.image,
      tiles: state.vcnv.tiles,
      eliminated: state.vcnv.eliminated,
      keywordPattern: pattern(Q.vcnv.keyword),
      keyword: (admin || state.vcnv.keyword) ? Q.vcnv.keyword : null,
      keywordSolved: state.vcnv.keyword,
      skin: config.vcnvSkin || {},
      kwOpen: [...state.vcnv.kwOpen],
      // Chữ cái đã mở (LED chỉ nhận đúng các chữ đã mở, chữ chưa mở để trống)
      kwLetters: kwLetters().map((ch, i) => (admin || state.vcnv.keyword || state.vcnv.kwOpen.includes(i)) ? ch : ''),
      rows: Q.vcnv.rows.map((r, i) => ({
        status: state.vcnv.rows[i],
        pattern: pattern(r.answer),
        answer: (admin || state.vcnv.rows[i] === 'open') ? r.answer : null
      }))
    };
  }
  if (state.round === 'vedich') {
    const { order, current, value, star, stealing, pkg, screen } = state.vedich;
    v.vedich = {
      order, current, value, star, stealing, screen,
      pkg: pkg ? { value: pkg.value, pos: pkg.pos, len: pkg.items.length, values: pkg.items.map(it => it.v) } : null
    };
  }
  if (admin) {
    v.list = state.round === 'vedich'
      ? []
      : roundList().map((x, i) => ({ i, text: x.text, answer: x.answer, media: x.media ? x.media.type : null }));
    v.vedichPool = Object.fromEntries(Object.entries(Q.vedich || {}).map(([k, arr]) =>
      [k, arr.length - ((state.vedich.used[k] || []).length)]));
    v.history = state.history;
    v.ips = lanIPs(); v.port = PORT;
    v.sounds = soundFiles();
    v.hasProgramIntro = !!config.programIntro;
    v.notice = state.notice || '';
    v.packages = pkgValues().map(k => ({ value: k, plan: pkgPlan(k) }));
  }
  return v;
}

function broadcast() {
  for (const s of io.sockets.sockets.values()) {
    if (s.data.role) s.emit('state', view(s.data.role, s.data.teamId));
  }
}

/* ----------------------------------------------------------------- SOCKET */
io.on('connection', s => {
  s.on('hello', (p = {}, ack = () => {}) => {
    if (p.role === 'admin') {
      if (p.password !== config.adminPassword) return ack({ ok: false, error: 'Mật khẩu quản trị không đúng.' });
      s.data.role = 'admin'; s.join('admin');
      s.emit('bank', Q);
    } else if (p.role === 'led') {
      s.data.role = 'led'; s.join('led');
      s.emit('preload', preloadList());
    } else if (p.role === 'team') {
      const id = Number(p.teamId), t = config.teams[id - 1];
      if (!t) return ack({ ok: false, error: 'Không có đội này.' });
      if (String(p.pin) !== String(t.pin)) return ack({ ok: false, error: 'Mã PIN không đúng.' });
      s.data.role = 'team'; s.data.teamId = id; s.join('team:' + id);
    } else return ack({ ok: false, error: 'Vai trò không hợp lệ.' });
    ack({ ok: true, role: s.data.role, teamId: s.data.teamId });
    broadcast();
  });

  s.on('admin', a => {
    if (s.data.role !== 'admin' || !a || typeof A[a.type] !== 'function') return;
    state.notice = '';
    try { A[a.type](a); } catch (e) { console.error('Admin action lỗi:', a.type, e); }
    broadcast();
  });
  s.on('bank', (op = {}, ack = () => {}) => {
    if (s.data.role !== 'admin') return ack({ ok: false, error: 'Cần đăng nhập quản trị.' });
    if (typeof BANK[op.op] !== 'function') return ack({ ok: false, error: 'Thao tác không hợp lệ.' });
    try {
      const msg = BANK[op.op](op);
      if (msg) { saveQ(); log('bank', { text: msg }); }
      ack({ ok: true, message: msg });
      io.to('admin').emit('bank', Q);
      broadcast();
    } catch (e) {
      ack({ ok: false, error: e.message });
    }
  });
  s.on('buzz', () => { if (s.data.role === 'team') onBuzz(s.data.teamId); });
  s.on('answer', p => { if (s.data.role === 'team') onAnswer(s.data.teamId, p && p.text); });
  s.on('disconnect', () => broadcast());
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = lanIPs();
  const base = ips.length ? ips.map(ip => `http://${ip}:${PORT}`) : [`http://localhost:${PORT}`];
  console.log('\n  OLYMPIA APP – O LAN đang chạy\n');
  for (const b of base) {
    console.log(`  Quản trị : ${b}/admin`);
    console.log(`  Màn LED  : ${b}/led`);
    console.log(`  Đội 1–${config.teams.length} : ${b}/team/1 … /team/${config.teams.length}\n`);
  }
});
