// ======================================================
// VANGUARD BACKEND SERVER — FIXED
// ======================================================

const express = require('express');
const http    = require('http');
const WebSocket = require('ws');

const app    = express();
const server = http.createServer(app);

app.get('/', (req, res) => res.send('Vanguard backend running'));

// ======================================================
// WEBSOCKET SERVER
// ======================================================

const wss = new WebSocket.Server({
  server,
  path: '/vanguard-ws'
});

// ======================================================
// STORAGE
// ======================================================

const browserClients = new Set();
const deviceClients  = new Set();
const telemetryStore = {};

// ======================================================
// SAFE SEND
// ======================================================

function safeSend(client, data) {
  if (client.readyState !== WebSocket.OPEN) return false;
  try {
    client.send(JSON.stringify(data));
    return true;
  } catch (err) {
    console.error('SEND_ERROR:', err.message);
    return false;
  }
}

// ======================================================
// BROADCASTERS
// ======================================================

function broadcastToBrowsers(data) {
  browserClients.forEach((client) => {
    if (!safeSend(client, data)) browserClients.delete(client);
  });
}

function broadcastToDevices(data) {
  deviceClients.forEach((client) => {
    if (!safeSend(client, data)) deviceClients.delete(client);
  });
}

// ======================================================
// UPGRADE ERROR — catches bad handshakes before they
// reach the WS server and logs them clearly
// ======================================================

server.on('upgrade', (req, socket, head) => {
  if (req.url !== '/vanguard-ws') {
    console.error('UPGRADE_REJECTED — bad path:', req.url);
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
  }
});

// ======================================================
// CONNECTION
// ======================================================

wss.on('connection', (ws, req) => {
  console.log('NEW_CONNECTION from', req.socket.remoteAddress);

  ws.clientType = null;
  ws.deviceId   = null;
  ws.isAlive    = true;                          // for heartbeat tracking

  ws.on('pong', () => { ws.isAlive = true; });  // reset on pong response

  ws.on('message', (message) => {
    console.log('RAW_MESSAGE:', message.toString());

    let obj;
    try {
      obj = JSON.parse(message.toString());
    } catch {
      console.log('INVALID_JSON');
      return;
    }

    // IDENTIFY
    if (!ws.clientType && obj.type === 'identify') {
      if (obj.client === 'browser') {
        ws.clientType = 'browser';
        browserClients.add(ws);
        console.log('BROWSER_CONNECTED');
        Object.values(telemetryStore).forEach((t) => safeSend(ws, t));
        return;
      }
      if (obj.client === 'device') {
        ws.clientType = 'device';
        ws.deviceId   = obj.deviceId || 'unknown-device';
        deviceClients.add(ws);
        console.log('DEVICE_CONNECTED:', ws.deviceId);
        safeSend(ws, { type: 'server_message', message: 'device_registered', deviceId: ws.deviceId });
        return;
      }
    }

    // TELEMETRY
    if (ws.clientType === 'device' && obj.type === 'telemetry') {
      obj.deviceId = ws.deviceId;
      telemetryStore[ws.deviceId] = obj;
      console.log('TELEMETRY:', JSON.stringify(obj));
      broadcastToBrowsers(obj);
      return;
    }

    // CONTROL
    if (ws.clientType === 'browser' && obj.type === 'control') {
      console.log('CONTROL:', JSON.stringify(obj));
      broadcastToDevices(obj);
      return;
    }
  });

  ws.on('close', () => {
    console.log('CLIENT_DISCONNECTED:', ws.deviceId || ws.clientType);
    browserClients.delete(ws);
    deviceClients.delete(ws);
  });

  ws.on('error', (err) => console.error('WS_ERROR:', err.message));
});

// ======================================================
// HEARTBEAT — drops dead connections
// ======================================================

setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      console.log('HEARTBEAT_TIMEOUT — terminating');
      browserClients.delete(ws);
      deviceClients.delete(ws);
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// ======================================================
// START
// ======================================================

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('=================================');
  console.log(`SERVER RUNNING ON ${PORT}`);
  console.log('=================================');
});
