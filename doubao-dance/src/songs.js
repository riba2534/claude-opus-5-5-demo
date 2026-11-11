// 歌曲数据（全部原创，按 16 分音符步进编写）与谱面生成。
// 旋律记谱：一小节 16 个字符；'.' 休止，'-' 延音，'1'-'7' 为音阶级数，
// '8' '9' '0' 是高八度的 1 2 3，'l' 'm' 'n' 是低八度的 5 6 7。
import { clamp, mod, rng } from './util.js';

export const MAJOR = [0, 2, 4, 5, 7, 9, 11];
export const MINOR = [0, 2, 3, 5, 7, 8, 10];

const FOUR = 'x...x...x...x...';
const BACKBEAT = '....x.......x...';
const OFFBEAT = '..x...x...x...x.';
const EIGHTHS = 'x.x.x.x.x.x.x.x.';

export const SONGS = [
  {
    id: 'cream',
    title: '奶油心跳',
    en: 'CREAM HEARTBEAT',
    desc: '轻快流行 · 适合热身',
    bpm: 104,
    key: 60,
    lead: 72,
    scale: MAJOR,
    stars: 1,
    leadKind: 'square',
    palette: ['#ff7eb6', '#7aa8ff', '#ffd36b', '#8ef0d0'],
    sections: [
      ['intro', 4, '前奏'],
      ['verse', 8, '主歌'],
      ['chorus', 8, '副歌'],
      ['break', 4, '间奏'],
      ['verse', 8, '主歌'],
      ['chorus', 8, '副歌'],
      ['outro', 4, '终章'],
    ],
    pats: {
      intro: {
        chords: [0, 5, 3, 4],
        kick: ['', '', 'x.......x.......', 'x...x...x...x.x.'],
        hat: ['....x.......x...', '....x.......x...', OFFBEAT, 'x.x.x.x.x.x.xxxx'],
        clap: ['', '', '', '............x...'],
        pad: true,
        arp: 8,
        riser: 1,
      },
      verse: {
        chords: [0, 5, 3, 4],
        kick: 'x......x..x.....',
        snare: BACKBEAT,
        hat: EIGHTHS,
        bass: '1..1..8...1.5...',
        pad: true,
        lead: [
          '3.3.5.6-..5.3.2.',
          '1.1.2.3-..2.1.m.',
          '3.3.5.6-..8.6.5.',
          '6.5.3.2-......5.',
          '3.3.5.6-..5.3.2.',
          '1.1.2.3-..2.1.m.',
          '3.3.5.6-..8.9.8.',
          '6.5.6.8-........',
        ],
      },
      chorus: {
        chords: [3, 4, 2, 5, 3, 4, 0, 0],
        kick: FOUR,
        clap: BACKBEAT,
        hat: 'x.xxx.xxx.xxx.xx',
        ohat: OFFBEAT,
        bass: '1.1.8.1.1.1.8.5.',
        stab: 'x..x..x.....x...',
        pad: true,
        arp: 8,
        crash: true,
        fill: true,
        lead: [
          '8..8..6.8..9..8.',
          '9..9..8.6..5..6.',
          '5..5..3.5..6..5.',
          '6..8..6.5..3..5.',
          '8..8..6.8..9..8.',
          '9..9..8.9..0..9.',
          '8-------5.6.8.9.',
          '8-----------....',
        ],
      },
      break: {
        chords: [5, 3, 0, 4],
        kick: 'o.......o.......',
        clap: BACKBEAT,
        hat: FOUR,
        bass: '1---------------',
        pad: true,
        bell: true,
        riser: 1,
        lead: ['3...5...8...5...', '6...8...9...8...', '5...8...0...8...', '9...7...5.......'],
      },
      outro: {
        chords: [3, 4, 0, 0],
        kick: [FOUR, 'x...x...x.x.....', '', ''],
        clap: [BACKBEAT, '....x...........', '', ''],
        hat: ['x.xxx.xxx.xxx.xx', 'x.xxx.xxx.x.....', '', ''],
        bass: ['1.1.8.1.1.1.8.5.', '1.1.8.1.1.1.....', '', ''],
        pad: [true, true, false, false],
        crash: true,
        lead: ['8..8..6.8..9..8.', '9..9..8.9.0.....', '', ''],
        final: { bar: 1, pos: 12 },
      },
    },
  },
  {
    id: 'neon',
    title: '霓虹豆浆',
    en: 'NEON SOYMILK',
    desc: '复古迪斯科 · 四拍踩满',
    bpm: 124,
    key: 57,
    lead: 69,
    scale: MINOR,
    stars: 2,
    leadKind: 'square',
    bassKind: 'square',
    palette: ['#b56bff', '#ff5fa2', '#4fd6ff', '#ffb45a'],
    sections: [
      ['intro', 4, '前奏'],
      ['verse', 8, '主歌'],
      ['chorus', 8, '副歌'],
      ['break', 4, '间奏'],
      ['verse', 8, '主歌'],
      ['chorus', 8, '副歌'],
      ['chorus', 8, '副歌'],
      ['outro', 4, '终章'],
    ],
    pats: {
      intro: {
        chords: [0, 5, 2, 6],
        kick: ['', '', FOUR, FOUR],
        hat: OFFBEAT,
        clap: ['', '', BACKBEAT, '....x.......x.xx'],
        bass: ['1---------------', '1---------------', '1.8.1.8.1.8.1.8.', '1.8.1.8.1.8.1.8.'],
        pad: true,
        arp: 16,
        riser: 1,
      },
      verse: {
        chords: [0, 5, 2, 6],
        kick: FOUR,
        clap: BACKBEAT,
        hat: OFFBEAT,
        bass: '1.8.1.8.1.8.1.8.',
        stab: '..x..x....x..x..',
        lead: [
          '1..3..4.5-..4.3.',
          '1..3..4.3-..1.n.',
          '3..4..5.7-..5.4.',
          '5..4..3.4-......',
          '1..3..4.5-..4.3.',
          '1..3..4.3-..1.n.',
          '3..4..5.7-..8.7.',
          '5..7..8.8-......',
        ],
      },
      chorus: {
        chords: [0, 5, 2, 6],
        kick: FOUR,
        clap: BACKBEAT,
        hat: EIGHTHS,
        ohat: OFFBEAT,
        bass: '1.8.1.8.1.8.5.8.',
        stab: 'x..x..x..x..x.x.',
        pad: true,
        arp: 16,
        crash: true,
        fill: true,
        lead: [
          '8.8.7.5.7-5.4.5.',
          '4.4.5.4.3-1.3.4.',
          '5.5.7.8.9-8.7.5.',
          '7.5.4.5.8-------',
          '8.8.7.5.7-5.4.5.',
          '4.4.5.4.3-1.3.4.',
          '5.5.7.8.9-8.7.8.',
          '0.9.8.7.8-------',
        ],
      },
      break: {
        chords: [5, 6, 0, 0],
        kick: 'o.......o.......',
        clap: BACKBEAT,
        hat: FOUR,
        bass: '1---------------',
        pad: true,
        arp: 8,
        bell: true,
        riser: 1,
        lead: ['5...8...9...8...', '7...9...0...9...', '8...5...3...5...', '1...............'],
      },
      outro: {
        chords: [5, 6, 0, 0],
        kick: [FOUR, 'x...x...x.x.....', '', ''],
        clap: [BACKBEAT, '....x...........', '', ''],
        hat: [EIGHTHS, 'x.x.x.x.x.x.....', '', ''],
        ohat: [OFFBEAT, '..x...x.........', '', ''],
        bass: ['1.8.1.8.1.8.1.8.', '1.8.1.8.1.8.....', '', ''],
        pad: [true, true, false, false],
        crash: true,
        lead: ['8.8.7.5.7-5.4.5.', '7.7.8.9.0.9.....', '', ''],
        final: { bar: 1, pos: 12 },
      },
    },
  },
  {
    id: 'spark',
    title: '灵感爆发',
    en: 'SPARK OVERDRIVE',
    desc: '高速电音 · 挑战手速',
    bpm: 150,
    key: 52,
    lead: 76,
    scale: MINOR,
    stars: 3,
    leadKind: 'sawtooth',
    palette: ['#4fd6ff', '#ff4f9a', '#b8ff5a', '#9b6bff'],
    sections: [
      ['intro', 4, '前奏'],
      ['verse', 8, '主歌'],
      ['build', 4, '蓄力'],
      ['chorus', 8, '副歌'],
      ['break', 4, '间奏'],
      ['verse', 8, '主歌'],
      ['build', 4, '蓄力'],
      ['chorus', 16, '副歌'],
      ['outro', 4, '终章'],
    ],
    pats: {
      intro: {
        chords: [0, 5, 2, 6],
        kick: ['', '', FOUR, FOUR],
        hat: EIGHTHS,
        snare: ['', '', '', '........x.x.xxxx'],
        bass: ['1---------------', '1---------------', '1.1.1.1.1.1.1.1.', '1.1.1.1.1.1.1.1.'],
        pad: true,
        arp: 16,
        riser: 1,
      },
      verse: {
        chords: [0, 5, 2, 6],
        kick: FOUR,
        snare: BACKBEAT,
        hat: 'xxxxxxxxxxxxxxxx',
        bass: '1.1.1.1.1.1.1.1.',
        lead: [
          '5-..5.4.3-..1...',
          '3-..3.4.5-..7...',
          '8-..7.5.7-..5...',
          '4-..3.4.5-------',
          '5-..5.4.3-..1...',
          '3-..3.4.5-..7...',
          '8-..7.8.9-..8...',
          '7-..5.7.8-------',
        ],
      },
      build: {
        chords: [5, 6, 0, 0],
        kick: [FOUR, FOUR, EIGHTHS, ''],
        snare: [FOUR, EIGHTHS, 'xxxxxxxxxxxxxxxx', 'xxxxxxxxxxxxxxxx'],
        roll: true,
        bass: '1.1.1.1.1.1.1.1.',
        pad: true,
        riser: 2,
        lead: ['8...8...8...8...', '9...9...9...9...', '0.0.0.0.0.0.0.0.', '0.0.0.0.0.0.0...'],
      },
      chorus: {
        chords: [5, 6, 0, 2],
        kick: FOUR,
        clap: BACKBEAT,
        hat: EIGHTHS,
        ohat: OFFBEAT,
        bass: '1.8.1.8.1.8.1.8.',
        stab: 'x..x..x..x..x.x.',
        pad: true,
        arp: 16,
        crash: true,
        fill: true,
        lead: [
          '8.7.8...5.7.8...',
          '9.8.9...7.8.9...',
          '0.9.8.7.8...5.7.',
          '8-----7-5-7-8---',
          '8.7.8...5.7.8...',
          '9.8.9...7.8.9...',
          '0.9.8.7.8.9.0.9.',
          '8---------------',
        ],
      },
      break: {
        chords: [0, 0, 5, 6],
        kick: 'x.........x.....',
        snare: '........x.......',
        hat: FOUR,
        bass: '1---------------',
        pad: true,
        bell: true,
        riser: 1,
        lead: ['5...3...1...3...', '5...3...1...n...', '8...5...3...5...', '9...7...5.......'],
      },
      outro: {
        chords: [5, 6, 0, 0],
        kick: [FOUR, 'x...x...x.x.....', '', ''],
        clap: [BACKBEAT, '....x...........', '', ''],
        hat: [EIGHTHS, 'x.x.x.x.x.x.....', '', ''],
        ohat: [OFFBEAT, '..x...x.........', '', ''],
        bass: ['1.8.1.8.1.8.1.8.', '1.8.1.8.1.8.....', '', ''],
        pad: [true, true, false, false],
        crash: true,
        lead: ['8.7.8...5.7.8...', '9.8.9.0.9.0.....', '', ''],
        final: { bar: 1, pos: 12 },
      },
    },
  },
];

