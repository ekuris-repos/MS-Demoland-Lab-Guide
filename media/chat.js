/* ==========================================================================
   Simulated GitHub Copilot Chat — Webview Client Logic
   Handles messages from the extension host and drives the chat UI.
   ========================================================================== */
(function () {
  'use strict';

  // @ts-ignore — acquireVsCodeApi provided by VS Code webview runtime
  const vscode = acquireVsCodeApi();

  /* ---- DOM refs ---- */
  const messagesEl    = document.getElementById('messages');
  const welcomeEl     = document.getElementById('welcome');
  const chatInput     = document.getElementById('chatInput');
  const stepNumber    = document.getElementById('stepNumber');
  const stepTitle     = document.getElementById('stepTitle');
  const stepInstruction = document.getElementById('stepInstruction');
  const prevBtn       = document.getElementById('prevBtn');
  const nextBtn       = document.getElementById('nextBtn');

  /* ---- Extension → Webview messages ---- */
  window.addEventListener('message', function (event) {
    var msg = event.data;
    if (msg.type === 'setState') {
      renderStep(msg.step);
    }
  });

  /* ---- Step navigation (from webview buttons) ---- */
  prevBtn.addEventListener('click', function () {
    vscode.postMessage({ type: 'prevStep' });
  });
  nextBtn.addEventListener('click', function () {
    vscode.postMessage({ type: 'nextStep' });
  });

  /* ---- Render a full step ---- */
  function renderStep(step) {
    // Banner
    stepNumber.textContent = 'Step ' + (step.index + 1) + ' of ' + step.total;
    stepTitle.textContent  = step.title;
    stepInstruction.innerHTML = step.instruction || '';
    prevBtn.disabled = step.index === 0;
    nextBtn.disabled = step.index === step.total - 1;

    // Messages
    var msgs = step.messages || [];
    renderMessages(msgs);

    // Welcome visibility
    welcomeEl.style.display = msgs.length > 0 ? 'none' : 'flex';

    // Input state
    if (step.inputPlaceholder) {
      chatInput.placeholder = step.inputPlaceholder;
    }
    chatInput.value = step.inputValue || '';

    // Highlights
    clearHighlights();
    if (step.highlights) {
      step.highlights.forEach(applyHighlight);
    }

    // Auto-type the last assistant message
    if (step.autoType && msgs.length > 0) {
      var lastAssistant = messagesEl.querySelector('.message-assistant:last-child .message-content');
      if (lastAssistant) {
        typeWriter(lastAssistant);
      }
    }
  }

  /* ---- Render chat messages ---- */
  function renderMessages(msgs) {
    // Remove existing messages (keep welcome)
    var existing = messagesEl.querySelectorAll('.message');
    for (var i = 0; i < existing.length; i++) {
      existing[i].remove();
    }

    msgs.forEach(function (msg) {
      var div = document.createElement('div');
      div.className = 'message message-' + msg.role;

      var avatar = document.createElement('div');
      avatar.className = 'message-avatar';
      if (msg.role === 'assistant') {
        avatar.innerHTML = '<svg viewBox="0 0 16 16" width="18" height="18"><path fill="currentColor" d="M7.998 0a8 8 0 1 0 0 16 8 8 0 0 0 0-16ZM5.6 8.6a1.1 1.1 0 1 1 0-2.2 1.1 1.1 0 0 1 0 2.2Zm4.8 0a1.1 1.1 0 1 1 0-2.2 1.1 1.1 0 0 1 0 2.2Z"/></svg>';
      } else {
        avatar.textContent = 'U';
      }

      var content = document.createElement('div');
      content.className = 'message-content';
      content.innerHTML = msg.content;

      div.appendChild(avatar);
      div.appendChild(content);
      messagesEl.appendChild(div);
    });

    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  /* ---- Highlight system ---- */
  function clearHighlights() {
    var active = document.querySelectorAll('.effect-pulse, .effect-glow, .effect-box');
    for (var i = 0; i < active.length; i++) {
      active[i].classList.remove('effect-pulse', 'effect-glow', 'effect-box');
      active[i].style.removeProperty('--highlight-color');
    }
  }

  function applyHighlight(hl) {
    var el = document.querySelector(hl.target);
    if (!el) { return; }
    el.classList.add('effect-' + hl.effect);
    if (hl.color) {
      el.style.setProperty('--highlight-color', hl.color);
    }
  }

  /* ---- Typing animation ---- */
  function typeWriter(el) {
    var html = el.innerHTML;
    el.innerHTML = '';
    el.classList.add('typing-cursor');
    var i = 0;
    var speed = 18;

    function tick() {
      if (i < html.length) {
        // Handle HTML tags — write them instantly
        if (html.charAt(i) === '<') {
          var close = html.indexOf('>', i);
          if (close !== -1) {
            el.innerHTML += html.substring(i, close + 1);
            i = close + 1;
          } else {
            el.innerHTML += html.charAt(i);
            i++;
          }
        } else {
          el.innerHTML += html.charAt(i);
          i++;
        }
        setTimeout(tick, speed);
      } else {
        el.classList.remove('typing-cursor');
      }
    }

    tick();
  }

  /* ---- Tell extension we're alive ---- */
  vscode.postMessage({ type: 'ready' });
})();
