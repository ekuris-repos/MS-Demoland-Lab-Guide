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
  var savedState = vscode.getState() || {};
  var isOpening = !savedState.opened;   // skip animation if already opened once
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

  /* Zone → colour (matches CSS focus-zone presets) */
  var zoneColors = {
    slides:   '#00A4EF',
    chat:     '#7FBA00',
    terminal: '#FFB900',
    editor:   '#F25022'
  };

  /* Edge/arrow direction → zone lookup (for per-edge colouring) */
  var directionToZone = { left: 'slides', right: 'chat', bottom: 'terminal', top: 'editor', down: 'terminal', up: 'editor' };

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
    // Badge — show slide number and sub-step if multi-step
    if (step.total > 1) {
      stepBadge.textContent = 'Slide ' + (step.slide || '?') + ' — Step ' + (step.index + 1) + ' of ' + step.total;
    } else {
      stepBadge.textContent = 'Slide ' + (step.slide || '?');
    }
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
    var focus = step.focus || 'guide';
    if (isOpening) {
      pendingFocus = focus;
    } else {
      applyFocus(focus);
    }
  }

  /* ---- Apply focus zone: edge glow + arrows ---- */
  function applyFocus(zone) {
    // Support multiple zones (string or array)
    var zones = Array.isArray(zone) ? zone : [zone];

    // Set data attribute to first zone for CSS colour variable
    document.body.setAttribute('data-focus', zones[0]);

    // Merge all mappings
    var allArrows = [];
    var allEdges  = [];
    var allLabels = {};
    zones.forEach(function(z) {
      var m = focusMap[z] || focusMap.guide;
      m.arrows.forEach(function(a) { if (allArrows.indexOf(a) === -1) allArrows.push(a); });
      m.edges.forEach(function(e)  { if (allEdges.indexOf(e) === -1) allEdges.push(e); });
      Object.keys(m.labels).forEach(function(k) { allLabels[k] = m.labels[k]; });
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
      var color = multi ? (zoneColors[directionToZone[dir]] || '') : '';
      if (edge) { edge.style.setProperty('--glow-color', color || ''); }
      if (arrow) { arrow.style.setProperty('--glow-color', color || ''); }
    });

    // Labels
    if (allLabels.left)  { arrowLeftLabel.textContent  = allLabels.left; }
    if (allLabels.right) { arrowRightLabel.textContent = allLabels.right; }
    if (allLabels.up)    { arrowUpLabel.textContent    = allLabels.up; }
    if (allLabels.down)  { arrowDownLabel.textContent  = allLabels.down; }
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
    document.body.classList.add('opening');
    chaseEdges.forEach(function (el) {
      if (el) { el.classList.add('edge-glow--chase'); }
    });
    // Auto-dismiss after 2 full rotations (~3.2 s)
    setTimeout(dismissOpening, 3200);
  }

  /* ---- Tell extension we're alive ---- */
  vscode.postMessage({ type: 'ready' });
})();
