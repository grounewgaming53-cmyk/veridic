/* === PREMIUM ENHANCEMENTS JS === */
document.addEventListener('DOMContentLoaded', () => {

  // --- Scroll Progress Bar ---
  const prog = document.querySelector('.scroll-progress');
  if (prog) {
    window.addEventListener('scroll', () => {
      const h = document.documentElement.scrollHeight - window.innerHeight;
      prog.style.width = h > 0 ? (window.scrollY / h * 100) + '%' : '0%';
    }, { passive: true });
  }

  // --- Active Nav Link Highlighting ---
  const sections = document.querySelectorAll('section[id]');
  const navLinks = document.querySelectorAll('.nav-links a');
  const highlightNav = () => {
    const scrollY = window.scrollY + 120;
    sections.forEach(sec => {
      const top = sec.offsetTop, h = sec.offsetHeight, id = sec.getAttribute('id');
      if (scrollY >= top && scrollY < top + h) {
        navLinks.forEach(a => {
          a.classList.toggle('active', a.getAttribute('href') === '#' + id);
        });
      }
    });
  };
  window.addEventListener('scroll', highlightNav, { passive: true });

  // --- Particle Background ---
  const canvas = document.getElementById('particleCanvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    let w, h, particles = [];
    const resize = () => { w = canvas.width = window.innerWidth; h = canvas.height = window.innerHeight; };
    resize();
    window.addEventListener('resize', resize);
    const count = Math.min(60, Math.floor(window.innerWidth / 25));
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.3,
        r: Math.random() * 1.5 + 0.5,
        o: Math.random() * 0.4 + 0.1
      });
    }
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      particles.forEach(p => {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = w; if (p.x > w) p.x = 0;
        if (p.y < 0) p.y = h; if (p.y > h) p.y = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(245,158,11,${p.o})`;
        ctx.fill();
      });
      // Draw connections
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 120) {
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `rgba(245,158,11,${0.06 * (1 - dist / 120)})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }
      requestAnimationFrame(draw);
    };
    draw();
  }

  // --- FAQ Accordion ---
  document.querySelectorAll('.faq-question').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.parentElement;
      const wasActive = item.classList.contains('active');
      document.querySelectorAll('.faq-item').forEach(i => i.classList.remove('active'));
      if (!wasActive) item.classList.add('active');
    });
  });

  // --- Terminal Typing Effect ---
  const termBody = document.querySelector('.terminal-body');
  if (termBody) {
    const lines = termBody.querySelectorAll('.line');
    const originals = [];
    lines.forEach((line, i) => {
      originals.push(line.innerHTML);
      line.innerHTML = '';
      line.style.visibility = 'hidden';
    });
    const typewriterObs = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          typeLines(lines, originals, 0);
          typewriterObs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.3 });
    typewriterObs.observe(termBody);
  }

  function typeLines(lines, originals, idx) {
    if (idx >= lines.length) return;
    const line = lines[idx];
    const html = originals[idx];
    line.style.visibility = 'visible';
    if (!html.trim()) {
      line.innerHTML = '&nbsp;';
      setTimeout(() => typeLines(lines, originals, idx + 1), 100);
      return;
    }
    // For lines with HTML tags, just fade in quickly
    line.style.opacity = '0';
    line.innerHTML = html;
    line.style.transition = 'opacity 0.3s ease';
    requestAnimationFrame(() => { line.style.opacity = '1'; });
    setTimeout(() => typeLines(lines, originals, idx + 1), 350);
  }

  // --- Stagger feature cards on scroll ---
  const cards = document.querySelectorAll('.feature-card.fade-in, .cap-item.fade-in, .uc-card.fade-in');
  cards.forEach((card, i) => {
    card.style.transitionDelay = (i % 3) * 0.1 + 's';
  });

});
