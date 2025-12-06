// =====================
// Canvas + Video Setup
// =====================
const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const textDiv = document.getElementById("text");

// =====================
// MediaPipe Hands Setup
// =====================
const hands = new Hands({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});

const DankeState = { active: false, startZ: 0, time: 0 };

hands.setOptions({
  maxNumHands: 2,
  modelComplexity: 1,
  minDetectionConfidence: 0.8,
  minTrackingConfidence: 0.6
});

// =====================
// Bewegungsspeicher (für jede Hand separat)
// =====================
let motionLeft = [];
let motionRight = [];
const MAX_HISTORY = 15;

let abendLeftHistory = [];
let abendRightHistory = [];
const MAX_ABEND_HISTORY = 20; 


let handSequence = []; // speichert {pose, time}
const sequenceTimeLimit = 1500; // 1,5 Sekunden



// === Kreis-Historie für beide Zeigefinger ===
let circleLeft = { prevX: null, prevY: null, dirX: 0, dirY: 0, changes: 0, time: 0 };
let circleRight = { prevX: null, prevY: null, dirX: 0, dirY: 0, changes: 0, time: 0 };

// === Output Lock System ===

let outputTimer = null;
let lastOutput = "Nichts erkannt"; // letzter Wert

// === Globale Variablen für Danke-Geste ===
let dankeFingerStateLeft  = { inProgress: false, time: 0 };
let dankeFingerStateRight = { inProgress: false, time: 0 };

let gutStateLeft  = { inProgress: false, wentUp: false, startY: null, time: 0 };
let gutStateRight = { inProgress: false, wentUp: false, startY: null, time: 0 };




let bitteMove = {
    leftCount: 0,
    rightCount: 0,
    timeout: null
};

const BitteClapState = { active: false, claps: 0, wasClose: false, lastDist: 0, startTime: 0 };
const DankeStateLeft = { active: false, startZ: 0, time: 0 };
const DankeStateRight = { active: false, startZ: 0, time: 0 };
const LangsamerState = {
    active: false,
    upDone: false,
    downDone: false,
    startYLeft: 0,
    startYRight: 0,
    time: 0
};


let outputLock = false;
let outputTimeout = null;

function showOutputDelayed(outputDiv, newOutput) {

    // Wenn gerade eine Geste angezeigt wird → ignorieren, außer neuerOutput ist NICHT "Nichts erkannt"
    if (outputLock && newOutput === "Nichts erkannt") return;

    // Setze sofort den neuen Text
    outputDiv.innerText = newOutput;

    // Wenn "Nichts erkannt" → kein Lock setzen
    if (newOutput === "Nichts erkannt") return;

    // Lock setzen
    outputLock = true;

    // Falls bereits ein Timer läuft → stoppen
    if (outputTimeout) clearTimeout(outputTimeout);

    // Nach 1 Sekunde wieder freigeben
    outputTimeout = setTimeout(() => {
        outputLock = false;
    }, 1000);
}


// =====================
// Hände sortieren
// =====================
function detectHands(results) {
    const detected = { left: null, right: null };
    if (!results.multiHandLandmarks) return detected;

    for (let i = 0; i < results.multiHandLandmarks.length; i++) {
        const lm = results.multiHandLandmarks[i];
        const handed = results.multiHandedness[i].label; // "Left" oder "Right"

        if (handed === "Left") detected.left = lm;
        if (handed === "Right") detected.right = lm;
    }
    return detected;
}

///////////////////////////////////////////////////////////////////////////////////////////////////////////
// =====================
// Geste: Wie geht’s
// =====================
function WieGehts(hand, threshold = 0.02, threshold_mid_index = 0.005) {
    if (!hand) return false;

    const thumb = hand[4];
    const index = hand[8];
    const middle = hand[12];
    const base = hand[0];

    const dx = Math.abs(thumb.x - index.x);
    const dy = Math.abs(thumb.y - index.y);

    const dx2 = Math.abs(index.x - middle.x);
    const dy2 = Math.abs(index.y - middle.y);

    const fingers_up =
        middle.y < thumb.y &&
        middle.y < index.y &&
        middle.y < base.y;

    return (
        dx < threshold &&
        dy < threshold &&
        fingers_up &&
        dx2 > threshold_mid_index &&
        dy2 > threshold_mid_index
    );
}


///////////////////////////////////////////////////////////////////////////////////////////////////////////
// =====================
// Ich
// =====================
function Ich(hand) {
    if (!hand) return false;
    
    // Zeigefinger tip höher als PIP/MCP, rest Finger unten
    const indexUp = hand[8].y < hand[6].y && hand[8].y < hand[7].y;
    const middleDown = hand[12].y > hand[10].y;
    const ringDown = hand[16].y > hand[14].y;
    const pinkyDown = hand[20].y > hand[18].y;

    const thumbRight = hand[4].x < hand[13].x


    return indexUp && middleDown && ringDown && pinkyDown && thumbRight;
}

///////////////////////////////////////////////////////////////////////////////////////////////////////////
// =====================
// DU
// =====================
function Du(hand, threshold = 0.08) {
    if (!hand) return false;

    const indexUp = hand[8].z < hand[6].z && hand[8].z < hand[7].z;
    const middleDown = hand[12].y > hand[10].y;
    const ringDown = hand[16].y > hand[14].y;
    const pinkyDown = hand[20].y > hand[18].y;
    const thumbRight = hand[4].x > hand[13].x

    const thumbLow = hand[4].y > hand[8].y;

    const dx = Math.abs(hand[5].x - hand[8].x);
    const dy = Math.abs(hand[5].y - hand[8].y);



    return indexUp && middleDown && ringDown && pinkyDown && thumbRight && dx < threshold && dy < threshold && thumbLow;

}




///////////////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////////////
// =====================
// Bewegungen tracken
// =====================
function trackMotion(hand, history) {
    if (!hand) return;
    const idx = hand[8];
    history.push({ x: idx.x, y: idx.y });

    if (history.length > MAX_HISTORY) history.shift();
}

function movedLeft(history, minDist = 0.1) {
    if (history.length < 2) return false;
    return (history[history.length - 1].x - history[0].x) < -minDist; // nach links
}

function movedRight(history, minDist = 0.1) {
    if (history.length < 2) return false;
    return (history[history.length - 1].x - history[0].x) > minDist;  // nach rechts
}