// 大厅循环曲：标题和选歌界面的背景音乐
export const LOBBY = {
  id: 'lobby',
  title: '大厅',
  bpm: 96,
  key: 60,
  lead: 72,
  scale: MAJOR,
  palette: ['#7aa8ff', '#ff7eb6', '#ffd36b', '#8ef0d0'],
  sections: [['loop', 8, '']],
  pats: {
    loop: {
      chords: [0, 5, 3, 4],
      kick: 'o.........o.....',
      clap: '....o.......o...',
      hat: OFFBEAT,
      bass: '1.....1...5.....',
      pad: true,
      arp: 8,
      bell: true,
      lead: ['3...5...8.......', '', '6...5...3.......', '', '3...5...9.......', '', '8...6...5.......', ''],
    },
  },
};

export const MODES = {
  step: { id: 'step', name: '舞步', desc: '敲完方向键序列，第 4 拍按空格' },
  beat: { id: 'beat', name: '节拍', desc: '音符落到判定线时按下对应方向' },
  show: { id: 'show', name: '炫舞秀', desc: '主歌拼舞步，副歌打节拍' },
};

export const DIFFS = {
  // kps：这一档允许的每秒键数，序列长度按它和歌曲速度封顶；fill：在八分音符之间补十六分音符的概率
  easy: { id: 'easy', name: '简单', start: 1, slope: 0.3, max: 6, kps: 2, rev: 0, gap: 4, dbl: 0, fill: 0, rival: 0.85 },
  normal: { id: 'normal', name: '普通', start: 2, slope: 0.36, max: 8, kps: 3, rev: 0.07, gap: 2, dbl: 0.12, fill: 0, rival: 0.96 },
  hard: { id: 'hard', name: '困难', start: 3, slope: 0.45, max: 9, kps: 4.5, rev: 0.2, gap: 1, dbl: 0.22, fill: 0.34, rival: 1.02 },
};

