// Minimal MQTT 3.1.1 packet codec — the subset needed to use a public broker as a WebRTC
// signalling rendezvous: CONNECT, SUBSCRIBE, PUBLISH (QoS 0), PINGREQ, DISCONNECT.
//
// This is pure encode/decode with no I/O so it can be unit tested in Node (tools/nettest.js).
// The socket wiring lives in net/signal.js (mqttSignal).
//
// A WebSocket message does NOT align with an MQTT packet: one frame may carry several packets,
// or half of one. `createParser()` handles that; never parse a frame in isolation.

export const PKT = { CONNECT: 1, CONNACK: 2, PUBLISH: 3, SUBSCRIBE: 8, SUBACK: 9, PINGREQ: 12, PINGRESP: 13, DISCONNECT: 14 };

const enc = new TextEncoder();
const dec = new TextDecoder();

/** MQTT "remaining length": 7 bits per byte, high bit = continuation. Max 4 bytes. */
export function encodeLength(n: number): number[] {
  const out: number[] = [];
  do { let b = n % 128; n = Math.floor(n / 128); if (n > 0) b |= 0x80; out.push(b); } while (n > 0 && out.length < 4);
  return out;
}

/** A decoded "remaining length": its value, and how many bytes it occupied. */
export interface DecodedLength {
  /** The length the field encodes. */
  value: number;
  /** How many bytes the field itself took, 1 to 4. */
  bytes: number;
}

/** Decode a remaining length at `i`. Returns null when more bytes are needed. */
export function decodeLength(buf: Uint8Array, i: number): DecodedLength | null {
  let mult = 1, value = 0, bytes = 0, b: number;
  do {
    if (i + bytes >= buf.length) return null;      // incomplete — wait for more data
    if (bytes >= 4) throw new Error('mqtt: malformed remaining length');
    b = buf[i + bytes];
    value += (b & 0x7f) * mult;
    mult *= 128;
    bytes++;
  } while (b & 0x80);
  return { value, bytes };
}

function str(s: string): number[] { const b = enc.encode(s); return [b.length >> 8, b.length & 0xff, ...b]; }

function packet(type: number, flags: number, body: number[]): Uint8Array {
  return new Uint8Array([(type << 4) | flags, ...encodeLength(body.length), ...body]);
}

/** CONNECT with a clean session and no credentials (public brokers accept anonymous clients). */
export function encodeConnect(clientId: string, keepaliveSec: number = 45): Uint8Array {
  return packet(PKT.CONNECT, 0, [...str('MQTT'), 0x04, 0x02, keepaliveSec >> 8, keepaliveSec & 0xff, ...str(clientId)]);
}

/** SUBSCRIBE at QoS 0. The 0x02 fixed-header flag is required by the spec. */
export function encodeSubscribe(packetId: number, topic: string): Uint8Array {
  return packet(PKT.SUBSCRIBE, 0x02, [packetId >> 8, packetId & 0xff, ...str(topic), 0x00]);
}

/** PUBLISH at QoS 0 (fire and forget — there is no packet id and no acknowledgement). */
export function encodePublish(topic: string, payload: string | Uint8Array): Uint8Array {
  const body = typeof payload === 'string' ? enc.encode(payload) : payload;
  return packet(PKT.PUBLISH, 0, [...str(topic), ...body]);
}

export function encodePingReq(): Uint8Array { return packet(PKT.PINGREQ, 0, []); }
export function encodeDisconnect(): Uint8Array { return packet(PKT.DISCONNECT, 0, []); }

/** One whole MQTT packet off the stream. `topic` and `payload` are PUBLISH-only. */
export interface MqttPacket {
  /** Packet type, one of the `PKT` values. */
  type: number;
  /** The low nibble of the fixed header. */
  flags: number;
  /** The variable header plus payload, as a view into the parser's buffer. */
  body: Uint8Array;
  /** PUBLISH only: the topic the message arrived on. */
  topic?: string;
  /** PUBLISH only: the message body, decoded as UTF-8. */
  payload?: string;
}

/** Holds the bytes that did not yet make up a whole packet between calls. */
export interface MqttParser {
  /** Feed one WebSocket frame; returns whatever packets it completed, in order. */
  push(bytes: Uint8Array): MqttPacket[];
}

/** Streaming packet parser. Feed it every WebSocket frame; it emits whole packets only. */
export function createParser(): MqttParser {
  let buf = new Uint8Array(0);
  return {
    push(bytes) {
      const merged = new Uint8Array(buf.length + bytes.length);
      merged.set(buf); merged.set(bytes, buf.length);
      buf = merged;
      const out: MqttPacket[] = [];
      for (;;) {
        if (buf.length < 2) break;
        const len = decodeLength(buf, 1);
        if (!len) break;                                   // remaining-length not fully arrived
        const start = 1 + len.bytes, total = start + len.value;
        if (buf.length < total) break;                     // body not fully arrived
        const type = buf[0] >> 4, flags = buf[0] & 0x0f;
        const body = buf.subarray(start, total);
        const msg: MqttPacket = { type, flags, body };   // CONNACK's return code lives in body[1]
        if (type === PKT.PUBLISH) {
          const tl = (body[0] << 8) | body[1];
          msg.topic = dec.decode(body.subarray(2, 2 + tl));
          msg.payload = dec.decode(body.subarray(2 + tl));  // QoS 0 only: no packet id
        }
        out.push(msg);
        buf = buf.subarray(total);
      }
      return out;
    },
  };
}
