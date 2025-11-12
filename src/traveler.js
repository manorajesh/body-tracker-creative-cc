class Traveler {
  constructor(x, y, side, vx = 0, vy = 0, zDepth = 0, maxAge = 100) {
    this.side = side;
    // Size based on Z-depth - closer to camera (smaller z) = larger travelers
    this.size = map(zDepth, -0.2, 0, 25, 5); // Adjust these ranges as needed
    this.age = 0;
    this.maxAge = maxAge;
    this.currentWaypointIdx = 0;
    this.isDead = false;

    let waypoints;
    if (side === "mouth" || side === "eyes") {
      waypoints = mouth_waypoints; // Eyes use same path as mouth (direct to heart)
    } else {
      waypoints = this.side === "left" ? left_waypoints : right_waypoints;
    }

    if (waypoints && waypoints.length > 0) {
      // For mouth and eye travelers, start targeting the heart directly (index 1)
      if ((side === "mouth" || side === "eyes") && waypoints.length > 1) {
        this.currentWaypointIdx = 1; // Skip first waypoint, go straight to heart
        this.tx = waypoints[1][0];
        this.ty = waypoints[1][1];
      } else {
        this.tx = waypoints[0][0];
        this.ty = waypoints[0][1];
      }
    } else {
      // Fallback if waypoints not set
      this.tx = x;
      this.ty = y;
    }
    const options = {
      friction: 0.01,
      frictionAir: 0.03,
      restitution: 0.7,
      density: 0.01,
    };
    this.body = Bodies.circle(x, y, this.size / 2, options);
    World.add(world, this.body);

    Matter.Body.setVelocity(this.body, {
      x: vx,
      y: vy,
    });
  }

  update() {
    this.age++;

    let waypoints;
    if (this.side === "mouth" || this.side === "eyes") {
      waypoints = mouth_waypoints; // Eyes use same path as mouth
    } else {
      waypoints = this.side === "left" ? left_waypoints : right_waypoints;
    }

    if (waypoints && this.currentWaypointIdx < waypoints.length) {
      this.tx = waypoints[this.currentWaypointIdx][0];
      this.ty = waypoints[this.currentWaypointIdx][1];
    }

    // pull toward target a little
    let pos = this.body.position;
    let dx = this.tx - pos.x;
    let dy = this.ty - pos.y;
    let d = Math.sqrt(dx * dx + dy * dy);
    if (d > 1) {
      let forceScale = map(d, 0, 800, 0.0001, 0.005);
      // let forceScale = d * 0.00001; // Linear scaling
      // let forceScale = (d * d) * 0.000001; // Quadratic scaling (stronger)

      Matter.Body.applyForce(this.body, pos, {
        x: (dx / d) * forceScale,
        y: (dy / d) * forceScale,
      });
    }

    // scale the matter body to match size (in case size changed due to z-depth)
    const currentRadius = this.body.circleRadius;
    const desiredRadius = this.size / 2;
    if (currentRadius !== desiredRadius) {
      const scaleFactor = desiredRadius / currentRadius;
      Matter.Body.scale(this.body, scaleFactor, scaleFactor);
    }

    if (this.isDone()) {
      this.currentWaypointIdx++;
      let waypoints;
      if (this.side === "mouth" || this.side === "eyes") {
        waypoints = mouth_waypoints; // Eyes use same path as mouth
      } else {
        waypoints = this.side === "left" ? left_waypoints : right_waypoints;
      }

      if (!waypoints || this.currentWaypointIdx >= waypoints.length) {
        this.isDead = true;
        return;
      }

      // Target will be updated at start of next frame
      this.age = this.maxAge * 0.4;
    }
  }

  display() {
    const pos = this.body.position;
    const col = getVideoColorAtFast(pos.x, pos.y);
    const a = map(this.age, 0, this.maxAge, 180, 0);

    push();
    noStroke();
    fill(red(col), green(col), blue(col), a);
    circle(pos.x, pos.y, map(this.age, 0, this.maxAge, this.size, 0));
    pop();
  }

  isDone() {
    let pos = this.body.position;
    let close = dist(pos.x, pos.y, this.tx, this.ty) < 10;
    let old = this.age > this.maxAge;
    return close || old;
  }
}

function updateAndDrawTravelers() {
  for (let i = travelers.length - 1; i >= 0; i--) {
    let t = travelers[i];
    t.update();
    t.display();
    if (t.isDead) {
      // remove from physics world too
      World.remove(world, t.body);
      travelers.splice(i, 1);
    }
  }
}

