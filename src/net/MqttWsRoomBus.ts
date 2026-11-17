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
  // MQTT 3.1.1 Variable Header (10 bytes): Protocol Name "MQTT" (0,4,'M','Q','T','T'), Level 4, CleanSession(0x02), KeepAlive 30s(0,30)
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
    private onPayload: (text: string) => void,
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
        const wasReady = this.ready;
        this.ready = false;
        window.clearInterval(this.pingTimer);
        if (!this.closed && wasReady) {
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
          // Malformed frame
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
        // CONNACK -> send SUBSCRIBE and wait for SUBACK (0x90)
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
        // SUBACK -> subscription active on broker!
        if (!this.ready) {
          this.ready = true;
          this.onReady();
        }
      } else if (pktType === 0x30) {
        // PUBLISH
        if (body.length < 2) continue;
        const topicLen = (body[0] << 8) | body[1];
        let pOffset = 2 + topicLen;
        const qos = (headerByte >> 1) & 0x03;
        if (qos > 0) pOffset += 2;
        if (pOffset <= body.length) {
          const text = dec.decode(body.subarray(pOffset));
          this.onPayload(text);
        }
      }
    }
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
  to: string; // '*' or specific peerId
  exclude?: string;
  msg: T;
}

/**
 * 双全球节点 WSS 房间消息总线（同时穿透国内 4G/5G、微信浏览器、对称 NAT 与海外 VPN 网络）
 */
export class MqttWsRoomBus<T> {
  private links: SingleMqttLink[] = [];
  private seenIds = new Set<string>();
  private seenQueue: string[] = [];
  private seq = 0;
  private openedOnce = false;
  private connectTimeout = 0;

  constructor(
    private myPeerId: string,
    roomCode: string,
    onConnected: () => void,
    private onEnvelope: (env: RoomWireEnvelope<T>) => void,
    onAllFailed: () => void,
    onExtraLinkReady?: () => void
  ) {
    const topic = `czgame/room/v2/${roomCode}`;

    this.connectTimeout = window.setTimeout(() => {
      if (!this.openedOnce) {
        onAllFailed();
      }
    }, 8500);

    BROKER_URLS.forEach((url, i) => {
      const cid = `cz_${myPeerId}_${i}_${Math.floor(Math.random() * 9999)}`;
      const link = new SingleMqttLink(
        url,
        cid,
        topic,
        () => {
          if (!this.openedOnce) {
            this.openedOnce = true;
            window.clearTimeout(this.connectTimeout);
            onConnected();
          } else {
            onExtraLinkReady?.();
          }
        },
        (rawText) => this.handleIncoming(rawText),
        () => {
          if (this.openedOnce && this.links.every((l) => !l.ready)) {
            onAllFailed();
          }
        }
      );
      this.links.push(link);
    });
  }

  private handleIncoming(rawText: string): void {
    try {
      const env = JSON.parse(rawText) as RoomWireEnvelope<T>;
      if (!env || !env.id || !env.from || env.from === this.myPeerId) return;
      if (env.exclude && env.exclude === this.myPeerId) return;
      if (env.to !== '*' && env.to !== this.myPeerId) return;

      if (this.seenIds.has(env.id)) return;
      this.seenIds.add(env.id);
      this.seenQueue.push(env.id);
      if (this.seenQueue.length > 360) {
        const oldest = this.seenQueue.shift()!;
        this.seenIds.delete(oldest);
      }

      this.onEnvelope(env);
    } catch {
      // ignore malformed payload
    }
  }

  public send(to: string, msg: T, exclude?: string): void {
    this.seq = (this.seq + 1) % 1_000_000;
    const env: RoomWireEnvelope<T> = {
      id: `${this.myPeerId}:${this.seq.toString(36)}`,
      from: this.myPeerId,
      to,
      ...(exclude ? { exclude } : {}),
      msg,
    };
    const text = JSON.stringify(env);
    for (const link of this.links) {
      link.publish(text);
    }
  }

  public close(): void {
    window.clearTimeout(this.connectTimeout);
    for (const link of this.links) {
      link.close();
    }
    this.links = [];
  }
}
