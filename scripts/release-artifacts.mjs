export function releaseZipName(browser, version) {
  return `stayfast-video-${browser}-${version}.zip`;
}

export function releaseZipNames(browsers, version) {
  return browsers.map((browser) => releaseZipName(browser, version));
}
