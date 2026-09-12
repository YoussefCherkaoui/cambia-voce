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

      const a = Math.abs(s);
      this.env = a > this.env ? this.env*0.5 + a*0.5 : this.env*0.999;
      let targetGate = this.env > 0.002 ? 1.0 : 0.0;
      this.gateVal = this.gateVal * 0.995 + targetGate * 0.005;
      s *= this.gateVal;

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

      if(p.drive > 0) s = Math.tanh(s*k)/Math.tanh(k)*0.92 + s*0.08;

      if(p.comb > 0){
        const ri = (this.ci - cd + 4096) % 4096;
        s = s + this.comb[ri]*p.comb;
        this.comb[this.ci] = Math.tanh(s); 
        this.ci = (this.ci + 1) % 4096;
        s *= (1 - p.comb*0.4); 
      }

      if(p.ring > 0 && p.ringMix > 0){
        this.ringPhase += ringInc;
        if(this.ringPhase > TAU) this.ringPhase -= TAU;
        s = s*(1 - p.ringMix) + s*Math.sin(this.ringPhase)*p.ringMix;
      }

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
   2. Data & LocalStorage Setup
   ============================================================ */
const DEFAULT_PRESETS = [
  {id:'orco', nome:'Orco', desc:'Brutale e cavernosa. Perfetta per barbari o giganti.',
   p:{pitch:-7, ring:0, ringMix:0, comb:.15, combHz:80, crush:16, drive:.35}, f:{type:'lowpass', freq:1800, q:.7}},
  {id:'demone', nome:'Demone', desc:'Infernale e spaventosa, con vibrazione oscura.',
   p:{pitch:-10, ring:45, ringMix:.4, comb:.3, combHz:110, crush:15, drive:.5}, f:{type:'peaking', freq:900, q:1, gain:0}},
  {id:'drago', nome:'Drago Antico', desc:'Profonda, raschiante e leggermente distorta.',
   p:{pitch:-8, ring:15, ringMix:.15, comb:.25, combHz:60, crush:14, drive:.6}, f:{type:'lowpass', freq:1500, q:1}},
  {id:'goblin', nome:'Goblin', desc:'Acuta e nasale. Ideale per mostri subdoli o mercanti.',
   p:{pitch:7, ring:0, ringMix:0, comb:.1, combHz:600, crush:16, drive:.1}, f:{type:'bandpass', freq:2500, q:1}},
  {id:'mindflayer', nome:'Illithid', desc:'Telepatica, aliena e ronzante.',
   p:{pitch:-2, ring:180, ringMix:.6, comb:.3, combHz:220, crush:16, drive:.1}, f:{type:'peaking', freq:1200, q:1.5, gain:0}},
  {id:'cavaliere', nome:'Cavaliere', desc:'Ovattata e metallica, come dentro un elmo chiuso.',
   p:{pitch:0, ring:0, ringMix:0, comb:.4, combHz:350, crush:16, drive:.1}, f:{type:'bandpass', freq:800, q:1.5}},
  {id:'nano', nome:'Nano', desc:'Burbera e baritonale con una leggera risonanza toracica.',
   p:{pitch:-3, ring:0, ringMix:0, comb:.15, combHz:140, crush:16, drive:.2}, f:{type:'lowpass', freq:2200, q:.5}},
  {id:'lich', nome:'Lich', desc:'Gracchiante e corrotta dal tempo.',
   p:{pitch:-3, ring:0, ringMix:0, comb:.35, combHz:95, crush:7, drive:.45}, f:{type:'bandpass', freq:1600, q:1.5}},
  {id:'fata', nome:'Fata', desc:'Altissima e cristallina. Mantiene la voce pulita.',
   p:{pitch:9, ring:0, ringMix:0, comb:.05, combHz:800, crush:16, drive:0}, f:{type:'highpass', freq:400, q:.5}},
  {id:'dio', nome:'Entità Astrale', desc:'Maestosa e sdoppiata. Rimbombo onnipotente.',
   p:{pitch:-2, ring:110, ringMix:.25, comb:.25, combHz:350, crush:16, drive:.05}, f:{type:'lowpass', freq:2500, q:.5}},
];

// Caricamento memorie locali blindato
let customVoices = [];
try {
  const stored = localStorage.getItem('gdr_voices');
  if (stored) customVoices = JSON.parse(stored);
  if (!Array.isArray(customVoices)) customVoices = [];
} catch(e) {
  console.warn("Memoria del browser bloccata, avvio senza salvataggi precedenti.");
}

let ALL_PRESETS = [...DEFAULT_PRESETS, ...customVoices];

