const BROKER_URLS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://mqtt.eclipseprojects.io:443/mqtt',
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
 * 多节点并行寻房 + 单优链路自动锁定 WSS 房间总线：
 * - 同时尝试 8084 (EMQX 亚太高速) / 443 (标准 HTTPS 端口防手机运营商防火墙拦截) / 8884 (HiveMQ 全球)
 * - 建房/加房握手期跨全部可达节点广播寻房，彻底根除“房主在 A 服、好友切到 B 服”的主备脑裂连不上问题！
 * - 一旦收到对端数据包立即记录对端所在的最优互通节点，局内高频同步仅走唯一互通单链路，零重复包、零跨洲乱序抖动！
 */
export class MqttWsRoomBus<T extends { type?: string }> {
  private links: (SingleMqttLink | null)[] = new Array(BROKER_URLS.length).fill(null);
  private retryTimers: number[] = new Array(BROKER_URLS.length).fill(0);
  private peerBrokerMap = new Map<string, number>();
  private seenIds = new Set<string>();
  private seenQueue: string[] = [];
  private seq = 0;
  private openedOnce = false;
  private closed = false;
  private allFailTimer = 0;
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
    for (let i = 0; i < BROKER_URLS.length; i++) {
      this.openBrokerLink(i);
    }
    this.allFailTimer = window.setTimeout(() => {
      if (!this.openedOnce && !this.closed) {
        this.onAllFailed();
      }
    }, 5500);
  }

  private openBrokerLink(idx: number): void {
    if (this.closed) return;
    window.clearTimeout(this.retryTimers[idx]);
    this.links[idx]?.close();

    const url = BROKER_URLS[idx];
    const cid = `cz_${this.myPeerId}_${idx}_${Math.floor(Math.random() * 99999)}`;

    this.links[idx] = new SingleMqttLink(
      url,
      cid,
      this.topic,
      () => {
        if (this.closed) return;
        window.clearTimeout(this.allFailTimer);
        if (!this.openedOnce) {
          this.openedOnce = true;
          this.onConnected();
        } else {
          this.onReconnected?.();
        }
      },
      (batchTexts) => this.handleBatch(batchTexts, idx),
      () => {
        if (this.closed) return;
        this.retryTimers[idx] = window.setTimeout(() => {
          this.openBrokerLink(idx);
        }, 3600);
      }
    );
  }

  private handleBatch(batchTexts: string[], sourceBrokerIdx: number): void {
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

        // 锁定该对端最新可达的互通 Broker 索引，后续发往该对端的包直接走此互通节点！
        this.peerBrokerMap.set(env.from, sourceBrokerIdx);

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

  private getReadyLinks(): { idx: number; link: SingleMqttLink }[] {
    const out: { idx: number; link: SingleMqttLink }[] = [];
    for (let i = 0; i < this.links.length; i++) {
      const l = this.links[i];
      if (l && l.ready) out.push({ idx: i, link: l });
    }
    return out;
  }

  public isCongested(): boolean {
    const ready = this.getReadyLinks();
    if (ready.length === 0) return true;
    for (const { link } of ready) {
      if (link.getBufferedAmount() <= 24_576) return false;
    }
    return true;
  }

  public send(to: string, msg: T, exclude?: string): void {
    const ready = this.getReadyLinks();
    if (ready.length === 0) return;

    this.seq = (this.seq + 1) % 1_000_000;
    const env: RoomWireEnvelope<T> = {
      id: `${this.myPeerId}:${this.seq.toString(36)}`,
      from: this.myPeerId,
      to,
      ...(exclude ? { exclude } : {}),
      msg,
    };
    const wire = JSON.stringify(env);

    // 1) 单播：如果已知目标对端所在的互通节点且在线，精准单发；否则（如首次 join_req 寻房）向所有在线节点同时探活！
    if (to !== '*') {
      const knownIdx = this.peerBrokerMap.get(to);
      if (knownIdx !== undefined) {
        const knownLink = this.links[knownIdx];
        if (knownLink && knownLink.ready) {
          knownLink.publish(wire);
          return;
        }
      }
      for (const { link } of ready) {
        link.publish(wire);
      }
      return;
    }

    // 2) 广播：仅在已知队友所在的最小互通节点集合上发送（2人同服时仅发 1 条链路，零冗余抖动！）
    const activePeerBrokers = new Set<number>();
    for (const [peerId, bIdx] of this.peerBrokerMap.entries()) {
      if (exclude && peerId === exclude) continue;
      if (this.links[bIdx]?.ready) {
        activePeerBrokers.add(bIdx);
      }
    }
    if (activePeerBrokers.size > 0) {
      for (const bIdx of activePeerBrokers) {
        this.links[bIdx]!.publish(wire);
      }
    } else {
      ready[0].link.publish(wire);
    }
  }

  public forgetPeer(peerId: string): void {
    this.peerBrokerMap.delete(peerId);
  }

  public close(): void {
    this.closed = true;
    window.clearTimeout(this.allFailTimer);
    for (let i = 0; i < this.links.length; i++) {
      window.clearTimeout(this.retryTimers[i]);
      this.links[i]?.close();
      this.links[i] = null;
    }
    this.peerBrokerMap.clear();
  }
}
