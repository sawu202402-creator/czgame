import { I18n } from '../i18n/I18n';
import { PlatformSDK } from '../platform/PlatformSDK';
import { DifficultyTier, GameMode } from '../types';
import {
  CoopNetMessage,
  LobbyMember,
  LobbyState,
  SQUAD_SLOTS,
} from './CoopProtocol';
import { MqttWsRoomBus, RoomWireEnvelope } from './MqttWsRoomBus';

const ROOM_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CALLSIGN_KEY = 'czgame_coop_callsign_v1';

type BusPayload =
  | CoopNetMessage
  | { type: '__hb' }
  | { type: '__bye' }
  | { type: '__ping'; t0: number }
  | { type: '__pong'; t0: number }
  | { type: '__rtc'; sdp?: RTCSessionDescriptionInit; cand?: RTCIceCandidateInit };

interface PeerRtcBundle {
  pc: RTCPeerConnection;
  dcFast: RTCDataChannel | null;
  dcRel: RTCDataChannel | null;
  pendingCands: RTCIceCandidateInit[];
  remoteDescSet: boolean;
}

const RTC_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.miwifi.com:3478' },
  { urls: 'stun:stun.qq.com:3478' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
];

function isFastUnreliableGameMsg(msg: CoopNetMessage): boolean {
  const t = msg.type;
  return (
    t === 'world_sync' ||
    t === 'players_fast' ||
    t === 'player_sync' ||
    t === 'cmd_fire' ||
    t === 'evt_fx' ||
    t === 'cmd_revive_tick'
  );
}

function randomCode(len = 5): string {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
  }
  return out;
}

class CoopNetworkManager {
  public role: 'offline' | 'host' | 'client' = 'offline';
  public status: 'idle' | 'connecting' | 'ready' | 'error' = 'idle';
  public errorMsg = '';
  public myPeerId = 'local';
  public mySlot = 0;
  public lobby: LobbyState | null = null;
  public lastJoinCode = '';
  public rttMs = 0;

  private bus: MqttWsRoomBus<BusPayload> | null = null;
  private rtcPeers = new Map<string, PeerRtcBundle>();
  private hostPeerId = '';
  private clientLastSeen = new Map<string, number>();
  private hostLastSeen = 0;
  private heartbeatTimer = 0;
  private joinRetryTimer = 0;
  private lastJoinReqSentAt = 0;
  private inMatchTriggered = false;