const FADERS = [
  {k:'pitch',  nome:'Tono (Gravità/Acutezza)', min:-12, max:12,  step:1,   fmt:v=> (v>0?'+':'')+v+' semitoni'},
  {k:'ring',   nome:'Frequenza Magica (Alien)',min:0,   max:300, step:1,   fmt:v=> v===0 ? 'spenta' : v+' Hz'},
  {k:'ringMix',nome:'Intensità Magia',         min:0,   max:1,   step:.05, fmt:v=> Math.round(v*100)+'%'},
  {k:'comb',   nome:'Risonanza Grotta/Elmo',   min:0,   max:.9,  step:.05, fmt:v=> Math.round(v/.9*100)+'%'},
  {k:'crush',  nome:'Deterioramento (Non-morte)',min:3, max:16,  step:1,   fmt:v=> v>=16 ? 'piena' : v+' bit'},
  {k:'drive',  nome:'Brutalità (Saturazione)', min:0,   max:1,   step:.05, fmt:v=> Math.round(v*100)+'%'},
];

/* ============================================================
   3. Logica Globale e Audio Routing
   ============================================================ */
const $ = s => document.querySelector(s);
let ctx, node, filter, outGain, monGain, limiter, inGain, playGain, analyser, inAnalyser, recDest, stream, recorder, micTrack;
let running = false, current = null, mode = 'ptt';
let params = {...ALL_PRESETS[0].p, out:1};
let chunks = [], takeN = 0, recPresetName = '';
let pttChunks = [], pttRec = null, holding = false, lastSource = null;

const screenEl = $('#screen'), badge = $('#badgeText'), errBox = $('#err');

function fail(msg) { errBox.textContent = msg; errBox.style.display = 'block'; }

async function start() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
  } catch(e) {
    fail('Il Grimorio non ha accesso al microfono. Verifica i permessi del browser.');
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
  badge.textContent = mode === 'live' ? 'Incanto Attivo' : 'Pronto';
  $('#power').textContent = 'Chiudi Sigillo';
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
  badge.textContent = 'Sigillo Chiuso';
  $('#power').textContent = 'Apri Sigillo (Attiva Mic)';
  $('#power').classList.add('go');
  $('#rec').disabled = true;
  
  const pt = $('#ptt');
  pt.disabled = true; pt.classList.remove('held','playing');
  pt.textContent = 'Premi e Recita la Battuta';
}

function apply() {
  if(!running) return;
  node.port.postMessage(params);
  const f = (current || ALL_PRESETS[0]).f;
  filter.type = f.type;
  filter.frequency.value = f.freq;
  filter.Q.value = f.q;
  if(f.type === 'peaking') filter.gain.value = f.gain || 0;
}

/* ============================================================
   4. Gestione UI (Presets, Custom, Salvataggi)
   ============================================================ */
const presetBox = $('#presets');

function renderPresets() {
  presetBox.innerHTML = '';
  ALL_PRESETS.forEach((pr) => {
    const b = document.createElement('button');
    b.className = 'preset';
    b.setAttribute('aria-pressed', (current && current.id === pr.id) ? 'true' : 'false');
    
    let html = `<span class="lamp"></span><span>${pr.nome}</span>`;
    if(pr.isCustom) {
      html += `<button class="del-btn" title="Dimentica voce">&times;</button>`;
    }
    b.innerHTML = html;
    
    b.onclick = (e) => {
      if(e.target.classList.contains('del-btn')){
        deleteVoice(pr.id, e);
      } else {
        selectPreset(pr);
      }
    };
    presetBox.appendChild(b);
  });
}

function selectPreset(pr) {
  current = pr;
  params = {...pr.p, out:1};
  renderPresets();
  $('#presetDesc').textContent = pr.desc;
  syncFaders();
  apply();
}

function deleteVoice(id, e) {
  e.stopPropagation();
  if(!confirm("Cancellare questa voce dal grimorio?")) return;
  customVoices = customVoices.filter(v => v.id !== id);
  ALL_PRESETS = [...DEFAULT_PRESETS, ...customVoices];
  
  try {
    localStorage.setItem('gdr_voices', JSON.stringify(customVoices));
  } catch(err) {}

  if(current && current.id === id) selectPreset(ALL_PRESETS[0]);
  else renderPresets();
}

// Sistema di salvataggio a prova di Form e Mobile
$('#saveForm').addEventListener('submit', (e) => {
  e.preventDefault(); // Evita il ricaricamento della pagina
  const input = $('#customName');
  const name = input.value.trim();
  
  if(!name) return;
  
  const newVoice = {
    id: 'custom_' + Date.now(),
    nome: name,
    desc: 'Evocazione personalizzata. Creata dalle tue regolazioni.',
    p: { ...params },
    f: { ...(current ? current.f : ALL_PRESETS[0].f) },
    isCustom: true
  };
  
  customVoices.push(newVoice);
  ALL_PRESETS = [...DEFAULT_PRESETS, ...customVoices];
  
  try {
    localStorage.setItem('gdr_voices', JSON.stringify(customVoices));
  } catch (err) {
    console.warn("Il browser impedisce il salvataggio permanente.");
  }
  
  input.value = '';
  input.blur(); // Nasconde la tastiera su mobile
  selectPreset(newVoice);
});

