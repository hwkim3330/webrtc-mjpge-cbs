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
// Socket.IO 클라이언트와 MJPEG 뷰어 매핑
const socketToViewer = new Map(); // socketId -> viewerId

app.get('/stream.mjpg', (req, res) => {
  // URL에서 viewerId 파라미터 확인 (Socket.IO에서 등록한 ID)
  const requestedId = req.query.id ? parseInt(req.query.id) : null;

  res.writeHead(200, {
    'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Pragma': 'no-cache'
  });

  const viewer = {
    res,
    id: requestedId || ++viewerIdCounter,  // 요청된 ID가 있으면 사용
    droppedFrames: 0,      // 이 뷰어가 드랍한 프레임 수
    sentFrames: 0,         // 전송 성공한 프레임
    lastSeqSent: 0,        // 마지막으로 전송한 시퀀스
    socketId: null,        // 연결된 Socket.IO ID
    backpressure: false    // 백프레셔 상태
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
let frameCount = 0;
let frameSequence = 0; // 전역 프레임 시퀀스 번호
let serverStats = { fps: 0, latency: 0, frameSize: 0, lastCountTime: Date.now() };

// 프레임 브로드캐스트 함수 (공통)
function broadcastFrame(frameBuffer, timestamp) {
  const serverReceiveTime = Date.now();
  latestFrame = frameBuffer;
  frameSequence++; // 프레임 시퀀스 번호 증가

  // 레이턴시 계산 (송출자 → 서버)
  // timestamp가 미래면 시계가 안 맞는 것 - 0으로 처리
  let broadcasterLatency = 0;
  if (timestamp && timestamp <= serverReceiveTime) {
    broadcasterLatency = serverReceiveTime - timestamp;
  }
  serverStats.latency = broadcasterLatency;
  serverStats.frameSize = latestFrame.length;
  frameCount++;

  // FPS 계산
  const now = Date.now();
  if (now - serverStats.lastCountTime >= 1000) {
    serverStats.fps = frameCount;
    frameCount = 0;
    serverStats.lastCountTime = now;
  }

  // 기본 stats
  const baseStats = {
    seq: frameSequence,
    serverSendTime: now,
    broadcasterLatency: serverStats.latency,
    frameSize: serverStats.frameSize,
    fps: serverStats.fps,
    viewers: viewers.length
  };

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
        viewers.splice(i, 1);
        continue;
      }

      // 백프레셔 상태면 이 프레임 스킵
      if (viewer.backpressure) {
        viewer.droppedFrames++;
        sendStatsToViewer(viewer, baseStats);
        continue;
      }

      // 프레임 전송 시도
      const canWrite = viewer.res.write(frameData);

      if (!canWrite) {
        // 버퍼 가득 참 - 백프레셔 상태로 전환
        viewer.backpressure = true;
        viewer.res.once('drain', () => {
          viewer.backpressure = false;
        });
        // 이 프레임은 전송됨 (버퍼에 들어감)
        viewer.sentFrames++;
        viewer.lastSeqSent = frameSequence;
      } else {
        viewer.sentFrames++;
        viewer.lastSeqSent = frameSequence;
      }

      sendStatsToViewer(viewer, baseStats);
    } catch (e) {
      viewers.splice(i, 1);
    }
  }

  // Socket 연결 없는 뷰어들을 위한 broadcast (polling 모드 등)
  io.emit('frame-stats-global', baseStats);
}

