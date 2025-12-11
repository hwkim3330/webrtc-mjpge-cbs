# MJPEG Stream + CBS Control
<img width="1840" height="876" alt="image" src="https://github.com/user-attachments/assets/01de7e2d-5a1d-466f-8257-3ccea29f60a3" />

[![Node.js](https://img.shields.io/badge/Node.js-16%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-4.x-010101?logo=socket.io&logoColor=white)](https://socket.io/)
[![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TSN](https://img.shields.io/badge/TSN-IEEE%20802.1Qav-blue)](https://1.ieee802.org/tsn/)

Real-time MJPEG webcam streaming server with integrated CBS (Credit Based Shaper) control for Microchip LAN969x TSN switches.

## Features

- **MJPEG Streaming**: Browser-based webcam capture and streaming
- **Real-time Statistics**: 6 charts per page (Bitrate, FPS, Latency, Frame Size, RTT/Dropped, Loss/Viewers)
- **Accurate Latency Measurement**: E2E Latency (broadcaster→viewer) + Network RTT (ping-pong)
- **CBS Control**: GUI for configuring Credit Based Shaper on TSN switch ports
- **Auto CBS Device Detection**: Automatically finds /dev/ttyACM0-2
- **Low Latency Mode**: Frame dropping mechanism to prevent queue buildup
- **Independent Viewer Streams**: Slow viewers don't block others
- **Multi-browser Support**: Polling fallback for Safari/Mac compatibility
- **Old Device Support**: Presets for legacy hardware (Old Mac, low-spec devices)

## Architecture

```
┌─────────────┐     Socket.IO      ┌─────────────┐     MJPEG HTTP     ┌─────────────┐
│ Broadcaster │ ──── Binary ────→ │   Server    │ ───── Stream ────→ │   Viewer    │
│  (Browser)  │     (no wait)      │  (Node.js)  │   (non-blocking)   │  (Browser)  │
└─────────────┘                    └─────────────┘                    └─────────────┘
      │                                  │                                  │
      │ getUserMedia                     │ CBS CLI                          │ RTT Ping
      │ Canvas → JPEG                    │ (mvdct.cli)                      │ Pong
      ▼                                  ▼                                  ▼
   Webcam                          TSN Switch                         E2E Latency
                                   (LAN969x)                          Measurement
```

## Requirements

- Node.js 16+
- Modern web browser (Chrome, Firefox, Safari, Edge)
- Microchip LAN969x TSN Switch (optional, for CBS control)
- VelocityDRIVE CT CLI tool (optional, for CBS control)

## Quick Start

```bash
# Clone repository
git clone https://github.com/hwkim3330/webrtc-mjpge-cbs.git
cd webrtc-mjpge-cbs

# Install dependencies
npm install

# Start server
npm start

# Or use the start script
./start.sh
```

## Access URLs

| Page | URL | Description |
|------|-----|-------------|
| Main | http://localhost:3000 | Landing page |
| Broadcast | http://localhost:3000/broadcast | Webcam streaming + CBS control (6 charts) |
| Watch | http://[IP]:3000/watch | Viewer page with stats (6 charts) |
| CBS Only | http://localhost:3000/cbs | CBS control only |
| Direct Stream | http://[IP]:3000/stream.mjpg | Raw MJPEG stream |
| Single Frame | http://[IP]:3000/frame.jpg | Single JPEG frame (polling fallback) |

## Streaming Presets

| Preset | Resolution | FPS | Quality | Use Case |
|--------|-----------|-----|---------|----------|
| **Low Latency** | 480p | 15 | Low | Default, recommended |
| Balanced | 720p | 30 | Mid | General use |
| Quality | 1080p | 30 | High | High quality needs |
| **Old Mac** | 240p | 10 | Very Low | Legacy hardware |

## Key Technical Features

### 1. Frame Dropping Mechanism
Prevents latency buildup by skipping frames when previous transmission is incomplete:
```javascript
if (isSending) {
  droppedFrames++;
  return;  // Skip this frame
}
```

### 2. Non-blocking Viewer Streams
Each viewer receives frames independently. Slow viewers don't block others:
```javascript
if (viewer.res.writableNeedDrain) {
  viewer.droppedFrames++;
  return;  // Skip slow viewer
}
```

### 3. Socket.IO Binary Transfer
Uses Socket.IO for efficient binary frame transfer with volatile emit:
```javascript
socket.volatile.emit('frame', { frame: buffer, timestamp });
```

### 4. RTT-based Latency Measurement
Accurate E2E latency calculation using NTP-style clock synchronization:
```javascript
// Server ping-pong for RTT measurement
socket.on('ping-measure', (data) => {
  socket.emit('pong-measure', { clientTime: data.clientTime, serverTime: Date.now() });
});

// Client calculates E2E latency
E2E Latency = broadcasterLatency + (RTT / 2)
```

### 5. Polling Fallback for Safari/Mac
Automatic fallback to polling mode when MJPEG streaming fails:
```javascript
// If MJPEG fails 3 times or no frames for 5 seconds
pollingMode = true;
setInterval(() => {
  img.src = '/frame.jpg?t=' + Date.now();
}, 100);  // 10 FPS polling
```

### 6. Auto CBS Device Detection
Automatically detects CBS device from /dev/ttyACM0, ACM1, or ACM2:
```javascript
function detectCbsDevice() {
  const devices = ['/dev/ttyACM0', '/dev/ttyACM1', '/dev/ttyACM2'];
  for (const dev of devices) {
    if (fs.existsSync(dev)) return dev;
  }
  return null;
}
```

## CBS Configuration

### Prerequisites

1. Download VelocityDRIVE CT CLI:
```bash
wget http://mscc-ent-open-source.s3-website-eu-west-1.amazonaws.com/public_root/velocitydrivect/2025.06/Microchip_VelocityDRIVE_CT-CLI-linux-2025.07.12.tgz
tar -xzf Microchip_VelocityDRIVE_CT-CLI-linux-2025.07.12.tgz
```

2. Update CLI path in `server.js`:
```javascript
const CBS_CLI_PATH = '/path/to/mvdct.cli';
const CBS_DEVICE = '/dev/ttyACM0';
```

3. Add user to dialout group:
```bash
sudo usermod -aG dialout $USER
# Logout and login again
```

### CBS GUI Usage

1. Open http://localhost:3000/broadcast
2. Select ports (1-12)
3. Choose Traffic Class (TC0-TC7, default: TC0)
4. Set Idle Slope (kbps)
5. Click "Apply CBS"

### Quick Presets

- **P8-11 TC0 100M**: Ports 8-11, Traffic Class 0, 100 Mbps
- **P1-4 TC0 50M**: Ports 1-4, Traffic Class 0, 50 Mbps
- **ALL TC0 100M**: All ports, Traffic Class 0, 100 Mbps

## Project Structure

```
.
├── server.js           # Express server + CBS API + MJPEG streaming
├── package.json        # Dependencies
├── start.sh            # Start script
├── public/
│   ├── index.html      # Main landing page
│   ├── broadcaster.html # Broadcast + CBS control (3-column layout)
│   ├── viewer.html     # Viewer page with real-time stats
│   └── cbs.html        # CBS control only
└── README.md           # This file
```

## API Endpoints

### Streaming

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/stream.mjpg` | MJPEG stream (multipart/x-mixed-replace) |
| GET | `/frame.jpg` | Single JPEG frame (polling fallback) |
| POST | `/frame` | Receive frame from broadcaster (HTTP fallback) |
| GET | `/api/status` | Get streaming status (broadcasting, viewers count) |

### CBS Control

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/cbs/device` | Check device connection |
| GET | `/api/cbs/config` | Get CBS config for all ports |
| POST | `/api/cbs/set` | Set CBS on ports |
| POST | `/api/cbs/delete` | Delete CBS config |

## API Examples

### Set CBS
```bash
curl -X POST http://localhost:3000/api/cbs/set \
  -H "Content-Type: application/json" \
  -d '{"ports": [8,9,10,11], "tc": 0, "idleSlope": 100000}'
```

### Delete CBS
```bash
curl -X POST http://localhost:3000/api/cbs/delete \
  -H "Content-Type: application/json" \
  -d '{"port": 8, "tc": 0}'
```

### Get Status
```bash
curl http://localhost:3000/api/status
# {"broadcasting":true,"viewers":2}
```

## Technical Details

### MJPEG Streaming
- Protocol: `multipart/x-mixed-replace` HTTP streaming
- Frame capture: Browser Canvas API + `toBlob()`
- Transfer: Socket.IO binary (primary) or HTTP POST (fallback)
- Viewer delivery: Non-blocking async writes

### CBS (Credit Based Shaper)
- Standard: IEEE 802.1Qav
- Function: Controls bandwidth allocation per traffic class
- Idle Slope: Rate of credit accumulation (kbps)
- CLI: VelocityDRIVE CT CLI with YANG data model

### Latency Optimization
| Technique | Purpose |
|-----------|---------|
| Frame dropping | Prevent queue buildup |
| `socket.volatile.emit()` | Drop frames if buffer full |
| `writableNeedDrain` check | Skip slow viewers |
| Binary transfer | 33% less overhead vs base64 |
| `toBlob()` async | Non-blocking JPEG encoding |

### Statistics Charts

**Broadcaster (6 charts)**:
| Chart | Description | Color |
|-------|-------------|-------|
| Bitrate | Sent data rate (Mbps) | Blue |
| FPS | Frames per second | Green |
| Encode Time | JPEG encoding time (ms) | Orange |
| Frame Size | Compressed frame size (KB) | Purple |
| Dropped Frames | Frames dropped due to backpressure | Red |
| Viewers | Connected viewer count | Indigo |

**Viewer (6 charts)**:
| Chart | Description | Color |
|-------|-------------|-------|
| Bitrate | Received data rate (Mbps) | Blue |
| FPS | Frames per second | Green |
| E2E Latency | Total latency broadcaster→viewer (ms) | Orange |
| Network RTT | Round-trip time to server (ms) | Purple |
| Packet Loss | Frame loss percentage (%) | Red |
| Frame Size | Received frame size (KB) | Indigo |

### Latency Types Explained
- **E2E Latency**: Total end-to-end delay from broadcaster capture to viewer display
  - Formula: `broadcasterLatency + (RTT / 2)`
- **Network RTT**: Round-trip time between viewer and server (ping-pong measurement)
  - Used for calculating server→viewer portion of latency

## Troubleshooting

### High Latency (>1 second)
- Use "Low Latency" or "Old Mac" preset
- Check network bandwidth
- Reduce resolution/FPS/quality

### Viewer Freezing
- Check if CBS is limiting bandwidth too much
- Verify network connectivity
- Check "Frames Dropped" counter

### Viewer Shows "Waiting..." (Safari/Mac)
- The system auto-detects and switches to polling mode after 3 failures
- If stuck, manually refresh the page
- Polling mode uses /frame.jpg endpoint (lower FPS but more compatible)

### CBS Not Working
- Verify device connection: `ls -la /dev/ttyACM0`
- Server auto-detects ACM0, ACM1, or ACM2
- Check user permissions: `groups $USER`
- Test CLI manually: `./mvdct.cli device /dev/ttyACM0 type`

### Multiple Viewers - Only One Works
- Each viewer gets unique ID via counter (not timestamp)
- Check server logs for "시청자 연결" messages
- Dead connections auto-cleanup on disconnect

## Performance Tips

1. **For lowest latency**: Use 480p, 15fps, Low quality
2. **For old devices**: Use 240p, 10fps, Very Low quality
3. **Monitor dropped frames**: Some drops are normal, excessive drops indicate network/CPU issues
4. **CBS testing**: Start with high idle-slope, gradually reduce to find limit

## License

MIT

## Contributing

Pull requests welcome. For major changes, please open an issue first.
