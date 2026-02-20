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
  var isOpening = true;
  var pendingFocus = null;
  var chaseEdges = [edgeTop, edgeRight, edgeBottom, edgeLeft];

  /* ---- Focus zone → UI mapping ---- */
  var focusMap = {
    slides:   { arrows: ['left'],  edges: ['left'],   labels: { left: 'Slides' } },
    chat:     { arrows: ['right'], edges: ['right'],  labels: { right: 'Copilot Chat' } },
    terminal: { arrows: ['down'],  edges: ['bottom'], labels: { down: 'Terminal' } },
    editor:   { arrows: ['up'],    edges: ['top'],    labels: { up: 'Editor' } },
    guide:    { arrows: [],        edges: [],         labels: {} }
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

  /* ---- Render a step ---- */
  function renderStep(step) {
    // Badge & title
    stepBadge.textContent = 'Step ' + (step.index + 1) + ' of ' + step.total;
    stepTitle.textContent = step.title;
    stepInstruction.innerHTML = step.instruction || '';

    // Optional tip
    if (step.tip) {
      stepTip.innerHTML = step.tip;
      stepTip.classList.add('step-tip--visible');
    } else {
      stepTip.innerHTML = '';
      stepTip.classList.remove('step-tip--visible');
    }

    // Nav buttons
    prevBtn.disabled = step.index === 0;
    nextBtn.disabled = step.index === step.total - 1;

    // Focus zone
    if (isOpening) {
      pendingFocus = step.focus || 'guide';
    } else {
      applyFocus(step.focus || 'guide');
    }
  }

  /* ---- Apply focus zone: edge glow + arrows ---- */
  function applyFocus(zone) {
    // Set data attribute on body for CSS colour variable
    document.body.setAttribute('data-focus', zone);

    var mapping = focusMap[zone] || focusMap.guide;

    // Arrows
    toggleActive(arrowLeft,  mapping.arrows.indexOf('left') !== -1);
    toggleActive(arrowRight, mapping.arrows.indexOf('right') !== -1);
    toggleActive(arrowUp,    mapping.arrows.indexOf('up') !== -1);
    toggleActive(arrowDown,  mapping.arrows.indexOf('down') !== -1);

    // Edge glows
    toggleActive(edgeLeft,   mapping.edges.indexOf('left') !== -1);
    toggleActive(edgeRight,  mapping.edges.indexOf('right') !== -1);
    toggleActive(edgeTop,    mapping.edges.indexOf('top') !== -1);
    toggleActive(edgeBottom, mapping.edges.indexOf('bottom') !== -1);

    // Labels
    if (mapping.labels.left)  { arrowLeftLabel.textContent  = mapping.labels.left; }
    if (mapping.labels.right) { arrowRightLabel.textContent = mapping.labels.right; }
    if (mapping.labels.up)    { arrowUpLabel.textContent    = mapping.labels.up; }
    if (mapping.labels.down)  { arrowDownLabel.textContent  = mapping.labels.down; }
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
    if (pendingFocus) {
      applyFocus(pendingFocus);
      pendingFocus = null;
    }
  }

  // Start opening: edge chase + spinner
  document.body.classList.add('opening');
  chaseEdges.forEach(function (el) {
    if (el) { el.classList.add('edge-glow--chase'); }
  });

  // Auto-dismiss after 2 full rotations (~3.2 s)
  setTimeout(dismissOpening, 3200);

  /* ---- Tell extension we're alive ---- */
  vscode.postMessage({ type: 'ready' });
})();
