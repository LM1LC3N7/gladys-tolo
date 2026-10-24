// -----------------------------------------------------------------------------
// Runtime texts (English and French): feature and status names, the status of
// the integration, the answers of the button and the command errors.
// -----------------------------------------------------------------------------

import { FEATURES } from './constants.js';
import { CALEFACTION } from './tolo/protocol.js';

export const both = (en, fr) => ({ en, fr });
export const join = (a, b) => both(`${a.en} ${b.en}`, `${a.fr} ${b.fr}`);

/** One language of a `{ en, fr }` text. */
export const word = (value, language) => (language === 'en' ? value.en : value.fr);

/** "45 s", "5 min", "2 h", in both languages. */
export function age(ms) {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 90) {
    return both(`${seconds} s`, `${seconds} s`);
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) {
    return both(`${minutes} min`, `${minutes} min`);
  }
  const hours = Math.round(minutes / 60);
  return both(`${hours} h`, `${hours} h`);
}

export const DEVICE_NAME = both('TOLO steam generator', 'Générateur de vapeur TOLO');

export const FEATURE_NAMES = {
  [FEATURES.HEATING]: both('Heating on', 'Chauffe en marche'),
  [FEATURES.STATUS]: both('Status', 'Statut'),
  [FEATURES.TEMPERATURE]: both('Temperature', 'Température'),
  [FEATURES.HUMIDITY]: both('Humidity', 'Humidité'),
  [FEATURES.TARGET]: both('Setpoint', 'Consigne'),
  [FEATURES.REMAINING]: both('Time left', 'Temps restant'),
  [FEATURES.WATER]: both('Water level', 'Niveau d’eau'),
  [FEATURES.TANK]: both('Tank temperature', 'Température du réservoir'),
  [FEATURES.LAMP]: both('Lamp', 'Lampe'),
  [FEATURES.FAN]: both('Fan', 'Ventilateur'),
  [FEATURES.HEAT_ON]: both('Turn on (heat)', 'Allumer (chauffer)'),
  [FEATURES.HEAT_OFF]: both('Turn off', 'Éteindre'),
};

const CALEFACTION_NAMES = {
  [CALEFACTION.HEAT]: both('Heating', 'En chauffe'),
  [CALEFACTION.INACTIVE]: both('On, not heating', 'En marche, sans chauffe'),
  [CALEFACTION.UNCLEAR]: both('On (state 2)', 'En marche (état 2)'),
  [CALEFACTION.KEEP]: both('Keeping warm', 'Maintien en température'),
};

/** The status of the App Box as read. */
export function statusText(status) {
  if (status.powerOn === undefined) {
    return both('Unknown', 'Inconnu');
  }
  if (!status.powerOn) {
    return both('Off', 'Éteint');
  }
  return CALEFACTION_NAMES[status.calefaction] ?? both('On', 'En marche');
}

/** Statuses of the integration (configuration screen). */
export const T = {
  noHost: both(
    'Enter the IP address of the TOLO App Box.',
    'Saisissez l’adresse IP de l’App Box TOLO.',
  ),
  badHost: both(
    'The address is not valid: an IPv4 address of the local network, such as 192.168.1.50 (no name, no broadcast, multicast or loopback address).',
    'L’adresse n’est pas valide : une adresse IPv4 du réseau local, comme 192.168.1.50 (pas de nom, ni d’adresse de diffusion, de multidiffusion ou de bouclage).',
  ),
  connecting: both('Reading the App Box…', 'Lecture de l’App Box…'),
  waiting: (wait) =>
    both(
      `Next read of the App Box in ${wait.en}.`,
      `Prochaine lecture de l’App Box dans ${wait.fr}.`,
    ),
  connected: (summary) => both(`Connected: ${summary.en}.`, `Connecté : ${summary.fr}.`),
  lastRead: (when) => both(`Last read ${when.en} ago.`, `Dernière lecture il y a ${when.fr}.`),
  unreachable: (reason, wait) =>
    both(
      `The App Box does not answer (${reason.en}): next try in ${wait.en}. A turn off is still sent.`,
      `L’App Box ne répond pas (${reason.fr}) : nouvel essai dans ${wait.fr}. Une extinction part quand même.`,
    ),
  timerStop: (time) =>
    both(
      `A session started from Gladys was not held to its duration by the timer: turn off sent at ${time} UTC.`,
      `Une séance lancée depuis Gladys n’était pas tenue à sa durée par la minuterie : extinction envoyée à ${time} UTC.`,
    ),
  sessionOverrun: (time) =>
    both(
      `A session started from Gladys was still on after its planned end: turn off sent at ${time} UTC.`,
      `Une séance lancée depuis Gladys était encore en marche après sa fin prévue : extinction envoyée à ${time} UTC.`,
    ),
  summary: (status) => {
    const name = statusText(status);
    const temp =
      status.temperature === undefined
        ? both('', '')
        : both(`, ${status.temperature} °C`, `, ${status.temperature} °C`);
    return both(`${name.en}${temp.en}`, `${name.fr}${temp.fr}`);
  },
};

/** Why an exchange failed (src/tolo/udp.js ToloError), in both languages. */
export function reasonText(err) {
  if (err?.kind === 'not-sent') {
    const code = err.code ? ` (${err.code})` : '';
    return both(`nothing could leave${code}`, `rien n’a pu partir${code}`);
  }
  if (err?.kind === 'no-answer') {
    if (err.ignored > 0) {
      return both(
        `no valid answer, ${err.ignored} ignored`,
        `pas de réponse valide, ${err.ignored} ignorée(s)`,
      );
    }
    const code = err.code ? ` (${err.code})` : '';
    return both(`no answer${code}`, `pas de réponse${code}`);
  }
  return both('error', 'erreur');
}

