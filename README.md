<p align="center">
  <img src="https://img.shields.io/badge/WebRTC-MJPEG-blue?style=for-the-badge&logo=webrtc" alt="WebRTC">
  <img src="https://img.shields.io/badge/TSN-CBS-green?style=for-the-badge" alt="TSN CBS">
  <img src="https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge" alt="License">
</p>

<h1 align="center">
  🎥 MJPEG Stream + CBS Control
</h1>

<p align="center">
  <strong>Real-time MJPEG Webcam Streaming with TSN CBS (Credit Based Shaper) Control</strong>
  <br>
  <em>for Microchip LAN969x TSN Switch</em>
</p>

<p align="center">
  <a href="#-features">Features</a> •
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-architecture">Architecture</a> •
  <a href="#-api">API</a> •
  <a href="#-cbs-configuration">CBS Config</a>
</p>

---

## 📸 Demo

<p align="center">
  <img width="100%" alt="MJPEG Stream CBS Demo" src="https://github.com/user-attachments/assets/cd93f9e6-3acc-4498-a0ac-69320e08b7f6" />
</p>

<p align="center">
  <a href="https://www.youtube.com/shorts/27pEYafkC0E">
    <img src="https://img.shields.io/badge/▶_Watch_Demo-YouTube-red?style=for-the-badge&logo=youtube" alt="Watch Demo on YouTube">
  </a>
</p>

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🎬 **MJPEG Streaming** | Browser-based webcam capture and real-time streaming |
| 📊 **Real-time Stats** | Live graphs for Bitrate, FPS, Latency, Frame Size |
| ⚡ **Low Latency** | Frame dropping mechanism prevents queue buildup |
| 🔧 **CBS Control** | GUI for Credit Based Shaper configuration |
| 👥 **Multi-Viewer** | Independent streams - slow viewers don't block others |
| 📱 **Legacy Support** | Presets for old devices (Old Mac, low-spec hardware) |

---

## 🚀 Quick Start

```bash
# Clone repository
git clone https://github.com/hwkim3330/webrtc-mjpge-cbs.git
cd webrtc-mjpge-cbs

# Install & Run
npm install
./start.sh
```

### 🌐 Access URLs

| Page | URL | Description |
|:----:|-----|-------------|
| 🏠 | `http://localhost:3000` | Main landing page |
| 📹 | `http://localhost:3000/broadcast` | Webcam streaming + CBS control |
| 👁️ | `http://[IP]:3000/watch` | Viewer page with stats |
| ⚙️ | `http://localhost:3000/cbs` | CBS control only |
| 🎞️ | `http://[IP]:3000/stream.mjpg` | Raw MJPEG stream |

---

## 🏗️ Architecture

```
┌─────────────────┐                        ┌─────────────────┐                        ┌─────────────────┐
│   Broadcaster   │      Socket.IO         │     Server      │      MJPEG HTTP        │     Viewer      │
│    (Browser)    │ ═══════════════════▶   │    (Node.js)    │ ═══════════════════▶   │    (Browser)    │
│                 │    Binary Frame        │                 │   multipart/stream     │                 │
└────────┬────────┘    (non-blocking)      └────────┬────────┘                        └─────────────────┘
         │                                          │
         │ getUserMedia                             │ CBS CLI
         │ Canvas → JPEG                            │ (mvdct.cli)
         ▼                                          ▼
    ┌─────────┐                              ┌───────────┐
    │ Webcam  │                              │TSN Switch │
    └─────────┘                              │ (LAN969x) │
                                             └───────────┘
```

---

## 📁 Project Structure

```
webrtc-mjpge-cbs/
├── 📄 server.js          # Express server + CBS API + MJPEG streaming
├── 📄 package.json       # Dependencies
├── 📄 start.sh           # Start script
├── 📂 public/
│   ├── 📄 index.html         # Landing page
│   ├── 📄 broadcaster.html   # Broadcast + CBS control (3-column)
│   ├── 📄 viewer.html        # Viewer with real-time stats
│   └── 📄 cbs.html           # CBS control only
└── 📄 README.md          # Documentation
```

---

## 🎛️ Streaming Presets

| Preset | Resolution | FPS | Quality | Use Case |
|:------:|:----------:|:---:|:-------:|----------|
| ⚡ **Low Latency** | 480p | 15 | Low | Default, recommended |
| ⚖️ Balanced | 720p | 30 | Mid | General use |
| 🎨 Quality | 1080p | 30 | High | High quality needs |
| 🖥️ **Old Mac** | 240p | 10 | Very Low | Legacy hardware |

