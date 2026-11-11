// 入口：装配各模块、菜单界面、游戏流程与主循环。
import * as THREE from 'three';
import { createAudio } from './audio.js';
import { createSequencer, createClock } from './music.js';
import { SONGS, LOBBY, MODES, DIFFS, prepareSong, songSeconds } from './songs.js';
import { createGame } from './game.js';
import { createDancer } from './character.js';
import { loadDoubaoHead, DOUBAO_AVATAR } from './dbhead.js';
import { createAnimator, choreoFor, FREE_POSES, MOVES } from './dance.js';
import { createStage } from './stage.js';
import { createRender, pickQuality } from './render.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';
import { clamp, emitter, fmtScore, rng } from './util.js';

const $ = (id) => document.getElementById(id);
window.__errors = [];
window.__ready = false;
window.addEventListener('error', (e) => window.__errors.push(String(e.message || e)));
window.addEventListener('unhandledrejection', (e) => window.__errors.push('promise: ' + String((e.reason && e.reason.message) || e.reason)));

function fatal(err) {
  const msg = String((err && err.stack) || err);
  console.error('[fatal] ' + msg);
  window.__errors.push(msg);
  const el = $('fatal');
  el.textContent = '出错了：' + msg;
  el.classList.remove('hidden');
}

// ---------------------------------------------------------------- 存档
const STORE_KEY = 'doubao-dance.v1';
const DEFAULTS = { settings: { music: 0.8, sfx: 0.85, offset: 0, quality: 'auto' }, best: {}, last: { song: 'cream', mode: 'show', diff: 'easy' } };
function loadStore() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    return { settings: { ...DEFAULTS.settings, ...(raw.settings || {}) }, best: raw.best || {}, last: { ...DEFAULTS.last, ...(raw.last || {}) } };
  } catch (e) {
    return JSON.parse(JSON.stringify(DEFAULTS));
  }
}
function saveStore(store) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch (e) {
    /* 隐私模式下写不进去就算了 */
  }
}

const DIFF_HINT = { easy: '序列最长 6 键，没有反键，音符稀疏', normal: '序列最长 8 键，偶尔出现反键', hard: '序列最长 9 键，反键更多，音符更密' };
const GRADE_SAY = {
  SS: '零失误！这支舞我要存进收藏夹，循环播放一百遍。',
  S: '太丝滑了，几乎每一拍都踩在点上！',
  A: '很稳！再多几个 Perfect，S 级就是你的。',
  B: '节奏感在线。等节拍圈和目标圈重合的那一下再出手，会更准。',
  C: '别急，先在心里数 1、2、3，第 4 拍再按下去。',
  D: '没关系，谁都有手忙脚乱的时候。换个简单难度热热身，我陪你再来一次。',
};

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

