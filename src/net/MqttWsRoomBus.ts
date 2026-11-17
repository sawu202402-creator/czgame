const BROKER_URLS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
];

const enc = new TextEncoder();
const dec = new TextDecoder();

function encodeVarLen(len: number): number[] {
  const out: number[] = [];
  let n = len;
  do {
    let digit = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) digit |= 0x80;
    out.push(digit);
  } while (n > 0);
  return out;
}

function encodeUtf8Field(str: string): Uint8Array {
  const bytes = enc.encode(str);
  const out = new Uint8Array(2 + bytes.length);
  out[0] = (bytes.length >> 8) & 0xff;
  out[1] = bytes.length & 0xff;
  out.set(bytes, 2);
  return out;
}

function buildConnectPacket(clientId: string): Uint8Array {
  const varHdr = new Uint8Array([0x00, 0x04, 0x4d, 0x51, 0x54, 0x54, 0x04, 0x02, 0x00, 0x1e]);
  const payload = encodeUtf8Field(clientId);
  const remLen = varHdr.length + payload.length;
  const fixed = new Uint8Array([0x10, ...encodeVarLen(remLen)]);
  const pkt = new Uint8Array(fixed.length + remLen);
  pkt.set(fixed, 0);
  pkt.set(varHdr, fixed.length);
  pkt.set(payload, fixed.length + varHdr.length);
  return pkt;
}

function buildSubscribePacket(topic: string, packetId = 1): Uint8Array {
  const pid = new Uint8Array([(packetId >> 8) & 0xff, packetId & 0xff]);
  const topicField = encodeUtf8Field(topic);
  const qos = new Uint8Array([0x00]);
  const remLen = pid.length + topicField.length + qos.length;
  const fixed = new Uint8Array([0x82, ...encodeVarLen(remLen)]);
  const pkt = new Uint8Array(fixed.length + remLen);
  pkt.set(fixed, 0);
  pkt.set(pid, fixed.length);
  pkt.set(topicField, fixed.length + pid.length);
  pkt.set(qos, fixed.length + pid.length + topicField.length);
  return pkt;
}

function buildPublishPacket(topic: string, jsonText: string): Uint8Array {
  const topicField = encodeUtf8Field(topic);
  const payload = enc.encode(jsonText);
  const remLen = topicField.length + payload.length;
  const fixed = new Uint8Array([0x30, ...encodeVarLen(remLen)]);
  const pkt = new Uint8Array(fixed.length + remLen);
  pkt.set(fixed, 0);
  pkt.set(topicField, fixed.length);
  pkt.set(payload, fixed.length + topicField.length);
  return pkt;
}

const PINGREQ_PKT = new Uint8Array([0xc0, 0x00]);
const DISCONNECT_PKT = new Uint8Array([0xe0, 0x00]);

class SingleMqttLink {
  private ws: WebSocket | null = null;
  private rxBuf: Uint8Array = new Uint8Array(0);
  private pingTimer = 0;
  public ready = false;
  private closed = false;

  constructor(
    private url: string,
    private clientId: string,
    private topic: string,
    private onReady: () => void,
    private onBatchPayloads: (texts: string[]) => void,
    private onDisconnect: () => void
  ) {
    this.connect();
  }

  private connect(): void {
    try {
      const ws = new WebSocket(this.url, 'mqtt');
      ws.binaryType = 'arraybuffer';
      this.ws = ws;

      ws.onopen = () => {
        if (this.closed) return;
        ws.send(buildConnectPacket(this.clientId));
      };

      ws.onmessage = (ev) => {
        if (this.closed || !(ev.data instanceof ArrayBuffer)) return;
        this.appendAndParse(new Uint8Array(ev.data));
      };

      ws.onerror = () => {
        // handled by onclose
      };

      ws.onclose = () => {
        this.ready = false;
        window.clearInterval(this.pingTimer);
        if (!this.closed) {
          this.onDisconnect();
        }
      };
    } catch {
      this.onDisconnect();
    }
  }

