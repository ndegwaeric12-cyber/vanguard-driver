// server.js
// Minimal Node.js server bridging a raw WebSocket endpoint (/vanguard-ws)
// to Socket.IO web clients. Includes safe JSON parsing and temporary debug logs.
//
// Install dependencies:
//   npm install express http ws socket.io

const express = require('express');
const http = require('http');
const WebSocket = require('ws'); // ws library
const { Server: IOServer } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new IOServer(server);

// Simple health route
app.get('/', (req, res) => res.send('vanguard-driver backend running'));

// --- WebSocket server for raw device connections (ESP32) ---
const wss = new WebSocket.Server({ noServer: true, path: '/vanguard-ws' });

// Keep track of the latest telemetry (optional)
let lastTelemetry = null;

// When an HTTP upgrade request comes in, route to the ws server if path matches
server.on('upgrade', (request, socket, head) => {
  if (request.url === '/vanguard-ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// Handle raw WS connections
wss.on('connection', (rawWs, req) => {
  const remote = req.socket.remoteAddress + ':' + req.socket.remotePort;
  console.log('RAW_WS_CONNECTED from', remote);

  rawWs.on('message', (message) => {
    // Debug: log raw incoming message
    console.log('RAW_WS_INCOMING:', message.toString());

    // Parse JSON safely
    let obj;
    try {
      obj = JSON.parse(message.toString());
    } catch (err) {
      console.error('RAW_WS_JSON_PARSE_ERROR:', err.message);
      // Optionally reply with an error
      try { rawWs.send(JSON.stringify({ type: 'server_message', error: 'invalid_json' })); } catch (e) {}
      return;
    }

    // Example: if telemetry, store and emit to web clients
    if (obj && obj.type === 'telemetry') {
      lastTelemetry = obj;
      // Emit to all connected socket.io clients
      io.emit('telemetry', obj);

      // Debug: log what we emitted
      console.log('EMITTING_TELEMETRY_TO_WEB:', JSON.stringify(obj));
      return;
    }

    // Example: forward other messages to web clients as-is
    io.emit('raw_ws_message', obj);
    console.log('EMITTING_RAW_WS_MESSAGE_TO_WEB:', JSON.stringify(obj));
  });

  rawWs.on('close', (code, reason) => {
    console.log('RAW_WS_DISCONNECTED', remote, 'code=', code, 'reason=', reason && reason.toString());
  });

  rawWs.on('error', (err) => {
    console.error('RAW_WS_ERROR from', remote, err && err.message);
  });

  // Optionally accept control messages from web clients and forward to device
  // (Handled below via socket.io)
});

// --- Socket.IO for browser/web clients ---
io.on('connection', (socket) => {
  console.log('WEB_CLIENT_CONNECTED:', socket.id);

  // Provide last telemetry on connect
  if (lastTelemetry) {
    socket.emit('telemetry', lastTelemetry);
  }

  // When web client sends a control message, forward to all raw WS clients
  socket.on('control', (msg) => {
    // msg expected to be a JSON-serializable object
    console.log('WEB_CONTROL_INCOMING from', socket.id, JSON.stringify(msg));

    // Broadcast to all connected raw WS clients
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(JSON.stringify(msg));
        } catch (err) {
          console.error('ERROR_SENDING_TO_RAW_WS:', err.message);
        }
      }
    });
  });

  socket.on('disconnect', (reason) => {
    console.log('WEB_CLIENT_DISCONNECTED:', socket.id, reason);
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log('Raw WS path: /vanguard-ws');
});
