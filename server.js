// server.js (Socket.IO + raw WebSocket bridge)
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);

// Socket.IO for web clients
const io = new Server(server, {
  cors: { origin: '*' }
});

// Keep track of the connected Vanguard raw websocket
let vanguardWs = null;
let parkState = { vanguard: true };

app.get('/', (req, res) => res.send('Vanguard backend running'));

// Socket.IO connections (web clients)
io.on('connection', (socket) => {
  console.log('web client connected', socket.id);

  socket.on('identify', (data) => {
    console.log('web identify', data);
    // send current park state to web client
    socket.emit('server_message', { type: 'park_state', parked: !!parkState.vanguard });
  });

  socket.on('control', (msg) => {
    try {
      if (!msg || typeof msg !== 'object') return;

      // handle park/gear state on server
      if (msg.type === 'gear' && msg.gear === 'park') {
        parkState.vanguard = true;
        io.emit('server_message', { type: 'park_state', parked: true });
        if (vanguardWs && vanguardWs.readyState === WebSocket.OPEN) {
          vanguardWs.send(JSON.stringify({ type: 'gear', gear: 'park' }));
        }
        return;
      }
      if (msg.type === 'gear' && (msg.gear === 'forward' || msg.gear === 'reverse')) {
        parkState.vanguard = false;
        io.emit('server_message', { type: 'park_state', parked: false });
      }

      // enforce park lock on server for motor/steer commands
      if (['motor','steer_start','steer_tick','steer_tap'].includes(msg.type) && parkState.vanguard) {
        socket.emit('server_message', { type: 'error', message: 'Vanguard is parked. Unpark to move.' });
        return;
      }

      // Relay to vanguard raw websocket if connected
      if (vanguardWs && vanguardWs.readyState === WebSocket.OPEN) {
        vanguardWs.send(JSON.stringify(msg));
      } else {
        socket.emit('server_message', { type: 'error', message: 'Vanguard not connected' });
      }
    } catch (e) {
      console.error('control handler error', e);
    }
  });
});

// Raw WebSocket server for ESP32 (and other raw WS clients)
const wss = new WebSocket.Server({ server, path: '/vanguard-ws' });

wss.on('connection', (ws, req) => {
  console.log('raw websocket connected from', req.socket.remoteAddress);

  // mark this as the vanguard connection (replace existing)
  vanguardWs = ws;
  // send current park state to vanguard
  ws.send(JSON.stringify({ type: 'server_message', subtype: 'park_state', parked: !!parkState.vanguard }));

ws.on('message', (message) => {
  console.log('RAW_WS_INCOMING:', message.toString());
  try {
    const obj = JSON.parse(message.toString());
    if (obj && obj.type === 'telemetry') {
      console.log('EMITTING_TELEMETRY_TO_WEB:', JSON.stringify(obj));
      io.emit('telemetry', obj);
    } else {
      io.emit('server_message', obj);
    }
  } catch (e) {
    console.warn('Invalid JSON from vanguard:', e);
  }
});


  ws.on('close', () => {
    console.log('vanguard raw websocket disconnected');
    if (vanguardWs === ws) vanguardWs = null;
    // set park for safety
    parkState.vanguard = true;
    io.emit('server_message', { type: 'park_state', parked: true });
  });

  ws.on('error', (err) => {
    console.warn('vanguard ws error', err);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
