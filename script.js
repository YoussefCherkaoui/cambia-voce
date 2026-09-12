/* ============================================================
   1. Motore Audio (AudioWorklet Processor)
   ============================================================ */
const workletSrc = `
class VoiceFX extends AudioWorkletProcessor {
  constructor(){
    super();
    this.N = 2048; 
    this.buf = new Float32Array(this.N);
    this.w = 0; this.off = 0;
    this.ringPhase = 0;
    this.comb = new Float32Array(4096); this.ci = 0;
    this.hold = 0; this.holdCount = 0;
    this.env = 0; this.gateVal = 1;
    this.p = {pitch:0, ring:0, ringMix:0, comb:0, combHz:250, crush:16, drive:0, out:1};
    this.port.onmessage = e => Object.assign(this.p, e.data);
  }
  tap(off){
    const N = this.N;
    let r = this.w - off; while(r < 0) r += N;
    const i0 = Math.floor(r) % N, i1 = (i0 + 1) % N, f = r - Math.floor(r);
    return this.buf[i0]*(1-f) + this.buf[i1]*f;
  }
  process(inputs, outputs){
    const input = inputs[0], output = outputs[0];
    if(!input || !input[0] || !output || !output[0]) return true;
    const x = input[0], y = output[0], p = this.p;
    const N = this.N, half = N/2;
    const drift = Math.pow(2, p.pitch/12) - 1;
    const TAU = Math.PI*2;
    const ringInc = TAU * p.ring / sampleRate;
    const cd = Math.max(2, Math.min(4000, Math.floor(sampleRate / Math.max(40, p.combHz))));
    const levels = Math.pow(2, p.crush) - 1;
    const srDiv = p.crush < 16 ? Math.max(1, Math.floor((16 - p.crush)/2)) : 1;
    const k = p.drive*10 + 1; 

    for(let i=0; i<x.length; i++){
      let s = x[i];

      // Noise Gate Fluido
      const a = Math.abs(s);
      this.env = a > this.env ? this.env*0.5 + a*0.5 : this.env*0.999;
      let targetGate = this.env > 0.002 ? 1.0 : 0.0;
      this.gateVal = this.gateVal * 0.995 + targetGate * 0.005;
      s *= this.gateVal;

      // Pitch Shift
      this.buf[this.w] = s;
      if(p.pitch !== 0){
        this.off -= drift;
        while(this.off < 0) this.off += N;
        while(this.off >= N) this.off -= N;
        const u = this.off / N;
        const g1 = Math.sin(Math.PI*u);            
        const g2 = Math.abs(Math.cos(Math.PI*u));  
        s = this.tap(this.off)*g1 + this.tap((this.off + half) % N)*g2;
      }
      this.w = (this.w + 1) % N;

      // Saturazione
      if(p.drive > 0) s = Math.tanh(s*k)/Math.tanh(k)*0.92 + s*0.08;

      // Comb Filter (Metallo/Rimbombo con Limiter integrato)
      if(p.comb > 0){
        const ri = (this.ci - cd + 4096) % 4096;
        s = s + this.comb[ri]*p.comb;
        this.comb[this.ci] = Math.tanh(s); 
        this.ci = (this.ci + 1) % 4096;
        s *= (1 - p.comb*0.4); 
      }

      // Ring Modulation (Voce Robot/Aliena)
      if(p.ring > 0 && p.ringMix > 0){
        this.ringPhase += ringInc;
        if(this.ringPhase > TAU) this.ringPhase -= TAU;
        s = s*(1 - p.ringMix) + s*Math.sin(this.ringPhase)*p.ringMix;
      }

      // Bitcrusher (Invecchiamento Voce)
      if(p.crush < 16){
        if(this.holdCount % srDiv === 0) this.hold = Math.round(s*levels)/levels;
        this.holdCount++;
        s = this.hold;
      }

      y[i] = Math.max(-1, Math.min(1, s*p.out));
    }
    for(let c=1; c<output.length; c++) output[c].set(y);
    return true;
  }
}
registerProcessor('voice-fx', VoiceFX);
`;

/* ============================================================
   2. Personaggi Fantasy e Parametri Interfaccia
   ============================================================ */