/** Refusals of the commands (shown by Gladys when the ack fails). */
export const ERRORS = {
  readOnly: both('This feature cannot be set.', 'Cette fonctionnalité ne peut pas être commandée.'),
  badButton: both('A button only takes 1.', 'Un bouton ne prend que 1.'),
  badBinary: both('Only 0 or 1.', 'Seulement 0 ou 1.'),
  badSetpoint: (min, max) =>
    both(
      `The setpoint must be a whole number from ${min} to ${max} °C (“Highest setpoint”). Nothing sent.`,
      `La consigne doit être un nombre entier de ${min} à ${max} °C (« Consigne la plus haute »). Rien envoyé.`,
    ),
  heatingDisabled: both(
    'Heating from Gladys is off: turn on “Allow heating from Gladys” in the configuration (turning off is never held back by this option). Nothing sent.',
    'Le chauffage depuis Gladys est désactivé : activez « Autoriser le chauffage depuis Gladys » dans la configuration (l’extinction n’est jamais retenue par cette option). Rien envoyé.',
  ),
  noConfig: both(
    'No App Box address configured: nothing sent.',
    'Aucune adresse d’App Box configurée : rien envoyé.',
  ),
  configChanged: both(
    'The configuration changed meanwhile: heating not sent.',
    'La configuration a changé entre-temps : allumage non envoyé.',
  ),
  configChangedPlain: both(
    'The configuration changed meanwhile: nothing sent.',
    'La configuration a changé entre-temps : rien envoyé.',
  ),
  raiseDuringStop: both(
    'A turn off is in flight or not confirmed yet: only a lower setpoint is accepted. Nothing sent.',
    'Une extinction est en cours ou pas encore confirmée : seule une consigne plus basse est acceptée. Rien envoyé.',
  ),
  stopAfterStart: both(
    'Turned on, but a turn off was asked after it had left: the turn off is sent again.',
    'Allumage parti avant l’extinction demandée ensuite : l’extinction est renvoyée.',
  ),
  timerUnconfirmed: (what) =>
    both(
      `Turned on, timer not confirmed (${what.en}): the integration sets it again to what is left of the session, and turns the App Box off if it is still not confirmed.`,
      `Allumée, minuterie non confirmée (${what.fr}) : l’intégration la règle à nouveau sur le reste de la séance, et éteint l’App Box si elle n’est toujours pas confirmée.`,
    ),
  refusedButReads: (what) =>
    both(
      `The App Box answered with a refusal, but reads: ${what.en}.`,
      `L’App Box a répondu par un refus, mais indique : ${what.fr}.`,
    ),
  sideEffect: (name) =>
    both(
      `The ${name.en} command turned the App Box on: turn off sent.`,
      `La commande ${name.fr} a mis l’App Box en marche : extinction envoyée.`,
    ),
  stopMeanwhile: both(
    'A turn off was asked meanwhile: heating not sent.',
    'Une extinction a été demandée entre-temps : allumage non envoyé.',
  ),
  stopPending: both(
    'A turn off is in flight or not confirmed yet: heating refused, nothing sent.',
    'Une extinction est en cours ou pas encore confirmée : allumage refusé, rien envoyé.',
  ),
  busy: both(
    'Another command of this kind is in progress: nothing sent.',
    'Une autre commande du même type est en cours : rien envoyé.',
  ),
  inProgress: both(
    'The previous turn on is not confirmed yet: nothing sent, try again in a minute.',
    'L’allumage précédent n’est pas encore confirmé : rien envoyé, réessayez dans une minute.',
  ),
  tooSlow: both(
    'The App Box did not answer in time: heating not sent.',
    'L’App Box n’a pas répondu à temps : allumage non envoyé.',
  ),
  unknownState: (reason) =>
    both(
      `The state of the App Box could not be read (${reason.en}): heating not sent.`,
      `L’état de l’App Box n’a pas pu être lu (${reason.fr}) : allumage non envoyé.`,
    ),
  missing: both(
    'The power state of the App Box is unreadable: heating not sent.',
    'L’état de marche de l’App Box est illisible : allumage non envoyé.',
  ),
  prepareFailed: (reason) =>
    both(
      `The timer or the setpoint could not be set and read back (${reason.en}): heating not sent.`,
      `La minuterie ou la consigne n’a pas pu être réglée puis relue (${reason.fr}) : allumage non envoyé.`,
    ),
  notSent: (reason) => both(`Not sent (${reason.en}).`, `Non envoyée (${reason.fr}).`),
  refused: both('The App Box refused the command.', 'L’App Box a refusé la commande.'),
  sentUnconfirmed: (reason) =>
    both(
      `Sent, without confirmation (${reason.en}): check the App Box.`,
      `Envoyée, sans confirmation (${reason.fr}) : vérifiez l’App Box.`,
    ),
  answerRefused: both('the App Box answered with a refusal', 'l’App Box a répondu par un refus'),
  timerRead: (minutes) =>
    minutes === null
      ? both('no timer running', 'aucune minuterie en cours')
      : both(`timer ${minutes ?? '?'} min`, `minuterie ${minutes ?? '?'} min`),
  LAMP: both('lamp', 'lampe'),
  FAN: both('fan', 'ventilateur'),
  SETPOINT: both('setpoint', 'de consigne'),
  noReadBack: both('no read back', 'pas de relecture'),
  readBack: (what) => both(`the App Box reads: ${what.en}`, `l’App Box indique : ${what.fr}`),
};
