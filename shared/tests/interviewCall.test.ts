import { afterAll, expect, test } from 'bun:test';
import { InterviewCall } from '../interviewCall';

class SocketFixture {
  connected = true;
  handlers = new Map<string, Set<(...args: any[]) => void>>();
  emitted: Array<[string, any]> = [];
  on(event: string, listener: (...args: any[]) => void) { if (!this.handlers.has(event)) this.handlers.set(event, new Set()); this.handlers.get(event)!.add(listener); }
  off(event: string, listener: (...args: any[]) => void) { this.handlers.get(event)?.delete(listener); }
  emit(event: string, data: any) { this.emitted.push([event, data]); }
  deliver(event: string, data?: any) { this.handlers.get(event)?.forEach(listener => listener(data)); }
}
class PeerFixture {
  static peers: PeerFixture[] = [];
  signalingState = 'stable'; remoteDescription: any = null; localDescription: any = null;
  candidates: any[] = []; closed = false;
  stalled?: Promise<void>;
  onconnectionstatechange: any; onicecandidate: any; ontrack: any;
  ondatachannel: any;
  channel?: ChannelFixture;
  createDataChannel() { this.channel = new ChannelFixture(); return this.channel as any; }
  constructor(public configuration: any) { PeerFixture.peers.push(this); }
  addTrack() {}
  setConfiguration(value: any) { this.configuration = value; }
  async setRemoteDescription(value: any) { if (this.stalled) await this.stalled; this.remoteDescription = value; this.signalingState = value.type === 'offer' ? 'have-remote-offer' : 'stable'; }
  async setLocalDescription(value: any) { this.localDescription = value; this.signalingState = value.type === 'offer' ? 'have-local-offer' : 'stable'; }
  async addIceCandidate(value: any) { if (!this.remoteDescription) throw Error('Remote description required'); this.candidates.push(value); }
  async createAnswer() { return { type: 'answer', sdp: 'fixture' }; }
  async createOffer(options: any) { expect(options.iceRestart).toBe(true); return { type: 'offer', sdp: 'fixture' }; }
  close() { this.closed = true; }
}
class ChannelFixture {
  label = 'interview-text'; readyState = 'open'; bufferedAmount = 0;
  onopen: any; onclose: any; onerror: any; onmessage: any;
  sent: string[] = [];
  send(value: string) { this.sent.push(value); }
  close() { this.readyState = 'closed'; }
}
const original = globalThis.RTCPeerConnection;
globalThis.RTCPeerConnection = PeerFixture as any;
afterAll(() => { globalThis.RTCPeerConnection = original; });
const flush = () => new Promise(resolve => setTimeout(resolve, 10));
const fixture = (role: 'admin' | 'tutor' = 'admin') => {
  const socket = new SocketFixture();
  const errors: string[] = [];
  const call = new InterviewCall({ socket, role, roomId: 'interview-fixture', stream: { getTracks: () => [] } as any,
    onState: () => {}, onStream: () => {}, onEnded: () => {}, onError: message => errors.push(message) });
  return { socket, call, errors };
};
const joined = { roomId: 'interview-fixture', configuration: { iceServers: [{ urls: 'stun:fixture' }] }, peerPresent: false };

