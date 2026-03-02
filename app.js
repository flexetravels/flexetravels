/* ============================================================
   FlexeTravels — Interactive JavaScript
   Hero Carousel, Tours, AI Chat Widget, Scroll Animations
   Connected to FastAPI + Claude AI Backend
   ============================================================ */

// ────────────────────────────────────────────────────────
// Dynamic Featured Tours — render tour card HTML from API data
// ────────────────────────────────────────────────────────
function renderTourCard(t) {
  const badgeClass = t.badge_type === 'ai' ? 'tour-card__badge--ai' : '';
  const badge = t.badge
    ? `<span class="tour-card__badge ${badgeClass}">${t.badge}</span>`
    : '';
  const imgSrc = t.image_url || 'https://images.unsplash.com/photo-1488085061851-d223a4463480?w=600&h=400&fit=crop';
  const tagline = (t.tagline || '').replace(/"/g, '&quot;');
  return `
    <div class="tour-card"
      data-title="${(t.title || '').replace(/"/g, '&quot;')}"
      data-destination="${(t.destination || '').replace(/"/g, '&quot;')}"
      data-country="${(t.country || '').replace(/"/g, '&quot;')}"
      data-price="${t.price_from || 0}"
      data-duration="${t.duration_days || 7}"
      data-tagline="${tagline}">
      <div class="tour-card__image">
        <img src="${imgSrc}" alt="${t.destination || 'Destination'}" loading="lazy"
          onerror="this.src='https://images.unsplash.com/photo-1488085061851-d223a4463480?w=600&h=400&fit=crop'">
        ${badge}
        <button class="tour-card__save" aria-label="Save">♡</button>
      </div>
      <div class="tour-card__body">
        <div class="tour-card__meta">
          <span>🕐 ${t.duration_days || 7} days</span>
          <span>📍 ${t.country || t.destination || ''}</span>
        </div>
        <h3 class="tour-card__title">${t.title || t.destination}</h3>
        <p class="tour-card__route">${t.route || t.tagline || ''}</p>
        <div class="tour-card__footer">
          <div class="tour-card__price">
            <span class="tour-card__price-label">From</span>
            <span class="tour-card__price-value">$${(t.price_from || 0).toLocaleString()}</span>
          </div>
          <div class="tour-card__rating">⭐ ${t.rating || '4.8'}</div>
        </div>
      </div>
    </div>`;
}

function attachTourCardHandlers() {
  // Save / favourite toggle
  document.querySelectorAll('.tour-card__save').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      btn.textContent = btn.textContent === '♡' ? '♥' : '♡';
      btn.style.color = btn.textContent === '♥' ? '#ff2828' : '';
    });
  });
  // Card click → open chat with tour details
  document.querySelectorAll('.tour-card:not(.tour-card--skeleton)').forEach(card => {
    card.addEventListener('click', () => {
      const title = card.dataset.title || card.querySelector('.tour-card__title')?.textContent || '';
      const dest = card.dataset.destination || '';
      const duration = card.dataset.duration || '7';
      const price = card.dataset.price ? `$${Number(card.dataset.price).toLocaleString()}` : '';
      const tagline = card.dataset.tagline || '';
      if (title) {
        if (!chatPanel.classList.contains('open')) toggleChat();
        setTimeout(() => {
          const msg = `I'm interested in the "${title}" tour to ${dest} for ${duration} days${price ? ` starting from ${price}` : ''}. ${tagline ? tagline + '. ' : ''}Can you help me plan this trip with real pricing?`;
          sendChatMessage(msg);
        }, 400);
      }
    });
  });
}

