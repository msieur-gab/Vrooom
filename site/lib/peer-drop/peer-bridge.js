/**
 * peer-bridge.js — PeerJS connection manager
 *
 * EventTarget-based P2P bridge. Host creates a session,
 * phone joins by session ID, data flows.
 *
 * Events: ready, connected, disconnected, data, error, log
 */

import { Peer } from 'https://esm.sh/peerjs@1';

const DEFAULTS = {
  heartbeatInterval: 5000,
  heartbeatTimeout: 15000,
  prefix: 'peer-drop',
};

function generateSessionId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 6; i++) id += chars[Math.random() * chars.length | 0];
  return `PD-${id}`;
}

export class PeerBridge extends EventTarget {

  #peer = null;
  #connection = null;
  #heartbeatTimer = null;
  #lastPong = 0;
  #checkTimer = null;
  #options = {};
  #role = null; // 'host' | 'sender'
  #sessionId = null;
  #debug = false;
  #wakeLock = null;
  #connectionTimer = null;
  #pendingReason = null;

  constructor(options = {}) {
    super();
    this.#options = { ...DEFAULTS, ...options };
    this.#debug = options.debug || false;
  }

  get sessionId() { return this.#sessionId; }
  get connected() { return this.#connection?.open === true; }

  // — URL helpers —

  static sessionFrom(url) {
    try {
      return new URL(url).searchParams.get('session');
    } catch { return null; }
  }

  sessionUrl(baseUrl) {
    if (!this.#sessionId) return null;
    const url = new URL(baseUrl);
    url.searchParams.set('session', this.#sessionId);
    return url.href;
  }

  // — Host mode —

  host(sessionId) {
    this.#role = 'host';
    this.#sessionId = sessionId || generateSessionId();
    const peerId = `${this.#options.prefix}-${this.#sessionId}`;

    this.#log(`host: creating peer ${peerId}`);
    this.#peer = new Peer(peerId, { debug: this.#debug ? 2 : 0 });

    this.#peer.on('open', (id) => {
      this.#log(`host: signaling open, id=${id}`);
      this.#emit('ready', { peerId: id, sessionId: this.#sessionId });
    });

    this.#peer.on('connection', (conn) => {
      this.#log(`host: incoming connection from ${conn.peer}`);
      this.#connection = conn;
      this.#setupConnection(conn);
    });

    this.#peer.on('disconnected', () => {
      this.#log('host: signaling server disconnected', 'warn');
    });

    this.#peer.on('error', (err) => this.#handleError(err));

    return { sessionId: this.#sessionId };
  }

  // — Sender mode —

  join(sessionId) {
    this.#role = 'sender';
    this.#sessionId = sessionId;
    const hostPeerId = `${this.#options.prefix}-${sessionId}`;

    this.#log(`join: connecting to host ${hostPeerId}`);
    this.#peer = new Peer(undefined, { debug: this.#debug ? 2 : 0 });

    this.#peer.on('open', (id) => {
      this.#log(`join: signaling open, id=${id}`);
      this.#emit('ready', { peerId: id, sessionId });
      this.#log(`join: calling connect(${hostPeerId})`);
      this.#connection = this.#peer.connect(hostPeerId, { reliable: true });
      this.#log(`join: connection object created, label=${this.#connection.label}`);
      this.#startConnectionTimeout();
      this.#setupConnection(this.#connection);
    });

    this.#peer.on('disconnected', () => {
      this.#log('join: signaling server disconnected', 'warn');
    });

    this.#peer.on('error', (err) => this.#handleError(err));
  }

  // — Send data —

  send(data) {
    if (!this.#connection?.open) return false;
    this.#connection.send(data);
    return true;
  }

  // — Disconnect: close connection, keep session for retry —
  // Optional reason string is sent to the remote peer (best-effort).

  disconnect(reason) {
    this.#clearConnectionTimeout();
    this.#stopHeartbeat();
    this.#releaseWakeLock();

    // Snapshot refs, then null fields immediately so retry() is safe
    const conn = this.#connection;
    const peer = this.#peer;
    this.#connection = null;
    this.#peer = null;
    this.#pendingReason = null;

    if (reason && conn?.open) {
      // Send bye message, then close after grace period for flush
      conn.send({ __peerDrop: 'bye', reason });
      setTimeout(() => {
        conn.close();
        peer?.destroy();
      }, 100);
    } else {
      if (conn) conn.close();
      if (peer) peer.destroy();
    }
  }

  // — Destroy: full teardown, session gone —

  destroy() {
    this.disconnect();
    this.#role = null;
    this.#sessionId = null;
  }

  // — Retry: tear down failed attempt, rejoin same session —

  retry() {
    if (this.#connection?.open) return;
    const sessionId = this.#sessionId;
    const role = this.#role;
    if (!sessionId || !role) return;

    this.#log(`retry: re-attempting as ${role}, session=${sessionId}`);
    this.disconnect();

    if (role === 'host') {
      this.host(sessionId);
    } else {
      this.join(sessionId);
    }
  }

  // — Internal: wire up connection events —

  #setupConnection(conn) {
    this.#log(`setupConnection: peer=${conn.peer}, type=${conn.type}, reliable=${conn.reliable}`);

    conn.on('open', () => {
      this.#log('connection: OPEN', 'ok');
      this.#clearConnectionTimeout();
      this.#acquireWakeLock();
      this.#emit('connected', { role: this.#role });
      if (this.#role === 'host') this.#startHeartbeat();
    });

    conn.on('iceStateChanged', (state) => {
      this.#log(`connection: ICE state → ${state}`);
    });

    conn.on('data', (data) => {
      // Internal protocol — invisible to consumer
      if (data?.__peerDrop === 'ping') {
        this.#connection?.send({ __peerDrop: 'pong' });
        return;
      }
      if (data?.__peerDrop === 'pong') {
        this.#lastPong = Date.now();
        return;
      }
      if (data?.__peerDrop === 'bye') {
        this.#pendingReason = data.reason || undefined;
        return;
      }
      this.#emit('data', { data });
    });

    conn.on('close', () => {
      this.#log('connection: CLOSED');
      this.#stopHeartbeat();
      this.#releaseWakeLock();
      // Only emit if we didn't initiate — disconnect() nulls #connection before closing
      if (!this.#connection) return;
      this.#connection = null;
      const reason = this.#pendingReason || undefined;
      this.#pendingReason = null;
      this.#emit('disconnected', { role: this.#role, reason });
    });

    conn.on('error', (err) => {
      this.#log(`connection: ERROR ${err.type} ${err.message}`, 'err');
      this.#handleError(err);
    });
  }

  // — Connection timeout —

  #startConnectionTimeout() {
    const timeout = this.#options.connectionTimeout;
    if (!timeout) return;
    this.#clearConnectionTimeout();
    this.#connectionTimer = setTimeout(() => {
      this.#log('connection timeout — host unreachable');
      if (this.#connection) {
        this.#connection.close();
        this.#connection = null;
      }
      this.#emit('error', { type: 'connection-timeout', message: 'Connection timed out — are both devices on the same network?' });
    }, timeout);
  }

  #clearConnectionTimeout() {
    if (this.#connectionTimer) {
      clearTimeout(this.#connectionTimer);
      this.#connectionTimer = null;
    }
  }

  // — Wake Lock —

  async #acquireWakeLock() {
    if (!this.#options.keepAwake || !navigator.wakeLock) return;
    try {
      this.#wakeLock = await navigator.wakeLock.request('screen');
      this.#log('wake lock acquired');
      this.#wakeLock.addEventListener('release', () => {
        this.#log('wake lock released');
        this.#wakeLock = null;
      });
    } catch {
      this.#log('wake lock unavailable');
    }
  }

  #releaseWakeLock() {
    if (this.#wakeLock) {
      this.#wakeLock.release();
      this.#wakeLock = null;
    }
  }

  // — Heartbeat —

  #startHeartbeat() {
    this.#lastPong = Date.now();
    const { heartbeatInterval, heartbeatTimeout } = this.#options;

    this.#heartbeatTimer = setInterval(() => {
      if (this.#connection?.open) {
        this.#connection.send({ __peerDrop: 'ping' });
      }
    }, heartbeatInterval);

    this.#checkTimer = setInterval(() => {
      if (Date.now() - this.#lastPong > heartbeatTimeout) {
        this.#stopHeartbeat();
        this.#releaseWakeLock();
        if (this.#connection) {
          this.#connection.close();
          this.#connection = null;
        }
        this.#emit('disconnected', { role: this.#role, reason: 'heartbeat-timeout' });
      }
    }, heartbeatInterval);
  }

  #stopHeartbeat() {
    clearInterval(this.#heartbeatTimer);
    clearInterval(this.#checkTimer);
    this.#heartbeatTimer = null;
    this.#checkTimer = null;
  }

  // — Error handling —

  #handleError(err) {
    if (err.type === 'disconnected' && this.#connection?.open) return;
    this.#emit('error', { type: err.type, message: err.message });
  }

  // — Logging —

  #log(msg) {
    if (!this.#debug) return;
    this.#emit('log', { message: msg });
  }

  #emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}
