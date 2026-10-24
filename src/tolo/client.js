// -----------------------------------------------------------------------------
// The App Box calls of the integration, over the transport of src/tolo/udp.js
// (tests give a fake one): the status and the settings (reads, sent again
// when silent), and the sets (power, timer, setpoint, lamp, fan). Each call
// is one exchange on its own socket; an answer is accepted only when it is
// the answer of that very command (src/tolo/protocol.js).
// -----------------------------------------------------------------------------

import { COMMAND, PORT, REQUESTS, parseSetAnswer, parseSettings, parseStatus } from './protocol.js';
import { udpTransport } from './udp.js';

export class ToloClient {
  constructor({ transport = udpTransport(), now = Date.now, port = PORT } = {}) {
    this.transport = transport;
    this.now = now;
    this.port = port;
  }

  async call(host, request, accept, options) {
    const { result } = await this.transport.exchange({
      host,
      port: this.port,
      request,
      accept,
      now: this.now,
      ...options,
    });
    return result;
  }

  /** The status (src/tolo/protocol.js parseStatus). */
  status(host, options) {
    return this.call(host, REQUESTS.status(), parseStatus, options);
  }

  /** The settings (src/tolo/protocol.js parseSettings). */
  settings(host, options) {
    return this.call(host, REQUESTS.settings(), parseSettings, options);
  }

  /**
   * One set: resolves true when the App Box accepted it (answer 00), false
   * when it answered with a refusal. The confirmation is always a read after.
   */
  set(host, command, value, options) {
    const { request, code } = SETS[command](value);
    // The value byte of the request (index 3) must come back as the echo.
    return this.call(
      host,
      request,
      (message) => parseSetAnswer(message, code, request[3]),
      options,
    );
  }
}

/** The sets the integration sends, by name. */
const SETS = {
  power: (on) => ({ request: REQUESTS.powerOn(on), code: COMMAND.SET_POWER_ON }),
  timer: (minutes) => ({ request: REQUESTS.powerTimer(minutes), code: COMMAND.SET_POWER_TIMER }),
  target: (t) => ({
    request: REQUESTS.targetTemperature(t),
    code: COMMAND.SET_TARGET_TEMPERATURE,
  }),
  lamp: (on) => ({ request: REQUESTS.lampOn(on), code: COMMAND.SET_LAMP_ON }),
  fan: (on) => ({ request: REQUESTS.fanOn(on), code: COMMAND.SET_FAN_ON }),
};