  private appendAndParse(chunk: Uint8Array): void {
    if (this.rxBuf.length === 0) {
      this.rxBuf = chunk;
    } else {
      const merged = new Uint8Array(this.rxBuf.length + chunk.length);
      merged.set(this.rxBuf, 0);
      merged.set(chunk, this.rxBuf.length);
      this.rxBuf = merged;
    }

    const batch: string[] = [];

    while (this.rxBuf.length >= 2) {
      const headerByte = this.rxBuf[0];
      let mult = 1;
      let remLen = 0;
      let idx = 1;
      let completeLen = true;

      while (true) {
        if (idx >= this.rxBuf.length) {
          completeLen = false;
          break;
        }
        const b = this.rxBuf[idx++];
        remLen += (b & 0x7f) * mult;
        mult *= 128;
        if ((b & 0x80) === 0) break;
        if (mult > 128 * 128 * 128) {
          this.rxBuf = new Uint8Array(0);
          return;
        }
      }

      if (!completeLen || this.rxBuf.length < idx + remLen) {
        break;
      }

      const body = this.rxBuf.subarray(idx, idx + remLen);
      this.rxBuf = this.rxBuf.slice(idx + remLen);

      const pktType = headerByte & 0xf0;
      if (pktType === 0x20) {
        if (body.length >= 2 && body[1] === 0x00 && this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(buildSubscribePacket(this.topic, 1));
          window.clearInterval(this.pingTimer);
          this.pingTimer = window.setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
              this.ws.send(PINGREQ_PKT);
            }
          }, 18_000);
        }
      } else if (pktType === 0x90) {
        if (!this.ready) {
          this.ready = true;
          this.onReady();
        }
      } else if (pktType === 0x30) {
        if (body.length < 2) continue;
        const topicLen = (body[0] << 8) | body[1];
        let pOffset = 2 + topicLen;
        const qos = (headerByte >> 1) & 0x03;
        if (qos > 0) pOffset += 2;
        if (pOffset <= body.length) {
          batch.push(dec.decode(body.subarray(pOffset)));
        }
      }
    }

    if (batch.length > 0) {
      this.onBatchPayloads(batch);
    }
  }

  public getBufferedAmount(): number {
    return this.ws ? this.ws.bufferedAmount : 0;
  }

  public publish(jsonText: string): void {
    if (!this.ready || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(buildPublishPacket(this.topic, jsonText));
    } catch {
      // ignore transient send error
    }
  }

  public close(): void {
    this.closed = true;
    this.ready = false;
    window.clearInterval(this.pingTimer);
    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(DISCONNECT_PKT);
        }
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
  }
}

export interface RoomWireEnvelope<T> {
  id: string;
  from: string;
  to: string;
  exclude?: string;
  msg: T;
}

/**
 * 单主节点低抖动 WSS 房间总线（主节点不可达时自动切换备用节点，杜绝双节点跨洲延迟差导致的位置乱跳）
 */
export class MqttWsRoomBus<T extends { type?: string }> {
  private activeLink: SingleMqttLink | null = null;
  private seenIds = new Set<string>();
  private seenQueue: string[] = [];
  private seq = 0;
  private openedOnce = false;
  private closed = false;
  private failoverTimer = 0;
  private brokerIndex = 0;
  private topic: string;

  constructor(
    private myPeerId: string,
    roomCode: string,
    private onConnected: () => void,
    private onEnvelope: (env: RoomWireEnvelope<T>) => void,
    private onAllFailed: () => void,
    private onReconnected?: () => void
  ) {
    this.topic = `czgame/room/v2/${roomCode}`;
    this.openBroker(0);
  }

