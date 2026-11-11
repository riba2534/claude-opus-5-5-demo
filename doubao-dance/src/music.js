// 音序器：按 16 分音符提前调度合成器，以及统一的节拍时钟。
import { clamp } from './util.js';
import { degToMidi, noteDeg, prepareSong, sectionAtBar, track } from './songs.js';

export function createSequencer(audio) {
  let song = null;
  let t0 = 0;
  let next = 0;
  let timer = null;
  let loop = false;
  let totalSteps = 0;
  let sps = 0.1;
  let bassBase = 36;
  let padBase = 60;

  function chordMidis(deg, base) {
    return [degToMidi(song, deg, base), degToMidi(song, deg + 2, base), degToMidi(song, deg + 4, base)];
  }

  function step(s, t) {
    const total = song.bars * 16;
    const ls = loop ? s % total : s;
    const bar = Math.floor(ls / 16);
    const pos = ls % 16;
    const { sec, barIn } = sectionAtBar(song, bar);
    const p = song.pats[sec.pat];
    const chord = p.chords[barIn % p.chords.length];

    let c = track(p, 'kick', barIn)[pos];
    if (c === 'x') audio.kick(t, 1);
    else if (c === 'o') audio.kick(t, 0.55);

    c = track(p, 'snare', barIn)[pos];
    if (c === 'x') {
      const v = p.roll ? 0.3 + 0.7 * ((barIn * 16 + pos) / (sec.bars * 16)) : 1;
      audio.snare(t, v * (p.roll && pos % 4 !== 0 ? 0.7 : 1));
    }
    c = track(p, 'clap', barIn)[pos];
    if (c === 'x') audio.clap(t, 1);
    else if (c === 'o') audio.clap(t, 0.5);

    c = track(p, 'hat', barIn)[pos];
    if (c === 'x') audio.hat(t, pos % 4 === 0 ? 1 : pos % 2 === 0 ? 0.75 : 0.5, false);
    c = track(p, 'ohat', barIn)[pos];
    if (c === 'x') audio.hat(t, 0.9, true);

    const bassLine = track(p, 'bass', barIn);
    c = bassLine[pos];
    if (c && c !== '.' && c !== '-') {
      let hold = 1;
      while (pos + hold < 16 && bassLine[pos + hold] === '-') hold++;
      const root = degToMidi(song, chord, bassBase);
      const m = c === '8' ? root + 12 : c === '5' ? degToMidi(song, chord + 4, bassBase) : c === '3' ? degToMidi(song, chord + 2, bassBase) : root;
      // 长音贝斯没有侧链压着，音量要收一些，不然间奏比副歌还响
      audio.bass(t, m, hold > 1 ? hold * sps * 0.96 : sps * 1.5, hold > 4 ? 0.5 : 1, song.bassKind || 'saw');
    }

    const padOn = Array.isArray(p.pad) ? p.pad[barIn % p.pad.length] : p.pad;
    if (padOn && pos === 0) audio.pad(t, chordMidis(chord, padBase), 16 * sps, 1);

    c = track(p, 'stab', barIn)[pos];
    if (c === 'x') audio.stab(t, chordMidis(chord, padBase + 12), sps * 1.9, 1);

    if (p.arp && padOn !== false) {
      const div = 16 / p.arp;
      if (pos % div === 0) {
        const tones = chordMidis(chord, padBase + 12);
        const seq = [0, 1, 2, 1, 0, 2, 1, 2];
        const i = pos / div;
        const m = tones[seq[i % seq.length]] + (i % 4 === 3 ? 12 : 0);
        audio.pluck(t, m, sps * div * 0.9, pos % 4 === 0 ? 1 : 0.7);
      }
    }

    const leadLine = track(p, 'lead', barIn);
    c = leadLine[pos];
    const deg = c ? noteDeg(c) : null;
    if (deg != null) {
      let hold = 1;
      while (pos + hold < 16 && leadLine[pos + hold] === '-') hold++;
      const m = degToMidi(song, deg, song.lead);
      if (p.bell) audio.bell(t, m, 0.75);
      else audio.lead(t, m, hold * sps * (hold > 1 ? 0.98 : 1.5), 1, song.leadKind || 'square');
    }

    if (p.crash && barIn === 0 && pos === 0) audio.crash(t, 0.9);
    if (p.riser && barIn === sec.bars - p.riser && pos === 0) audio.riser(t, p.riser * 16 * sps, 1);
    if (p.fill && barIn === sec.bars - 1 && pos >= 12) audio.snare(t, 0.45 + (pos - 12) * 0.14);

    if (p.final && barIn === p.final.bar && pos === p.final.pos) {
      // 全曲最后一个重音：底鼓 + 镲 + 主和弦 + 上行钟声
      audio.kick(t, 1);
      audio.crash(t, 1);
      audio.stab(t, chordMidis(0, padBase).concat(chordMidis(0, padBase + 12)), sps * 14, 1.3);
      audio.bass(t, degToMidi(song, 0, bassBase), sps * 10, 1, 'saw');
      [0, 2, 4, 7, 9, 11, 14].forEach((d, i) => audio.bell(t + i * sps * 0.5, degToMidi(song, d, song.lead), 0.6));
    }
  }

  function tick() {
    if (!song || !audio.ctx) return;
    const now = audio.ctx.currentTime;
    for (;;) {
      if (!loop && next >= totalSteps) break;
      const t = t0 + next * sps;
      if (t > now + 0.18) break;
      if (t >= now - 0.04) {
        try {
          step(next, t);
        } catch (e) {
          console.error('[music] step 调度出错', e);
        }
      }
      next++;
    }
  }

  return {
    play(s, startTime, o = {}) {
      this.stop();
      song = prepareSong(s);
      t0 = startTime;
      next = 0;
      loop = !!o.loop;
      sps = 60 / song.bpm / 4;
      totalSteps = song.bars * 16;
      bassBase = song.key - 24;
      while (bassBase < 33) bassBase += 12;
      while (bassBase > 45) bassBase -= 12;
      padBase = song.key < 56 ? song.key + 12 : song.key;
      audio.setKey(song.key < 56 ? song.key + 12 : song.key);
      audio.setDelayTime(sps * 3);
      tick();
      timer = setInterval(tick, 25);
    },
    // 自测用：把一段步进一次性全部排进（离线）音频上下文
    scheduleRange(s, startTime, fromStep, toStep) {
      this.play(s, startTime);
      clearInterval(timer);
      timer = null;
      for (let i = fromStep; i < toStep; i++) step(i, startTime + i * sps);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      song = null;
    },
    get song() {
      return song;
    },
  };
}

