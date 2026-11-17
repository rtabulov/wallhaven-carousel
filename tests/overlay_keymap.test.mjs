import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

// Linux KEY_* + 8 — Qt nativeScanCode on X11/Wayland (independent of OverlayKeyMap.js).
const SCAN_A = 38;
const SCAN_H = 43;
const SCAN_L = 46;
const SCAN_F = 41;
const SCAN_D = 40;
const SCAN_O = 32;
const SCAN_R = 27;
const SCAN_C = 54;
const SCAN_T = 28;
const SCAN_Y = 29;
const SCAN_N = 57;
const SCAN_COMMA = 59;
const SCAN_PERIOD = 60;
const SCAN_SLASH = 61;
const SCAN_ESC = 9;

// Qt.Key_* for Latin letters / punctuation (ASCII / Qt enums).
const QT_A = 65;
const QT_H = 72;
const QT_L = 76;
const QT_F = 70;
const QT_D = 68;
const QT_O = 79;
const QT_R = 82;
const QT_C = 67;
const QT_T = 84;
const QT_Y = 89;
const QT_N = 78;
const QT_COMMA = 44;
const QT_PERIOD = 46;
const QT_SLASH = 47;
const QT_CYRILLIC_A = 0x0410; // А — what ru layout can put on physical A

function loadMap() {
    const src = readFileSync(new URL('../OverlayKeyMap.js', import.meta.url), 'utf8')
        .replace(/^\.pragma library\s*/m, '');
    const sandbox = {};
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox);
    return sandbox;
}

test('physical A is A even when event.key is a Cyrillic letter', () => {
    const { keyId } = loadMap();
    assert.equal(keyId({ nativeScanCode: SCAN_A, key: QT_CYRILLIC_A }), 'A');
});

test('every letter and punctuation Key resolves from its physical scan code', () => {
    const { keyId } = loadMap();
    const cases = [
        [SCAN_A, 'A'], [SCAN_H, 'H'], [SCAN_L, 'L'], [SCAN_F, 'F'], [SCAN_D, 'D'],
        [SCAN_O, 'O'], [SCAN_R, 'R'], [SCAN_C, 'C'], [SCAN_T, 'T'], [SCAN_Y, 'Y'],
        [SCAN_N, 'N'], [SCAN_COMMA, 'Comma'], [SCAN_PERIOD, 'Period'], [SCAN_SLASH, 'Slash'],
    ];
    for (const [scan, id] of cases)
        assert.equal(keyId({ nativeScanCode: scan, key: 0 }), id, scan);
});

test('scan code 0 falls back to Qt.Key Latin ids', () => {
    const { keyId } = loadMap();
    const cases = [
        [QT_A, 'A'], [QT_H, 'H'], [QT_L, 'L'], [QT_F, 'F'], [QT_D, 'D'],
        [QT_O, 'O'], [QT_R, 'R'], [QT_C, 'C'], [QT_T, 'T'], [QT_Y, 'Y'],
        [QT_N, 'N'], [QT_COMMA, 'Comma'], [QT_PERIOD, 'Period'], [QT_SLASH, 'Slash'],
    ];
    for (const [key, id] of cases)
        assert.equal(keyId({ nativeScanCode: 0, key }), id, key);
});

test('unmapped scan code does not fall back to event.key', () => {
    const { keyId } = loadMap();
    assert.equal(keyId({ nativeScanCode: SCAN_ESC, key: QT_A }), '');
});
