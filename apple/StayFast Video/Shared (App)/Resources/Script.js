window.show = function show(platform, enabled, canOpenSettings = false) {
  document.body.classList.add(`platform-${platform}`);
  document.querySelector('.ios-open-settings').hidden = !canOpenSettings;
  document.body.classList.toggle('state-on', enabled === true);
  document.body.classList.toggle('state-off', enabled === false);
};

function showSettingsError() {
  document.getElementById('settings-error').hidden = false;
}

document.querySelectorAll('.open-preferences').forEach((button) => {
  button.addEventListener('click', () => {
    try {
      window.webkit.messageHandlers.controller.postMessage('open-preferences');
    } catch {
      showSettingsError();
    }
  });
});
