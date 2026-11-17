import Peer, { DataConnection } from 'peerjs';
import { I18n } from '../i18n/I18n';
import { PlatformSDK } from '../platform/PlatformSDK';
import { GameMode } from '../types';
import {
  CoopNetMessage,
  LobbyMember,
  LobbyState,
  SQUAD_SLOTS,
} from './CoopProtocol';

const ROOM_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const PEER_PREFIX = 'czgame-coop-v1-';
const CALLSIGN_KEY = 'czgame_coop_callsign_v1';

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
];

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

  private peer: Peer | null = null;
  private hostConn: DataConnection | null = null;
  private clientConns = new Map<string, DataConnection>();

  private onLobbyChangeCb: (() => void) | null = null;
  private onMatchStartCb: ((stageId: string, mode: GameMode, lobby: LobbyState) => void) | null = null;
  private onGameMessageCb: ((msg: CoopNetMessage, fromPeerId: string) => void) | null = null;
  private onPeerLeaveCb: ((peerId: string) => void) | null = null;

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
    return PlatformSDK.consumeInviteRoomCode();
  }

  public disconnect(): void {
    PlatformSDK.hideInviteButton();
    this.clientConns.forEach((c) => {
      try {
        c.close();
      } catch {
        // ignore
      }
    });
    this.clientConns.clear();
    if (this.hostConn) {
      try {
        this.hostConn.close();
      } catch {
        // ignore
      }
      this.hostConn = null;
    }
    if (this.peer) {
      try {
        this.peer.destroy();
      } catch {
        // ignore
      }
      this.peer = null;
    }
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
    const peerId = `${PEER_PREFIX}${code}`;
    this.notifyLobby();

    const peer = new Peer(peerId, {
      config: { iceServers: ICE_SERVERS },
    });
    this.peer = peer;

    peer.on('open', (id) => {
      this.myPeerId = id;
      this.mySlot = 0;
      this.status = 'ready';
      this.lobby = {
        roomCode: code,
        stageId: initialStageId,
        mode: initialMode,
        inGame: false,
        members: [
          {
            peerId: id,
            slot: 0,
            callsign: this.getCallsign(),
            color: SQUAD_SLOTS[0].color,
            ready: true,
            isHost: true,
          },
        ],
      };
      PlatformSDK.showInviteButton(code);
      this.notifyLobby();
    });

    peer.on('connection', (conn) => {
      this.setupHostIncomingConn(conn);
    });

    peer.on('error', (err: Error & { type?: string }) => {
      if (err.type === 'unavailable-id') {
        this.createHostRoom(initialStageId, initialMode);
        return;
      }
      this.status = 'error';
      this.errorMsg = I18n.t('errSignal', { msg: err.message || err.type || 'Network error' });
      this.notifyLobby();
    });
  }

  private setupHostIncomingConn(conn: DataConnection): void {
    conn.on('data', (raw) => {
      const msg = raw as CoopNetMessage;
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'join_req') {
        if (!this.lobby) return;
        if (this.lobby.inGame) {
          conn.send({ type: 'join_ack', ok: false, reason: I18n.t('errRoomInGame') } satisfies CoopNetMessage);
          setTimeout(() => conn.close(), 250);
          return;
        }
        if (this.lobby.members.length >= 4) {
          conn.send({ type: 'join_ack', ok: false, reason: I18n.t('errRoomFull') } satisfies CoopNetMessage);
          setTimeout(() => conn.close(), 250);
          return;
        }

        const usedSlots = new Set(this.lobby.members.map((m) => m.slot));
        let slot = 1;
        while (usedSlots.has(slot) && slot < 4) slot++;

        const member: LobbyMember = {
          peerId: conn.peer,
          slot,
          callsign: (msg.callsign || `P${slot + 1}`).slice(0, 10),
          color: SQUAD_SLOTS[slot]?.color || '#4ade80',
          ready: true,
          isHost: false,
        };
        this.clientConns.set(conn.peer, conn);
        this.lobby.members.push(member);
        this.lobby.members.sort((a, b) => a.slot - b.slot);

        conn.send({
          type: 'join_ack',
          ok: true,
          assignedPeerId: conn.peer,
          slot,
          lobby: this.lobby,
        } satisfies CoopNetMessage);
        this.broadcastLobby();
        this.notifyLobby();
        return;
      }

      if (msg.type === 'ready_toggle' && this.lobby) {
        const mem = this.lobby.members.find((m) => m.peerId === conn.peer);
        if (mem) {
          mem.ready = msg.ready;
          if (msg.callsign) mem.callsign = msg.callsign.slice(0, 10);
          this.broadcastLobby();
          this.notifyLobby();
        }
        return;
      }

      this.onGameMessageCb?.(msg, conn.peer);
    });

    const handleLeave = () => {
      const existed = this.clientConns.delete(conn.peer);
      if (this.lobby) {
        const before = this.lobby.members.length;
        this.lobby.members = this.lobby.members.filter((m) => m.peerId !== conn.peer);
        if (this.lobby.members.length !== before) {
          this.broadcastLobby();
          this.notifyLobby();
        }
      }
      if (existed) {
        this.onPeerLeaveCb?.(conn.peer);
      }
    };

    conn.on('close', handleLeave);
    conn.on('error', handleLeave);
  }

  public joinRoomByCode(rawCode: string): void {
    const code = rawCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length < 4) {
      this.status = 'error';
      this.errorMsg = I18n.t('errInvalidCode');
      this.notifyLobby();
      return;
    }

    this.disconnect();
    this.role = 'client';
    this.status = 'connecting';
    this.errorMsg = '';
    this.notifyLobby();

    const peer = new Peer({
      config: { iceServers: ICE_SERVERS },
    });
    this.peer = peer;

    peer.on('open', (myId) => {
      this.myPeerId = myId;
      const hostPeerId = `${PEER_PREFIX}${code}`;
      const conn = peer.connect(hostPeerId, { reliable: true });
      this.hostConn = conn;

      conn.on('open', () => {
        conn.send({
          type: 'join_req',
          callsign: this.getCallsign(),
        } satisfies CoopNetMessage);
      });

      conn.on('data', (raw) => {
        const msg = raw as CoopNetMessage;
        if (!msg || typeof msg !== 'object') return;

        if (msg.type === 'join_ack') {
          if (!msg.ok || !msg.lobby) {
            this.status = 'error';
            this.errorMsg = msg.reason || 'Failed to join';
            this.notifyLobby();
            return;
          }
          this.status = 'ready';
          this.mySlot = msg.slot ?? 1;
          this.lobby = msg.lobby;
          PlatformSDK.showInviteButton(this.lobby.roomCode);
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

        this.onGameMessageCb?.(msg, hostPeerId);
      });

      const onHostDisconnected = () => {
        if (this.role !== 'client') return;
        this.status = 'error';
        this.errorMsg = I18n.t('errHostLeft');
        this.onPeerLeaveCb?.('host');
        this.notifyLobby();
      };

      conn.on('close', onHostDisconnected);
      conn.on('error', onHostDisconnected);
    });

    peer.on('error', (err: Error & { type?: string }) => {
      this.status = 'error';
      if (err.type === 'peer-unavailable') {
        this.errorMsg = I18n.t('errRoomNotFound', { code });
      } else {
        this.errorMsg = I18n.t('errSignal', { msg: err.message || err.type || 'Network error' });
      }
      this.notifyLobby();
    });
  }

  public setHostStageAndMode(stageId: string, mode: GameMode): void {
    if (this.role !== 'host' || !this.lobby) return;
    this.lobby.stageId = stageId;
    this.lobby.mode = mode;
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
    PlatformSDK.showInviteButton(this.lobby.roomCode);
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
    if (this.role !== 'host') return;
    this.clientConns.forEach((conn, pid) => {
      if (pid === excludePeerId) return;
      if (conn.open) {
        try {
          conn.send(msg);
        } catch {
          // ignore
        }
      }
    });
  }

  public sendToClient(peerId: string, msg: CoopNetMessage): void {
    if (this.role !== 'host') return;
    const conn = this.clientConns.get(peerId);
    if (conn && conn.open) {
      try {
        conn.send(msg);
      } catch {
        // ignore
      }
    }
  }

  public sendToHost(msg: CoopNetMessage): void {
    if (this.role !== 'client' || !this.hostConn || !this.hostConn.open) return;
    try {
      this.hostConn.send(msg);
    } catch {
      // ignore
    }
  }

  private notifyLobby(): void {
    this.onLobbyChangeCb?.();
  }
}

export const CoopManager = new CoopNetworkManager();
