// ======================================================
// VANGUARD BACKEND SERVER
// ======================================================

const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);

// ======================================================
// BASIC ROUTE
// ======================================================

app.get('/', (req, res) => {
  res.send('Vanguard backend running');
});

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
const deviceClients = new Set();

const telemetryStore = {};

// ======================================================
// SAFE SEND
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
// BROADCASTERS
// ======================================================

function broadcastToBrowsers(data) {

  browserClients.forEach((client) => {

    const ok = safeSend(client, data);

    if (!ok) {
      browserClients.delete(client);
    }

  });

}

function broadcastToDevices(data) {

  deviceClients.forEach((client) => {

    const ok = safeSend(client, data);

    if (!ok) {
      deviceClients.delete(client);
    }

  });

}

// ======================================================
// CONNECTION
// ======================================================

wss.on('connection', (ws, req) => {

  console.log('NEW_CONNECTION');

  ws.clientType = null;
  ws.deviceId = null;

  // ====================================================
  // MESSAGE
  // ====================================================

  ws.on('message', (message) => {

    console.log('RAW_MESSAGE:', message.toString());

    let obj;

    try {

      obj = JSON.parse(message.toString());

    } catch (err) {

      console.log('INVALID_JSON');

      return;
    }

    // ==================================================
    // IDENTIFY
    // ==================================================

    if (
      !ws.clientType &&
      obj.type === 'identify'
    ) {

      // ----------------------------------------------
      // BROWSER
      // ----------------------------------------------

      if (obj.client === 'browser') {

        ws.clientType = 'browser';

        browserClients.add(ws);

        console.log('BROWSER_CONNECTED');

        // Send latest telemetry
        Object.values(telemetryStore).forEach((t) => {

          safeSend(ws, t);

        });

        return;
      }

      // ----------------------------------------------
      // DEVICE
      // ----------------------------------------------

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

    // ==================================================
    // TELEMETRY
    // ==================================================

    if (
      ws.clientType === 'device' &&
      obj.type === 'telemetry'
    ) {

      obj.deviceId = ws.deviceId;

      telemetryStore[ws.deviceId] = obj;

      console.log(
        'TELEMETRY:',
        JSON.stringify(obj)
      );

      broadcastToBrowsers(obj);

      return;
    }

    // ==================================================
    // CONTROL COMMANDS
    // ==================================================

    if (
      ws.clientType === 'browser' &&
      obj.type === 'control'
    ) {

      console.log(
        'CONTROL:',
        JSON.stringify(obj)
      );

      broadcastToDevices(obj);

      return;
    }

  });

  // ====================================================
  // CLOSE
  // ====================================================

  ws.on('close', () => {

    console.log('CLIENT_DISCONNECTED');

    browserClients.delete(ws);
    deviceClients.delete(ws);

  });

  // ====================================================
  // ERROR
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
  console.log(`SERVER RUNNING ON ${PORT}`);
  console.log('=================================');

});