// 뷰어에게 개별 stats 전송
function sendStatsToViewer(viewer, baseStats) {
  if (viewer.socketId) {
    const socket = io.sockets.sockets.get(viewer.socketId);
    if (socket) {
      socket.emit('frame-stats', {
        ...baseStats,
        myDropped: viewer.droppedFrames,
        mySent: viewer.sentFrames,
        mySeq: viewer.lastSeqSent
      });
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
let broadcasterMode = 'tcp'; // 'tcp' or 'udp' - 전역 변수

io.on('connection', (socket) => {
  console.log(`클라이언트 연결: ${socket.id}`);

  socket.on('broadcaster', (data) => {
    broadcasterSocket = socket.id;
    broadcasterMode = data?.mode || 'tcp';
    console.log('송출자 등록, 모드:', broadcasterMode);
    io.emit('broadcaster-status', { online: true, mode: broadcasterMode });
  });

  socket.on('broadcaster-mode', (mode) => {
    broadcasterMode = mode;
    console.log('송출자 모드 변경:', mode);
    io.emit('broadcaster-status', { online: true, mode: broadcasterMode });

    // UDP 모드로 변경 시, 대기 중인 UDP 뷰어들에게 알림
    if (mode === 'udp' && broadcasterSocket) {
      io.sockets.sockets.forEach((s) => {
        if (s.udpViewer && s.id !== broadcasterSocket) {
          console.log('Notifying UDP viewer:', s.id);
          io.to(broadcasterSocket).emit('udp-viewer-joined', { viewerId: s.id });
        }
      });
    }
  });

  socket.on('viewer', (data) => {
    socket.emit('broadcaster-status', {
      online: broadcasterSocket !== null,
      mode: broadcasterMode
    });

    // 뷰어 ID 할당 및 반환
    const viewerId = ++viewerIdCounter;
    socket.viewerId = viewerId;
    socketToViewer.set(socket.id, viewerId);
    socket.emit('viewer-id', viewerId);
    console.log(`뷰어 Socket 등록: ${socket.id} -> viewerId: ${viewerId}`);
  });

  // 뷰어가 MJPEG 스트림 연결 시 Socket과 매핑
  socket.on('mjpeg-connected', (data) => {
    const viewerId = data.viewerId || socket.viewerId;
    const viewer = viewers.find(v => v.id === viewerId);
    if (viewer) {
      viewer.socketId = socket.id;
      console.log(`MJPEG-Socket 매핑: viewerId ${viewerId} <-> socket ${socket.id}`);
    }
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

  // ============================================
  // WebRTC Signaling for UDP Mode
  // ============================================

  // UDP 모드 뷰어 목록
  socket.on('udp-viewer-join', () => {
    socket.udpViewer = true;
    console.log(`UDP 뷰어 참가: ${socket.id}`);
    // broadcaster에게 알림
    if (broadcasterSocket) {
      io.to(broadcasterSocket).emit('udp-viewer-joined', { viewerId: socket.id });
    }
  });

  // WebRTC Offer (Broadcaster → Viewer)
  socket.on('webrtc-offer', (data) => {
    console.log(`WebRTC Offer: ${socket.id} -> ${data.to}`);
    io.to(data.to).emit('webrtc-offer', {
      from: socket.id,
      offer: data.offer
    });
  });

  // WebRTC Answer (Viewer → Broadcaster)
  socket.on('webrtc-answer', (data) => {
    console.log(`WebRTC Answer: ${socket.id} -> ${data.to}`);
    io.to(data.to).emit('webrtc-answer', {
      from: socket.id,
      answer: data.answer
    });
  });

  // ICE Candidate 교환
  socket.on('webrtc-ice', (data) => {
    io.to(data.to).emit('webrtc-ice', {
      from: socket.id,
      candidate: data.candidate
    });
  });

  socket.on('disconnect', () => {
    if (socket.id === broadcasterSocket) {
      broadcasterSocket = null;
      latestFrame = null;
      broadcasterMode = 'tcp';
      io.emit('broadcaster-status', { online: false, mode: 'tcp' });
      console.log('송출자 연결 해제');
    }
    // UDP 뷰어 연결 해제 알림
    if (socket.udpViewer && broadcasterSocket) {
      io.to(broadcasterSocket).emit('udp-viewer-left', { viewerId: socket.id });
    }
    // 뷰어 Socket 매핑 제거
    socketToViewer.delete(socket.id);
    // MJPEG 뷰어에서 socketId 제거
    const viewer = viewers.find(v => v.socketId === socket.id);
    if (viewer) {
      viewer.socketId = null;
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