async function fetchFeaturedTours() {
  const carousel = document.getElementById('tours-carousel');
  const label = document.getElementById('tours-location-label');
  if (!carousel) {
    console.error('❌ tours-carousel element not found');
    return;
  }
  try {
    console.log('🚀 Fetching featured tours from http://localhost:8000/api/featured-tours');
    const res = await fetch(`http://localhost:8000/api/featured-tours`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    console.log('✅ Featured tours API response:', data);
    if (data.tours && data.tours.length > 0) {
      // Update location label
      const city = data.location?.city;
      const country = data.location?.country;
      if (city && label) {
        const newLabel = `Trending for visitors from ${city}${country ? ', ' + country : ''}`;
        console.log('📍 Updating location label:', newLabel);
        label.textContent = newLabel;
      }
      // Render dynamic cards
      console.log(`📦 Rendering ${data.tours.length} dynamic tour cards`);
      carousel.innerHTML = data.tours.map(renderTourCard).join('');
      attachTourCardHandlers();
      console.log('✅ Dynamic tours rendered successfully!');
    }
  } catch (e) {
    console.error('❌ Featured tours API error:', e);
    console.warn('Keeping skeleton cards as fallback');
    // Skeleton cards remain as graceful fallback
  }
}

document.addEventListener('DOMContentLoaded', () => {

  // ── Config ──────────────────────────────────────────────
  const API_BASE = 'http://localhost:8000';
  let sessionId = null;
  let currentPhase = 'chat';

  // ── Fetch dynamic featured tours on page load ──────────
  fetchFeaturedTours();

  // ────────────────────────────────────────
  // 1. Hero Image Carousel
  // ────────────────────────────────────────
  const heroSlides = document.querySelectorAll('.hero__slide');
  const heroDots = document.querySelectorAll('.hero__dot');
  let heroIndex = 0;
  let heroInterval;

  function showHeroSlide(index) {
    heroSlides.forEach(s => s.classList.remove('active'));
    heroDots.forEach(d => d.classList.remove('active'));
    heroSlides[index].classList.add('active');
    heroDots[index].classList.add('active');
    heroIndex = index;
  }

  function nextHeroSlide() {
    showHeroSlide((heroIndex + 1) % heroSlides.length);
  }

  function startHeroAutoplay() {
    heroInterval = setInterval(nextHeroSlide, 5000);
  }

  heroDots.forEach(dot => {
    dot.addEventListener('click', () => {
      clearInterval(heroInterval);
      showHeroSlide(parseInt(dot.dataset.slide));
      startHeroAutoplay();
    });
  });

  startHeroAutoplay();

  // ────────────────────────────────────────
  // 2. Navigation — Sticky Shadow + Mobile Menu
  // ────────────────────────────────────────
  const nav = document.getElementById('nav');
  const hamburger = document.getElementById('hamburger');
  const mobileDrawer = document.getElementById('mobile-drawer');

  window.addEventListener('scroll', () => {
    nav.classList.toggle('scrolled', window.scrollY > 10);
  });

  hamburger.addEventListener('click', () => {
    hamburger.classList.toggle('active');
    mobileDrawer.classList.toggle('open');
    document.body.style.overflow = mobileDrawer.classList.contains('open') ? 'hidden' : '';
  });

  mobileDrawer.querySelectorAll('.nav__link').forEach(link => {
    link.addEventListener('click', () => {
      hamburger.classList.remove('active');
      mobileDrawer.classList.remove('open');
      document.body.style.overflow = '';
    });
  });

  // ────────────────────────────────────────
  // 3. Tours Carousel — Horizontal Scroll
  // ────────────────────────────────────────
  const toursCarousel = document.getElementById('tours-carousel');
  const toursPrev = document.getElementById('tours-prev');
  const toursNext = document.getElementById('tours-next');
  const scrollAmount = 320;

  toursPrev.addEventListener('click', () => {
    toursCarousel.scrollBy({ left: -scrollAmount, behavior: 'smooth' });
  });

  toursNext.addEventListener('click', () => {
    toursCarousel.scrollBy({ left: scrollAmount, behavior: 'smooth' });
  });

  const toursTabs = document.querySelectorAll('.tours__tab');
  toursTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      toursTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      toursCarousel.scrollTo({ left: 0, behavior: 'smooth' });
    });
  });

  // ────────────────────────────────────────
  // 4. Testimonials Carousel
  // ────────────────────────────────────────
  const testimonials = document.querySelectorAll('.testimonial');
  const testimonialDots = document.querySelectorAll('.testimonials__dot');
  let testimonialIndex = 0;
  let testimonialInterval;

  function showTestimonial(index) {
    testimonials.forEach(t => t.classList.remove('active'));
    testimonialDots.forEach(d => d.classList.remove('active'));
    testimonials[index].classList.add('active');
    testimonialDots[index].classList.add('active');
    testimonialIndex = index;
  }

  function nextTestimonial() {
    showTestimonial((testimonialIndex + 1) % testimonials.length);
  }

  function startTestimonialAutoplay() {
    testimonialInterval = setInterval(nextTestimonial, 6000);
  }

  testimonialDots.forEach(dot => {
    dot.addEventListener('click', () => {
      clearInterval(testimonialInterval);
      showTestimonial(parseInt(dot.dataset.slide));
      startTestimonialAutoplay();
    });
  });

  startTestimonialAutoplay();

  // ────────────────────────────────────────
  // 5. AI Chat Widget — Connected to FastAPI Backend
  // ────────────────────────────────────────
  const chatTrigger = document.getElementById('chat-trigger');
  const chatPanel = document.getElementById('chat-panel');
  const chatClose = document.getElementById('chat-close');
  const chatInput = document.getElementById('chat-input');
  const chatSend = document.getElementById('chat-send');
  const chatMessages = document.getElementById('chat-messages');
  const quickReplies = document.getElementById('quick-replies');
  const openChatFromSection = document.getElementById('open-chat-from-section');

  function toggleChat() {
    chatPanel.classList.toggle('open');
  }

  chatTrigger.addEventListener('click', toggleChat);
  chatClose.addEventListener('click', toggleChat);
  if (openChatFromSection) {
    openChatFromSection.addEventListener('click', () => {
      if (!chatPanel.classList.contains('open')) toggleChat();
    });
  }

  // ── Chat Message Rendering ──────────────────────────────

  function addMessage(text, type) {
    const msg = document.createElement('div');
    msg.className = `chat-msg chat-msg--${type}`;
    msg.innerHTML = renderMarkdown(text);
    chatMessages.appendChild(msg);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return msg;
  }

  function renderMarkdown(text) {
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/^### (.*$)/gm, '<h4 style="margin:0.5em 0 0.25em;font-size:0.9em;">$1</h4>')
      .replace(/^## (.*$)/gm, '<h3 style="margin:0.5em 0 0.25em;font-size:1em;">$1</h3>')
      .replace(/^- (.*$)/gm, '<div style="padding-left:1em;">&#8226; $1</div>')
      .replace(/^\d+\. (.*$)/gm, (match, p1) => {
        return `<div style="padding-left:1em;">${match.match(/^\d+/)[0]}. ${p1}</div>`;
      })
      .replace(/\n\n/g, '<br><br>')
      .replace(/\n/g, '<br>');
  }

  function showTyping() {
    const typing = document.createElement('div');
    typing.className = 'chat-msg chat-msg--bot chat-msg--typing';
    typing.id = 'typing-indicator';
    typing.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="typing-label" style="margin-left:8px;font-size:0.75em;color:#94a3b8;">Searching flights & hotels...</span>';
    chatMessages.appendChild(typing);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return typing;
  }

  function removeTyping() {
    const typing = document.getElementById('typing-indicator');
    if (typing) typing.remove();
  }

  function showPhaseIndicator(phase) {
    const existing = document.getElementById('phase-indicator');
    if (existing) existing.remove();

    const labels = {
      'researching': 'Researching flights, hotels & attractions...',
      'booking': 'Processing bookings & payments...',
    };

    if (!labels[phase]) return;

    const indicator = document.createElement('div');
    indicator.id = 'phase-indicator';
    indicator.className = 'chat-phase-indicator';
    indicator.innerHTML = `<div class="chat-phase-spinner"></div><span>${labels[phase]}</span>`;
    chatMessages.appendChild(indicator);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function removePhaseIndicator() {
    const el = document.getElementById('phase-indicator');
    if (el) el.remove();
  }

  // ── API Communication ───────────────────────────────────

  async function sendChatMessage(text) {
    if (!text.trim()) return;

    addMessage(text, 'user');
    chatInput.value = '';
    quickReplies.style.display = 'none';
    showTyping();

    // Use AbortController for a 120s timeout (Amadeus searches take time)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);

    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          session_id: sessionId,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      removeTyping();

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        addMessage(errData.detail || 'Sorry, something went wrong. Please try again.', 'bot');
        return;
      }

      const data = await res.json();
      sessionId = data.session_id;
      currentPhase = data.phase;
      addMessage(data.response, 'bot');

    } catch (err) {
      clearTimeout(timeoutId);
      removeTyping();
      if (err.name === 'AbortError') {
        addMessage('The search is taking longer than expected. Please try again with more specific details.', 'bot');
      } else {
        addMessage(getLocalFallback(text), 'bot');
      }
    }
  }

  async function planTrip(description) {
    addMessage(description, 'user');
    chatInput.value = '';
    quickReplies.style.display = 'none';

    addMessage('Starting the AI Research Agent... I\'ll search for the best flights, hotels, and build your custom itinerary.', 'bot');
    showPhaseIndicator('researching');
    currentPhase = 'researching';

    try {
      const res = await fetch(`${API_BASE}/api/plan-trip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: description,
          session_id: sessionId,
        }),
      });

      removePhaseIndicator();

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        addMessage('The research phase hit an issue: ' + (errData.detail || 'Unknown error'), 'bot');
        return;
      }

      const data = await res.json();
      sessionId = data.session_id;
      currentPhase = 'research_complete';

      addMessage(data.plan, 'bot');
      showApprovalButtons();

    } catch (err) {
      removePhaseIndicator();
      addMessage('Unable to reach the AI backend. Please make sure the server is running on port 8000.', 'bot');
    }
  }

  async function bookTrip() {
    addMessage('Approved! Proceeding with booking...', 'user');
    showPhaseIndicator('booking');

    try {
      const res = await fetch(`${API_BASE}/api/book-trip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          approved: true,
        }),
      });

      removePhaseIndicator();

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        addMessage('Booking issue: ' + (errData.detail || 'Unknown error'), 'bot');
        return;
      }

      const data = await res.json();
      currentPhase = 'complete';
      addMessage(data.result, 'bot');
      addMessage('Your trip is booked! Check your email for the full itinerary and confirmation details.', 'bot');

    } catch (err) {
      removePhaseIndicator();
      addMessage('Unable to complete booking. Please try again.', 'bot');
    }
  }

  function showApprovalButtons() {
    const container = document.createElement('div');
    container.className = 'chat-approval';

    const approveBtn = document.createElement('button');
    approveBtn.className = 'chat-approval__btn chat-approval__btn--approve';
    approveBtn.textContent = 'Approve & Book';
    approveBtn.addEventListener('click', () => {
      container.remove();
      bookTrip();
    });

    const modifyBtn = document.createElement('button');
    modifyBtn.className = 'chat-approval__btn chat-approval__btn--modify';
    modifyBtn.textContent = 'Modify Plan';
    modifyBtn.addEventListener('click', () => {
      container.remove();
      addMessage('What would you like to change? I can adjust destinations, dates, budget, or activities.', 'bot');
    });

    container.appendChild(approveBtn);
    container.appendChild(modifyBtn);
    chatMessages.appendChild(container);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  // ── Local Fallback ──────────────────────────────────────

  function getLocalFallback(text) {
    const lower = text.toLowerCase();
    if (lower.includes('japan') || lower.includes('tokyo')) {
      return 'Japan is one of our most popular destinations! Our **Discover Japan** tour (14 days, $3,850) covers Tokyo, Kyoto, Osaka, and Hiroshima. Want me to create a custom package?';
    }
    if (lower.includes('italy') || lower.includes('rome')) {
      return 'Italy is a traveler\'s dream! **Highlights of Italy** - 10 days, from $2,490 (was $3,200). Currently 22% off!';
    }
    if (lower.includes('bali')) {
      return 'Bali is paradise! **Bali & Beyond** - 8 days, $1,690 (was $2,100) - 20% off!';
    }
    if (lower.includes('deal') || lower.includes('cheap') || lower.includes('budget')) {
      return 'Here are today\'s best deals:\n\n- **Bali & Beyond** - $1,690 (20% off)\n- **Highlights of Italy** - $2,490 (22% off)\n- **Mexico Explorer** - $1,890 (New!)';
    }
    return 'I\'d love to help you plan an amazing trip! Tell me where you want to go, how many days, and your budget.';
  }

  // ── Chat Event Handlers ─────────────────────────────────

  function handleUserMessage(text) {
    if (!text.trim()) return;
    // All messages go through the main chat — Claude has Amadeus tools
    // and will search automatically when it has enough info
    sendChatMessage(text);
  }

  chatSend.addEventListener('click', () => handleUserMessage(chatInput.value));
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleUserMessage(chatInput.value);
  });

  // Quick reply buttons
  quickReplies.querySelectorAll('.chat-panel__quick-reply').forEach(btn => {
    if (btn.id === 'quick-planner' || btn.id === 'quick-custom') return;
    btn.addEventListener('click', () => {
      sendChatMessage(btn.textContent.trim());
    });
  });

  // Full AI Planner button
  const plannerBtn = document.getElementById('quick-planner');
  if (plannerBtn) {
    plannerBtn.addEventListener('click', () => {
      sendChatMessage('I want to plan a custom trip with real-time flight and hotel pricing');
    });
  }

  // Custom Trip button
  const customBtn = document.getElementById('quick-custom');
  if (customBtn) {
    customBtn.addEventListener('click', () => {
      sendChatMessage('I want a custom trip to a unique destination');
    });
  }

  // ────────────────────────────────────────
  // 6. Smooth Scroll Navigation
  // ────────────────────────────────────────
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', (e) => {
      const targetId = anchor.getAttribute('href');
      if (targetId === '#') return;
      const target = document.querySelector(targetId);
      if (target) {
        e.preventDefault();
        const offset = nav.offsetHeight + 16;
        const top = target.getBoundingClientRect().top + window.pageYOffset - offset;
        window.scrollTo({ top, behavior: 'smooth' });
      }
    });
  });

  // ────────────────────────────────────────
  // 7. Scroll Animations (Intersection Observer)
  // ────────────────────────────────────────
  const fadeElements = document.querySelectorAll('.fade-in');

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, {
    threshold: 0.15,
    rootMargin: '0px 0px -50px 0px'
  });

  fadeElements.forEach(el => observer.observe(el));

  // ────────────────────────────────────────
  // 8. Newsletter Form
  // ────────────────────────────────────────
  const newsletterForm = document.getElementById('newsletter-form');
  newsletterForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const emailInput = newsletterForm.querySelector('.newsletter__input');
    const email = emailInput.value;
    if (email) {
      emailInput.value = '';
      emailInput.placeholder = 'Subscribed! Check your inbox for AI deals.';
      setTimeout(() => {
        emailInput.placeholder = 'Enter your email address';
      }, 4000);
    }
  });

  // ────────────────────────────────────────
  // 9. Hero Search Bar
  // ────────────────────────────────────────
  const heroSearchBtn = document.getElementById('hero-search-btn');
  heroSearchBtn.addEventListener('click', () => {
    const dest = document.getElementById('search-destination').value;
    const dates = document.getElementById('search-dates').value;
    if (dest.trim()) {
      if (!chatPanel.classList.contains('open')) toggleChat();
      setTimeout(() => {
        const msg = dates.trim()
          ? `I'd love to plan a trip to ${dest} around ${dates}!`
          : `I'd love to plan a trip to ${dest}!`;
        sendChatMessage(msg);
      }, 400);
    } else {
      document.getElementById('search-destination').focus();
    }
  });

  // ────────────────────────────────────────
  // 10 & 11. Tour Card Handlers (save + click → chat)
  // Dynamic cards: handled by attachTourCardHandlers() after fetch
  // ────────────────────────────────────────
  // (Attached dynamically after fetchFeaturedTours() renders cards)

  // ────────────────────────────────────────
  // 12. Destination Card Click → Open Chat
  // ────────────────────────────────────────
  document.querySelectorAll('.dest-card').forEach(card => {
    card.addEventListener('click', () => {
      const name = card.querySelector('.dest-card__name')?.textContent;
      if (name) {
        if (!chatPanel.classList.contains('open')) toggleChat();
        setTimeout(() => {
          sendChatMessage(`I'm interested in traveling to ${name}. What do you recommend?`);
        }, 400);
      }
    });
  });

  // ────────────────────────────────────────
  // 13. Style Card Click → Open Chat
  // ────────────────────────────────────────
  document.querySelectorAll('.style-card').forEach(card => {
    card.addEventListener('click', () => {
      const style = card.querySelector('.style-card__name')?.textContent;
      if (style) {
        if (!chatPanel.classList.contains('open')) toggleChat();
        setTimeout(() => {
          sendChatMessage(`I'm looking for ${style.toLowerCase()} travel experiences. What do you suggest?`);
        }, 400);
      }
    });
  });

});