// ---------------------------------------------------------------- 查询工具
export function prepareSong(song) {
  if (song._ready) return song;
  let bar = 0;
  song.secs = song.sections.map(([pat, bars, label]) => {
    const s = { pat, kind: pat, bars, label, start: bar };
    bar += bars;
    return s;
  });
  song.bars = bar;
  for (const [name, p] of Object.entries(song.pats)) {
    for (const key of ['kick', 'snare', 'clap', 'hat', 'ohat', 'bass', 'stab', 'lead']) {
      const v = p[key];
      if (v == null) continue;
      for (const line of Array.isArray(v) ? v : [v]) {
        if (line.length !== 0 && line.length !== 16) console.warn(`[song] ${song.id}.${name}.${key} 长度不是 16: "${line}"`);
      }
    }
  }
  song._ready = true;
  return song;
}

export function sectionAtBar(song, bar) {
  const secs = song.secs;
  for (let i = secs.length - 1; i >= 0; i--) {
    if (bar >= secs[i].start) return { sec: secs[i], barIn: bar - secs[i].start, index: i };
  }
  return { sec: secs[0], barIn: 0, index: 0 };
}

export function track(p, name, barIn) {
  const v = p[name];
  if (v == null) return '';
  if (Array.isArray(v)) return v[barIn % v.length] || '';
  return v;
}

