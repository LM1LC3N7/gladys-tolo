// -----------------------------------------------------------------------------
// The integration against the SDK's fake Gladys and a fake App Box, with the
// exact wiring of the container (src/handlers.js) and a mocked clock (the
// monotonic clock of the app follows it).
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { ToloApp } from '../../src/app.js';
import { SECOND } from '../../src/constants.js';
import { registerHandlers } from '../../src/handlers.js';
import { memoryStore } from '../../src/store.js';
import { HOST, NOW, PORT, fakeAppBox, settle } from './fakeTolo.js';

export const CFG = { host: HOST };
export const HEAT_CFG = { ...CFG, allow_heating: true };
export const DEVICE = 'ext:test-integration:tolo:appbox';
export const feature = (role) => `${DEVICE}:${role}`;

export async function setup(
  t,
  { config = CFG, box = fakeAppBox(), store = memoryStore(), create = true, now = NOW } = {},
) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now });
  const gladys = createFakeGladys({ config });
  const logs = [];
  const logger = Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((l) => [
      l,
      (...a) => logs.push(`${l}: ${a.map((x) => (x instanceof Error ? x.message : x)).join(' ')}`),
    ]),
  );
  const app = new ToloApp({
    gladys,
    logger,
    transport: box.transport,
    port: PORT,
    now: () => Date.now(),
    mono: () => Date.now(),
    store,
  });
  registerHandlers(gladys, app, logger);
  const advance = async (ms, step = 50) => {
    for (let e = 0; e < ms; e += step) {
      t.mock.timers.tick(Math.min(step, ms - e));
      await settle(5);
    }
  };
  // The first read runs inside the connection: the mocked clock drives it.
  let connected = false;
  const connecting = gladys.connect().then(() => {
    connected = true;
  });
  for (let i = 0; i < 200 && !connected; i += 1) {
    t.mock.timers.tick(50);
    await settle(5);
  }
  await connecting;
  await advance(SECOND);
  t.after(() => app.stop());
  if (create && gladys.fake.discoveredDevices.length > 0) {
    await gladys.fake.deviceCreated(gladys.fake.discoveredDevices[0]);
    await settle();
  }
  const fire = (role, value = 1) => {
    const device = gladys.fake.devices.find((d) => d.external_id === DEVICE) ?? {
      external_id: DEVICE,
    };
    return gladys.fake.setValue(device, { external_id: feature(role) }, value);
  };
  const press = async (role, value = 1, wait = 5 * SECOND) => {
    const ack = fire(role, value);
    await advance(wait);
    return ack;
  };
  const state = (role) =>
    gladys.fake.states.findLast((s) => s.device_feature_external_id === feature(role));
  const status = () => gladys.fake.connectionStatus;
  return { gladys, app, box, advance, logs, fire, press, store, state, status };
}
