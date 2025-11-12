// p5.js interface to Google MediaPipe Landmark Tracking
// Combines face, hands, and bodies into one tracker.
// See https://mediapipe-studio.webapps.google.com/home
// Uses p5.js v.1.11.11 + MediaPipe v.0.10.22-rc.20250304
// By Golan Levin, revised as of 10/21/2025
//
// This app demonstrates how to access:
// - face points (e.g. clown nose)
// - hand points (e.g. thumb plum)
// - face metrics (e.g. jaw openness)
// - body pose

//----------------------------------------------------
// MediaPipe globals (don't change names)
let handLandmarks;
let poseLandmarks;
let faceLandmarks;
let myCapture;

let travelers = [];
let prevTipSamples = {};

let Engine = Matter.Engine;
let World = Matter.World;
let Bodies = Matter.Bodies;
let engine;
let world;

let right_waypoints = [[]];
let left_waypoints = [[]];
let mouth_waypoints = [[]];
let left_knee_waypoints = [[]];
let right_knee_waypoints = [[]];

//----------------------------------------------------
let trackingConfig = {
  doAcquireHandLandmarks: true,
  doAcquirePoseLandmarks: true,
  doAcquireFaceLandmarks: false,
  doAcquireFaceMetrics: false,
  poseModelLiteOrFull: "lite",
  cpuOrGpuString: "GPU",
  maxNumHands: 2,
  maxNumPoses: 1,
  maxNumFaces: 1,
};

//------------------------------------------
async function preload() {
  preloadTracker();
}

//------------------------------------------
function setup() {
  createCanvas(640 * 1.5, 480 * 1.5);

  myCapture = createCapture(VIDEO);
  myCapture.size(80, 60);
  myCapture.hide();

  initiateTracking();

  engine = Engine.create();
  world = engine.world;
  world.gravity.y = 0;

  // simple walls so circles don't fall off
  let wallOptions = {
    isStatic: true,
  };
  let floor = Bodies.rectangle(width / 2, height + 20, width, 40, wallOptions);
  let ceiling = Bodies.rectangle(width / 2, -20, width, 40, wallOptions);
  let leftWall = Bodies.rectangle(-20, height / 2, 40, height, wallOptions);
  let rightWall = Bodies.rectangle(
    width + 20,
    height / 2,
    40,
    height,
    wallOptions
  );
  // World.add(world, [floor, ceiling, leftWall, rightWall]);
}

//------------------------------------------
function draw() {
  background(0, 50);
  filter(BLUR, 1);

  // drawVideoBackground();

  // physics step
  Engine.update(engine);

  if (myCapture.loadedmetadata) myCapture.loadPixels();

  // spawn + draw
  emitTravelersFromHands();
  emitTravelersFromMouth();
  emitTravelersFromEyes();
  emitTravelersFromKnees();
  updateAndDrawTravelers();
  // drawDiagnosticInfo();
  // drawPoseP();

  // if (frameCount % 60 === 0) {
  //   console.log("n travelers:", travelers.length);
  // }
}

