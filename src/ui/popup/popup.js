// Message type constants
const MessageTypes = {
  SET_SPEED: 'VSC_SET_SPEED',
  ADJUST_SPEED: 'VSC_ADJUST_SPEED',
  RESET_SPEED: 'VSC_RESET_SPEED',
  TOGGLE_DISPLAY: 'VSC_TOGGLE_DISPLAY',
  GET_STATUS: 'VSC_GET_STATUS',
};

const SPEED_LIMITS = {
  MIN: 0.07,
  MAX: 16,
};

document.addEventListener('DOMContentLoaded', () => {
  // Load settings and initialize speed controls
  loadSettingsAndInitialize();

  // Settings button event listener
  document.querySelector('#config').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Power button toggle event listener
  document.querySelector('#disable').addEventListener('click', function () {
    // Toggle based on current state
    const isCurrentlyEnabled = !this.classList.contains('disabled');
    toggleEnabled(!isCurrentlyEnabled, settingsSavedReloadMessage);
  });

  // Initialize enabled state
  chrome.storage.sync.get({ enabled: true }, (storage) => {
    toggleEnabledUI(storage.enabled);
  });

  function toggleEnabled(enabled, callback) {
    chrome.storage.sync.set(
      {
        enabled: enabled,
      },
      () => {
        toggleEnabledUI(enabled);
        if (callback) {
          callback(enabled);
        }
      }
    );
  }

  function toggleEnabledUI(enabled) {
    const disableBtn = document.querySelector('#disable');
    disableBtn.classList.toggle('disabled', !enabled);
    disableBtn.setAttribute('aria-pressed', String(!enabled));
    disableBtn.setAttribute('aria-label', enabled ? 'Disable extension' : 'Enable extension');

    // Update tooltip
    disableBtn.title = enabled ? 'Disable Extension' : 'Enable Extension';
  }

  function settingsSavedReloadMessage(enabled) {
    setStatusMessage(`${enabled ? 'Enabled' : 'Disabled'}. Reload page.`);
  }

  function setStatusMessage(str) {
    const status_element = document.querySelector('#status');
    status_element.classList.toggle('hide', false);
    status_element.classList.remove('error', 'success');
    status_element.textContent = str;
  }

  function setStatusState(str, state = '') {
    const statusElement = document.querySelector('#status');
    statusElement.classList.toggle('hide', false);
    statusElement.classList.remove('error', 'success');
    if (state) {
      statusElement.classList.add(state);
    }
    statusElement.textContent = str;
  }

  function setCustomSpeedValidity(valid) {
    const input = document.querySelector('#custom-speed-input');
    if (input) {
      input.setAttribute('aria-invalid', String(!valid));
    }
  }

  function getSpeedControls() {
    return [
      '#speed-decrease',
      '#speed-reset',
      '#speed-increase',
      '.preset-btn',
      '#custom-speed-input',
      '#custom-speed-apply',
    ]
      .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
      .filter(Boolean);
  }

  function setSpeedControlsAvailable(available) {
    getSpeedControls().forEach((control) => {
      control.disabled = !available;
    });
  }

  function validateCustomSpeedValue(value) {
    const speed = parseFloat(value);
    if (!Number.isFinite(speed)) {
      return { valid: false, speed, message: 'Enter a speed from 0.07x to 16x.' };
    }

    if (speed < SPEED_LIMITS.MIN || speed > SPEED_LIMITS.MAX) {
      return { valid: false, speed, message: 'Speed must be between 0.07x and 16x.' };
    }

    return { valid: true, speed };
  }

  // Load settings and initialize UI
  function loadSettingsAndInitialize() {
    chrome.storage.sync.get(null, (storage) => {
      // Find the step values from keyBindings
      let slowerStep = 0.1;
      let fasterStep = 0.1;

      if (storage.keyBindings && Array.isArray(storage.keyBindings)) {
        const slowerBinding = storage.keyBindings.find((kb) => kb.action === 'slower');
        const fasterBinding = storage.keyBindings.find((kb) => kb.action === 'faster');

        if (slowerBinding && typeof slowerBinding.value === 'number') {
          slowerStep = slowerBinding.value;
        }
        if (fasterBinding && typeof fasterBinding.value === 'number') {
          fasterStep = fasterBinding.value;
        }
      }

      // Update the UI with dynamic values
      updateSpeedControlsUI(slowerStep, fasterStep);

      // Initialize event listeners
      initializeSpeedControls();
      refreshStatus();
    });
  }

  function updateSpeedControlsUI(slowerStep, fasterStep) {
    // Update decrease button
    const decreaseBtn = document.querySelector('#speed-decrease');
    if (decreaseBtn) {
      decreaseBtn.dataset.delta = -slowerStep;
      decreaseBtn.querySelector('span').textContent = `-${slowerStep}`;
      decreaseBtn.setAttribute('aria-label', `Decrease speed by ${slowerStep}x`);
    }

    // Update increase button
    const increaseBtn = document.querySelector('#speed-increase');
    if (increaseBtn) {
      increaseBtn.dataset.delta = fasterStep;
      increaseBtn.querySelector('span').textContent = `+${fasterStep}`;
      increaseBtn.setAttribute('aria-label', `Increase speed by ${fasterStep}x`);
    }

    // Update reset button
    const resetBtn = document.querySelector('#speed-reset');
    if (resetBtn) {
      resetBtn.textContent = '1x';
      resetBtn.setAttribute('aria-label', 'Reset speed to 1x');
    }
  }

  // Speed Control Functions
  function initializeSpeedControls() {
    // Set up speed control button listeners
    document.querySelector('#speed-decrease').addEventListener('click', (event) => {
      const delta = parseFloat(event.currentTarget.dataset.delta);
      adjustSpeed(delta);
    });

    document.querySelector('#speed-increase').addEventListener('click', (event) => {
      const delta = parseFloat(event.currentTarget.dataset.delta);
      adjustSpeed(delta);
    });

    document.querySelector('#speed-reset').addEventListener('click', () => {
      setSpeed(1.0);
    });

    // Set up preset button listeners
    document.querySelectorAll('.preset-btn').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        const speed = parseFloat(event.currentTarget.dataset.speed);
        setSpeed(speed);
      });
    });

    document.querySelector('#custom-speed-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const input = document.querySelector('#custom-speed-input');
      const result = validateCustomSpeedValue(input.value);
      if (!result.valid) {
        setCustomSpeedValidity(false);
        setStatusState(result.message, 'error');
        input.focus();
        input.select();
        return;
      }

      setCustomSpeedValidity(true);
      setSpeed(result.speed);
    });

    document.querySelector('#custom-speed-input').addEventListener('input', (event) => {
      setCustomSpeedValidity(validateCustomSpeedValue(event.currentTarget.value).valid);
    });
  }

  function setSpeed(speed) {
    sendCommand(MessageTypes.SET_SPEED, { speed: speed }, `Set to ${speed}x`);
  }

  function adjustSpeed(delta) {
    sendCommand(MessageTypes.ADJUST_SPEED, { delta: delta }, `${delta > 0 ? '+' : ''}${delta}x`);
  }

  function refreshStatus() {
    sendCommand(MessageTypes.GET_STATUS, {}, '', { silent: true });
  }

  function sendCommand(type, payload, successMessage, options = {}) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) {
        setSpeedControlsAvailable(false);
        setStatusState('No active tab.', 'error');
        return;
      }

      chrome.tabs.sendMessage(tabs[0].id, { type, payload }, (response) => {
        if (chrome.runtime.lastError) {
          const tabUrl = tabs[0].url || '';
          const restrictedPage = /^(chrome|edge|about|chrome-extension):/i.test(tabUrl);
          setSpeedControlsAvailable(false);
          setStatusState(
            restrictedPage
              ? 'Controls are not available on browser pages.'
              : 'Reload this page to enable controls.',
            'error'
          );
          updateCurrentSpeed(null);
          return;
        }

        if (!response?.ok) {
          setSpeedControlsAvailable(false);
          setStatusState('No response from this page. Try reloading the tab.', 'error');
          updateCurrentSpeed(null);
          return;
        }

        if (response.mediaCount === 0) {
          setSpeedControlsAvailable(false);
          setStatusState('No media found on this page.', 'error');
          updateCurrentSpeed(null);
          return;
        }

        setSpeedControlsAvailable(true);
        if (typeof response.currentSpeed === 'number') {
          updateCurrentSpeed(response.currentSpeed);
        } else {
          updateCurrentSpeed(null);
        }

        if (!options.silent) {
          setStatusState(successMessage, 'success');
        } else if (typeof response.currentSpeed === 'number') {
          setStatusState(`Current ${formatSpeed(response.currentSpeed)}x`, 'success');
        }
      });
    });
  }

  function updateCurrentSpeed(speed) {
    document.querySelectorAll('.preset-btn').forEach((button) => {
      const presetSpeed = parseFloat(button.dataset.speed);
      const isActive = typeof speed === 'number' && Math.abs(speed - presetSpeed) < 0.005;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    });

    const input = document.querySelector('#custom-speed-input');
    if (input && typeof speed === 'number') {
      input.value = formatSpeed(speed);
      setCustomSpeedValidity(true);
    }
  }

  function formatSpeed(speed) {
    return Number(speed)
      .toFixed(2)
      .replace(/\.?0+$/, '');
  }
});
