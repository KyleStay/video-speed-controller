import { installMediaMock } from './media-mock-fixture.js';
installMediaMock(document);
if (new URLSearchParams(location.search).has('native-qa')) {
  import('./media-native-probe.js').then(({ installNativeProbe }) => installNativeProbe(document));
}
