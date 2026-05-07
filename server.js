// ======================================================
// VANGUARD RAW WEBSOCKET SERVER
// ======================================================
// Install:
// npm install express ws
//
// Run:
// node server.js
//
// WebSocket endpoint:
// ws://localhost:3000/vanguard-ws
// ======================================================

const express = require('express');
const http = require('http');
const WebSocket = require('ws');

// ======================================================
// EXPRESS + HTTP SERVER
// ======================================================

const app = express();
const server = http.createServer(app);

// Health route
app.get('/', (req, res) => {
  res.send('vanguard-driver backend running');
});

// ======================================================
// WEBSOCKET SERVER
// ======================================================

const wss = new WebSocket.Server({
  server,
  path: '/vanguard-ws'
});

// ======================================================
// CLIENT STORAGE
// ======================================================

// Connected browsers
const browserClients = new Set();

// Connected ESP32/device clients
const deviceClients = new Set();

// Latest telemetry by device
const telemetryStore = {};

// ======================================================
// SAFE SEND FUNCTION
// ======================================================

function safeSend(client, data) {

  if (client.readyState !== WebSocket.OPEN) {
    return false;
  }

  try {

    client.send(JSON.stringify(data));
    return true;

  } catch (err) {

    console.error('SEND_ERROR:', err.message);
    return false;

  }

}

// ======================================================
// BROADCAST HELPERS
// ======================================================

function broadcastToBrowsers(data) {

  browserClients.forEach((client) => {

    const success = safeSend(client, data);

    if (!success) {
      browserClients.delete(client);
    }

  });

}

function broadcastToDevices(data) {

  deviceClients.forEach((client) => {

    const success = safeSend(client, data);

    if (!success) {
      deviceClients.delete(client);
    }

  });

}

// ======================================================
// NEW CONNECTION
// ======================================================

wss.on('connection', (ws, req) => {

  const remote =
    req.socket.remoteAddress +
    ':' +
    req.socket.remotePort;

  console.log('NEW_CONNECTION:', remote);

  // Client info
  ws.clientType = null;
  ws.deviceId = null;

  // ====================================================
  // RECEIVE MESSAGE
  // ====================================================

  ws.on('message', (message) => {

    console.log('RAW_MESSAGE:', message.toString());

    let obj;

    // --------------------------------------------------
    // SAFE JSON PARSE
    // --------------------------------------------------

    try {

      obj = JSON.parse(message.toString());

    } catch (err) {

      console.error('INVALID_JSON');

      safeSend(ws, {
        type: 'server_error',
        error: 'invalid_json'
      });

      return;
    }

    // --------------------------------------------------
    // IDENTIFY CLIENT
    // --------------------------------------------------

    if (
      !ws.clientType &&
      obj.type === 'identify'
    ) {

      // ================================================
      // BROWSER CLIENT
      // ================================================

      if (obj.client === 'browser') {

        ws.clientType = 'browser';

        browserClients.add(ws);

        console.log('BROWSER_CONNECTED');

        // Send all latest telemetry
        Object.values(telemetryStore).forEach((telemetry) => {

          safeSend(ws, telemetry);

        });

        return;
      }

      // ================================================
      // DEVICE CLIENT
      // ================================================

      if (obj.client === 'device') {

        ws.clientType = 'device';

        ws.deviceId =
          obj.deviceId || 'unknown-device';

        deviceClients.add(ws);

        console.log(
          'DEVICE_CONNECTED:',
          ws.deviceId
        );

        safeSend(ws, {
          type: 'server_message',
          message: 'device_registered',
          deviceId: ws.deviceId
        });

        return;
      }

    }

    // --------------------------------------------------
    // DEVICE TELEMETRY
    // --------------------------------------------------

    if (
      ws.clientType === 'device' &&
      obj.type === 'telemetry'
    ) {

      // Attach deviceId automatically
      obj.deviceId = ws.deviceId;

      // Save latest telemetry
      telemetryStore[ws.deviceId] = obj;

      console.log(
        'TELEMETRY:',
        JSON.stringify(obj)
      );

      // Broadcast to all browsers
      broadcastToBrowsers(obj);

      return;
    }

    // --------------------------------------------------
    // CONTROL COMMAND FROM BROWSER
    // --------------------------------------------------

    if (
      ws.clientType === 'browser' &&
      obj.type === 'control'
    ) {

      console.log(
        'CONTROL_COMMAND:',
        JSON.stringify(obj)
      );

      // Send command to all devices
      broadcastToDevices(obj);

      return;
    }

    // --------------------------------------------------
    // UNKNOWN MESSAGE TYPE
    // --------------------------------------------------

    console.log(
      'UNKNOWN_MESSAGE:',
      JSON.stringify(obj)
    );

    safeSend(ws, {
      type: 'server_error',
      error: 'unknown_message_type'
    });

  });

  // ====================================================
  // CLIENT DISCONNECT
  // ====================================================

  ws.on('close', (code, reason) => {

    console.log(
      'CLIENT_DISCONNECTED:',
      remote,
      'CODE:',
      code
    );

    browserClients.delete(ws);
    deviceClients.delete(ws);

  });

  // ====================================================
  // CONNECTION ERROR
  // ====================================================

  ws.on('error', (err) => {

    console.error(
      'WS_ERROR:',
      err.message
    );

  });

});

// ======================================================
// HEARTBEAT
// ======================================================

setInterval(() => {

  wss.clients.forEach((ws) => {

    if (ws.readyState === WebSocket.OPEN) {

      ws.ping();

    }

  });

}, 30000);

// ======================================================
// START SERVER
// ======================================================

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {

  console.log('=================================');
  console.log(`SERVER RUNNING ON PORT ${PORT}`);
  console.log(
    `WS ENDPOINT: ws://localhost:${PORT}/vanguard-ws`
  );
  console.log('=================================');

});