// 节拍时钟：有声音时以"玩家听到的采样时间"为准，没有声音时退回到性能时钟。
export function createClock(audio) {
  const c = {
    bpm: 100,
    t0: 0,
    mode: 'perf',
    paused: false,
    scale: 1,
    time: 0, // 距离第 0 拍的秒数
    offset: 0, // 玩家校准的延迟（秒）
  };
  let est = 0;
  let lastPerf = performance.now() / 1000;

  // 返回第 0 拍在 AudioContext 时间轴上的位置，交给音序器对齐
  c.start = (bpm, lead = 0) => {
    c.bpm = bpm;
    c.paused = false;
    lastPerf = performance.now() / 1000;
    if (audio.ctx && audio.ctx.state === 'running') {
      c.mode = 'audio';
      c.t0 = audio.ctx.currentTime + lead;
      est = audio.heardTime() - c.t0;
      c.time = est;
    } else {
      c.mode = 'perf';
      c.t0 = 0;
      c.time = -lead;
    }
    return c.t0;
  };
  c.update = () => {
    const p = performance.now() / 1000;
    const dt = Math.min(0.1, p - lastPerf);
    lastPerf = p;
    if (c.mode === 'audio') {
      if (audio.ctx.state === 'running' && !c.paused) {
        const target = audio.heardTime() - c.t0;
        est += dt;
        const err = target - est;
        // 小误差平滑跟随，大误差（切后台回来）直接对齐
        if (Math.abs(err) > 0.06) est = target;
        else est += err * 0.12;
        c.time = est;
      }
    } else if (!c.paused) {
      c.time += dt * c.scale;
    }
  };
  c.beat = () => ((c.time - c.offset) * c.bpm) / 60;
  // 把输入事件的时间戳换算成节拍：c.time 对应上一帧，事件通常发生在两帧之间
  c.eventBeat = (timeStamp) => {
    const ts = (timeStamp || performance.now()) / 1000;
    const delta = c.paused ? 0 : clamp(ts - lastPerf, -0.25, 0.25);
    return ((c.time + delta * (c.mode === 'audio' ? 1 : c.scale) - c.offset) * c.bpm) / 60;
  };
  c.pause = () => {
    c.paused = true;
    if (c.mode === 'audio') audio.suspend();
  };
  c.resume = async () => {
    if (c.mode === 'audio') await audio.resume();
    lastPerf = performance.now() / 1000;
    c.paused = false;
  };
  return c;
}
