/* ------------------------------------------------------------------
   Torn-paper ocean background — scrolling version.

   The three artworks are stacked top to bottom in this order: sky,
   then sand, then sea. Each image keeps its own aspect ratio —
   scaled to the page width, not stretched or cropped — so the canvas
   is exactly as tall as the artwork actually is, and the page
   scrolls through it naturally.

   A light generative layer rides on top: bubbles rising through the
   sea band, sparkle drifting in the sky band, and fine grain in the
   sand band, plus a slow independent sway per band so it all feels
   gently alive rather than static.
------------------------------------------------------------------- */

const sketch = (p) => {
  let imgSand, imgSea, imgSky;
  let scale = 1;
  let hSky = 0, hSea = 0, hSand = 0;
  let totalH = 0;
  const OVERLAP = 1045; // px overlap between bands so torn edges interleave, no seams
  const SAND_SHIFT = 200; // px to pull the sand band upward

  let bubbles = [];
  let sparkles = [];
  let grains = [];

  // ================================================================
  // Sea-creature stickers 
  // These float only inside the light-blue "river" part of the sea
  // artwork, random position/subset each page load, original image
  // size never changed.
  // ================================================================

  // one p5.Image per sticker, filled in during preload
  let creatureImgs = {};

  // file list — add/remove filenames here if the sticker set changes
  const CREATURE_FILES = [
    "con ca duoi.png",  // stingray
    "con ca  heo.png",   // dolphin
    "con ca mup.png",   // shark
    "con ca ngua.png",  // seahorse
    "con muc.png",      // squid
    "con rua.png",      // turtle
    "con sua.png",      // jellyfish
    "ngoi sao.png",     // starfish (cluster)
  ];

  // Second set: "rac" (trash) creature stickers — same idea as the
  // set above, but these live in the DARK NAVY part of the sea
  // artwork instead of the light-blue river. Original image size is
  // never changed for these either.
  const DARK_CREATURE_FILES = [
    "con bach tuot rac.png",  // stingray - trash version
    "con ca heo rac.png",     // dolphin - trash version
    "con ca rac.png",         // fish - trash version 1
    "con ca rac 2.png",       // fish - trash version 2
    "con rua rac.png",        // turtle - trash version
    "con muc rac.png",        // squid - trash version
    "con sua rac.png",        // jellyfish - trash version
  ];
  let darkCreatureImgs = {};
  let darkCreatures = [];

  // How the light-blue zone is detected: instead of guessing a fixed
  // box/shape for the light-blue river, we sample the ACTUAL pixel
  // colours of sea.png at candidate spots. A pixel counts as
  // "light-blue water" when it's bright AND clearly more blue than
  // red (matches rgb(0,174,255) style water, rejects the dark navy
  // deep-sea colour). Tweak these two numbers if your art differs.
  const SEA_ZONE_BRIGHTNESS_MIN = 100; // 0-255, average of r+g+b
  const SEA_ZONE_BLUE_BIAS_MIN = 30;   // how much bluer than red it must be

  // Safety buffer around the water zone's edge: a point only counts
  // as "safe water" if it AND four points offset by this margin in
  // each direction are all water too — erodes the zone inward a bit
  // so nothing hangs over the torn/dark edge.
  const SEA_ZONE_EDGE_MARGIN_PX = 7;

  // Placement rules
  const MIN_CREATURES = 3;   // show 4-5 creatures per load
  const MAX_CREATURES = 5;
  const CREATURE_GAP_PX_AT_1000 = 0;   // breathing room between stickers
                                         // (defined at 1000px-wide page, then
                                         // scaled, so spacing feels consistent)
  const CREATURE_PLACEMENT_TRIES = 500; // random attempts per creature before giving up

  // Footprint check density: scan a grid (steps x steps) over the
  // sprite and only test points that fall on a non-transparent pixel
  // of the actual artwork (real alpha), not just its bounding box —
  // this matters for diagonal/irregular shapes like the ray or dolphin.
  const CREATURE_FOOTPRINT_GRID_STEPS = 4; // 6x6 grid = up to 49 test points
  const CREATURE_SPRITE_ALPHA_MIN = 20;    // alpha threshold to count as "drawn" there

  // Turn this on to SEE the detected light-blue zone as a translucent
  // magenta overlay, to visually confirm it lines up with sea.png.
  const DEBUG_SHOW_SEA_ZONE = false;

  // Vertical limits for where creatures are allowed to land, as a
  // fraction of the SEA BAND's own height (0 = very top of the sea
  // band, 1 = very bottom of the sea band). Example: TOP_FRAC = 0.1
  // and BOTTOM_FRAC = 0.6 means creatures can only appear between
  // 10% and 60% down the sea band — nothing lower than that, even if
  // the light-blue river keeps going. Adjust these two numbers to
  // taste; they don't need to add up to anything in particular.
  const CREATURE_ZONE_TOP_FRAC = 0.2;
  const CREATURE_ZONE_BOTTOM_FRAC = 0.57;

  let creatures = []; // the chosen, placed creatures for this page load

  p.preload = () => {
    imgSky  = p.loadImage("assets/images/sky.png");
    imgSea  = p.loadImage("assets/images/sea.png");
    imgSand = p.loadImage("assets/images/sand.png");

    // Load every sea-creature sticker up front, keyed by filename.
    // Each call also gets a failure callback so a wrong/misspelled
    // filename shows up as a clear red error in the browser Console
    // (F12) instead of just silently not appearing.
    CREATURE_FILES.forEach((file) => {
      creatureImgs[file] = p.loadImage(
        "assets/images/" + file,
        () => {}, // loaded fine, nothing extra to do
        () => {
          console.error(
            "Sea-creature image failed to load: assets/images/" + file +
            "  -> check that a file with this EXACT name (case-sensitive) exists in your assets/images folder."
          );
        }
      );
    });

    // Same idea, for the dark-navy "rac" sticker set.
    DARK_CREATURE_FILES.forEach((file) => {
      darkCreatureImgs[file] = p.loadImage(
        "assets/images/" + file,
        () => {}, // loaded fine, nothing extra to do
        () => {
          console.error(
            "Dark-navy 'rac' sticker failed to load: assets/images/" + file +
            "  -> check that a file with this EXACT name (case-sensitive) exists in your assets/images folder."
          );
        }
      );
    });
  };

  p.setup = () => {
    computeLayout();
    const cnv = p.createCanvas(p.windowWidth, totalH);
    cnv.parent("bg-sketch");
    p.noStroke();
    seedParticles();

    // pick + place this load's random cast of sea creatures
    seedCreatures();
    seedDarkCreatures();
  };
  function seedCreatures() {
  creatures = [];

  const count = Math.floor(p.random(MIN_CREATURES, MAX_CREATURES + 1)); // 3–5
  const chosenFiles = shuffledCopy(CREATURE_FILES).slice(0, count);

  const { seaTop, seaBottom } = bandBounds();
  const seaH = seaBottom - seaTop;

  const zoneTop = seaTop + CREATURE_ZONE_TOP_FRAC * seaH;
  const zoneBottom = seaTop + CREATURE_ZONE_BOTTOM_FRAC * seaH;
  const zoneH = Math.max(1, zoneBottom - zoneTop);

  const sliceOrder = shuffledCopy(chosenFiles.map((_, i) => i));

  chosenFiles.forEach((file, idx) => {
    const img = creatureImgs[file];
    const SCALE = 0.9; // change this to scale all creatures up/down together, if desired
    const w = img.width * SCALE;
    const h = img.height * SCALE;
    const radius = Math.hypot(w, h) / 2;

    const sliceIndex = sliceOrder[idx];
    const sliceTop = zoneTop + (sliceIndex / count) * zoneH;
    const sliceBottom = zoneTop + ((sliceIndex + 1) / count) * zoneH;

    // decrease the vertical slice a bit so creatures don't hug the slice edges too tightly
    const padY = Math.min((sliceBottom - sliceTop) * 0, h * 0.1);
    const rowMin = Math.max(sliceTop + padY, seaTop + h / 2);
    const rowMax = Math.min(sliceBottom - padY, seaBottom - h / 2);

    let placed = false;
    for (let attempt = 0; attempt < CREATURE_PLACEMENT_TRIES && !placed; attempt++) {
      const cy = rowMin <= rowMax
        ? p.random(rowMin, rowMax)
        : p.random(Math.max(zoneTop, seaTop + h / 2), Math.min(zoneBottom, seaBottom - h / 2));

      const row = measureWaterRowAt(cy);
      let cx;
      if (row) {
        const halfSpan = (row.maxX - row.minX) * CREATURE_SIDEWAYS_JITTER_FRAC;
        cx = p.constrain(
          row.centerX + p.random(-halfSpan, halfSpan),
          w / 2,
          p.width - w / 2
        );
      } else {
        cx = p.random(w / 2, p.width - w / 2);
      }

      const rotation = p.random(-p.PI /12, p.PI /12); // rotate 45 degrees either way for a more natural look
      if (!footprintInsideWater(cx, cy, w, h, img, rotation)) continue;
      // check for overlap with any already-placed creatures
      const overlapsExisting = creatures.some((other) => {
        const d = Math.hypot(cx - other.x, cy - other.y);
        return d < (radius + other.radius)*0.9;
      });
      if (overlapsExisting) continue;

      creatures.push({
        img,
        x: cx,
        y: cy,
        w,
        h,
        radius,
        rotation,
        bobPhase: p.random(p.TWO_PI),
        bobSpeed: p.random(0.01, 0.02),
        bobAmp: p.random(2, 5),
      });
      placed = true;
    }
  });

  // compress the creatures vertically so they don't drift too far apart, but only if they were successfully placed
  compressCreatures(creatures, 2);
}

// same idea as seedCreatures(), but for the dark-navy "rac" stickerss
function compressCreatures(creatures, minGap = 2) {
  creatures.sort((a, b) => a.y - b.y);
  for (let i = 1; i < creatures.length; i++) {
    const prev = creatures[i - 1];
    const curr = creatures[i];
    const d = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const minDist = prev.radius + curr.radius + minGap;
    if (d > minDist * 1.5) {
      const ratio = minDist / d;
      curr.x = prev.x + (curr.x - prev.x) * ratio;
      curr.y = prev.y + (curr.y - prev.y) * ratio;
    }
  }
}
  p.windowResized = () => {
    computeLayout();
    p.resizeCanvas(p.windowWidth, totalH);
    seedParticles();

    // the light-blue zone moves when the canvas resizes, so
    // re-place the creatures to match (this re-rolls them, same as
    // the bubbles/sparkles/grain already do on resize)
    seedCreatures();
    seedDarkCreatures();
  };

  function computeLayout() {
    // all three source images share the same native width, so one
    // scale factor (page width / image width) keeps every band's
    // aspect ratio true to the original art
    scale = p.windowWidth / imgSky.width;
    hSky  = imgSky.height  * scale;
    hSand = imgSand.height * scale;
    hSea  = imgSea.height  * scale;
    totalH = Math.round(hSky + hSand + hSea - 2 * OVERLAP - SAND_SHIFT);
  }

  // order top -> bottom: sky, sand, sea
  function bandBounds() {
    const skyTop = 0;
    const skyBottom = hSky;
    const sandTop = skyBottom - OVERLAP - SAND_SHIFT;
    const sandBottom = sandTop + hSand;
    const seaTop = sandBottom - OVERLAP;
    const seaBottom = seaTop + hSea;
    return { skyTop, skyBottom, sandTop, sandBottom, seaTop, seaBottom };
  }

  function seedParticles() {
    const { skyTop, skyBottom, sandTop, sandBottom, seaTop, seaBottom } = bandBounds();

    bubbles = [];
    const bubbleCount = Math.max(28, Math.round((p.width * hSea) / 45000));
    for (let i = 0; i < bubbleCount; i++) {
      bubbles.push(makeBubble(seaTop, seaBottom, true));
    }

    sparkles = [];
    const sparkleCount = Math.max(8, Math.round((p.width * hSky) / 130000));
    for (let i = 0; i < sparkleCount; i++) {
      sparkles.push({
        x: p.random(p.width),
        y: p.random(skyTop + 10, skyBottom - 10),
        r: p.random(1, 2.2),
        phase: p.random(p.TWO_PI),
        speed: p.random(0.01, 0.03),
      });
    }

    grains = [];
    const grainCount = Math.max(24, Math.round((p.width * hSand) / 60000));
    for (let i = 0; i < grainCount; i++) {
      grains.push({
        x: p.random(p.width),
        y: p.random(sandTop + 15, sandBottom - 10),
        r: p.random(0.6, 1.5),
        drift: p.random(-0.04, 0.04),
      });
    }
  }

  function makeBubble(topY, bottomY, randomStart) {
    return {
      x: p.random(p.width),
      y: randomStart ? p.random(topY, bottomY) : bottomY + p.random(20, 80),
      r: p.random(13, 19),
      speed: p.random(0.25, 0.65),
      wobble: p.random(p.TWO_PI),
      wobbleSpeed: p.random(0.01, 0.025),
      wobbleAmp: p.random(6, 16),
    };
  }

  p.draw = () => {
    p.clear();
    drawLayers();

    // creatures sit underneath the bubbles/sparkles so bubbles still
    // read as floating in front
    drawCreatures();
    drawDarkCreatures();
    if (DEBUG_SHOW_SEA_ZONE) drawSeaZoneDebug();

    drawGrain();
    drawBubbles();
    drawSparkles();
  };

  function drawLayers() {
    const t = p.frameCount;
    const { skyTop, sandTop, seaTop } = bandBounds();

    // gentle independent sway per band -- slow sine drift, different
    // period/amplitude/phase so bands never move in lockstep
    const skyDy  = Math.sin(t * 0.0025 + 4.2) * 3;
    const sandDy = Math.sin(t * 0.004) * 3;
    const seaDy  = Math.sin(t * 0.003 + 2.1) * 5;

    // draw each image at its native aspect ratio (width-scaled only,
    // never stretched or cropped), painted in stacking order so each
    // later layer covers the overlap left by the one above it
    p.image(imgSky,  0, skyTop  + skyDy,  p.width, hSky);
    p.image(imgSand, 0, sandTop + sandDy, p.width, hSand);
    p.image(imgSea,  0, seaTop  + seaDy,  p.width, hSea);
  }

    // Maximum bubble size after repeated merges, and the overlap threshold
    // for merging. Positive values require more overlap; negative values
    // allow bubbles to merge slightly before touching.
  const BUBBLE_MAX_DIAMETER = 26;
  const BUBBLE_MERGE_OVERLAP_PX = 0;

  function drawBubbles() {
    const { seaTop, seaBottom } = bandBounds();

    // Bubble positions
    for (const b of bubbles) {
      b.y -= b.speed;
      b.wobble += b.wobbleSpeed;
    }

    // Respawn bubbles at the bottom after they float above the sea band
    for (let i = 0; i < bubbles.length; i++) {
      if (bubbles[i].y < seaTop - 20) {
        bubbles[i] = makeBubble(seaTop, seaBottom, false);
      }
    }

    // Merge overlapping bubbles
    mergeBubbles(seaTop, seaBottom);

    // Draw bubbles with a subtle highlight and a faint outline
    p.push();
    for (const b of bubbles) {
      const x = b.x + Math.sin(b.wobble) * b.wobbleAmp;

    // Bubble
    p.fill(255, 255, 255, 65);
    p.circle(x, b.y, b.r);

    // Bubbke outline
    p.noFill();
    p.stroke(255, 255, 255, 110);
    p.strokeWeight(1);
    p.circle(x, b.y, b.r);
 
    // Highlight
    p.noStroke();
    p.fill(255, 255, 255, 180);
    p.circle(
    x - b.r * 0.18,
    b.y - b.r * 0.18,
    b.r * 0.18
  );

  p.noStroke();
   }
  }

  // Check every pair of bubbles for overlap. If two bubbles overlap
  // beyond the merge threshold, merge them into a single bubble. The
  // new bubble's size is calculated by preserving the combined area
  // (d = sqrt(d1² + d2²)), while its position, velocity, and wobble
  // amplitude are averaged based on area. The merged bubble is replaced
  // with a new bubble spawned at the bottom to keep the total bubble
  // count constant.
  function mergeBubbles(seaTop, seaBottom) {
    for (let i = 0; i < bubbles.length; i++) {
      const a = bubbles[i];
      if (!a) continue;
      for (let j = i + 1; j < bubbles.length; j++) {
        const b = bubbles[j];
        if (!b) continue;

        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const touchDist = (a.r + b.r) / 2 - BUBBLE_MERGE_OVERLAP_PX;
        if (d >= touchDist) continue;

        const areaA = a.r * a.r;
        const areaB = b.r * b.r;
        const totalArea = areaA + areaB;

        a.x = (a.x * areaA + b.x * areaB) / totalArea;
        a.y = (a.y * areaA + b.y * areaB) / totalArea;
        a.r = Math.min(BUBBLE_MAX_DIAMETER, Math.sqrt(areaA + areaB));
        a.speed = (a.speed * areaA + b.speed * areaB) / totalArea;
        a.wobbleAmp = (a.wobbleAmp * areaA + b.wobbleAmp * areaB) / totalArea;
        a.wobbleSpeed = (a.wobbleSpeed * areaA + b.wobbleSpeed * areaB) / totalArea;

        bubbles[j] = makeBubble(seaTop, seaBottom, false);
      }
    }
  }

  function drawSparkles() {
    p.push();
    for (const s of sparkles) {
      s.phase += s.speed;
      const alpha = 90 + Math.sin(s.phase) * 70;
      p.fill(255, 255, 255, Math.max(0, alpha));
      p.circle(s.x, s.y, s.r);
    }
    p.pop();
  }

  function drawGrain() {
    p.push();
    for (const g of grains) {
      g.x += g.drift;
      if (g.x < 0) g.x = p.width;
      if (g.x > p.width) g.x = 0;
      p.fill(120, 90, 50, 30);
      p.circle(g.x, g.y, g.r);
    }
    p.pop();
  }

  // ================================================================
  // Sea-creature placement + draw
  // ================================================================

  // Sample sea.png's own pixels to test whether a canvas position
  // (x, y) lands on the light-blue water. Works for ANY shape of
  // light-blue area (a winding river, blobs, whatever) because it
  // reads the real artwork instead of a hand-guessed box.
  function isLightBlueWater(x, y) {
    const { seaTop } = bandBounds();

    // convert the canvas position back into sea.png's own pixel
    // space: the sea image is drawn at width p.width starting at
    // seaTop, using the same "scale" factor as every other band
    const imgX = Math.round(x / scale);
    const imgY = Math.round((y - seaTop) / scale);

    if (imgX < 0 || imgX >= imgSea.width || imgY < 0 || imgY >= imgSea.height) {
      return false; // outside the sea artwork entirely
    }

    const c = imgSea.get(imgX, imgY); // [r, g, b, a]
    const brightness = (c[0] + c[1] + c[2]) / 3;
    const blueBias = c[2] - c[0]; // how much bluer than red

    return brightness > SEA_ZONE_BRIGHTNESS_MIN && blueBias > SEA_ZONE_BLUE_BIAS_MIN;
  }

  // A point only counts as "safe water" if it AND four points offset
  // by SEA_ZONE_EDGE_MARGIN_PX in each direction (up/down/left/right)
  // are all water too — erodes the zone inward, removing the thin
  // anti-aliased edge between the light-blue river and the dark/torn
  // areas around it.
  function isSafeWater(x, y) {
    const m = SEA_ZONE_EDGE_MARGIN_PX;
    return (
      isLightBlueWater(x, y) &&
      isLightBlueWater(x - m, y) &&
      isLightBlueWater(x + m, y) &&
      isLightBlueWater(x, y - m) &&
      isLightBlueWater(x, y + m)
    );
  }

  // Scans a grid over the sprite's frame and, for every grid point
  // that lands on a non-transparent pixel of the actual artwork
  // (real alpha, not the bounding box), checks that the equivalent
  // canvas position is safe water. This follows the true silhouette
  // of diagonal/irregular sprites (ray, dolphin, shark…) instead of
  // approximating with a rectangle.
  function footprintInsideWater(cx, cy, w, h, img, rotation) {
    const steps = CREATURE_FOOTPRINT_GRID_STEPS;
    const cosR = Math.cos(rotation);
    const sinR = Math.sin(rotation);
    for (let iy = 0; iy <= steps; iy++) {
      for (let ix = 0; ix <= steps; ix++) {
        const u = ix / steps; // 0..1 across sprite width
        const v = iy / steps; // 0..1 across sprite height

        // real alpha at this position on the sprite itself
        const spX = Math.min(img.width - 1, Math.round(u * img.width));
        const spY = Math.min(img.height - 1, Math.round(v * img.height));
        const alpha = img.get(spX, spY)[3];
        if (alpha < CREATURE_SPRITE_ALPHA_MIN) continue; // transparent pixel -> skip

        // position of this point before rotation (sprite centre = origin),
        // then rotated by the same "rotation" used when actually drawing
        const lx = -w / 2 + u * w;
        const ly = -h / 2 + v * h;
        const px = cx + lx * cosR - ly * sinR;
        const py = cy + lx * sinR + ly * cosR;
        if (!isSafeWater(px, py)) return false;
      }
    }
    return true;
  }

  // Fisher-Yates shuffle of a copy of an array — used to pick a
  // random subset of creatures each page load
  function shuffledCopy(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(p.random(i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // How far each creature is nudged sideways from the water's
  // horizontal centreline at its slice, as a fraction of the slice's
  // measured water width. Small values keep everyone hugging the
  // middle of the river (tidy, like the reference screenshots);
  // larger values let them wander closer to the banks.
  const CREATURE_SIDEWAYS_JITTER_FRAC = 0.35;

  // Measures how wide the light-blue river actually is at a given
  // y, by scanning across the page width and returning the water
  // pixels' [minX, maxX, centerX]. Falls back to null if no water is
  // found at that y (e.g. a torn-edge gap between river segments).
  function measureWaterRowAt(y) {
    const step = 4;
    let minX = null, maxX = null;
    for (let x = 0; x <= p.width; x += step) {
      if (isLightBlueWater(x, y)) {
        if (minX === null) minX = x;
        maxX = x;
      }
    }
    if (minX === null) return null;
    return { minX, maxX, centerX: (minX + maxX) / 2 };
  }

  // Pick a random 4-5 creatures and lay them out with EVEN vertical
  // spacing down the light-blue river, instead of pure random (which
  // tends to clump or leave big gaps). The sea band's allowed
  // vertical range is cut into as many equal slices as there are
  // creatures; each creature gets its own slice and is placed near
  // that slice's water centreline with a small random offset — this
  // reads as a tidy, hand-arranged layout while still reshuffling
  // (which files, which slice, exact offset/rotation) every reload.
  // Called on setup + resize.
  function seedCreatures() {
    creatures = [];

    const count = Math.floor(p.random(MIN_CREATURES, MAX_CREATURES + 1)); // 4 or 5
    const chosenFiles = shuffledCopy(CREATURE_FILES).slice(0, count);
    const gapPx = (CREATURE_GAP_PX_AT_1000 / 1000) * p.width; // scales with page width

    const { seaTop, seaBottom } = bandBounds();
    const seaH = seaBottom - seaTop;

    // convert the top/bottom fractions into actual pixel bounds for
    // this load (recomputed here since seaTop/seaBottom change on resize)
    const zoneTop = seaTop + CREATURE_ZONE_TOP_FRAC * seaH;
    const zoneBottom = seaTop + CREATURE_ZONE_BOTTOM_FRAC * seaH;
    const zoneH = Math.max(1, zoneBottom - zoneTop);

    // cut the allowed vertical range into one slice per creature,
    // then shuffle the slice order so it's not always the biggest
    // sprite landing in slice 0, smallest in the last slice, etc.
    const sliceOrder = shuffledCopy(chosenFiles.map((_, i) => i));

    chosenFiles.forEach((file, idx) => {
      const img = creatureImgs[file];
      const SCALE = 0.9; // thu nhỏ còn 50%
      const w = img.width * SCALE;
      const h = img.height * SCALE;
      const radius = Math.hypot(w, h) / 2; // half-diagonal, since rotation can point any side outward

      const sliceIndex = sliceOrder[idx];
      const sliceTop = zoneTop + (sliceIndex / count) * zoneH;
      const sliceBottom = zoneTop + ((sliceIndex + 1) / count) * zoneH;
      // a little vertical breathing room inside the slice so the
      // sprite doesn't sit flush against the slice boundary
      const padY = Math.min((sliceBottom - sliceTop) * 0.02, h * 0.1);
      const rowMin = Math.max(sliceTop + padY, seaTop + h / 2);
      const rowMax = Math.min(sliceBottom - padY, seaBottom - h / 2);

      let placed = false;
      for (let attempt = 0; attempt < CREATURE_PLACEMENT_TRIES && !placed; attempt++) {
        // pick a y within this creature's own slice (falls back to
        // the full zone if the slice collapsed to nothing, e.g. a
        // very tall sprite in a narrow slice)
        const cy = rowMin <= rowMax
          ? p.random(rowMin, rowMax)
          : p.random(Math.max(zoneTop, seaTop + h / 2), Math.min(zoneBottom, seaBottom - h / 2));

        // sample the river's actual width/centre at this y and bias
        // the x candidate toward that centreline, instead of a flat
        // random across the whole page — this is what keeps sprites
        // reading as "arranged along the river" rather than scattered
        const row = measureWaterRowAt(cy);
        let cx;
        if (row) {
          const halfSpan = (row.maxX - row.minX) * CREATURE_SIDEWAYS_JITTER_FRAC;
          cx = p.constrain(
            row.centerX + p.random(-halfSpan, halfSpan),
            w / 2,
            p.width - w / 2
          );
        } else {
          cx = p.random(w / 2, p.width - w / 2);
        }

        const rotation = p.random(-p.PI/6, p.PI/6); // mild tilt, not a full spin

        // must land entirely inside the real light-blue water
        if (!footprintInsideWater(cx, cy, w, h, img, rotation)) continue;

        // reject if too close to an already-placed creature
        const overlapsExisting = creatures.some((other) => {
          const d = Math.hypot(cx - other.x, cy - other.y);
          return d < radius + other.radius;
        });
        if (overlapsExisting) continue;

        creatures.push({
          img,
          x: cx,
          y: cy,
          w,
          h,
          radius,
          rotation,
          bobPhase: p.random(p.TWO_PI),    // gentle idle sway, like the bubbles
          bobSpeed: p.random(0.01, 0.02),
          bobAmp: p.random(2, 5),
        });
        placed = true;
      }
      // if it never found a free spot in its slice after all the
      // tries, it's simply skipped -- keeps the "some show, some
      // don't" generative feel instead of forcing an overlap
    });
  }

  // Draw the placed creatures with a light idle bob
  function drawCreatures() {
    p.push();
    p.imageMode(p.CENTER);
    for (const c of creatures) {
      c.bobPhase += c.bobSpeed;
      const dy = Math.sin(c.bobPhase) * c.bobAmp;

      p.push();
      p.translate(c.x, c.y + dy);
      p.rotate(c.rotation);
      p.image(c.img, 0, 0, c.w, c.h);
      p.pop();
    }
    p.pop();
    p.imageMode(p.CORNER); // restore default so it never leaks into other draw code
  }

  // Debug helper -- paints every light-blue pixel with a translucent
  // magenta wash so you can SEE the detected zone. Flip
  // DEBUG_SHOW_SEA_ZONE to true above, reload, compare against your
  // sea.png, then flip it back off.
  function drawSeaZoneDebug() {
    const { seaTop, seaBottom } = bandBounds();
    const step = 6; // check every few px instead of every px, for speed
    p.push();
    p.noStroke();
    p.fill(255, 0, 255, 90);
    for (let y = seaTop; y < seaBottom; y += step) {
      for (let x = 0; x < p.width; x += step) {
        if (isLightBlueWater(x, y)) {
          p.rect(x, y, step, step);
        }
      }
    }
    p.pop();
  }

  // ================================================================
  // Dark-navy "rac" creature placement + draw (second sticker set)
  //
  // Same overall approach as the light-blue system above: sample the
  // real pixels of sea.png to find the zone, erode the edge inward a
  // touch for safety, test the sprite's real (non-transparent)
  // silhouette against that zone, avoid overlaps, and re-roll on
  // every setup()/windowResized() so the layout changes each reload.
  // Original image size is kept as-is for this set (no SCALE factor).
  // ================================================================

  const DARK_ZONE_BRIGHTNESS_MAX = 90; // 0-255, average of r+g+b - dark navy is dim
  const DARK_ZONE_BLUE_BIAS_MIN = 8;   // how much bluer than red it must be
  const DARK_ZONE_EDGE_MARGIN_PX = 7;  // same idea as SEA_ZONE_EDGE_MARGIN_PX, own constant so nothing above is touched

  const MIN_DARK_CREATURES = 5;
  const MAX_DARK_CREATURES = 7;
  const DARK_CREATURE_PLACEMENT_TRIES = 500;

  // Vertical range the dark-navy stickers are allowed to land in, as
  // a fraction of the sea band's own height. The dark navy runs on
  // both sides of the light-blue river for most of the band's
  // height, so this range is a bit taller than the light-blue one.
  const DARK_CREATURE_ZONE_TOP_FRAC = 0.22;
  const DARK_CREATURE_ZONE_BOTTOM_FRAC = 0.55;

  // Sample sea.png's own pixels to test whether a canvas position
  // (x, y) lands on the dark navy background instead of the
  // light-blue river, the sand/sky bleed-through, or a torn white edge.
  function isDarkNavyWater(x, y) {
    const { seaTop } = bandBounds();
    const imgX = Math.round(x / scale);
    const imgY = Math.round((y - seaTop) / scale);

    if (imgX < 0 || imgX >= imgSea.width || imgY < 0 || imgY >= imgSea.height) {
      return false;
    }

    const c = imgSea.get(imgX, imgY);
    const brightness = (c[0] + c[1] + c[2]) / 3;
    const blueBias = c[2] - c[0];

    return brightness < DARK_ZONE_BRIGHTNESS_MAX && blueBias > DARK_ZONE_BLUE_BIAS_MIN;
  }

  // Same edge-erosion idea as isSafeWater(), for the dark-navy zone.
  function isSafeDarkWater(x, y) {
    const m = DARK_ZONE_EDGE_MARGIN_PX;
    return (
      isDarkNavyWater(x, y) &&
      isDarkNavyWater(x - m, y) &&
      isDarkNavyWater(x + m, y) &&
      isDarkNavyWater(x, y - m) &&
      isDarkNavyWater(x, y + m)
    );
  }

  // Same grid-footprint idea as footprintInsideWater(), checked
  // against the dark-navy zone instead of the light-blue one.
  function footprintInsideDarkWater(cx, cy, w, h, img, rotation) {
    const steps = CREATURE_FOOTPRINT_GRID_STEPS;
    const cosR = Math.cos(rotation);
    const sinR = Math.sin(rotation);
    for (let iy = 0; iy <= steps; iy++) {
      for (let ix = 0; ix <= steps; ix++) {
        const u = ix / steps;
        const v = iy / steps;

        const spX = Math.min(img.width - 1, Math.round(u * img.width));
        const spY = Math.min(img.height - 1, Math.round(v * img.height));
        const alpha = img.get(spX, spY)[3];
        if (alpha < CREATURE_SPRITE_ALPHA_MIN) continue;

        const lx = -w / 2 + u * w;
        const ly = -h / 2 + v * h;
        const px = cx + lx * cosR - ly * sinR;
        const py = cy + lx * sinR + ly * cosR;
        if (!isSafeDarkWater(px, py)) return false;
      }
    }
    return true;
  }

  // Picks a random 5-7 "rac" stickers and scatters them across the
  // dark-navy part of the sea band (both sides of the light-blue
  // river), using the same even-vertical-slice idea as
  // seedCreatures() so they don't clump. Called on setup + resize.
  function seedDarkCreatures() {
    darkCreatures = [];

    const count = Math.floor(p.random(MIN_DARK_CREATURES, MAX_DARK_CREATURES + 1));
    const chosenFiles = shuffledCopy(DARK_CREATURE_FILES).slice(0, count);

    const { seaTop, seaBottom } = bandBounds();
    const seaH = seaBottom - seaTop;

    const zoneTop = seaTop + DARK_CREATURE_ZONE_TOP_FRAC * seaH;
    const zoneBottom = seaTop + DARK_CREATURE_ZONE_BOTTOM_FRAC * seaH;
    const zoneH = Math.max(1, zoneBottom - zoneTop);

    const sliceOrder = shuffledCopy(chosenFiles.map((_, i) => i));

    chosenFiles.forEach((file, idx) => {
      const img = darkCreatureImgs[file];
      const w = img.width;   // original size, unchanged
      const h = img.height;  // original size, unchanged
      const radius = Math.hypot(w, h) / 2;

      const sliceIndex = sliceOrder[idx];
      const sliceTop = zoneTop + (sliceIndex / count) * zoneH;
      const sliceBottom = zoneTop + ((sliceIndex + 1) / count) * zoneH;
      const padY = Math.min((sliceBottom - sliceTop) * 0.02, h * 0.1);
      const rowMin = Math.max(sliceTop + padY, seaTop + h / 2);
      const rowMax = Math.min(sliceBottom - padY, seaBottom - h / 2);

      let placed = false;
      for (let attempt = 0; attempt < DARK_CREATURE_PLACEMENT_TRIES && !placed; attempt++) {
        const cy = rowMin <= rowMax
          ? p.random(rowMin, rowMax)
          : p.random(Math.max(zoneTop, seaTop + h / 2), Math.min(zoneBottom, seaBottom - h / 2));

        // the dark navy runs on both sides of the page at most y
        // values, so a plain random x (rather than a measured
        // centreline like the river creatures use) works fine here —
        // the footprint check below throws out anything that lands
        // on the river or a torn edge anyway
        const cx = p.random(w / 2, p.width - w / 2);
        const rotation = p.random(-p.PI / 10, p.PI / 10); // gentle tilt

        if (!footprintInsideDarkWater(cx, cy, w, h, img, rotation)) continue;

        const overlapsExisting = darkCreatures.some((other) => {
          const d = Math.hypot(cx - other.x, cy - other.y);
          return d < radius + other.radius;
        });
        if (overlapsExisting) continue;

        // also keep clear of the light-blue river creatures so the
        // two sticker sets never sit on top of each other
        const overlapsLightCreatures = creatures.some((other) => {
          const d = Math.hypot(cx - other.x, cy - other.y);
          return d < radius + other.radius;
        });
        if (overlapsLightCreatures) continue;

        darkCreatures.push({
          img,
          x: cx,
          y: cy,
          w,
          h,
          radius,
          rotation,
          bobPhase: p.random(p.TWO_PI),
          bobSpeed: p.random(0.01, 0.02),
          bobAmp: p.random(2, 5),
        });
        placed = true;
      }
      // if no free spot was found after all the tries, it's simply
      // skipped, same as the light-blue set does
    });
  }

  // Draw the placed dark-navy "rac" stickers with the same light
  // idle bob as the river creatures.
  function drawDarkCreatures() {
    p.push();
    p.imageMode(p.CENTER);
    for (const c of darkCreatures) {
      c.bobPhase += c.bobSpeed;
      const dy = Math.sin(c.bobPhase) * c.bobAmp;

      p.push();
      p.translate(c.x, c.y + dy);
      p.rotate(c.rotation);
      p.image(c.img, 0, 0, c.w, c.h);
      p.pop();
    }
    p.pop();
    p.imageMode(p.CORNER);
  }
};

new p5(sketch);