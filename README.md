# MJPEG Stream + CBS Control

Real-time MJPEG webcam streaming server with integrated CBS (Credit Based Shaper) control for Microchip LAN969x TSN switches.

## Features

- **MJPEG Streaming**: Browser-based webcam capture and streaming
- **Real-time Statistics**: Bitrate, FPS, Latency, Frame Size graphs
- **CBS Control**: GUI for configuring Credit Based Shaper on TSN switch ports
- **Low Latency Mode**: Frame dropping mechanism to prevent queue buildup
- **Independent Viewer Streams**: Slow viewers don't block others
- **Old Device Support**: Presets for legacy hardware (Old Mac, low-spec devices)

## Architecture

```
┌─────────────┐     Socket.IO      ┌─────────────┐     MJPEG HTTP     ┌─────────────┐
│ Broadcaster │ ──── Binary ────→ │   Server    │ ───── Stream ────→ │   Viewer    │
│  (Browser)  │     (no wait)      │  (Node.js)  │   (non-blocking)   │  (Browser)  │
└─────────────┘                    └─────────────┘                    └─────────────┘
      │                                  │
      │ getUserMedia                     │ CBS CLI
      │ Canvas → JPEG                    │ (mvdct.cli)
      ▼                                  ▼
   Webcam                          TSN Switch
                                   (LAN969x)
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
| Broadcast | http://localhost:3000/broadcast | Webcam streaming + CBS control |
| Watch | http://[IP]:3000/watch | Viewer page with stats |
| CBS Only | http://localhost:3000/cbs | CBS control only |
| Direct Stream | http://[IP]:3000/stream.mjpg | Raw MJPEG stream |

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

## Troubleshooting

### High Latency (>1 second)
- Use "Low Latency" or "Old Mac" preset
- Check network bandwidth
- Reduce resolution/FPS/quality

### Viewer Freezing
- Check if CBS is limiting bandwidth too much
- Verify network connectivity
- Check "Frames Dropped" counter

### CBS Not Working
- Verify device connection: `ls -la /dev/ttyACM0`
- Check user permissions: `groups $USER`
- Test CLI manually: `./mvdct.cli device /dev/ttyACM0 type`

## Performance Tips

1. **For lowest latency**: Use 480p, 15fps, Low quality
2. **For old devices**: Use 240p, 10fps, Very Low quality
3. **Monitor dropped frames**: Some drops are normal, excessive drops indicate network/CPU issues
4. **CBS testing**: Start with high idle-slope, gradually reduce to find limit

## License

MIT

## Contributing

Pull requests welcome. For major changes, please open an issue first.