///////////////////////////////////////////////////////////////////////////////////////////////////////////
// =====================
// WieGehts + Bewegung
// =====================
function WieGehtsBewegung(hand, history) {
    return WieGehts(hand) && (movedLeft(history) || movedRight(history));
}



///////////////////////////////////////////////////////////////////////////////////////////////////////////
// =====================
// Hallo: offene Hand + Winken
// =====================
function isHandOpen(hand) {
    if (!hand) return false;


    function fingerUp(tip, mcp) {
        return hand[tip].y < hand[mcp].y;
    }

    return (
        fingerUp(8, 7) &&
        fingerUp(12, 11) &&
        fingerUp(16, 15) &&
        fingerUp(20, 19)
    );
}

function waving(history) {
    if (history.length < MAX_HISTORY) return false;

    const xs = history.map(p => p.x);
    const first = xs[0];
    const mid = xs[Math.floor(xs.length / 2)];
    const last = xs[xs.length - 1];

    const movedEnough =
        Math.abs(mid - first) > 0.1 &&
        Math.abs(last - mid) > 0.1;

    const changedDirection =
        (first < mid && mid > last) ||
        (first > mid && mid < last);

    return movedEnough && changedDirection;
}

function Hallo(hand, history) {
    return isHandOpen(hand) && waving(history);
}





///////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////GUT NEU
function Gut(hand) {
    if (!hand) return false;

    const fingertips = hand[8] && hand[12] && hand[16] && hand[20];
    const thumbUp = hand[4].y < fingertips.y 
    const thumbUp2 = hand[4].y < hand[3];
    const thumbRight = hand[4].x < hand[6].x;


    return thumbUp && thumbUp2 && thumbRight;

}



// =====================
// Gut
// =====================
function Gut_Handbewegung(hand, state) {
    if (!hand) return false;

    const now = performance.now();
    const wristY = hand[0].y;
    const thumbTip = hand[4].y;

    // === Anfang: State starten ===
    if (!state.inProgress) {
        state.startY = wristY;
        state.inProgress = true;
        state.wentUp = false;
        state.time = now;
        return false;
    }

    // Timeout: Geste muss innerhalb 1,2 Sekunden erfolgen
    if (now - state.time > 1200) {
        state.inProgress = false;
        return false;
    }

    // === Step 1: Hand hoch → y kleiner als Start ===
    if (!state.wentUp) {
        if (thumbTip < state.startY - 0.001) { // Hand nach oben bewegt (5% Bildhöhe)
            state.wentUp = true;
        }
        return false;
    }

    // === Step 2: Hand wieder runter → y größer als Start ===
    if (state.wentUp) {
        if (thumbTip > state.startY + 0.001) { // Hand nach unten bewegt (5% Bildhöhe)
            state.inProgress = false; // Geste abgeschlossen
            return true;
        }
    }

    return false;
}


///////////////////////////////////////////////////////////////////////////////////////////////////////////
// =====================
// Schlecht
// =====================

// Statische Pose: Faust + Daumen außen (robust)
function Schlecht(hand, handLabel) {
    if (!hand) return false;

    // Faust: alle Finger außer Daumen nach unten
    const fingersDown =
        hand[8].y > hand[6].y &&
        hand[12].y > hand[10].y &&
        hand[16].y > hand[14].y &&
        hand[20].y > hand[18].y;

    const thumbTip = hand[4];
    const indexMCP = hand[5]; // stabiler Referenzpunkt
    const margin = 0.03; // Toleranz

    let thumbSide = false;

    if (handLabel === "Left") {
        // Linker Daumen soll nach rechts (thumb.x > indexMCP.x)
        thumbSide = (thumbTip.x - indexMCP.x) > margin;
    } else if (handLabel === "Right") {
        // Rechter Daumen soll nach links (thumb.x < indexMCP.x)
        thumbSide = (indexMCP.x - thumbTip.x) > margin;
    }

    return fingersDown && thumbSide;
}

///////////////////////////////////////////////////////////////////////////////////////////////////////////
// Bewegung: für Schlecht-Recognition
// Linke Hand: muss nach rechts bewegen (last - first > minDist)
function movedSchlechtLeft(history, minDist = 0.07) {
    if (!history || history.length < 2) return false;
    const first = history[0].x;
    const last = history[history.length - 1].x;
    return (last - first) > minDist; // nach rechts
}

// Rechte Hand: muss nach links bewegen (first - last > minDist)
function movedSchlechtRight(history, minDist = 0.07) {
    if (!history || history.length < 2) return false;
    const first = history[0].x;
    const last = history[history.length - 1].x;
    return (first - last) > minDist; // nach links
}

// Gesamter Check: Pose + korrekte Richtung (HandLabel: "Left"|"Right")
function SchlechtMitBewegung(hand, handLabel, history) {
    if (!hand) return false;

    if (!Schlecht(hand, handLabel)) return false;

    if (handLabel === "Left") return movedSchlechtLeft(history);
    if (handLabel === "Right") return movedSchlechtRight(history);

    return false;
}




///////////////////////////////////////////////////////////////////////////////////////////////////////////
// =====================
// ABEND (2 Hände)
// =====================
// isHandOpen aber links muss daumen links sein rechts muss daumen rechts sein
// DaumenTip muss am schluss über allem anderen sein
// neue bewegungsfunktion für "Hand dreht links/rechts???"
// 12 muss bei rechts kleineres x und y haben, bei links grösseres x und kleineres y 
function Abend(leftHand, rightHand) {
    if (!leftHand || !rightHand) return false;

    const leftOpenTurned =
      isHandOpen(leftHand) &&
      leftHand[4].x < leftHand[8].x 

    const rightOpenTurned =
      isHandOpen(rightHand) &&
      rightHand[4].x > rightHand[8].x 

    
    return leftOpenTurned && rightOpenTurned
}

function Abend(leftHand, rightHand, leftHistory, rightHistory) {
    if (!leftHand || !rightHand) return false;

    return movedToAbendLeft(leftHistory) && movedToAbendRight(rightHistory);
}



///////////////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////////////
function trackAbendMotion(hand, history) {
    if (!hand) return;
    const thumb = hand[4];
    const index = hand[8];
    history.push({ thumbX: thumb.x, thumbY: thumb.y, indexX: index.x, indexY: index.y });
    if (history.length > MAX_ABEND_HISTORY) history.shift();
}


