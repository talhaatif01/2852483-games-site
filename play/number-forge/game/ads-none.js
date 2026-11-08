/* Tivexa ad adapter `none` (web release target, job 1296/1299; see shared/ads/README.md). Loaded FIRST by every web build
   (web/build-web.js); never by an Android build. It cannot serve any ad, so a game asks canServe(kind) before it renders
   an offer and renders none: no rewarded offer, no Second-chance or hint-ad button, no interstitial, no banner. */
(function (root) {
  'use strict';
  const nothing = () => Promise.resolve('error');
  root.TivexaAds = Object.freeze({
    adapter: 'none',
    canServe: () => false,                 // kind: 'rewarded' | 'interstitial' | 'banner'
    showRewarded: nothing,                 // Promise<'rewarded' | 'closed' | 'error'>
    showInterstitial: nothing,             // Promise<'closed' | 'error'>
    banner: Object.freeze({ prepare: () => Promise.resolve({ ready: false, visible: false, heightDp: 0, gapDp: 0 }), set: () => Promise.resolve({ ready: false, visible: false, heightDp: 0, gapDp: 0 }) }),
  });
})(globalThis);
