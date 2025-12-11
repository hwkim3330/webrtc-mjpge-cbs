const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// CBS CLI Configuration
const CBS_CLI_PATH = '/home/keti/Microchip_VelocityDRIVE_CT-CLI-linux-2025.07.12/mvdct.cli';
let CBS_DEVICE = '/dev/ttyACM0'; // 동적으로 변경 가능

// CBS 디바이스 자동 감지
const fs = require('fs');
function detectCbsDevice() {
  const devices = ['/dev/ttyACM0', '/dev/ttyACM1', '/dev/ttyACM2'];
  for (const dev of devices) {
    if (fs.existsSync(dev)) {
      CBS_DEVICE = dev;
      console.log(`CBS device found: ${dev}`);
      return dev;
    }
  }
  console.log('No CBS device found');
  return null;
}

// CLI Lock to prevent concurrent access
let cliLock = false;
const cliQueue = [];

async function withCliLock(fn) {
  return new Promise((resolve, reject) => {
    const execute = async () => {
      cliLock = true;
      try {
        const result = await fn();
        resolve(result);
      } catch (e) {
        reject(e);
      } finally {
        cliLock = false;
        if (cliQueue.length > 0) {
          const next = cliQueue.shift();
          next();
        }
      }
    };

    if (cliLock) {
      cliQueue.push(execute);
    } else {
      execute();
    }
  });
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;

// 정적 파일 제공
app.use(express.static('public'));
app.use(express.json({ limit: '5mb' }));

// MJPEG 스트림 저장
let latestFrame = null;
let viewers = [];

// 메인 페이지
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// 송출자 페이지
app.get('/broadcast', (req, res) => {
  res.sendFile(__dirname + '/public/broadcaster.html');
});

// 시청자 페이지
app.get('/watch', (req, res) => {
  res.sendFile(__dirname + '/public/viewer.html');
});

// CBS 제어 페이지
app.get('/cbs', (req, res) => {
  res.sendFile(__dirname + '/public/cbs.html');
});

// MJPEG 스트림 엔드포인트 (img 태그로 직접 시청 가능)
let viewerIdCounter = 0;
app.get('/stream.mjpg', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Pragma': 'no-cache'
  });

  const viewer = {
    res,
    id: ++viewerIdCounter,  // 고유 ID 보장
    droppedFrames: 0
  };
  viewers.push(viewer);
  console.log(`시청자 연결: ${viewers.length}명 (ID: ${viewer.id})`);

  // 연결 종료 처리
  req.on('close', () => {
    viewers = viewers.filter(v => v.id !== viewer.id);
    console.log(`시청자 연결 해제: ${viewers.length}명 (ID: ${viewer.id})`);
  });
});

// 프레임 수신 (송출자 → 서버) - HTTP fallback
let lastFrameTime = 0;
let frameCount = 0;
let serverStats = { fps: 0, latency: 0, frameSize: 0, lastCountTime: Date.now() };

// 프레임 브로드캐스트 함수 (공통)
function broadcastFrame(frameBuffer, timestamp) {
  const serverReceiveTime = Date.now();
  latestFrame = frameBuffer;

  // 레이턴시 계산 (송출자 → 서버)
  if (timestamp) {
    serverStats.latency = serverReceiveTime - timestamp;
  }
  serverStats.frameSize = latestFrame.length;
  frameCount++;

  // FPS 계산
  const now = Date.now();
  if (now - serverStats.lastCountTime >= 1000) {
    serverStats.fps = frameCount;
    frameCount = 0;
    serverStats.lastCountTime = now;
  }

  // 타임스탬프와 함께 시청자에게 브로드캐스트
  io.emit('frame-stats', {
    serverSendTime: Date.now(),           // 서버가 보내는 시각 (뷰어에서 RTT 계산용)
    broadcasterLatency: serverStats.latency, // 송출자→서버 레이턴시
    frameSize: serverStats.frameSize,
    fps: serverStats.fps
  });

  // 모든 시청자에게 프레임 전송 (MJPEG)
  const boundary = '--frame\r\n';
  const header = 'Content-Type: image/jpeg\r\n\r\n';
  const footer = '\r\n';
  const frameData = Buffer.concat([
    Buffer.from(boundary + header),
    latestFrame,
    Buffer.from(footer)
  ]);

  // 각 뷰어에게 독립적으로 전송
  for (let i = viewers.length - 1; i >= 0; i--) {
    const viewer = viewers[i];
    try {
      // 연결이 끊겼는지 확인
      if (!viewer.res || viewer.res.destroyed || viewer.res.writableEnded) {
        console.log(`뷰어 ${viewer.id} 연결 끊김 - 제거`);
        viewers.splice(i, 1);
        continue;
      }

      // 동기적으로 write (MJPEG는 순차 전송 필요)
      const canWrite = viewer.res.write(frameData);
      if (!canWrite) {
        // 버퍼가 차면 drain 이벤트 대기 (한번만 등록)
        if (!viewer.drainRegistered) {
          viewer.drainRegistered = true;
          viewer.res.once('drain', () => {
            viewer.drainRegistered = false;
          });
        }
        viewer.droppedFrames = (viewer.droppedFrames || 0) + 1;
      }
    } catch (e) {
      console.log(`뷰어 ${viewer.id} 에러: ${e.message} - 제거`);
      viewers.splice(i, 1);
    }
  }
}

