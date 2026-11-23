const BROKER_URLS = [
  'wss://broker-cn.emqx.io:8084/mqtt',
  'wss://broker.emqx.io:8084/mqtt',
  'wss://test.mosquitto.org:8081',
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
  // Keep-Alive 设为 120s (0x00, 0x78)，彻底防止切到微信/后台发链接期间浏览器节流定时器导致 Broker 45s 踢下线！
  const varHdr = new Uint8Array([0x00, 0x04, 0x4d, 0x51, 0x54, 0x54, 0x04, 0x02, 0x00, 0x78]);
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
  private pongWatchTimer = 0;
  private lastRxAt = 0;
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
        this.lastRxAt = Date.now();
        ws.send(buildConnectPacket(this.clientId));
      };

      ws.onmessage = (ev) => {
        if (this.closed || !(ev.data instanceof ArrayBuffer)) return;
        this.lastRxAt = Date.now();
        window.clearTimeout(this.pongWatchTimer);
        this.appendAndParse(new Uint8Array(ev.data));
      };

      ws.onerror = () => {
        // handled by onclose
      };

      ws.onclose = () => {
        this.ready = false;
        window.clearInterval(this.pingTimer);
        window.clearTimeout(this.pongWatchTimer);
        if (!this.closed) {
          this.onDisconnect();
        }
      };
    } catch {
      this.onDisconnect();
    }
  }

  public isDeadOrClosed(): boolean {
    return !this.ws || this.ws.readyState === WebSocket.CLOSING || this.ws.readyState === WebSocket.CLOSED;
  }

  public sendPingProbe(): void {
    if (this.closed || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      const pingSentAt = Date.now();
      this.ws.send(PINGREQ_PKT);
      window.clearTimeout(this.pongWatchTimer);
      // 半开死连接探活保护：前台发 PINGREQ 后若 9 秒内未收到任何包（含 PINGRESP 0xd0），判定 NAT 半死连接立即重连！
      this.pongWatchTimer = window.setTimeout(() => {
        if (this.closed || !this.ws) return;
        if (typeof document !== 'undefined' && document.hidden) return;
        if (this.lastRxAt < pingSentAt) {
          try {
            this.ws.close();
          } catch {
            // ignore
          }
        }
      }, 9000);
    } catch {
      // ignore
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
            this.sendPingProbe();
          }, 22_000);
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
    window.clearTimeout(this.pongWatchTimer);
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
 * 多节点并行寻房 + 控制面全链路冗余 / 数据面单优链路锁定 WSS 房间总线：
 * - 同时接入 EMQX 全球 + EMQX 亚太节点 + Eclipse 443 端口 + HiveMQ 全球 4 大节点
 * - 建房/加房握手、房间列表同步、准备/开局等关键控制信令跨全部在线节点并发投递（接收端幂等去重），单节点半死/断流零感知！
 * - 局内高频快照（world_sync / players_fast / player_sync / cmd_fire）自动走对端最新互通单节点，零重复带宽、零跨洲抖动！
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
  private onWakeBound: () => void;

  constructor(
    private myPeerId: string,
    roomCode: string,
    private onConnected: () => void,
    private onEnvelope: (env: RoomWireEnvelope<T>) => void,
    private onAllFailed: () => void,
    private onReconnected?: () => void
  ) {
    this.topic = `czgame/room/v2/${roomCode}`;
    this.onWakeBound = () => this.wakeAndCheckLinks();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onWakeBound);
    }
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('focus', this.onWakeBound);
    }
    for (let i = 0; i < BROKER_URLS.length; i++) {
      this.openBrokerLink(i);
    }
    this.allFailTimer = window.setTimeout(() => {
      if (!this.openedOnce && !this.closed) {
        this.onAllFailed();
      }
    }, 9500);
  }

  public wakeAndCheckLinks(): void {
    if (this.closed) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    for (let i = 0; i < BROKER_URLS.length; i++) {
      const l = this.links[i];
      if (!l || l.isDeadOrClosed()) {
        this.openBrokerLink(i);
      } else {
        l.sendPingProbe();
      }
    }
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

        if (this.seenIds.has(env.id)) continue;
        this.seenIds.add(env.id);
        this.seenQueue.push(env.id);
        if (this.seenQueue.length > 360) {
          const oldest = this.seenQueue.shift()!;
          this.seenIds.delete(oldest);
        }

        // 仅在首次收到某包 ID 时记录来源 Broker：多节点并发心跳/信令永远是延迟最低的最快节点最先抵达，
        // 慢速跨国节点的重复包在上方 seenIds 已被拦截，从而确保始终锁定双方之间 RTT 最低的极速节点！
        this.peerBrokerMap.set(env.from, sourceBrokerIdx);

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

    const t = msg?.type;
    const isHighFreqData =
      t === 'world_sync' ||
      t === 'players_fast' ||
      t === 'player_sync' ||
      t === 'cmd_fire' ||
      t === 'evt_fx' ||
      t === 'cmd_revive_tick' ||
      t === '__ping' ||
      t === '__pong';

    // 控制面信令（进房握手 join_req / join_ack、大厅列表 lobby_state、开局 start_game、心跳 __hb 等）
    // 一律跨所有在线节点冗余并发投递（接收端按 seenIds 严格幂等去重），彻底根除单节点半死/单向丢包导致加房失败！
    if (!isHighFreqData) {
      for (const { link } of ready) {
        link.publish(wire);
      }
      return;
    }

    // 1) 高频数据单播：走已知目标对端所在的互通单节点
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

    // 2) 高频数据广播：仅在已知队友所在的最小互通节点集合上发送（零冗余抖动）
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
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onWakeBound);
    }
    if (typeof window !== 'undefined' && window.removeEventListener) {
      window.removeEventListener('focus', this.onWakeBound);
    }
    window.clearTimeout(this.allFailTimer);
    for (let i = 0; i < this.links.length; i++) {
      window.clearTimeout(this.retryTimers[i]);
      this.links[i]?.close();
      this.links[i] = null;
    }
    this.peerBrokerMap.clear();
  }
}