  private onLobbyChangeCb: (() => void) | null = null;
  private onMatchStartCb: ((stageId: string, mode: GameMode, lobby: LobbyState) => void) | null = null;
  private onNetStatsChangeCb: (() => void) | null = null;
  private onGameMessageCb: ((msg: CoopNetMessage, fromPeerId: string) => void) | null = null;
  private onPeerLeaveCb: ((peerId: string) => void) | null = null;
  private onPeerHotJoinCb: ((member: LobbyMember) => void) | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => {
        if (this.bus && this.role !== 'offline') {
          this.bus.send('*', { type: '__bye' });
        }
      });
      const onForegroundWake = () => {
        if (typeof document !== 'undefined' && document.hidden) return;
        if (!this.bus || this.role === 'offline') return;
        const now = performance.now();
        // 切回前台时给予心跳宽限期，防止手机切微信发链接归来瞬间误判超时踢人！
        this.hostLastSeen = now;
        for (const pid of Array.from(this.clientLastSeen.keys())) {
          this.clientLastSeen.set(pid, now);
        }
        this.bus.wakeAndCheckLinks();
        if (this.role === 'host' && this.lobby) {
          this.bus.send('*', { type: '__hb' });
          if (!this.lobby.inGame) {
            this.broadcastLobby();
          }
        } else if (this.role === 'client') {
          const missingSelf =
            !this.lobby || !this.lobby.members.some((m) => m.peerId === this.myPeerId);
          if (this.status === 'connecting' || (this.status === 'ready' && missingSelf && !this.lobby?.inGame)) {
            this.sendJoinRequestThrottled(true);
          } else if (this.status === 'ready') {
            this.bus.send(this.hostPeerId, { type: '__hb' });
          }
        }
      };
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', onForegroundWake);
      }
      window.addEventListener('focus', onForegroundWake);
    }
  }

  private sendJoinRequestThrottled(force = false): void {
    if (this.role !== 'client' || !this.bus || !this.hostPeerId) return;
    const now = performance.now();
    if (!force && now - this.lastJoinReqSentAt < 420) return;
    this.lastJoinReqSentAt = now;
    this.bus.send(this.hostPeerId, {
      type: 'join_req',
      callsign: this.getCallsign(),
    });
  }

  public getCallsign(): string {
    try {
      const saved = PlatformSDK.getStorageItem(CALLSIGN_KEY);
      if (saved && saved.trim()) return saved.trim().slice(0, 10);
      const gen = `${I18n.t('defaultCallsignPrefix')}-${Math.floor(10 + Math.random() * 89)}`;
      PlatformSDK.setStorageItem(CALLSIGN_KEY, gen);
      return gen;
    } catch {
      return 'Agent-01';
    }
  }

  public setCallsign(name: string): void {
    const clean = name.trim().slice(0, 10) || this.getCallsign();
    PlatformSDK.setStorageItem(CALLSIGN_KEY, clean);
    if (this.lobby) {
      const me = this.lobby.members.find((m) => m.peerId === this.myPeerId);
      if (me) {
        me.callsign = clean;
        if (this.role === 'host') {
          this.broadcastLobby();
        } else if (this.role === 'client') {
          this.sendToHost({ type: 'ready_toggle', ready: me.ready, callsign: clean });
        }
      }
      this.notifyLobby();
    }
  }

  public bindUI(
    onLobbyChange: () => void,
    onMatchStart: (stageId: string, mode: GameMode, lobby: LobbyState) => void,
    onNetStatsChange?: () => void
  ): void {
    this.onLobbyChangeCb = onLobbyChange;
    this.onMatchStartCb = onMatchStart;
    this.onNetStatsChangeCb = onNetStatsChange || null;
  }

  public bindEngine(
    onGameMessage: (msg: CoopNetMessage, fromPeerId: string) => void,
    onPeerLeave: (peerId: string) => void,
    onPeerHotJoin?: (member: LobbyMember) => void
  ): void {
    this.onGameMessageCb = onGameMessage;
    this.onPeerLeaveCb = onPeerLeave;
    this.onPeerHotJoinCb = onPeerHotJoin || null;
  }

  public isActiveCoop(): boolean {
    return (this.role === 'host' || this.role === 'client') && this.lobby !== null;
  }

  public getNetStatusLabel(): string {
    const p2p = this.hasDirectP2P();
    const modeTxt = p2p ? I18n.t('coopNetP2P') : I18n.t('coopNetRelay');
    if (this.rttMs > 0) {
      return `${modeTxt} · ${this.rttMs}ms`;
    }
    return modeTxt;
  }

  public getSquadCount(): number {
    if (!this.lobby || this.role === 'offline') return 1;
    return Math.max(1, Math.min(4, this.lobby.members.length));
  }

  public async getInviteUrl(): Promise<string> {
    if (!this.lobby) return window.location.href;
    return PlatformSDK.buildInviteLink(this.lobby.roomCode);
  }

  public consumeUrlRoomParam(): string | null {
    const code = PlatformSDK.consumeInviteRoomCode();
    if (code) {
      this.lastJoinCode = code;
    }
    return code;
  }

  public disconnect(): void {
    PlatformSDK.hideInviteButton();
    window.clearInterval(this.heartbeatTimer);
    window.clearInterval(this.joinRetryTimer);
    this.closeAllRtcPeers();
    if (this.bus) {
      if (this.role !== 'offline') {
        this.bus.send('*', { type: '__bye' });
      }
      this.bus.close();
      this.bus = null;
    }
    this.clientLastSeen.clear();
    this.hostPeerId = '';
    this.hostLastSeen = 0;
    this.rttMs = 0;
    this.inMatchTriggered = false;
    this.role = 'offline';
    this.status = 'idle';
    this.errorMsg = '';
    this.lobby = null;
    this.myPeerId = 'local';
    this.mySlot = 0;
    this.notifyLobby();
  }

  public createHostRoom(initialStageId = 'stage_police', initialMode: GameMode = 'standard'): void {
    this.disconnect();
    this.role = 'host';
    this.status = 'connecting';
    this.errorMsg = '';
    const code = randomCode(5);
    const hostId = `host_${code}`;
    this.myPeerId = hostId;
    this.hostPeerId = hostId;
    this.notifyLobby();

    this.bus = new MqttWsRoomBus<BusPayload>(
      hostId,
      code,
      () => {
        if (this.role !== 'host') return;
        this.mySlot = 0;
        this.status = 'ready';
        this.lobby = {
          roomCode: code,
          stageId: initialStageId,
          mode: initialMode,
          tier: 1,
          inGame: false,
          members: [
            {
              peerId: hostId,
              slot: 0,
              callsign: this.getCallsign(),
              color: SQUAD_SLOTS[0].color,
              ready: true,
              isHost: true,
            },
          ],
        };
        PlatformSDK.showInviteButton(code, true);
        this.startHeartbeatLoop();
        this.notifyLobby();
      },
      (env) => this.handleHostEnvelope(env),
      () => {
        if (this.role !== 'host') return;
        this.status = 'error';
        this.errorMsg = I18n.t('errSignal', { msg: 'Relay connection failed' });
        this.notifyLobby();
      },
      () => {
        if (this.role === 'host' && this.lobby) {
          this.broadcastLobby();
        }
      }
    );
  }

  private handleHostEnvelope(env: RoomWireEnvelope<BusPayload>): void {
    if (this.role !== 'host' || !this.lobby) return;
    const fromId = env.from;
    const msg = env.msg;
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === '__bye') {
      this.removeClientPeer(fromId);
      return;
    }

    if (this.clientLastSeen.has(fromId)) {
      this.clientLastSeen.set(fromId, performance.now());
    }
    if (msg.type === '__hb') return;
    if (msg.type === '__ping') {
      this.sendRawPingPong(fromId, { type: '__pong', t0: msg.t0 });
      return;
    }
    if (msg.type === '__pong') {
      const sample = Math.max(1, Math.round(performance.now() - msg.t0));
      if (sample < 5000) {
        this.rttMs = this.rttMs > 0 ? Math.round(this.rttMs * 0.6 + sample * 0.4) : sample;
        if (!this.lobby?.inGame) this.onNetStatsChangeCb?.();
      }
      return;
    }
    if (msg.type === '__rtc') {
      this.handleRtcSignal(fromId, msg);
      return;
    }

    if (msg.type === 'join_req') {
      // Idempotent re-ack if client already joined (e.g. duplicate retry packet)
      const existing = this.lobby.members.find((m) => m.peerId === fromId);
      if (existing) {
        this.clientLastSeen.set(fromId, performance.now());
        this.bus?.send(fromId, {
          type: 'join_ack',
          ok: true,
          assignedPeerId: fromId,
          slot: existing.slot,
          lobby: this.lobby,
        });
        this.ensureHostRtcOffer(fromId);
        return;
      }

      if (this.lobby.members.length >= 4) {
        this.bus?.send(fromId, {
          type: 'join_ack',
          ok: false,
          reason: I18n.t('errRoomFull'),
        });
        return;
      }

      const usedSlots = new Set(this.lobby.members.map((m) => m.slot));
      let slot = 1;
      while (usedSlots.has(slot) && slot < 4) slot++;

      const member: LobbyMember = {
        peerId: fromId,
        slot,
        callsign: (msg.callsign || `P${slot + 1}`).slice(0, 10),
        color: SQUAD_SLOTS[slot]?.color || '#4ade80',
        ready: true,
        isHost: false,
      };
      this.clientLastSeen.set(fromId, performance.now());
      this.lobby.members.push(member);
      this.lobby.members.sort((a, b) => a.slot - b.slot);

      this.bus?.send(fromId, {
        type: 'join_ack',
        ok: true,
        assignedPeerId: fromId,
        slot,
        lobby: this.lobby,
      });
      this.ensureHostRtcOffer(fromId);
      if (this.lobby.inGame) {
        this.onPeerHotJoinCb?.(member);
      }
      this.broadcastLobby();
      this.notifyLobby();
      return;
    }

    if (msg.type === 'ready_toggle') {
      const mem = this.lobby.members.find((m) => m.peerId === fromId);
      if (mem) {
        mem.ready = msg.ready;
        if (msg.callsign) mem.callsign = msg.callsign.slice(0, 10);
        this.broadcastLobby();
        this.notifyLobby();
      }
      return;
    }

    if (this.clientLastSeen.has(fromId)) {
      this.onGameMessageCb?.(msg, fromId);
    }
  }

  private removeClientPeer(peerId: string): void {
    const existed = this.clientLastSeen.delete(peerId);
    this.closeRtcPeer(peerId);
    this.bus?.forgetPeer(peerId);
    if (this.lobby) {
      const before = this.lobby.members.length;
      this.lobby.members = this.lobby.members.filter((m) => m.peerId !== peerId);
      if (this.lobby.members.length !== before) {
        this.broadcastLobby();
        this.notifyLobby();
      }
    }
    if (existed) {
      this.onPeerLeaveCb?.(peerId);
    }
  }

  public joinRoomByCode(rawCode: string): void {
    const code = rawCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length < 4) {
      this.status = 'error';
      this.errorMsg = I18n.t('errInvalidCode');
      this.notifyLobby();
      return;
    }

    this.lastJoinCode = code;
    this.disconnect();
    this.role = 'client';
    this.status = 'connecting';
    this.errorMsg = '';
    const clientId = `p_${randomCode(6).toLowerCase()}`;
    this.myPeerId = clientId;
    this.hostPeerId = `host_${code}`;
    this.notifyLobby();

    const sendJoinReq = () => {
      if (this.role !== 'client' || this.status !== 'connecting') return;
      this.sendJoinRequestThrottled(true);
    };

    this.bus = new MqttWsRoomBus<BusPayload>(
      clientId,
      code,
      () => {
        if (this.role !== 'client') return;
        let attempts = 0;
        sendJoinReq();
        window.clearInterval(this.joinRetryTimer);
        this.joinRetryTimer = window.setInterval(() => {
          if (this.role !== 'client' || this.status !== 'connecting') {
            window.clearInterval(this.joinRetryTimer);
            return;
          }
          attempts++;
          // 留足约 16.5s 寻房窗口，兼容房主刚切去微信发链接尚未切回浏览器的等待期
          if (attempts >= 22) {
            window.clearInterval(this.joinRetryTimer);
            this.status = 'error';
            this.errorMsg = I18n.t('errRoomNotFound', { code });
            this.notifyLobby();
            return;
          }
          sendJoinReq();
        }, 750);
      },
      (env) => this.handleClientEnvelope(env),
      () => {
        if (this.role !== 'client') return;
        window.clearInterval(this.joinRetryTimer);
        this.status = 'error';
        this.errorMsg = I18n.t('errSignal', { msg: 'Relay connection failed' });
        this.notifyLobby();
      },
      () => {
        const missingSelf =
          !this.lobby || !this.lobby.members.some((m) => m.peerId === this.myPeerId);
        if (this.status === 'connecting' || (this.status === 'ready' && missingSelf && !this.lobby?.inGame)) {
          this.sendJoinRequestThrottled(true);
        }
      }
    );
  }

  private handleClientEnvelope(env: RoomWireEnvelope<BusPayload>): void {
    if (this.role !== 'client') return;
    if (env.from !== this.hostPeerId) return;
    const msg = env.msg;
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === '__bye') {
      window.clearInterval(this.joinRetryTimer);
      window.clearInterval(this.heartbeatTimer);
      this.status = 'error';
      this.errorMsg = I18n.t('errHostLeft');
      this.onPeerLeaveCb?.('host');
      this.notifyLobby();
      return;
    }

    this.hostLastSeen = performance.now();
    if (msg.type === '__hb') {
      const missingSelf =
        !this.lobby || !this.lobby.members.some((m) => m.peerId === this.myPeerId);
      if (this.status === 'connecting' || (this.status === 'ready' && missingSelf)) {
        this.sendJoinRequestThrottled(false);
      }
      return;
    }
    if (msg.type === '__ping') {
      this.sendRawPingPong(this.hostPeerId, { type: '__pong', t0: msg.t0 });
      return;
    }
    if (msg.type === '__pong') {
      const sample = Math.max(1, Math.round(performance.now() - msg.t0));
      if (sample < 5000) {
        this.rttMs = this.rttMs > 0 ? Math.round(this.rttMs * 0.6 + sample * 0.4) : sample;
        if (!this.lobby?.inGame) this.onNetStatsChangeCb?.();
      }
      return;
    }
    if (msg.type === '__rtc') {
      this.handleRtcSignal(this.hostPeerId, msg);
      return;
    }

    if (msg.type === 'join_ack') {
      window.clearInterval(this.joinRetryTimer);
      if (!msg.ok || !msg.lobby) {
        this.status = 'error';
        this.errorMsg = msg.reason || 'Failed to join';
        this.notifyLobby();
        return;
      }
      this.status = 'ready';
      this.mySlot = msg.slot ?? 1;
      this.lobby = msg.lobby;
      this.startHeartbeatLoop();
      if (this.lobby.inGame && !this.inMatchTriggered) {
        // 支持开局后中途空降参战 & 掉线刷新秒重连回战场！
        this.inMatchTriggered = true;
        PlatformSDK.hideInviteButton(this.lobby.roomCode);
        this.onMatchStartCb?.(this.lobby.stageId, this.lobby.mode, this.lobby);
        return;
      }
      PlatformSDK.showInviteButton(this.lobby.roomCode, !this.lobby.inGame && this.lobby.members.length < 4);
      this.notifyLobby();
      return;
    }

    if (msg.type === 'lobby_state') {
      const me = msg.lobby.members.find((m) => m.peerId === this.myPeerId);
      if (me) {
        // 哪怕单播 join_ack 丢包，只要广播 lobby_state 里已有自己，立刻确认入座成功！
        window.clearInterval(this.joinRetryTimer);
        const wasConnecting = this.status !== 'ready';
        this.status = 'ready';
        this.mySlot = me.slot;
        this.lobby = msg.lobby;
        if (wasConnecting) {
          this.startHeartbeatLoop();
        }
        if (this.lobby.inGame && !this.inMatchTriggered) {
          this.inMatchTriggered = true;
          PlatformSDK.hideInviteButton(this.lobby.roomCode);
          this.onMatchStartCb?.(this.lobby.stageId, this.lobby.mode, this.lobby);
          return;
        }
        PlatformSDK.showInviteButton(this.lobby.roomCode, !this.lobby.inGame && this.lobby.members.length < 4);
        this.notifyLobby();
      } else if (msg.lobby.inGame && msg.lobby.members.length >= 4) {
        window.clearInterval(this.joinRetryTimer);
        this.lobby = null;
        this.status = 'error';
        this.errorMsg = I18n.t('errRoomFull');
        this.notifyLobby();
      } else {
        // 无论在大厅还是局内未满 4 人，收到不含自己的 lobby_state 立即自动请求入座/中途空降！
        if (this.status === 'ready') {
          this.lobby = null;
          this.status = 'connecting';
          this.inMatchTriggered = false;
          this.notifyLobby();
          this.sendJoinRequestThrottled(true);
        } else {
          this.sendJoinRequestThrottled(false);
        }
      }
      return;
    }

    if (msg.type === 'start_game') {
      if (!msg.lobby.members.some((m) => m.peerId === this.myPeerId)) {
        return;
      }
      if (this.inMatchTriggered) return;
      this.lobby = msg.lobby;
      this.lobby.inGame = true;
      this.inMatchTriggered = true;
      PlatformSDK.hideInviteButton(this.lobby.roomCode);
      this.onMatchStartCb?.(msg.stageId, msg.mode, msg.lobby);
      return;
    }

    if (
      this.status === 'ready' &&
      this.lobby &&
      !this.inMatchTriggered &&
      (msg.type === 'world_sync' || msg.type === 'players_fast')
    ) {
      this.lobby.inGame = true;
      this.inMatchTriggered = true;
      PlatformSDK.hideInviteButton(this.lobby.roomCode);
      this.onMatchStartCb?.(this.lobby.stageId, this.lobby.mode, this.lobby);
    }

    this.onGameMessageCb?.(msg, this.hostPeerId);
  }

  private startHeartbeatLoop(): void {
    window.clearInterval(this.heartbeatTimer);
    this.hostLastSeen = performance.now();
    this.heartbeatTimer = window.setInterval(() => {
      if (!this.bus || this.role === 'offline') return;
      const now = performance.now();
      // 大厅等待好友阶段给足 45s 切后台发微信宽限期；局内战斗保持 16s 掉线清理
      const peerTimeoutMs = this.lobby?.inGame ? 16_000 : 45_000;

      if (this.role === 'host') {
        this.bus.send('*', { type: '__hb' });
        const firstClient = this.clientLastSeen.keys().next().value as string | undefined;
        if (firstClient) {
          this.sendRawPingPong(firstClient, { type: '__ping', t0: Math.round(now) });
        }
        for (const [pid, seenAt] of Array.from(this.clientLastSeen.entries())) {
          if (now - seenAt > peerTimeoutMs) {
            this.removeClientPeer(pid);
          }
        }
      } else if (this.role === 'client' && this.status === 'ready') {
        this.bus.send(this.hostPeerId, { type: '__hb' });
        this.sendRawPingPong(this.hostPeerId, { type: '__ping', t0: Math.round(now) });
        if (this.hostLastSeen > 0 && now - this.hostLastSeen > peerTimeoutMs + 2000) {
          window.clearInterval(this.heartbeatTimer);
          this.status = 'error';
          this.errorMsg = I18n.t('errHostLeft');
          this.onPeerLeaveCb?.('host');
          this.notifyLobby();
        }
      } else if (this.role === 'client' && this.status === 'connecting') {
        this.sendJoinRequestThrottled(false);
      }
    }, 2400);
  }

  public setHostStageAndMode(stageId: string, mode: GameMode, tier?: DifficultyTier): void {
    if (this.role !== 'host' || !this.lobby) return;
    this.lobby.stageId = stageId;
    this.lobby.mode = mode;
    if (tier !== undefined) {
      this.lobby.tier = tier;
    }
    this.broadcastLobby();
    this.notifyLobby();
  }

  public toggleClientReady(): void {
    if (this.role !== 'client' || !this.lobby) return;
    const me = this.lobby.members.find((m) => m.peerId === this.myPeerId);
    if (!me) return;
    me.ready = !me.ready;
    this.sendToHost({ type: 'ready_toggle', ready: me.ready, callsign: me.callsign });
    this.notifyLobby();
  }

  public launchHostMatch(): void {
    if (this.role !== 'host' || !this.lobby) return;
    this.lobby.inGame = true;
    PlatformSDK.hideInviteButton(this.lobby.roomCode);
    const sendStartBurst = () => {
      if (this.role !== 'host' || !this.lobby || !this.lobby.inGame) return;
      const pkt: CoopNetMessage = {
        type: 'start_game',
        stageId: this.lobby.stageId,
        mode: this.lobby.mode,
        lobby: this.lobby,
      };
      this.bus?.send('*', pkt);
      const rtcWire = JSON.stringify({ f: this.myPeerId, m: pkt });
      for (const b of this.rtcPeers.values()) {
        if (b.dcRel && b.dcRel.readyState === 'open') {
          try {
            b.dcRel.send(rtcWire);
          } catch {
            // ignore
          }
        }
      }
    };
    sendStartBurst();
    window.setTimeout(sendStartBurst, 350);
    window.setTimeout(sendStartBurst, 900);
    this.onMatchStartCb?.(this.lobby.stageId, this.lobby.mode, this.lobby);
  }

  public returnSquadToLobby(): void {
    if (!this.lobby) return;
    this.lobby.inGame = false;
    this.inMatchTriggered = false;
    PlatformSDK.showInviteButton(this.lobby.roomCode, this.lobby.members.length < 4);
    if (this.role === 'host') {
      this.broadcastLobby();
    }
    this.notifyLobby();
  }

  private sendRawPingPong(
    peerId: string,
    pkt: { type: '__ping'; t0: number } | { type: '__pong'; t0: number }
  ): void {
    const b = this.rtcPeers.get(peerId);
    if (b?.dcFast && b.dcFast.readyState === 'open' && b.dcFast.bufferedAmount <= 24_576) {
      try {
        b.dcFast.send(JSON.stringify({ f: this.myPeerId, m: pkt }));
        return;
      } catch {
        // fallback to MQTT
      }
    }
    this.bus?.send(peerId, pkt);
  }

  // ==================== WebRTC 原生 UDP DataChannel 直连加速层（自动穿透 + 无感回退 MQTT） ====================

  private closeRtcPeer(peerId: string): void {
    const b = this.rtcPeers.get(peerId);
    if (!b) return;
    this.rtcPeers.delete(peerId);
    try {
      b.dcFast?.close();
    } catch {
      // ignore
    }
    try {
      b.dcRel?.close();
    } catch {
      // ignore
    }
    try {
      b.pc.close();
    } catch {
      // ignore
    }
  }

  private closeAllRtcPeers(): void {
    for (const pid of Array.from(this.rtcPeers.keys())) {
      this.closeRtcPeer(pid);
    }
  }

  private bindRtcChannel(peerId: string, bundle: PeerRtcBundle, dc: RTCDataChannel): void {
    if (dc.label === 'fast') {
      bundle.dcFast = dc;
      dc.onopen = () => {
        this.sendRawPingPong(peerId, { type: '__ping', t0: Math.round(performance.now()) });
        if (!this.lobby?.inGame) this.onNetStatsChangeCb?.();
      };
    } else {
      bundle.dcRel = dc;
    }
    dc.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      try {
        const parsed = JSON.parse(ev.data) as {
          f: string;
          m: CoopNetMessage | { type: '__ping'; t0: number } | { type: '__pong'; t0: number };
        };
        if (!parsed || !parsed.m) return;
        const now = performance.now();
        if (parsed.m.type === '__ping') {
          this.sendRawPingPong(peerId, { type: '__pong', t0: parsed.m.t0 });
          return;
        }
        if (parsed.m.type === '__pong') {
          const sample = Math.max(1, Math.round(now - parsed.m.t0));
          if (sample < 5000) {
            this.rttMs =
              this.rttMs > 0 && this.rttMs < sample * 2.5
                ? Math.round(this.rttMs * 0.55 + sample * 0.45)
                : sample;
            if (!this.lobby?.inGame) this.onNetStatsChangeCb?.();
          }
          return;
        }
        if (this.role === 'host') {
          if (this.clientLastSeen.has(peerId)) {
            this.clientLastSeen.set(peerId, now);
            this.onGameMessageCb?.(parsed.m, peerId);
          }
        } else if (this.role === 'client') {
          this.hostLastSeen = now;
          if (parsed.m.type === 'start_game') {
            if (!parsed.m.lobby.members.some((m) => m.peerId === this.myPeerId)) return;
            if (this.inMatchTriggered) return;
            this.lobby = parsed.m.lobby;
            this.lobby.inGame = true;
            this.inMatchTriggered = true;
            PlatformSDK.hideInviteButton(this.lobby.roomCode);
            this.onMatchStartCb?.(parsed.m.stageId, parsed.m.mode, parsed.m.lobby);
            return;
          }
          if (
            this.status === 'ready' &&
            this.lobby &&
            !this.inMatchTriggered &&
            (parsed.m.type === 'world_sync' || parsed.m.type === 'players_fast')
          ) {
            this.lobby.inGame = true;
            this.inMatchTriggered = true;
            PlatformSDK.hideInviteButton(this.lobby.roomCode);
            this.onMatchStartCb?.(this.lobby.stageId, this.lobby.mode, this.lobby);
          }
          this.onGameMessageCb?.(parsed.m, this.hostPeerId);
        }
      } catch {
        // ignore malformed frame
      }
    };
  }

  private createRtcPeerBundle(peerId: string): PeerRtcBundle | null {
    if (typeof RTCPeerConnection === 'undefined') return null;
    this.closeRtcPeer(peerId);
    try {
      const pc = new RTCPeerConnection({ iceServers: RTC_ICE_SERVERS });
      const bundle: PeerRtcBundle = {
        pc,
        dcFast: null,
        dcRel: null,
        pendingCands: [],
        remoteDescSet: false,
      };
      this.rtcPeers.set(peerId, bundle);

      pc.onicecandidate = (ev) => {
        if (ev.candidate && this.bus) {
          this.bus.send(peerId, { type: '__rtc', cand: ev.candidate.toJSON() });
        }
      };
      pc.ondatachannel = (ev) => {
        this.bindRtcChannel(peerId, bundle, ev.channel);
      };
      return bundle;
    } catch {
      return null;
    }
  }

  private ensureHostRtcOffer(clientPeerId: string): void {
    if (this.role !== 'host' || typeof RTCPeerConnection === 'undefined') return;
    const cur = this.rtcPeers.get(clientPeerId);
    if (
      cur &&
      cur.pc.connectionState !== 'failed' &&
      cur.pc.connectionState !== 'closed' &&
      cur.pc.iceConnectionState !== 'failed' &&
      cur.pc.iceConnectionState !== 'disconnected'
    ) {
      return;
    }
    const bundle = this.createRtcPeerBundle(clientPeerId);
    if (!bundle) return;
    try {
      // fast 通道开启无序零重传 UDP 模式，彻底消除 Wi-Fi / 4G 偶发丢包引起的 TCP 队头阻塞卡顿！
      const dcFast = bundle.pc.createDataChannel('fast', { ordered: false, maxRetransmits: 0 });
      const dcRel = bundle.pc.createDataChannel('rel', { ordered: true });
      this.bindRtcChannel(clientPeerId, bundle, dcFast);
      this.bindRtcChannel(clientPeerId, bundle, dcRel);

      bundle.pc
        .createOffer()
        .then((offer) => bundle.pc.setLocalDescription(offer).then(() => offer))
        .then((offer) => {
          if (this.rtcPeers.get(clientPeerId) === bundle && this.bus) {
            this.bus.send(clientPeerId, { type: '__rtc', sdp: { type: offer.type, sdp: offer.sdp } });
          }
        })
        .catch(() => {
          // fallback seamlessly to MQTT
        });
    } catch {
      // fallback seamlessly to MQTT
    }
  }

  private handleRtcSignal(
    fromPeerId: string,
    sig: { type: '__rtc'; sdp?: RTCSessionDescriptionInit; cand?: RTCIceCandidateInit }
  ): void {
    if (typeof RTCPeerConnection === 'undefined') return;
    let bundle = this.rtcPeers.get(fromPeerId);

    if (sig.sdp) {
      if (sig.sdp.type === 'offer' && this.role === 'client') {
        bundle = this.createRtcPeerBundle(fromPeerId) || undefined;
        if (!bundle) return;
        const bRef = bundle;
        bRef.pc
          .setRemoteDescription(sig.sdp)
          .then(async () => {
            bRef.remoteDescSet = true;
            for (const c of bRef.pendingCands.splice(0)) {
              if (!c || !c.candidate) continue;
              try {
                await bRef.pc.addIceCandidate(c);
              } catch {
                // ignore
              }
            }
            const ans = await bRef.pc.createAnswer();
            await bRef.pc.setLocalDescription(ans);
            if (this.rtcPeers.get(fromPeerId) === bRef && this.bus) {
              this.bus.send(fromPeerId, { type: '__rtc', sdp: { type: ans.type, sdp: ans.sdp } });
            }
          })
          .catch(() => {
            // fallback to MQTT
          });
      } else if (sig.sdp.type === 'answer' && this.role === 'host' && bundle) {
        const bRef = bundle;
        bRef.pc
          .setRemoteDescription(sig.sdp)
          .then(async () => {
            bRef.remoteDescSet = true;
            for (const c of bRef.pendingCands.splice(0)) {
              if (!c || !c.candidate) continue;
              try {
                await bRef.pc.addIceCandidate(c);
              } catch {
                // ignore
              }
            }
          })
          .catch(() => {
            // fallback to MQTT
          });
      }
      return;
    }

    if (sig.cand && sig.cand.candidate && bundle) {
      if (bundle.remoteDescSet) {
        bundle.pc.addIceCandidate(sig.cand).catch(() => {});
      } else {
        bundle.pendingCands.push(sig.cand);
      }
    }
  }

  private trySendOverRtc(peerId: string, msg: CoopNetMessage, preSerialized?: string): boolean {
    // 房间大厅与开局控制信令始终走 4 节点冗余信令总线确保万无一失
    if (
      msg.type === 'lobby_state' ||
      msg.type === 'start_game' ||
      msg.type === 'ready_toggle' ||
      msg.type === 'join_req' ||
      msg.type === 'join_ack'
    ) {
      return false;
    }
    const b = this.rtcPeers.get(peerId);
    if (!b) return false;
    const fast = isFastUnreliableGameMsg(msg);
    const ch = fast ? b.dcFast : b.dcRel;
    if (!ch || ch.readyState !== 'open' || ch.bufferedAmount > 32_768) return false;
    try {
      ch.send(preSerialized || JSON.stringify({ f: this.myPeerId, m: msg }));
      return true;
    } catch {
      return false;
    }
  }

  public hasDirectP2P(): boolean {
    if (this.role === 'client') {
      const b = this.rtcPeers.get(this.hostPeerId);
      return Boolean(b?.dcFast && b.dcFast.readyState === 'open');
    }
    if (this.role === 'host' && this.clientLastSeen.size > 0) {
      for (const pid of this.clientLastSeen.keys()) {
        const b = this.rtcPeers.get(pid);
        if (!b?.dcFast || b.dcFast.readyState !== 'open') return false;
      }
      return true;
    }
    return false;
  }

  public broadcastLobby(): void {
    if (this.role !== 'host' || !this.lobby) return;
    PlatformSDK.showInviteButton(
      this.lobby.roomCode,
      !this.lobby.inGame && this.lobby.members.length < 4
    );
    this.bus?.send('*', { type: 'lobby_state', lobby: this.lobby });
  }

  public broadcastToClients(msg: CoopNetMessage, excludePeerId?: string): void {
    if (this.role !== 'host' || !this.bus) return;
    if (excludePeerId && this.clientLastSeen.size <= 1 && this.clientLastSeen.has(excludePeerId)) {
      return;
    }
    if (msg.type === 'lobby_state' || msg.type === 'start_game') {
      this.bus.send('*', msg, excludePeerId);
      return;
    }

    let serializedRtc = '';
    const fallbackPeers: string[] = [];
    for (const pid of this.clientLastSeen.keys()) {
      if (excludePeerId && pid === excludePeerId) continue;
      if (!serializedRtc) {
        serializedRtc = JSON.stringify({ f: this.myPeerId, m: msg });
      }
      if (!this.trySendOverRtc(pid, msg, serializedRtc)) {
        fallbackPeers.push(pid);
      }
    }

    if (fallbackPeers.length > 0) {
      if (fallbackPeers.length === 1) {
        this.bus.send(fallbackPeers[0], msg);
      } else {
        this.bus.send('*', msg, excludePeerId);
      }
    }
  }

  public sendToClient(peerId: string, msg: CoopNetMessage): void {
    if (this.role !== 'host' || !this.bus) return;
    if (!this.trySendOverRtc(peerId, msg)) {
      this.bus.send(peerId, msg);
    }
  }

  public sendToHost(msg: CoopNetMessage): void {
    if (this.role !== 'client' || !this.bus || !this.hostPeerId) return;
    if (!this.trySendOverRtc(this.hostPeerId, msg)) {
      this.bus.send(this.hostPeerId, msg);
    }
  }

  public isCongested(): boolean {
    if (this.hasDirectP2P()) {
      for (const b of this.rtcPeers.values()) {
        if (b.dcFast && b.dcFast.readyState === 'open' && b.dcFast.bufferedAmount > 32_768) {
          return true;
        }
      }
      return false;
    }
    return this.bus ? this.bus.isCongested() : false;
  }

  private notifyLobby(): void {
    this.onLobbyChangeCb?.();
  }
}

export const CoopManager = new CoopNetworkManager();