  private openBroker(idx: number): void {
    if (this.closed) return;
    if (idx >= BROKER_URLS.length) {
      if (!this.openedOnce) {
        this.onAllFailed();
      } else {
        // 已建立过房间时短暂重连主节点
        this.failoverTimer = window.setTimeout(() => this.openBroker(0), 1200);
      }
      return;
    }

    this.brokerIndex = idx;
    this.activeLink?.close();

    const url = BROKER_URLS[idx];
    const cid = `cz_${this.myPeerId}_${idx}_${Math.floor(Math.random() * 9999)}`;

    window.clearTimeout(this.failoverTimer);
    this.failoverTimer = window.setTimeout(() => {
      if (!this.activeLink?.ready && !this.closed) {
        this.openBroker(idx + 1);
      }
    }, 3400);

    this.activeLink = new SingleMqttLink(
      url,
      cid,
      this.topic,
      () => {
        window.clearTimeout(this.failoverTimer);
        if (!this.openedOnce) {
          this.openedOnce = true;
          this.onConnected();
        } else {
          this.onReconnected?.();
        }
      },
      (batchTexts) => this.handleBatch(batchTexts),
      () => {
        if (this.closed) return;
        window.clearTimeout(this.failoverTimer);
        this.openBroker(this.brokerIndex + 1);
      }
    );
  }

  private handleBatch(batchTexts: string[]): void {
    // 同一 TCP 接收批次内如果积压了多帧高频快照（world_sync / players_fast / player_sync），只保留最新一帧，彻底消除瞬间卡顿！
    const parsed: RoomWireEnvelope<T>[] = [];
    let latestWorldIdx = -1;
    let latestPlayersFastIdx = -1;
    const latestPlayerSyncByFrom = new Map<string, number>();

    for (let i = 0; i < batchTexts.length; i++) {
      try {
        const env = JSON.parse(batchTexts[i]) as RoomWireEnvelope<T>;
        if (!env || !env.id || !env.from || env.from === this.myPeerId) continue;
        if (env.exclude && env.exclude === this.myPeerId) continue;
        if (env.to !== '*' && env.to !== this.myPeerId) continue;

        if (this.seenIds.has(env.id)) continue;
        this.seenIds.add(env.id);
        this.seenQueue.push(env.id);
        if (this.seenQueue.length > 360) {
          const oldest = this.seenQueue.shift()!;
          this.seenIds.delete(oldest);
        }

        const outIdx = parsed.length;
        parsed.push(env);

        const t = env.msg?.type;
        if (t === 'world_sync') {
          latestWorldIdx = outIdx;
        } else if (t === 'players_fast') {
          latestPlayersFastIdx = outIdx;
        } else if (t === 'player_sync') {
          latestPlayerSyncByFrom.set(env.from, outIdx);
        }
      } catch {
        // ignore malformed payload
      }
    }

    for (let i = 0; i < parsed.length; i++) {
      const env = parsed[i];
      const t = env.msg?.type;
      if (t === 'world_sync' && i !== latestWorldIdx) continue;
      if (t === 'players_fast' && i !== latestPlayersFastIdx) continue;
      if (t === 'player_sync' && latestPlayerSyncByFrom.get(env.from) !== i) continue;
      this.onEnvelope(env);
    }
  }

  public isCongested(): boolean {
    return !this.activeLink || !this.activeLink.ready || this.activeLink.getBufferedAmount() > 24_576;
  }

  public send(to: string, msg: T, exclude?: string): void {
    if (!this.activeLink || !this.activeLink.ready) return;
    this.seq = (this.seq + 1) % 1_000_000;
    const env: RoomWireEnvelope<T> = {
      id: `${this.myPeerId}:${this.seq.toString(36)}`,
      from: this.myPeerId,
      to,
      ...(exclude ? { exclude } : {}),
      msg,
    };
    this.activeLink.publish(JSON.stringify(env));
  }

  public close(): void {
    this.closed = true;
    window.clearTimeout(this.failoverTimer);
    this.activeLink?.close();
    this.activeLink = null;
  }
}