---

## 🔌 API

### Streaming Endpoints

| Method | Endpoint | Description |
|:------:|----------|-------------|
| `GET` | `/stream.mjpg` | MJPEG stream (multipart/x-mixed-replace) |
| `POST` | `/frame` | Receive frame from broadcaster |
| `GET` | `/api/status` | Get streaming status |

### CBS Control Endpoints

| Method | Endpoint | Description |
|:------:|----------|-------------|
| `GET` | `/api/cbs/device` | Check device connection |
| `GET` | `/api/cbs/config` | Get CBS config for all ports |
| `POST` | `/api/cbs/set` | Set CBS on ports |
| `POST` | `/api/cbs/delete` | Delete CBS config |

### API Examples

<details>
<summary><b>Set CBS Configuration</b></summary>

```bash
curl -X POST http://localhost:3000/api/cbs/set \
  -H "Content-Type: application/json" \
  -d '{"ports": [8,9,10,11], "tc": 0, "idleSlope": 100000}'
```
</details>

<details>
<summary><b>Delete CBS Configuration</b></summary>

```bash
curl -X POST http://localhost:3000/api/cbs/delete \
  -H "Content-Type: application/json" \
  -d '{"port": 8, "tc": 0}'
```
</details>

<details>
<summary><b>Get Streaming Status</b></summary>

```bash
curl http://localhost:3000/api/status
# Response: {"broadcasting":true,"viewers":2}
```
</details>

---

## ⚙️ CBS Configuration

### Prerequisites

1. **Download VelocityDRIVE CT CLI:**
   ```bash
   wget http://mscc-ent-open-source.s3-website-eu-west-1.amazonaws.com/public_root/velocitydrivect/2025.06/Microchip_VelocityDRIVE_CT-CLI-linux-2025.07.12.tgz
   tar -xzf Microchip_VelocityDRIVE_CT-CLI-linux-2025.07.12.tgz
   ```

2. **Update CLI path in `server.js`:**
   ```javascript
   const CBS_CLI_PATH = '/path/to/mvdct.cli';
   const CBS_DEVICE = '/dev/ttyACM0';
   ```

3. **Add user to dialout group:**
   ```bash
   sudo usermod -aG dialout $USER
   # Logout and login again
   ```

### Quick Presets

| Preset | Ports | TC | Bandwidth |
|--------|:-----:|:--:|:---------:|
| **P8-11 TC0 100M** | 8-11 | TC0 | 100 Mbps |
| **P1-4 TC0 50M** | 1-4 | TC0 | 50 Mbps |
| **ALL TC0 100M** | 1-12 | TC0 | 100 Mbps |

---

## 🔧 Technical Details

### Latency Optimization

| Technique | Purpose |
|-----------|---------|
| Frame dropping | Prevent queue buildup |
| `socket.volatile.emit()` | Drop frames if buffer full |
| `writableNeedDrain` check | Skip slow viewers |
| Binary transfer | 33% less overhead vs base64 |
| `toBlob()` async | Non-blocking JPEG encoding |

### Key Technologies

- **TSN Standards:** IEEE 802.1Qav (CBS), IEEE 1588 (PTP)
- **Protocols:** MJPEG over HTTP, Socket.IO (WebSocket)
- **Backend:** Node.js, Express
- **Frontend:** Vanilla JavaScript, Canvas API

---

## 🐛 Troubleshooting

<details>
<summary><b>High Latency (>1 second)</b></summary>

- Use "Low Latency" or "Old Mac" preset
- Check network bandwidth
- Reduce resolution/FPS/quality
</details>

<details>
<summary><b>Viewer Freezing</b></summary>

- Check if CBS is limiting bandwidth too much
- Verify network connectivity
- Check "Frames Dropped" counter
</details>

<details>
<summary><b>CBS Not Working</b></summary>

- Verify device: `ls -la /dev/ttyACM0`
- Check permissions: `groups $USER`
- Test CLI: `./mvdct.cli device /dev/ttyACM0 type`
</details>

---

## 📝 License

MIT License - feel free to use this project for any purpose.

---

<p align="center">
  <sub>Made with ❤️ for TSN/QoS Research</sub>
</p>
