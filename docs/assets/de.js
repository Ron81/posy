/*!
 * Posy site: German texts.
 * Classic script, loaded after data.js and before app.js by de/index.html. It replaces
 * texts only; tables, bits and sizes stay those of data.js.
 * reference/js/test/docs-site.test.mjs fails when a text of data.js has no German one.
 */
(function (global) {
  'use strict';

  var D = global.PosyData;

  D.T = {
    dec: ',',
    partHead: 'Header + bone_mask',
    partBones: '{n} Knochenrotationen',
    partJoints: '30 Fingerknochen',
    partRoot: 'Position + Hüfthöhe',
    partFingers: 'Fingerblock',
    partVrm: '13 VRM-Emotes + Blick',
    partPerfect: '52 ARKit-Blendshapes + Blick',
    partExtra: 'Extras: {b} Knochen, {v} Werte',
    preset: 'Vorlage',
    mask: 'bone_mask: ein Klick auf einen Knochen schaltet sein Bit um (§4)',
    blocks: 'Blöcke (§5.2); ein Klick auf ? erklärt den Block',
    whatIs: 'Was ist {x}?',
    eyeNote: 'Augenknochen und Gesichtsblock werden beide gesendet. Das ist erlaubt, aber beim Empfänger gewinnen die Blick-Bytes.',
    bytes: 'Bytes',
    maskOut: 'bone_mask (u64)',
    declared: 'deklariert als (§2.1)',
    length: 'Länge (§5.1)',
    people: '{n} Personen',
    split: '({s} senden, {v} schauen zu)',
    watch: '≈ {n} KB/s, um den ganzen Raum zu sehen',
    homeOk: 'Passt in den Upload eines Glasfaser-Heimanschlusses.',
    homeNo: 'Braucht einen Uplink wie im Rechenzentrum oder an einer starken Glasfaserleitung.',
    noBones: 'Kein Knochen gefunden.',
    copy: 'Kopieren',
    copied: 'Kopiert',
    pressCopy: 'Strg+C drücken'
  };

  // The declared type a bit belongs to (§2.1, §4).
  D.CATEGORY_LABEL = {
    'core': 'bones: Wirbelsäule, Kopf, Augen, Kiefer',
    'arm': 'bones: Schultern, Arme, Hände',
    'leg': 'legs und toes',
    'finger': 'finger_bones: eine Rotation pro Gelenk',
    'reserved': 'reserviert, MUSS 0 sein'
  };

  [
    ['Gesichts-Tracker (Hals + Kopf)', 'Kopfrotation und der Gesichtsblock. Die Arme hängen einfach runter.'],
    ['Oberkörper (13 Knochen)', 'Wirbelsäule, Kopf und beide Arme: der typische Frame aus Spec §6.'],
    ['Ganzer Körper (+ Beine und Zehen)', 'Dazu die sechs Beinknochen und beide Zehen: 32 Bytes mehr.']
  ].forEach(function (text, i) {
    D.PRESETS[i].label = text[0];
    D.PRESETS[i].note = text[1];
  });

  D.FLAG_INFO = {
    HAS_ROOT: {
      title: 'HAS_ROOT: wo der Avatar ist',
      body: 'Fügt 8 Bytes hinzu: x und y normiert auf den Playspace, die Tiefe in Millimetern und die Hüfthöhe als Anteil der Hüfthöhe im Stehen, damit Hocken, Sitzen, Knien und Springen funktionieren. Ohne den Block behält ein Empfänger die letzte Position.'
    },
    HAS_FINGERS: {
      title: 'HAS_FINGERS: beide Hände in 24 Bytes',
      body: 'Curl und Splay pro Finger und die Opposition des Daumens. Der Empfänger berechnet daraus die 30 Gelenkrotationen (§5.5). Ein Frame enthält diesen Block oder Fingerknochen pro Gelenk, nie beides.'
    },
    FINGER_BONES: {
      title: 'finger_bones: eine Rotation pro Fingergelenk',
      body: 'Kein Flag: die 30 Fingerknochen auf den bone_mask-Bits 25–54, je 4 Bytes, für Handformen, die der Block nicht darstellen kann (eine Klaue: Grundgelenke gestreckt, äußere Gelenke gebeugt). Ein Gelenk, dessen Bit nicht gesetzt ist, wird wie in der Ruhehand gezeigt.'
    },
    HAS_EXPRESSIONS: {
      title: 'HAS_EXPRESSIONS: das Gesicht',
      body: 'Gewichte für Lider, Mundformen und Stimmungen sowie zwei Blick-Bytes für die Blickrichtung. Das Gesicht wird nicht als Knochen übertragen: die Augen- und Kieferknochen (Bits 6–8) sind eine Notlösung für Rigs, die über Knochenrotation gesteuert werden, und wenn Blick und Augenknochen beide gesendet werden, gewinnt der Blick.'
    },
    PERFECT_SYNC: {
      title: 'PERFECT_SYNC: welcher Gesichtsblock',
      body: 'Aus = VRM-Sync: die 13 VRM-Emotes und der Blick, 15 Bytes. An = Perfect-Sync: alle 52 ARKit-Blendshapes und der Blick, 54 Bytes. Zählt nur zusammen mit HAS_EXPRESSIONS.'
    },
    HAS_EXTRA: {
      title: 'HAS_EXTRA: was der Avatar über den humanoiden Körper hinaus hat',
      body: 'Schwänze, Ohren, weitere Gliedmaßen und eigene Emotes des Avatars. Der Sender deklariert sie einmal mit den Namen aus seiner Avatar-Datei; ein Frame enthält dann 4 Bytes pro deklariertem Knochen und 1 Byte pro deklariertem Wert, ohne Namen oder Anzahl (§2.6, §5.8). Das Beispiel hier sind zwei Ohren mit je zwei Knochen und drei Werte: 19 Bytes.'
    }
  };

  ['1 Darsteller, 49 Zuschauer', '5 Darsteller, 45 Zuschauer', '80 Darsteller mit 30 Hz'].forEach(function (label, i) {
    D.SCENARIOS[i].label = label;
  });

  [
    ['Hauptversion stimmt nicht überein', 'Beim Öffnen des Kanals abweisen'],
    ['Flag oder Knochen-Bit für einen Typ gesetzt, der nicht in allowed steht; ungültige Deklaration', 'Frame verwerfen, zählen'],
    ['> 30 ungültige Frames in 10 s', 'Weiterleitung bis zur neuen Verbindung stoppen'],
    ['Sender > gewährte Hz für > 5 s', 'Überzählige Frames verwerfen'],
    ['Gewünschter Transportweg nicht verfügbar und keine Alternative angeboten', 'Beim Beitritt abweisen']
  ].forEach(function (text, i) {
    D.ERROR_ROWS[i][1] = text[0];
    D.ERROR_ROWS[i][2] = text[1];
  });

  D.FINGER_ROWS[11][2] = 'reserved (MUSS 0 sein)';
})(window);
