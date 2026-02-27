/* ==========================================================================
   Lab Guide Panel — Webview Client Logic
   Receives step state from the extension host, renders the instruction card,
   and activates directional edge-glow + arrows toward the focus zone.
   ========================================================================== */
(function () {
  'use strict';

  // @ts-ignore — acquireVsCodeApi provided by VS Code webview runtime
  var vscode = acquireVsCodeApi();

  /* ---- DOM refs ---- */
  var labTitle        = document.getElementById('labTitle');
  var stepBadge       = document.getElementById('stepBadge');
  var stepTitle       = document.getElementById('stepTitle');
  var stepInstruction = document.getElementById('stepInstruction');
  var stepTip         = document.getElementById('stepTip');
  var prevBtn         = document.getElementById('prevBtn');
  var nextBtn         = document.getElementById('nextBtn');
  var actionBtn       = document.getElementById('actionBtn');

  /* Arrow / glow elements */
  var arrowLeft       = document.getElementById('arrowLeft');
  var arrowRight      = document.getElementById('arrowRight');
  var arrowUp         = document.getElementById('arrowUp');
  var arrowDown       = document.getElementById('arrowDown');
  var arrowLeftLabel  = document.getElementById('arrowLeftLabel');
  var arrowRightLabel = document.getElementById('arrowRightLabel');
  var arrowUpLabel    = document.getElementById('arrowUpLabel');
  var arrowDownLabel  = document.getElementById('arrowDownLabel');
  var edgeTop         = document.getElementById('edgeTop');
  var edgeLeft        = document.getElementById('edgeLeft');
  var edgeRight       = document.getElementById('edgeRight');
  var edgeBottom      = document.getElementById('edgeBottom');

  /* ---- Opening animation state ---- */
  var savedState = vscode.getState() || {};
  var isOpening = !savedState.opened;   // skip animation if already opened once
  var pendingFocus = null;
  var chaseEdges = [edgeTop, edgeRight, edgeBottom, edgeLeft];

  /* ---- HTML sanitiser (allowlist) ---- */
  var ALLOWED_TAGS = /^(br|code|em|kbd|strong)$/i;
  function sanitizeHTML(raw) {
    var tmp = document.createElement('div');
    tmp.innerHTML = raw;
    (function walk(parent) {
      var child = parent.firstChild;
      while (child) {
        var next = child.nextSibling;
        if (child.nodeType === 1) {
          if (!ALLOWED_TAGS.test(child.tagName)) {
            while (child.firstChild) { parent.insertBefore(child.firstChild, child); }
            parent.removeChild(child);
          } else {
            while (child.attributes.length) { child.removeAttribute(child.attributes[0].name); }
            walk(child);
          }
        }
        child = next;
      }
    })(tmp);
    return tmp.innerHTML;
  }

  /* ---- Focus zone → UI mapping ---- */
  var focusMap = {
    left:   { arrows: ['left'],  edges: ['left']   },
    right:  { arrows: ['right'], edges: ['right']  },
    top:    { arrows: ['up'],    edges: ['top']    },
    up:     { arrows: ['up'],    edges: ['top']    },
    bottom: { arrows: ['down'],  edges: ['bottom'] },
    down:   { arrows: ['down'],  edges: ['bottom'] }
  };

  /* Direction → colour */
  var zoneColors = {
    left:   '#00A4EF',
    right:  '#7FBA00',
    top:    '#F25022',
    up:     '#F25022',
    bottom: '#FFB900',
    down:   '#FFB900'
  };

  /* ---- Extension → Webview messages ---- */
  window.addEventListener('message', function (event) {
    var msg = event.data;
    if (msg.type === 'setState') {
      renderStep(msg.step);
    }
    if (msg.type === 'setTitle') {
      labTitle.textContent = msg.title;
    }
    if (msg.type === 'glowNext') {
      nextBtn.classList.remove('step-btn--glow');
      // Force reflow so the animation restarts if already playing
      void nextBtn.offsetWidth;
      nextBtn.classList.add('step-btn--glow');
    }
    if (msg.type === 'setSettings') {
      if (msg.reduceMotion) {
        document.body.setAttribute('data-reduce-motion', '');
      } else {
        document.body.removeAttribute('data-reduce-motion');
      }
      if (msg.highContrast) {
        document.body.setAttribute('data-high-contrast', '');
      } else {
        document.body.removeAttribute('data-high-contrast');
      }
    }
  });

  /* ---- Step navigation (dismiss opening on user action) ---- */
  prevBtn.addEventListener('click', function () {
    dismissOpening();
    vscode.postMessage({ type: 'prevStep' });
  });
  nextBtn.addEventListener('click', function () {
    dismissOpening();
    vscode.postMessage({ type: 'nextStep' });
  });

  actionBtn.addEventListener('click', function () {
    vscode.postMessage({ type: 'replayAction' });
  });

  /* ---- Copy-to-clipboard SVG icons ---- */
  var COPY_SVG = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="5.5" y="3.5" width="8" height="10" rx="1"/><path d="M3.5 11.5V2.5a1 1 0 0 1 1-1h6"/></svg>';
  var CHECK_SVG = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 8.5l3.5 3.5 6.5-7"/></svg>';

  /** Add a small copy button after each <kbd> that contains text to type. */
  function addCopyButtons() {
    var kbdElements = stepInstruction.querySelectorAll('kbd');
    for (var i = 0; i < kbdElements.length; i++) {
      var kbd = kbdElements[i];
      var text = (kbd.innerText || kbd.textContent || '').trim();
      // Skip keyboard shortcuts (Ctrl+X, Alt+Tab, etc.) and very short text
      if (/^(Ctrl|Shift|Alt|Cmd|Tab|Esc|Enter|Space)\b/.test(text)) { continue; }
      if (text.length < 5) { continue; }

      var btn = document.createElement('button');
      btn.className = 'kbd-copy-btn';
      btn.title = 'Copy to clipboard';
      btn.innerHTML = COPY_SVG;
      (function(b, t) {
        b.addEventListener('click', function(e) {
          e.preventDefault();
          e.stopPropagation();
          vscode.postMessage({ type: 'copyToClipboard', text: t });
          b.innerHTML = CHECK_SVG;
          b.classList.add('kbd-copy-btn--copied');
          setTimeout(function() {
            b.innerHTML = COPY_SVG;
            b.classList.remove('kbd-copy-btn--copied');
          }, 1500);
        });
      })(btn, text);
      kbd.parentNode.insertBefore(btn, kbd.nextSibling);
    }
  }

  /* ---- Render a step ---- */
  function renderStep(step) {
    // Badge — show slide number and sub-step if multi-step
    if (step.total > 1) {
      stepBadge.textContent = 'Slide ' + (step.slide || '?') + ' — Step ' + (step.index + 1) + ' of ' + step.total;
    } else {
      stepBadge.textContent = 'Slide ' + (step.slide || '?');
    }
    stepTitle.textContent = step.title;
    stepInstruction.innerHTML = sanitizeHTML(step.instruction || '');

    // Add copy-to-clipboard buttons to <kbd> blocks
    addCopyButtons();

    // Action replay button (e.g. "Open New File" in case user closed it)
    if (step.actionLabel) {
      actionBtn.textContent = step.actionLabel;
      actionBtn.style.display = '';
    } else {
      actionBtn.style.display = 'none';
    }

    // Optional tip
    if (step.tip) {
      stepTip.innerHTML = sanitizeHTML(step.tip);
      stepTip.classList.add('step-tip--visible');
    } else {
      stepTip.innerHTML = '';
      stepTip.classList.remove('step-tip--visible');
    }

    // Nav buttons — hide entirely when there's only one (or no) step
    if (step.total <= 1) {
      prevBtn.style.display = 'none';
      nextBtn.style.display = 'none';
    } else {
      prevBtn.style.display = '';
      nextBtn.style.display = '';
      prevBtn.disabled = step.index === 0;
      nextBtn.disabled = step.index === step.total - 1;
    }

    // Focus zone — empty or absent means no arrows (self-focus)
    var focus = step.focus || [];
    var focusLabelOverride = step.focusLabel || null;
    // Normalize to array
    if (typeof focus === 'string') { focus = focus.length ? [focus] : []; }
    if (isOpening) {
      pendingFocus = focus;
    } else {
      applyFocus(focus, focusLabelOverride);
    }
  }

  /* ---- Apply focus zone: edge glow + arrows ---- */
  function applyFocus(zones, labelOverride) {
    // Ensure array
    if (!Array.isArray(zones)) { zones = zones ? [zones] : []; }

    // Set data attribute to first zone for CSS colour variable
    document.body.setAttribute('data-focus', zones[0] || '');

    // Merge all mappings
    var allArrows = [];
    var allEdges  = [];
    zones.forEach(function(z) {
      var m = focusMap[z];
      if (!m) return;
      m.arrows.forEach(function(a) { if (allArrows.indexOf(a) === -1) allArrows.push(a); });
      m.edges.forEach(function(e)  { if (allEdges.indexOf(e) === -1) allEdges.push(e); });
    });

    // Arrows
    toggleActive(arrowLeft,  allArrows.indexOf('left') !== -1);
    toggleActive(arrowRight, allArrows.indexOf('right') !== -1);
    toggleActive(arrowUp,    allArrows.indexOf('up') !== -1);
    toggleActive(arrowDown,  allArrows.indexOf('down') !== -1);

    // Edge glows
    toggleActive(edgeLeft,   allEdges.indexOf('left') !== -1);
    toggleActive(edgeRight,  allEdges.indexOf('right') !== -1);
    toggleActive(edgeTop,    allEdges.indexOf('top') !== -1);
    toggleActive(edgeBottom, allEdges.indexOf('bottom') !== -1);

    // Per-edge colours when multiple zones are active
    var multi = zones.length > 1;
    var edgePairs = [
      [edgeLeft, arrowLeft, 'left'],
      [edgeRight, arrowRight, 'right'],
      [edgeTop, arrowUp, 'top'],
      [edgeBottom, arrowDown, 'bottom']
    ];
    edgePairs.forEach(function(pair) {
      var edge = pair[0], arrow = pair[1], dir = pair[2];
      var color = multi ? (zoneColors[dir] || '') : '';
      if (edge) { edge.style.setProperty('--glow-color', color || ''); }
      if (arrow) { arrow.style.setProperty('--glow-color', color || ''); }
    });

    // Labels — clear all, then apply overrides from lab.json (focusLabel)
    var labels = labelOverride || {};
    arrowLeftLabel.textContent  = labels.left  || '';
    arrowRightLabel.textContent = labels.right || '';
    arrowUpLabel.textContent    = labels.up    || '';
    arrowDownLabel.textContent  = labels.down  || '';
  }

  function toggleActive(el, active) {
    if (!el) { return; }
    var cls = el.classList.contains('arrow-zone') ? 'arrow-zone--active' : 'edge-glow--active';
    if (active) {
      el.classList.add(cls);
    } else {
      el.classList.remove(cls);
    }
  }

  /* ---- Opening animation ---- */
  function dismissOpening() {
    if (!isOpening) { return; }
    isOpening = false;
    document.body.classList.remove('opening');
    chaseEdges.forEach(function (el) {
      if (el) { el.classList.remove('edge-glow--chase'); }
    });
    // Persist that the opening has played
    vscode.setState(Object.assign({}, vscode.getState() || {}, { opened: true }));
    if (pendingFocus) {
      applyFocus(pendingFocus);
      pendingFocus = null;
    }
  }

  // Only play the opening animation on first launch, not on tab restore
  if (isOpening) {
    // Skip animation entirely if OS or user prefers reduced motion
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
        document.body.hasAttribute('data-reduce-motion')) {
      isOpening = false;
      vscode.setState(Object.assign({}, vscode.getState() || {}, { opened: true }));
      if (pendingFocus) {
        applyFocus(pendingFocus);
        pendingFocus = null;
      }
    } else {
      document.body.classList.add('opening');
      chaseEdges.forEach(function (el) {
        if (el) { el.classList.add('edge-glow--chase'); }
      });
      // Auto-dismiss after 2 full rotations (~3.2 s)
      setTimeout(dismissOpening, 3200);
    }
  }

  // Apply OS-level reduced motion as a fallback
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.body.setAttribute('data-reduce-motion', '');
  }

  /* ---- Tell extension we're alive ---- */
  vscode.postMessage({ type: 'ready' });
})();
