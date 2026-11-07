export const PRIVACY_PARAGRAPHS = [
    { text: "Sortwise is a TIVEXA game, published by 2852483 Alberta Inc., Alberta, Canada." },
    { text: "Sortwise has no account and no in-app purchases, and we run no analytics of our own." },
    {
        lead: "Ads.",
        text: "Sortwise shows a small banner at the bottom of the menu screens, never during a puzzle or the tutorial, and an ad you can choose to watch for one extra hint when a level's free hints are used up. You can watch another ad each time that level's hints run out.",
    },
    {
        text: "Both ad types come from Google AdMob. To show ads, measure them and prevent fraud, Google collects your IP address, from which it may estimate your approximate location, your device's advertising ID and app set ID, how you interact with ads, and diagnostic information such as app launches.",
    },
    { lead: "Your choices.", text: "Where the law requires it, for example, in the European Economic Area, Google asks for your choice the first time an ad could be shown." },
    { text: "If you decline, ads can still appear, served according to your choice." },
    { text: 'You can change your choice at any time with "Privacy choices" in Settings.', onlyWithChoices: true },
    { text: "If no ad is available, for example offline, the game tells you and you keep playing; nothing is lost or charged." },
    {
        lead: "On your device.",
        text: 'Your progress, hints, settings and the puzzle you are working on are stored only on this device. "Reset all progress" in Settings erases them, except your sound setting and privacy choices. Uninstalling the app or clearing its data also deletes them. If Android backup is turned on, Android may include them in your own device backup.',
    },
];
/**
 * The neutral message when no rewarded ad can be shown (offline, no fill, or the consent check failed).
 * Owner decision 2026-11-03: exactly this sentence.
 */
export const NO_AD_MESSAGE = "No ad is available right now.";
