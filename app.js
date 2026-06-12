const video = document.querySelector("#camera");
const canvas = document.querySelector("#overlay");
const ctx = canvas.getContext("2d");
const startBtn = document.querySelector("#startBtn");
const demoBtn = document.querySelector("#demoBtn");
const statusText = document.querySelector("#statusText");
const statusDot = document.querySelector("#statusDot");
const visionVersion = "0.10.35";
const hatImage = new Image();
hatImage.src = "./assets/birthday-hat.png";

const wishes = [
  "生日快乐，愿你今天闪闪发光！",
  "新的一岁，开心加倍！",
  "愿望都实现，蛋糕第一口最甜！",
  "好运上线，快乐满格！",
  "祝你被爱、被好运、被惊喜包围！",
  "Tonya赚赚赚赚赚大钱",
  "帅哥围绕",
  "周游世界",
  "smillllllllle everyday",
  "立马升职加薪"
];

const balloonColors = ["#ff6b6b", "#ffd166", "#70e0b7", "#73d2ff", "#c77dff"];
const state = {
  mode: "idle",
  faceLandmarker: null,
  handLandmarker: null,
  balloons: [],
  confetti: [],
  pops: [],
  floatTexts: [],
  finger: null,
  faceBox: null,
  smile: 0,
  lastSmileSpawn: 0,
  balloonLane: 0,
  lastFrameTime: performance.now(),
  audio: null
};

function setStatus(text, live = false) {
  statusText.textContent = text;
  statusDot.classList.toggle("live", live);
}

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.round(canvas.clientWidth * dpr);
  const height = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

