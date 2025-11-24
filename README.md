# MJPEG Stream + CBS Control

Real-time MJPEG webcam streaming server with integrated CBS (Credit Based Shaper) control for Microchip LAN969x TSN switches.

## Features

- **MJPEG Streaming**: Browser-based webcam capture and streaming
- **Real-time Statistics**: Bitrate, FPS, Latency, Frame Size graphs
- **CBS Control**: GUI for configuring Credit Based Shaper on TSN switch ports
- **Apple-style UI**: Clean, modern interface

## Requirements

- Node.js 16+
- Microchip LAN969x TSN Switch (for CBS control)
- VelocityDRIVE CT CLI tool

## Quick Start

```bash
# Install dependencies
npm install

# Start server
npm start

# Or use the start script
./start.sh
```

## Access

| Page | URL | Description |
|------|-----|-------------|
| Main | http://localhost:3000 | Landing page |
| Broadcast | http://localhost:3000/broadcast | Webcam streaming + CBS control |
| Watch | http://[IP]:3000/watch | Viewer page |
| CBS Only | http://localhost:3000/cbs | CBS control only |
| Direct Stream | http://[IP]:3000/stream.mjpg | Raw MJPEG stream |

## CBS Configuration

### Prerequisites

1. Download VelocityDRIVE CT CLI:
```bash
# Download from Microchip
wget http://mscc-ent-open-source.s3-website-eu-west-1.amazonaws.com/public_root/velocitydrivect/2025.06/Microchip_VelocityDRIVE_CT-CLI-linux-2025.07.12.tgz

# Extract
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
3. Choose Traffic Class (TC0-TC7)
4. Set Idle Slope (kbps)
5. Click "Apply CBS"

### Quick Presets

- **P8-11 TC0 100M**: Ports 8-11, Traffic Class 0, 100 Mbps
- **P1-4 TC0 50M**: Ports 1-4, Traffic Class 0, 50 Mbps
- **ALL TC0 100M**: All ports, Traffic Class 0, 100 Mbps

## Project Structure

```
.
├── server.js           # Express server + CBS API
├── package.json        # Dependencies
├── start.sh            # Start script
├── public/
│   ├── index.html      # Main page
│   ├── broadcaster.html # Broadcast + CBS control
│   ├── viewer.html     # Viewer page
│   └── cbs.html        # CBS control only
└── README.md
```

## API Endpoints

### Streaming

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/stream.mjpg` | MJPEG stream |
| POST | `/frame` | Receive frame from broadcaster |
| GET | `/api/status` | Get streaming status |

### CBS Control

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/cbs/device` | Check device connection |
| GET | `/api/cbs/config` | Get CBS config for all ports |
| POST | `/api/cbs/set` | Set CBS on ports |
| POST | `/api/cbs/delete` | Delete CBS config |

## CBS API Examples

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

## Technical Details

### MJPEG Streaming
- Uses `multipart/x-mixed-replace` HTTP streaming
- Frames captured via browser Canvas API
- Configurable resolution (480p/720p/1080p), FPS (15/30/60), quality

### CBS (Credit Based Shaper)
- IEEE 802.1Qav standard
- Controls bandwidth allocation per traffic class
- Idle Slope: Rate of credit accumulation (kbps)

## License

MIT
