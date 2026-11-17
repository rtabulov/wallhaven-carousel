// Layout-independent overlay Keys: physical US-QWERTY positions via nativeScanCode.
// When scan code is missing (0), fall back to event.key (Latin Qt.Key_*).
.pragma library

// Linux KEY_* + 8 (Qt nativeScanCode on X11/Wayland).
var byScan = {
    38: "A",
    43: "H",
    46: "L",
    41: "F",
    40: "D",
    32: "O",
    27: "R",
    54: "C",
    28: "T",
    29: "Y",
    57: "N",
    59: "Comma",
    60: "Period",
    61: "Slash",
}

// Qt.Key_* for Latin letters and punctuation.
var byKey = {
    65: "A",
    72: "H",
    76: "L",
    70: "F",
    68: "D",
    79: "O",
    82: "R",
    67: "C",
    84: "T",
    89: "Y",
    78: "N",
    44: "Comma",
    46: "Period",
    47: "Slash",
}

function keyId(event) {
    if (event.nativeScanCode)
        return byScan[event.nativeScanCode] || ""
    return byKey[event.key] || ""
}