app.post('/frame', (req, res) => {
  const { frame, timestamp } = req.body;

  if (!frame) {
    return res.status(400).send('No frame');
  }

  // base64 → Buffer
  const base64Data = frame.replace(/^data:image\/jpeg;base64,/, '');
  const frameBuffer = Buffer.from(base64Data, 'base64');

  broadcastFrame(frameBuffer, timestamp);
  res.sendStatus(200);
});

// Socket.io - 통계 및 상태 전송용
let broadcasterSocket = null;
let frameStats = { fps: 0, frameCount: 0, lastTime: Date.now(), bitrate: 0, totalBytes: 0 };

io.on('connection', (socket) => {
  console.log(`클라이언트 연결: ${socket.id}`);

  socket.on('broadcaster', () => {
    broadcasterSocket = socket.id;
    console.log('송출자 등록');
    io.emit('broadcaster-status', true);
  });

  socket.on('viewer', () => {
    socket.emit('broadcaster-status', broadcasterSocket !== null);
  });

  // RTT 측정용 ping-pong
  socket.on('ping-measure', (data) => {
    socket.emit('pong-measure', {
      clientTime: data.clientTime,
      serverTime: Date.now()
    });
  });

  // Socket.IO 바이너리 프레임 수신 (저지연)
  socket.on('frame', (data) => {
    if (socket.id !== broadcasterSocket) return;

    // ArrayBuffer → Buffer
    const frameBuffer = Buffer.from(data.frame);
    broadcastFrame(frameBuffer, data.timestamp);
  });

  socket.on('stats', (data) => {
    // 송출자 통계를 시청자에게 전달
    socket.broadcast.emit('broadcast-stats', data);
  });

  socket.on('disconnect', () => {
    if (socket.id === broadcasterSocket) {
      broadcasterSocket = null;
      latestFrame = null;
      io.emit('broadcaster-status', false);
      console.log('송출자 연결 해제');
    }
  });
});

// API: 현재 상태
app.get('/api/status', (req, res) => {
  res.json({
    broadcasting: broadcasterSocket !== null,
    viewers: viewers.length
  });
});

