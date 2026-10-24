// -----------------------------------------------------------------------------
// One exchange with the App Box over UDP: a request, sent again after each
// silent attempt (UDP may lose it), until an answer is accepted.
//
// Every exchange has its OWN socket (a new source port), connected to the
// App Box address and port, and closed at its end. So an answer can only
// belong to the request of its socket: a late answer of an earlier exchange
// (a read, or a command already settled) reaches a closed socket and is lost,
// never taken for the answer of another request. On top of the filter of the
// connected socket (the kernel drops datagrams from any other address or
// port), the source address and port of every datagram are checked again
// here, its size is bounded, and it must be a well-formed message that the
// caller accepts (same command, expected shape); anything else is ignored
// and counted. The keep-alive byte is ignored.
//
// `beforeSend(attempt)` runs right before EVERY datagram, the resends
// included: it may throw to stop the exchange (a heating command checks its
// option, a turn off and its deadline there), and `sent` says how many
// datagrams left, so a caller never says "nothing sent" when one did.
// -----------------------------------------------------------------------------

import dgram from 'node:dgram';
import { MAX_DATAGRAM, decode, isKeepAlive } from './protocol.js';

export const ERROR_KINDS = {
  /** No datagram left (socket error, or the deadline before the first one). */
  NOT_SENT: 'not-sent',
  /** At least one datagram left, no accepted answer. */
  NO_ANSWER: 'no-answer',
};

export class ToloError extends Error {
  constructor(kind, message, { sent = 0, ignored = 0, code } = {}) {
    super(message);
    this.kind = kind;
    /** Datagrams sent in this exchange. */
    this.sent = sent;
    /** Datagrams received and ignored (other source, malformed, not the answer). */
    this.ignored = ignored;
    this.code = code;
  }
}

/**
 * The real transport (node:dgram). `exchange` resolves `{ result, sent }`
 * with what `accept(message)` returned for the first accepted answer.
 *
 * Options: host, port, request (Buffer), accept(message) -> value | undefined,
 * attempts, attemptTimeout (ms), sendBy (no datagram after it, in `now()`
 * time), answerBy (no wait after it), beforeSend(attempt), now.
 */
export function udpTransport({ createSocket = () => dgram.createSocket('udp4') } = {}) {
  return {
    exchange(options) {
      return exchange(createSocket, options);
    },
  };
}

function exchange(
  createSocket,
  {
    host,
    port,
    request,
    accept,
    attempts,
    attemptTimeout,
    sendBy = Infinity,
    answerBy = Infinity,
    beforeSend = () => {},
    now = Date.now,
  },
) {
  return new Promise((resolve, reject) => {
    let socket;
    let sent = 0;
    let ignored = 0;
    let attempt = 0;
    let timer;
    let done = false;

    const finish = (err, result) => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timer);
      try {
        socket?.close();
      } catch {
        // Already closed.
      }
      if (err) {
        if (!(err instanceof ToloError) && err.kind === undefined) {
          // A refusal of beforeSend: it keeps its message, with the count.
          err.sent = sent;
        }
        reject(err);
      } else {
        resolve({ result, sent });
      }
    };

    const fail = (message, code) => {
      const kind = sent > 0 ? ERROR_KINDS.NO_ANSWER : ERROR_KINDS.NOT_SENT;
      finish(new ToloError(kind, message, { sent, ignored, code }));
    };

    const next = () => {
      if (done) {
        return;
      }
      if (attempt >= attempts) {
        fail(ignored > 0 ? `no valid answer (${ignored} ignored)` : 'no answer');
        return;
      }
      if (now() > sendBy) {
        fail(sent > 0 ? 'no answer in time' : 'too late to send');
        return;
      }
      attempt += 1;
      try {
        beforeSend(attempt);
      } catch (err) {
        finish(err);
        return;
      }
      // Counted before the write: once send() is called, the datagram may leave.
      sent += 1;
      socket.send(request, (err) => {
        if (err) {
          fail(`send failed (${err.code ?? 'error'})`, err.code);
        }
      });
      const wait = Math.max(0, Math.min(attemptTimeout, answerBy - now()));
      timer = setTimeout(() => {
        if (now() >= answerBy) {
          fail(ignored > 0 ? `no valid answer in time (${ignored} ignored)` : 'no answer in time');
          return;
        }
        next();
      }, wait);
    };

    try {
      socket = createSocket();
    } catch (err) {
      fail(`socket (${err.code ?? 'error'})`, err.code);
      return;
    }
    socket.on('error', (err) => fail(`socket (${err.code ?? 'error'})`, err.code));
    socket.on('message', (data, rinfo) => {
      if (done) {
        return;
      }
      if (rinfo?.address !== host || rinfo?.port !== port || data.length > MAX_DATAGRAM) {
        ignored += 1;
        return;
      }
      if (isKeepAlive(data)) {
        return;
      }
      const message = decode(data);
      const result = message ? accept(message) : undefined;
      if (result === undefined) {
        ignored += 1;
        return;
      }
      finish(undefined, result);
    });
    try {
      socket.connect(port, host, (err) => {
        if (err) {
          fail(`connect (${err.code ?? 'error'})`, err.code);
          return;
        }
        next();
      });
    } catch (err) {
      fail(`connect (${err.code ?? 'error'})`, err.code);
    }
  });
}