async function loadVision() {
  const vision = await import(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${visionVersion}/vision_bundle.mjs`);
  const resolver = await vision.FilesetResolver.forVisionTasks(
    `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${visionVersion}/wasm`
  );
  const [faceLandmarker, handLandmarker] = await Promise.all([
    vision.FaceLandmarker.createFromOptions(resolver, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task",
        delegate: "CPU"
      },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: true
    }),
    vision.HandLandmarker.createFromOptions(resolver, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task",
        delegate: "CPU"
      },
      runningMode: "VIDEO",
      numHands: 2
    })
  ]);
  state.faceLandmarker = faceLandmarker;
  state.handLandmarker = handLandmarker;
}

async function startCamera() {
  primeAudio();
  setStatus("正在打开摄像头...");
  startBtn.disabled = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    video.srcObject = stream;
    await video.play();
    setStatus("摄像头已打开，正在加载识别模型...", true);
    try {
      await loadVision();
      state.mode = "camera";
      setStatus("对着镜头微笑，气球会升起来", true);
    } catch (modelError) {
      console.error(modelError);
      state.mode = "demo";
      setStatus("摄像头已打开，但识别模型加载失败；可先用演示模式点击气球", true);
    }
  } catch (error) {
    console.error(error);
    state.mode = "demo";
    setStatus(error?.name === "NotAllowedError" ? "摄像头权限被拒绝，已进入演示模式" : "摄像头不可用，已进入演示模式", true);
  } finally {
    startBtn.disabled = false;
  }
}

function startDemo() {
  primeAudio();
  state.mode = "demo";
  setStatus("演示模式：点击气球触发生日祝福", true);
  for (let i = 0; i < 8; i += 1) {
    spawnBalloon(undefined, canvas.clientHeight + 40 + Math.random() * 260);
  }
}

function primeAudio() {
  if (!state.audio) state.audio = new (window.AudioContext || window.webkitAudioContext)();
  if (state.audio.state === "suspended") state.audio.resume();
}

function playTone(kind = "pop") {
  if (!state.audio) return;
  const now = state.audio.currentTime;
  const gain = state.audio.createGain();
  gain.connect(state.audio.destination);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(kind === "pop" ? 0.22 : 0.16, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
  const osc = state.audio.createOscillator();
  osc.type = kind === "pop" ? "triangle" : "sine";
  osc.frequency.setValueAtTime(kind === "pop" ? 680 : 520, now);
  osc.frequency.exponentialRampToValueAtTime(kind === "pop" ? 130 : 1040, now + 0.2);
  osc.connect(gain);
  osc.start(now);
  osc.stop(now + 0.3);
}

function normalizedToCanvas(point) {
  return { x: (1 - point.x) * canvas.clientWidth, y: point.y * canvas.clientHeight };
}

function updateRecognition() {
  if (state.mode !== "camera" || !state.faceLandmarker || video.readyState < 2) return;
  const now = performance.now();
  const faceResult = state.faceLandmarker.detectForVideo(video, now);
  const handResult = state.handLandmarker.detectForVideo(video, now);
  state.faceBox = null;
  state.smile = 0;
  if (faceResult.faceLandmarks?.length) {
    const points = faceResult.faceLandmarks[0].map(normalizedToCanvas);
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    state.faceBox = {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys)
    };
    const blendshapes = faceResult.faceBlendshapes?.[0]?.categories || [];
    const leftSmile = blendshapes.find((item) => item.categoryName === "mouthSmileLeft")?.score || 0;
    const rightSmile = blendshapes.find((item) => item.categoryName === "mouthSmileRight")?.score || 0;
    state.smile = (leftSmile + rightSmile) / 2;
  }
  state.finger = null;
  if (handResult.landmarks?.length) state.finger = normalizedToCanvas(handResult.landmarks[0][8]);
}

function nextBalloonX() {
  const width = canvas.clientWidth;
  const lanes = Math.max(6, Math.min(11, Math.floor(width / 150)));
  const laneWidth = width / lanes;
  const lane = state.balloonLane % lanes;
  state.balloonLane += 1;
  return laneWidth * (lane + 0.5) + (Math.random() - 0.5) * laneWidth * 0.52;
}

function spawnBalloon(x = nextBalloonX(), y = canvas.clientHeight + 60) {
  state.balloons.push({
    x,
    y,
    r: 28 + Math.random() * 18,
    speed: 48 + Math.random() * 48,
    sway: Math.random() * Math.PI * 2,
    drift: (Math.random() - 0.5) * 16,
    color: balloonColors[Math.floor(Math.random() * balloonColors.length)],
    popped: false
  });
  playTone("spawn");
}

function popBalloon(balloon) {
  if (balloon.popped) return;
  balloon.popped = true;
  playTone("pop");
  state.floatTexts.push({
    text: wishes[Math.floor(Math.random() * wishes.length)],
    x: balloon.x,
    y: balloon.y,
    vx: (Math.random() - 0.5) * 26,
    vy: -72 - Math.random() * 28,
    life: 2.4,
    maxLife: 2.4,
    color: balloon.color
  });
  for (let i = 0; i < 18; i += 1) {
    const angle = (Math.PI * 2 * i) / 18;
    state.confetti.push({
      x: balloon.x,
      y: balloon.y,
      vx: Math.cos(angle) * (80 + Math.random() * 120),
      vy: Math.sin(angle) * (80 + Math.random() * 120),
      life: 0.85,
      color: balloonColors[i % balloonColors.length]
    });
  }
  state.pops.push({ x: balloon.x, y: balloon.y, life: 0.34, color: balloon.color });
}

function updateScene(dt) {
  const now = performance.now();
  if ((state.mode === "demo" || state.smile > 0.36) && now - state.lastSmileSpawn > 720) {
    spawnBalloon();
    state.lastSmileSpawn = now;
  }
  for (const balloon of state.balloons) {
    balloon.y -= balloon.speed * dt;
    balloon.sway += dt * 2.4;
    balloon.x += (Math.sin(balloon.sway) * 9 + balloon.drift) * dt;
    if (state.finger && !balloon.popped && Math.hypot(state.finger.x - balloon.x, state.finger.y - balloon.y) < balloon.r * 1.12) {
      popBalloon(balloon);
    }
  }
  state.balloons = state.balloons.filter((balloon) => !balloon.popped && balloon.y > -120);
  state.confetti = state.confetti
    .map((piece) => ({
      ...piece,
      x: piece.x + piece.vx * dt,
      y: piece.y + piece.vy * dt,
      vy: piece.vy + 260 * dt,
      life: piece.life - dt
    }))
    .filter((piece) => piece.life > 0);
  state.pops = state.pops.map((pop) => ({ ...pop, life: pop.life - dt })).filter((pop) => pop.life > 0);
  state.floatTexts = state.floatTexts
    .map((item) => ({
      ...item,
      x: item.x + item.vx * dt,
      y: item.y + item.vy * dt,
      vy: item.vy + 24 * dt,
      life: item.life - dt
    }))
    .filter((item) => item.life > 0);
}

function drawHat(box) {
  if (!hatImage.complete || !hatImage.naturalWidth) return;
  const cx = box.x + box.width / 2;
  const baseY = box.y + box.height * 0.08;
  const width = Math.max(118, box.width * 0.92);
  const height = width * (hatImage.naturalHeight / hatImage.naturalWidth);
  ctx.save();
  ctx.translate(cx, baseY - height * 0.46);
  ctx.rotate(Math.sin(performance.now() / 620) * 0.025);
  ctx.shadowColor = "rgba(255, 209, 102, 0.36)";
  ctx.shadowBlur = width * 0.08;
  ctx.drawImage(hatImage, -width / 2, -height / 2, width, height);
  ctx.restore();
}

function drawBalloon(balloon) {
  ctx.save();
  ctx.translate(balloon.x, balloon.y);
  ctx.beginPath();
  ctx.ellipse(0, 0, balloon.r * 0.86, balloon.r * 1.12, 0, 0, Math.PI * 2);
  ctx.fillStyle = balloon.color;
  ctx.fill();
  ctx.globalAlpha = 0.32;
  ctx.beginPath();
  ctx.ellipse(-balloon.r * 0.25, -balloon.r * 0.34, balloon.r * 0.22, balloon.r * 0.34, -0.4, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.moveTo(-6, balloon.r);
  ctx.lineTo(6, balloon.r);
  ctx.lineTo(0, balloon.r + 10);
  ctx.closePath();
  ctx.fillStyle = balloon.color;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.64)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, balloon.r + 10);
  ctx.bezierCurveTo(-14, balloon.r + 36, 16, balloon.r + 58, -4, balloon.r + 86);
  ctx.stroke();
  ctx.restore();
}

function drawSparkle(x, y, size, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 8; i += 1) {
    const radius = i % 2 === 0 ? size : size * 0.34;
    const angle = (Math.PI * 2 * i) / 8;
    ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function wrapText(text, maxWidth) {
  const chars = Array.from(text);
  const lines = [];
  let line = "";
  for (const char of chars) {
    const test = line + char;
    if (line && ctx.measureText(test).width > maxWidth) {
      lines.push(line);
      line = char;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

function roundRectPath(x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawFloatingText(item) {
  const progress = 1 - item.life / item.maxLife;
  const alpha = item.life < 0.42 ? item.life / 0.42 : 1;
  const scale = Math.min(1, 0.42 + progress * 2.8);
  const maxWidth = Math.min(320, canvas.clientWidth * 0.42);
  const fontSize = Math.max(20, Math.min(34, canvas.clientWidth * 0.028));
  ctx.save();
  ctx.translate(item.x, item.y);
  ctx.scale(scale, scale);
  ctx.globalAlpha = alpha;
  ctx.font = `900 ${fontSize}px "Comic Sans MS", "Marker Felt", "Chalkboard SE", "Arial Rounded MT Bold", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lines = wrapText(item.text, maxWidth);
  const lineHeight = fontSize * 1.15;
  const bubbleWidth = Math.min(maxWidth + 34, Math.max(...lines.map((line) => ctx.measureText(line).width)) + 40);
  const bubbleHeight = lines.length * lineHeight + 28;
  const x = -bubbleWidth / 2;
  const y = -bubbleHeight / 2;
  ctx.shadowColor = "rgba(0, 0, 0, 0.22)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 8;
  roundRectPath(x, y, bubbleWidth, bubbleHeight, 20);
  ctx.fillStyle = "rgba(255, 250, 242, 0.96)";
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.lineWidth = 4;
  ctx.strokeStyle = item.color;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-16, bubbleHeight / 2 - 2);
  ctx.quadraticCurveTo(0, bubbleHeight / 2 + 24, 18, bubbleHeight / 2 - 2);
  ctx.fillStyle = "rgba(255, 250, 242, 0.96)";
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#25182f";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.82)";
  ctx.lineWidth = 5;
  lines.forEach((line, index) => {
    const textY = (index - (lines.length - 1) / 2) * lineHeight;
    ctx.strokeText(line, 0, textY);
    ctx.fillText(line, 0, textY);
  });
  drawSparkle(-bubbleWidth / 2 + 18, -bubbleHeight / 2 + 14, 7, "#ffd166");
  drawSparkle(bubbleWidth / 2 - 18, -bubbleHeight / 2 + 16, 6, "#c77dff");
  ctx.restore();
}