const PRESETS = [
  {id:'orco', nome:'Orco / Gigante', desc:'Voce profonda, brutale e cavernosa. Perfetta per barbari, orchi o creature enormi.',
   p:{pitch:-7, ring:0, ringMix:0, comb:.15, combHz:80, crush:16, drive:.35}, f:{type:'lowpass', freq:1800, q:.7}},
  {id:'demone', nome:'Demone', desc:'Infernale e spaventosa. Un mix tra tono bassissimo e una vibrazione metallica oscura.',
   p:{pitch:-10, ring:45, ringMix:.4, comb:.3, combHz:110, crush:15, drive:.5}, f:{type:'peaking', freq:900, q:1, gain:0}},
  {id:'goblin', nome:'Goblin', desc:'Acuta, nasale e fastidiosa. Ideale per piccoli mostri subdoli o mercanti truffaldini.',
   p:{pitch:7, ring:0, ringMix:0, comb:.1, combHz:600, crush:16, drive:.1}, f:{type:'bandpass', freq:2500, q:1}},
  {id:'fata', nome:'Fata / Pixie', desc:'Altissima e cristallina. Mantiene la voce pulita ma la trasporta in un mondo magico.',
   p:{pitch:9, ring:0, ringMix:0, comb:.05, combHz:800, crush:16, drive:0}, f:{type:'highpass', freq:400, q:.5}},
  {id:'lich', nome:'Lich / Scheletro', desc:'Voce antica, gracchiante e corrotta dal tempo. Perfetta per necromanti e non-morti.',
   p:{pitch:-3, ring:0, ringMix:0, comb:.35, combHz:95, crush:7, drive:.45}, f:{type:'bandpass', freq:1600, q:1.5}},
  {id:'golem', nome:'Golem', desc:'Pesante, meccanica e risonante. Come se parlassi attraverso tonnellate di roccia.',
   p:{pitch:-5, ring:70, ringMix:.35, comb:.4, combHz:180, crush:16, drive:.2}, f:{type:'lowpass', freq:1200, q:.8}},
  {id:'spirito', nome:'Spettro', desc:'Eterea, tremolante e con un rimbombo vuoto. Ottima per apparizioni e fantasmi.',
   p:{pitch:-1, ring:12, ringMix:.4, comb:.65, combHz:130, crush:16, drive:0}, f:{type:'peaking', freq:1000, q:1, gain:0}},
  {id:'dio', nome:'Entità Divina', desc:'Maestosa e sdoppiata. Una modulazione armonica che dà un senso di onnipotenza.',
   p:{pitch:-2, ring:110, ringMix:.25, comb:.25, combHz:350, crush:16, drive:.05}, f:{type:'lowpass', freq:2500, q:.5}},
];

const FADERS = [
  {k:'pitch',  nome:'Tono',        min:-12, max:12,  step:1,   fmt:v=> (v>0?'+':'')+v+' semitoni'},
  {k:'ring',   nome:'Vibrazione',  min:0,   max:300, step:1,   fmt:v=> v===0 ? 'spenta' : v+' Hz'},
  {k:'ringMix',nome:'Quantità',    min:0,   max:1,   step:.05, fmt:v=> Math.round(v*100)+'%'},
  {k:'comb',   nome:'Rimbombo',    min:0,   max:.9,  step:.05, fmt:v=> Math.round(v/.9*100)+'%'},
  {k:'crush',  nome:'Corruzione',  min:3,   max:16,  step:1,   fmt:v=> v>=16 ? 'piena' : v+' bit'},
  {k:'drive',  nome:'Cattiveria',  min:0,   max:1,   step:.05, fmt:v=> Math.round(v*100)+'%'},
];

/* ============================================================
   3. Logica e Routing di Sistema
   ============================================================ */
let ctx, node, filter, outGain, monGain, limiter, inGain, playGain, analyser, inAnalyser, recDest, stream, recorder, micTrack;
let running = false, current = null, mode = 'ptt';
let params = {...PRESETS[0].p, out:1};
let chunks = [], takeN = 0, recPresetName = '';
let pttChunks = [], pttRec = null, holding = false, lastSource = null;