async function boot() {
  const params = Object.fromEntries(new URLSearchParams(location.search));
  const store = loadStore();
  const bootMsg = $('bootMsg');
  const bootFill = $('bootFill');
  const step = async (msg, p) => {
    bootMsg.textContent = msg;
    bootFill.style.width = Math.round(p * 100) + '%';
    await nextFrame();
  };

  // ------------------------------------------------------------ 渲染与舞台
  await step('正在点亮舞台灯光', 0.08);
  const quality = pickQuality(params.q || (store.settings.quality !== 'auto' ? store.settings.quality : ''));
  const R = createRender($('view'), quality);
  const stage = createStage(R.scene, { reflect: quality.reflect, reflectSize: quality.reflectSize, crowd: quality.crowd, particles: quality.particles });

  await step('正在给豆包梳头发', 0.34);
  const IDS = ['doubao', 'naihuang', 'matcha', 'zhima'];
  const SPOTS = [
    [0, 0, 0.9],
    [-1.95, 0, -0.5],
    [1.95, 0, -0.5],
    [0, 0, -1.95],
  ];
  const dancers = [];
  const animators = [];
  // 官方头像贴图解码失败时退回几何体拼的头，游戏照常能玩
  let headAssets = null;
  try {
    headAssets = await loadDoubaoHead();
  } catch (e) {
    console.warn('[boot] 豆包头部贴图载入失败，使用备用头部', e);
  }
  if (headAssets) {
    for (const el of document.querySelectorAll('.avatar')) {
      el.textContent = '';
      el.classList.add('img');
      el.style.backgroundImage = `url(${DOUBAO_AVATAR})`;
    }
    const icon = document.querySelector('link[rel="icon"]');
    if (icon) icon.href = DOUBAO_AVATAR;
  }
  for (let i = 0; i < IDS.length; i++) {
    const d = createDancer(IDS[i], { outline: i === 0 || quality.rivalOutline, faceSize: i === 0 ? 512 : 256, officialHead: i === 0 ? headAssets : null });
    d.root.position.set(SPOTS[i][0], SPOTS[i][1], SPOTS[i][2]);
    if (i > 0) d.root.scale.setScalar(0.97);
    R.scene.add(d.root);
    stage.addShadow(d);
    dancers.push(d);
    animators.push(createAnimator(d));
    if (i % 2 === 1) await nextFrame();
  }
  const doubao = dancers[0];

  await step('正在调试合成器', 0.62);
  const audio = createAudio({ mute: !!params.mute });
  audio.setVolumes(store.settings);
  const seq = createSequencer(audio);
  const clock = createClock(audio);
  clock.offset = (store.settings.offset || 0) / 1000;
  if (params.ts) clock.scale = +params.ts;
  SONGS.forEach(prepareSong);
  const events = emitter();
  const game = createGame({ clock, events });

  await step('正在排练舞步', 0.82);
  const hud = createHud($('hud'));
  const rand = rng(Date.now() & 0xffff);
  const levels = { bass: 0, spectrum: new Float32Array(32) };
  const tmpV = new THREE.Vector3();
  const focus = new THREE.Vector3(0, 0, 0.9);

  let state = 'boot';
  let cur = { song: SONGS.find((s) => s.id === store.last.song) || SONGS[0], mode: MODES[store.last.mode] ? store.last.mode : 'show', diff: DIFFS[store.last.diff] ? store.last.diff : 'easy' };
  let lobbyOn = false;
  let countFrom = 0;
  let overlayFrom = 'title';
  let lastResult = null;
  let showcaseBar = -1;
  let resultsAt = 0;
  let lastSegType = '';
  const timers = [];
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  const clearTimers = () => {
    while (timers.length) clearTimeout(timers.pop());
  };

  // ------------------------------------------------------------ 界面切换
  // starting：等音频解锁；resuming：暂停后继续前的倒数
  const inGame = () => state === 'playing' || state === 'paused' || state === 'starting' || state === 'resuming';
  // 每次切换流程都加一，异步等待回来后发现对不上就放弃，避免连点造成状态错乱
  let flow = 0;
  const SCREENS = ['title', 'select', 'help', 'settings', 'pause', 'results'];
  function show(name) {
    for (const s of SCREENS) $(s).classList.toggle('hidden', s !== name);
    $('top').classList.toggle('hidden', !inGame());
  }
  // 和 style.css 里的媒体查询是同一条规则：手机竖屏和竖屏平板都走这套布局
  function portrait() {
    return R.width <= 760 || R.aspect < 0.85;
  }
  function applyCamera() {
    const d = R.director;
    // 标题页只留豆包一个人：对手的站位正好在标题和按钮后面
    for (let i = 1; i < dancers.length; i++) dancers[i].root.visible = state !== 'title';
    if (state === 'title') {
      d.stopSequence();
      d.set('title');
      R.setShift(portrait() ? 0 : 0.2, portrait() ? 0.14 : 0);
    } else if (state === 'select') {
      d.stopSequence();
      d.set('select');
      R.setShift(0, 0);
    } else if (state === 'results') {
      d.stopSequence();
      d.set('results');
      // 竖屏的结算面板从底部升起来，把主角往上让到面板上方
      R.setShift(portrait() ? 0 : 0.24, portrait() ? 0.34 : 0);
    } else if (inGame()) {
      R.setShift(0, playShift());
    }
  }
  // 游戏中把画面上移给操作区让位；节拍轨道更高，需要多让一点
  function playShift() {
    return (portrait() || hud.touch ? 0.17 : 0.15) + (hud.noteA > 0.5 ? 0.1 : 0);
  }

  // 豆包的气泡
  let bubbleT = 0;
  let bubbleCool = 0;
  function say(text, force = false) {
    if (!force && bubbleCool > 0) return;
    // 窄屏上横幅和气泡挤在同一块位置，横幅优先
    if (portrait() && hud.bannerActive()) return;
    $('bubbleText').textContent = text;
    const el = $('bubble');
    el.classList.remove('hidden');
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    bubbleT = 2.8;
    bubbleCool = 5;
  }

  // ------------------------------------------------------------ 大厅
  let lobbyBusy = false;
  async function startLobby() {
    if (lobbyOn || lobbyBusy || inGame()) return;
    lobbyBusy = true;
    try {
      await audio.resume();
    } finally {
      lobbyBusy = false;
    }
    // 等音频解锁的这一小会儿里，玩家可能已经点了开局
    if (lobbyOn || inGame()) return;
    audio.duck(1, 0.3);
    prepareSong(LOBBY);
    stage.setPalette(LOBBY.palette);
    stage.setLogo('豆包炫舞', 'DOUBAO  DANCE');
    stage.setMode(state === 'results' ? 'results' : 'lobby');
    const t0 = clock.start(LOBBY.bpm, 0.12);
    seq.play(LOBBY, t0, { loop: true });
    lobbyOn = true;
  }

  function resetDancers() {
    for (let i = 0; i < dancers.length; i++) {
      animators[i].setMove('idle', 0.5);
      animators[i].energy = 1;
      dancers[i].setExpr('smile');
    }
  }

  // ------------------------------------------------------------ 开始一局
  async function startGame(song, mode, diff) {
    const my = ++flow;
    clearTimers();
    seq.stop();
    lobbyOn = false;
    state = 'starting';
    input.playing = false;
    cur = { song, mode, diff };
    store.last = { song: song.id, mode, diff };
    saveStore(store);
    show(null);
    await audio.resume();
    if (my !== flow) return;
    audio.duck(1, 0.05);
    prepareSong(song);
    game.start(song, mode, diff, { auto: !!params.auto, autoSkill: params.skill == null ? 1 : +params.skill, seed: (Date.now() & 0xfffff) + 7 });
    game.finalDone = false;
    lastSegType = '';
    state = 'playing';
    input.playing = true;
    show(null);
    hud.clear();
    resetDancers();
    stage.fever = 0;
    stage.setPalette(song.palette);
    stage.setLogo(song.title, song.en);
    stage.setMode('intro');
    R.director.sequence('intro');
    applyCamera();
    $('songName').textContent = song.title;
    $('modeLabel').textContent = `${MODES[mode].name} · ${DIFFS[diff].name}`;
    $('secLabel').textContent = '前奏';
    // 倒数落在第一段玩法开始前的四拍
    const firstRound = game.chart.rounds[0];
    const firstNote = game.chart.notes[0];
    const a = firstRound ? firstRound.hitBeat - 3 : Infinity;
    const b = firstNote ? firstNote.beat : Infinity;
    countFrom = Math.min(a, b) - 4;
    const t0 = clock.start(song.bpm, 1.1);
    seq.play(song, t0);
    say(mode === 'beat' ? '音符到线上再按，跟着旋律走！' : '先敲方向键，第 4 拍再踩，交给我们！', true);
  }

  function pauseGame() {
    if (state !== 'playing') return;
    state = 'paused';
    input.playing = false;
    clock.pause();
    show('pause');
    $('btnResume').focus();
  }
  // 继续之前倒数三下，给玩家把手放回键位的时间
  function resumeGame() {
    if (state !== 'paused') return;
    const my = ++flow;
    state = 'resuming';
    show(null);
    const tick = (n) => {
      if (my !== flow) return;
      if (n > 0) {
        hud.banner(String(n), { dur: 0.5, size: 1.15, y: 0.2, replace: true, color2: '#9fc0ff' });
        setTimeout(() => tick(n - 1), 430);
        return;
      }
      clock.resume().then(() => {
        if (my !== flow) return;
        state = 'playing';
        input.playing = true;
      });
    };
    tick(3);
  }
  // 倒数途中切到后台：回到暂停菜单
  function cancelResume() {
    if (state !== 'resuming') return;
    flow++;
    state = 'paused';
    clock.pause();
    show('pause');
  }
  async function quitToSelect() {
    flow++;
    clearTimers();
    seq.stop();
    game.stop();
    hud.clear();
    state = 'select';
    input.playing = false;
    stage.fever = 0;
    resetDancers();
    buildSelect();
    show('select');
    applyCamera();
    await startLobby();
  }

  // ------------------------------------------------------------ 游戏事件 → 表现
  const chestOf = (i, out) => dancers[i].joints.chest.getWorldPosition(out);
  const prevCombo = [0, 0, 0, 0];

  events.on('judge', (e) => {
    const an = animators[e.who];
    const d = dancers[e.who];
    const hadCombo = prevCombo[e.who] || 0;
    prevCombo[e.who] = e.combo;
    if (e.kind === 'miss') {
      // 舞步失误必踉跄；节拍模式只有断掉一段像样的连击才踉跄，否则只是皱个眉
      if (e.src === 'seq' || hadCombo >= 10) an.strike('stumble', 1.8, game.beat);
      d.setExpr('oops', e.src === 'seq' ? 1.1 : 0.6, true);
    } else if (e.kind === 'perfect' && e.src === 'seq') {
      d.setExpr(e.who % 2 ? 'wink' : 'happy', 1.0, true);
    }
    if (!e.me) return;
    hud.popJudge(e.kind, e);
    if (e.src === 'seq') audio.sfx.judge(e.kind);
    else if (e.kind !== 'miss') audio.sfx.tap(e.kind);
    if (e.kind === 'perfect' || e.kind === 'great') {
      chestOf(0, tmpV);
      tmpV.y += 0.25;
      if (e.src === 'seq' || e.kind === 'perfect') stage.burst(tmpV, e.src === 'seq' ? e.kind : 'cool');
      if (e.src === 'seq') {
        stage.pulse(e.kind === 'perfect' ? 1 : 0.5);
        R.director.punch(e.kind === 'perfect' ? 1 : 0.5);
        if (e.kind === 'perfect') {
          R.flash(0.08);
          R.aberrate(0.006);
        }
      }
    } else if (e.kind === 'miss' && e.src === 'seq') {
      R.director.shake(1);
      R.aberrate(0.008);
    }
    animators[0].energy = 0.9 + Math.min(e.combo, 30) / 30 * 0.3;
    if (e.src === 'seq') {
      if (e.kind === 'perfect' && e.chain === 3) say('手感来了，连 P 继续！');
      else if (e.kind === 'perfect' && e.chain === 6) say('这就是灵感的节奏～');
      else if (e.kind === 'miss') say(['没关系，下一拍稳住！', '深呼吸，跟着我数拍子。', '敲完再等圈合上，不着急。'][rand.int(3)]);
    } else if (e.combo === 30) say('30 连击！别停！');
    else if (e.combo === 80) say('80 连击，观众都疯了！');
  });

  events.on('arrow', (e) => {
    if (e.ok) audio.sfx.tick(e.index);
    else audio.sfx.wrong();
  });
  events.on('early', () => audio.sfx.back());
  events.on('empty', (e) => hud.lanePress(e.dir));

  events.on('free', (e) => {
    hud.lanePress(e.dir);
    animators[0].strike(FREE_POSES[e.dir], 0.95, game.beat);
    audio.sfx.tick(2 + e.dir * 2);
    if (e.pts) {
      hud.popJudge(e.kind, { pts: e.pts, src: 'free' });
      chestOf(0, tmpV);
      stage.burst(tmpV, 'great');
      stage.pulse(0.4);
    }
  });

  events.on('segment', ({ seg }) => {
    $('secLabel').textContent = seg.label;
    const kind = seg.kind;
    stage.setMode(kind === 'outro' ? 'chorus' : kind);
    R.director.sequence(kind === 'outro' ? 'chorus' : kind);
    const changed = seg.type !== lastSegType;
    lastSegType = seg.type;
    if (seg.type === 'free') {
      hud.banner('自由发挥', { sub: '踩着节拍按任意方向键，摆出你的造型', color2: '#8ef0d0', replace: true });
      say('这段随便跳，开心最重要！', true);
    } else if (seg.type === 'finish') {
      hud.banner('终结技', { sub: '敲完整串，最后一拍按下去  得分 ×3', color2: '#ff9a5a', replace: true });
      say('最后一击，看我的！', true);
    } else if (seg.type === 'notesEnd') {
      hud.banner('最后冲刺', { color2: '#ff9a5a', replace: true });
    } else if (game.mode === 'show' && seg.index > 1 && changed) {
      // 炫舞秀里玩法切换时提醒一下；同一种玩法连续两段就不重复提示
      if (seg.type === 'notes') hud.banner('节拍时间', { sub: '音符到线时按对应方向', color2: '#7fd4ff', replace: true });
      else if (seg.type === 'seq') hud.banner('舞步时间', { sub: '敲完序列，第 4 拍踩下去', color2: '#ff9ccb', replace: true });
    }
    if (kind === 'chorus') {
      audio.sfx.cheer(0.6);
      if (seg.index > 1) say('副歌来啦，一起嗨！');
    }
  });

  events.on('beat', ({ n }) => {
    const k = n - countFrom;
    if (k >= 0 && k <= 3) {
      hud.banner(['3', '2', '1', 'GO!'][k], { dur: 0.55, size: 1.15, y: 0.2, replace: true, color2: k === 3 ? '#ffd36b' : '#9fc0ff' });
      audio.sfx.count(k === 3);
    }
  });

  events.on('bar', ({ bar }) => {
    const seg = game.seg;
    if (!seg || game.finalDone) return;
    const dancing = seg.type === 'seq' || seg.type === 'notes' || seg.type === 'finish' || seg.type === 'notesEnd';
    for (let i = 0; i < dancers.length; i++) {
      const p = game.players[i];
      let mv = 'idle';
      if (dancing) mv = p.ok ? choreoFor(seg.kind === 'outro' ? 'chorus' : seg.kind, bar) : 'step' + (bar % 2 ? 'M' : '');
      else if (seg.type === 'free' && i > 0) mv = ['wave', 'twist', 'slide'][(i + bar) % 3];
      animators[i].setMove(mv, 0.7);
    }
  });

  events.on('fever', (e) => {
    if (!e.me) return;
    stage.fever = e.on ? 1 : 0;
    if (e.on) {
      hud.banner('灵感爆发', { sub: '得分 ×2', dur: 1.6, color: '#fff3a0', color2: '#ff7eb6' });
      audio.sfx.fever();
      audio.sfx.cheer(1);
      stage.confetti(200);
      R.flash(0.15);
      doubao.setExpr('wow', 1.4, true);
      say('灵感爆发！！现在每一拍都是双倍！', true);
    }
  });

  events.on('rank', ({ rank, old }) => {
    if (game.beat < 20) return;
    if (rank === 1 && old > 1) say('我们冲到第一名了！');
    else if (rank > old && rank >= 3) say('别慌，下一段追回来！');
  });

  events.on('final', () => {
    game.finalDone = true;
    stage.setMode('finish');
    stage.fever = 0;
    R.flash(0.3);
    stage.confetti(280);
    audio.sfx.cheer(1.4);
    R.director.stopSequence();
    R.director.set('close', true);
    for (let i = 0; i < dancers.length; i++) {
      animators[i].setMove(i % 2 ? 'finishM' : 'finish', 0.25);
      dancers[i].setExpr(i === 0 ? 'wink' : 'happy', 3, true);
    }
    const spb = 60 / game.song.bpm;
    for (let i = 0; i < 7; i++) {
      later(() => stage.firework((rand() * 2 - 1) * 5, 4.2 + rand() * 2.6, -1.5 - rand() * 3), 120 + i * 330 * Math.min(1.2, spb * 2));
    }
    later(() => R.director.set('wide'), 1500);
  });

  events.on('end', (res) => {
    lastResult = res;
    later(() => showResults(res), 250);
  });

  function showResults(res) {
    state = 'results';
    input.playing = false;
    game.finalDone = false;
    stage.fever = 0;
    hud.clear();
    const key = `${res.song.id}.${res.mode}.${res.diff}`;
    const prev = store.best[key];
    const isNew = !res.auto && (!prev || res.score > prev.score);
    if (isNew) {
      store.best[key] = { score: res.score, grade: res.grade };
      saveStore(store);
    }
    $('resGrade').textContent = res.grade;
    $('resGrade').className = 'grade g-' + res.grade;
    $('resRank').textContent = `第 ${res.rank} 名`;
    $('resScore').textContent = fmtScore(res.score);
    $('resSong').textContent = `${res.song.title} · ${MODES[res.mode].name} · ${DIFFS[res.diff].name}${res.auto ? ' · 自动演示' : ''}`;
    $('resNew').classList.toggle('hidden', !isNew);
    $('resCounts').innerHTML = ['perfect', 'great', 'cool', 'bad', 'miss'].map((k) => `<div class="c-${k}"><b>${res.counts[k]}</b><span>${k.toUpperCase()}</span></div>`).join('');
    $('resStats').innerHTML = `<span>准确度<b>${(res.acc * 100).toFixed(1)}%</b></span><span>最大连击<b>${res.maxCombo}</b></span><span>最长连 P<b>${res.maxChain}</b></span><span>灵感爆发<b>${res.feverCount} 次</b></span>`;
    $('resBoard').innerHTML = res.ranking.map((p) => `<li class="${p.isMe ? 'me' : ''}"><i>${p.rank}</i><b>${p.name}</b><span>${fmtScore(p.score)}</span></li>`).join('');
    const lead = res.rank === 1 ? '第一名！' : res.rank === 2 ? '只差一点点就是第一了。' : '';
    $('resSay').textContent = lead + GRADE_SAY[res.grade];
    show('results');
    applyCamera();
    // 名次决定大家的庆祝方式
    for (let i = 0; i < dancers.length; i++) {
      const rk = res.ranking.findIndex((p) => p.name === game.players[i].name) + 1;
      animators[i].setMove(rk <= 2 ? 'cheer' : rk === 3 ? 'wave' : 'sad', 0.5);
      dancers[i].setExpr(rk <= 2 ? 'happy' : 'smile', 2);
    }
    if (res.rank <= 2) {
      audio.sfx.fanfare();
      stage.confetti(160);
    }
    resultsAt = performance.now();
    startLobby();
  }

  // ------------------------------------------------------------ 选歌界面
  function bestOf(song, mode, diff) {
    return store.best[`${song.id}.${mode}.${diff}`];
  }
  function buildSelect() {
    const list = $('songList');
    list.innerHTML = '';
    for (const s of SONGS) {
      const b = document.createElement('button');
      b.className = 'song' + (s === cur.song ? ' on' : '');
      b.style.setProperty('--c1', s.palette[0]);
      b.style.setProperty('--c2', s.palette[1]);
      b.innerHTML = `<div class="s-title">${s.title}</div><div class="s-en">${s.en}</div><div class="s-meta"><span class="s-bpm">${s.bpm} BPM</span><span class="s-stars">${'★'.repeat(s.stars)}${'☆'.repeat(3 - s.stars)}</span><span>${Math.round(songSeconds(s))} 秒</span></div><div class="s-desc">${s.desc}</div>`;
      b.addEventListener('click', () => {
        cur.song = s;
        audio.sfx.ui();
        stage.setPalette(s.palette);
        stage.setLogo(s.title, s.en);
        buildSelect();
      });
      list.appendChild(b);
    }
    const seg = (el, items, key) => {
      el.innerHTML = '';
      for (const it of Object.values(items)) {
        const b = document.createElement('button');
        b.textContent = it.name;
        b.className = cur[key] === it.id ? 'on' : '';
        b.addEventListener('click', () => {
          cur[key] = it.id;
          audio.sfx.ui();
          buildSelect();
        });
        el.appendChild(b);
      }
    };
    seg($('modeSeg'), MODES, 'mode');
    seg($('diffSeg'), DIFFS, 'diff');
    $('modeHint').textContent = MODES[cur.mode].desc;
    $('diffHint').textContent = DIFF_HINT[cur.diff];
    const best = bestOf(cur.song, cur.mode, cur.diff);
    $('bestBox').innerHTML = best ? `最高纪录<b>${fmtScore(best.score)}</b><em>${best.grade}</em>` : '还没有纪录，来创造第一个吧';
  }

  // ------------------------------------------------------------ 按钮
  const click = (id, fn) =>
    $(id).addEventListener('click', () => {
      audio.sfx.ui();
      fn();
    });
  click('btnStart', async () => {
    state = 'select';
    buildSelect();
    show('select');
    applyCamera();
    if (!lobbyOn) await startLobby();
  });
  click('btnHelp', () => {
    overlayFrom = 'title';
    show('help');
  });
  click('btnSettings', () => {
    overlayFrom = 'title';
    show('settings');
  });
  click('btnSelBack', () => {
    state = 'title';
    show('title');
    applyCamera();
  });
  for (const b of document.querySelectorAll('[data-close]')) {
    b.addEventListener('click', () => {
      audio.sfx.back();
      show(overlayFrom);
    });
  }
  click('btnGo', () => startGame(cur.song, cur.mode, cur.diff));
  click('btnPause', pauseGame);
  click('btnResume', resumeGame);
  // 这两个按钮不能先等音频恢复再动手：等待期间再按一次 Esc 就会把状态搅乱
  click('btnRestart', () => {
    if (state === 'paused') startGame(cur.song, cur.mode, cur.diff);
  });
  click('btnQuit', () => {
    if (state === 'paused') quitToSelect();
  });
  // 结算刚出现的一小段时间里不响应：玩家可能还在跟着尾奏敲空格
  const resultsSettled = () => state === 'results' && performance.now() - resultsAt > 900;
  click('btnAgain', () => {
    if (resultsSettled()) startGame(cur.song, cur.mode, cur.diff);
  });
  click('btnOther', () => {
    if (!resultsSettled()) return;
    state = 'select';
    resetDancers();
    stage.setMode('lobby');
    buildSelect();
    show('select');
    applyCamera();
  });

  // 设置
  const sMusic = $('sMusic');
  const sSfx = $('sSfx');
  const sOffset = $('sOffset');
  const sQuality = $('sQuality');
  const syncSettings = () => {
    sMusic.value = Math.round(store.settings.music * 100);
    sSfx.value = Math.round(store.settings.sfx * 100);
    sOffset.value = store.settings.offset;
    sQuality.value = store.settings.quality;
    $('oMusic').textContent = sMusic.value;
    $('oSfx').textContent = sSfx.value;
    $('oOffset').textContent = (store.settings.offset > 0 ? '+' : '') + store.settings.offset + ' ms';
  };
  syncSettings();
  sMusic.addEventListener('input', () => {
    store.settings.music = sMusic.value / 100;
    audio.setVolumes(store.settings);
    saveStore(store);
    syncSettings();
  });
  sSfx.addEventListener('input', () => {
    store.settings.sfx = sSfx.value / 100;
    audio.setVolumes(store.settings);
    saveStore(store);
    syncSettings();
  });
  sSfx.addEventListener('change', () => audio.sfx.judge('perfect'));
  sOffset.addEventListener('input', () => {
    store.settings.offset = +sOffset.value;
    clock.offset = store.settings.offset / 1000;
    saveStore(store);
    syncSettings();
  });
  sQuality.addEventListener('change', () => {
    store.settings.quality = sQuality.value;
    saveStore(store);
    location.reload();
  });

  // ------------------------------------------------------------ 输入
  const input = createInput({
    hud,
    canvas: $('hud'),
    onArrow: (dir, ts) => {
      if (state !== 'playing' || game.auto) return;
      hud.lanePress(dir);
      game.arrow(dir, clock.eventBeat(ts));
    },
    onBeat: (ts) => {
      if (state !== 'playing' || game.auto) return;
      game.hit(clock.eventBeat(ts));
    },
    onPause: () => {
      if (state === 'playing') pauseGame();
      else if (state === 'paused') resumeGame();
      else if (!$('help').classList.contains('hidden') || !$('settings').classList.contains('hidden')) show(overlayFrom);
    },
    onFirstGesture: () => {
      if (!lobbyOn && (state === 'title' || state === 'select')) startLobby();
    },
  });
  // 切到后台：对局中自动暂停；菜单和结算界面把音乐停掉，回来再接着放
  let bgSuspended = false;
  document.addEventListener('visibilitychange', () => {
    if (params.auto) return;
    if (document.hidden) {
      if (state === 'playing') pauseGame();
      else if (state === 'resuming') cancelResume();
      else if (state !== 'paused' && audio.ok && audio.ctx.state === 'running') {
        audio.suspend();
        bgSuspended = true;
      }
    } else if (bgSuspended) {
      bgSuspended = false;
      if (state !== 'paused') audio.resume();
    }
  });
  window.addEventListener('blur', () => {
    if (params.auto) return;
    if (state === 'playing') pauseGame();
    else if (state === 'resuming') cancelResume();
  });
  const onResize = () => {
    R.resize();
    hud.resize();
    stage.setPointScale(R.height);
    applyCamera();
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(onResize, 200));

  // ------------------------------------------------------------ 顶部信息刷新
  const rankEl = $('rank');
  let rankKey = '';
  let domT = 0;
  function updateDom(dt) {
    if (bubbleT > 0) {
      bubbleT -= dt;
      if (bubbleT <= 0) $('bubble').classList.add('hidden');
    }
    bubbleCool = Math.max(0, bubbleCool - dt);
    if (bubbleT > 0 && portrait() && hud.bannerActive()) {
      bubbleT = 0;
      $('bubble').classList.add('hidden');
    }
    if (!inGame() || !game.me) return;
    const me = game.me;
    me.shown += (me.score - me.shown) * Math.min(1, dt * 12);
    $('score').textContent = fmtScore(me.shown);
    $('prog').style.width = (game.progress() * 100).toFixed(1) + '%';
    const gb = $('gaugeBox');
    $('gauge').style.width = (me.gauge * 100).toFixed(1) + '%';
    gb.classList.toggle('fever', me.fever);
    gb.classList.toggle('full', !me.fever && me.gauge >= 1);
    const tight = portrait();
    $('gaugeText').textContent = me.fever ? (tight ? '爆发 ×2' : '灵感爆发  ×2') : me.gauge >= 1 ? (tight ? '即将爆发' : '下一小节爆发！') : '灵感值';
    domT -= dt;
    if (domT <= 0) {
      domT = 0.12;
      const sorted = [...game.players].sort((a, b) => b.score - a.score);
      const key = sorted.map((p) => p.name + Math.round(p.score / 10) + (p.fever ? 'f' : '')).join('|');
      if (key !== rankKey) {
        rankKey = key;
        rankEl.innerHTML = sorted.map((p, i) => `<li class="${p.isMe ? 'me' : ''}${p.fever ? ' fv' : ''}"><i>${i + 1}</i><b>${p.name}</b><span>${fmtScore(p.score)}</span></li>`).join('');
      }
    }
  }

  // ------------------------------------------------------------ 主循环
  const SHOWCASE = ['idle', 'wave', 'heart', 'step', 'point', 'clap', 'twist'];
  let last = performance.now();
  let frozenBeat = params.freeze != null ? +params.freeze : null;
  function frame(now) {
    const dt = Math.min(0.05, Math.max(0.0001, (now - last) / 1000));
    last = now;
    try {
      clock.update();
      let beat = clock.beat();
      if (frozenBeat != null) beat = frozenBeat;
      input.update();
      if (state === 'playing') game.update(beat);

      // 大厅里让豆包轮流展示几个动作
      if (state === 'title' || state === 'select') {
        const bar = Math.floor(beat / 4);
        if (bar !== showcaseBar) {
          showcaseBar = bar;
          const mv = params.pose && MOVES[params.pose] ? params.pose : SHOWCASE[Math.floor(bar / 2) % SHOWCASE.length];
          animators[0].setMove(mv, 0.8);
          for (let i = 1; i < dancers.length; i++) animators[i].setMove('idle', 0.8);
        }
      }
      for (let i = 0; i < dancers.length; i++) {
        animators[i].update(beat, dt);
        dancers[i].update(dt);
        dancers[i].setFaceLight(stage.faceLight || 1);
      }
      const live = audio.ok && audio.ctx.state === 'running';
      if (live) levels.bass = audio.spectrum(levels.spectrum);
      focus.set(doubao.root.position.x + doubao.joints.hips.position.x, 0, doubao.root.position.z + doubao.joints.hips.position.z);
      stage.update(dt, beat, live ? levels : null, focus);
      if (state === 'playing' && !params.shot) R.setShift(0, playShift());
      R.director.update(dt, beat);
      R.frame(dt);
      hud.draw(game, beat, dt, inGame() && state !== 'starting');
      updateDom(dt);
      window.__frames = (window.__frames || 0) + 1;
      if (window.__frames === 3) window.__ready = true;
    } catch (e) {
      if (!frame.failed) {
        frame.failed = true;
        fatal(e);
      }
    }
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------ 就绪
  await step('准备就绪', 1);
  stage.setPointScale(R.height);
  clock.start(LOBBY.bpm, 0);
  state = 'title';
  show('title');
  applyCamera();
  if (params.nohud) document.body.classList.add('nohud');
  // 调试：把豆包转到指定角度，检查侧面和背面
  if (params.turn) doubao.root.rotation.y = (+params.turn * Math.PI) / 180;
  if (params.shot) {
    // 调试：固定机位，不让界面状态改镜头
    R.director.stopSequence();
    R.director.set(params.shot, true);
    R.setShift(0, 0);
    R.director.set = () => {};
    R.setShift = () => {};
  }
  requestAnimationFrame(frame);
  $('boot').classList.add('done');
  setTimeout(() => $('boot').classList.add('hidden'), 700);

  window.__game = { game, R, stage, dancers, animators, clock, audio, hud, store, state: () => state, startGame, SONGS, lib: { createAudio, createSequencer } };
  // 调试：冻结节拍，配合截图逐帧检查舞蹈姿势
  window.__freeze = (b) => {
    frozenBeat = b;
    showcaseBar = Math.floor(b / 4);
  };
  window.__stats = () => ({
    state,
    quality: quality.name,
    fps: +R.stats.fps.toFixed(1),
    scale: +R.stats.scale.toFixed(2),
    calls: R.stats.calls,
    tris: R.stats.tris,
    beat: +clock.beat().toFixed(2),
    clock: clock.mode,
    score: game.me ? game.me.score : 0,
    errors: window.__errors.length,
  });

  if (params.auto || params.song) {
    const song = SONGS.find((s) => s.id === params.song) || cur.song;
    const mode = MODES[params.mode] ? params.mode : cur.mode;
    const diff = DIFFS[params.diff] ? params.diff : cur.diff;
    startGame(song, mode, diff);
  }
}

boot().catch(fatal);
