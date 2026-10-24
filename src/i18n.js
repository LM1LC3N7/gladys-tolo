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
      `The App Box does not answer (${reason}): next try in ${wait.en}. Turning off is still sent.`,
      `L’App Box ne répond pas (${reason}) : nouvel essai dans ${wait.fr}. L’extinction est toujours envoyée.`,
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
    'Heating from Gladys is off: turn on “Allow heating from Gladys” in the configuration. Turning off always works. Nothing sent.',
    'Le chauffage depuis Gladys est désactivé : activez « Autoriser le chauffage depuis Gladys » dans la configuration. L’extinction fonctionne toujours. Rien envoyé.',
  ),
  unknownDevice: both(
    'This device is not the App Box of the configuration. Nothing sent.',
    'Cet appareil n’est pas l’App Box de la configuration. Rien envoyé.',
  ),
  noConfig: both(
    'No App Box address configured: nothing sent.',
    'Aucune adresse d’App Box configurée : rien envoyé.',
  ),
  configChanged: both(
    'The configuration changed meanwhile: heating not sent.',
    'La configuration a changé entre-temps : allumage non envoyé.',
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
      `The state of the App Box could not be read (${reason}): heating not sent.`,
      `L’état de l’App Box n’a pas pu être lu (${reason}) : allumage non envoyé.`,
    ),
  missing: both(
    'The state of the App Box is incomplete (power, setpoint or timer missing): heating not sent.',
    'L’état de l’App Box est incomplet (marche, consigne ou minuterie manquante) : allumage non envoyé.',
  ),
  prepareFailed: (reason) =>
    both(
      `The timer or the setpoint could not be set and read back (${reason}): heating not sent.`,
      `La minuterie ou la consigne n’a pas pu être réglée puis relue (${reason}) : allumage non envoyé.`,
    ),
  notSent: (reason) => both(`Not sent (${reason}).`, `Non envoyée (${reason}).`),
  refused: both('The App Box refused the command.', 'L’App Box a refusé la commande.'),
  sentUnconfirmed: (reason) =>
    both(
      `Sent, without confirmation (${reason}): check the App Box.`,
      `Envoyée, sans confirmation (${reason}) : vérifiez l’App Box.`,
    ),
  noReadBack: both('no read back', 'pas de relecture'),
  readBack: (what) => both(`the App Box reads: ${what.en}`, `l’App Box indique : ${what.fr}`),
};