const $ = s => document.querySelector(s);
const screenEl = $('#screen'), badge = $('#badgeText'), errBox = $('#err');

function fail(msg) { errBox.textContent = msg; errBox.style.display = 'block'; }

async function start() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
  } catch(e) {
    fail('Microfono non autorizzato o non trovato. Verifica i permessi del browser.');
    return;
  }

  ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint:'interactive' });
  const url = URL.createObjectURL(new Blob([workletSrc], {type:'application/javascript'}));
  await ctx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);

  const src = ctx.createMediaStreamSource(stream);
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 100;

  inGain  = ctx.createGain(); inGain.gain.value = 1;
  node    = new AudioWorkletNode(ctx, 'voice-fx', {numberOfInputs:1, numberOfOutputs:1, outputChannelCount:[1]});
  filter  = ctx.createBiquadFilter();
  outGain = ctx.createGain(); outGain.gain.value = 1;
  monGain = ctx.createGain(); monGain.gain.value = (mode === 'live') ? 0.85 : 0;
  playGain = ctx.createGain();
  analyser = ctx.createAnalyser(); analyser.fftSize = 2048;
  recDest = ctx.createMediaStreamDestination();

  limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3; limiter.knee.value = 0;
  limiter.ratio.value = 20; limiter.attack.value = .001; limiter.release.value = .1;

  src.connect(hp).connect(inGain).connect(node).connect(filter).connect(outGain);
  inAnalyser = ctx.createAnalyser(); inAnalyser.fftSize = 1024;
  hp.connect(inAnalyser);
  micTrack = stream.getAudioTracks()[0];
  
  outGain.connect(analyser);
  outGain.connect(recDest);
  outGain.connect(monGain).connect(limiter);
  
  playGain.connect(analyser);
  playGain.connect(limiter);
  limiter.connect(ctx.destination);

  const unlock = ctx.createBufferSource();
  unlock.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
  unlock.connect(ctx.destination); unlock.start();

  await ctx.resume();
  running = true;
  apply();
  screenEl.classList.add('on');
  badge.textContent = mode === 'live' ? 'in diretta' : 'pronto';
  $('#power').textContent = 'Ferma Setup';
  $('#power').classList.remove('go');
  $('#rec').disabled = false;
  $('#ptt').disabled = (mode !== 'ptt');
  draw();
}

function stop() {
  if(recorder && recorder.state === 'recording') toggleRec();
  stream && stream.getTracks().forEach(t => t.stop());
  ctx && ctx.close();
  running = false;
  screenEl.classList.remove('on');
  badge.textContent = 'microfono spento';
  $('#power').textContent = 'Attiva microfono';
  $('#power').classList.add('go');
  $('#rec').disabled = true;
  
  const pt = $('#ptt');
  pt.disabled = true; pt.classList.remove('held','playing');
  pt.textContent = 'Tieni premuto e parla';
}

function apply() {
  if(!running) return;
  node.port.postMessage(params);
  const f = (current || PRESETS[0]).f;
  filter.type = f.type;
  filter.frequency.value = f.freq;
  filter.Q.value = f.q;
  if(f.type === 'peaking') filter.gain.value = f.gain || 0;
}

/* ============================================================
   4. Gestione UI (Presets, Faders, Scope, Recording)
   ============================================================ */
const presetBox = $('#presets');
PRESETS.forEach((pr, i) => {
  const b = document.createElement('button');
  b.className = 'preset';
  b.setAttribute('aria-pressed', i === 0 ? 'true' : 'false');
  b.innerHTML = '<span class="lamp"></span><span>' + pr.nome + '</span>';
  b.onclick = () => selectPreset(pr);
  presetBox.appendChild(b);
});

function selectPreset(pr) {
  current = pr;
  params = {...pr.p, out:1};
  [...presetBox.children].forEach((b, i) => b.setAttribute('aria-pressed', PRESETS[i].id === pr.id ? 'true' : 'false'));
  $('#presetDesc').textContent = pr.desc;
  syncFaders();
  apply();
}

