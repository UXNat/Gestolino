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

// =====================
// Geste: Wie geht’s
// =====================
function WieGehts(hand, threshold = 0.05, threshold_mid_index = 0.005) {
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


// =====================
// WieGehts + Bewegung
// =====================
function WieGehtsBewegung(hand, history) {
    return WieGehts(hand) && (movedLeft(history) || movedRight(history));
}

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
        Math.abs(mid - first) > 0.05 &&
        Math.abs(last - mid) > 0.05;

    const changedDirection =
        (first < mid && mid > last) ||
        (first > mid && mid < last);

    return movedEnough && changedDirection;
}

function Hallo(hand, history) {
    return isHandOpen(hand) && waving(history);
}


// =====================
// und DU? 
// =====================
function Du(hand) {
    if (!hand) return false;

    // Zeigefinger tip höher als PIP/MCP, rest Finger unten
    const indexUp = hand[8].y < hand[6].y && hand[8].y < hand[7].y;
    const middleDown = hand[12].y > hand[10].y;
    const ringDown = hand[16].y > hand[14].y;
    const pinkyDown = hand[20].y > hand[18].y;

    return indexUp && middleDown && ringDown && pinkyDown;
}


// =====================
// Gut
// =====================
function Gut(hand) {
    if (!hand) return false;

     // Daumen nach oben
    const thumbUp = hand[4].y < hand[3].y && hand[4].y < hand[2].y;

    // Zeigefinger tip höher als PIP/MCP, rest Finger unten
    const indexDown = hand[8].y > hand[6].y;
    const middleDown = hand[12].y > hand[10].y;
    const ringDown = hand[16].y > hand[14].y;
    const pinkyDown = hand[20].y > hand[18].y;

    return thumbUp && indexDown && middleDown && ringDown && pinkyDown;
}



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















let cameraRunning = false;

// =====================
// Kamera starten
// =====================
function startCameraProperly() {
    if (cameraRunning) return;
    cameraRunning = true;

    const video = document.getElementById("video");
    const camera = new Camera(video, {
        onFrame: async () => {
            await hands.send({ image: video });
        },
        width: 640,
        height: 480
    });
    camera.start();
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
        if (detected.left && WieGehtsBewegung(detected.left, motionLeft)) output = "Wie geht's erkannt!";
        if (detected.right && WieGehtsBewegung(detected.right, motionRight)) output = "Wie geht's erkannt!";
        if (detected.left && Hallo(detected.left, motionLeft)) output = "Hallo erkannt!";
        if (detected.right && Hallo(detected.right, motionRight)) output = "Hallo erkannt!";
        if (detected.left && Du(detected.left)) output = "Du erkannt!";
        if (detected.right && Du(detected.right)) output = "Du erkannt!";
        if (detected.left && Gut(detected.left)) output = "Gut erkannt!";
        if (detected.right && Gut(detected.right)) output = "Gut erkannt!";
        if (detected.left && SchlechtMitBewegung(detected.left, "Left", motionLeft)) output = "Schlecht erkannt!";
        if (detected.right && SchlechtMitBewegung(detected.right, "Right", motionRight)) output = "Schlecht erkannt!";
    }

    // === GUTEN und ABEND nur bei 2 Händen ===
    if (handCount === 2) {
        if (Guten(detected.left, detected.right, motionLeft, motionRight)) output = "Guten erkannt!";
        if (Abend(detected.left, detected.right, abendLeftHistory, abendRightHistory)) output = "Abend erkannt!";
    }

    // Hände zeichnen
    if (results.multiHandLandmarks) {
        for (const lm of results.multiHandLandmarks) {
            drawConnectors(ctx, lm, HAND_CONNECTIONS, { color: "#00FF00", lineWidth: 2 });
            drawLandmarks(ctx, lm, { color: "#FF0000", lineWidth: 1 });
        }
    }

    // Output anzeigen
    if (outputDiv) outputDiv.innerText = output;
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

        const cameraPages = ["page3", "page8"]; // Seiten mit Kamera
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






    // kapitel 3
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
});