function movedToAbendLeft(history) {
    if (history.length < 2) return false;

    const first = history[0];
    const last = history[history.length - 1];

    // Daumen bleibt oben, Finger nach unten + nach außen
    const thumbUp = last.thumbY < last.indexY;
    const movedDownLeft = last.indexY > first.indexY && last.indexX > first.indexX;

    return thumbUp && movedDownLeft;
}


function movedToAbendRight(history) {
    if (history.length < 2) return false;

    const first = history[0];
    const last = history[history.length - 1];

    const thumbUp = last.thumbY < last.indexY;
    const movedDownRight = last.indexY > first.indexY && last.indexX < first.indexX;

    return thumbUp && movedDownRight;
}


///////////////////////////////////////////////////////////////////////////////////////////////////////////
// =====================
// GUTEN (2 Hände nötig)
// =====================
function Guten(leftHand, rightHand, leftHistory, rightHistory) {
    if (!leftHand || !rightHand) return false;

    const leftGood =
        WieGehts(leftHand) &&
        movedLeft(leftHistory);

    const rightGood =
        WieGehts(rightHand) &&
        movedRight(rightHistory);

    return leftGood && rightGood;
}





///////////////////////////////////////////////////////////////////////////////////////////////////////////
// =====================
// BITTE – Zwei Klatscher
// =====================
function Bitte_ClapTwice(left, right, state = BitteClapState) {
    if (!left || !right) return false;

    const now = performance.now();

    // Abstand der Handflächen
    const dx = left[0].x - right[0].x;
    const dy = left[0].y - right[0].y;
    const distance = Math.sqrt(dx*dx + dy*dy);

    // Init
    if (!state.active) {
        state.active = true;
        state.claps = 0;
        state.lastDist = distance;
        state.startTime = now;
        return false;
    }

    // Timeout 1s
    if (now - state.startTime > 1000) {
        state.active = false;
        return false;
    }

    // Clap detected when distance becomes very small
    const closeEnough = distance < 0.05;

    // Detect rising edge: going from open → closed
    if (!state.wasClose && closeEnough) {
        state.claps++;
    }

    state.wasClose = closeEnough;

    // Two claps = gesture done
    if (state.claps >= 2) {
        state.active = false;
        return true;
    }

    return false;
}






///////////////////////////////////////////////////////////////////////////////////////////////////////////

function detectCircleMovement(hand, circleState) {
    if (!hand) return false;

    const now = performance.now();
    const pt = hand[8];  // Zeigefinger-Spitze

    // ersten Frame setzen
    if (circleState.prevX === null) {
        circleState.prevX = pt.x;
        circleState.prevY = pt.y;
        circleState.time = now;
        return false;
    }

    // Bewegung seit letzten Frame
    const dx = pt.x - circleState.prevX;
    const dy = pt.y - circleState.prevY;

    // neue Richtung bestimmen
    const newDirX = Math.sign(dx);
    const newDirY = Math.sign(dy);

    // Richtungswechsel zählen
    if (newDirX !== 0 && newDirX !== circleState.dirX) {
        circleState.changes++;
        circleState.dirX = newDirX;
    }

    if (newDirY !== 0 && newDirY !== circleState.dirY) {
        circleState.changes++;
        circleState.dirY = newDirY;
    }

    // Werte updaten
    circleState.prevX = pt.x;
    circleState.prevY = pt.y;

    // Timeout → Reset
    if (now - circleState.time > 1200) {
        circleState.changes = 0;
        circleState.time = now;
    }

    // Circle = mindestens 4 Richtungswechsel
    if (circleState.changes >= 4) {
        circleState.changes = 0; // reset
        return true;
    }

    return false;
}


function Nochmal_2Hands(leftHand, rightHand) {

    const leftCircle  = detectCircleMovement(leftHand, circleLeft);
    const rightCircle = detectCircleMovement(rightHand, circleRight);

    // Beide müssen ungefähr gleichzeitig einen Kreis machen
    if (leftCircle && rightCircle) {
        return true;
    }

    return false;
}






///////////////////////////////////////////////////////////////////////////////////////////////////////////
// =====================
// DANKE – Vorwärtsbewegung
// =====================
function Danke_ZMovement(hand, state = DankeState) {
    if (!hand) return false;

    const now = performance.now();
    const z = hand[0].z; // Wrist depth

    if (!state.active) {
        state.active = true;
        state.startZ = z;
        state.time = now;
        return false;
    }

    // Timeout 1.2s
    if (now - state.time > 1200) {
        state.active = false;
        return false;
    }

    // Significant forward movement: z becomes much smaller
    if (z < state.startZ - 0.05) {
        state.active = false;
        return true;
    }

    return false;
}




function Danke(hand) {
    if (!hand) return false;

    const thumbRight = hand[4].x > hand[8];

    if (isHandOpen && thumbRight) {
        return true;} 


}



///////////////////////////////////////////////////////////////////////////////////////////////////////////
// =====================
// LANGSAMER – Zwei Hände wippen synchron
// =====================
function Langsamer_2Hands(left, right, state = LangsamerState) {
    if (!left || !right) return false;

    const now = performance.now();
    const leftY = left[0].y;
    const rightY = right[0].y;

    // Init
    if (!state.active) {
        state.active = true;
        state.upDone = false;
        state.downDone = false;
        state.startYLeft = leftY;
        state.startYRight = rightY;
        state.time = now;
        return false;
    }

    // Timeout
    if (now - state.time > 1500) {
        state.active = false;
        return false;
    }

    // Step 1 → both hands move UP a little
    if (!state.upDone) {
        if (leftY < state.startYLeft - 0.02 &&
            rightY < state.startYRight - 0.02) {
            state.upDone = true;
        }
        return false;
    }

    // Step 2 → both hands move DOWN past original level
    if (!state.downDone) {
        if (leftY > state.startYLeft + 0.02 &&
            rightY > state.startYRight + 0.02) {
            state.downDone = true;
            state.active = false;
            return true;
        }
        return false;
    }

    return false;
}