const faderBox = $('#faders'), inputs = {};
FADERS.forEach(f => {
  const wrap = document.createElement('div');
  wrap.className = 'fader';
  wrap.innerHTML = '<label for="f_'+f.k+'"><span>'+f.nome+'</span><b id="v_'+f.k+'"></b></label>';
  const r = document.createElement('input');
  r.type = 'range'; r.id = 'f_'+f.k; r.min = f.min; r.max = f.max; r.step = f.step;
  r.oninput = () => {
    params[f.k] = parseFloat(r.value);
    $('#v_'+f.k).textContent = f.fmt(params[f.k]);
    apply();
  };
  inputs[f.k] = r;
  wrap.appendChild(r);
  faderBox.appendChild(wrap);
});

function syncFaders() {
  FADERS.forEach(f => {
    inputs[f.k].value = params[f.k];
    $('#v_'+f.k).textContent = f.fmt(params[f.k]);
  });
}

const cvs = $('#scope'), g2 = cvs.getContext('2d');
function fit() {
  const dpr = window.devicePixelRatio || 1;
  cvs.width = cvs.clientWidth * dpr;
  cvs.height = cvs.clientHeight * dpr;
  g2.setTransform(dpr, 0, 0, dpr, 0, 0);
}
addEventListener('resize', fit); fit();

function draw() {
  if(!running) return;
  requestAnimationFrame(draw);
  const n = analyser.fftSize, data = new Float32Array(n);
  analyser.getFloatTimeDomainData(data);
  const W = cvs.clientWidth, H = cvs.clientHeight, mid = H/2;

  g2.clearRect(0, 0, W, H);
  g2.strokeStyle = 'rgba(120,150,90,.11)';
  g2.lineWidth = 1;
  g2.beginPath(); g2.moveTo(0, mid); g2.lineTo(W, mid); g2.stroke();

  g2.strokeStyle = '#e8801f';
  g2.lineWidth = 2;
  g2.shadowColor = 'rgba(232,128,31,.55)';
  g2.shadowBlur = 9;
  g2.beginPath();
  for(let i=0; i<n; i++){
    const x = i/(n-1)*W;
    const y = mid - data[i]*mid*0.94;
    i ? g2.lineTo(x, y) : g2.moveTo(x, y);
  }
  g2.stroke();
  g2.shadowBlur = 0;

  if(inAnalyser){
    const d2 = new Float32Array(inAnalyser.fftSize);
    inAnalyser.getFloatTimeDomainData(d2);
    let sum = 0;
    for(let i=0; i<d2.length; i++) sum += d2[i]*d2[i];
    const rms = Math.sqrt(sum/d2.length);
    $('#lvFill').style.width = Math.min(100, rms*320) + '%';
  }
}

function toggleRec() {
  const btn = $('#rec');
  if(recorder && recorder.state === 'recording'){
    recorder.stop();
    btn.textContent = 'Registra Sessione';
    btn.classList.remove('armed');
    badge.textContent = 'in ascolto';
    return;
  }
  chunks = [];
  recPresetName = (current || PRESETS[0]).nome;
  recorder = new MediaRecorder(recDest.stream);
  recorder.ondataavailable = e => e.data.size && chunks.push(e.data);
  recorder.onstop = () => addTake(new Blob(chunks, {type: recorder.mimeType}));
  recorder.start();
  btn.textContent = 'Ferma Registrazione';
  btn.classList.add('armed');
  badge.textContent = 'sto registrando';
}

function addTake(blob) {
  const url = URL.createObjectURL(blob);
  const ext = blob.type.includes('mp4') ? 'm4a' : 'webm';
  const li = document.createElement('li');
  const who = document.createElement('span');
  who.className = 'who';
  who.textContent = recPresetName + ' (Take ' + (++takeN) + ')';
  
  const au = document.createElement('audio'); au.controls = true; au.src = url;
  const dl = document.createElement('a');
  dl.href = url; dl.download = 'GDR-Voce-' + recPresetName.replace(/\s+/g, '-').toLowerCase() + '-' + takeN + '.' + ext;
  dl.textContent = 'Salva File';
  
  li.append(who, au, dl);
  $('#takes').prepend(li);
  $('#empty').style.display = 'none';
}