function emitTravelersFromHands() {
  updateWaypoints();

  if (
    !(
      trackingConfig.doAcquireHandLandmarks &&
      handLandmarks &&
      handLandmarks.landmarks
    )
  )
    return;

  if (frameCount % 2 !== 0) return; // Spawn every 5 frames

  const nHands = handLandmarks.landmarks.length;
  const tips = [4, 8, 12, 16, 20]; // thumb + fingertips

  for (let h = 0; h < nHands; h++) {
    const joints = handLandmarks.landmarks[h];
    if (!joints) continue;

    const side = handLandmarks.handednesses[h].toLowerCase();

    for (let i = 0; i < tips.length; i++) {
      const tipIndex = tips[i];
      const tip = joints[tipIndex];
      if (!tip) continue;

      // map normalized [0..1] to canvas, and mirror like your video
      const sx = map(tip.x, 0, 1, width, 0);
      const sy = map(tip.y, 0, 1, 0, height);
      const sz = tip.z; // Z-depth from MediaPipe (negative = closer to camera)

      // --- compute fingertip velocity from last sample ---
      const key = `${side}-${tipIndex}`;
      const nowMs = millis();
      const prev = prevTipSamples[key];

      let vx = 0,
        vy = 0;
      if (prev) {
        const dt = Math.max(1, nowMs - prev.t); // ms
        const dx = sx - prev.x;
        const dy = sy - prev.y;

        // Convert px/ms -> px per physics step (≈ engine.timing.delta ms)
        const stepMs = engine?.timing?.delta || 1000 / 60;
        const velocityScale = 1.0; // feel free to tune
        vx = (dx / dt) * stepMs * velocityScale;
        vy = (dy / dt) * stepMs * velocityScale;
      }

      // store sample for next frame
      prevTipSamples[key] = {
        x: sx,
        y: sy,
        t: nowMs,
      };

      // optional: clamp crazy speeds
      const maxSpeed = 15; // px per step
      const speed = Math.hypot(vx, vy);
      if (speed > maxSpeed) {
        const k = maxSpeed / speed;
        vx *= k;
        vy *= k;
      }

      // spawn with initial velocity and Z-depth
      const t = new Traveler(sx, sy, side, vx, vy, sz);
      travelers.push(t);
    }
  }
}

function emitTravelersFromMouth() {
  if (
    !(
      trackingConfig.doAcquirePoseLandmarks &&
      poseLandmarks &&
      poseLandmarks.landmarks
    )
  )
    return;

  const nPoses = poseLandmarks.landmarks.length;
  if (nPoses === 0) return;

  // Spawn more frequently from mouth (every 2 frames instead of 5)

  const p = poseLandmarks.landmarks[0];
  const L_MOUTH = 9;
  const R_MOUTH = 10;

  // Calculate mouth center position
  const leftMouth = [
    map(p[L_MOUTH].x, 0, 1, width, 0),
    map(p[L_MOUTH].y, 0, 1, 0, height),
  ];
  const rightMouth = [
    map(p[R_MOUTH].x, 0, 1, width, 0),
    map(p[R_MOUTH].y, 0, 1, 0, height),
  ];
  const mouthCenterX = (leftMouth[0] + rightMouth[0]) / 2;
  const mouthCenterY = (leftMouth[1] + rightMouth[1]) / 2;

  // Create travelers at mouth center with small random velocity
  const vx = random(-2, 2);
  const vy = random(-2, 2);
  const zDepth = (p[L_MOUTH].z + p[R_MOUTH].z) / 100; // Average Z depth of mouth corners

  // Spawn multiple travelers for more visibility
  for (let i = 0; i < 2; i++) {
    const offsetX = random(-10, 10); // Small random offset
    const offsetY = random(-10, 10);
    const t = new Traveler(
      mouthCenterX + offsetX,
      mouthCenterY + offsetY,
      "mouth",
      vx + random(-1, 1),
      vy + random(-1, 1),
      zDepth * 0.01
    );
    travelers.push(t);
  }
}

function emitTravelersFromEyes() {
  if (
    !(
      trackingConfig.doAcquirePoseLandmarks &&
      poseLandmarks &&
      poseLandmarks.landmarks
    )
  )
    return;

  const nPoses = poseLandmarks.landmarks.length;
  if (nPoses === 0) return;

  // Spawn from eyes every 3 frames
  if (frameCount % 3 !== 0) return;

  const p = poseLandmarks.landmarks[0];
  const L_EYE = 2; // Left eye
  const R_EYE = 5; // Right eye

  // Calculate eye positions
  const leftEye = [
    map(p[L_EYE].x, 0, 1, width, 0),
    map(p[L_EYE].y, 0, 1, 0, height),
  ];
  const rightEye = [
    map(p[R_EYE].x, 0, 1, width, 0),
    map(p[R_EYE].y, 0, 1, 0, height),
  ];

  // Create travelers from each eye
  const zDepthLeft = p[L_EYE].z;
  const zDepthRight = p[R_EYE].z;

  // Spawn from left eye
  for (let i = 0; i < 2; i++) {
    const offsetX = random(-5, 5);
    const offsetY = random(-5, 5);
    const vx = random(-1, 1);
    const vy = random(-1, 1);

    const t = new Traveler(
      leftEye[0] + offsetX,
      leftEye[1] + offsetY,
      "eyes",
      vx,
      vy,
      zDepthLeft * 0.03
    );
    travelers.push(t);
  }

  // Spawn from right eye
  for (let i = 0; i < 2; i++) {
    const offsetX = random(-5, 5);
    const offsetY = random(-5, 5);
    const vx = random(-1, 1);
    const vy = random(-1, 1);

    const t = new Traveler(
      rightEye[0] + offsetX,
      rightEye[1] + offsetY,
      "eyes",
      vx,
      vy,
      zDepthRight * 0.03
    );
    travelers.push(t);
  }
}
