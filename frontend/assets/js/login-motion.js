export function initLoginScene(hero) {
  if (!hero) return;
  const canvas = hero.querySelector('.hero-canvas');
  if (!canvas) return;
  let ctx = null;
  try {
    ctx = canvas.getContext('2d');
  } catch (e) {
    return;
  }
  if (!ctx) return;

  const reduce = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false, addEventListener() {}, removeEventListener() {} };
  const colors = ['12,96,154', '36,158,213', '242,139,35', '16,59,90'];
  let width = 0;
  let height = 0;
  let dpr = 1;
  let particles = [];
  let raf = 0;
  let last = 0;
  let px = 0;
  let py = 0;
  let tx = 0;
  let ty = 0;
  let motionOK = !reduce.matches;

  const rand = (min, max) => min + Math.random() * (max - min);

  function seed() {
    const count = Math.min(80, Math.max(32, Math.round((width * height) / 18000)));
    particles = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      r: rand(0.7, 2.4),
      vx: rand(-0.09, 0.09),
      vy: rand(-0.07, 0.07),
      a: rand(0.14, 0.46),
      c: colors[Math.floor(Math.random() * colors.length)]
    }));
  }

  function draw(dt) {
    ctx.clearRect(0, 0, width, height);
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      if (dt > 0) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.x < -12) p.x = width + 12;
        else if (p.x > width + 12) p.x = -12;
        if (p.y < -12) p.y = height + 12;
        else if (p.y > height + 12) p.y = -12;
      }
      ctx.beginPath();
      ctx.fillStyle = 'rgba(' + p.c + ',' + p.a + ')';
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function resize() {
    const rect = hero.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
    draw(0);
  }

  function frame(time) {
    if (!canvas.isConnected) {
      cleanup();
      return;
    }
    const dt = last ? Math.min(32, time - last) / 16.6667 : 0;
    last = time;
    draw(dt);
    px += (tx - px) * 0.055;
    py += (ty - py) * 0.055;
    hero.style.setProperty('--px', px.toFixed(3));
    hero.style.setProperty('--py', py.toFixed(3));
    raf = requestAnimationFrame(frame);
  }

  function onMove(e) {
    const rect = hero.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    tx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
    ty = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
  }

  function onLeave() {
    tx = 0;
    ty = 0;
  }

  function onResize() {
    if (!canvas.isConnected) {
      window.removeEventListener('resize', onResize);
      return;
    }
    resize();
    if (!motionOK) draw(0);
  }

  function stopMotion() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
    hero.removeEventListener('pointermove', onMove);
    hero.removeEventListener('pointerleave', onLeave);
    px = 0;
    py = 0;
    tx = 0;
    ty = 0;
    hero.style.setProperty('--px', '0');
    hero.style.setProperty('--py', '0');
  }

  function cleanup() {
    stopMotion();
    window.removeEventListener('resize', onResize);
    if (reduce.removeEventListener) reduce.removeEventListener('change', onMotionChange);
  }

  function onMotionChange() {
    motionOK = !reduce.matches;
    if (motionOK) {
      hero.addEventListener('pointermove', onMove, { passive: true });
      hero.addEventListener('pointerleave', onLeave, { passive: true });
      raf = requestAnimationFrame(frame);
    } else {
      stopMotion();
      draw(0);
    }
  }

  resize();
  window.addEventListener('resize', onResize, { passive: true });
  if (reduce.addEventListener) reduce.addEventListener('change', onMotionChange);
  if (motionOK) {
    hero.addEventListener('pointermove', onMove, { passive: true });
    hero.addEventListener('pointerleave', onLeave, { passive: true });
    raf = requestAnimationFrame(frame);
  } else {
    hero.style.setProperty('--px', '0');
    hero.style.setProperty('--py', '0');
  }

  return cleanup;
}
