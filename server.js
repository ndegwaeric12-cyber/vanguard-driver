const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);

app.get('/', (req, res) => {
  res.send('vanguard-driver backend running');
});

// Main WebSocket server
const wss = new WebSocket.Server({
  server,
  path: '/vanguard-ws'
});

// Store latest telemetry
let lastTelemetry = null;

// Store connected browser clients separately
const browserClients = new Set();

// Store connected devices separately
const deviceClients = new Set();

wss.on('connection', (ws, req) => {

  console.log('NEW_WS_CONNECTION');

  // Identify client type
  ws.clientType = null;

  ws.on('message', (message) => {

    let obj;

    try {
      obj = JSON.parse(message.toString());
    } catch (err) {
      console.error('INVALID_JSON');
      return;
    }

    // First message should identify client
    if (!ws.clientType && obj.type === 'identify') {

      if (obj.client === 'browser') {
        ws.clientType = 'browser';
        browserClients.add(ws);

        console.log('BROWSER_CONNECTED');

        // Send latest telemetry immediately
        if (lastTelemetry) {
          ws.send(JSON.stringify(lastTelemetry));
        }

      } else if (obj.client === 'device') {

        ws.clientType = 'device';
        deviceClients.add(ws);

        console.log('DEVICE_CONNECTED');
      }

      return;
    }

    // DEVICE TELEMETRY
    if (
      ws.clientType === 'device' &&
      obj.type === 'telemetry'
    ) {

      lastTelemetry = obj;

      console.log('TELEMETRY:', obj);

      // Broadcast to browsers
      browserClients.forEach((client) => {

        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(obj));
        }

      });

      return;
    }

    // BROWSER CONTROL COMMANDS
    if (
      ws.clientType === 'browser' &&
      obj.type === 'control'
    ) {

      console.log('CONTROL_COMMAND:', obj);

      // Send to all devices
      deviceClients.forEach((client) => {

        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(obj));
        }

      });

      return;
    }

  });

  ws.on('close', () => {

    browserClients.delete(ws);
    deviceClients.delete(ws);

    console.log('CLIENT_DISCONNECTED');

  });

  ws.on('error', (err) => {
    console.error('WS_ERROR:', err.message);
  });

});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
