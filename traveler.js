class Traveler {
  constructor(x, y, side, vx = 0, vy = 0) {
    this.side = side;
    this.waypoints = side == "left" ? left_waypoints : right_waypoints;
    this.tx = this.waypoints[0][0];
    this.ty = this.waypoints[0][1];
    this.size = 10;
    this.age = 0;
    this.maxAge = 100;
    this.currentWaypointIdx = 0;

    const options = {
      friction: 0.01,
      frictionAir: 0.03, // gentle glide-down of velocity
      restitution: 0.7,
      density: 0.01,
    };
    this.body = Bodies.circle(x, y, this.size / 2, options);
    World.add(world, this.body);

    // apply initial velocity (px per step)
    Matter.Body.setVelocity(this.body, {
      x: vx,
      y: vy,
    });
  }

  update() {
    this.age++;

    // pull toward target a little
    let pos = this.body.position;
    let dx = this.tx - pos.x;
    let dy = this.ty - pos.y;
    let d = Math.sqrt(dx * dx + dy * dy);
    if (d > 1) {
      // small force so they still collide naturally
      let forceScale = random(0.001, 0.0001);
      Matter.Body.applyForce(this.body, pos, {
        x: (dx / d) * forceScale,
        y: (dy / d) * forceScale,
      });
    }

    if (this.isDone()) {
      this.currentWaypointIdx++;
      if (this.currentWaypointIdx >= this.waypoints.length) return;

      this.tx = this.waypoints[this.currentWaypointIdx][0];
      this.ty = this.waypoints[this.currentWaypointIdx][1];
      this.age = 50;
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
    let close = dist(pos.x, pos.y, this.tx, this.ty) < 6;
    let old = this.age > this.maxAge;
    return close || old;
  }
}

function updateAndDrawTravelers() {
  for (let i = travelers.length - 1; i >= 0; i--) {
    let t = travelers[i];
    t.update();
    t.display();
    if (t.isDone()) {
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

      // spawn with initial velocity
      const t = new Traveler(sx, sy, side, vx, vy);
      travelers.push(t);
    }
  }
}
