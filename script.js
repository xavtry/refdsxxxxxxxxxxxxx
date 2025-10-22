// Pixel Sniper - single-file game logic
// Plays in canvas. Click to shoot moving targets. Local highscore saved.

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });
const SCORE = document.getElementById('score');
const TIME = document.getElementById('time');
const AMMO = document.getElementById('ammo');
const START = document.getElementById('startBtn');
const PAUSE = document.getElementById('pauseBtn');
const MUTE = document.getElementById('mutebtn');
const HIGHSCORE = document.getElementById('highscore');

ctx.imageSmoothingEnabled = false; // crisp pixels

// Logical canvas resolution - we draw blocky "big pixels" by scaling down then using CSS to enlarge.
// But here we keep a fixed resolution and let canvas CSS scale it (index.html sets width/height).
const W = canvas.width;
const H = canvas.height;

// Pixel style: each game "pixel" = PIX px on screen. We'll draw shapes as multiples of PIX for chunky look.
const PIX = 16; // bigger = chunkier

// Game state
let running = false;
let paused = false;
let score = 0;
let timeLeft = 60; // seconds per run
let ammo = 10;
let highscore = Number(localStorage.getItem('ps-highscore') || 0);
HIGHSCORE.textContent = highscore;

let targets = [];
let lastSpawn = 0;
let spawnInterval = 1000; // ms - adjustable
let lastTime = performance.now();
let muted = false;

// Target class
class Target {
  constructor(x, y, vx, vy, size, color, points){
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.size = size; // in "pixels" (multiples of PIX)
    this.color = color;
    this.points = points;
    this.alive = true;
    this.wob = Math.random()*1000;
  }
  update(dt){
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    // bounce on edges (keep inside play area margin)
    const margin = PIX*2;
    if(this.x < margin){ this.x = margin; this.vx *= -1; }
    if(this.x > W - margin - this.size*PIX){ this.x = W - margin - this.size*PIX; this.vx *= -1; }
    if(this.y < margin){ this.y = margin; this.vy *= -1; }
    if(this.y > H - margin - this.size*PIX){ this.y = H - margin - this.size*PIX; this.vy *= -1; }
  }
  draw(ctx){
    // draw blocky target (a simple square + bullseye) using grid of PIX squares
    const px = Math.round(this.x);
    const py = Math.round(this.y);
    // outer
    ctx.fillStyle = this.color;
    ctx.fillRect(px, py, this.size*PIX, this.size*PIX);
    // inner bull (contrasting)
    ctx.fillStyle = '#000';
    const inner = Math.max(1, Math.floor(this.size*PIX/4));
    ctx.fillRect(px + inner, py + inner, this.size*PIX - inner*2, this.size*PIX - inner*2);
    ctx.fillStyle = '#fff';
    const center = Math.max(1, Math.floor(this.size*PIX/8));
    ctx.fillRect(px + inner + center, py + inner + center, center*2, center*2);
  }
  contains(px, py){
    return px >= this.x && px <= this.x + this.size*PIX && py >= this.y && py <= this.y + this.size*PIX;
  }
}

// Helper: spawn targets with varying speed and points
function spawnTarget(difficulty = 1){
  // random side spawn or inside
  const margin = PIX*3;
  const size = Math.random() < 0.2 ? 3 : (Math.random() < 0.4 ? 2 : 1); // 1..3
  const y = margin + Math.random() * (H - margin*2 - size*PIX);
  const x = margin + Math.random() * (W - margin*2 - size*PIX);
  // velocity
  const speedBase = 0.05 + difficulty*0.03; // pixels per ms
  const angle = Math.random() * Math.PI * 2;
  const vx = Math.cos(angle) * speedBase * (Math.random()*1.6 + 0.4);
  const vy = Math.sin(angle) * speedBase * (Math.random()*1.6 + 0.4);
  const colors = ['#ff6b6b','#ffd86b','#6bffb8','#6bd0ff','#c26bff'];
  const color = colors[Math.floor(Math.random()*colors.length)];
  const points = size === 3 ? 30 : size === 2 ? 15 : 5;
  const t = new Target(x,y,vx,vy,size,color,points);
  targets.push(t);
}

// Input: mouse click
canvas.addEventListener('pointerdown', (ev)=>{
  if(!running || paused) return;
  if(ammo <= 0){
    // play empty click?
    return;
  }
  ammo--;
  AMMO.textContent = ammo;
  // compute canvas-space click coords (canvas scaled in CSS maybe)
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = (ev.clientX - rect.left) * scaleX;
  const y = (ev.clientY - rect.top) * scaleY;

  // tiny bullet "lag" / spread could be added, but we'll check direct hit
  // check highest points first -> target list order
  for(let i = targets.length - 1; i >= 0; i--){
    const t = targets[i];
    if(t.alive && t.contains(x, y)){
      // hit
      score += t.points;
      SCORE.textContent = score;
      t.alive = false;
      // pop sound
      if(!muted) playPop();
      // remove after
      targets.splice(i,1);
      return;
    }
  }
  // if missed, play shot sound
  if(!muted) playShot();
});

// Keyboard: R to reload
window.addEventListener('keydown', (e)=>{
  if(e.key === 'r' || e.key === 'R'){
    if(running && !paused){
      reload();
    }
  } else if(e.key === 'p' || e.key === 'P'){
    togglePause();
  } else if(e.key === 'm' || e.key === 'M'){
    toggleMute();
  }
});

// UI buttons
START.addEventListener('click', ()=>{ if(!running) startGame(); else restartGame(); });
PAUSE.addEventListener('click', togglePause);
MUTE.addEventListener('click', toggleMute);

