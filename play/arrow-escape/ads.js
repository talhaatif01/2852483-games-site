/* Arrow Escape ads: LOCAL SIMULATION ONLY. No ad SDK, no network, no AdMob. It mimics the callbacks a real rewarded
   ad SDK can produce so the game's handling can be tested: a completed ad (reward), a closed-early ad (cancel), a load
   or show failure (error), and a reward callback delivered twice (duplicate). A reward is granted at most once per
   request, whatever the callbacks do. */
(function (root) {
  'use strict';
  let seq = 0;
  const log = [];
  /** Shows a simulated rewarded ad. outcome: 'reward' | 'cancel' | 'error' | 'duplicate'.
      onReward(requestId) is called at most once per request. Resolves with 'rewarded' | 'closed' | 'error'. */
  function showRewarded(outcome, onReward) {
    const id = ++seq;
    let granted = false;
    const earned = () => { if (granted) { log.push({ id, event: 'duplicate-reward-ignored' }); return; } granted = true; log.push({ id, event: 'reward-granted' }); onReward(id); };
    log.push({ id, event: 'show', outcome });
    return new Promise(resolve => setTimeout(() => {
      if (outcome === 'reward') { earned(); resolve('rewarded'); }
      else if (outcome === 'duplicate') { earned(); earned(); resolve('rewarded'); }
      else if (outcome === 'cancel') { log.push({ id, event: 'closed-early' }); resolve('closed'); }
      else { log.push({ id, event: 'error' }); resolve('error'); }
    }, 250));
  }
  root.ArrowAds = { showRewarded, log, simulated: true };
})(globalThis);