const faderBox = $('#faders'), inputs = {};
FADERS.forEach(f => {
  const wrap = document.createElement('div');
  wrap.className = 'fader';
  wrap.innerHTML = `<label for="f_${f.k}"><span>${f.nome}</span><b id="v_${f.k}"></b></label>`;
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

/* ============================================================
   5. Oscilloscopio e Registrazione Audio
   ============================================================ */
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
  g2.strokeStyle = 'rgba(212, 175, 55, 0.15)'; 
  g2.lineWidth = 1;
  g2.beginPath(); g2.moveTo(0, mid); g2.lineTo(W, mid); g2.stroke();

  g2.strokeStyle = '#d4af37';
  g2.lineWidth = 2;
  g2.shadowColor = 'rgba(139,0,0,0.8)';
  g2.shadowBlur = 10;
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
    btn.textContent = 'Registra';
    btn.classList.remove('armed');
    badge.textContent = 'in ascolto';
    return;
  }
  chunks = [];
  recPresetName = (current || ALL_PRESETS[0]).nome;
  recorder = new MediaRecorder(recDest.stream);
  recorder.ondataavailable = e => e.data.size && chunks.push(e.data);
  recorder.onstop = () => addTake(new Blob(chunks, {type: recorder.mimeType}));
  recorder.start();
  btn.textContent = 'Ferma Acquisizione';
  btn.classList.add('armed');
  badge.textContent = 'registrando';
}

function addTake(blob) {
  const url = URL.createObjectURL(blob);
  const ext = blob.type.includes('mp4') ? 'm4a' : 'webm';
  const li = document.createElement('li');
  const who = document.createElement('span');
  who.className = 'who';
  who.textContent = recPresetName + ' (' + (++takeN) + ')';
  
  const au = document.createElement('audio'); au.controls = true; au.src = url;
  const dl = document.createElement('a');
  dl.href = url; dl.download = 'GDR-' + recPresetName.replace(/\s+/g, '-').toLowerCase() + '-' + takeN + '.' + ext;
  dl.textContent = 'Scarica';
  
  li.append(who, au, dl);
  $('#takes').prepend(li);
  $('#empty').style.display = 'none';
}

$('#power').onclick = () => running ? stop() : start();
$('#rec').onclick = toggleRec;

function setMode(m) {
  const wasRunning = running;
  if(wasRunning) stop();
  mode = m;
  $('#mPtt').setAttribute('aria-pressed', m === 'ptt');
  $('#mLive').setAttribute('aria-pressed', m === 'live');
  $('#ptt').hidden = (m !== 'ptt');
  $('#aecWrap').hidden = (m !== 'live');
  if(wasRunning) start();
}

$('#mPtt').onclick  = () => setMode('ptt');
$('#mLive').onclick = () => setMode('live');
$('#aec').onchange  = () => { if(running){ stop(); start(); } };

/* ============================================================
   6. Funzione PTT (Push to Talk)
   ============================================================ */
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
  pttBtn.textContent = 'Parla ora...';
  badge.textContent = 'assorbendo';
}

function pttEnd(e) {
  if(!holding) return;
  e.preventDefault();
  holding = false;
  pttRec && pttRec.state === 'recording' && pttRec.stop();
  pttBtn.classList.remove('held');
  pttBtn.textContent = 'Rilascio magia...';
}

async function playBack() {
  const blob = new Blob(pttChunks, {type: pttRec.mimeType || 'audio/webm'});
  if(blob.size < 1500) {
    fail('Nessun suono captato. Avvicinati e parla durante la pressione.');
    resetPtt(); return;
  }
  inGain.gain.setTargetAtTime(0, ctx.currentTime, .01);
  if(micTrack) micTrack.enabled = false;

  const player = $('#player');
  player.src = URL.createObjectURL(blob);
  player.volume = 1;
  pttBtn.classList.add('playing');
  pttBtn.textContent = 'In riproduzione...';
  badge.textContent = 'evocando';
  player.onended = resetPtt;
  player.onerror = () => { fail('Errore audio.'); resetPtt(); };
  try {
    await player.play();
    errBox.style.display = 'none';
  } catch(err) { resetPtt(); }
}

function resetPtt() {
  if(!running) return;
  if(micTrack) micTrack.enabled = true;
  inGain.gain.setTargetAtTime(1, ctx.currentTime, .05);
  pttBtn.classList.remove('held','playing');
  pttBtn.textContent = 'Premi e Recita la Battuta';
  badge.textContent = 'Pronto';
}

pttBtn.addEventListener('pointerdown', pttStart);
pttBtn.addEventListener('pointerup', pttEnd);
pttBtn.addEventListener('pointercancel', pttEnd);
pttBtn.addEventListener('pointerleave', pttEnd);
pttBtn.addEventListener('contextmenu', e => e.preventDefault());

// Setup Iniziale
selectPreset(ALL_PRESETS[0]); 
setMode('ptt');
