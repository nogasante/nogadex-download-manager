# HyperDownloader

HyperDownloader is a high-performance, multi-stream desktop download accelerator built with Node.js, Electron, React, and TypeScript. It utilizes dynamic range work-stealing, adaptive network concurrency, and bounded asynchronous disk I/O to maximize transfer throughput while maintaining byte-for-byte integrity and crash resilience.

---

## Features

- **Dynamic Range Work-Stealing Scheduler**: Idle worker connections dynamically split and steal unfinished sub-ranges from slow or straggling workers.
- **Adaptive Network Intelligence**: Real-time throughput and RTT sampling with automatic concurrency scaling (`[2, 32]` workers) and exponential backoff on HTTP `429` / `503` responses.
- **Strict Byte Integrity**: Full SHA-256 verification and atomic state persistence (`.hyper_state.json`) with automatic corrupted state recovery.
- **Deep Security Architecture**:
  - **Socket-Level SSRF Interception**: Custom DNS lookup hooks block private IPs (RFC 1918, cloud metadata `169.254.169.254`, IPv6 loopback / link-local / ULA, and IPv4-mapped IPv6) before any TCP handshake.
  - **Path Traversal & Device Name Guards**: Full NFC normalization, zero-width character removal, NTFS ADS `:` neutralization, and Windows reserved device name handling (`CON`, `PRN`, `AUX`, `NUL`).
  - **Hardened Electron Wrapper**: `contextIsolation: true`, `sandbox: true`, `webSecurity: true`, popup blocker, and local origin navigation lockdown.
- **Real-Time Visualizer**: Per-chunk transfer telemetry, dynamic stream visualizer, speed graphing, and WebSocket status broadcasts.

---

## Installation & Quick Start

### Prerequisites
- **Node.js**: v20.x or v22.x+
- **npm**: v10.x+

### Setup
```bash
# Clone or navigate to the project repository
cd hyper-downloader

# Install dependencies
npm install

# Start development mode (Backend Engine + React UI in Electron)
npm run desktop
```

### Web Development Mode
```bash
# Run backend engine and Vite dev server concurrently
npm run dev
```

---

## Configuration & File Locations

- **Default Download Directory**: `~/Downloads/HyperDownloader` (configurable per download).
- **State Checkpoint File**: `~/Downloads/HyperDownloader/.hyper_state.json` (auto-saved periodically and upon graceful shutdown).
- **Default Server Port**: `5005` (configurable via `PORT` environment variable).

---

## Testing & Quality Assurance

HyperDownloader includes 12 automated test suites covering 167+ test assertions:

```bash
# Run all automated test suites
npm run test:all

# Run performance benchmark matrix
npm run benchmark

# Run production build
npm run build
```

---

## Security Model & Limitations

- **Production SSRF Protection**: In production (`allowLocalhost: false`), all outgoing connections are validated both at the URL parse stage and at the raw socket DNS resolution layer.
- **Forward Proxy Note**: In enterprise environments where traffic routes through an upstream caching forward proxy, ensure the proxy enforces equivalent subnet access policies.
- **Packaging Note**: Production desktop distributions package pre-compiled web bundles (`dist/index.html`) loaded directly over secure local `file://` protocols.

---

## License
MIT License.
