export interface InterviewSocket {
  connected: boolean;
  on(event: string, listener: (...args: any[]) => void): any;
  off(event: string, listener?: (...args: any[]) => void): any;
  emit(event: string, data?: any, callback?: (...args: any[]) => void): any;
}

export class InterviewCall {
  private pc: RTCPeerConnection | null = null;
  private configuration: RTCConfiguration = { iceServers: [] };
  private candidates: Array<{ candidate: RTCIceCandidateInit; negotiationId: string }> = [];
  private negotiationId = '';
  private peerId?: string;
  private listeners: Array<[string, (...args: any[]) => void]> = [];
  private chain = Promise.resolve();
  private epoch = 0;
  private disposed = false;
  private joined = false;
  private joinTimer?: ReturnType<typeof setTimeout>;
  private recoveryTimer?: ReturnType<typeof setTimeout>;
  private joining?: { resolve: () => void; reject: (error: Error) => void };

  constructor(private options: {
    socket: InterviewSocket; roomId: string; role: 'admin' | 'tutor'; stream: MediaStream;
    onStream: (stream: MediaStream | null) => void;
    onState: (state: 'waiting' | 'connecting' | 'connected' | 'reconnecting' | 'ended') => void;
    onError: (message: string) => void; onEnded: () => void;
  }) {
    const listen = (event: string, fn: (...args: any[]) => void) => {
      options.socket.on(event, fn); this.listeners.push([event, fn]);
    };
    listen('connect', () => this.join());
    listen('disconnect', () => { this.joined = false; options.onState('reconnecting'); });
    listen('connect_error', () => this.fail('Interview connection unavailable. Check your connection and retry.'));
    listen('interview:error', data => this.fail(data?.message || 'Unable to join this interview.'));
    listen('interview:joined', data => {
      if (data?.roomId !== options.roomId || this.disposed) return;
      this.configuration = data.configuration;
      if (!Array.isArray(this.configuration?.iceServers)) return this.fail('Missing interview relay configuration.');
      this.joined = true;
      if (this.peerId && data.peerId !== this.peerId) this.resetPeer();
      this.peerId = data.peerId;
      if (this.pc) this.pc.setConfiguration(this.configuration);
      else this.createPeer();
      if (this.joinTimer) clearTimeout(this.joinTimer);
      this.joining?.resolve(); this.joining = undefined;
      options.onState(this.pc?.connectionState === 'connected' ? 'connected' : data.peerPresent ? 'connecting' : 'waiting');
      if (data.peerPresent) this.recover();
    });
    listen(options.role === 'tutor' ? 'interview:admin-joined' : 'interview:tutor-joined', data => {
      if (this.peerId && data?.peerId !== this.peerId) this.resetPeer();
      this.peerId = data?.peerId;
      this.recover();
    });
    listen(options.role === 'tutor' ? 'interview:admin-left' : 'interview:tutor-left', () => {
      this.peerId = undefined; this.resetPeer(); options.onState('waiting');
    });
    listen('interview:renegotiate', () => this.offer());
    listen('interview:offer', data => this.serialize(async () => {
      if (options.role !== 'admin' || !this.joined || data?.offer?.type !== 'offer' || !data.negotiationId || (this.peerId && data.from !== this.peerId)) return;
      if (this.pc && this.pc.signalingState !== 'stable') this.resetPeer();
      this.negotiationId = data.negotiationId;
      const pc = this.pc || this.createPeer();
      await pc.setRemoteDescription(data.offer);
      await this.flushCandidates(pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      if (!this.disposed && this.pc === pc) options.socket.emit('interview:answer', { roomId: options.roomId, answer: pc.localDescription, negotiationId: data.negotiationId });
    }));
    listen('interview:answer', data => this.serialize(async () => {
      if (options.role !== 'tutor' || this.pc?.signalingState !== 'have-local-offer' || data?.answer?.type !== 'answer' || data.negotiationId !== this.negotiationId || (this.peerId && data.from !== this.peerId)) return;
      await this.pc.setRemoteDescription(data.answer);
      await this.flushCandidates(this.pc);
    }));
    listen('interview:ice-candidate', data => this.serialize(async () => {
      if (!data?.candidate || !this.joined || !data.negotiationId || (this.peerId && data.from !== this.peerId)) return;
      if (!this.pc?.remoteDescription || data.negotiationId !== this.negotiationId) {
        if (this.candidates.length >= 256) this.candidates.shift();
        this.candidates.push({ candidate: data.candidate, negotiationId: data.negotiationId }); return;
      }
      await this.pc.addIceCandidate(data.candidate);
    }));
    listen('interview:ended', () => { this.close(); options.onState('ended'); options.onEnded(); });
  }

  start() {
    if (this.disposed) return Promise.reject(new Error('Interview is closed.'));
    return new Promise<void>((resolve, reject) => {
      this.joining = { resolve, reject };
      this.joinTimer = setTimeout(() => this.fail('Interview room did not respond. Retry joining.'), 15000);
      if (this.options.socket.connected) this.join();
    });
  }

  private join() {
    if (!this.disposed) this.options.socket.emit('interview:join', { roomId: this.options.roomId, role: this.options.role });
  }

  private createPeer() {
    const pc = new RTCPeerConnection(this.configuration);
    this.options.stream.getTracks().forEach(track => pc.addTrack(track, this.options.stream));
    pc.onicecandidate = event => {
      if (event.candidate && this.joined && this.negotiationId) this.options.socket.emit('interview:ice-candidate', { roomId: this.options.roomId, candidate: event.candidate.toJSON(), negotiationId: this.negotiationId });
    };
    pc.ontrack = event => { if (!this.disposed && this.pc === pc) this.options.onStream(event.streams[0] || new MediaStream([event.track])); };
    pc.onconnectionstatechange = () => {
      if (this.disposed || this.pc !== pc) return;
      if (pc.connectionState === 'connected') {
        if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
        this.options.onState('connected');
      } else if (['failed', 'disconnected'].includes(pc.connectionState)) {
        this.options.onState('reconnecting');
        if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
        this.recoveryTimer = setTimeout(() => this.recover(), 1500);
      }
    };
    this.pc = pc;
    return pc;
  }

  private serialize(task: () => Promise<void>) {
    const epoch = this.epoch;
    this.chain = this.chain.then(() => this.disposed || epoch !== this.epoch ? undefined : task()).catch(() => {
      if (!this.disposed && epoch === this.epoch) this.options.onError('Media negotiation failed. Use Reconnect to retry.');
    });
  }

  private async flushCandidates(pc: RTCPeerConnection) {
    const candidates = this.candidates.filter(item => item.negotiationId === this.negotiationId);
    this.candidates = this.candidates.filter(item => item.negotiationId !== this.negotiationId);
    for (const candidate of candidates) {
      try { await pc.addIceCandidate(candidate.candidate); } catch { /* A replaced peer can send an obsolete ICE generation. */ }
    }
  }

  private offer() {
    this.serialize(async () => {
      if (!this.joined || this.options.role !== 'tutor') return;
      const pc = this.pc || this.createPeer();
      if (pc.signalingState !== 'stable') return;
      this.negotiationId = crypto.randomUUID();
      await pc.setLocalDescription(await pc.createOffer({ iceRestart: true }));
      if (!this.disposed && this.pc === pc) this.options.socket.emit('interview:offer', { roomId: this.options.roomId, offer: pc.localDescription, negotiationId: this.negotiationId });
    });
  }

  recover() {
    if (this.disposed || !this.joined || !this.options.socket.connected) return;
    if (this.pc?.connectionState !== 'connected') this.options.onState('connecting');
    if (this.pc?.connectionState === 'failed') this.resetPeer();
    if (this.options.role === 'tutor') this.offer();
    else this.options.socket.emit('interview:renegotiate', { roomId: this.options.roomId });
  }

  private resetPeer() {
    // Closing a peer can leave its native SDP promises pending. New peers must
    // not wait on the old operation chain or accept its eventual callbacks.
    this.epoch++; this.chain = Promise.resolve();
    if (this.pc) { this.pc.onconnectionstatechange = null; this.pc.close(); this.pc = null; }
    this.candidates = []; this.negotiationId = ''; this.options.onStream(null);
  }

  private fail(message: string) {
    if (this.disposed) return;
    this.options.onError(message);
    this.joining?.reject(new Error(message)); this.joining = undefined;
    if (this.joinTimer) clearTimeout(this.joinTimer);
  }

  end() {
    if (!this.disposed && this.joined && this.options.socket.connected) this.options.socket.emit('interview:end', { roomId: this.options.roomId });
    this.close();
  }

  close() {
    if (this.disposed) return;
    this.disposed = true; this.joined = false;
    if (this.joinTimer) clearTimeout(this.joinTimer);
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    this.joining?.reject(new Error('Interview was closed.')); this.joining = undefined;
    this.listeners.forEach(([event, listener]) => this.options.socket.off(event, listener));
    this.resetPeer();
  }
}