$('#power').onclick = () => running ? stop() : start();
$('#rec').onclick = toggleRec;
$('#beep').onclick = async () => {
  if(!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  await ctx.resume();
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine'; o.frequency.value = 520;
  g.gain.setValueAtTime(0, ctx.currentTime);
  g.gain.linearRampToValueAtTime(.35, ctx.currentTime + .02);
  g.gain.linearRampToValueAtTime(0, ctx.currentTime + .5);
  o.connect(g).connect(ctx.destination);
  o.start(); o.stop(ctx.currentTime + .55);
};

function setMode(m) {
  const wasRunning = running;
  if(wasRunning) stop();
  mode = m;
  $('#mPtt').setAttribute('aria-pressed', m === 'ptt');
  $('#mLive').setAttribute('aria-pressed', m === 'live');
  $('#ptt').hidden = (m !== 'ptt');
  $('#aecWrap').hidden = (m !== 'live');
  $('#tip').textContent = m === 'ptt'
    ? 'La voce uscirà appena rilasci il pulsante. Perfetto per preparare la battuta senza sovrapposizioni.'
    : 'MODALITÀ MASTER: Usa per forza le cuffie, altrimenti si creeranno rimbombi e ritorni molesti durante il gioco.';
  if(wasRunning) start();
}

$('#mPtt').onclick  = () => setMode('ptt');
$('#mLive').onclick = () => setMode('live');
$('#aec').onchange  = () => { if(running){ stop(); start(); } };

const pttBtn = $('#ptt');
function pttStart(e) {
  if(!running || holding || pttBtn.disabled) return;
  e.preventDefault();
  if(lastSource){ try{ lastSource.stop(); }catch(_){} lastSource = null; }
  holding = true;
  inGain.gain.setTargetAtTime(1, ctx.currentTime, .01);
  pttChunks = [];
  pttRec = new MediaRecorder(recDest.stream);
  pttRec.ondataavailable = ev => ev.data.size && pttChunks.push(ev.data);
  pttRec.onstop = playBack;
  pttRec.start();
  pttBtn.classList.add('held');
  pttBtn.textContent = 'Stai interpretando...';
  badge.textContent = 'ruolando';
}

function pttEnd(e) {
  if(!holding) return;
  e.preventDefault();
  holding = false;
  pttRec && pttRec.state === 'recording' && pttRec.stop();
  pttBtn.classList.remove('held');
  pttBtn.textContent = 'Lancio l\'audio...';
}

async function playBack() {
  const blob = new Blob(pttChunks, {type: pttRec.mimeType || 'audio/webm'});
  if(blob.size < 1500) {
    fail('Nessun audio registrato. Tieni premuto mentre reciti la battuta.');
    resetPtt(); return;
  }
  inGain.gain.setTargetAtTime(0, ctx.currentTime, .01);
  if(micTrack) micTrack.enabled = false;

  const player = $('#player');
  player.src = URL.createObjectURL(blob);
  player.volume = 1;
  pttBtn.classList.add('playing');
  pttBtn.textContent = 'Il tavolo sta ascoltando...';
  badge.textContent = 'riproduzione';
  player.onended = resetPtt;
  player.onerror = () => {
    fail('Errore di riproduzione nel browser. Usa la Diretta Continua con le cuffie.');
    resetPtt();
  };
  try {
    await player.play();
    errBox.style.display = 'none';
  } catch(err) {
    fail('Riproduzione bloccata. Clicca di nuovo il bottone.');
    resetPtt();
  }
}

function resetPtt() {
  if(!running) return;
  if(micTrack) micTrack.enabled = true;
  inGain.gain.setTargetAtTime(1, ctx.currentTime, .05);
  pttBtn.classList.remove('held','playing');
  pttBtn.textContent = 'Tieni premuto e parla';
  badge.textContent = 'pronto';
}

pttBtn.addEventListener('pointerdown', pttStart);
pttBtn.addEventListener('pointerup', pttEnd);
pttBtn.addEventListener('pointercancel', pttEnd);
pttBtn.addEventListener('pointerleave', pttEnd);
pttBtn.addEventListener('contextmenu', e => e.preventDefault());

setMode('ptt');
selectPreset(PRESETS[0]);