test('room entry waits for authorization and relay configuration', async () => {
  const { socket, call } = fixture(); let ready = false;
  const result = call.start().then(() => { ready = true; });
  expect(socket.emitted[0]?.[0]).toBe('interview:join');
  await flush(); expect(ready).toBe(false);
  socket.deliver('interview:joined', joined); await result;
  expect(ready).toBe(true); expect(PeerFixture.peers.at(-1)?.configuration).toEqual(joined.configuration);
  call.close(); expect(PeerFixture.peers.at(-1)?.closed).toBe(true);
  expect([...socket.handlers.values()].every(listeners => !listeners.size)).toBe(true);
});
test('early ICE is buffered until an offer is applied', async () => {
  const { socket, call } = fixture(); const ready = call.start(); socket.deliver('interview:joined', joined); await ready;
  socket.deliver('interview:ice-candidate', { candidate: { candidate: 'early-candidate' }, negotiationId: 'first' });
  await flush(); expect(PeerFixture.peers.at(-1)?.candidates).toEqual([]);
  socket.deliver('interview:offer', { offer: { type: 'offer', sdp: 'fixture' }, negotiationId: 'first' });
  await flush(); expect(PeerFixture.peers.at(-1)?.candidates.length).toBe(1);
  expect(socket.emitted.some(([event]) => event === 'interview:answer')).toBe(true); call.close();
});
test('denied entry rejects readiness and never creates an authorized call', async () => {
  const { socket, call, errors } = fixture(); const ready = call.start();
  socket.deliver('interview:error', { message: 'Access denied' });
  await expect(ready).rejects.toThrow('Access denied'); expect(errors).toEqual(['Access denied']); call.close();
});
test('candidate refresh preserves early ICE while replacing the old peer', async () => {
  const { socket, call } = fixture(); const ready = call.start(); socket.deliver('interview:joined', joined); await ready;
  socket.deliver('interview:tutor-left');
  socket.deliver('interview:ice-candidate', { candidate: { candidate: 'refreshed-candidate' }, negotiationId: 'second' });
  socket.deliver('interview:offer', { offer: { type: 'offer', sdp: 'refreshed-fixture' }, negotiationId: 'second' });
  await flush(); expect(PeerFixture.peers.at(-1)?.candidates.length).toBe(1); call.close();
});
test('candidate serializes offers and requests ICE restart for recovery', async () => {
  const { socket, call } = fixture('tutor'); const ready = call.start(); socket.deliver('interview:joined', joined); await ready;
  call.recover(); call.recover(); await flush();
  expect(socket.emitted.filter(([event]) => event === 'interview:offer').length).toBe(1);
  call.end(); call.end(); expect(socket.emitted.filter(([event]) => event === 'interview:end').length).toBe(1);
});
test('an answer from an old negotiation cannot satisfy a new offer', async () => {
  const { socket, call } = fixture('tutor'); const ready = call.start(); socket.deliver('interview:joined', joined); await ready;
  call.recover(); await flush();
  const offer = socket.emitted.find(([event]) => event === 'interview:offer')![1];
  socket.deliver('interview:answer', { answer: { type:'answer',sdp:'old' }, negotiationId:'old-id' });
  await flush(); expect(PeerFixture.peers.at(-1)?.remoteDescription).toBeNull();
  socket.deliver('interview:answer', { answer: { type:'answer',sdp:'current' }, negotiationId:offer.negotiationId });
  await flush(); expect(PeerFixture.peers.at(-1)?.remoteDescription.sdp).toBe('current'); call.close();
});
test('a pending old SDP operation cannot block a refreshed candidate', async () => {
  const { socket, call } = fixture(); const ready = call.start(); socket.deliver('interview:joined', joined); await ready;
  let release!: () => void;
  PeerFixture.peers.at(-1)!.stalled = new Promise<void>(resolve => { release = resolve; });
  socket.deliver('interview:offer', { offer: { type:'offer',sdp:'old' }, negotiationId:'old' });
  await flush(); socket.deliver('interview:tutor-left');
  socket.deliver('interview:offer', { offer: { type:'offer',sdp:'new' }, negotiationId:'new' });
  await flush(); expect(PeerFixture.peers.at(-1)?.remoteDescription.sdp).toBe('new');
  release(); await flush();
  expect(socket.emitted.filter(([event,data]) => event === 'interview:answer' && data.negotiationId === 'old').length).toBe(0);
  call.close();
});

test('interview chat sends plain multiline text and rejects invalid or disconnected sends', async () => {
  const socket = new SocketFixture(), messages: any[] = [], states: boolean[] = [];
  const call = new InterviewCall({ socket, role: 'tutor', roomId: 'interview-fixture', stream: {getTracks:()=>[]} as any,
    onState:()=>{},onStream:()=>{},onEnded:()=>{},onError:()=>{},onChatReady:value=>states.push(value),onMessage:value=>messages.push(value) });
  expect(()=>call.sendText('Hello')).toThrow('disconnected');
  const ready=call.start();socket.deliver('interview:joined',joined);await ready;
  const channel=PeerFixture.peers.at(-1)!.channel!;channel.onopen();
  call.sendText(' First line\r\nSecond line ');
  expect(JSON.parse(channel.sent[0]!).text).toBe('First line\nSecond line');
  expect(messages[0].mine).toBe(true);
  for(const data of [new ArrayBuffer(8),'not-json',JSON.stringify({type:'file',id:'file',text:'x'}),JSON.stringify({type:'text',id:'x',text:'a'.repeat(2001)})])channel.onmessage({data});
  expect(messages).toHaveLength(1);
  const data=JSON.stringify({type:'text',id:'incoming',text:'<img src=x>\nHello'});
  channel.onmessage({data});channel.onmessage({data});
  expect(messages).toHaveLength(2);expect(messages[1]).toEqual({id:'incoming',text:'<img src=x>\nHello',mine:false});
  expect(()=>call.sendText(' \n ')).toThrow('1-2,000');
  channel.bufferedAmount=64001;expect(()=>call.sendText('busy')).toThrow('busy');
  call.close();expect(channel.readyState).toBe('closed');expect(states.at(-1)).toBe(false);
  expect(()=>call.sendText('Closed')).toThrow('disconnected');
});

test('interviewer accepts only the text channel from the current authorized peer', async () => {
  const {socket,call}=fixture();const ready=call.start();socket.deliver('interview:joined',joined);await ready;
  const oldPeer=PeerFixture.peers.at(-1)!;
  const wrong=new ChannelFixture();wrong.label='file';oldPeer.ondatachannel({channel:wrong});expect(wrong.readyState).toBe('closed');
  const chat=new ChannelFixture();oldPeer.ondatachannel({channel:chat});call.sendText('Admin reply');expect(chat.sent).toHaveLength(1);
  socket.deliver('interview:tutor-left');expect(chat.readyState).toBe('closed');
  const stale=new ChannelFixture();oldPeer.ondatachannel({channel:stale});expect(stale.readyState).toBe('closed');
  call.close();
});
