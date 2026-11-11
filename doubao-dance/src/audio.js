// WebAudio 引擎：所有乐器与音效都是实时合成的，没有任何音频文件。
import { clamp } from './util.js';

export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

function silentAudio() {
  const noop = new Proxy(function () {}, { get: () => noop, apply: () => undefined });
  return new Proxy(
    {},
    {
      get: (_, k) => {
        if (k === 'ctx') return null;
        if (k === 'ok') return false;
        if (k === 'resume') return () => Promise.resolve(false);
        if (k === 'spectrum') return () => 0;
        return noop;
      },
    },
  );
}

export function createAudio(opts = {}) {
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  // opts.context：自测时传入 OfflineAudioContext 做离线渲染
  let ctx = opts.context || null;
  if (!ctx && AC && !opts.mute) {
    try {
      ctx = new AC({ latencyHint: 'interactive' });
    } catch (e) {
      console.warn('[audio] WebAudio 不可用，静音运行', e);
    }
  }
  if (!ctx) return silentAudio();

  // ---------------------------------------------------------------- 总线
  const master = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 12;
  comp.ratio.value = 3.5;
  comp.attack.value = 0.004;
  comp.release.value = 0.16;
  // 压缩器后面留一点余量，避免输出端削波
  const outGain = ctx.createGain();
  outGain.gain.value = 0.86;
  master.connect(comp);
  comp.connect(outGain);
  outGain.connect(ctx.destination);

  const music = ctx.createGain();
  const sfxBus = ctx.createGain();
  music.connect(master);
  sfxBus.connect(master);

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.7;
  music.connect(analyser);
  const fftBins = new Uint8Array(analyser.frequencyBinCount);

  // 侧链：底鼓落下时把铺底和贝斯压一下，产生电子舞曲的"呼吸感"
  const pump = ctx.createGain();
  pump.connect(music);
  const drums = ctx.createGain();
  drums.connect(music);

  // 混响：指数衰减的噪声脉冲响应
  const reverb = ctx.createConvolver();
  reverb.buffer = makeImpulse(2.4, 2.8);
  const revRet = ctx.createGain();
  revRet.gain.value = 0.5;
  reverb.connect(revRet);
  revRet.connect(master);
  const revSend = ctx.createGain();
  revSend.connect(reverb);
  const sfxRev = ctx.createGain();
  sfxRev.gain.value = 0.35;
  sfxBus.connect(sfxRev);
  sfxRev.connect(reverb);

  // 主旋律的节拍延迟
  const delay = ctx.createDelay(1.5);
  delay.delayTime.value = 0.3;
  const dFb = ctx.createGain();
  dFb.gain.value = 0.32;
  const dLp = ctx.createBiquadFilter();
  dLp.type = 'lowpass';
  dLp.frequency.value = 2600;
  const dRet = ctx.createGain();
  dRet.gain.value = 0.3;
  delay.connect(dLp);
  dLp.connect(dFb);
  dFb.connect(delay);
  dLp.connect(dRet);
  dRet.connect(music);
  const delaySend = ctx.createGain();
  delaySend.connect(delay);

  const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  {
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  function makeImpulse(seconds, decay) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (i < 400 ? i / 400 : 1);
      }
    }
    return buf;
  }

  // ---------------------------------------------------------------- 基础积木
  function osc(type, freq, t, dur, dest, detune = 0) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    if (detune) o.detune.value = detune;
    o.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
    return o;
  }
  // 起音-衰减-保持-释放包络，返回增益节点
  function vca(t, peak, a, d, s, hold, r, dest) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * s), t + a + d);
    const end = Math.max(t + a + d, t + hold);
    g.gain.setValueAtTime(Math.max(0.0001, peak * s), end);
    g.gain.exponentialRampToValueAtTime(0.0001, end + r);
    g.connect(dest);
    return g;
  }
  function noise(t, dur, dest, rate = 1) {
    const n = ctx.createBufferSource();
    n.buffer = noiseBuf;
    n.playbackRate.value = rate;
    n.loop = true;
    n.connect(dest);
    n.start(t, Math.random() * 1.5);
    n.stop(t + dur + 0.02);
    return n;
  }
  function filter(type, freq, q, dest) {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    f.connect(dest);
    return f;
  }

  // ---------------------------------------------------------------- 鼓组
  function kick(t, v = 1) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.78 * v, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    g.connect(drums);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(170, t);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.1);
    o.connect(g);
    o.start(t);
    o.stop(t + 0.36);
    // 敲击的"哒"
    const cg = vca(t, 0.3 * v, 0.001, 0.02, 0.01, 0, 0.01, drums);
    noise(t, 0.03, filter('highpass', 2500, 0.5, cg));
    // 侧链压缩
    const depth = 1 - 0.62 * v;
    pump.gain.cancelScheduledValues(t);
    pump.gain.setValueAtTime(depth, t);
    pump.gain.linearRampToValueAtTime(1, t + 0.24);
  }
  function snare(t, v = 1) {
    const g = vca(t, 0.5 * v, 0.001, 0.12, 0.02, 0, 0.06, drums);
    noise(t, 0.2, filter('bandpass', 1900, 0.8, g));
    const tg = vca(t, 0.3 * v, 0.001, 0.07, 0.01, 0, 0.03, drums);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(215, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    o.connect(tg);
    o.start(t);
    o.stop(t + 0.14);
    g.connect(revSend);
  }
  function clap(t, v = 1) {
    const bp = filter('bandpass', 1300, 1.1, drums);
    bp.connect(revSend);
    for (const off of [0, 0.011, 0.023]) {
      const g = vca(t + off, 0.4 * v, 0.001, 0.012, 0.02, 0, 0.01, bp);
      noise(t + off, 0.03, g);
    }
    const tail = vca(t + 0.03, 0.36 * v, 0.001, 0.16, 0.02, 0, 0.05, bp);
    noise(t + 0.03, 0.24, tail);
  }
  function hat(t, v = 1, open = false) {
    const dur = open ? 0.26 : 0.045;
    const g = vca(t, 0.24 * v, 0.001, dur, 0.02, 0, 0.02, drums);
    noise(t, dur + 0.05, filter('highpass', open ? 6500 : 8200, 0.7, g), 1.2);
  }
  function crash(t, v = 1) {
    const g = vca(t, 0.3 * v, 0.002, 1.3, 0.02, 0, 0.3, drums);
    noise(t, 1.8, filter('highpass', 4800, 0.4, g), 1.1);
    g.connect(revSend);
  }
  function riser(t, dur, v = 1) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22 * v, t + dur);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.03);
    g.connect(music);
    g.connect(revSend);
    const f = filter('bandpass', 400, 1.6, g);
    f.frequency.setValueAtTime(350, t);
    f.frequency.exponentialRampToValueAtTime(9000, t + dur);
    noise(t, dur + 0.05, f);
  }

  // ---------------------------------------------------------------- 音高乐器
  function bass(t, midi, dur, v = 1, kind = 'saw') {
    const f = mtof(midi);
    const lp = filter('lowpass', 900, 3, pump);
    lp.frequency.setValueAtTime(kind === 'saw' ? 1500 : 800, t);
    lp.frequency.exponentialRampToValueAtTime(220, t + Math.min(dur, 0.22));
    const g = vca(t, 0.36 * v, 0.004, 0.08, 0.7, dur * 0.85, 0.05, lp);
    osc(kind === 'saw' ? 'sawtooth' : 'square', f, t, dur + 0.1, g);
    const sg = vca(t, 0.26 * v, 0.004, 0.1, 0.8, dur * 0.85, 0.05, pump);
    osc('sine', f, t, dur + 0.1, sg);
  }
  function pad(t, midis, dur, v = 1) {
    const lp = filter('lowpass', 1500, 0.6, pump);
    lp.frequency.setValueAtTime(700, t);
    lp.frequency.linearRampToValueAtTime(2000, t + dur * 0.5);
    lp.frequency.linearRampToValueAtTime(900, t + dur);
    lp.connect(revSend);
    const g = vca(t, 0.085 * v, 0.08, 0.2, 0.85, dur * 0.95, 0.25, lp);
    for (const m of midis) {
      const f = mtof(m);
      osc('sawtooth', f, t, dur + 0.3, g, -9);
      osc('sawtooth', f, t, dur + 0.3, g, 9);
    }
  }
  function stab(t, midis, dur, v = 1) {
    const lp = filter('lowpass', 3200, 2, pump);
    lp.frequency.setValueAtTime(4200, t);
    lp.frequency.exponentialRampToValueAtTime(600, t + dur);
    lp.connect(revSend);
    const g = vca(t, 0.105 * v, 0.003, dur * 0.7, 0.2, 0, 0.06, lp);
    for (const m of midis) {
      const f = mtof(m);
      osc('sawtooth', f, t, dur + 0.1, g, -7);
      osc('square', f, t, dur + 0.1, g, 7);
    }
  }
  function lead(t, midi, dur, v = 1, kind = 'square') {
    const f = mtof(midi);
    const lp = filter('lowpass', 3600, 1.5, music);
    lp.frequency.setValueAtTime(5200, t);
    lp.frequency.exponentialRampToValueAtTime(1700, t + Math.min(0.3, dur));
    lp.connect(delaySend);
    lp.connect(revSend);
    const g = vca(t, 0.24 * v, 0.006, 0.09, 0.62, dur * 0.9, 0.09, lp);
    const o1 = osc(kind, f, t, dur + 0.15, g);
    const o2 = osc('sawtooth', f, t, dur + 0.15, g, 11);
    if (dur > 0.28) {
      // 长音加一点颤音
      const l = ctx.createOscillator();
      const lg = ctx.createGain();
      l.frequency.value = 5.6;
      lg.gain.setValueAtTime(0, t);
      lg.gain.linearRampToValueAtTime(f * 0.011, t + 0.25);
      l.connect(lg);
      lg.connect(o1.frequency);
      lg.connect(o2.frequency);
      l.start(t);
      l.stop(t + dur + 0.2);
    }
  }
  function pluck(t, midi, dur, v = 1) {
    const f = mtof(midi);
    const lp = filter('lowpass', 2600, 2.5, music);
    lp.frequency.setValueAtTime(4800, t);
    lp.frequency.exponentialRampToValueAtTime(500, t + 0.16);
    lp.connect(delaySend);
    const g = vca(t, 0.14 * v, 0.002, 0.13, 0.05, 0, 0.05, lp);
    osc('square', f, t, dur + 0.2, g);
    osc('triangle', f * 2, t, dur + 0.2, g);
  }
  // 简单 FM 钟声：给高光旋律和判定音效用
  function bell(t, midi, v = 1, dest = music) {
    const f = mtof(midi);
    const g = vca(t, 0.2 * v, 0.002, 0.5, 0.01, 0, 0.3, dest);
    g.connect(revSend);
    const car = ctx.createOscillator();
    car.frequency.value = f;
    const modO = ctx.createOscillator();
    modO.frequency.value = f * 3.01;
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(f * 2.2, t);
    mg.gain.exponentialRampToValueAtTime(f * 0.05, t + 0.4);
    modO.connect(mg);
    mg.connect(car.frequency);
    car.connect(g);
    car.start(t);
    modO.start(t);
    car.stop(t + 1);
    modO.stop(t + 1);
  }

  // ---------------------------------------------------------------- 音效
  let keyRoot = 60;
  const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26];
  const sfx = {
    // 敲对一个方向键：音高随序号上行，敲完一串正好是一条琶音
    tick(i) {
      const t = ctx.currentTime;
      const m = keyRoot + 12 + PENTA[Math.min(i, PENTA.length - 1)];
      const g = vca(t, 0.16, 0.002, 0.1, 0.02, 0, 0.05, sfxBus);
      osc('triangle', mtof(m), t, 0.2, g);
      osc('sine', mtof(m + 12), t, 0.2, g);
    },
    wrong() {
      const t = ctx.currentTime;
      const g = vca(t, 0.2, 0.002, 0.14, 0.02, 0, 0.05, sfxBus);
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(70, t + 0.16);
      o.connect(filter('lowpass', 900, 1, g));
      o.start(t);
      o.stop(t + 0.2);
    },
    judge(kind) {
      const t = ctx.currentTime;
      if (kind === 'perfect') {
        bell(t, keyRoot + 24, 0.9, sfxBus);
        bell(t + 0.05, keyRoot + 31, 0.7, sfxBus);
        bell(t + 0.1, keyRoot + 36, 0.6, sfxBus);
      } else if (kind === 'great') {
        bell(t, keyRoot + 24, 0.7, sfxBus);
        bell(t + 0.06, keyRoot + 28, 0.5, sfxBus);
      } else if (kind === 'cool') {
        bell(t, keyRoot + 19, 0.55, sfxBus);
      } else if (kind === 'bad') {
        const g = vca(t, 0.14, 0.002, 0.1, 0.02, 0, 0.04, sfxBus);
        osc('triangle', mtof(keyRoot + 3), t, 0.15, g);
      } else {
        const g = vca(t, 0.2, 0.004, 0.22, 0.02, 0, 0.06, sfxBus);
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(220, t);
        o.frequency.exponentialRampToValueAtTime(82, t + 0.26);
        o.connect(filter('lowpass', 700, 2, g));
        o.start(t);
        o.stop(t + 0.3);
      }
    },
    // 节奏模式的击中音：短促，不抢音乐
    tap(kind) {
      const t = ctx.currentTime;
      const v = kind === 'perfect' ? 0.2 : kind === 'great' ? 0.15 : 0.1;
      const g = vca(t, v, 0.001, 0.05, 0.02, 0, 0.03, sfxBus);
      noise(t, 0.06, filter('bandpass', kind === 'perfect' ? 5200 : 3600, 1.5, g));
      if (kind === 'perfect') osc('sine', mtof(keyRoot + 36), t, 0.08, g);
    },
    ui() {
      const t = ctx.currentTime;
      const g = vca(t, 0.12, 0.002, 0.06, 0.02, 0, 0.03, sfxBus);
      osc('sine', 880, t, 0.1, g);
      osc('sine', 1320, t + 0.03, 0.08, g);
    },
    back() {
      const t = ctx.currentTime;
      const g = vca(t, 0.1, 0.002, 0.07, 0.02, 0, 0.03, sfxBus);
      osc('sine', 660, t, 0.1, g);
      osc('sine', 440, t + 0.04, 0.08, g);
    },
    count(final) {
      const t = ctx.currentTime;
      const g = vca(t, 0.2, 0.002, final ? 0.3 : 0.1, 0.02, 0, 0.06, sfxBus);
      osc('square', final ? 1046 : 698, t, final ? 0.4 : 0.14, filter('lowpass', 2400, 1, g));
    },
    cheer(amount = 1) {
      const t = ctx.currentTime;
      const dur = 1.6 + amount;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.16 * amount, t + 0.35);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      g.connect(sfxBus);
      const f = filter('bandpass', 1500, 0.7, g);
      f.frequency.setValueAtTime(900, t);
      f.frequency.linearRampToValueAtTime(2400, t + 0.5);
      f.frequency.linearRampToValueAtTime(1300, t + dur);
      noise(t, dur, f);
      // 人群里零星的"呜呼"
      for (let i = 0; i < 5; i++) {
        const st = t + 0.1 + Math.random() * 0.7;
        const wg = vca(st, 0.035 * amount, 0.05, 0.3, 0.2, 0, 0.2, sfxBus);
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        const base = 420 + Math.random() * 380;
        o.frequency.setValueAtTime(base, st);
        o.frequency.linearRampToValueAtTime(base * 1.7, st + 0.25);
        o.frequency.linearRampToValueAtTime(base * 1.2, st + 0.6);
        o.connect(filter('bandpass', 1100, 3, wg));
        o.start(st);
        o.stop(st + 0.7);
      }
    },
    fever() {
      const t = ctx.currentTime;
      for (let i = 0; i < 8; i++) bell(t + i * 0.045, keyRoot + 12 + PENTA[i], 0.6, sfxBus);
      riser(t, 0.5, 0.8);
      crash(t + 0.5, 0.8);
    },
    whoosh() {
      const t = ctx.currentTime;
      const g = vca(t, 0.14, 0.12, 0.2, 0.02, 0, 0.08, sfxBus);
      const f = filter('bandpass', 600, 1.2, g);
      f.frequency.setValueAtTime(400, t);
      f.frequency.exponentialRampToValueAtTime(3600, t + 0.3);
      noise(t, 0.4, f);
    },
    fanfare() {
      const t = ctx.currentTime;
      const seq = [0, 4, 7, 12, 16, 19, 24];
      seq.forEach((n, i) => bell(t + i * 0.09, keyRoot + 12 + n, 0.7, sfxBus));
    },
  };

  // ---------------------------------------------------------------- 对外
  const bands = new Float32Array(32);
  return {
    ok: true,
    ctx,
    sfx,
    kick,
    snare,
    clap,
    hat,
    crash,
    riser,
    bass,
    pad,
    stab,
    lead,
    pluck,
    bell,
    now: () => ctx.currentTime,
    resume: async () => {
      try {
        if (ctx.state !== 'running') await ctx.resume();
      } catch (e) {
        /* 被自动播放策略拦截时保持静音运行 */
      }
      return ctx.state === 'running';
    },
    suspend: () => {
      try {
        if (ctx.state === 'running') ctx.suspend();
      } catch (e) {
        /* ignore */
      }
    },
    // 玩家此刻"听到"的那个采样在 AudioContext 时间轴上的位置
    heardTime() {
      if (ctx.getOutputTimestamp) {
        const ts = ctx.getOutputTimestamp();
        if (ts && ts.performanceTime > 0 && ts.contextTime > 0) {
          return ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
        }
      }
      return ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
    },
    setVolumes({ music: m, sfx: s }) {
      const t = ctx.currentTime;
      if (m != null) music.gain.setTargetAtTime(clamp(m, 0, 1) * 0.9, t, 0.03);
      if (s != null) sfxBus.gain.setTargetAtTime(clamp(s, 0, 1), t, 0.03);
    },
    // 暂停菜单/结算时把音乐闷掉
    duck(amount, time = 0.2) {
      master.gain.setTargetAtTime(amount, ctx.currentTime, time);
    },
    setKey(root) {
      keyRoot = root;
    },
    setDelayTime(sec) {
      delay.delayTime.setValueAtTime(clamp(sec, 0.05, 1.4), ctx.currentTime);
    },
    // 把频谱压成 32 段给舞台灯光用，返回低频能量
    spectrum(out) {
      analyser.getByteFrequencyData(fftBins);
      const n = out ? out.length : bands.length;
      const target = out || bands;
      let bassE = 0;
      for (let i = 0; i < n; i++) {
        const a = Math.floor(Math.pow(i / n, 1.7) * 96);
        const b = Math.max(a + 1, Math.floor(Math.pow((i + 1) / n, 1.7) * 96));
        let s = 0;
        for (let k = a; k < b; k++) s += fftBins[k];
        target[i] = s / (b - a) / 255;
        if (i < 3) bassE += target[i];
      }
      return bassE / 3;
    },
  };
}
