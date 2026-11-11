// 玩法核心：回合/音符判定、计分、连击、灵感爆发、AI 对手、自动演奏。
import { buildChart, prepareSong } from './songs.js';
import { clamp, rng } from './util.js';

export const KINDS = ['perfect', 'great', 'cool', 'bad', 'miss'];
// 判定窗口（秒）
const SEQ_WIN = { perfect: 0.048, great: 0.095, cool: 0.145, bad: 0.2 };
const NOTE_WIN = { perfect: 0.045, great: 0.09, cool: 0.13, bad: 0.17 };
const SEQ_BASE = { perfect: 1000, great: 700, cool: 400, bad: 150, miss: 0 };
const NOTE_BASE = { perfect: 300, great: 200, cool: 110, bad: 40, miss: 0 };
const ACC = { perfect: 1, great: 0.8, cool: 0.5, bad: 0.2, miss: 0 };
const GAUGE_SEQ = { perfect: 0.14, great: 0.08, cool: 0.03, bad: -0.02, miss: -0.1 };
const GAUGE_NOTE = { perfect: 0.03, great: 0.017, cool: 0.006, bad: -0.01, miss: -0.04 };
const FEVER_BEATS = 16;

export const RIVALS = [
  { name: '奶黄', skill: 0.9, slip: 0.015 },
  { name: '抹茶', skill: 0.8, slip: 0.04 },
  { name: '芝麻', skill: 0.7, slip: 0.08 },
];

function newPlayer(name, isMe, skill = 0, slip = 0) {
  return {
    name,
    isMe,
    skill,
    slip,
    score: 0,
    shown: 0,
    combo: 0,
    maxCombo: 0,
    chain: 0,
    maxChain: 0,
    counts: { perfect: 0, great: 0, cool: 0, bad: 0, miss: 0 },
    accSum: 0,
    accN: 0,
    gauge: 0,
    fever: false,
    feverEnd: 0,
    feverCount: 0,
    last: null,
    ok: true,
    rank: 1,
  };
}

function judgeByDt(dt, win) {
  const a = Math.abs(dt);
  if (a <= win.perfect) return 'perfect';
  if (a <= win.great) return 'great';
  if (a <= win.cool) return 'cool';
  if (a <= win.bad) return 'bad';
  return 'miss';
}

export function gradeOf(acc, counts) {
  if (acc >= 0.985 && counts.miss === 0) return 'SS';
  if (acc >= 0.95) return 'S';
  if (acc >= 0.88) return 'A';
  if (acc >= 0.75) return 'B';
  if (acc >= 0.6) return 'C';
  return 'D';
}