export function degToMidi(song, d, base) {
  return base + 12 * Math.floor(d / 7) + song.scale[mod(d, 7)];
}

const NOTE_DEG = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 7, 9: 8, 0: 9, l: -3, m: -2, n: -1 };
export const noteDeg = (ch) => (ch in NOTE_DEG ? NOTE_DEG[ch] : null);

export const songSeconds = (song) => (prepareSong(song).bars * 4 * 60) / song.bpm;

// ---------------------------------------------------------------- 谱面
function playType(mode, kind) {
  if (kind === 'intro') return 'rest';
  if (kind === 'break') return 'free';
  if (kind === 'outro') return mode === 'beat' ? 'notesEnd' : 'finish';
  if (mode === 'step') return 'seq';
  if (mode === 'beat') return 'notes';
  return kind === 'chorus' ? 'notes' : 'seq';
}

function genArrows(r, n, revProb) {
  const out = [];
  let last = -1;
  let rep = 0;
  for (let i = 0; i < n; i++) {
    let d = r.int(4);
    if (d === last) {
      rep++;
      if (rep >= 2) {
        d = (d + 1 + r.int(3)) % 4;
        rep = 0;
      }
    } else rep = 0;
    last = d;
    out.push({ dir: d, rev: r() < revProb });
  }
  return out;
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function buildChart(song, modeId, diffId) {
  prepareSong(song);
  const diff = DIFFS[diffId] || DIFFS.normal;
  const r = rng(hashStr(`${song.id}/${modeId}/${diffId}`));
  const segments = [];
  const rounds = [];
  const notes = [];
  const frees = [];
  let seqIndex = 0;
  let lane = 1;
  let prevDeg = 0;
  let sameCount = 0;
  let prevType = 'rest';
  // 一小节里敲得完多少个键取决于歌有多快。按每秒键数给序列长度封顶，
  // 不然 150 BPM 的简单档会比 104 BPM 的困难档还难。0.35 秒是留给读谱的时间。
  const barSec = 240 / song.bpm;
  const cap = clamp(Math.floor((barSec - 0.35) * diff.kps), diff.start + 1, diff.max);
  const seqRounds = song.secs.reduce((n, s) => n + (playType(modeId, s.kind) === 'seq' ? s.bars : 0), 0);
  // 用全曲四分之三的回合爬到顶，而不是第一段副歌就到顶、之后原地不动
  const slope = Math.min(diff.slope, (cap - diff.start) / Math.max(1, 0.75 * seqRounds));

  song.secs.forEach((sec, si) => {
    const type = playType(modeId, sec.kind);
    // 上一段的最后一个舞步在第 4 拍判定，紧接着的音符要给出反应和换手的时间
    const leadIn = prevType === 'seq' ? 8 : 0;
    prevType = type;
    const startBeat = sec.start * 4;
    const endBeat = (sec.start + sec.bars) * 4;
    segments.push({ type, kind: sec.kind, label: sec.label, startBeat, endBeat, index: si });
    const pat = song.pats[sec.pat];
    const nextSec = song.secs[si + 1];
    const nextType = nextSec ? playType(modeId, nextSec.kind) : 'end';

    if (type === 'seq') {
      for (let b = 0; b < sec.bars; b++) {
        let level = Math.round(diff.start + slope * seqIndex) + (sec.kind === 'chorus' ? 1 : 0);
        level = clamp(level, 1, cap);
        seqIndex++;
        rounds.push({
          id: rounds.length,
          bar: sec.start + b,
          hitBeat: (sec.start + b) * 4 + 3,
          lenBeats: 4,
          level,
          arrows: genArrows(r, level, level >= 4 ? diff.rev : 0),
          finish: false,
        });
      }
    } else if (type === 'finish') {
      const n = Math.min(cap + 2, 11);
      rounds.push({
        id: rounds.length,
        bar: sec.start,
        hitBeat: sec.start * 4 + 7,
        lenBeats: 8,
        level: n,
        arrows: genArrows(r, n, diff.rev * 0.6),
        finish: true,
      });
    } else if (type === 'notes' || type === 'notesEnd') {
      const playBars = type === 'notesEnd' ? 2 : sec.bars;
      const fill = diff.fill * clamp(120 / song.bpm, 0.6, 1.2);
      let lastAbs = -99;
      for (let b = 0; b < playBars; b++) {
        let line = track(pat, 'lead', b);
        if (!line) line = FOUR;
        const lastBar = b === playBars - 1;
        const has = (pos) => pos >= 0 && pos < 16 && line[pos] != null && line[pos] !== '.' && line[pos] !== '-';
        const barNotes = [];
        for (let pos = 0; pos < 16; pos++) {
          if (!has(pos)) continue;
          if (b === 0 && pos < leadIn) continue;
          // 下一段要敲舞步序列时，空出最后一拍给玩家换手
          if (lastBar && type === 'notes' && (nextType === 'seq' || nextType === 'finish') && pos >= 12) continue;
          if (diff.gap >= 4) {
            // 简单档只留整拍上的音。反拍的音只有在前后两个整拍都空着时才留，免得热身曲变成一串切分
            if (pos % 2 !== 0) continue;
            if (pos % 4 !== 0 && (has(pos - 2) || has(pos + 2))) continue;
          }
          // 间隔按整段连续计算，不在小节线上清零
          const abs = b * 16 + pos;
          if (abs - lastAbs < diff.gap) continue;
          lastAbs = abs;
          const deg = noteDeg(line[pos]);
          const d = deg == null ? prevDeg : deg;
          if (d > prevDeg) {
            lane += 1;
            sameCount = 0;
          } else if (d < prevDeg) {
            lane -= 1;
            sameCount = 0;
          } else if (++sameCount >= 2) {
            lane += r() < 0.5 ? 1 : -1;
            sameCount = 0;
          }
          if (lane > 3) lane = 2;
          if (lane < 0) lane = 1;
          prevDeg = d;
          const beat = (sec.start + b) * 4 + pos / 4;
          notes.push({ id: notes.length, beat, lane });
          barNotes.push({ pos, lane });
          // 重拍上偶尔加一个双押
          if (pos % 8 === 0 && r() < diff.dbl) {
            notes.push({ id: notes.length, beat, lane: (lane + 2) % 4 });
          }
        }
        // 困难档：在相邻两个八分音符之间补一个十六分音符。
        // 只补在伴奏里确实有声音的位置（十六分的琶音或踩镲），手上敲的每一下都能听到对应的音。
        if (fill > 0) {
          const hat = track(pat, 'hat', b);
          let added = 0;
          for (let i = 0; i + 1 < barNotes.length && added < 3; i++) {
            const a = barNotes[i];
            const c = barNotes[i + 1];
            if (c.pos - a.pos !== 2) continue;
            const pos = a.pos + 1;
            if (!(pat.arp === 16 || hat[pos] === 'x') || r() >= fill) continue;
            // 放在两边都没占的轨道上，不出现十六分的同轨连打
            const mid = (a.lane + c.lane) / 2;
            const free = [0, 1, 2, 3].filter((l) => l !== a.lane && l !== c.lane).sort((x, y) => Math.abs(x - mid) - Math.abs(y - mid));
            notes.push({ id: notes.length, beat: (sec.start + b) * 4 + pos / 4, lane: free[0] });
            added++;
            i++;
          }
        }
      }
      if (type === 'notesEnd') {
        // 全曲最后一个重音：固定一个双押收尾
        const beat = sec.start * 4 + 7;
        for (let i = notes.length - 1; i >= 0 && notes[i].beat >= beat - 0.01; i--) notes.pop();
        notes.push({ id: notes.length, beat, lane: 0, final: true });
        notes.push({ id: notes.length, beat, lane: 3, final: true });
      }
    } else if (type === 'free') {
      // 自由发挥：每一拍都可以按任意方向键摆造型，最后一拍留给下一段
      for (let beat = startBeat; beat < endBeat - 1; beat++) frees.push({ beat, done: false });
    }
  });

  notes.sort((a, b) => a.beat - b.beat || a.lane - b.lane);
  notes.forEach((n, i) => (n.id = i));
  const outro = song.secs[song.secs.length - 1];
  return {
    segments,
    rounds,
    notes,
    frees,
    endBeat: song.bars * 4,
    finalBeat: outro.start * 4 + 7,
    diff,
  };
}