///////////////////////////////////////////////////////////////////////////////////////////////////////////
function Closed(hand, threshold_X = 0.05, threshold_Y = 0.05) {
    if(!hand) return false; 
    
    const dx = Math.abs(hand[4].x - hand[8].x);
    const dy = Math.abs(hand[4].y - hand[8].y);

    const dx2 = Math.abs(hand[8].x - hand[12].x);
    const dy2 = Math.abs(hand[8].y - hand[12].y);

    const dx3 = Math.abs(hand[12].x - hand[16].x);
    const dy3 = Math.abs(hand[12].y - hand[16].y);

    const dx4 = Math.abs(hand[12].x - hand[20].x);
    const dy4 = Math.abs(hand[12].y - hand[20].y);


    return dx < threshold_X && dy < threshold_Y && dx2 < threshold_X && dy2 < threshold_Y && dx3 < threshold_X && dy3 < threshold_Y && dx4 < threshold_X && dy4 < threshold_Y;

}



function Verstanden(hand) {
    const now = Date.now();
    let pose = null;

    if (isHandOpen(hand)) pose = "open";
    else if (Closed(hand)) pose = "closed";

    if (pose) {
        handSequence.push({ pose, time: now });

        // Alte Einträge rauswerfen
        handSequence = handSequence.filter(entry => now - entry.time <= sequenceTimeLimit);
    }

    // Prüfen, ob die Sequenz „open → closed“ vorkommt
    for (let i = 0; i < handSequence.length - 1; i++) {
        if (handSequence[i].pose === "open" && handSequence[i + 1].pose === "closed") {
            handSequence = []; // zurücksetzen, sobald erkannt
            return true; // "Verstanden" erkannt
        }
    }

    return false; // Sequenz noch nicht komplett
}


///////////////////////////////////////////////////////////////////////////////////////////////////////////
function NoNo(hand) {
    if (!hand) return false;

    const indexUp = hand[8].z < hand[6].z && hand[8].z < hand[7].z;
    const middleDown = hand[12].y > hand[10].y;
    const ringDown = hand[16].y > hand[14].y;
    const pinkyDown = hand[20].y > hand[18].y;
    const thumbRight = hand[4].x > hand[13].x

    const thumbLow = hand[8].y < hand[4].y;



    return indexUp && middleDown && ringDown && pinkyDown && thumbRight && thumbLow;
}





function Nicht(hand, history) {
    return NoNo(hand) && (movedLeft(history) || movedRight(history));
}


///////////////////////////////////////////////////////////////////////////////////////////////////////////
function Lieber(hand){
    if (!hand) return false;




}




















let cameraRunning = false;

// =====================
// Kamera starten
// =====================
function startCameraProperly() {
    if (cameraRunning) return;
    cameraRunning = true;

    const video = document.getElementById("video");

    navigator.mediaDevices.getUserMedia({
        video: {
            width: { ideal: 1280 },  // 4:3 max native Auflösung Frontkamera
            height: { ideal: 960 },
            facingMode: "user"
        },
        audio: false
    }).then(stream => {
        video.srcObject = stream;

        const camera = new Camera(video, {
            onFrame: async () => {
                await hands.send({ image: video });
            },
            width: 1280,
            height: 960
        });

        camera.start();
    }).catch(err => {
        console.error("Fehler beim Zugriff auf die Kamera:", err);
    });
}


// =====================
// MediaPipe Callback
// =====================
hands.onResults((results) => {
    const canvas = document.getElementById("canvas");
    const ctx = canvas.getContext("2d");
    const outputDiv = document.getElementById("output");

    // Canvas leeren und Video-Frame zeichnen
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

    const detected = detectHands(results);

    // Bewegung erfassen
    trackMotion(detected.left, motionLeft);
    trackMotion(detected.right, motionRight);
    trackAbendMotion(detected.left, abendLeftHistory);
    trackAbendMotion(detected.right, abendRightHistory);

    let output = "Nichts erkannt";

    // === Handanzahl bestimmen ===
    const handCount = (detected.left ? 1 : 0) + (detected.right ? 1 : 0);

    // === WIE GEHT’S & HALLO nur bei 1 Hand ===
    if (handCount === 1) {
        if (detected.left && WieGehts(detected.left) && movedLeft(motionLeft)) {
        output = "Wie geht's erkannt!";
}
        if (detected.right && WieGehts(detected.right) && movedRight(motionRight)) {
        output = "Wie geht's erkannt!";
}
        if (detected.left && Nicht(detected.left, motionLeft) && movedLeft(motionLeft)) output = "NICHT erkannt!";
        if (detected.right && Nicht(detected.right, motionRight) && movedRight(motionRight)) output = "NICHT erkannt!";
        if (detected.left && NoNo(detected.left, motionLeft)) output = "NoNo erkannt!";
        if (detected.right && NoNo(detected.right, motionRight)) output = "NoNo erkannt!";



        if (detected.left && Hallo(detected.left, motionLeft)) output = "Hallo erkannt!";
        if (detected.right && Hallo(detected.right, motionRight)) output = "Hallo erkannt!";

        //if (detected.left && Closed(detected.left)) output = "closed erkannt!";
        //if (detected.right && Closed(detected.right)) output = "closed erkannt!";
        if (detected.left && Verstanden(detected.left)) output = "Verstanden erkannt!";
        if (detected.right && Verstanden(detected.right)) output = "Verstanden erkannt!";


        if (detected.left && Ich(detected.left)) output = "Ich erkannt!";
        if (detected.right && Ich(detected.right)) output = "Ich erkannt!";
        if (detected.left && Du(detected.left)) output = "Du erkannt!";
        if (detected.right && Du(detected.right)) output = "Du erkannt!";

        if (detected.left && Danke(detected.left)) output = "Danke erkannt!";
        if (detected.right && Danke(detected.right)) output = "Danke erkannt!";

        //if (Gut_Handbewegung(detected.left, gutStateLeft)) output = "Gut erkannt!";
        //if (Gut_Handbewegung(detected.right, gutStateRight)) output = "Gut erkannt!";
        //if (detected.right && Gut(detected.right)) output = "GUT erkannt"
        //if (detected.left && Gut(detected.left)) output = "GUT erkannt"
        if (detected.left && Gut(detected.left, motionLeft)) output = "GUUUT erkannt!";
        if (detected.right && Gut(detected.right, motionRight)) output = "GUUUT erkannt!";

        if (detected.left && SchlechtMitBewegung(detected.left, "Left", motionLeft)) output = "Schlecht erkannt!";
        if (detected.right && SchlechtMitBewegung(detected.right, "Right", motionRight)) output = "Schlecht erkannt!";
        
        
        
        //if (Danke_FingerGeste(detected.left, dankeFingerStateLeft)) output = "Danke erkannt!";
        //if (Danke_FingerGeste(detected.right, dankeFingerStateRight)) output = "Danke erkannt!";
        if (detected.left && Danke_ZMovement(detected.left, DankeStateLeft)) {
        output = "Danke erkannt!";
    }
        if (detected.right && Danke_ZMovement(detected.right, DankeStateRight)) {
        output = "Danke erkannt!";
    }
        
    }   

    // === GUTEN und ABEND nur bei 2 Händen ===
    if (handCount === 2) {
        if (Guten(detected.left, detected.right, motionLeft, motionRight)) output = "Guten erkannt!";
        if (Abend(detected.left, detected.right, abendLeftHistory, abendRightHistory)) output = "Abend erkannt!";
        
        if (Nochmal_2Hands(detected.left, detected.right)) output = "Nochmal erkannt!";

        if (Bitte_ClapTwice(detected.left, detected.right, BitteClapState)) {
        output = "Bitte erkannt!";
    }

        if (Langsamer_2Hands(detected.left, detected.right, LangsamerState)) {
        output = "Langsamer erkannt!";
    }
        
    }

    // Hände zeichnen
    if (results.multiHandLandmarks) {
        for (const lm of results.multiHandLandmarks) {
            drawConnectors(ctx, lm, HAND_CONNECTIONS, { color: "#00FF00", lineWidth: 2 });
            drawLandmarks(ctx, lm, { color: "#FF0000", lineWidth: 1 });
        }
    }

    // Output anzeigen
    if (outputDiv) showOutputDelayed(outputDiv, output);


});