function updateWaypoints() {
  function toCanvas(pt) {
    return [map(pt.x, 0, 1, width, 0), map(pt.y, 0, 1, 0, height)];
  }

  if (trackingConfig.doAcquirePoseLandmarks) {
    if (poseLandmarks && poseLandmarks.landmarks) {
      const nPoses = poseLandmarks.landmarks.length;
      if (nPoses > 0) {
        for (let h = 0; h < nPoses; h++) {
          let p = poseLandmarks.landmarks[h];

          const L_SHOULDER = 11;
          const R_SHOULDER = 12;
          const L_ELBOW = 13;
          const R_ELBOW = 14;
          const L_WRIST = 15;
          const R_WRIST = 16;
          const L_HIP = 23;
          const R_HIP = 24;
          const L_KNEE = 25;
          const R_KNEE = 26;
          const R_FOOT = 28;
          const L_FOOT = 27;

          const R_MOUTH = 10;
          const L_MOUTH = 9;

          // Convert pose points to canvas coordinates
          const leftShoulder = toCanvas(p[L_SHOULDER]);
          const leftElbow = toCanvas(p[L_ELBOW]);
          const leftWrist = toCanvas(p[L_WRIST]);
          const leftMouth = toCanvas(p[L_MOUTH]);
          const leftHip = toCanvas(p[L_HIP]);
          const leftKnee = toCanvas(p[L_KNEE]);
          const leftFoot = toCanvas(p[L_FOOT]);

          const rightShoulder = toCanvas(p[R_SHOULDER]);
          const rightElbow = toCanvas(p[R_ELBOW]);
          const rightWrist = toCanvas(p[R_WRIST]);
          const rightMouth = toCanvas(p[R_MOUTH]);
          const rightHip = toCanvas(p[R_HIP]);
          const rightKnee = toCanvas(p[R_KNEE]);
          const rightFoot = toCanvas(p[R_FOOT]);

          // Calculate heart position (center between shoulders, slightly below)
          const heartX = (leftShoulder[0] + rightShoulder[0]) / 2;
          const heartY = (leftShoulder[1] + rightShoulder[1]) / 2 + 50; // 50px below shoulder line
          const heart = [heartX, heartY];

          // Calculate mouth center
          const mouthCenter = [
            (leftMouth[0] + rightMouth[0]) / 2,
            (leftMouth[1] + rightMouth[1]) / 2,
          ];

          // Simple paths from extremities to heart
          left_waypoints = [
            leftWrist, // Start at wrist (fingertips will spawn here)
            leftElbow, // Through elbow
            leftShoulder, // Through shoulder
            heart, // End at heart
          ];

          right_waypoints = [
            rightWrist, // Start at wrist (fingertips will spawn here)
            rightElbow, // Through elbow
            rightShoulder, // Through shoulder
            heart, // End at heart
          ];

          // Path from mouth to heart
          mouth_waypoints = [
            mouthCenter, // Start at mouth center
            heart, // Go directly to heart
          ];

          // Paths from knees to heart
          left_knee_waypoints = [
            leftFoot, // Start at left foot
            leftKnee, // Start at left knee
            leftHip, // Through left hip
            leftShoulder, // Through left shoulder
            heart, // End at heart
          ];

          right_knee_waypoints = [
            rightFoot, // Start at right foot
            rightKnee, // Start at right knee
            rightHip, // Through right hip
            rightShoulder, // Through right shoulder
            heart, // End at heart
          ];
        }
      }
    }
  }
}

//------------------------------------------
function drawVideoBackground() {
  push();
  translate(width, 0);
  scale(-1, 1);
  tint(255, 255, 255, 3);
  image(myCapture, 0, 0, width, height);
  tint(255);
  pop();
}

//------------------------------------------
let frameRateAvg = 60.0;

function drawDiagnosticInfo() {
  noStroke();
  fill("white");
  textSize(12);
  frameRateAvg = 0.98 * frameRateAvg + 0.02 * frameRate();
  text("FPS: " + nf(frameRateAvg, 1, 2), 40, 30);
}

function drawPoseP() {
  if (trackingConfig.doAcquirePoseLandmarks) {
    if (poseLandmarks && poseLandmarks.landmarks) {
      const nPoses = poseLandmarks.landmarks.length;
      if (nPoses > 0) {
        // Draw lines connecting the joints of the body
        noFill();
        stroke("darkblue");
        strokeWeight(2.0);
        for (let h = 0; h < nPoses; h++) {
          let joints = poseLandmarks.landmarks[h];
          for (let i in joints) {
            let p = joints[i];
            let x = map(p.x, 1, 0, 0, width);
            let y = map(p.y, 0, 1, 0, height);

            // if (i == 12) stroke('red');
            // else stroke('darkblue')
            // circle(x, y, 10);
          }
          drawConnectors(joints, PoseLandmarker.POSE_CONNECTIONS);
        }
      }
    }
  }
}

function getVideoColorAtFast(x, y) {
  if (!myCapture.pixels || myCapture.pixels.length === 0) return color(255);

  // mirror horizontally like the displayed video
  const vx = constrain(
    map(x, 0, width, myCapture.width, 0),
    0,
    myCapture.width - 1
  );
  const vy = constrain(
    map(y, 0, height, 0, myCapture.height),
    0,
    myCapture.height - 1
  );

  const idx = 4 * (int(vy) * myCapture.width + int(vx)); // RGBA
  const r = myCapture.pixels[idx];
  const g = myCapture.pixels[idx + 1];
  const b = myCapture.pixels[idx + 2];
  const a = myCapture.pixels[idx + 3];
  return color(r, g, b, a);
}
