(() => {
  "use strict";

  const MOTION_QUERY = window.matchMedia("(prefers-reduced-motion: reduce)");
  const FORCED_COLORS_QUERY = window.matchMedia("(forced-colors: active)");
  const DPR_CAP = 2;
  const CYCLE_DURATION = 24000;
  const FRAME_INTERVAL = 1000 / 30;
  const PHASES = [
    { start: 0, duration: 2400, arc: 4 },
    { start: 2700, duration: 2500, arc: 3 },
    { start: 5550, duration: 2350, arc: 2 },
    { start: 8250, duration: 2550, arc: 1 },
    { start: 11150, duration: 2450, arc: 0 }
  ];
  const FINAL_PHASE = PHASES[PHASES.length - 1];
  const SEQUENCE_END = FINAL_PHASE.start + FINAL_PHASE.duration;

  const STAR_COLORS = {
    cream: [235, 231, 222],
    white: [244, 244, 239],
    amber: [193, 137, 87],
    slate: [112, 145, 174],
    blue: [100, 136, 181]
  };
  const ARC_COLORS = [
    [181, 125, 82],
    [185, 153, 91],
    [83, 132, 128],
    [87, 116, 150],
    [107, 94, 141]
  ];
  const RECOGNITION_COLORS = [
    [237, 226, 210],
    [205, 154, 99],
    [132, 164, 190]
  ];

  const clamp = (value, minimum, maximum) =>
    Math.min(maximum, Math.max(minimum, value));

  const mix = (start, end, amount) =>
    start + (end - start) * amount;

  const smoothstep = (value) => {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
  };

  const rgba = (color, alpha) =>
    `rgba(${color[0]},${color[1]},${color[2]},${alpha})`;

  const mulberry32 = (seed) => {
    let state = seed >>> 0;
    return () => {
      state += 0x6d2b79f5;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  };

  const gaussian = (random) => {
    let total = 0;
    for (let index = 0; index < 6; index += 1) total += random();
    return total / 3 - 1;
  };

  const chooseColor = (random, layer) => {
    const value = random();
    if (layer === "anchor") {
      if (value < 0.42) return STAR_COLORS.white;
      if (value < 0.66) return STAR_COLORS.cream;
      if (value < 0.83) return STAR_COLORS.amber;
      return value < 0.94 ? STAR_COLORS.slate : STAR_COLORS.blue;
    }
    if (value < 0.72) return STAR_COLORS.cream;
    if (value < 0.84) return STAR_COLORS.white;
    if (value < 0.92) return STAR_COLORS.slate;
    return STAR_COLORS.amber;
  };

  const cubicPoint = (path, t) => {
    const inverse = 1 - t;
    const inverseSquared = inverse * inverse;
    const tSquared = t * t;
    return {
      x:
        inverseSquared * inverse * path.x0 +
        3 * inverseSquared * t * path.x1 +
        3 * inverse * tSquared * path.x2 +
        tSquared * t * path.x3,
      y:
        inverseSquared * inverse * path.y0 +
        3 * inverseSquared * t * path.y1 +
        3 * inverse * tSquared * path.y2 +
        tSquared * t * path.y3
    };
  };

  class SignalField {
    constructor(canvas) {
      this.canvas = canvas;
      this.section = canvas.parentElement;
      this.mode = canvas.dataset.signalField || "ambient";
      this.context = canvas.getContext("2d", { alpha: true });
      this.width = 0;
      this.height = 0;
      this.dpr = 1;
      this.stars = [];
      this.arcs = [];
      this.recognitions = [];
      this.buffer = document.createElement("canvas");
      this.bufferContext = this.buffer.getContext("2d", { alpha: true });
      this.isVisible = false;
      this.isReduced = MOTION_QUERY.matches;
      this.isForcedColors = FORCED_COLORS_QUERY.matches;
      this.rafId = null;
      this.resizeRaf = null;
      this.cycleStart = 0;
      this.lastFrame = 0;
      this.quietFrameDrawn = false;

      if (!this.context || !this.bufferContext) return;

      this.queueResize = this.queueResize.bind(this);
      this.tick = this.tick.bind(this);

      if ("ResizeObserver" in window) {
        this.resizeObserver = new ResizeObserver(this.queueResize);
        this.resizeObserver.observe(this.section);
      } else {
        window.addEventListener("resize", this.queueResize, { passive: true });
      }

      if ("IntersectionObserver" in window) {
        this.visibilityObserver = new IntersectionObserver(
          (entries) => {
            const entry = entries[0];
            this.setVisible(Boolean(entry && entry.isIntersecting));
          },
          { rootMargin: "120px 0px", threshold: 0 }
        );
        this.visibilityObserver.observe(this.section);
      } else {
        this.setVisible(true);
      }

      this.resize();
    }

    queueResize() {
      if (this.resizeRaf !== null) cancelAnimationFrame(this.resizeRaf);
      this.resizeRaf = requestAnimationFrame(() => {
        this.resizeRaf = requestAnimationFrame(() => {
          this.resizeRaf = null;
          this.resize();
        });
      });
    }

    resize() {
      const bounds = this.section.getBoundingClientRect();
      const width = Math.max(1, Math.round(bounds.width));
      const height = Math.max(1, Math.round(bounds.height));
      const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);

      if (
        width === this.width &&
        height === this.height &&
        dpr === this.dpr
      ) {
        return;
      }

      this.width = width;
      this.height = height;
      this.dpr = dpr;
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
      this.buffer.width = this.canvas.width;
      this.buffer.height = this.canvas.height;
      this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.bufferContext.setTransform(dpr, 0, 0, dpr, 0, 0);

      this.buildScene();
      this.drawStaticScene();
      this.render();

      if (this.mode === "hero" && this.shouldAnimate()) this.start();
    }

    buildScene() {
      const dimensionSeed =
        Math.round(this.width / 24) * 131 +
        Math.round(this.height / 24) * 17;
      const baseSeed = this.mode === "hero" ? 0x51a6f37 : 0x21c0a57;
      const random = mulberry32(baseSeed ^ dimensionSeed);
      const area = this.width * this.height;
      const responsiveDensity =
        this.width < 480 ? 0.66 : this.width < 800 ? 0.78 : this.width < 1100 ? 0.9 : 1;
      const modeDensity = this.mode === "hero" ? 1 : 0.44;
      const density = responsiveDensity * modeDensity;

      const microCount = clamp(
        Math.round((area / 250) * density),
        this.mode === "hero" ? 720 : 240,
        this.mode === "hero" ? 5200 : 1450
      );
      const mediumCount = clamp(
        Math.round((area / 1600) * density),
        this.mode === "hero" ? 130 : 44,
        this.mode === "hero" ? 820 : 280
      );
      const anchorCount = clamp(
        Math.round((area / 40000) * density),
        this.mode === "hero" ? 7 : 3,
        this.mode === "hero" ? 36 : 12
      );

      this.copyBounds = this.getCopyBounds();
      this.stars = [];
      this.createStars(random, microCount, "micro");
      this.createStars(random, mediumCount, "medium");
      this.createStars(random, anchorCount, "anchor");
      this.arcs = this.mode === "hero" ? this.createArcs() : [];
      this.recognitions =
        this.mode === "hero" ? this.selectRecognitions(random) : [];

      this.canvas.dataset.starCount = String(this.stars.length);
      this.canvas.dataset.recognizedCount = String(
        this.recognitions.reduce((total, group) => total + group.length, 0)
      );
      this.canvas.dataset.dpr = String(this.dpr);
      this.canvas.dataset.motion = this.isReduced ? "reduced" : "full";
    }

    getCopyBounds() {
      if (this.mode !== "hero") return null;
      const sectionBounds = this.section.getBoundingClientRect();
      const content = Array.from(this.section.children).filter(
        (element) => element !== this.canvas
      );
      const rectangles = content.map((element) => element.getBoundingClientRect());
      if (rectangles.length === 0) return null;

      return {
        left: Math.max(
          0,
          Math.min(...rectangles.map((rectangle) => rectangle.left)) -
            sectionBounds.left -
            18
        ),
        top: Math.max(
          0,
          Math.min(...rectangles.map((rectangle) => rectangle.top)) -
            sectionBounds.top -
            18
        ),
        right: Math.min(
          this.width,
          Math.max(...rectangles.map((rectangle) => rectangle.right)) -
            sectionBounds.left +
            22
        ),
        bottom: Math.min(
          this.height,
          Math.max(...rectangles.map((rectangle) => rectangle.bottom)) -
            sectionBounds.top +
            22
        )
      };
    }

    createStars(random, count, layer) {
      const clusters = [
        { x: 0.82, y: 0.21, spreadX: 0.16, spreadY: 0.16 },
        { x: 0.78, y: 0.68, spreadX: 0.18, spreadY: 0.2 },
        { x: 0.44, y: 0.16, spreadX: 0.18, spreadY: 0.11 },
        { x: 0.34, y: 0.84, spreadX: 0.2, spreadY: 0.14 },
        { x: 0.61, y: 0.47, spreadX: 0.16, spreadY: 0.19 }
      ];

      for (let index = 0; index < count; index += 1) {
        let normalizedX = random();
        let normalizedY = random();

        if (random() < (layer === "micro" ? 0.34 : 0.27)) {
          const cluster =
            clusters[Math.floor(random() * clusters.length) % clusters.length];
          normalizedX = clamp(
            cluster.x + gaussian(random) * cluster.spreadX,
            0.006,
            0.994
          );
          normalizedY = clamp(
            cluster.y + gaussian(random) * cluster.spreadY,
            0.006,
            0.994
          );
        }

        const x = normalizedX * this.width;
        const y = normalizedY * this.height;
        const insideCopy = this.isInsideCopy(x, y);
        let radius;
        let alpha;

        if (layer === "micro") {
          radius = mix(0.42, 0.82, random());
          alpha = mix(0.1, 0.34, random());
          if (insideCopy) alpha *= 0.36;
        } else if (layer === "medium") {
          radius = mix(0.68, 1.25, random());
          alpha = mix(0.24, 0.58, random());
          if (insideCopy) alpha *= 0.3;
        } else {
          radius = mix(1.1, 1.85, random());
          alpha = mix(0.46, 0.84, random());
          if (insideCopy) alpha *= 0.2;
        }

        this.stars.push({
          x,
          y,
          radius,
          alpha,
          color: chooseColor(random, layer),
          layer,
          insideCopy
        });
      }
    }

    isInsideCopy(x, y) {
      const bounds = this.copyBounds;
      return Boolean(
        bounds &&
          x >= bounds.left &&
          x <= bounds.right &&
          y >= bounds.top &&
          y <= bounds.bottom
      );
    }

    createArcs() {
      const isMobile = this.width < 600;
      const isTablet = this.width >= 600 && this.width < 1000;
      const gap = clamp(
        this.height * (isMobile ? 0.015 : 0.018),
        isMobile ? 10 : 12,
        isMobile ? 14 : 18
      );
      const startX =
        this.width * (isMobile ? 0.46 : isTablet ? 0.51 : 0.56);
      const endX = this.width * 1.055;
      const span = endX - startX;
      const startY = this.height * (isMobile ? 0.73 : 0.69);
      const endY = this.height * (isMobile ? 0.61 : 0.56);
      const controlY1 = this.height * (isMobile ? 0.51 : 0.39);
      const controlY2 = this.height * (isMobile ? 0.46 : 0.34);

      return ARC_COLORS.map((color, index) => {
        const inset = index * gap;
        return {
          color,
          x0: startX + inset * 0.95,
          y0: startY + inset * 0.85,
          x1: startX + span * 0.28 + inset * 0.35,
          y1: controlY1 + inset * 0.88,
          x2: startX + span * 0.66 + inset * 0.1,
          y2: controlY2 + inset * 0.75,
          x3: endX + inset * 0.04,
          y3: endY + inset * 0.74
        };
      });
    }

    selectRecognitions(random) {
      const perArc = this.width < 1000 ? 1 : 2;
      const maxDistance = this.width < 600 ? 28 : 36;
      const groups = this.arcs.map(() => []);
      const selected = new Set();
      const primaryCandidates = this.stars.filter(
        (star) => star.layer !== "micro" && !star.insideCopy
      );
      const fallbackCandidates = this.stars;

      this.arcs.forEach((arc, arcIndex) => {
        const rankCandidates = (candidates) =>
          candidates
            .filter((star) => !selected.has(star))
            .map((star) => {
              let nearestDistance = Infinity;
              let nearestT = 0;
              for (let sample = 2; sample <= 28; sample += 1) {
                const t = sample / 30;
                const point = cubicPoint(arc, t);
                const distance = Math.hypot(star.x - point.x, star.y - point.y);
                if (distance < nearestDistance) {
                  nearestDistance = distance;
                  nearestT = t;
                }
              }
              return {
                star,
                distance: nearestDistance,
                t: nearestT,
                jitter: random() * 6
              };
            })
            .filter((candidate) => candidate.distance <= maxDistance)
            .sort(
              (left, right) =>
                left.distance + left.jitter - (right.distance + right.jitter)
            );

        let candidates = rankCandidates(primaryCandidates);
        if (candidates.length < perArc) {
          candidates = candidates.concat(rankCandidates(fallbackCandidates));
        }

        for (const candidate of candidates) {
          if (groups[arcIndex].length >= perArc) break;
          const separated = groups[arcIndex].every(
            (recognition) => Math.abs(recognition.t - candidate.t) > 0.16
          );
          if (!separated || selected.has(candidate.star)) continue;
          selected.add(candidate.star);
          groups[arcIndex].push({
            star: candidate.star,
            t: candidate.t,
            color:
              RECOGNITION_COLORS[
                (arcIndex + groups[arcIndex].length) %
                  RECOGNITION_COLORS.length
              ]
          });
        }
      });

      return groups;
    }

    drawStaticScene() {
      const context = this.bufferContext;
      context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      context.clearRect(0, 0, this.width, this.height);
      this.drawHaze(context);

      for (const star of this.stars) this.drawStar(context, star);

      if (this.mode === "hero") {
        const mobileIntensity = this.width < 600 ? 0.78 : 1;
        for (const arc of this.arcs) {
          this.traceArc(context, arc);
          context.strokeStyle = rgba(arc.color, 0.045 * mobileIntensity);
          context.lineWidth = this.width < 600 ? 3.2 : 4.4;
          context.stroke();

          this.traceArc(context, arc);
          context.strokeStyle = rgba(arc.color, 0.34 * mobileIntensity);
          context.lineWidth = this.width < 600 ? 0.85 : 1.05;
          context.stroke();
        }
      }
    }

    drawHaze(context) {
      const slate = context.createRadialGradient(
        this.width * 0.78,
        this.height * 0.42,
        0,
        this.width * 0.78,
        this.height * 0.42,
        this.width * 0.5
      );
      slate.addColorStop(0, "rgba(105,132,155,.045)");
      slate.addColorStop(1, "rgba(105,132,155,0)");
      context.fillStyle = slate;
      context.fillRect(0, 0, this.width, this.height);

      const amber = context.createRadialGradient(
        this.width * 0.22,
        this.height * 0.52,
        0,
        this.width * 0.22,
        this.height * 0.52,
        this.width * 0.34
      );
      amber.addColorStop(0, "rgba(188,137,91,.026)");
      amber.addColorStop(1, "rgba(188,137,91,0)");
      context.fillStyle = amber;
      context.fillRect(0, 0, this.width, this.height);
    }

    drawStar(context, star) {
      if (star.layer === "anchor") {
        const haloRadius = star.radius * 4.4;
        const halo = context.createRadialGradient(
          star.x,
          star.y,
          0,
          star.x,
          star.y,
          haloRadius
        );
        halo.addColorStop(0, rgba(star.color, star.alpha * 0.42));
        halo.addColorStop(0.25, rgba(star.color, star.alpha * 0.16));
        halo.addColorStop(1, rgba(star.color, 0));
        context.fillStyle = halo;
        context.beginPath();
        context.arc(star.x, star.y, haloRadius, 0, Math.PI * 2);
        context.fill();
      }

      context.fillStyle = rgba(star.color, star.alpha);
      context.beginPath();
      context.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
      context.fill();
    }

    traceArc(context, arc) {
      context.beginPath();
      context.moveTo(arc.x0, arc.y0);
      context.bezierCurveTo(
        arc.x1,
        arc.y1,
        arc.x2,
        arc.y2,
        arc.x3,
        arc.y3
      );
    }

    traceArcSegment(context, arc, startT, endT, samples = 9) {
      context.beginPath();
      for (let index = 0; index <= samples; index += 1) {
        const t = mix(startT, endT, index / samples);
        const point = cubicPoint(arc, t);
        if (index === 0) context.moveTo(point.x, point.y);
        else context.lineTo(point.x, point.y);
      }
    }

    getActivePhase(elapsed) {
      for (const phase of PHASES) {
        if (elapsed >= phase.start && elapsed <= phase.start + phase.duration) {
          return {
            arc: phase.arc,
            progress: (elapsed - phase.start) / phase.duration
          };
        }
      }
      return null;
    }

    drawActiveSignal(active) {
      const arc = this.arcs[active.arc];
      if (!arc) return;
      const context = this.context;
      const progress = smoothstep(active.progress);
      const intensity = Math.pow(Math.sin(Math.PI * progress), 1.05);
      const signalT = mix(0.04, 0.94, progress);

      this.traceArc(context, arc);
      context.strokeStyle = rgba(arc.color, 0.11 * intensity);
      context.lineWidth = this.width < 600 ? 4.2 : 5.4;
      context.stroke();

      this.traceArc(context, arc);
      context.strokeStyle = rgba(arc.color, 0.46 * intensity);
      context.lineWidth = this.width < 600 ? 1.1 : 1.35;
      context.stroke();

      const trailStart = clamp(signalT - 0.035, 0, 1);
      this.traceArcSegment(context, arc, trailStart, signalT);
      context.strokeStyle = rgba(STAR_COLORS.cream, 0.44 * intensity);
      context.lineWidth = this.width < 600 ? 1.1 : 1.4;
      context.stroke();

      const point = cubicPoint(arc, signalT);
      const pointRadius = this.width < 600 ? 5 : 6.5;
      const glow = context.createRadialGradient(
        point.x,
        point.y,
        0,
        point.x,
        point.y,
        pointRadius
      );
      glow.addColorStop(0, rgba(STAR_COLORS.white, 0.82 * intensity));
      glow.addColorStop(0.26, rgba(STAR_COLORS.cream, 0.28 * intensity));
      glow.addColorStop(1, rgba(STAR_COLORS.cream, 0));
      context.fillStyle = glow;
      context.beginPath();
      context.arc(point.x, point.y, pointRadius, 0, Math.PI * 2);
      context.fill();

      context.fillStyle = rgba(STAR_COLORS.cream, 0.92 * intensity);
      context.beginPath();
      context.arc(
        point.x,
        point.y,
        this.width < 600 ? 0.95 : 1.2,
        0,
        Math.PI * 2
      );
      context.fill();

      this.drawRecognitions(active.arc, signalT, intensity);
    }

    drawRecognitions(arcIndex, signalT, phaseIntensity) {
      const context = this.context;
      const recognitions = this.recognitions[arcIndex] || [];

      for (const recognition of recognitions) {
        const delta = signalT - recognition.t;
        if (delta < -0.045 || delta > 0.14) continue;
        const centered = 1 - Math.abs(delta - 0.035) / 0.105;
        const strength = smoothstep(centered) * phaseIntensity;
        if (strength <= 0) continue;

        const star = recognition.star;
        const haloRadius = 4.5 + star.radius * 2.5;
        const halo = context.createRadialGradient(
          star.x,
          star.y,
          0,
          star.x,
          star.y,
          haloRadius
        );
        halo.addColorStop(0, rgba(recognition.color, 0.34 * strength));
        halo.addColorStop(0.28, rgba(recognition.color, 0.12 * strength));
        halo.addColorStop(1, rgba(recognition.color, 0));
        context.fillStyle = halo;
        context.beginPath();
        context.arc(star.x, star.y, haloRadius, 0, Math.PI * 2);
        context.fill();

        context.fillStyle = rgba(recognition.color, 0.72 * strength);
        context.beginPath();
        context.arc(
          star.x,
          star.y,
          Math.max(0.8, star.radius * 0.88),
          0,
          Math.PI * 2
        );
        context.fill();
      }
    }

    render(active = null) {
      const context = this.context;
      this.canvas.dataset.activeArc = active ? String(active.arc) : "quiet";
      context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      context.clearRect(0, 0, this.width, this.height);
      context.drawImage(
        this.buffer,
        0,
        0,
        this.buffer.width,
        this.buffer.height,
        0,
        0,
        this.width,
        this.height
      );
      if (active && !this.isReduced && !this.isForcedColors) {
        this.drawActiveSignal(active);
      }
    }

    tick(timestamp) {
      if (this.rafId === null) return;
      this.rafId = requestAnimationFrame(this.tick);

      if (timestamp - this.lastFrame < FRAME_INTERVAL) return;
      this.lastFrame = timestamp;
      const elapsed = (timestamp - this.cycleStart) % CYCLE_DURATION;

      if (elapsed >= SEQUENCE_END) {
        if (!this.quietFrameDrawn) {
          this.render();
          this.quietFrameDrawn = true;
        }
        return;
      }

      this.quietFrameDrawn = false;
      this.render(this.getActivePhase(elapsed));
    }

    shouldAnimate() {
      return (
        this.mode === "hero" &&
        this.isVisible &&
        !this.isReduced &&
        !this.isForcedColors &&
        !document.hidden
      );
    }

    start() {
      if (!this.shouldAnimate() || this.rafId !== null) return;
      this.cycleStart = performance.now();
      this.lastFrame = 0;
      this.quietFrameDrawn = false;
      this.rafId = requestAnimationFrame(this.tick);
    }

    stop() {
      if (this.rafId !== null) cancelAnimationFrame(this.rafId);
      this.rafId = null;
      this.render();
    }

    setVisible(isVisible) {
      this.isVisible = isVisible;
      if (this.shouldAnimate()) this.start();
      else this.stop();
    }

    setPreferences({ reduced, forcedColors }) {
      this.isReduced = reduced;
      this.isForcedColors = forcedColors;
      this.canvas.dataset.motion = reduced ? "reduced" : "full";
      if (this.shouldAnimate()) this.start();
      else this.stop();
    }
  }

  const initWordmark = () => {
    const brand = document.querySelector(".brand");
    const sections = Array.from(document.querySelectorAll("main > section"));
    if (!brand || sections.length === 0) return;

    const tones = [
      "hero",
      "problem",
      "hypothesis",
      "beta",
      "success",
      "principles",
      "decisions",
      "role",
      "closing"
    ];
    let activeIndex = -1;

    const applyTone = (index) => {
      const nextIndex = clamp(index, 0, sections.length - 1);
      if (nextIndex === activeIndex) return;
      activeIndex = nextIndex;
      brand.dataset.tone = tones[nextIndex] || "hero";
    };

    const findActiveSection = () => {
      const probe = window.innerHeight * 0.28;
      let nearestIndex = 0;
      let nearestDistance = Infinity;

      sections.forEach((section, index) => {
        const bounds = section.getBoundingClientRect();
        if (bounds.top <= probe && bounds.bottom > probe) {
          nearestIndex = index;
          nearestDistance = 0;
          return;
        }
        const distance = Math.min(
          Math.abs(bounds.top - probe),
          Math.abs(bounds.bottom - probe)
        );
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      });

      applyTone(nearestIndex);
    };

    brand.dataset.tone = "hero";
    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver(findActiveSection, {
        rootMargin: "-18% 0px -67% 0px",
        threshold: 0
      });
      sections.forEach((section) => observer.observe(section));
    } else {
      let scheduled = false;
      const schedule = () => {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
          scheduled = false;
          findActiveSection();
        });
      };
      window.addEventListener("scroll", schedule, { passive: true });
      window.addEventListener("resize", schedule, { passive: true });
    }

    window.addEventListener("hashchange", findActiveSection);
    requestAnimationFrame(findActiveSection);
  };

  const fields = Array.from(
    document.querySelectorAll("[data-signal-field]")
  ).map((canvas) => new SignalField(canvas));

  const updatePreferences = () => {
    const preferences = {
      reduced: MOTION_QUERY.matches,
      forcedColors: FORCED_COLORS_QUERY.matches
    };
    fields.forEach((field) => field.setPreferences(preferences));
  };

  const addMediaListener = (query) => {
    if ("addEventListener" in query) query.addEventListener("change", updatePreferences);
    else query.addListener(updatePreferences);
  };

  addMediaListener(MOTION_QUERY);
  addMediaListener(FORCED_COLORS_QUERY);
  document.addEventListener("visibilitychange", updatePreferences);

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => fields.forEach((field) => field.queueResize()));
  }

  initWordmark();
  if (fields.some((field) => field.context && field.bufferContext)) {
    document.documentElement.classList.add("visual-system-ready");
  }
})();
