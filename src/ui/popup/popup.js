import { sendTabCommand } from './tab-command.js';

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
  let enabled = true;
  let commandGeneration = 0;
  window.addEventListener('pagehide', () => commandGeneration++, { once: true });
  setSpeedControlsAvailable(false);
  // Load settings and initialize speed controls
  loadSettingsAndInitialize();

  // Settings button event listener
  document.querySelector('#config').addEventListener('click', () => {
    try {
      chrome.runtime.openOptionsPage();
    } catch {
      setStatusState('Unable to open settings.', 'error');
    }
  });

  // Power button toggle event listener
  document.querySelector('#disable').addEventListener('click', function () {
    // Toggle based on current state
    const isCurrentlyEnabled = !this.classList.contains('disabled');
    toggleEnabled(!isCurrentlyEnabled);
  });

  function toggleEnabled(nextEnabled) {
    const button = document.querySelector('#disable');
    button.disabled = true;
    try {
      chrome.storage.sync.set({ enabled: nextEnabled }, () => {
        button.disabled = false;
        if (chrome.runtime.lastError) {
          setStatusState('Unable to save the enabled setting.', 'error');
          return;
        }
        commandGeneration++;
        toggleEnabledUI(nextEnabled);
        if (nextEnabled) {
          setStatusState('Finding media…');
          refreshStatus(6);
        } else {
          setSpeedControlsAvailable(false);
          updateCurrentSpeed(null);
          setStatusState('Extension disabled.');
        }
      });
    } catch {
      button.disabled = false;
      setStatusState('Unable to save the enabled setting.', 'error');
    }
  }

  function toggleEnabledUI(nextEnabled) {
    enabled = nextEnabled;
    const disableBtn = document.querySelector('#disable');
    disableBtn.classList.toggle('disabled', !enabled);
    disableBtn.setAttribute('aria-pressed', String(!enabled));
    disableBtn.setAttribute('aria-label', enabled ? 'Disable extension' : 'Enable extension');

    // Update tooltip
    disableBtn.title = enabled ? 'Disable Extension' : 'Enable Extension';
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
    initializeSpeedControls();
    try {
      chrome.storage.sync.get(['enabled', 'keyBindings'], (storage) => {
        if (chrome.runtime.lastError || !storage) {
          setStatusState('Unable to load settings.', 'error');
          return;
        }
        toggleEnabledUI(storage.enabled !== false);
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

        if (enabled) {
          refreshStatus();
        } else {
          setStatusState('Extension disabled.');
        }
      });
    } catch {
      setStatusState('Unable to load settings.', 'error');
    }
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

  function refreshStatus(retries = 0) {
    sendCommand(MessageTypes.GET_STATUS, {}, '', { silent: true, retries });
  }

  function sendCommand(type, payload, successMessage, options = {}) {
    if (!enabled) {
      return;
    }
    const generation = ++commandGeneration;
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (generation !== commandGeneration) {
          return;
        }
        if (chrome.runtime.lastError || !tabs?.[0]) {
          setSpeedControlsAvailable(false);
          setStatusState('No active tab.', 'error');
          return;
        }

        sendTabCommand(tabs[0].id, { type, payload })
          .then((response) => {
            if (generation !== commandGeneration) {
              return;
            }
            // Re-enable initializes media asynchronously and defers DOM work.
            // Retry only status reads, for a bounded period while the popup is
            // open; never repeat a speed-changing command.
            if (
              type === MessageTypes.GET_STATUS &&
              options.retries > 0 &&
              (!response?.ok || response.mediaCount === 0)
            ) {
              refreshStatus(options.retries - 1);
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
            updateCurrentSpeed(response.currentSpeed);

            if (!options.silent) {
              setStatusState(successMessage, 'success');
            } else if (typeof response.currentSpeed === 'number') {
              setStatusState(`Current ${formatSpeed(response.currentSpeed)}x`, 'success');
            } else {
              setStatusState('Multiple playback speeds.', 'success');
            }
          })
          .catch(() => {
            if (generation === commandGeneration) {
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
            }
          });
      });
    } catch {
      setSpeedControlsAvailable(false);
      setStatusState('Unable to contact the active tab.', 'error');
    }
  }

  function updateCurrentSpeed(speed) {
    document.querySelectorAll('.preset-btn').forEach((button) => {
      const presetSpeed = parseFloat(button.dataset.speed);
      const isActive = typeof speed === 'number' && Math.abs(speed - presetSpeed) < 0.005;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    });

    const input = document.querySelector('#custom-speed-input');
    if (input) {
      input.value = typeof speed === 'number' ? formatSpeed(speed) : '';
      setCustomSpeedValidity(true);
    }
  }

  function formatSpeed(speed) {
    return Number(speed)
      .toFixed(2)
      .replace(/\.?0+$/, '');
  }
});