// =====================
// Page-Switch
// =====================
window.addEventListener("DOMContentLoaded", () => {

    // =====================
    // Seite anzeigen
    // =====================
    function showPage(id) {
        document.querySelectorAll(".page").forEach(p => p.style.display = "none");
        document.getElementById(id).style.display = "block";

        const cameraPages = ["page8", "page10", "page12", "page14", "page16", "page19", "page21", "page23", "page25", "page27", "page29", "page31", "page33", "page35", "page37", "page39", "page41"]; // Seiten mit Kamera
        const cameraContainer = document.getElementById("cameraContainer");

        if (cameraPages.includes(id)) {
            cameraContainer.style.display = "block"; // Kamera anzeigen
            startCameraProperly();
        } else {
            cameraContainer.style.display = "none"; // Kamera verstecken
        }
    }

    // Beim Laden: Page1 anzeigen
    showPage("page1");

    // =====================
    // PAGE-WECHSEL
    // =====================
  
    // Page 1 → Page 2
    document.getElementById("gotoPage2").addEventListener("click", () => showPage("page2"));



//FACTS screens
    // Page 2 → Page 3
    document.getElementById("gotoPage3").addEventListener("click", () => showPage("page3"));

    // Page 3 → Page 4
    document.getElementById("gotoPage4").addEventListener("click", () => showPage("page4"));


//KAPITEL screen
    // Page 4 → Page 5
    document.getElementById("gotoPage5").addEventListener("click", () => showPage("page5"));


//SMALLTALK
    // Page 5 → Page 7
    document.getElementById("gotoPage7").addEventListener("click", () => showPage("page7"));

    // Page 7 → Page 8
    document.getElementById("gotoPage8").addEventListener("click", () => showPage("page8"));

    // Page 8 → Page 9
    document.getElementById("gotoPage9").addEventListener("click", () => showPage("page9"));

    // Page 8 → Page 5 (BACK TO KAPITEL)
    document.getElementById("gotoPage5_from8").addEventListener("click", () => showPage("page5"));

    // Page 9 → Page 10
    document.getElementById("gotoPage10").addEventListener("click", () => showPage("page10"));

    // Page 10 → Page 11
    document.getElementById("gotoPage11").addEventListener("click", () => showPage("page11"));

    // Page 10 → Page 5 (BACK TO KAPITEL)
    document.getElementById("gotoPage5_from10").addEventListener("click", () => showPage("page5"));

    // Page 11 → Page 12
    document.getElementById("gotoPage12").addEventListener("click", () => showPage("page12"));

    // Page 12 → Page 13
    document.getElementById("gotoPage13").addEventListener("click", () => showPage("page13"));

    // Page 12 → Page 5 (BACK TO KAPITEL)
    document.getElementById("gotoPage5_from12").addEventListener("click", () => showPage("page5"));

    // Page 13 → Page 14
    document.getElementById("gotoPage14").addEventListener("click", () => showPage("page14"));

    // Page 14 → Page 15
    document.getElementById("gotoPage15").addEventListener("click", () => showPage("page15"));

    // Page 14 → Page 5 (BACK TO KAPITEL)
    document.getElementById("gotoPage5_from14").addEventListener("click", () => showPage("page5"));

    // Page 15 → Page 16
    document.getElementById("gotoPage16").addEventListener("click", () => showPage("page16"));

    // Page 16 → Page 17
    document.getElementById("gotoPage17").addEventListener("click", () => showPage("page17"));

    // Page 17 → Page 18
    document.getElementById("gotoPage18").addEventListener("click", () => showPage("page18"));

    // Page 17 → Page 5 (BACK TO KAPITEL)
    document.getElementById("gotoPage5_from17").addEventListener("click", () => showPage("page5"));




    // Page 18 → Page 19
    document.getElementById("gotoPage19").addEventListener("click", () => showPage("page19"));

    // Page 19 → Page 20 etc. ...
    document.getElementById("gotoPage20").addEventListener("click", () => showPage("page20"));
    document.getElementById("gotoPage21").addEventListener("click", () => showPage("page21"));
    document.getElementById("gotoPage22").addEventListener("click", () => showPage("page22"));
    document.getElementById("gotoPage23").addEventListener("click", () => showPage("page23"));
    document.getElementById("gotoPage24").addEventListener("click", () => showPage("page24"));
    document.getElementById("gotoPage25").addEventListener("click", () => showPage("page25"));
    document.getElementById("gotoPage26").addEventListener("click", () => showPage("page26"));
    document.getElementById("gotoPage27").addEventListener("click", () => showPage("page27"));

    document.getElementById("gotoPage17_from27").addEventListener("click", () => showPage("page17"));
    document.getElementById("gotoPage5_from25").addEventListener("click", () => showPage("page5"));
    document.getElementById("gotoPage5_from23").addEventListener("click", () => showPage("page5"));
    document.getElementById("gotoPage5_from21").addEventListener("click", () => showPage("page5"));
    document.getElementById("gotoPage5_from19").addEventListener("click", () => showPage("page5"));






    // 
    document.getElementById("gotoPage28").addEventListener("click", () => showPage("page28"));
    document.getElementById("gotoPage29").addEventListener("click", () => showPage("page29"));
    document.getElementById("gotoPage30").addEventListener("click", () => showPage("page30"));
    document.getElementById("gotoPage31").addEventListener("click", () => showPage("page31"));
    document.getElementById("gotoPage32").addEventListener("click", () => showPage("page32"));
    document.getElementById("gotoPage33").addEventListener("click", () => showPage("page33"));
    document.getElementById("gotoPage34").addEventListener("click", () => showPage("page34"));
    document.getElementById("gotoPage35").addEventListener("click", () => showPage("page35"));
    document.getElementById("gotoPage36").addEventListener("click", () => showPage("page36"));
    document.getElementById("gotoPage37").addEventListener("click", () => showPage("page37"));

    document.getElementById("gotoPage17_from37").addEventListener("click", () => showPage("page17"));
    document.getElementById("gotoPage5_from35").addEventListener("click", () => showPage("page5"));
    document.getElementById("gotoPage5_from33").addEventListener("click", () => showPage("page5"));
    document.getElementById("gotoPage5_from31").addEventListener("click", () => showPage("page5"));
    document.getElementById("gotoPage5_from29").addEventListener("click", () => showPage("page5"));





    document.getElementById("gotoPage38").addEventListener("click", () => showPage("page38"));
    document.getElementById("gotoPage39").addEventListener("click", () => showPage("page39"));
    document.getElementById("gotoPage40").addEventListener("click", () => showPage("page40"));
    document.getElementById("gotoPage41").addEventListener("click", () => showPage("page41"));

    document.getElementById("gotoPage17_from41").addEventListener("click", () => showPage("page17"));
    document.getElementById("gotoPage5_from39").addEventListener("click", () => showPage("page5"));

    document.getElementById("gotoPage42").addEventListener("click", () => showPage("page42"));


    document.getElementById("gotoPage1").addEventListener("click", () => showPage("page1"));

    document.getElementById("gotoPage1_from2").addEventListener("click", () => showPage("page1"));
    document.getElementById("gotoPage2_from3").addEventListener("click", () => showPage("page2"));
    document.getElementById("gotoPage3_from4").addEventListener("click", () => showPage("page3"));





    //icons navigation
        //ICON 1: HAUS STARTPAGES
    document.getElementById("gotoPage1_from2_ICON").addEventListener("click", () => showPage("page1"));
    document.getElementById("gotoPage1_from3_ICON").addEventListener("click", () => showPage("page1"));
    document.getElementById("gotoPage1_from4_ICON").addEventListener("click", () => showPage("page1"));
    document.getElementById("gotoPage1_from5_ICON").addEventListener("click", () => showPage("page1"));
    
    document.getElementById("gotoPage1_from7_ICON").addEventListener("click", () => showPage("page1"));
    document.getElementById("gotoPage1_from8_ICON").addEventListener("click", () => showPage("page1"));
    document.getElementById("gotoPage1_from9_ICON").addEventListener("click", () => showPage("page1"));
    document.getElementById("gotoPage1_from10_ICON").addEventListener("click", () => showPage("page1"));
    document.getElementById("gotoPage1_from11_ICON").addEventListener("click", () => showPage("page1"));
    document.getElementById("gotoPage1_from12_ICON").addEventListener("click", () => showPage("page1"));
    document.getElementById("gotoPage1_from13_ICON").addEventListener("click", () => showPage("page1"));
    document.getElementById("gotoPage1_from14_ICON").addEventListener("click", () => showPage("page1"));
    document.getElementById("gotoPage1_from15_ICON").addEventListener("click", () => showPage("page1"));
    document.getElementById("gotoPage1_from16_ICON").addEventListener("click", () => showPage("page1"));
    document.getElementById("gotoPage1_from17_ICON").addEventListener("click", () => showPage("page1"));
    document.getElementById("gotoPage1_from18_ICON").addEventListener("click", () => showPage("page1"));
    document.getElementById("gotoPage1_from19_ICON").addEventListener("click", () => showPage("page1"));
    document.getElementById("gotoPage1_from20_ICON").addEventListener("click", () => showPage("page1"));
    document.getElementById("gotoPage1_from21_ICON").addEventListener("click", () => showPage("page1"));
    document.getElementById("gotoPage1_from22_ICON").addEventListener("click", () => showPage("page1"));
    document.getElementById("gotoPage1_from23_ICON").addEventListener("click", () => showPage("page1"));
    document.getElementById("gotoPage1_from24_ICON").addEventListener("click", () => showPage("page1"));
    document.getElementById("gotoPage1_from25_ICON").addEventListener("click", () => showPage("page1"));
    document.getElementById("gotoPage1_from26_ICON").addEventListener("click", () => showPage("page1"));
    document.getElementById("gotoPage1_from27_ICON").addEventListener("click", () => showPage("page1"));
    document.getElementById("gotoPage1_from28_ICON").addEventListener("click", () => showPage("page1"));
    document.getElementById("gotoPage1_from29_ICON").addEventListener("click", () => showPage("page1"));
    document.getElementById("gotoPage1_from30_ICON").addEventListener("click", () => showPage("page1"));
    document.getElementById("gotoPage1_from31_ICON").addEventListener("click", () => showPage("page1"));
    document.getElementById("gotoPage1_from32_ICON").addEventListener("click", () => showPage("page1"));
    document.getElementById("gotoPage1_from33_ICON").addEventListener("click", () => showPage("page1"));
    document.getElementById("gotoPage1_from34_ICON").addEventListener("click", () => showPage("page1"));
    document.getElementById("gotoPage1_from35_ICON").addEventListener("click", () => showPage("page1"));
    document.getElementById("gotoPage1_from36_ICON").addEventListener("click", () => showPage("page1"));
    document.getElementById("gotoPage1_from37_ICON").addEventListener("click", () => showPage("page1"));
    document.getElementById("gotoPage1_from38_ICON").addEventListener("click", () => showPage("page1"));
    document.getElementById("gotoPage1_from39_ICON").addEventListener("click", () => showPage("page1"));
    document.getElementById("gotoPage1_from40_ICON").addEventListener("click", () => showPage("page1"));
    document.getElementById("gotoPage1_from41_ICON").addEventListener("click", () => showPage("page1"));
    document.getElementById("gotoPage1_from42_ICON").addEventListener("click", () => showPage("page1"));
   
        //ICON 2 "HUT" FACTS
    document.getElementById("gotoPage3_from1_ICON").addEventListener("click", () => showPage("page3"));
    document.getElementById("gotoPage3_from2_ICON").addEventListener("click", () => showPage("page3"));
    
    document.getElementById("gotoPage3_from4_ICON").addEventListener("click", () => showPage("page3"));
    document.getElementById("gotoPage3_from5_ICON").addEventListener("click", () => showPage("page3"));
    
    document.getElementById("gotoPage3_from7_ICON").addEventListener("click", () => showPage("page3"));
    document.getElementById("gotoPage3_from8_ICON").addEventListener("click", () => showPage("page3"));
    document.getElementById("gotoPage3_from9_ICON").addEventListener("click", () => showPage("page3"));
    document.getElementById("gotoPage3_from10_ICON").addEventListener("click", () => showPage("page3"));
    document.getElementById("gotoPage3_from11_ICON").addEventListener("click", () => showPage("page3"));
    document.getElementById("gotoPage3_from12_ICON").addEventListener("click", () => showPage("page3"));
    document.getElementById("gotoPage3_from13_ICON").addEventListener("click", () => showPage("page3"));
    document.getElementById("gotoPage3_from14_ICON").addEventListener("click", () => showPage("page3"));
    document.getElementById("gotoPage3_from15_ICON").addEventListener("click", () => showPage("page3"));
    document.getElementById("gotoPage3_from16_ICON").addEventListener("click", () => showPage("page3"));
    document.getElementById("gotoPage3_from17_ICON").addEventListener("click", () => showPage("page3"));
    document.getElementById("gotoPage3_from18_ICON").addEventListener("click", () => showPage("page3"));
    document.getElementById("gotoPage3_from19_ICON").addEventListener("click", () => showPage("page3"));
    document.getElementById("gotoPage3_from20_ICON").addEventListener("click", () => showPage("page3"));
    document.getElementById("gotoPage3_from21_ICON").addEventListener("click", () => showPage("page3"));
    document.getElementById("gotoPage3_from22_ICON").addEventListener("click", () => showPage("page3"));
    document.getElementById("gotoPage3_from23_ICON").addEventListener("click", () => showPage("page3"));
    document.getElementById("gotoPage3_from24_ICON").addEventListener("click", () => showPage("page3"));
    document.getElementById("gotoPage3_from25_ICON").addEventListener("click", () => showPage("page3"));
    document.getElementById("gotoPage3_from26_ICON").addEventListener("click", () => showPage("page3"));
    document.getElementById("gotoPage3_from27_ICON").addEventListener("click", () => showPage("page3"));
    document.getElementById("gotoPage3_from28_ICON").addEventListener("click", () => showPage("page3"));
    document.getElementById("gotoPage3_from29_ICON").addEventListener("click", () => showPage("page3"));
    document.getElementById("gotoPage3_from30_ICON").addEventListener("click", () => showPage("page3"));
    document.getElementById("gotoPage3_from31_ICON").addEventListener("click", () => showPage("page3"));
    document.getElementById("gotoPage3_from32_ICON").addEventListener("click", () => showPage("page3"));
    document.getElementById("gotoPage3_from33_ICON").addEventListener("click", () => showPage("page3"));
    document.getElementById("gotoPage3_from34_ICON").addEventListener("click", () => showPage("page3"));
    document.getElementById("gotoPage3_from35_ICON").addEventListener("click", () => showPage("page3"));
    document.getElementById("gotoPage3_from36_ICON").addEventListener("click", () => showPage("page3"));
    document.getElementById("gotoPage3_from37_ICON").addEventListener("click", () => showPage("page3"));
    document.getElementById("gotoPage3_from38_ICON").addEventListener("click", () => showPage("page3"));
    document.getElementById("gotoPage3_from39_ICON").addEventListener("click", () => showPage("page3"));
    document.getElementById("gotoPage3_from40_ICON").addEventListener("click", () => showPage("page3"));
    document.getElementById("gotoPage3_from41_ICON").addEventListener("click", () => showPage("page3"));
    document.getElementById("gotoPage3_from42_ICON").addEventListener("click", () => showPage("page3"));
   
        //ICON 3 NOTIZ KAPITEL
    document.getElementById("gotoPage5_from1_ICON").addEventListener("click", () => showPage("page5"));
    document.getElementById("gotoPage5_from2_ICON").addEventListener("click", () => showPage("page5"));
    document.getElementById("gotoPage5_from3_ICON").addEventListener("click", () => showPage("page5"));
    document.getElementById("gotoPage5_from4_ICON").addEventListener("click", () => showPage("page5"));
    
    
    document.getElementById("gotoPage5_from7_ICON").addEventListener("click", () => showPage("page5"));
    document.getElementById("gotoPage5_from8_ICON").addEventListener("click", () => showPage("page5"));
    document.getElementById("gotoPage5_from9_ICON").addEventListener("click", () => showPage("page5"));
    document.getElementById("gotoPage5_from10_ICON").addEventListener("click", () => showPage("page5"));
    document.getElementById("gotoPage5_from11_ICON").addEventListener("click", () => showPage("page5"));
    document.getElementById("gotoPage5_from12_ICON").addEventListener("click", () => showPage("page5"));
    document.getElementById("gotoPage5_from13_ICON").addEventListener("click", () => showPage("page5"));
    document.getElementById("gotoPage5_from14_ICON").addEventListener("click", () => showPage("page5"));
    document.getElementById("gotoPage5_from15_ICON").addEventListener("click", () => showPage("page5"));
    document.getElementById("gotoPage5_from16_ICON").addEventListener("click", () => showPage("page5"));
    document.getElementById("gotoPage5_from17_ICON").addEventListener("click", () => showPage("page5"));
    document.getElementById("gotoPage5_from18_ICON").addEventListener("click", () => showPage("page5"));
    document.getElementById("gotoPage5_from19_ICON").addEventListener("click", () => showPage("page5"));
    document.getElementById("gotoPage5_from20_ICON").addEventListener("click", () => showPage("page5"));
    document.getElementById("gotoPage5_from21_ICON").addEventListener("click", () => showPage("page5"));
    document.getElementById("gotoPage5_from22_ICON").addEventListener("click", () => showPage("page5"));
    document.getElementById("gotoPage5_from23_ICON").addEventListener("click", () => showPage("page5"));
    document.getElementById("gotoPage5_from24_ICON").addEventListener("click", () => showPage("page5"));
    document.getElementById("gotoPage5_from25_ICON").addEventListener("click", () => showPage("page5"));
    document.getElementById("gotoPage5_from26_ICON").addEventListener("click", () => showPage("page5"));
    document.getElementById("gotoPage5_from27_ICON").addEventListener("click", () => showPage("page5"));
    document.getElementById("gotoPage5_from28_ICON").addEventListener("click", () => showPage("page5"));
    document.getElementById("gotoPage5_from29_ICON").addEventListener("click", () => showPage("page5"));
    document.getElementById("gotoPage5_from30_ICON").addEventListener("click", () => showPage("page5"));
    document.getElementById("gotoPage5_from31_ICON").addEventListener("click", () => showPage("page5"));
    document.getElementById("gotoPage5_from32_ICON").addEventListener("click", () => showPage("page5"));
    document.getElementById("gotoPage5_from33_ICON").addEventListener("click", () => showPage("page5"));
    document.getElementById("gotoPage5_from34_ICON").addEventListener("click", () => showPage("page5"));
    document.getElementById("gotoPage5_from35_ICON").addEventListener("click", () => showPage("page5"));
    document.getElementById("gotoPage5_from36_ICON").addEventListener("click", () => showPage("page5"));
    document.getElementById("gotoPage5_from37_ICON").addEventListener("click", () => showPage("page5"));
    document.getElementById("gotoPage5_from38_ICON").addEventListener("click", () => showPage("page5"));
    document.getElementById("gotoPage5_from39_ICON").addEventListener("click", () => showPage("page5"));
    document.getElementById("gotoPage5_from40_ICON").addEventListener("click", () => showPage("page5"));
    document.getElementById("gotoPage5_from41_ICON").addEventListener("click", () => showPage("page5"));
    document.getElementById("gotoPage5_from42_ICON").addEventListener("click", () => showPage("page5"));



        //ICON 4 "HAND" ENDSCREEN
    document.getElementById("gotoPage42_from1_ICON").addEventListener("click", () => showPage("page42"));
    document.getElementById("gotoPage42_from2_ICON").addEventListener("click", () => showPage("page42"));
    document.getElementById("gotoPage42_from3_ICON").addEventListener("click", () => showPage("page42"));
    document.getElementById("gotoPage42_from4_ICON").addEventListener("click", () => showPage("page42"));
    document.getElementById("gotoPage42_from5_ICON").addEventListener("click", () => showPage("page42"));
    
    document.getElementById("gotoPage42_from7_ICON").addEventListener("click", () => showPage("page42"));
    document.getElementById("gotoPage42_from8_ICON").addEventListener("click", () => showPage("page42"));
    document.getElementById("gotoPage42_from9_ICON").addEventListener("click", () => showPage("page42"));
    document.getElementById("gotoPage42_from10_ICON").addEventListener("click", () => showPage("page42"));
    document.getElementById("gotoPage42_from11_ICON").addEventListener("click", () => showPage("page42"));
    document.getElementById("gotoPage42_from12_ICON").addEventListener("click", () => showPage("page42"));
    document.getElementById("gotoPage42_from13_ICON").addEventListener("click", () => showPage("page42"));
    document.getElementById("gotoPage42_from14_ICON").addEventListener("click", () => showPage("page42"));
    document.getElementById("gotoPage42_from15_ICON").addEventListener("click", () => showPage("page42"));
    document.getElementById("gotoPage42_from16_ICON").addEventListener("click", () => showPage("page42"));
    document.getElementById("gotoPage42_from17_ICON").addEventListener("click", () => showPage("page42"));
    document.getElementById("gotoPage42_from18_ICON").addEventListener("click", () => showPage("page42"));
    document.getElementById("gotoPage42_from19_ICON").addEventListener("click", () => showPage("page42"));
    document.getElementById("gotoPage42_from20_ICON").addEventListener("click", () => showPage("page42"));
    document.getElementById("gotoPage42_from21_ICON").addEventListener("click", () => showPage("page42"));
    document.getElementById("gotoPage42_from22_ICON").addEventListener("click", () => showPage("page42"));
    document.getElementById("gotoPage42_from23_ICON").addEventListener("click", () => showPage("page42"));
    document.getElementById("gotoPage42_from24_ICON").addEventListener("click", () => showPage("page42"));
    document.getElementById("gotoPage42_from25_ICON").addEventListener("click", () => showPage("page42"));
    document.getElementById("gotoPage42_from26_ICON").addEventListener("click", () => showPage("page42"));
    document.getElementById("gotoPage42_from27_ICON").addEventListener("click", () => showPage("page42"));
    document.getElementById("gotoPage42_from28_ICON").addEventListener("click", () => showPage("page42"));
    document.getElementById("gotoPage42_from29_ICON").addEventListener("click", () => showPage("page42"));
    document.getElementById("gotoPage42_from30_ICON").addEventListener("click", () => showPage("page42"));
    document.getElementById("gotoPage42_from31_ICON").addEventListener("click", () => showPage("page42"));
    document.getElementById("gotoPage42_from32_ICON").addEventListener("click", () => showPage("page42"));
    document.getElementById("gotoPage42_from33_ICON").addEventListener("click", () => showPage("page42"));
    document.getElementById("gotoPage42_from34_ICON").addEventListener("click", () => showPage("page42"));
    document.getElementById("gotoPage42_from35_ICON").addEventListener("click", () => showPage("page42"));
    document.getElementById("gotoPage42_from36_ICON").addEventListener("click", () => showPage("page42"));
    document.getElementById("gotoPage42_from37_ICON").addEventListener("click", () => showPage("page42"));
    document.getElementById("gotoPage42_from38_ICON").addEventListener("click", () => showPage("page42"));
    document.getElementById("gotoPage42_from39_ICON").addEventListener("click", () => showPage("page42"));
    document.getElementById("gotoPage42_from40_ICON").addEventListener("click", () => showPage("page42"));
    document.getElementById("gotoPage42_from41_ICON").addEventListener("click", () => showPage("page42"));

     
    

});