function drawPointer(point) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(point.x, point.y, 14, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255, 209, 102, 0.22)";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#ffd166";
  ctx.stroke();
  ctx.restore();
}

function drawScene() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.globalAlpha = state.mode === "idle" ? 0.86 : 0.34;
  for (let i = 0; i < 48; i += 1) {
    const x = ((i * 83 + performance.now() / 38) % (width + 80)) - 40;
    const y = (i * 47) % height;
    ctx.fillStyle = balloonColors[i % balloonColors.length];
    ctx.fillRect(x, y, 8, 3);
  }
  ctx.restore();
  if (state.faceBox) drawHat(state.faceBox);
  for (const balloon of state.balloons) drawBalloon(balloon);
  for (const pop of state.pops) {
    const progress = 1 - pop.life / 0.34;
    ctx.save();
    ctx.globalAlpha = 1 - progress;
    ctx.strokeStyle = pop.color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(pop.x, pop.y, 18 + progress * 58, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  for (const piece of state.confetti) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, piece.life);
    ctx.translate(piece.x, piece.y);
    ctx.rotate(piece.life * 7);
    ctx.fillStyle = piece.color;
    ctx.fillRect(-4, -2, 8, 4);
    ctx.restore();
  }
  for (const item of state.floatTexts) drawFloatingText(item);
  if (state.finger) drawPointer(state.finger);
}

function loop(now) {
  resizeCanvas();
  const dt = Math.min(0.04, (now - state.lastFrameTime) / 1000);
  state.lastFrameTime = now;
  updateRecognition();
  updateScene(dt);
  drawScene();
  requestAnimationFrame(loop);
}

canvas.addEventListener("pointerdown", (event) => {
  const rect = canvas.getBoundingClientRect();
  const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  const target = state.balloons.find((balloon) => Math.hypot(point.x - balloon.x, point.y - balloon.y) < balloon.r * 1.2);
  if (target) popBalloon(target);
});

startBtn.addEventListener("click", startCamera);
demoBtn.addEventListener("click", startDemo);
window.addEventListener("resize", resizeCanvas);
requestAnimationFrame(loop);