function toggleMute(){
  muted = !muted; MUTE.textContent = muted ? 'Unmute' : 'Mute';
}
function togglePause(){
  if(!running) return;
  paused = !paused;
  PAUSE.textContent = paused ? 'Resume' : 'Pause';
}
function reload(){
  ammo = 10;
  AMMO.textContent = ammo;
  // reload sound could be added
}

// Sounds - tiny generated beep using WebAudio (no external files)
let audioCtx = null;
function ensureAudio(){
  if(audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch(e){}
}
function playShot(){
  ensureAudio();
  if(!audioCtx) return;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.connect(g); g.connect(audioCtx.destination);
  o.type = 'square';
  o.frequency.value = 700;
  g.gain.value = 0.05;
  o.start(); o.stop(audioCtx.currentTime + 0.08);
}
function playPop(){
  ensureAudio();
  if(!audioCtx) return;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.connect(g); g.connect(audioCtx.destination);
  o.type = 'sine';
  o.frequency.value = 1100;
  g.gain.value = 0.06;
  o.start(); o.stop(audioCtx.currentTime + 0.06);
}

// Start / Stop
function startGame(){
  running = true; paused = false;
  score = 0; SCORE.textContent = score;
  timeLeft = 60; TIME.textContent = timeLeft;
  ammo = 10; AMMO.textContent = ammo;
  targets = [];
  lastSpawn = 0; spawnInterval = 1100;
  lastTime = performance.now();
  START.textContent = 'Restart';
  PAUSE.textContent = 'Pause';
  // pre-spawn a few
  for(let i=0;i<4;i++) spawnTarget(1);
}

function restartGame(){
  running = false;
  startGame();
}

// Game loop
function update(now){
  if(!running || paused){ lastTime = now; requestAnimationFrame(update); return; }
  const dt = now - lastTime; // ms
  lastTime = now;

  // timers
  lastSpawn += dt;
  if(lastSpawn > spawnInterval){
    spawnTarget(1 + Math.min(3, Math.floor((60 - timeLeft)/15))); // scale difficulty as time passes
    lastSpawn = 0;
    // slowly tighten spawn interval
    spawnInterval = Math.max(350, spawnInterval - 6);
  }

  // update targets
  for(let i = targets.length - 1; i >= 0; i--){
    const t = targets[i];
    t.update(dt);
    if(!t.alive){
      targets.splice(i,1);
    }
  }

  // countdown
  // reduce time gradually
  timeLeft -= dt / 1000;
  if(timeLeft <= 0){
    endGame();
  }
  // update UI with integer seconds
  TIME.textContent = Math.ceil(Math.max(0, timeLeft));

  // auto-regenerate small ammo (every few seconds)
  // (optional) -> not automatically in this version: press R to reload

  render();
  requestAnimationFrame(update);
}

function endGame(){
  running = false;
  paused = false;
  // update highscore
  if(score > highscore){
    highscore = score;
    localStorage.setItem('ps-highscore', highscore);
    HIGHSCORE.textContent = highscore;
  }
  // show result overlay
  setTimeout(()=> {
    alert(`Time! You scored ${score} points.` + (score >= highscore ? ' NEW HIGHSCORE!' : ''));
  }, 50);
}

function render(){
  // clear in pixelated blocks (no alpha)
  ctx.fillStyle = '#07101a';
  ctx.fillRect(0,0,W,H);

  // background grid (subtle)
  for(let gx = 0; gx < W; gx += PIX*4){
    for(let gy = 0; gy < H; gy += PIX*4){
      ctx.fillStyle = ( (gx+gy) % (PIX*8) === 0 ) ? '#0c2230' : '#08161f';
      ctx.fillRect(gx, gy, PIX*4, PIX*4);
    }
  }

  // Draw targets
  targets.forEach(t => t.draw(ctx));

  // Draw HUD (big pixel crosshair and muzzle flash if desired)
  drawCrosshair();
}

function drawCrosshair(){
  // crosshair follows pointer if available, else center
  // we will track pointer position stored global
  if(lastPointer.x === null) return;
  const x = lastPointer.x * (canvas.width / lastPointer.rectW);
  const y = lastPointer.y * (canvas.height / lastPointer.rectH);

  // draw chunky crosshair (three rectangles)
  ctx.fillStyle = '#000';
  ctx.fillRect(x-12, y-3, 24, 6);
  ctx.fillRect(x-3, y-12, 6, 24);
  ctx.fillStyle = '#ffd86b';
  ctx.fillRect(x-8, y-1, 16, 2);
  ctx.fillRect(x-1, y-8, 2, 16);
}

// track pointer for crosshair
const lastPointer = { x: null, y: null, rectW: 1, rectH: 1 };
canvas.addEventListener('pointermove', (e)=>{
  const rect = canvas.getBoundingClientRect();
  lastPointer.x = e.clientX - rect.left;
  lastPointer.y = e.clientY - rect.top;
  lastPointer.rectW = rect.width;
  lastPointer.rectH = rect.height;
});

// initial render (idle screen)
(function idle(){
  ctx.fillStyle = '#041018';
  ctx.fillRect(0,0,W,H);
  ctx.fillStyle = '#e6f0ff';
  ctx.font = '48px monospace';
  ctx.fillText('Pixel Sniper', Math.floor(W/2 - 220), Math.floor(H/2 - 20));
  ctx.font = '18px monospace';
  ctx.fillText('Press Start to begin', Math.floor(W/2 - 120), Math.floor(H/2 + 16));
})();

// start animation frame loop; update runs when game is running
requestAnimationFrame(update);

