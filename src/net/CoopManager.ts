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
  | { type: '__bye' };

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

  private bus: MqttWsRoomBus<BusPayload> | null = null;
  private hostPeerId = '';
  private clientLastSeen = new Map<string, number>();
  private hostLastSeen = 0;
  private heartbeatTimer = 0;
  private joinRetryTimer = 0;

  private onLobbyChangeCb: (() => void) | null = null;
  private onMatchStartCb: ((stageId: string, mode: GameMode, lobby: LobbyState) => void) | null = null;
  private onGameMessageCb: ((msg: CoopNetMessage, fromPeerId: string) => void) | null = null;
  private onPeerLeaveCb: ((peerId: string) => void) | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => {
        if (this.bus && this.role !== 'offline') {
          this.bus.send('*', { type: '__bye' });
        }
      });
    }
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
    onMatchStart: (stageId: string, mode: GameMode, lobby: LobbyState) => void
  ): void {
    this.onLobbyChangeCb = onLobbyChange;
    this.onMatchStartCb = onMatchStart;
  }

  public bindEngine(
    onGameMessage: (msg: CoopNetMessage, fromPeerId: string) => void,
    onPeerLeave: (peerId: string) => void
  ): void {
    this.onGameMessageCb = onGameMessage;
    this.onPeerLeaveCb = onPeerLeave;
  }

  public isActiveCoop(): boolean {
    return (
      (this.role === 'host' || this.role === 'client') &&
      this.lobby !== null &&
      this.lobby.members.length >= 2
    );
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
        return;
      }

      if (this.lobby.inGame) {
        this.bus?.send(fromId, {
          type: 'join_ack',
          ok: false,
          reason: I18n.t('errRoomInGame'),
        });
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
      this.bus?.send(this.hostPeerId, {
        type: 'join_req',
        callsign: this.getCallsign(),
      });
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
          if (attempts >= 9) {
            window.clearInterval(this.joinRetryTimer);
            this.status = 'error';
            this.errorMsg = I18n.t('errRoomNotFound', { code });
            this.notifyLobby();
            return;
          }
          sendJoinReq();
        }, 800);
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
        sendJoinReq();
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
    if (msg.type === '__hb') return;

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
      PlatformSDK.showInviteButton(this.lobby.roomCode, !this.lobby.inGame && this.lobby.members.length < 4);
      this.startHeartbeatLoop();
      this.notifyLobby();
      return;
    }

    if (msg.type === 'lobby_state') {
      this.lobby = msg.lobby;
      const me = this.lobby.members.find((m) => m.peerId === this.myPeerId);
      if (me) this.mySlot = me.slot;
      this.notifyLobby();
      return;
    }

    if (msg.type === 'start_game') {
      this.lobby = msg.lobby;
      this.lobby.inGame = true;
      PlatformSDK.hideInviteButton(this.lobby.roomCode);
      this.onMatchStartCb?.(msg.stageId, msg.mode, msg.lobby);
      return;
    }

    this.onGameMessageCb?.(msg, this.hostPeerId);
  }

  private startHeartbeatLoop(): void {
    window.clearInterval(this.heartbeatTimer);
    this.hostLastSeen = performance.now();
    this.heartbeatTimer = window.setInterval(() => {
      if (!this.bus || this.role === 'offline') return;
      const now = performance.now();

      if (this.role === 'host') {
        this.bus.send('*', { type: '__hb' });
        for (const [pid, seenAt] of Array.from(this.clientLastSeen.entries())) {
          if (now - seenAt > 11_500) {
            this.removeClientPeer(pid);
          }
        }
      } else if (this.role === 'client' && this.status === 'ready') {
        this.bus.send(this.hostPeerId, { type: '__hb' });
        if (this.hostLastSeen > 0 && now - this.hostLastSeen > 12_500) {
          window.clearInterval(this.heartbeatTimer);
          this.status = 'error';
          this.errorMsg = I18n.t('errHostLeft');
          this.onPeerLeaveCb?.('host');
          this.notifyLobby();
        }
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
    const pkt: CoopNetMessage = {
      type: 'start_game',
      stageId: this.lobby.stageId,
      mode: this.lobby.mode,
      lobby: this.lobby,
    };
    this.broadcastToClients(pkt);
    this.onMatchStartCb?.(this.lobby.stageId, this.lobby.mode, this.lobby);
  }

  public returnSquadToLobby(): void {
    if (!this.lobby) return;
    this.lobby.inGame = false;
    PlatformSDK.showInviteButton(this.lobby.roomCode, this.lobby.members.length < 4);
    if (this.role === 'host') {
      this.broadcastLobby();
    }
    this.notifyLobby();
  }

  public broadcastLobby(): void {
    if (this.role !== 'host' || !this.lobby) return;
    PlatformSDK.showInviteButton(
      this.lobby.roomCode,
      !this.lobby.inGame && this.lobby.members.length < 4
    );
    this.broadcastToClients({ type: 'lobby_state', lobby: this.lobby });
  }

  public broadcastToClients(msg: CoopNetMessage, excludePeerId?: string): void {
    if (this.role !== 'host' || !this.bus) return;
    if (excludePeerId && this.clientLastSeen.size <= 1 && this.clientLastSeen.has(excludePeerId)) {
      return;
    }
    this.bus.send('*', msg, excludePeerId);
  }

  public sendToClient(peerId: string, msg: CoopNetMessage): void {
    if (this.role !== 'host' || !this.bus) return;
    this.bus.send(peerId, msg);
  }

  public sendToHost(msg: CoopNetMessage): void {
    if (this.role !== 'client' || !this.bus || !this.hostPeerId) return;
    this.bus.send(this.hostPeerId, msg);
  }

  public isCongested(): boolean {
    return this.bus ? this.bus.isCongested() : false;
  }

  private notifyLobby(): void {
    this.onLobbyChangeCb?.();
  }
}

export const CoopManager = new CoopNetworkManager();
