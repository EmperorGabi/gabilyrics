// electron-builder "afterPack" hook.
// Without a paid Apple Developer certificate, the Mac app is left unsigned, and Apple Silicon Macs
// refuse to open unsigned apps ("damaged"). An ad-hoc signature fixes that; Gatekeeper will still
// ask the user to confirm the first launch (right-click → Open) because the app isn't notarized.
// If a real certificate is configured (CSC_LINK / CSC_NAME), electron-builder signs it properly instead.
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (process.env.CSC_LINK || process.env.CSC_NAME) return;
  const app = path.join(context.appOutDir, context.packager.appInfo.productFilename + '.app');
  console.log('  • ad-hoc signing', app);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
};
