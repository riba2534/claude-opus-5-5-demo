// 逻辑自测：不依赖浏览器，用假时钟把每首歌 × 每种模式 × 每个难度自动演奏一遍。
import { SONGS, MODES, DIFFS, buildChart, prepareSong, songSeconds } from '../src/songs.js';
import { createGame } from '../src/game.js';
import { emitter } from '../src/util.js';

let failed = 0;
const check = (cond, msg) => { if (!cond) { failed++; console.error('  ✗ ' + msg); } };

for (const song of SONGS) {
  prepareSong(song);
  console.log(`\n== ${song.title}  ${song.bpm} BPM  ${song.bars} 小节  ${songSeconds(song).toFixed(1)}s`);
  for (const mode of Object.keys(MODES)) {
    for (const diff of Object.keys(DIFFS)) {
      const chart = buildChart(song, mode, diff);
      const levels = chart.rounds.map((r) => r.level);
      // 谱面合法性
      for (const r of chart.rounds) check(r.arrows.length === r.level, `round ${r.id} 箭头数与等级不符`);
      for (let i = 1; i < chart.notes.length; i++) check(chart.notes[i].beat >= chart.notes[i - 1].beat, '音符未按时间排序');
      const perLane = new Map();
      for (const n of chart.notes) { const k = n.lane + '@' + n.beat; check(!perLane.has(k), `同一轨道同一时刻重复音符 ${k}`); perLane.set(k, 1); check(n.lane >= 0 && n.lane <= 3, '轨道越界'); }

      for (const skill of [1, 0.75]) {
        const events = emitter();
        const stat = { judge: 0, fever: 0, ended: null, free: 0, finals: 0 };
        events.on('judge', (e) => { if (e.me) stat.judge++; });
        events.on('fever', (e) => { if (e.me && e.on) stat.fever++; });
        events.on('free', (e) => { if (e.pts) stat.free++; });
        events.on('final', () => stat.finals++);
        events.on('end', (r) => (stat.ended = r));
        const g = createGame({ clock: null, events });
        g.start(song, mode, diff, { auto: true, autoSkill: skill });
        for (let beat = -4; beat < chart.endBeat + 1 && !stat.ended; beat += song.bpm / 60 / 60) g.update(beat); // 60fps
        const r = stat.ended;
        check(!!r, '没有触发结算');
        if (!r) continue;
        const total = chart.rounds.length + chart.notes.length;
        check(stat.judge === total, `判定次数 ${stat.judge} ≠ 回合+音符 ${total}`);
        check(stat.finals === 1, `终结重音事件触发了 ${stat.finals} 次`);
        if (skill === 1) {
          check(r.counts.miss === 0 && r.counts.bad === 0, `满技能自动演奏出现 miss/bad: ${JSON.stringify(r.counts)}`);
          check(r.grade === 'SS', `满技能评级应为 SS，实际 ${r.grade}`);
        }
        if (skill === 1) console.log(`  ${MODES[mode].name.padEnd(3, '　')} ${DIFFS[diff].name}  回合 ${String(chart.rounds.length).padStart(2)} 音符 ${String(chart.notes.length).padStart(3)} 自由拍 ${String(chart.frees.length).padStart(2)}  等级 ${levels.length ? Math.min(...levels) + '→' + Math.max(...levels) : '-'}  满分 ${String(r.score).padStart(7)}  爆发×${stat.fever}  排名 ${r.ranking.map((p) => p.name + ':' + p.score).join(' ')}`);
        else console.log(`      └ 技能0.75  得分 ${String(r.score).padStart(7)} 评级 ${r.grade} 第${r.rank}名  ${JSON.stringify(r.counts)}`);
      }
    }
  }
}
console.log(failed ? `\n${failed} 项检查失败` : '\n全部检查通过');
process.exit(failed ? 1 : 0);
