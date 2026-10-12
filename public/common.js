/* OLYMPIA APP – O LAN · shared client helpers */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, root = document) => root.querySelector(sel);

/* Âm thanh tổng hợp bằng Web Audio — không cần file, chạy offline */
const Sound = (() => {
  let ctx = null, muted = false;
  const ac = () => {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  };
  function tone(freq, dur, type = 'sine', vol = .2, when = 0) {
    if (muted) return;
    const a = ac(), o = a.createOscillator(), g = a.createGain(), t = a.currentTime + when;
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + .01);
    g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g).connect(a.destination);
    o.start(t); o.stop(t + dur + .05);
  }
  return {
    unlock: () => ac(),
    setMuted: m => { muted = m; },
    buzz() { tone(880, .15, 'square', .25); tone(1320, .4, 'square', .2, .12); },
    correct() { [523, 659, 784, 1047].forEach((f, i) => tone(f, .28, 'triangle', .25, i * .09)); },
    wrong() { tone(220, .45, 'sawtooth', .18); tone(165, .55, 'sawtooth', .16, .2); },
    tick() { tone(1000, .05, 'square', .07); },
    timeup() { tone(440, .9, 'square', .18); },
    reveal() { [392, 523, 659, 784, 1047].forEach((f, i) => tone(f, .45, 'sine', .16, i * .06)); },
    intro() {
      [262, 330, 392, 523, 659, 784].forEach((f, i) => tone(f, .5, 'sawtooth', .07, i * .1));
      tone(65, 1.6, 'sine', .35, .7); tone(1047, 1.4, 'triangle', .14, 1.0); tone(1568, 1.2, 'triangle', .08, 1.1);
    },
    star() { [784, 988, 1175, 1568].forEach((f, i) => tone(f, .35, 'triangle', .18, i * .08)); }
  };
})();

function mediaHTML(m, { autoplay = false, muted = false, controls = false } = {}) {
  if (!m || !m.src) return '';
  const src = esc(m.src);
  if (m.type === 'image') return `<img class="q-media" src="${src}" alt="Hình ảnh câu hỏi">`;
  if (m.type === 'video') return `<video class="q-media" src="${src}" playsinline ${autoplay ? 'autoplay' : ''} ${muted ? 'muted' : ''} ${controls ? 'controls' : ''}></video>`;
  if (m.type === 'audio') return `<div class="q-audio">🔊 Câu hỏi âm thanh<audio src="${src}" ${autoplay ? 'autoplay' : ''} ${controls ? 'controls' : ''}></audio></div>`;
  return '';
}

/* Ô chữ theo mẫu độ dài từng từ; answer = null thì để trống */
function boxesHTML(pattern, answer, cls = '') {
  const words = answer ? String(answer).normalize('NFC').trim().split(/\s+/) : null;
  const html = (pattern || []).map((len, wi) => {
    const chars = words ? [...words[wi] || ''] : [];
    return Array.from({ length: len }, (_, i) => `<span class="b">${esc(chars[i] || '')}</span>`).join('');
  }).join('<span class="gap"></span>');
  return `<span class="boxes ${cls ? 'st-' + cls : ''}">${html}</span>`;
}

const secs = ms => Math.max(0, Math.ceil((ms || 0) / 1000));

/* Tên cuộc thi, khẩu hiệu, logo lấy từ config.json (mục competition):
   phần tử có data-brand="name|slogan" nhận chữ, <img data-brand="logo|logoSmall"> nhận ảnh. */
const Brand = { name: '', slogan: '', logo: '/media/images/logo.png', logoSmall: '/media/images/logo-256.png', favicon: '/media/images/logo-64.png' };
function applyBrand(root = document) {
  root.querySelectorAll('[data-brand]').forEach(el => {
    const v = Brand[el.dataset.brand];
    if (!v) return;
    if (el.tagName === 'IMG') { if (el.getAttribute('src') !== v) el.src = v; }
    else el.textContent = v;
  });
}
const brandReady = fetch('/api/info').then(r => r.json()).then(info => {
  Object.assign(Brand, Object.fromEntries(Object.entries(info.competition || {}).filter(([k, v]) => !k.startsWith('_') && v)));
  let ic = document.querySelector('link[rel="icon"]');
  if (!ic) { ic = document.createElement('link'); ic.rel = 'icon'; document.head.appendChild(ic); }
  ic.href = Brand.favicon;
  applyBrand();
  return info;
}).catch(() => null);