// 단일 프레임 엔드포인트 (Safari/맥북 fallback용)
app.get('/frame.jpg', (req, res) => {
  if (latestFrame) {
    res.writeHead(200, {
      'Content-Type': 'image/jpeg',
      'Content-Length': latestFrame.length,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    res.end(latestFrame);
  } else {
    res.status(404).send('No frame');
  }
});

// ============================================
// CBS (Credit Based Shaper) API
// ============================================

// Helper: Run CLI command with lock
async function runCbsCli(args) {
  // 디바이스가 없으면 먼저 감지 시도
  if (!fs.existsSync(CBS_DEVICE)) {
    const detected = detectCbsDevice();
    if (!detected) {
      return { success: false, error: 'No CBS device connected' };
    }
  }

  return withCliLock(async () => {
    const cmd = `${CBS_CLI_PATH} device ${CBS_DEVICE} ${args}`;
    try {
      const { stdout, stderr } = await execPromise(cmd, { timeout: 15000 });
      return { success: true, output: stdout, stderr };
    } catch (e) {
      return { success: false, error: e.message, stderr: e.stderr };
    }
  });
}

// CBS: Check device
app.get('/api/cbs/device', async (req, res) => {
  try {
    const result = await runCbsCli('type');
    if (result.success) {
      const device = result.output.trim();
      res.json({ success: true, device });
    } else {
      res.json({ success: false, error: result.error });
    }
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// CBS: Get config for all ports
app.get('/api/cbs/config', async (req, res) => {
  try {
    const configs = [];
    for (let port = 1; port <= 12; port++) {
      const result = await runCbsCli(`get "/ietf-interfaces:interfaces/interface[name='${port}']/mchp-velocitysp-port:eth-qos/config/traffic-class-shapers"`);
      if (result.success && result.output) {
        // Parse YAML output
        const lines = result.output.split('\n');
        let currentTc = null;
        let currentIdleSlope = null;
        for (const line of lines) {
          const tcMatch = line.match(/traffic-class:\s*(\d+)/);
          const isMatch = line.match(/idle-slope:\s*(\d+)/);
          if (tcMatch) currentTc = parseInt(tcMatch[1]);
          if (isMatch) currentIdleSlope = parseInt(isMatch[1]);
          if (currentTc !== null && currentIdleSlope !== null) {
            configs.push({ port, tc: currentTc, idleSlope: currentIdleSlope });
            currentTc = null;
            currentIdleSlope = null;
          }
        }
      }
    }
    res.json({ success: true, config: configs });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// CBS: Set CBS on ports
app.post('/api/cbs/set', async (req, res) => {
  const { ports, tc, idleSlope } = req.body;
  if (!ports || !Array.isArray(ports) || tc === undefined || !idleSlope) {
    return res.json({ success: false, error: 'Missing parameters' });
  }

  const results = [];
  const cliOutputs = [];
  for (const port of ports) {
    const path = `/ietf-interfaces:interfaces/interface[name='${port}']/mchp-velocitysp-port:eth-qos/config/traffic-class-shapers[traffic-class='${tc}']/credit-based/idle-slope`;
    const args = `set "${path}" "${idleSlope}"`;
    const cmd = `${CBS_CLI_PATH} device ${CBS_DEVICE} ${args}`;
    const result = await runCbsCli(args);
    results.push({ port, success: result.success, error: result.error });
    cliOutputs.push({ port, cmd, output: result.output, error: result.error || result.stderr });
  }
  res.json({ success: true, results, cliOutputs });
});

// CBS: Delete CBS config
app.post('/api/cbs/delete', async (req, res) => {
  const { port, tc } = req.body;
  if (!port || tc === undefined) {
    return res.json({ success: false, error: 'Missing parameters' });
  }

  const path = `/ietf-interfaces:interfaces/interface[name='${port}']/mchp-velocitysp-port:eth-qos/config/traffic-class-shapers[traffic-class='${tc}']`;
  const args = `delete "${path}"`;
  const cmd = `${CBS_CLI_PATH} device ${CBS_DEVICE} ${args}`;
  const result = await runCbsCli(args);
  res.json({ success: result.success, error: result.error, cmd, cliOutput: result.output || result.stderr });
});

// 192.168.1.x 대역 IP만 가져오기
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal && iface.address.startsWith('192.168.')) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

server.listen(PORT, '0.0.0.0', () => {
  const localIP = getLocalIP();
  console.log('\n========================================');
  console.log('  MJPEG Webcam Streaming Server');
  console.log('========================================\n');
  console.log(`  Main:       http://localhost:${PORT}`);
  console.log(`  Broadcast:  http://localhost:${PORT}/broadcast`);
  console.log(`  Watch:      http://${localIP}:${PORT}/watch`);
  console.log(`  CBS:        http://localhost:${PORT}/cbs`);
  console.log(`  Stream:     http://${localIP}:${PORT}/stream.mjpg`);
  console.log(`  Frame:      http://${localIP}:${PORT}/frame.jpg`);
  console.log('\n');
});