export function createGame({ clock, events }) {
  const g = {
    state: 'idle',
    song: null,
    mode: 'step',
    diff: 'normal',
    chart: null,
    players: [],
    me: null,
    beat: -99,
    auto: false,
    autoSkill: 1,
    seg: null,
    round: null, // 当前开放的舞步回合
    noteHead: 0,
    lastBeatInt: -99,
    secPerBeat: 0.5,
  };
  let rnd = rng(1);
  let roundIdx = 0;
  let rivalRound = 0;
  let rivalNote = 0;
  let rivalFree = 0;
  let segIdx = -1;
  let autoFreeBeat = -99;

  const b2s = (beats) => beats * g.secPerBeat;
  const s2b = (sec) => sec / g.secPerBeat;

  g.start = (song, modeId, diffId, opts = {}) => {
    g.song = prepareSong(song);
    g.mode = modeId;
    g.diff = diffId;
    g.chart = buildChart(song, modeId, diffId);
    g.secPerBeat = 60 / song.bpm;
    g.auto = !!opts.auto;
    g.autoSkill = opts.autoSkill == null ? 1 : opts.autoSkill;
    rnd = rng(opts.seed || 20240517);
    g.players = [newPlayer('豆包', true), ...RIVALS.map((r) => newPlayer(r.name, false, r.skill * g.chart.diff.rival, r.slip))];
    g.me = g.players[0];
    g.state = 'playing';
    g.beat = -99;
    g.seg = null;
    g.round = null;
    g.noteHead = 0;
    g.lastBeatInt = -99;
    roundIdx = rivalRound = rivalNote = rivalFree = 0;
    segIdx = -1;
    autoFreeBeat = -99;
    for (const r of g.chart.rounds) {
      r.progress = 0;
      r.judged = null;
      r.open = false;
      r.wrongAt = -99;
      r.doneAt = -99;
    }
    for (const n of g.chart.notes) {
      n.judged = null;
      n.hitAt = 0;
    }
    for (const f of g.chart.frees) f.done = false;
  };

  // ---------------------------------------------------------------- 计分
  function applyJudge(p, kind, src, info = {}) {
    const isSeq = src === 'seq';
    p.counts[kind]++;
    p.accSum += ACC[kind];
    p.accN++;
    if (kind === 'perfect') p.chain++;
    else p.chain = 0;
    p.maxChain = Math.max(p.maxChain, p.chain);
    const breaks = kind === 'miss' || (!isSeq && kind === 'bad');
    p.combo = breaks ? 0 : p.combo + 1;
    p.maxCombo = Math.max(p.maxCombo, p.combo);
    let pts;
    if (isSeq) {
      const chainMult = kind === 'perfect' && p.chain >= 2 ? 1 + 0.1 * Math.min(p.chain - 1, 10) : 1;
      pts = SEQ_BASE[kind] * (1 + 0.12 * ((info.level || 1) - 1)) * chainMult * (info.finish ? 3 : 1);
    } else {
      pts = NOTE_BASE[kind] * (1 + Math.min(p.combo, 100) / 100) * (info.final ? 3 : 1);
    }
    if (p.fever) pts *= 2;
    pts = Math.round(pts);
    p.score += pts;
    if (!p.fever) p.gauge = clamp(p.gauge + (isSeq ? GAUGE_SEQ : GAUGE_NOTE)[kind], 0, 1);
    p.last = kind;
    p.ok = kind !== 'miss' && kind !== 'bad';
    events.emit('judge', {
      who: g.players.indexOf(p),
      me: p.isMe,
      kind,
      src,
      pts,
      chain: p.chain,
      combo: p.combo,
      level: info.level,
      finish: !!info.finish || !!info.final,
      lane: info.lane,
      dt: info.dt || 0,
    });
    return pts;
  }

  function updateRanks() {
    const sorted = [...g.players].sort((a, b) => b.score - a.score);
    sorted.forEach((p, i) => {
      if (p.rank !== i + 1) {
        const old = p.rank;
        p.rank = i + 1;
        if (p.isMe) events.emit('rank', { rank: p.rank, old });
      }
    });
  }

  // ---------------------------------------------------------------- 输入
  function needDir(a) {
    return a.rev ? 3 - a.dir : a.dir;
  }

  function tryNote(lane, evBeat) {
    const notes = g.chart.notes;
    const win = s2b(NOTE_WIN.bad);
    let best = null;
    for (let i = g.noteHead; i < notes.length; i++) {
      const n = notes[i];
      if (n.beat > evBeat + win) break;
      if (n.judged || n.lane !== lane) continue;
      if (Math.abs(n.beat - evBeat) <= win && (!best || Math.abs(n.beat - evBeat) < Math.abs(best.beat - evBeat))) best = n;
    }
    if (!best) return false;
    const dt = b2s(evBeat - best.beat);
    const kind = judgeByDt(dt, NOTE_WIN);
    best.judged = kind;
    best.hitAt = g.beat;
    applyJudge(g.me, kind, 'note', { lane, dt, final: best.final });
    return true;
  }

  function tryFree(dir, evBeat) {
    const seg = g.seg;
    if (!seg || seg.type !== 'free') return false;
    const nb = Math.round(evBeat);
    const f = g.chart.frees.find((x) => x.beat === nb);
    let kind = 'pose';
    let pts = 0;
    if (f && !f.done) {
      const dt = Math.abs(b2s(evBeat - nb));
      if (dt <= 0.1) {
        kind = 'nice';
        pts = 260;
      } else if (dt <= 0.2) {
        kind = 'ok';
        pts = 120;
      }
      if (pts) {
        f.done = true;
        if (g.me.fever) pts *= 2;
        g.me.score += pts;
        if (!g.me.fever) g.me.gauge = clamp(g.me.gauge + (kind === 'nice' ? 0.04 : 0.02), 0, 1);
      }
    }
    events.emit('free', { dir, kind, pts });
    return true;
  }

  g.arrow = (dir, evBeat = g.beat) => {
    if (g.state !== 'playing') return;
    if (tryNote(dir, evBeat)) return;
    const r = g.round;
    if (r && !r.judged) {
      const a = r.arrows[r.progress];
      if (!a) return; // 已敲完，等空格
      if (dir === needDir(a)) {
        r.progress++;
        if (r.progress === r.arrows.length) r.doneAt = g.beat;
        events.emit('arrow', { ok: true, index: r.progress - 1, total: r.arrows.length, done: r.progress === r.arrows.length });
      } else {
        const had = r.progress;
        r.progress = 0;
        r.wrongAt = g.beat;
        events.emit('arrow', { ok: false, index: had, total: r.arrows.length });
      }
      return;
    }
    if (tryFree(dir, evBeat)) return;
    events.emit('empty', { dir });
  };

  g.hit = (evBeat = g.beat) => {
    if (g.state !== 'playing') return;
    const r = g.round;
    if (!r || r.judged) return;
    const dtBeats = evBeat - r.hitBeat;
    const done = r.progress === r.arrows.length;
    // 序列还没敲完、离重拍也还远：当作误触，不罚
    if (!done && dtBeats < -1.25) {
      events.emit('early', {});
      return;
    }
    const dt = b2s(dtBeats);
    const kind = done ? judgeByDt(dt, SEQ_WIN) : 'miss';
    finishRound(r, kind, dt);
  };

  function finishRound(r, kind, dt) {
    r.judged = kind;
    r.judgedAt = g.beat;
    r.open = false;
    applyJudge(g.me, kind, 'seq', { level: r.level, finish: r.finish, dt });
    g.round = null;
    roundIdx = r.id + 1;
  }

  // ---------------------------------------------------------------- AI 对手
  function rivalKind(p, level, isNote) {
    if (rnd() < p.slip) return 'miss';
    // 两个均匀随机数相加，得到中间高两头低的分布
    const noise = (rnd() + rnd() - 1) * 0.3;
    const x = p.skill - (isNote ? 0 : Math.max(0, level - 4) * 0.018) + noise;
    if (x > 0.8) return 'perfect';
    if (x > 0.6) return 'great';
    if (x > 0.42) return 'cool';
    if (x > 0.28) return 'bad';
    return 'miss';
  }

  function updateRivals(beat) {
    const { rounds, notes, frees } = g.chart;
    while (rivalRound < rounds.length && beat >= rounds[rivalRound].hitBeat + 0.05) {
      const r = rounds[rivalRound++];
      for (const p of g.players) if (!p.isMe) applyJudge(p, rivalKind(p, r.level, false), 'seq', { level: r.level, finish: r.finish });
    }
    while (rivalNote < notes.length && beat >= notes[rivalNote].beat) {
      const n = notes[rivalNote++];
      for (const p of g.players) if (!p.isMe) applyJudge(p, rivalKind(p, 1, true), 'note', { lane: n.lane, final: n.final });
    }
    while (rivalFree < frees.length && beat >= frees[rivalFree].beat) {
      rivalFree++;
      for (const p of g.players) {
        if (p.isMe) continue;
        const x = rnd();
        if (x < p.skill) p.score += (x < p.skill * 0.6 ? 260 : 120) * (p.fever ? 2 : 1);
      }
    }
  }

  // ---------------------------------------------------------------- 自动演奏（演示与自测）
  function autoplay(beat) {
    const r = g.round;
    const jitter = () => (1 - g.autoSkill) * (rnd() + rnd() - 1) * 0.5;
    if (r && !r.judged) {
      const n = r.arrows.length;
      const t0 = r.hitBeat - r.lenBeats + 0.35;
      const t1 = r.hitBeat - 0.55;
      const want = Math.min(n, Math.floor(clamp((beat - t0) / (t1 - t0), 0, 1) * n + 0.0001));
      while (r.progress < want) g.arrow(needDir(r.arrows[r.progress]), beat);
      if (r.autoErr == null) r.autoErr = jitter();
      if (beat >= r.hitBeat + r.autoErr && r.progress === n) g.hit(r.hitBeat + r.autoErr);
    }
    const notes = g.chart.notes;
    for (let i = g.noteHead; i < notes.length; i++) {
      const n = notes[i];
      if (n.beat > beat + 0.5) break;
      if (n.judged) continue;
      if (n.autoErr == null) n.autoErr = jitter();
      if (beat >= n.beat + n.autoErr) g.arrow(n.lane, n.beat + n.autoErr);
    }
    if (g.seg && g.seg.type === 'free') {
      const nb = Math.floor(beat + 0.02);
      if (nb !== autoFreeBeat && beat - nb < 0.2) {
        autoFreeBeat = nb;
        g.arrow(rnd.int(4), nb + jitter() * 0.3);
      }
    }
  }

  // ---------------------------------------------------------------- 每帧推进
  g.update = (beat) => {
    if (g.state !== 'playing') return;
    g.beat = beat;
    const chart = g.chart;

    // 段落切换
    while (segIdx + 1 < chart.segments.length && beat >= chart.segments[segIdx + 1].startBeat) {
      segIdx++;
      g.seg = chart.segments[segIdx];
      events.emit('segment', { seg: g.seg, next: chart.segments[segIdx + 1] || null });
    }

    // 整拍 / 整小节事件
    const bi = Math.floor(beat);
    if (bi !== g.lastBeatInt) {
      // 跳帧时逐拍补发，保证舞台和灵感爆发的时机不丢
      const from = g.lastBeatInt < -50 ? bi : g.lastBeatInt + 1;
      for (let n = Math.max(from, bi - 4); n <= bi; n++) {
        events.emit('beat', { n, inBar: ((n % 4) + 4) % 4, bar: Math.floor(n / 4) });
        if (n % 4 === 0) onBar(n);
        if (n === chart.finalBeat) events.emit('final', {});
      }
      g.lastBeatInt = bi;
    }

    // 舞步回合：开放与超时
    const rounds = chart.rounds;
    const badBeats = s2b(SEQ_WIN.bad);
    if (!g.round && roundIdx < rounds.length) {
      const r = rounds[roundIdx];
      if (beat >= r.hitBeat - r.lenBeats - badBeats) {
        r.open = true;
        r.openAt = beat;
        g.round = r;
        events.emit('round', { round: r });
      }
    }
    if (g.auto) autoplay(beat);
    if (g.round && beat > g.round.hitBeat + badBeats) finishRound(g.round, 'miss', 0);

    // 节拍音符：漏掉的记 Miss
    const notes = chart.notes;
    const nBad = s2b(NOTE_WIN.bad);
    while (g.noteHead < notes.length && (notes[g.noteHead].judged || notes[g.noteHead].beat < beat - nBad)) {
      const n = notes[g.noteHead];
      if (!n.judged) {
        n.judged = 'miss';
        n.hitAt = beat;
        applyJudge(g.me, 'miss', 'note', { lane: n.lane, final: n.final });
      }
      g.noteHead++;
    }

    updateRivals(beat);

    // 灵感爆发的计时
    for (const p of g.players) {
      if (p.fever) {
        p.gauge = clamp((p.feverEnd - beat) / FEVER_BEATS, 0, 1);
        if (beat >= p.feverEnd) {
          p.fever = false;
          p.gauge = 0;
          events.emit('fever', { who: g.players.indexOf(p), me: p.isMe, on: false });
        }
      }
    }
    updateRanks();

    if (beat >= chart.endBeat) {
      g.state = 'ended';
      events.emit('end', g.results());
    }
  };

  function onBar(n) {
    events.emit('bar', { bar: n / 4 });
    for (const p of g.players) {
      if (!p.fever && p.gauge >= 1 && n < g.chart.finalBeat - 4) {
        p.fever = true;
        p.feverEnd = n + FEVER_BEATS;
        p.feverCount++;
        events.emit('fever', { who: g.players.indexOf(p), me: p.isMe, on: true });
      }
    }
  }

  g.results = () => {
    const sorted = [...g.players].sort((a, b) => b.score - a.score);
    const me = g.me;
    const acc = me.accN ? me.accSum / me.accN : 0;
    return {
      song: g.song,
      mode: g.mode,
      diff: g.diff,
      auto: g.auto,
      ranking: sorted.map((p, i) => ({ name: p.name, score: p.score, isMe: p.isMe, rank: i + 1 })),
      rank: sorted.indexOf(me) + 1,
      score: me.score,
      acc,
      grade: gradeOf(acc, me.counts),
      counts: { ...me.counts },
      maxCombo: me.maxCombo,
      maxChain: me.maxChain,
      feverCount: me.feverCount,
    };
  };

  // 给 HUD 用：歌曲进度 0..1
  g.progress = () => (g.chart ? clamp(g.beat / g.chart.endBeat, 0, 1) : 0);
  g.stop = () => {
    g.state = 'idle';
    g.round = null;
  };
  // 仅供节拍换算
  g.clock = clock;
  return g;
}
